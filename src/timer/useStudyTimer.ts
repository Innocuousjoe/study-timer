import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import type { LiveActivityClient } from '../native/liveActivity';
import { reconcile } from './reconcile';
import {
  deserializeSession,
  elapsedSeconds,
  goalProgress,
  initialTimerState,
  isGoalReached,
  serializeSession,
  timerReducer,
  type Session,
  type TimerAction,
  type TimerState,
} from './timerModel';

export const SESSION_STORAGE_KEY = 'studyTimer.session.v1';

export type KeyValueStore = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
};

export type StudyTimerDeps = {
  storage: KeyValueStore;
  activities: LiveActivityClient;
  /** Injected for tests; defaults to Date.now. */
  clock?: () => number;
  newId?: () => string;
};

export type LiveActivityStatus = 'on' | 'off' | 'unavailable';

const defaultId = () =>
  `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/**
 * Owns the timer: reducer state, the display clock, persistence and Live
 * Activity sync.
 *
 * Ordering matters for crash safety. Each change is applied to React state,
 * then on one serial chain: written to storage, then sent to ActivityKit. If
 * the app dies in between, the next launch's reconcile repairs the activity
 * from storage.
 */
export function useStudyTimer({
  storage,
  activities,
  clock = Date.now,
  newId = defaultId,
}: StudyTimerDeps) {
  const [state, setState] = useState<TimerState>(initialTimerState);
  const stateRef = useRef(state);
  const [now, setNow] = useState(clock);
  const [hydrated, setHydrated] = useState(false);
  const hydratedRef = useRef(false);
  const [laStatus, setLaStatus] = useState<LiveActivityStatus>(() =>
    readStatus(activities),
  );
  const chain = useRef<Promise<void>>(Promise.resolve());

  const serially = useCallback((step: () => Promise<void>) => {
    chain.current = chain.current.then(step).catch(error => {
      console.warn('[StudyTimer] background step failed', error);
    });
    return chain.current;
  }, []);

  const persist = useCallback(
    async (session: Session | null) => {
      try {
        await storage.setItem(SESSION_STORAGE_KEY, serializeSession(session));
      } catch (error) {
        // Keep going: the activity must still follow the user's action. The
        // next launch reconciles against whatever was last saved.
        console.warn('[StudyTimer] could not save session', error);
      }
    },
    [storage],
  );

  /** Record whether this session currently has a Live Activity on screen. */
  const setActivityShown = useCallback(
    async (id: string, shown: boolean) => {
      const prev = stateRef.current;
      const next = timerReducer(prev, { type: 'activityShown', id, shown });
      if (next !== prev) {
        stateRef.current = next;
        setState(next);
        await persist(next.session);
      }
    },
    [persist],
  );

  /** Start an activity; once it exists, remember that for this session. */
  const startActivity = useCallback(
    async (session: Session) => {
      if (await activities.start(session)) {
        await setActivityShown(session.id, true);
      }
    },
    [activities, setActivityShown],
  );

  const reconcileActivities = useCallback(
    () =>
      serially(async () => {
        const enabled = activities.areEnabled();
        let session = stateRef.current.session;
        if (session?.activityShown && !enabled) {
          // Live Activities were turned off mid-session and iOS removed the
          // activity. That's not a swipe-away, so bring it back once they're
          // turned on again.
          await setActivityShown(session.id, false);
          session = stateRef.current.session;
        }
        const actions = reconcile(session, await activities.list());
        for (const action of actions) {
          if (action.type === 'end') {
            activities.end(action.activityId);
          } else if (action.type === 'update') {
            activities.update(action.session);
          } else if (action.type === 'markShown') {
            if (session) {
              await setActivityShown(session.id, true);
            }
          } else if (enabled) {
            await startActivity(action.session);
          }
        }
        await activities.idle();
      }),
    [activities, serially, setActivityShown, startActivity],
  );

  // Hydrate from storage once, then repair any Live Activity drift.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      let restored: Session | null = null;
      try {
        restored = deserializeSession(
          await storage.getItem(SESSION_STORAGE_KEY),
        );
      } catch (error) {
        console.warn('[StudyTimer] could not read saved session', error);
      }
      if (cancelled) {
        return;
      }
      const next = timerReducer(stateRef.current, {
        type: 'restore',
        session: restored,
      });
      stateRef.current = next;
      setState(next);
      setNow(clock());
      hydratedRef.current = true;
      setHydrated(true);
      await reconcileActivities();
    })();
    return () => {
      cancelled = true;
    };
    // Run once on mount; deps are stable for the lifetime of the screen.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Coming back to the foreground: the JS clock was suspended, so recompute
  // from timestamps, re-check Settings, and repair the activity. Before
  // hydration finishes there is no session in memory yet, and reconciling
  // then would end the restored session's activity; hydration reconciles
  // on its own when it's done.
  useEffect(() => {
    const sub = AppState.addEventListener('change', appState => {
      if (appState === 'active') {
        setNow(clock());
        setLaStatus(readStatus(activities));
        if (hydratedRef.current) {
          reconcileActivities();
        }
      }
    });
    return () => sub.remove();
  }, [activities, clock, reconcileActivities]);

  // Display tick, aligned to the session's whole-second boundaries so the
  // clock never skips or repeats a second because of timer jitter.
  const session = state.session;
  const running = session !== null && session.pausedAt === null;
  const startDate = session?.startDate;
  useEffect(() => {
    if (!running || startDate === undefined) {
      return;
    }
    let handle: ReturnType<typeof setTimeout>;
    const schedule = () => {
      const t = clock();
      const intoSecond = (((t - startDate) % 1000) + 1000) % 1000;
      handle = setTimeout(() => {
        setNow(clock());
        schedule();
      }, 1000 - intoSecond + 5);
    };
    setNow(clock());
    schedule();
    return () => clearTimeout(handle);
  }, [running, startDate, clock]);

  const apply = useCallback(
    (action: TimerAction) => {
      const prev = stateRef.current;
      const next = timerReducer(prev, action);
      if (next === prev) {
        return;
      }
      stateRef.current = next;
      setState(next);
      setNow(clock());

      const before = prev.session;
      const after = next.session;
      serially(async () => {
        // Save the latest state, not `after`: an earlier step may have
        // updated it since (e.g. marking the activity shown), and writing
        // the older copy would lose that.
        await persist(stateRef.current.session);
        if (!after) {
          activities.endAll();
        } else if (after.id !== before?.id) {
          if (activities.areEnabled()) {
            await startActivity(after);
          } else if (before) {
            activities.endAll();
          }
        } else {
          activities.update(after);
        }
      });
    },
    [activities, clock, persist, serially, startActivity],
  );

  const start = useCallback(
    (name: string, goalSeconds: number) =>
      apply({ type: 'start', id: newId(), name, goalSeconds, now: clock() }),
    [apply, clock, newId],
  );
  const pause = useCallback(
    () => apply({ type: 'pause', now: clock() }),
    [apply, clock],
  );
  const resume = useCallback(
    () => apply({ type: 'resume', now: clock() }),
    [apply, clock],
  );
  const stop = useCallback(() => apply({ type: 'stop' }), [apply]);

  const settled = useCallback(
    () => chain.current.then(() => activities.idle()),
    [activities],
  );

  return {
    hydrated,
    session,
    elapsed: session ? elapsedSeconds(session, now) : 0,
    progress: session ? goalProgress(session, now) : 0,
    goalReached: session ? isGoalReached(session, now) : false,
    paused: session !== null && session.pausedAt !== null,
    liveActivityStatus: laStatus,
    start,
    pause,
    resume,
    stop,
    /** Resolves when pending storage + native work has finished (tests, debug). */
    settled,
  };
}

function readStatus(activities: LiveActivityClient): LiveActivityStatus {
  if (!activities.isAvailable()) {
    return 'unavailable';
  }
  return activities.areEnabled() ? 'on' : 'off';
}
