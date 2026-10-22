#!/usr/bin/env bash
# Prints the UDID of an available iPhone simulator with a Dynamic Island
# (iPhone 15 Pro or newer, non-"e" models). Prefers one that's already booted.
# Override with SIMULATOR_UDID=<udid>. With --any, accepts any iOS 17+ iPhone
# (enough for the host-less unit tests).
set -euo pipefail
if [[ -n "${SIMULATOR_UDID:-}" ]]; then echo "$SIMULATOR_UDID"; exit 0; fi
MODE="${1:-}"
xcrun simctl list devices available -j | MODE="$MODE" node -e '
  const devices = Object.entries(JSON.parse(require("fs").readFileSync(0, "utf8")).devices)
    .filter(([runtime]) => /iOS-(1[7-9]|[2-9][0-9])/.test(runtime))
    .flatMap(([, list]) => list)
    .filter(d => process.env.MODE === "--any"
      ? /^iPhone/.test(d.name)
      : /^iPhone (1[5-9]|[2-9][0-9]) Pro/.test(d.name));
  const pick = devices.find(d => d.state === "Booted") ?? devices.at(-1);
  if (!pick) process.exit(1);
  console.log(pick.udid);
'
