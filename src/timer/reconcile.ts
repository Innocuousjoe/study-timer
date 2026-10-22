import type { Session } from './timerModel';

/** What the native side reports for each activity still on screen. */
export type ActivitySnapshot = {
  activityId: string;
  sessionId: string;
  startDate: number;
  pausedAt: number | null;
  /**
   * iOS already ended it (the ~8 h limit) but it can linger on the Lock
   * Screen for up to 4 more hours. Never kept; always cleaned up.
   */
  ended: boolean;
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
 * - Session → keep exactly one live matching activity, updating it if its
 *   state drifted (e.g. app killed between persisting a pause and telling
 *   ActivityKit). Everything else is ended, including activities iOS already
 *   ended at its time limit, which would otherwise linger.
 * - No live match →
 *   - iOS ended ours at the time limit, or we never managed to show one
 *     (Live Activities were off, the request failed): create one.
 *   - We showed one and it's simply gone: the user swiped it away. Respect
 *     that for the rest of the session.
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
  const live = matching.filter(s => !s.ended);
  const keep = live[live.length - 1];
  const actions: ReconcileAction[] = snapshots
    .filter(s => s !== keep)
    .map(s => ({ type: 'end', activityId: s.activityId }));

  if (keep) {
    if (
      !sameInstant(keep.startDate, session.startDate) ||
      !sameInstant(keep.pausedAt, session.pausedAt)
    ) {
      actions.push({ type: 'update', activityId: keep.activityId, session });
    }
  } else {
    const endedBySystem = matching.length > 0;
    if (endedBySystem || !session.activityShown) {
      actions.push({ type: 'create', session });
    }
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
