# Study Timer

A React Native iOS study timer with a **Live Activity** on the Lock Screen and in the **Dynamic Island**. The React Native app runs the timer. A native TurboModule mirrors its state to ActivityKit, and a SwiftUI widget extension renders it.

- Start a named session with an optional goal (25 / 50 / 90 min, or none). The timer counts up as `HH:MM:SS`, and you can pause, resume and stop it.
- The Live Activity appears on start, keeps time while the app is backgrounded or killed, reflects pause and resume, and disappears on stop.
- The Dynamic Island has compact (name + time), expanded (full name, time, progress ring) and minimal (time) views.

## Requirements

- macOS with **Xcode 16+**. Built and tested with Xcode 27.
- **Node 22.11 or newer** and **CocoaPods**: `brew install node cocoapods`
- An **iOS 17+ simulator with a Dynamic Island**: iPhone 15 Pro or newer, not an "e" model.

## Setup and run

From the repo root:

```sh
scripts/doctor.sh                 # checks Xcode, Node, CocoaPods and a suitable simulator
npm ci                            # JS dependencies
(cd ios && pod install)           # native dependencies; also runs React Native codegen (ignore its "yarn ios" hint)
scripts/run-ios.sh                # boots a simulator, starts Metro, builds, installs, launches
```

`run-ios.sh` picks a booted Dynamic Island simulator if there is one, otherwise the newest available. To choose one, set `SIMULATOR_UDID=<udid> scripts/run-ios.sh`; `xcrun simctl list devices available` lists the UDIDs. Build output goes to `/tmp/study-timer-build.log` and Metro's to `/tmp/study-timer-metro.log`.

Metro keeps running in the background after the script exits. Stop it with `kill $(lsof -ti tcp:8081 -sTCP:LISTEN)`. If port 8081 is taken by another project's Metro, the script says so and exits instead of loading the wrong bundle.

To see the simulator, use Xcode's **Device Hub** (Xcode 27) or **Simulator.app** (earlier Xcodes). The Lock Screen and Dynamic Island only show there; `simctl` screenshots don't capture them.

You can also open `ios/StudyTimer.xcworkspace` in Xcode and press Run with the **StudyTimer** scheme. No signing team is needed for the simulator.

## Tests

```sh
npm test            # Jest: timer model, reconcile logic, bridge queue, hook, screen
npm run test:ios    # XCTest: Swift Live Activity controller and shared model (SIMULATOR_UDID=<udid> to choose a simulator)
npm run typecheck && npm run lint
```

- The JS tests pass `now` into the timer logic instead of reading the clock, so most of them need no fake timers.
- The hook tests use Jest fake timers to show the display doesn't drift: they jump the wall clock 10 minutes "in the background" without firing any intervals.
- The Swift tests use a fake ActivityKit that suspends inside every call. That's what exposes interleaving bugs: with the serial queue removed, the burst test leaves 8 zombie activities.

## Demo walkthrough

