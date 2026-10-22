import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Linking,
  Pressable,
  ScrollView,
  Settings,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  debugPanelRequested,
  parseDebugLink,
  type DebugCommand,
} from '../debug/debugLinks';
import type { LiveActivityClient } from '../native/liveActivity';
import {
  elapsedSeconds,
  formatGoal,
  formatHMS,
  formatTimeLeft,
} from '../timer/timerModel';
import { useStudyTimer, type KeyValueStore } from '../timer/useStudyTimer';
import { NewSessionForm } from './NewSessionForm';
import { BrandAccentEdge, BrandGradientBar, LedgeButton } from './brand';
import { brand, useTheme, type Theme } from './theme';

type Props = {
  storage: KeyValueStore;
  activities: LiveActivityClient;
  /** DEBUG panel; defaults to the -debugPanel / -debugCommand launch args. */
  showDebug?: boolean;
};

type Completed = { name: string; elapsed: number; goalReached: boolean };

export function TimerScreen({
  storage,
  activities,
  showDebug = debugPanelRequested(),
}: Props) {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const timer = useStudyTimer({ storage, activities });
  const [completed, setCompleted] = useState<Completed | null>(null);
  const [stressResult, setStressResult] = useState<string | null>(null);
  const activityCount = useActivityCount(timer, activities);

  const { session } = timer;

  const stop = () => {
    if (session) {
      // Computed now, not from this render: when called from the "End & Start
      // New" alert, the render is from when the alert opened.
      const elapsed = elapsedSeconds(session, Date.now());
      setCompleted({
        name: session.name,
        elapsed,
        goalReached: session.goalSeconds > 0 && elapsed >= session.goalSeconds,
      });
    }
    timer.stop();
  };

  const startNew = (name: string, goal: number) => {
    setCompleted(null);
    timer.start(name, goal);
  };

  /** DEBUG: 20 rapid start/stop cycles, then count what ActivityKit has left. */
  const runStress = async () => {
    setStressResult('Running…');
    for (let i = 0; i < 20; i++) {
      timer.start(`Stress ${i + 1}`, 60);
      timer.stop();
    }
    setCompleted(null);
    await timer.settled();
    const left = await activities.list();
    setStressResult(`20 start/stop cycles → ${left.length} activities left`);
  };

  const handleDebug = (cmd: DebugCommand) => {
    if (cmd.type === 'start') {
      startNew(cmd.name, cmd.goalSeconds);
    } else if (cmd.type === 'pause') {
      timer.pause();
    } else if (cmd.type === 'resume') {
      timer.resume();
    } else if (cmd.type === 'stop') {
      stop();
    } else {
      runStress();
    }
  };
  useDebugLinks(timer.hydrated, handleDebug);

  // Ends the current session right away (with its completed card), as the
  // button says; the new-session form then shows because nothing is running.
  const askStartNew = () =>
    Alert.alert('Start a new session?', `“${session?.name}” will end.`, [
      { text: 'Keep Going', style: 'cancel' },
      { text: 'End & Start New', style: 'destructive', onPress: stop },
    ]);

  let body: React.ReactNode;
  if (!timer.hydrated) {
    body = <ActivityIndicator style={styles.loading} color={t.muted} />;
  } else if (!session) {
    body = (
      <>
        {completed && <CompletedCard t={t} completed={completed} />}
        <NewSessionForm onStart={startNew} />
      </>
    );
  } else {
    body = (
      <View style={styles.active}>
        <Text
          testID="session-name"
          style={[styles.name, { color: t.text }]}
          numberOfLines={3}
        >
          {session.name}
        </Text>
        <Text
          testID="elapsed"
          style={[styles.clock, { color: timer.paused ? t.muted : t.text }]}
          accessibilityLabel={spokenDuration(timer.elapsed)}
          accessibilityRole="timer"
        >
          {formatHMS(timer.elapsed)}
        </Text>
        <Text
          testID="status"
          style={[
            styles.status,
            {
              color: timer.paused
                ? t.muted
                : timer.goalReached
                ? t.success
                : t.accent,
            },
          ]}
        >
          {/* Same words as the Live Activity's status. */}
          {timer.paused
            ? 'Paused'
            : timer.goalReached
            ? 'Goal reached'
            : 'Focusing'}
        </Text>

        {session.goalSeconds > 0 && (
          <View style={styles.goal}>
            <View style={[styles.track, { backgroundColor: t.track }]}>
              <View
                testID="goal-fill"
                style={[
                  styles.fill,
                  {
                    width: `${timer.progress * 100}%`,
                    // Grayed out while paused, matching the Dynamic Island ring.
                    backgroundColor: timer.paused
                      ? t.muted
                      : timer.goalReached
                      ? t.success
                      : t.accent,
                  },
                ]}
              />
            </View>
            <Text
              style={[
                styles.goalText,
                {
                  color:
                    timer.goalReached && !timer.paused ? t.success : t.muted,
                },
              ]}
            >
              {timer.goalReached
                ? `${formatGoal(session.goalSeconds)} goal`
                : formatTimeLeft(session.goalSeconds - timer.elapsed)}
            </Text>
          </View>
        )}

        <View style={styles.controls}>
          <Button
            t={t}
            testID="pause-resume-button"
            label={timer.paused ? 'Resume' : 'Pause'}
            onPress={timer.paused ? timer.resume : timer.pause}
            variant="primary"
          />
          <Button
            t={t}
            testID="stop-button"
            label="Stop"
            onPress={stop}
            variant="danger"
          />
        </View>

        <View style={[styles.divider, { backgroundColor: t.border }]} />
        <Pressable
          onPress={askStartNew}
          accessibilityRole="button"
          hitSlop={12}
        >
          <Text style={[styles.link, { color: t.accent }]}>
            Start New Session
          </Text>
        </Pressable>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      behavior="padding"
      style={[styles.flex, { backgroundColor: t.background }]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.titleBlock}>
          <Text style={[styles.title, { color: t.text }]}>Study Timer</Text>
          <BrandGradientBar />
        </View>
        {timer.liveActivityStatus === 'off' && (
          <LiveActivitiesOffBanner t={t} />
        )}
        {body}
        {__DEV__ && showDebug && timer.hydrated && (
          <StressTest
            t={t}
            onRun={runStress}
            result={stressResult}
            activityCount={activityCount}
          />
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Button({
  t,
  label,
  onPress,
  variant,
  testID,
}: {
  t: Theme;
  label: string;
  onPress: () => void;
  variant: 'primary' | 'danger';
  testID?: string;
}) {
  return variant === 'primary' ? (
    <LedgeButton
      testID={testID}
      label={label}
      onPress={onPress}
      color={t.accent}
      shade={t.accentShade}
      textColor={t.accentText}
    />
  ) : (
    <LedgeButton
      testID={testID}
      label={label}
      onPress={onPress}
      variant="outlined"
      color={t.danger}
      shade={t.dangerShade}
      textColor={t.danger}
    />
  );
}

function CompletedCard({ t, completed }: { t: Theme; completed: Completed }) {
  return (
    <View
      testID="completed-card"
      style={[
        styles.card,
        { backgroundColor: t.surface, borderColor: t.border },
      ]}
    >
      <BrandAccentEdge />
      <Text style={[styles.cardLabel, { color: t.muted }]}>
        Session complete
      </Text>
      <Text style={[styles.cardName, { color: t.text }]} numberOfLines={2}>
        {completed.name}
      </Text>
      <View style={styles.cardRow}>
        <Text style={[styles.cardTime, { color: t.text }]}>
          {formatHMS(completed.elapsed)}
        </Text>
        {completed.goalReached && (
          <Text
            style={[styles.cardGoal, { color: t.text }]}
            accessibilityLabel="Goal reached"
          >
            <Text style={{ color: brand.gold }}>★</Text> Goal reached
          </Text>
        )}
      </View>
    </View>
  );
}

function LiveActivitiesOffBanner({ t }: { t: Theme }) {
  return (
    <Pressable
      onPress={() => Linking.openSettings()}
      accessibilityRole="button"
      style={[styles.banner, { backgroundColor: t.warningBg }]}
    >
      <Text style={[styles.bannerText, { color: t.warningText }]}>
        Live Activities are off for Study Timer, so the timer won’t show on your
        Lock Screen. Tap to open Settings.
      </Text>
    </Pressable>
  );
}

/** DEBUG only: proves rapid start/stop leaves no zombie activities. */
function StressTest({
  t,
  onRun,
  result,
  activityCount,
}: {
  t: Theme;
  onRun: () => void;
  result: string | null;
  activityCount: number | null;
}) {
  return (
    <View style={[styles.debug, { borderColor: t.border }]}>
      <Text style={[styles.debugLabel, { color: t.muted }]}>
        DEBUG · Live Activities running:{' '}
        <Text testID="activity-count">{activityCount ?? '…'}</Text>
      </Text>
      <Pressable
        testID="stress-button"
        onPress={onRun}
        accessibilityRole="button"
      >
        <Text style={[styles.link, { color: t.accent }]}>
          Run start/stop stress test
        </Text>
      </Pressable>
      {result && (
        <Text
          testID="stress-result"
          style={[styles.debugResult, { color: t.text }]}
        >
          {result}
        </Text>
      )}
    </View>
  );
}

/** DEBUG only: how many Live Activities ActivityKit reports, after each change. */
function useActivityCount(
  timer: ReturnType<typeof useStudyTimer>,
  activities: LiveActivityClient,
) {
  const [count, setCount] = useState<number | null>(null);
  const { session, settled } = timer;
  useEffect(() => {
    if (!__DEV__) {
      return;
    }
    let cancelled = false;
    settled()
      .then(() => activities.list())
      .then(list => !cancelled && setCount(list.length));
    return () => {
      cancelled = true;
    };
  }, [session, settled, activities]);
  return count;
}

/** DEBUG only: handle studytimer://debug/... links (see debugLinks.ts). */
function useDebugLinks(ready: boolean, onCommand: (cmd: DebugCommand) => void) {
  const handler = useRef(onCommand);
  handler.current = onCommand;
  useEffect(() => {
    if (!__DEV__ || !ready) {
      return;
    }
    const handle = (url: string | null | undefined) => {
      const cmd = parseDebugLink(url ?? null);
      if (cmd) {
        handler.current(cmd);
      }
    };
    // simctl can also pass the link as a launch argument, which skips iOS's
    // "Open in Study Timer?" prompt:  simctl launch <id> <bundle> -debugCommand <url>
    try {
      const launchArg = Settings.get('debugCommand');
      if (typeof launchArg === 'string') {
        handle(launchArg);
      }
    } catch {
      // Settings is iOS-only and absent under Jest.
    }
    Linking.getInitialURL().then(handle);
    const sub = Linking.addEventListener('url', e => handle(e.url));
    return () => sub.remove();
  }, [ready]);
}

function spokenDuration(total: number): string {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const parts = [];
  if (h) parts.push(`${h} hour${h === 1 ? '' : 's'}`);
  if (m) parts.push(`${m} minute${m === 1 ? '' : 's'}`);
  parts.push(`${s} second${s === 1 ? '' : 's'}`);
  return parts.join(' ');
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  content: { paddingHorizontal: 24, gap: 16, flexGrow: 1 },
  titleBlock: { gap: 8, marginBottom: 8 },
  title: { fontSize: 32, fontWeight: '800' },
  loading: { marginTop: 80 },
  active: { alignItems: 'center', gap: 12, marginTop: 24 },
  name: { fontSize: 24, fontWeight: '700', textAlign: 'center' },
  clock: {
    fontSize: 64,
    fontWeight: '300',
    fontVariant: ['tabular-nums'],
    letterSpacing: 1,
  },
  status: {
    fontSize: 14,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 1.2,
  },
  goal: { alignSelf: 'stretch', gap: 8, marginTop: 8 },
  track: { height: 8, borderRadius: 4, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: 4 },
  goalText: {
    fontSize: 14,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  controls: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
    alignSelf: 'stretch',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    alignSelf: 'stretch',
    marginVertical: 16,
  },
  link: { fontSize: 17, fontWeight: '600', textAlign: 'center' },
  card: {
    padding: 16,
    paddingLeft: 19, // clears the 3px accent edge
    borderRadius: 14,
    overflow: 'hidden',
    borderWidth: StyleSheet.hairlineWidth,
    gap: 4,
  },
  cardLabel: {
    fontSize: 13,
    fontWeight: '600',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  cardName: { fontSize: 18, fontWeight: '600' },
  cardTime: { fontSize: 28, fontWeight: '300', fontVariant: ['tabular-nums'] },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
  },
  cardGoal: { fontSize: 15, fontWeight: '600' },
  banner: { padding: 14, borderRadius: 12 },
  bannerText: { fontSize: 14, lineHeight: 20 },
  debug: {
    marginTop: 'auto',
    paddingTop: 16,
    borderTopWidth: StyleSheet.hairlineWidth,
    gap: 8,
  },
  debugLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 1 },
  debugResult: { fontSize: 14, textAlign: 'center' },
});
