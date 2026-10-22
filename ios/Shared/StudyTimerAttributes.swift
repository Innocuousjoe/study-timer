import ActivityKit
import Foundation

/// The one definition of the Live Activity's data, compiled into both the app
/// and the widget extension (and the unit tests). ActivityKit matches app and
/// widget by this type, so keeping a single file avoids the classic bug of two
/// copies drifting apart and the activity silently never rendering.
struct StudyTimerAttributes: ActivityAttributes {
  /// Dynamic state. Timestamps rather than an elapsed counter, so SwiftUI can
  /// tick the clock on its own (`Text(timerInterval:)`) with no updates.
  struct ContentState: Codable, Hashable {
    /// Effective start: real start shifted forward by all time spent paused.
    var startDate: Date
    /// Set while paused; nil while running.
    var pausedAt: Date?

    var isPaused: Bool { pausedAt != nil }

    func elapsed(at now: Date) -> TimeInterval {
      max(0, (pausedAt ?? now).timeIntervalSince(startDate))
    }

    /// When a running session reaches its goal; nil while paused or with no
    /// goal. Passed to ActivityKit as the content's `staleDate`, so iOS
    /// re-renders the activity at that moment (see `goalReached` in the
    /// widget) without the app having to be awake. Not used for staleness.
    func goalDate(goalSeconds: Int) -> Date? {
      guard goalSeconds > 0, pausedAt == nil else { return nil }
      return startDate.addingTimeInterval(TimeInterval(goalSeconds))
    }
  }

  /// Matches the JS session id, so the app can find "its" activity on relaunch.
  var sessionId: String
  var name: String
  /// 0 means no goal.
  var goalSeconds: Int

  var hasGoal: Bool { goalSeconds > 0 }
}

extension StudyTimerAttributes.ContentState {
  /// JS sends epoch milliseconds.
  init(startDateMs: Double, pausedAtMs: Double?) {
    self.init(
      startDate: Date(timeIntervalSince1970: startDateMs / 1000),
      pausedAt: pausedAtMs.map { Date(timeIntervalSince1970: $0 / 1000) }
    )
  }

  var startDateMs: Double { (startDate.timeIntervalSince1970 * 1000).rounded() }
  var pausedAtMs: Double? { pausedAt.map { ($0.timeIntervalSince1970 * 1000).rounded() } }
}
