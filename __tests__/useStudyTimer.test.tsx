import { act, renderHook } from '@testing-library/react-native';
import { AppState, type AppStateStatus } from 'react-native';
import { createLiveActivityClient } from '../src/native/liveActivity';
import { SESSION_STORAGE_KEY, useStudyTimer } from '../src/timer/useStudyTimer';
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
  } = {},
) {
  const fake = createFakeNative({ enabled: opts.enabled });
  opts.seed?.(fake);
  const storage = createMemoryStore(
    opts.stored ? { [SESSION_STORAGE_KEY]: serializeSession(opts.stored) } : {},
  );
  const activities = createLiveActivityClient(fake.spec, () => {});
  let ids = 0;
  const hook = await renderHook(() =>
    useStudyTimer({ storage, activities, newId: () => `s${++ids}` }),
  );
  await settle(hook.result);
  return { fake, storage, ...hook };
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
    const { result, storage } = await setup();
    await act(async () => result.current.start('Chapter 5 Review', 1500));
    await advance(5000);
    await act(async () => result.current.pause());
    await settle(result);
    const saved = JSON.parse(storage.data.get(SESSION_STORAGE_KEY)!);
    expect(saved).toMatchObject({ id: 's1', pausedAt: T0 + 5000 });
  });

  describe('relaunch after the app was killed', () => {
    const running: Session = {
      id: 'old',
      name: 'Chapter 5 Review',
      goalSeconds: 1500,
      startDate: T0 - 90_000,
      pausedAt: null,
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

    it('recreates the activity if it was swiped away', async () => {
      const { fake } = await setup({ stored: running });
      expect(fake.calls).toEqual(['start:old']);
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
