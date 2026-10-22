# Study Timer

A React Native iOS study timer with a **Live Activity** on the Lock Screen and in the **Dynamic Island**. The React Native app runs the timer. A native TurboModule mirrors its state to ActivityKit, and a SwiftUI widget extension renders it.

- Start a named session with an optional goal (25 / 50 / 90 min, or none). The timer counts up as `HH:MM:SS`, and you can pause, resume and stop it.
- The Live Activity appears on start, keeps time while the app is backgrounded or killed, reflects pause and resume, and disappears on stop.
- The Dynamic Island has compact (name + time), expanded (full name, time, progress ring) and minimal (time) views.

## Requirements

- macOS with **Xcode 16+**. Built and tested with Xcode 27.
- **Node 22.11+** and **CocoaPods**: `brew install node cocoapods`
- An **iOS 17+ simulator with a Dynamic Island**: iPhone 15 Pro or newer, not an "e" model.

## Setup and run

From the repo root:

```sh
scripts/doctor.sh                 # checks Xcode, Node, CocoaPods and a suitable simulator
npm ci                            # JS dependencies
(cd ios && pod install)           # native dependencies; also runs React Native codegen
scripts/run-ios.sh                # boots a simulator, starts Metro, builds, installs, launches
```

`run-ios.sh` picks a booted Dynamic Island simulator if there is one, otherwise the newest available. To choose one, set `SIMULATOR_UDID=<udid> scripts/run-ios.sh`; `xcrun simctl list devices available` lists the UDIDs. Build output goes to `/tmp/study-timer-build.log` and Metro's to `/tmp/study-timer-metro.log`.

To see the simulator, use Xcode's **Device Hub** (Xcode 27) or **Simulator.app** (earlier Xcodes). The Lock Screen and Dynamic Island only show there; `simctl` screenshots don't capture them.

You can also open `ios/StudyTimer.xcworkspace` in Xcode and press Run with the **StudyTimer** scheme. No signing team is needed for the simulator.

## Tests

```sh
npm test            # Jest: timer model, reconcile logic, bridge queue, hook, screen
npm run test:ios    # XCTest: Swift Live Activity controller and shared model
npm run typecheck && npm run lint
```

- The JS tests pass `now` into the timer logic instead of reading the clock, so most of them need no fake timers.
- The hook tests use Jest fake timers to show the display doesn't drift: they jump the wall clock 10 minutes "in the background" without firing any intervals.
- The Swift tests use a fake ActivityKit that suspends inside every call. That's what exposes interleaving bugs: with the serial queue removed, the burst test leaves 8 zombie activities.

## Demo walkthrough

