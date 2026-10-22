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
      .filter { $0.activityState == .active || $0.activityState == .stale }
      .map {
        ActivitySnapshot(
          activityId: $0.id,
          sessionId: $0.attributes.sessionId,
          state: $0.content.state
        )
      }
  }

  func request(
    _ attributes: StudyTimerAttributes,
    state: StudyTimerAttributes.ContentState
  ) async throws -> String {
    guard areActivitiesEnabled else { throw LiveActivityError.disabled }
    // No staleDate: the clock is computed from timestamps on device, so the
    // content never goes out of date while the app is suspended or killed.
    let activity = try StudyActivity.request(
      attributes: attributes,
      content: ActivityContent(state: state, staleDate: nil),
      pushType: nil
    )
    return activity.id
  }

  func update(activityId: String, state: StudyTimerAttributes.ContentState) async {
    guard let activity = find(activityId) else { return }
    await activity.update(ActivityContent(state: state, staleDate: nil))
  }

  func end(activityId: String) async {
    guard let activity = find(activityId) else { return }
    await activity.end(nil, dismissalPolicy: .immediate)
  }

  private func find(_ id: String) -> StudyActivity? {
    StudyActivity.activities.first { $0.id == id }
  }
}
