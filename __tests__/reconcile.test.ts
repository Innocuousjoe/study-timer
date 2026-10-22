import { reconcile, type ActivitySnapshot } from '../src/timer/reconcile';
import type { Session } from '../src/timer/timerModel';

const session: Session = {
  id: 's1',
  name: 'Chapter 5 Review',
  goalSeconds: 1500,
  startDate: 1_000_000,
  pausedAt: null,
};

const snap = (
  activityId: string,
  over: Partial<ActivitySnapshot> = {},
): ActivitySnapshot => ({
  activityId,
  sessionId: 's1',
  startDate: session.startDate,
  pausedAt: null,
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

  it('tolerates 1 ms of float round-trip error', () => {
    expect(
      reconcile(session, [snap('a', { startDate: session.startDate + 1 })]),
    ).toEqual([]);
  });

  it('recreates the activity when it is missing (swiped away / 8 h limit)', () => {
    expect(reconcile(session, [])).toEqual([{ type: 'create', session }]);
  });

  it('ends activities from other sessions and creates one for this session', () => {
    expect(reconcile(session, [snap('old', { sessionId: 's0' })])).toEqual([
      { type: 'end', activityId: 'old' },
      { type: 'create', session },
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
