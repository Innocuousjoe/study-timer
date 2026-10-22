#!/usr/bin/env bash
# Runs the Swift unit tests (Live Activity controller + shared model).
# They're host-less, so they don't touch the app installed on your simulator.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SIM=$("$ROOT/scripts/find-simulator.sh")
xcodebuild test -project "$ROOT/ios/StudyTimer.xcodeproj" -scheme StudyTimerTests \
  -destination "id=$SIM" -derivedDataPath "$ROOT/ios/build/dd-tests" 2>&1 \
  | grep -E "error:|Test Case .*(passed|failed)|Executed .* tests|TEST (SUCCEEDED|FAILED)"