1. Type a session name, keep the 25 min goal and tap **Start Session**.
2. Go to the Home Screen. The compact Dynamic Island shows the name and a ticking time. Long-press it for the expanded view.
3. Lock the simulator (the lock button in Xcode's Device Hub, or **Device > Lock** in Simulator.app). The first time, iOS asks **"Allow Live Activities from Study Timer?"**; tap **Allow**. The Lock Screen shows the name, the time and the goal progress bar.
4. Back in the app, tap **Pause**. The activity freezes and shows "Paused". In the expanded Dynamic Island the ring turns gray. **Resume** continues from the same time.
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
- **Typed bridge.** `src/native/NativeLiveActivity.ts` is the TurboModule spec. Codegen generates the Objective-C++ protocol, and `RCTLiveActivity.mm` (a thin shim, needed because Swift can't adopt C++-typed protocols) forwards to Swift. If a method or argument in the spec doesn't match the native side, the build fails. The objects that promises resolve with aren't type-checked, so the JS side normalizes them (`liveActivity.ts`).
- **No zombie activities.** Calls are serialized in JS (a promise queue) and in Swift (a single-consumer job queue that each bridge method submits to synchronously, before returning). A plain actor isn't enough, because actors are re-entrant across `await`. Neither is a `Task` per call, since Tasks can start out of order. `start` always ends existing activities first, including ones iOS has already ended.
- **Crash recovery.** Every change is written to AsyncStorage before ActivityKit is told. On launch and on every return to the foreground, `reconcile()` compares the saved session with the activities on screen. It ends strays, fixes an activity whose state drifted, and replaces one iOS ended at its time limit. If saving fails, ActivityKit is still told.
- **Goal reached without the app.** While running, each update's `staleDate` is set to the moment the goal is reached (`ContentState.goalDate`). iOS re-renders the activity at that moment, and the widget turns it green with "Goal reached". Staleness isn't used for anything else.
- **One source for the activity's data.** `ios/Shared/StudyTimerAttributes.swift` is compiled into both the app and the widget, so the two can't define it differently.

Key files: `src/timer/timerModel.ts`, `src/timer/reconcile.ts`, `src/timer/useStudyTimer.ts`, `src/native/`, `ios/StudyTimer/LiveActivity/`, `ios/StudyTimerWidget/StudyTimerLiveActivity.swift`.

`scripts/configure-xcode-project.rb` is the idempotent script that added the widget and test targets with the `xcodeproj` gem. The result is checked in, so you don't need to run it.

## Design touches

The app's own colors are a purple accent and a green for goals. It borrows a few touches from BoldVoice's site, taken from boldvoice.com's CSS tokens and logo (`src/ui/theme.ts` → `brand`):

- **App icon.** The pink-to-orange logo gradient, `#F5277F` → `#EA7D35`. A thin bar of the same gradient sits under the title.
- **Buttons.** Pill-shaped, with the solid offset "ledge" they press down into, like BoldVoice's `.button`.
- **Session summary card.** The 3px burnt-orange (`#D45530`) left edge from their blog blockquotes, plus a gold (`#FFB800`) star when the goal was reached.

## Debug automation

Debug builds accept commands as a launch argument, so the real app can be driven from scripts with no taps:

```sh
xcrun simctl launch --terminate-running-process booted com.ncoelius.studytimer \
  -debugCommand "studytimer://debug/start?name=Chapter%205&goal=1500"   # or: pause, resume, stop, stress
```

If more than one simulator is booted, replace `booted` with the UDID. The same URLs work with `xcrun simctl openurl`, but iOS then asks "Open in Study Timer?".

To show the DEBUG panel, launch with `-debugPanel YES`; any `-debugCommand` also shows it. The panel shows how many Live Activities ActivityKit reports and runs a 20-cycle start/stop stress test. The expected result is "0 activities left". The panel is hidden otherwise. In release builds all of this is switched off by `__DEV__` checks. It's still in the bundle, but it never runs.

## Assumptions

- **Goal and progress.** The spec asks for a progress ring but not what it measures. It measures progress toward an optional goal (25 / 50 / 90 min, default 25). Past the goal the ring stays full and the app shows "Goal reached". With no goal, the island shows a plain ring and the app hides the bar.
- **Time format on the Live Activity.** The app always shows `HH:MM:SS`. The Live Activity uses the system's self-updating timer, which formats as `M:SS` under an hour and `H:MM:SS` above. No system format produces a ticking `HH:MM:SS`; I checked `Text(timerInterval:)` and iOS 18's `SystemFormatStyle.Timer`. The paused text uses the same format, so the clock doesn't change shape when you pause.
- **Dimmed Lock Screen.** In Always-On / reduced-luminance mode, iOS stops ticking seconds and would show `7:--`. The Lock Screen switches to a minute-precision system format ("7 minutes") in that state. During a session's first minute this reads "0 minutes". No system format says "under a minute", and the widget can't switch text over time while the screen is dimmed, so "0 minutes" is the accurate option.
- **"Time left" rounds down.** The label under the in-app progress bar shows time left rounded down to the minute ("1 hour, 2 min left" with 1 h 2 m 32 s remaining, and "Less than 1 min left" under a minute). It therefore lags the `HH:MM:SS` clock by up to 59 seconds. Rounding down avoids promising time that isn't there, and other apps seem to do the same. Even so, we'd test it with real users to see whether the mismatch is noticeable or bothersome.
- **App killed.** The Live Activity persists with the correct time, since it ticks itself. The spec allows either ending it or keeping it. On relaunch the app restores the session and reattaches.
- **One session at a time.** "Start New Session" during a session asks for confirmation. "End & Start New" then ends the current session right away, showing its summary, and opens the new-session form.
- **Swiping the Live Activity away.** If the user dismisses it from the Lock Screen, it stays dismissed for the rest of that session. The next session shows a new one. If Live Activities were off when the session started and are turned on later, the activity appears the next time the app comes to the foreground.
- **Activity lifetime.** iOS ends a Live Activity after about 8 hours, but it can linger on the Lock Screen for hours. The next time the app comes to the foreground, it dismisses the lingering one and starts a fresh one. Stop always clears both.
- **Goal reached on the Live Activity.** It flips to "Goal reached" at the goal time while running, through `staleDate` (see How it works). iOS won't mark an activity stale sooner than about 2 minutes after its last update. I saw this in the system log: a 1-minute goal flipped at 2 minutes, and a 3-minute goal flipped on time. So the 25 / 50 / 90 min goals flip on time. Resuming with less than 2 minutes to the goal makes the flip land up to about 2 minutes late. When an update arrives after the goal has already passed (resuming after the goal, a replacement activity), the widget also compares against the current time, so it shows "Goal reached" straight away. A paused activity always reads "Paused", in gray, and the app does the same.
- **Clock changes.** All times are epoch milliseconds, so time zone changes have no effect. If the user sets the clock back while paused, resuming keeps the paused time exactly. While running, the elapsed time follows the wall clock.
- **Platform.** iOS 17.0+ only, tested on the simulator as the spec allows. Running on a device needs a signing team set in Xcode for the StudyTimer and StudyTimerWidget targets.

## What the AI got wrong

I built this with Claude Code. Below is where it was wrong, how each problem was caught, and what changed. Most of these only showed up when the app was used for real (on the simulator, by eye, or from system logs) or when a separate review agent went looking for them. Passing tests didn't reveal any of them.

### Platform assumptions that didn't hold
- **"The Lock Screen timer always ticks seconds."** When the screen dims, iOS shows a self-updating timer as `7:--`. I spotted it on the simulator. The AI switched the dimmed state to a minute-precision system format ("7 minutes"). That reads "0 minutes" in the first minute, which I flagged. No system format says "under a minute", and the widget can't change its text over time while dimmed, so I chose to keep "0 minutes" as the accurate option.
- **"iOS 18's timer format can force `HH:MM:SS`."** It can't: even with `showsHours: true` it shows `M:SS` under an hour. The AI found this by formatting sample times in a throwaway Swift script, not by guessing. I'd agreed in advance that `M:SS` was an acceptable fallback.
- **"A Live Activity can't show 'Goal reached' without the app or a push server."** The AI said so first. I pushed back, and it found the `staleDate` approach: iOS redraws the activity at a set time with no app involvement. I asked that our code call it `goalDate`, so it doesn't overload "stale".
- **"`staleDate` fires exactly on time."** My first test with a 1-minute goal looked broken: the activity never flipped while I watched. The system log showed iOS won't mark an activity stale until about 2 minutes after its last update. A 3-minute goal flipped exactly on time, so real goals are fine. A second review then caught the same delay hiding "Goal reached" after late updates, such as resuming past the goal. The widget now also checks the current time when it renders.
- **"Simulator screenshots show the Dynamic Island and Lock Screen."** They don't, from `simctl` or from Xcode's Device Hub. Every Live Activity check needed my eyes, so the AI added debug launch commands to set up each state for me to look at.

### Layout
- **The expanded island clipped content twice.** First the "d" in "Paused" was cut off in the side region, then the pause glyph in the bottom row. The island's rounded top corners clip anything placed high. I designed the final layout: a glyph centered in the ring and the status word under it, at fixed sizes so the ring never moves. Grayed out while paused was also my call.
- **"0 of 1 min" under a 40%-full bar.** The label rounded down to whole minutes, so it contradicted the bar. The AI noticed this in a screenshot and proposed "time left". I chose rounding down to the minute, and noted in Assumptions that this should be tested with real users.
- **Light mode:** after the goal, the app's status still said "Focusing" while the Live Activity said "Goal reached". Fixing that put "Goal reached" on screen twice. The AI caught both in its light-mode screenshots.

### Concurrency and lifecycle bugs (caught by review agents, then pinned with tests)
- **A Swift `actor` wasn't enough to prevent zombie activities.** Actors are re-entrant across `await`, so the AI used a serial job queue. The first review then found that each bridge call still went through its own `Task`, and Tasks can start out of order. With the per-call Task temporarily put back, a 50-call burst ended with *no* activity right after the user started one. Jobs are now queued synchronously, before each bridge method returns.
- **Launch race:** an "app became active" event while the saved session was still loading ended the restored session's Live Activity.
- **Clock set back while paused:** resuming reset the elapsed time to 0. The AI's own test for this checked the wrong moment, so it could never fail.
- **Activities iOS ended at the 8-hour limit were invisible to the app.** They stayed ticking on the Lock Screen after Stop.
- **Swipe-away:** the app recreated an activity the user had dismissed. Fixing that caused a regression the second review found: turning Live Activities off and back on mid-session also counted as a dismissal, so the activity never came back.
- **"End & Start New" didn't end anything.** It only opened the form, despite the button's wording; I chose to make it end the session immediately. The second review then found the summary card showed the time from when the alert opened, not when you confirmed.
- **Weak tests:** the "save before telling ActivityKit" test only checked the final state, so it would pass in either order. The fake ActivityKit answered instantly, so it hid timing bugs. Each fix now has a test, and for the critical ones the AI removed the fix to confirm the test fails.

### Tooling and setup
- Xcode 27 rejects the AsyncStorage pod's iOS 13 deployment target; fixed in the Podfile.
- The template's Xcode group has no folder path, so the AI's first script put the new files in the wrong directory.
- The generated Swift header needs a React Native header imported first.
- `simctl openurl` triggers an "Open in Study Timer?" prompt that a script can't tap, so debug commands moved to launch arguments.
- **"React Native has no built-in gradient."** The AI first built the title's gradient bar from 24 solid-color slices. When I questioned it, it checked the installed React Native and found that 0.88 supports CSS `linear-gradient(...)` through the `backgroundImage` style. The bar is now a single view, stretched to the title's width.
- The generated app icon came out solid black twice. The AI caught this by looking at the PNG before using it.
- `run-ios.sh` would have refused its own Metro under `/tmp`, because macOS resolves `/tmp` to `/private/tmp`. A separate agent following only the README in a fresh clone caught this. It also found several places where the README made you guess.
- Splitting the work into commits that each build on their own needed rebuilt lockfiles. `pod install` rewrote two of them in a clean checkout, so the first and second commits were fixed to use the lockfiles they generate themselves.

### Decisions I made along the way
- **Foundation:** bare React Native with a TurboModule, not Expo.
- **Progress ring:** measures progress toward an optional goal.
- **App killed:** the activity persists, and the app reattaches on relaunch.
- **Goal reached:** the timer doesn't stop at the goal. A goal notification and activity types went under Future work instead, to stay within the spec.
- **DEBUG panel:** hidden unless requested.

## Future work

**Goal-reached notification.** The timer deliberately doesn't stop at the goal, since someone may want to keep going. A local notification at the goal moment would still tell them, even if the phone is in a pocket. "Local" means iOS schedules it on the device, with no server.

- **Why a notification.** The Live Activity's own alert (ActivityKit's `AlertConfiguration`) only fires when an update is sent at that moment, which needs the app awake or a push server. A scheduled local notification fires on time with the app suspended or killed. It also isn't subject to the ~2 minute minimum that applies to the stale flip.
- **Native.** Three TurboModule methods, using `UNUserNotificationCenter` with one fixed identifier, so a new schedule replaces the old one and at most one is pending:
  - `requestNotificationPermission()`
  - `scheduleGoalNotification(name, fireDateMs)`
  - `cancelGoalNotification()`
- **JS.** The notification would follow the timer alongside the Live Activity, through the same serial chain:
  - Start or resume with the goal still ahead: schedule it for the goal moment.
  - Pause, stop or a new session: cancel it.
  - Launch: re-schedule from the saved session.

  Because resume re-schedules from the shifted start, pauses are accounted for.
- **Permission.** Ask the first time a session with a goal starts, when the value is obvious. If the user declines, nothing else changes.
- **Content.** "Goal reached 🎉" / "Chapter 5 Review: 25 min. Keep going, or stop when you're ready." Tapping it opens the app. A Stop action on the notification is possible, but it needs native handling while JS isn't running, so it's a follow-up.

**Activity types (UI improvement).** The compact Dynamic Island has room for only a few characters of the session name, so long names end in "…". The spec asks for the truncated name there, so the app does that for now. Proposed alternative:

- **Pick an activity when starting a session.** Starter set: Focusing, Studying, Reviewing, Meditating. Each has its own color and icon. None of the colors is green or gray, so "Goal reached" and "Paused" stay distinct.
- **The color carries through the timer.** It would apply to the ring, the progress bar, the compact and minimal time, and the in-app timer screen. You'd tell at a glance what kind of session is running.
- **The compact view shows the activity instead of a truncated name.** For example, "Studying" plus the time. SwiftUI's `ViewThatFits` could keep the full name when it fits and fall back to the activity only when it wouldn't, which never shows "…" and stays closest to the spec. The status word under the expanded ring would show the activity ("Studying") rather than the generic "Focusing".
- **Plumbing.** The activity would be one more field on the session and one more fixed attribute on the Live Activity, like the name. A blank session name would default to the activity.


**Session history.** Today a finished session shows a "Session complete" card, which disappears with the next session. A history screen would keep every finished session:

- **List.** Previous sessions, newest first, grouped by day. Each row shows the name, focused time, goal (and whether it was reached), the activity type if that feature exists, and when it started. Daily and weekly totals go at the top.
- **Notes.** Attach a note or comment to a session, e.g. "finished problems 1–12; struggled with stereochemistry". You can add it straight from the "Session complete" card, or later from the session's detail view. You can also edit or delete a session.
- **Data model.** On Stop or "End & Start New", append a `CompletedSession` to storage. Its fields: id, name, `startedAt`, `endedAt`, focused seconds, total paused seconds, goal seconds, goal reached, activity type, note.
  - The live session stores an *effective* `startDate`, shifted forward by time spent paused, so the real start time would need its own `startedAt` field. Paused time would be tracked as pauses happen.
  - The completed card already computes the focused time at the moment you stop, so that's the natural place to write the record.
- **Storage.** AsyncStorage is fine for a few hundred sessions. Beyond that, or for totals and search, SQLite is the better fit. Records stay on the device, with optional iCloud sync later.
- **Natural follow-ons.** Streaks, a per-activity breakdown, and starting a new session from a past one ("repeat Chapter 5 Review, 50 min").
