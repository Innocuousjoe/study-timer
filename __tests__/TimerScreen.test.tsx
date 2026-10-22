import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert, StyleSheet } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { createLiveActivityClient } from '../src/native/liveActivity';
import { TimerScreen } from '../src/ui/TimerScreen';
import {
  createFakeNative,
  createMemoryStore,
} from '../test/fakeNativeLiveActivity';

const T0 = Date.UTC(2026, 9, 22, 9, 0, 0);

beforeEach(() => jest.useFakeTimers({ now: T0 }));
afterEach(() => jest.useRealTimers());

async function setup(enabled = true, showDebug = true) {
  const fake = createFakeNative({ enabled });
  const activities = createLiveActivityClient(fake.spec, () => {});
  await render(
    <SafeAreaProvider
      initialMetrics={{
        frame: { x: 0, y: 0, width: 390, height: 844 },
        insets: { top: 47, left: 0, right: 0, bottom: 34 },
      }}
    >
      <TimerScreen
        storage={createMemoryStore()}
        activities={activities}
        showDebug={showDebug}
      />
    </SafeAreaProvider>,
  );
  await act(async () => {});
  return { fake };
}

const advance = (ms: number) =>
  act(async () => {
    jest.advanceTimersByTime(ms);
  });

describe('TimerScreen (as a user)', () => {
  it('runs a full session: start → tick → pause → resume → stop', async () => {
    const { fake } = await setup();

    await fireEvent.changeText(
      screen.getByTestId('session-name-input'),
      'Chapter 5 Review',
    );
    await fireEvent.press(screen.getByTestId('start-button'));
    expect(screen.getByTestId('session-name')).toHaveTextContent(
      'Chapter 5 Review',
    );
    expect(screen.getByTestId('elapsed')).toHaveTextContent('00:00:00');

    await advance(3010);
    expect(screen.getByTestId('elapsed')).toHaveTextContent('00:00:03');
    expect(screen.getByText('24 min left')).toBeOnTheScreen();

    await fireEvent.press(screen.getByText('Pause'));
    await advance(10_000);
    expect(screen.getByText('Paused')).toBeOnTheScreen();
    expect(screen.getByTestId('elapsed')).toHaveTextContent('00:00:03');

    await fireEvent.press(screen.getByText('Resume'));
    await advance(1000);
    expect(screen.getByTestId('elapsed')).toHaveTextContent('00:00:04');

    await fireEvent.press(screen.getByTestId('stop-button'));
    await act(async () => {});
    expect(screen.getByTestId('start-button')).toBeOnTheScreen();
    expect(fake.activities).toHaveLength(0);
  });

  it('grays out the progress bar while paused, keeping Resume in the accent color', async () => {
    await setup();
    await fireEvent.press(screen.getByTestId('start-button'));
    await advance(60_010);
    const fillColor = () =>
      StyleSheet.flatten(screen.getByTestId('goal-fill').props.style)
        .backgroundColor;
    const running = fillColor();

    await fireEvent.press(screen.getByText('Pause'));
    const paused = fillColor();
    expect(paused).not.toBe(running);
    const resume = StyleSheet.flatten(
      screen.getByTestId('pause-resume-button-face').props.style,
    );
    expect(resume.backgroundColor).toBe(running);

    await fireEvent.press(screen.getByText('Resume'));
    expect(fillColor()).toBe(running);
  });

  it('uses a default name when the field is left blank', async () => {
    await setup();
    await fireEvent.press(screen.getByTestId('start-button'));
    expect(screen.getByTestId('session-name')).toHaveTextContent(
      'Study Session',
    );
  });

  it('shows goal reached once the goal passes', async () => {
    await setup();
    await fireEvent.press(screen.getByText('25 min'));
    await fireEvent.press(screen.getByTestId('start-button'));
    await advance(25 * 60 * 1000 + 10);
    expect(screen.getByText('25 min goal')).toBeOnTheScreen();
    expect(screen.getByTestId('status')).toHaveTextContent('Goal reached');
  });

  it('hides the progress bar for "No goal"', async () => {
    await setup();
    await fireEvent.press(screen.getByText('No goal'));
    await fireEvent.press(screen.getByTestId('start-button'));
    expect(screen.queryByText(/left$/)).toBeNull();
  });

  it('warns when Live Activities are turned off', async () => {
    await setup(false);
    expect(screen.getByText(/Live Activities are off/)).toBeOnTheScreen();
  });

  it('"End & Start New" ends the session immediately and returns to the form', async () => {
    const { fake } = await setup();
    await fireEvent.changeText(
      screen.getByTestId('session-name-input'),
      'Chapter 5 Review',
    );
    await fireEvent.press(screen.getByTestId('start-button'));
    await advance(5010);

    const alert = jest.spyOn(Alert, 'alert');
    await fireEvent.press(screen.getByText('Start New Session'));
    const buttons = alert.mock.calls[0][2]!;
    expect(buttons.map(b => b.text)).toEqual(['Keep Going', 'End & Start New']);

    await act(async () => buttons[1].onPress!());
    expect(screen.queryByTestId('stop-button')).toBeNull();
    expect(screen.getByTestId('start-button')).toBeOnTheScreen();
    expect(fake.activities).toHaveLength(0);
  });

  it('"Keep Going" leaves the session running', async () => {
    await setup();
    await fireEvent.press(screen.getByTestId('start-button'));
    const alert = jest.spyOn(Alert, 'alert');
    await fireEvent.press(screen.getByText('Start New Session'));
    // Cancel-style buttons have no handler; nothing changes.
    expect(alert.mock.calls[0][2]![0].onPress).toBeUndefined();
    expect(screen.getByTestId('stop-button')).toBeOnTheScreen();
  });

  it('hides the DEBUG panel unless requested', async () => {
    await setup(true, false);
    expect(screen.queryByTestId('stress-button')).toBeNull();
  });

  it('stress test leaves no activities behind', async () => {
    const { fake } = await setup();
    await fireEvent.press(screen.getByTestId('stress-button'));
    await act(async () => {});
    expect(screen.getByTestId('stress-result')).toHaveTextContent(
      '20 start/stop cycles → 0 activities left',
    );
    expect(fake.calls.filter(c => c.startsWith('start'))).toHaveLength(20);
  });
});
