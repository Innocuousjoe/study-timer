import type {
  ActivitySessionSpec,
  ActivitySnapshotSpec,
  Spec,
} from '../src/native/NativeLiveActivity';

/**
 * In-memory stand-in for the native module that behaves like ActivityKit:
 * activities have ids, start ends existing ones first, and every call is
 * recorded so tests can assert ordering.
 */
export function createFakeNative(opts: { enabled?: boolean } = {}) {
  let enabled = opts.enabled ?? true;
  let nextId = 0;
  const activities: ActivitySnapshotSpec[] = [];
  const calls: string[] = [];

  const snapshot = (s: ActivitySessionSpec, activityId: string) => ({
    activityId,
    sessionId: s.sessionId,
    startDate: s.startDate,
    pausedAt: s.pausedAt,
  });

  const spec: Spec = {
    areActivitiesEnabled: () => enabled,
    startActivity: async s => {
      calls.push(`start:${s.sessionId}`);
      activities.splice(0);
      const id = `a${++nextId}`;
      activities.push(snapshot(s, id));
      return id;
    },
    updateActivity: async s => {
      calls.push(
        `update:${s.sessionId}:${s.pausedAt === null ? 'running' : 'paused'}`,
      );
      const i = activities.findIndex(a => a.sessionId === s.sessionId);
      if (i >= 0) {
        activities[i] = snapshot(s, activities[i].activityId);
      }
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
    seed: (a: Omit<ActivitySnapshotSpec, 'activityId'>) => {
      const id = `a${++nextId}`;
      activities.push({ activityId: id, ...a });
      return id;
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
