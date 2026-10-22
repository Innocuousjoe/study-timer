#!/usr/bin/env bash
# Checks everything needed to build and run Study Timer. Exits non-zero with
# a fix-it hint for the first missing piece.
set -uo pipefail

fail() { echo "✗ $1"; echo "  → $2"; exit 1; }
ok() { echo "✓ $1"; }

[[ "$(uname)" == "Darwin" ]] || fail "macOS required" "Live Activities need Xcode, which only runs on macOS."

xcodebuild -version >/dev/null 2>&1 || fail "Xcode not found" "Install Xcode from the App Store, then run: sudo xcode-select -s /Applications/Xcode.app"
XCODE_MAJOR=$(xcodebuild -version | head -1 | awk '{print $2}' | cut -d. -f1)
(( XCODE_MAJOR >= 16 )) || fail "Xcode $XCODE_MAJOR is too old" "Install Xcode 16 or newer."
ok "$(xcodebuild -version | head -1)"

command -v node >/dev/null || fail "Node.js not found" "brew install node"
# package.json engines: >= 22.11.0
node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a>22||(a===22&&b>=11)?0:1)' \
  || fail "Node $(node -v) is too old (need >= 22.11)" "brew upgrade node"
ok "Node $(node -v)"

command -v pod >/dev/null || fail "CocoaPods not found" "brew install cocoapods"
ok "CocoaPods $(pod --version)"

SIM=$("$(dirname "$0")/find-simulator.sh" 2>/dev/null) || fail "No simulator with a Dynamic Island" "In Xcode > Settings > Components, install an iOS 17+ runtime, then add an iPhone 15 Pro or newer."
NAME=$(xcrun simctl list devices | grep "$SIM" | sed -E 's/^ *(.*) \([0-9A-F-]{36}\).*/\1/' | head -1)
ok "Dynamic Island simulator available (default: $NAME, $SIM; override with SIMULATOR_UDID=<udid>)"

echo "All set."
