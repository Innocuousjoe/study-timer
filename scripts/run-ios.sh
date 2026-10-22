#!/usr/bin/env bash
# Builds Study Timer (debug), installs it on a Dynamic Island simulator and
# launches it, starting Metro in the background if it isn't running.
# Usage: scripts/run-ios.sh            (SIMULATOR_UDID=<udid> to pick a device)
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

SIM=$(scripts/find-simulator.sh) || { echo "No Dynamic Island simulator found; run scripts/doctor.sh"; exit 1; }
xcrun simctl boot "$SIM" 2>/dev/null || true   # already booted is fine
echo "Simulator: $SIM"

# Reuse Metro only if it's serving *this* project; another project's Metro on
# 8081 would load the wrong bundle ("StudyTimer has not been registered").
METRO_PID=$(lsof -ti tcp:8081 -sTCP:LISTEN 2>/dev/null | head -1 || true)
if [[ -n "$METRO_PID" ]]; then
  METRO_CWD=$(lsof -a -p "$METRO_PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' || true)
  if [[ "$METRO_CWD" != "$ROOT" ]]; then
    echo "Port 8081 is in use by another process (pid $METRO_PID, cwd ${METRO_CWD:-unknown})."
    echo "Stop it (kill $METRO_PID) and re-run."
    exit 1
  fi
  echo "Reusing Metro (pid $METRO_PID)"
else
  echo "Starting Metro (log: /tmp/study-timer-metro.log)"
  nohup npx react-native start --port 8081 >/tmp/study-timer-metro.log 2>&1 &
fi

echo "Building (log: /tmp/study-timer-build.log)…"
if ! xcodebuild -workspace ios/StudyTimer.xcworkspace -scheme StudyTimer -configuration Debug \
    -destination "id=$SIM" -derivedDataPath ios/build/dd build >/tmp/study-timer-build.log 2>&1; then
  grep -E "error:" /tmp/study-timer-build.log | head -20 || true
  echo "Build failed; full log in /tmp/study-timer-build.log"
  exit 1
fi

xcrun simctl install "$SIM" ios/build/dd/Build/Products/Debug-iphonesimulator/StudyTimer.app
xcrun simctl launch --terminate-running-process "$SIM" com.ncoelius.studytimer "$@"
echo "Launched. View it in Xcode's Device Hub (Xcode 27) or Simulator.app."
