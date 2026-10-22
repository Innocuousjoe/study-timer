import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { createLiveActivityClient } from '../src/native/liveActivity';
import {
  SESSION_STORAGE_KEY,
  useStudyTimer,
  type KeyValueStore,
} from '../src/timer/useStudyTimer';
import { serializeSession, type Session } from '../src/timer/timerModel';
import {
  createFakeNative,
  createMemoryStore,
} from '../test/fakeNativeLiveActivity';

const T0 = Date.UTC(2026, 9, 22, 9, 0, 0);

let appStateListener: ((s: AppStateStatus) => void) | undefined;

beforeEach(() => {
  jest.useFakeTimers({ now: T0 });
  appStateListener = undefined;
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_t, fn) => {
    appStateListener = fn as (s: AppStateStatus) => void;
    return { remove: jest.fn() } as never;
  });
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function setup(
  opts: {
    stored?: Session | null;
    enabled?: boolean;
    seed?: (fake: ReturnType<typeof createFakeNative>) => void;
    storage?: KeyValueStore;
    log?: string[];
  } = {},
) {
  const fake = createFakeNative({ enabled: opts.enabled, log: opts.log });
  opts.seed?.(fake);
  const memory = createMemoryStore(
    opts.stored ? { [SESSION_STORAGE_KEY]: serializeSession(opts.stored) } : {},
  );
  const storage = opts.storage ?? memory;
  const activities = createLiveActivityClient(fake.spec, () => {});
  let ids = 0;
  const hook = await renderHook(() =>
    useStudyTimer({ storage, activities, newId: () => `s${++ids}` }),
  );
  await settle(hook.result);
  return { fake, storage: memory, ...hook };
}

/** Lets pending storage + native work finish inside act(). */
async function settle(result: { current: { settled: () => Promise<void> } }) {
  await act(async () => {
    await result.current.settled();
  });
}

