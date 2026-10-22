import type {
  ActivitySessionSpec,
  ActivitySnapshotSpec,
  Spec,
} from '../src/native/NativeLiveActivity';

/**
 * In-memory stand-in for the native module that behaves like ActivityKit:
 * activities have ids, start ends existing ones first (including ones iOS
 * already ended), start rejects when Live Activities are off, and every call
 * is recorded so tests can assert ordering.
 */
export function createFakeNative(
  opts: { enabled?: boolean; log?: string[] } = {},
) {
  let enabled = opts.enabled ?? true;
  let nextId = 0;
  // When set, the next startActivity waits until the test calls release().
  let gate: Promise<void> | null = null;
  let release: () => void = () => {};
  const activities: ActivitySnapshotSpec[] = [];
  const calls: string[] = opts.log ?? [];

  const snapshot = (s: ActivitySessionSpec, activityId: string) => ({
    activityId,
    sessionId: s.sessionId,
    startDate: s.startDate,
    pausedAt: s.pausedAt,
    ended: false,
  });

  const spec: Spec = {
    areActivitiesEnabled: () => enabled,
    startActivity: async s => {
      calls.push(`start:${s.sessionId}`);
      if (gate) {
        const waiting = gate;
        gate = null;
        await waiting;
      }
      activities.splice(0);
      if (!enabled) {
        throw new Error('Live Activities are turned off');
      }
      const id = `a${++nextId}`;
      activities.push(snapshot(s, id));
      return id;
    },
    updateActivity: async s => {
      calls.push(
        `update:${s.sessionId}:${s.pausedAt === null ? 'running' : 'paused'}`,
      );
      activities.forEach((a, i) => {
        if (a.sessionId === s.sessionId && !a.ended) {
          activities[i] = snapshot(s, a.activityId);
        }
      });
    },
    endActivity: async id => {
      calls.push(`end:${id}`);
      const i = activities.findIndex(a => a.activityId === id);
      if (i >= 0) {
        activities.splice(i, 1);
      }
    },
    endAllActivities: async () => {
      calls.push('endAll');
      activities.splice(0);
    },
    listActivities: async () => activities.map(a => ({ ...a })),
  };

  return {
    spec,
    activities,
    calls,
    setEnabled: (v: boolean) => {
      enabled = v;
    },
    /** Simulate an activity left behind by an earlier run or a crash. */
    seed: (a: Omit<ActivitySnapshotSpec, 'activityId' | 'ended'>) => {
      const id = `a${++nextId}`;
      activities.push({ activityId: id, ended: false, ...a });
      return id;
    },
    /** The user swiped it off the Lock Screen: gone from ActivityKit's list. */
    swipeAway: (activityId: string) => {
      const i = activities.findIndex(a => a.activityId === activityId);
      if (i >= 0) {
        activities.splice(i, 1);
      }
    },
    /** Make the next start hang (like a slow ActivityKit request). */
    holdNextStart: () => {
      gate = new Promise<void>(resolve => {
        release = resolve;
      });
      return () => release();
    },
    /** iOS ended it at the ~8 h limit; it lingers on screen as ended. */
    endBySystem: (activityId: string) => {
      const a = activities.find(x => x.activityId === activityId);
      if (a) {
        a.ended = true;
      }
    },
  };
}

export function createMemoryStore(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: async (k: string) => data.get(k) ?? null,
    setItem: async (k: string, v: string) => {
      data.set(k, v);
    },
  };
}
