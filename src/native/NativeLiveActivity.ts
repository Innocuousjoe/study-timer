/**
 * TurboModule codegen spec for the ActivityKit bridge.
 *
 * React Native codegen reads this file and generates the Objective-C++
 * protocol `NativeLiveActivitySpec`; `ios/StudyTimer/LiveActivity/
 * RCTLiveActivity.mm` conforms to it and forwards to Swift. If this file and
 * the native side disagree, the iOS build fails.
 *
 * App code should use `liveActivity.ts`, not this module directly.
 */
import type { TurboModule } from 'react-native';
import { TurboModuleRegistry } from 'react-native';

/** Timestamps are epoch milliseconds. */
export type ActivitySessionSpec = {
  sessionId: string;
  name: string;
  goalSeconds: number;
  startDate: number;
  /** Epoch ms when paused; null while running. */
  pausedAt: number | null;
};

export type ActivitySnapshotSpec = {
  activityId: string;
  sessionId: string;
  startDate: number;
  pausedAt: number | null;
};

export interface Spec extends TurboModule {
  /** False when the user turned Live Activities off for this app, or iOS < 16.2. */
  areActivitiesEnabled(): boolean;
  /** Ends every existing activity, then requests a new one. Resolves its id. */
  startActivity(session: ActivitySessionSpec): Promise<string>;
  /** Pushes new state (pause / resume) to the activity for `session.sessionId`. */
  updateActivity(session: ActivitySessionSpec): Promise<void>;
  /** Ends one activity, dismissing it from the Lock Screen immediately. */
  endActivity(activityId: string): Promise<void>;
  /** Ends every activity this app owns. */
  endAllActivities(): Promise<void>;
  /** Active or stale activities, oldest first. */
  listActivities(): Promise<ActivitySnapshotSpec[]>;
}

export default TurboModuleRegistry.get<Spec>('LiveActivity');
