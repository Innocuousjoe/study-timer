import {
  deserializeSession,
  elapsedSeconds,
  formatGoal,
  formatTimeLeft,
  formatHMS,
  goalProgress,
  initialTimerState,
  isGoalReached,
  normalizeName,
  serializeSession,
  timerReducer,
  type TimerAction,
  type TimerState,
} from '../src/timer/timerModel';

const T0 = Date.UTC(2026, 9, 22, 9, 0, 0);
const sec = (n: number) => T0 + n * 1000;

function run(...actions: TimerAction[]): TimerState {
  return actions.reduce(timerReducer, initialTimerState);
}

const start = (now = T0, goalSeconds = 25 * 60): TimerAction => ({
  type: 'start',
  id: 's1',
  name: 'Chapter 5 Review',
  goalSeconds,
  now,
});

describe('timerReducer + elapsedSeconds', () => {
  it('counts from the start time', () => {
    const { session } = run(start());
    expect(elapsedSeconds(session!, sec(65))).toBe(65);
  });

  it('floors partial seconds and never goes negative', () => {
    const { session } = run(start());
    expect(elapsedSeconds(session!, sec(1.999))).toBe(1);
    expect(elapsedSeconds(session!, sec(-30))).toBe(0);
  });

  it('freezes while paused', () => {
    const { session } = run(start(), { type: 'pause', now: sec(65) });
    expect(elapsedSeconds(session!, sec(65))).toBe(65);
    expect(elapsedSeconds(session!, sec(500))).toBe(65);
  });

  it('resumes by shifting the effective start by the paused duration', () => {
    const { session } = run(
      start(),
      { type: 'pause', now: sec(65) },
      { type: 'resume', now: sec(100) },
    );
    expect(session!.startDate).toBe(sec(35));
    expect(session!.pausedAt).toBeNull();
    expect(elapsedSeconds(session!, sec(130))).toBe(95);
  });

  it('adds up multiple pause/resume cycles', () => {
    const { session } = run(
      start(),
      { type: 'pause', now: sec(10) }, // 10 s run
      { type: 'resume', now: sec(70) }, // 60 s paused
      { type: 'pause', now: sec(90) }, // 20 s run
      { type: 'resume', now: sec(390) }, // 300 s paused
    );
    expect(elapsedSeconds(session!, sec(400))).toBe(10 + 20 + 10);
  });

  it('treats double pause and double resume as no-ops', () => {
    const paused = run(start(), { type: 'pause', now: sec(10) });
    expect(timerReducer(paused, { type: 'pause', now: sec(50) })).toBe(paused);

    const running = run(start());
    expect(timerReducer(running, { type: 'resume', now: sec(50) })).toBe(
      running,
    );
  });

  it('ignores pause/resume/stop with no session', () => {
    for (const action of [
      { type: 'pause', now: T0 },
      { type: 'resume', now: T0 },
      { type: 'stop' },
    ] as TimerAction[]) {
      expect(timerReducer(initialTimerState, action)).toBe(initialTimerState);
    }
  });

  it('stop clears the session; a new start replaces the old one', () => {
    expect(run(start(), { type: 'stop' }).session).toBeNull();
    const { session } = run(start(), {
      type: 'start',
      id: 's2',
      name: 'Next',
      goalSeconds: 60,
      now: sec(1000),
    });
    expect(session!.id).toBe('s2');
    expect(elapsedSeconds(session!, sec(1001))).toBe(1);
  });

  it('keeps the frozen time when the clock is set back while paused', () => {
    // Paused showing 50 s; the user sets the clock 10 s *before* the pause.
    const { session } = run(
      start(),
      { type: 'pause', now: sec(50) },
      { type: 'resume', now: sec(40) },
    );
    expect(elapsedSeconds(session!, sec(40))).toBe(50); // at the moment of resume
    expect(elapsedSeconds(session!, sec(45))).toBe(55);
  });

  it('keeps the frozen time when the clock jumps far back (before the start)', () => {
    const { session } = run(
      start(),
      { type: 'pause', now: sec(1800) },
      { type: 'resume', now: sec(-1800) },
    );
    expect(elapsedSeconds(session!, sec(-1800))).toBe(1800);
  });

  it('clamps goals to 0...24 h and treats non-finite goals as no goal', () => {
    const goal = (g: number) =>
      run({ type: 'start', id: 's', name: 'x', goalSeconds: g, now: T0 })
        .session!.goalSeconds;
    expect(goal(-5)).toBe(0);
    expect(goal(Infinity)).toBe(0);
    expect(goal(NaN)).toBe(0);
    expect(goal(10 * 24 * 3600)).toBe(24 * 3600);
    expect(goal(1500.7)).toBe(1500);
  });

  it('records that an activity was shown, only for the current session', () => {
    const started = run(start());
    expect(started.session!.activityShown).toBe(false);
    const shown = timerReducer(started, {
      type: 'activityShown',
      id: 's1',
      shown: true,
    });
    expect(shown.session!.activityShown).toBe(true);
    expect(
      timerReducer(started, {
        type: 'activityShown',
        id: 'other',
        shown: true,
      }),
    ).toBe(started);
    expect(
      timerReducer(shown, { type: 'activityShown', id: 's1', shown: true }),
    ).toBe(shown);
  });
});

