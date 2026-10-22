import type { Session } from './timerModel';

/** What the native side reports for each live (active or stale) activity. */
export type ActivitySnapshot = {
  activityId: string;
  sessionId: string;
  startDate: number;
  pausedAt: number | null;
};

export type ReconcileAction =
  | { type: 'end'; activityId: string }
  | { type: 'create'; session: Session }
  | { type: 'update'; activityId: string; session: Session };

/**
 * Bring the Live Activities on screen in line with the persisted session,
 * which is the source of truth (it's written before any native call). Runs on
 * launch and on every return to the foreground.
 *
 * - No session → every activity is a zombie and gets ended.
 * - Session → keep exactly one matching activity, updating it if its state
 *   drifted (e.g. app killed between persisting a pause and telling
 *   ActivityKit). If none match (swiped away, hit the system's 8 h limit,
 *   or never created), create one.
 *
 * `snapshots` arrive in ActivityKit order, oldest first, so when duplicates
 * exist we keep the last (newest) one.
 */
export function reconcile(
  session: Session | null,
  snapshots: readonly ActivitySnapshot[],
): ReconcileAction[] {
  if (!session) {
    return snapshots.map(s => ({ type: 'end', activityId: s.activityId }));
  }

  const matching = snapshots.filter(s => s.sessionId === session.id);
  const keep = matching[matching.length - 1];
  const actions: ReconcileAction[] = snapshots
    .filter(s => s !== keep)
    .map(s => ({ type: 'end', activityId: s.activityId }));

  if (!keep) {
    actions.push({ type: 'create', session });
  } else if (
    !sameInstant(keep.startDate, session.startDate) ||
    !sameInstant(keep.pausedAt, session.pausedAt)
  ) {
    actions.push({ type: 'update', activityId: keep.activityId, session });
  }
  return actions;
}

/** Timestamps round-trip through Swift `Date` (a Double of seconds), so allow 1 ms of float error. */
function sameInstant(a: number | null, b: number | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return Math.abs(a - b) <= 1;
}
