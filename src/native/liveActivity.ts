/**
 * Typed wrapper over the native Live Activity module.
 *
 * Every call goes through one FIFO queue, so rapid taps (start, stop, start,
 * stop...) reach ActivityKit strictly in order and one at a time. The Swift
 * side is an actor too; the two together are what keeps zombie activities
 * from appearing.
 *
 * Failures are logged and swallowed: the timer must keep working even if the
 * Live Activity can't be shown (turned off in Settings, unsupported OS, etc).
 */
import type { Session } from '../timer/timerModel';
import type { ActivitySnapshot } from '../timer/reconcile';
import NativeLiveActivity, {
  type ActivitySessionSpec,
  type Spec,
} from './NativeLiveActivity';

export type LiveActivityClient = {
  isAvailable(): boolean;
  areEnabled(): boolean;
  start(session: Session): Promise<string | null>;
  update(session: Session): Promise<void>;
  end(activityId: string): Promise<void>;
  endAll(): Promise<void>;
  list(): Promise<ActivitySnapshot[]>;
  /** Resolves once everything queued so far has finished. */
  idle(): Promise<void>;
};

function toSpec(session: Session): ActivitySessionSpec {
  return {
    sessionId: session.id,
    name: session.name,
    goalSeconds: session.goalSeconds,
    startDate: session.startDate,
    pausedAt: session.pausedAt,
  };
}

export function createLiveActivityClient(
  native: Spec | null,
  log: (message: string, error: unknown) => void = (m, e) =>
    console.warn(`[LiveActivity] ${m}`, e),
): LiveActivityClient {
  let tail: Promise<unknown> = Promise.resolve();

  function enqueue<T>(label: string, fallback: T, op: (n: Spec) => Promise<T>) {
    const run = async (): Promise<T> => {
      if (!native) {
        return fallback;
      }
      try {
        return await op(native);
      } catch (error) {
        log(`${label} failed`, error);
        return fallback;
      }
    };
    const result = tail.then(run, run);
    tail = result;
    return result;
  }

  return {
    isAvailable: () => native !== null,
    areEnabled: () => {
      try {
        return native?.areActivitiesEnabled() ?? false;
      } catch {
        return false;
      }
    },
    start: session =>
      enqueue<string | null>('start', null, n =>
        n.startActivity(toSpec(session)),
      ),
    update: session =>
      enqueue('update', undefined, n => n.updateActivity(toSpec(session))),
    end: activityId =>
      enqueue('end', undefined, n => n.endActivity(activityId)),
    endAll: () => enqueue('endAll', undefined, n => n.endAllActivities()),
    list: () =>
      enqueue<ActivitySnapshot[]>('list', [], async n =>
        (await n.listActivities()).map(s => ({ ...s })),
      ),
    idle: () => enqueue('idle', undefined, async () => undefined),
  };
}

export const liveActivity = createLiveActivityClient(
  NativeLiveActivity ?? null,
);