1. Type a session name, keep the 25 min goal and tap **Start Session**.
2. Go to the Home Screen. The compact Dynamic Island shows the name and a ticking time. Long-press it for the expanded view.
3. Lock the simulator (the lock button in Xcode's Device Hub, or **Device > Lock** in Simulator.app). The first time, iOS asks **"Allow Live Activities from Study Timer?"**; tap **Allow**. The Lock Screen shows the name, the time and the goal progress bar.
4. Back in the app, tap **Pause**. The activity freezes and shows "Paused", with the ring grayed out. **Resume** continues from the same time.
5. Kill the app from the app switcher. The Live Activity keeps counting. Relaunch, and the app restores the session and reattaches to the same activity.
6. Tap **Stop**. The Live Activity is dismissed immediately.

## How it works

```
React Native (TypeScript)                       iOS (Swift)
──────────────────────────                      ───────────────────────────────────
TimerScreen ── useStudyTimer ── liveActivity ──▶ RCTLiveActivity.mm (TurboModule)
                │  (reducer,      (FIFO queue)        │
                │   AsyncStorage,                     ▼
                │   reconcile)                  LiveActivityBridge ─▶ LiveActivityController
                ▼                                                      (serial job queue)
         timerModel.ts                                                       │
         (pure, timestamp-based)                                             ▼
                                                                         ActivityKit
                                                                             │
                                              StudyTimerWidget (SwiftUI) ◀───┘
                                              Lock Screen + Dynamic Island
```

- **Timestamps, not ticks.** A session stores an effective `startDate` (the real start shifted forward by time spent paused) and `pausedAt`. The app derives the display from these, and the Live Activity receives the same two values.
- **The Live Activity ticks itself.** The widget uses `Text(timerInterval:)` and `ProgressView(timerInterval:)`, which iOS animates with no updates from the app. The app sends an ActivityKit update only on start, pause, resume and stop. So the Lock Screen stays accurate while the app is suspended or killed, and the app never runs into ActivityKit's update throttling.
- **Typed bridge.** `src/native/NativeLiveActivity.ts` is the TurboModule spec. Codegen generates the Objective-C++ protocol, and `RCTLiveActivity.mm` (a thin shim, needed because Swift can't adopt C++-typed protocols) forwards to Swift. If the spec and the native side disagree, the build fails.
- **No zombie activities.** Calls are serialized in JS (a promise queue) and in Swift (a single-consumer job queue; a plain actor isn't enough because actors are re-entrant across `await`). `start` always ends existing activities first.
- **Crash recovery.** Every change is written to AsyncStorage before ActivityKit is told. On launch and on every return to the foreground, `reconcile()` compares the saved session with the live activities: it ends strays, recreates a missing activity, and fixes one whose state drifted.
- **One source for the activity's data.** `ios/Shared/StudyTimerAttributes.swift` is compiled into both the app and the widget, so the two can't define it differently.

Key files: `src/timer/timerModel.ts`, `src/timer/reconcile.ts`, `src/timer/useStudyTimer.ts`, `src/native/`, `ios/StudyTimer/LiveActivity/`, `ios/StudyTimerWidget/StudyTimerLiveActivity.swift`.

`scripts/configure-xcode-project.rb` is the idempotent script that added the widget and test targets with the `xcodeproj` gem. The result is checked in, so you don't need to run it.

## Debug automation

Debug builds accept commands as a launch argument, so the real app can be driven from scripts with no taps:

```sh
xcrun simctl launch --terminate-running-process booted com.ncoelius.studytimer \
  -debugCommand "studytimer://debug/start?name=Chapter%205&goal=1500"   # or: pause, resume, stop, stress
```

The same URLs work with `xcrun simctl openurl`, but iOS then asks "Open in Study Timer?". A DEBUG panel at the bottom of the screen shows how many Live Activities ActivityKit reports and runs a 20-cycle start/stop stress test. The expected result is "0 activities left". None of this is compiled into release builds.

## Assumptions

- **Goal and progress.** The spec asks for a progress ring but not what it measures. It measures progress toward an optional goal (25 / 50 / 90 min, default 25). Past the goal the ring stays full and the app shows "Goal reached". With no goal, the island shows a plain ring and the app hides the bar.
- **Time format on the Live Activity.** The app always shows `HH:MM:SS`. The Live Activity uses the system's self-updating timer, which formats as `M:SS` under an hour and `H:MM:SS` above. No system format produces a ticking `HH:MM:SS`; I checked `Text(timerInterval:)` and iOS 18's `SystemFormatStyle.Timer`. The paused text uses the same format, so the clock doesn't change shape when you pause.
- **Dimmed Lock Screen.** In Always-On / reduced-luminance mode, iOS stops ticking seconds and would show `7:--`. The Lock Screen switches to a minute-precision system format ("7 minutes") in that state.
- **"Time left" rounds down.** The label under the in-app progress bar shows time left rounded down to the minute ("1 hour, 2 min left" with 1 h 2 m 32 s remaining, and "Less than 1 min left" under a minute). It therefore lags the `HH:MM:SS` clock by up to 59 seconds. Rounding down avoids promising time that isn't there, and other apps seem to do the same. Even so, we'd test it with real users to see whether the mismatch is noticeable or bothersome.
- **App killed.** The Live Activity persists with the correct time, since it ticks itself. The spec allows either ending it or keeping it. On relaunch the app restores the session and reattaches.
- **One session at a time.** "Start New Session" during a session asks for confirmation, then ends the current one.
- **Activity lifetime.** iOS ends a Live Activity after about 8 hours. If a session runs longer, the app recreates the activity the next time it comes to the foreground.
- **Platform.** iOS 17.0+ only, tested on the simulator as the spec allows. Running on a device needs a signing team set in Xcode for the StudyTimer and StudyTimerWidget targets.
