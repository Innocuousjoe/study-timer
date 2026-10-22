/**
 * DEBUG-only deep links that drive the app the same way taps do, so the
 * Live Activity can be exercised end to end from a script:
 *
 *   xcrun simctl openurl booted "studytimer://debug/start?name=Chapter%205&goal=1500"
 *   xcrun simctl openurl booted studytimer://debug/pause   (also: resume, stop, stress)
 *
 * `openurl` makes iOS ask "Open in Study Timer?". To skip the prompt, pass the
 * link as a launch argument instead (relaunches the app):
 *
 *   xcrun simctl launch --terminate-running-process booted com.ncoelius.studytimer \
 *     -debugCommand "studytimer://debug/pause"
 *
 * They are ignored in release builds (see TimerScreen).
 */
export type DebugCommand =
  | { type: 'start'; name: string; goalSeconds: number }
  | { type: 'pause' }
  | { type: 'resume' }
  | { type: 'stop' }
  | { type: 'stress' };

const PREFIX = 'studytimer://debug/';

export function parseDebugLink(url: string | null): DebugCommand | null {
  if (!url || !url.startsWith(PREFIX)) {
    return null;
  }
  const [path, query = ''] = url.slice(PREFIX.length).split('?');
  const params = new Map(
    query
      .split('&')
      .filter(Boolean)
      .map(pair => {
        const [k, v = ''] = pair.split('=');
        return [
          decodeURIComponent(k),
          decodeURIComponent(v.replace(/\+/g, ' ')),
        ];
      }),
  );
  switch (path) {
    case 'start': {
      const goal = Number(params.get('goal') ?? 1500);
      return {
        type: 'start',
        name: params.get('name') ?? '',
        goalSeconds: Number.isFinite(goal) && goal >= 0 ? goal : 1500,
      };
    }
    case 'pause':
    case 'resume':
    case 'stop':
    case 'stress':
      return { type: path };
    default:
      return null;
  }
}
