import ActivityKit
import Foundation

enum LiveActivityError: LocalizedError {
  case disabled

  var errorDescription: String? {
    switch self {
    case .disabled: "Live Activities are turned off for Study Timer in Settings."
    }
  }
}

/// The real `ActivityClient`, backed by ActivityKit.
struct ActivityKitClient: ActivityClient {
  private typealias StudyActivity = Activity<StudyTimerAttributes>

  var areActivitiesEnabled: Bool {
    ActivityAuthorizationInfo().areActivitiesEnabled
  }

  func list() async -> [ActivitySnapshot] {
    StudyActivity.activities
      .filter { $0.activityState != .dismissed }
      .map {
        ActivitySnapshot(
          activityId: $0.id,
          sessionId: $0.attributes.sessionId,
          state: $0.content.state,
          isEnded: $0.activityState == .ended
        )
      }
  }

  func request(
    _ attributes: StudyTimerAttributes,
    state: StudyTimerAttributes.ContentState
  ) async throws -> String {
    guard areActivitiesEnabled else { throw LiveActivityError.disabled }
    let activity = try StudyActivity.request(
      attributes: attributes,
      content: content(state, goalSeconds: attributes.goalSeconds),
      pushType: nil
    )
    return activity.id
  }

  func update(activityId: String, state: StudyTimerAttributes.ContentState) async {
    guard let activity = find(activityId) else { return }
    await activity.update(content(state, goalSeconds: activity.attributes.goalSeconds))
  }

  func end(activityId: String) async {
    guard let activity = find(activityId) else { return }
    await activity.end(nil, dismissalPolicy: .immediate)
  }

  /// The clock itself never goes stale (it's computed from timestamps on
  /// device). We use `staleDate` only as a timer: at the goal moment iOS
  /// re-renders the activity with `isStale == true`, which the widget shows
  /// as "Goal reached".
  private func content(
    _ state: StudyTimerAttributes.ContentState,
    goalSeconds: Int
  ) -> ActivityContent<StudyTimerAttributes.ContentState> {
    ActivityContent(state: state, staleDate: state.goalDate(goalSeconds: goalSeconds))
  }

  private func find(_ id: String) -> StudyActivity? {
    StudyActivity.activities.first { $0.id == id }
  }
}