async function advance(ms: number) {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

async function setAppState(s: AppStateStatus) {
  await act(async () => {
    appStateListener?.(s);
  });
}

describe('useStudyTimer', () => {
  it('starts idle after hydrating an empty store', async () => {
    const { result } = await setup();
    expect(result.current.hydrated).toBe(true);
    expect(result.current.session).toBeNull();
    expect(result.current.liveActivityStatus).toBe('on');
  });

  it('ticks the display once per second while running', async () => {
    const { result, fake } = await setup();
    await act(async () => result.current.start('Chapter 5 Review', 1500));
    await settle(result);
    expect(result.current.elapsed).toBe(0);
    expect(fake.calls).toEqual(['start:s1']);

    // Ticks land just after each whole second (5 ms padding), never before.
    await advance(3010);
    expect(result.current.elapsed).toBe(3);
    await advance(985);
    expect(result.current.elapsed).toBe(3);
    await advance(20);
    expect(result.current.elapsed).toBe(4);
  });

  it('does not drift: time spent suspended in the background is counted', async () => {
    const { result } = await setup();
    await act(async () => result.current.start('Chapter 5 Review', 1500));
    await advance(3010);
    expect(result.current.elapsed).toBe(3);

    // Backgrounded: JS timers stop firing, but the wall clock keeps going.
    await setAppState('background');
    jest.setSystemTime(Date.now() + 10 * 60 * 1000);
    await setAppState('active');

    expect(result.current.elapsed).toBe(603);
  });

  it('pause freezes, resume continues, stop ends: each synced to native once', async () => {
    const { result, fake, storage } = await setup();
    await act(async () => result.current.start('Chapter 5 Review', 1500));
    await advance(5010);

    await act(async () => result.current.pause());
    await advance(60_000);
    expect(result.current.paused).toBe(true);
    expect(result.current.elapsed).toBe(5);

    await act(async () => result.current.resume());
    await advance(2000);
    expect(result.current.elapsed).toBe(7);

    await act(async () => result.current.stop());
    await settle(result);
    expect(result.current.session).toBeNull();
    expect(fake.calls).toEqual([
      'start:s1',
      'update:s1:paused',
      'update:s1:running',
      'endAll',
    ]);
    expect(fake.activities).toHaveLength(0);
    expect(storage.data.get(SESSION_STORAGE_KEY)).toBe('null');
  });

  it('persists every change before telling ActivityKit', async () => {
    // Storage writes and native calls go into one log, so order is visible.
    const log: string[] = [];
    const memory = createMemoryStore();
    const storage: KeyValueStore = {
      getItem: memory.getItem,
      setItem: async (k, v) => {
        const session = JSON.parse(v) as Session | null;
        log.push(
          session === null
            ? 'save:none'
            : `save:${session.pausedAt === null ? 'running' : 'paused'}${
                session.activityShown ? ':shown' : ''
              }`,
        );
        await memory.setItem(k, v);
      },
    };
    const { result } = await setup({ storage, log });
    await act(async () => result.current.start('Chapter 5 Review', 1500));
    await advance(5000);
    await act(async () => result.current.pause());
    await act(async () => result.current.stop());
    await settle(result);
    expect(log).toEqual([
      'save:running',
      'start:s1',
      'save:running:shown', // remembers the activity exists (for swipe-away)
      'save:paused:shown',
      'update:s1:paused',
      'save:none',
      'endAll',
    ]);
  });

  it('still updates ActivityKit when saving fails (e.g. disk full)', async () => {
    const failing: KeyValueStore = {
      getItem: async () => null,
      setItem: async () => {
        throw new Error('disk full');
      },
    };
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    const { result, fake } = await setup({ storage: failing });
    await act(async () => result.current.start('Chapter 5 Review', 1500));
    await act(async () => result.current.stop());
    await settle(result);
    expect(fake.calls).toEqual(['start:s1', 'endAll']);
    expect(fake.activities).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(
      '[StudyTimer] could not save session',
      expect.any(Error),
    );
  });

  it('respects a swipe-away for the rest of the session, then shows the next one', async () => {
    const { result, fake } = await setup();
    await act(async () => result.current.start('Chapter 5 Review', 1500));
    await settle(result);
    fake.swipeAway('a1');

    await setAppState('active');
    await settle(result);
    expect(fake.calls).toEqual(['start:s1']); // not recreated

    await act(async () => result.current.start('Next chapter', 1500));
    await settle(result);
    expect(fake.calls).toEqual(['start:s1', 'start:s2']);
  });

  it('brings the activity back after Live Activities are turned off and on mid-session', async () => {
    const { result, fake } = await setup();
    await act(async () => result.current.start('Chapter 5 Review', 1500));
    await settle(result);

    // Turned off in Settings: iOS removes the activity.
    fake.setEnabled(false);
    fake.swipeAway('a1');
    await setAppState('active');
    await settle(result);
    expect(result.current.liveActivityStatus).toBe('off');

    // Turned back on: not a swipe-away, so it comes back.
    fake.setEnabled(true);
    await setAppState('active');
    await settle(result);
    expect(fake.calls).toEqual(['start:s1', 'start:s1']);
    expect(fake.activities).toHaveLength(1);
  });

  it('keeps "activity shown" when the user pauses during a slow start', async () => {
    const { result, fake, storage } = await setup();
    const release = fake.holdNextStart();
    await act(async () => result.current.start('Chapter 5 Review', 1500));
    await act(async () => result.current.pause()); // before ActivityKit answers
    await act(async () => release());
    await settle(result);

    const saved = JSON.parse(storage.data.get(SESSION_STORAGE_KEY)!);
    expect(saved).toMatchObject({ activityShown: true });
    expect(saved.pausedAt).not.toBeNull();
    expect(fake.calls).toEqual(['start:s1', 'update:s1:paused']);
  });

  it('replaces an activity iOS ended at its time limit', async () => {
    const { result, fake } = await setup();
    await act(async () => result.current.start('Chapter 5 Review', 1500));
    await settle(result);
    fake.endBySystem('a1');

    await setAppState('active');
    await settle(result);
    expect(fake.calls).toEqual(['start:s1', 'end:a1', 'start:s1']);
    expect(fake.activities.map(a => [a.activityId, a.ended])).toEqual([
      ['a2', false],
    ]);
  });

  describe('relaunch after the app was killed', () => {
    const running: Session = {
      id: 'old',
      name: 'Chapter 5 Review',
      goalSeconds: 1500,
      startDate: T0 - 90_000,
      pausedAt: null,
      activityShown: true,
    };

    it('restores the session and adopts its still-running activity', async () => {
      const { result, fake } = await setup({
        stored: running,
        seed: f =>
          f.seed({
            sessionId: 'old',
            startDate: running.startDate,
            pausedAt: null,
          }),
      });
      expect(result.current.session?.id).toBe('old');
      expect(result.current.elapsed).toBe(90);
      expect(fake.calls).toEqual([]);
      expect(fake.activities).toHaveLength(1);
    });

    it('restores a paused session at its paused time', async () => {
      const paused = { ...running, pausedAt: T0 - 30_000 };
      const { result } = await setup({ stored: paused });
      expect(result.current.paused).toBe(true);
      expect(result.current.elapsed).toBe(60);
    });

    it('does not recreate an activity the user swiped away', async () => {
      const { fake } = await setup({ stored: running });
      expect(fake.calls).toEqual([]);
    });

    it('marks an adopted activity as shown, so a later swipe-away is respected', async () => {
      // Killed between ActivityKit's start and saving activityShown.
      const { result, fake, storage } = await setup({
        stored: { ...running, activityShown: false },
        seed: f =>
          f.seed({
            sessionId: 'old',
            startDate: running.startDate,
            pausedAt: null,
          }),
      });
      expect(fake.calls).toEqual([]);
      expect(JSON.parse(storage.data.get(SESSION_STORAGE_KEY)!)).toMatchObject({
        activityShown: true,
      });

      fake.swipeAway('a1');
      await setAppState('active');
      await settle(result);
      expect(fake.calls).toEqual([]); // not recreated
    });

    it('creates the activity if the session never got one', async () => {
      const { fake } = await setup({
        stored: { ...running, activityShown: false },
      });
      expect(fake.calls).toEqual(['start:old']);
    });

    it('keeps the activity when the app becomes active before the saved session loads', async () => {
      // Control Center, a call banner or Face ID during launch can deliver
      // 'active' while storage is still being read.
      let finishRead: (v: string) => void = () => {};
      const slowStorage: KeyValueStore = {
        getItem: () =>
          new Promise<string>(resolve => {
            finishRead = resolve;
          }),
        setItem: async () => {},
      };
      const fake = createFakeNative();
      fake.seed({
        sessionId: 'old',
        startDate: running.startDate,
        pausedAt: null,
      });
      const activities = createLiveActivityClient(fake.spec, () => {});
      const { result } = await renderHook(() =>
        useStudyTimer({ storage: slowStorage, activities }),
      );

      await setAppState('active'); // before hydration
      await act(async () => finishRead(serializeSession(running)));
      await settle(result);

      expect(result.current.session?.id).toBe('old');
      expect(fake.calls).toEqual([]); // not ended, not recreated
      expect(fake.activities.map(a => a.activityId)).toEqual(['a1']);
    });

    it('ends zombie activities when no session was saved', async () => {
      const { fake } = await setup({
        seed: f =>
          f.seed({ sessionId: 'ghost', startDate: T0, pausedAt: null }),
      });
      expect(fake.calls).toEqual(['end:a1']);
      expect(fake.activities).toHaveLength(0);
    });
  });

  describe('with Live Activities turned off in Settings', () => {
    it('still runs the timer, skips ActivityKit and reports the status', async () => {
      const { result, fake } = await setup({ enabled: false });
      expect(result.current.liveActivityStatus).toBe('off');
      await act(async () => result.current.start('Chapter 5 Review', 1500));
      await advance(2010);
      await settle(result);
      expect(result.current.elapsed).toBe(2);
      expect(fake.calls).toEqual([]);
    });

    it('picks up the setting change when the app returns to the foreground', async () => {
      const { result, fake } = await setup({ enabled: false });
      await act(async () => result.current.start('Chapter 5 Review', 1500));
      await settle(result);

      fake.setEnabled(true);
      await setAppState('active');
      await settle(result);
      expect(result.current.liveActivityStatus).toBe('on');
      expect(fake.calls).toEqual(['start:s1']);
    });
  });
});
