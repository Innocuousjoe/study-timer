/**
 * Pure timer model. Every function takes `now` (epoch ms) as an argument and
 * nothing here reads the clock, so the whole model is testable without fake
 * timers.
 *
 * Time is stored as timestamps, never as a tick counter:
 * - `startDate` is the *effective* start: the real start shifted forward by all
 *   time spent paused. While running, elapsed = now - startDate.
 * - `pausedAt` is set while paused. While paused, elapsed = pausedAt - startDate.
 *
 * The Live Activity gets the same two timestamps, which lets SwiftUI tick the
 * Lock Screen / Dynamic Island clock by itself with no per-second updates.
 */

export const DEFAULT_GOAL_SECONDS = 25 * 60;
export const GOAL_PRESETS_SECONDS = [25 * 60, 50 * 60, 90 * 60] as const;
export const MAX_NAME_LENGTH = 60;
/** Upper bound for goals (debug links can pass anything). */
export const MAX_GOAL_SECONDS = 24 * 60 * 60;

export type Session = {
  /** Unique per session; also stamped on the Live Activity so we can match it. */
  id: string;
  name: string;
  goalSeconds: number;
  /** Effective start, epoch ms. */
  startDate: number;
  /** Epoch ms when paused, or null while running. */
  pausedAt: number | null;
  /**
   * True once a Live Activity has been created for this session. If it later
   * disappears without iOS ending it, the user swiped it away, and we respect
   * that instead of recreating it.
   */
  activityShown: boolean;
};

export type TimerState = { session: Session | null };

export type TimerAction =
  | {
      type: 'start';
      id: string;
      name: string;
      goalSeconds: number;
      now: number;
    }
  | { type: 'pause'; now: number }
  | { type: 'resume'; now: number }
  | { type: 'stop' }
  | { type: 'restore'; session: Session | null }
  | { type: 'activityShown'; id: string };

export const initialTimerState: TimerState = { session: null };

export function timerReducer(
  state: TimerState,
  action: TimerAction,
): TimerState {
  const { session } = state;
  switch (action.type) {
    case 'start':
      return {
        session: {
          id: action.id,
          name: normalizeName(action.name),
          goalSeconds: clampGoal(action.goalSeconds),
          startDate: action.now,
          pausedAt: null,
          activityShown: false,
        },
      };
    case 'pause':
      if (!session || session.pausedAt !== null) {
        return state;
      }
      return { session: { ...session, pausedAt: action.now } };
    case 'resume': {
      if (!session || session.pausedAt === null) {
        return state;
      }
      // Keep the frozen elapsed time exactly: the new effective start is
      // "now minus what had elapsed". (Shifting startDate by now - pausedAt
      // breaks if the clock was set back while paused.)
      const frozen = session.pausedAt - session.startDate;
      return {
        session: {
          ...session,
          startDate: action.now - frozen,
          pausedAt: null,
        },
      };
    }
    case 'stop':
      return session ? { session: null } : state;
    case 'restore':
      return { session: action.session };
    case 'activityShown':
      if (!session || session.id !== action.id || session.activityShown) {
        return state;
      }
      return { session: { ...session, activityShown: true } };
  }
}

/** Whole seconds elapsed. Never negative, even if the clock moves backwards. */
export function elapsedSeconds(session: Session, now: number): number {
  const end = session.pausedAt ?? now;
  return Math.max(0, Math.floor((end - session.startDate) / 1000));
}

export function isPaused(session: Session): boolean {
  return session.pausedAt !== null;
}

/** 0...1 progress toward the goal. A goal of 0 means "no goal" → 0. */
export function goalProgress(session: Session, now: number): number {
  if (session.goalSeconds <= 0) {
    return 0;
  }
  return Math.min(1, elapsedSeconds(session, now) / session.goalSeconds);
}

export function isGoalReached(session: Session, now: number): boolean {
  return (
    session.goalSeconds > 0 &&
    elapsedSeconds(session, now) >= session.goalSeconds
  );
}

/** HH:MM:SS. Hours grow past two digits rather than wrapping. */
export function formatHMS(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(s / 3600);
  const minutes = Math.floor((s % 3600) / 60);
  const seconds = s % 60;
  return [hours, minutes, seconds]
    .map(n => String(n).padStart(2, '0'))
    .join(':');
}

/** "25 min", "1 h 30 min". */
export function formatGoal(goalSeconds: number): string {
  const totalMinutes = Math.round(goalSeconds / 60);
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  if (h === 0) {
    return `${m} min`;
  }
  return m === 0 ? `${h} h` : `${h} h ${m} min`;
}

/**
 * Time left until the goal, rounded *down* to the whole minute so it never
 * promises more time than remains: 62 m 32 s → "1 hour, 2 min left",
 * 21 m 15 s → "21 min left". Under a minute → "Less than 1 min left".
 */
export function formatTimeLeft(remainingSeconds: number): string {
  const totalMinutes = Math.floor(Math.max(0, remainingSeconds) / 60);
  if (totalMinutes === 0) {
    return 'Less than 1 min left';
  }
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  const hours = h === 1 ? '1 hour' : `${h} hours`;
  if (h === 0) {
    return `${m} min left`;
  }
  return m === 0 ? `${hours} left` : `${hours}, ${m} min left`;
}

function clampGoal(goalSeconds: number): number {
  if (!Number.isFinite(goalSeconds)) {
    return 0;
  }
  return Math.min(MAX_GOAL_SECONDS, Math.max(0, Math.floor(goalSeconds)));
}

export function normalizeName(raw: string): string {
  const collapsed = raw.replace(/\s+/g, ' ').trim();
  const name = collapsed.length > 0 ? collapsed : 'Study Session';
  return Array.from(name).slice(0, MAX_NAME_LENGTH).join('');
}

/** Persisted form. Validates shape so a corrupt store can't crash launch. */
export function serializeSession(session: Session | null): string {
  return JSON.stringify(session);
}

export function deserializeSession(raw: string | null): Session | null {
  if (!raw) {
    return null;
  }
  try {
    const v = JSON.parse(raw);
    const finite = (n: unknown): n is number =>
      typeof n === 'number' && Number.isFinite(n);
    if (
      v &&
      typeof v.id === 'string' &&
      typeof v.name === 'string' &&
      finite(v.goalSeconds) &&
      v.goalSeconds >= 0 &&
      v.goalSeconds <= MAX_GOAL_SECONDS &&
      finite(v.startDate) &&
      (v.pausedAt === null || finite(v.pausedAt))
    ) {
      return {
        id: v.id,
        name: v.name,
        goalSeconds: v.goalSeconds,
        startDate: v.startDate,
        pausedAt: v.pausedAt,
        // Absent in sessions saved before this field existed.
        activityShown: v.activityShown === true,
      };
    }
  } catch {
    // fall through
  }
  return null;
}
