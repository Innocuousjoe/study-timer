import { reconcile, type ActivitySnapshot } from '../src/timer/reconcile';
import type { Session } from '../src/timer/timerModel';

const session: Session = {
  id: 's1',
  name: 'Chapter 5 Review',
  goalSeconds: 1500,
  startDate: 1_000_000,
  pausedAt: null,
  activityShown: true,
};

const snap = (
  activityId: string,
  over: Partial<ActivitySnapshot> = {},
): ActivitySnapshot => ({
  activityId,
  sessionId: 's1',
  startDate: session.startDate,
  pausedAt: null,
  ended: false,
  ...over,
});

describe('reconcile', () => {
  it('does nothing when nothing is running', () => {
    expect(reconcile(null, [])).toEqual([]);
  });

  it('ends leftover activities when there is no session (zombies)', () => {
    expect(
      reconcile(null, [snap('a'), snap('b', { sessionId: 'old' })]),
    ).toEqual([
      { type: 'end', activityId: 'a' },
      { type: 'end', activityId: 'b' },
    ]);
  });

  it('adopts a matching, in-sync activity without touching it', () => {
    expect(reconcile(session, [snap('a')])).toEqual([]);
  });

  it('records an adopted activity as shown if the session did not know yet', () => {
    const unmarked = { ...session, activityShown: false };
    expect(reconcile(unmarked, [snap('a')])).toEqual([{ type: 'markShown' }]);
  });

  it('tolerates 1 ms of float round-trip error', () => {
    expect(
      reconcile(session, [snap('a', { startDate: session.startDate + 1 })]),
    ).toEqual([]);
  });

  it('respects a swipe-away: shown before, now gone → leave it gone', () => {
    expect(reconcile(session, [])).toEqual([]);
  });

  it('creates the activity if this session never got one (LA was off, request failed)', () => {
    const neverShown = { ...session, activityShown: false };
    expect(reconcile(neverShown, [])).toEqual([
      { type: 'create', session: neverShown },
    ]);
  });

  it('replaces an activity iOS ended at its time limit, ending the lingering one', () => {
    expect(reconcile(session, [snap('a', { ended: true })])).toEqual([
      { type: 'end', activityId: 'a' },
      { type: 'create', session },
    ]);
  });

  it('ends a lingering ended activity alongside the live one it keeps', () => {
    expect(reconcile(session, [snap('a', { ended: true }), snap('b')])).toEqual(
      [{ type: 'end', activityId: 'a' }],
    );
  });

  it('ends ended activities when there is no session', () => {
    expect(reconcile(null, [snap('a', { ended: true })])).toEqual([
      { type: 'end', activityId: 'a' },
    ]);
  });

  it('ends activities from other sessions; does not resurrect a dismissed one', () => {
    expect(reconcile(session, [snap('old', { sessionId: 's0' })])).toEqual([
      { type: 'end', activityId: 'old' },
    ]);
    const neverShown = { ...session, activityShown: false };
    expect(reconcile(neverShown, [snap('old', { sessionId: 's0' })])).toEqual([
      { type: 'end', activityId: 'old' },
      { type: 'create', session: neverShown },
    ]);
  });

  it('keeps the newest of duplicate activities and ends the rest', () => {
    expect(reconcile(session, [snap('a'), snap('b'), snap('c')])).toEqual([
      { type: 'end', activityId: 'a' },
      { type: 'end', activityId: 'b' },
    ]);
  });

  it('updates an activity whose pause state drifted', () => {
    const paused = { ...session, pausedAt: 1_060_000 };
    expect(reconcile(paused, [snap('a')])).toEqual([
      { type: 'update', activityId: 'a', session: paused },
    ]);
  });

  it('updates an activity whose start drifted (resume never reached native)', () => {
    const resumed = { ...session, startDate: session.startDate + 30_000 };
    expect(reconcile(resumed, [snap('a')])).toEqual([
      { type: 'update', activityId: 'a', session: resumed },
    ]);
  });
});