describe('formatHMS', () => {
  it.each([
    [0, '00:00:00'],
    [59, '00:00:59'],
    [60, '00:01:00'],
    [3599, '00:59:59'],
    [3600, '01:00:00'],
    [5025, '01:23:45'],
    [100 * 3600 + 1, '100:00:01'],
    [-5, '00:00:00'],
    [12.9, '00:00:12'],
  ])('%p → %p', (input, expected) => {
    expect(formatHMS(input)).toBe(expected);
  });
});

describe('goal progress', () => {
  const session = run(start(T0, 100)).session!;

  it.each([
    [0, 0],
    [50, 0.5],
    [100, 1],
    [250, 1],
  ])('at %p s → %p', (s, expected) => {
    expect(goalProgress(session, sec(s))).toBe(expected);
  });

  it('flags goal reached exactly at the goal', () => {
    expect(isGoalReached(session, sec(99))).toBe(false);
    expect(isGoalReached(session, sec(100))).toBe(true);
  });

  it('treats a zero goal as no goal', () => {
    const noGoal = run(start(T0, 0)).session!;
    expect(goalProgress(noGoal, sec(500))).toBe(0);
    expect(isGoalReached(noGoal, sec(500))).toBe(false);
  });

  it('formats goals', () => {
    expect(formatGoal(25 * 60)).toBe('25 min');
    expect(formatGoal(90 * 60)).toBe('1 h 30 min');
    expect(formatGoal(120 * 60)).toBe('2 h');
    expect(formatGoal(30)).toBe('30 s');
  });
});

describe('formatTimeLeft (rounds down to the minute)', () => {
  it.each([
    [62 * 60 + 32, '1 hour, 2 min left'],
    [21 * 60 + 15, '21 min left'],
    [25 * 60, '25 min left'],
    [24 * 60 + 59, '24 min left'],
    [60 * 60, '1 hour left'],
    [60 * 60 + 59, '1 hour left'],
    [2 * 3600 + 5 * 60, '2 hours, 5 min left'],
    [60, '1 min left'],
    [59, 'Less than 1 min left'],
    [0, 'Less than 1 min left'],
    [-10, 'Less than 1 min left'],
  ])('%p s → %p', (secs, expected) => {
    expect(formatTimeLeft(secs)).toBe(expected);
  });
});

describe('normalizeName', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeName('  Chapter \n 5   Review ')).toBe('Chapter 5 Review');
  });
  it('falls back to a default for blank names', () => {
    expect(normalizeName('   ')).toBe('Study Session');
  });
  it('caps length without splitting emoji', () => {
    const name = normalizeName('📚'.repeat(80));
    expect(Array.from(name)).toHaveLength(60);
    expect(name.endsWith('📚')).toBe(true);
  });
});

describe('persistence', () => {
  it('round-trips running and paused sessions', () => {
    const running = run(start()).session;
    const paused = run(start(), { type: 'pause', now: sec(5) }).session;
    expect(deserializeSession(serializeSession(running))).toEqual(running);
    expect(deserializeSession(serializeSession(paused))).toEqual(paused);
    expect(deserializeSession(serializeSession(null))).toBeNull();
  });

  it('defaults activityShown for sessions saved before the field existed', () => {
    const legacy =
      '{"id":"x","name":"n","goalSeconds":60,"startDate":1,"pausedAt":null}';
    expect(deserializeSession(legacy)?.activityShown).toBe(false);
  });

  it.each([
    null,
    '',
    'not json',
    '{"id":1}',
    '[]',
    '{"id":"x","name":"n"}',
    '{"id":"x","name":"n","goalSeconds":1e999,"startDate":1,"pausedAt":null}',
    '{"id":"x","name":"n","goalSeconds":-1,"startDate":1,"pausedAt":null}',
    '{"id":"x","name":"n","goalSeconds":60,"startDate":-1e999,"pausedAt":null}',
    '{"id":"x","name":"n","goalSeconds":60,"startDate":1,"pausedAt":"soon"}',
  ])('rejects corrupt value %p', raw => {
    expect(deserializeSession(raw)).toBeNull();
  });
});

describe('brand gradient mix', () => {
  // Imported here to keep the pure helper tested alongside other formatters.
  const { mix } = require('../src/ui/brand');
  it('interpolates between the two logo colors', () => {
    expect(mix('#F5277F', '#EA7D35', 0)).toBe('#F5277F');
    expect(mix('#F5277F', '#EA7D35', 1)).toBe('#EA7D35');
    expect(mix('#000000', '#FFFFFF', 0.5)).toBe('#808080');
  });
});
