import Foundation

/// Objective-C-visible facade over `LiveActivityController`, called by the
/// TurboModule shim (`RCTLiveActivity.mm`). The codegen'd TurboModule protocol
/// is Objective-C++, which Swift can't adopt, hence the thin shim + this class.
///
/// Timestamps cross the bridge as epoch milliseconds (JS `Date.now()`).
/// Each method hands its job to the controller synchronously (no `Task`
/// hop), so jobs reach the serial queue in the order JS called them.
@objc(LiveActivityBridge)
final class LiveActivityBridge: NSObject {
  @objc static let shared = LiveActivityBridge()

  private let controller = LiveActivityController(client: ActivityKitClient())

  @objc func areActivitiesEnabled() -> Bool {
    controller.areActivitiesEnabled
  }

  @objc func start(
    sessionId: String,
    name: String,
    goalSeconds: Double,
    startDateMs: Double,
    pausedAtMs: NSNumber?,
    completion: @escaping @Sendable (String?, NSError?) -> Void
  ) {
    let input = Self.input(sessionId, name, goalSeconds, startDateMs, pausedAtMs)
    controller.start(input) { result in
      switch result {
      case .success(let id): completion(id, nil)
      case .failure(let error): completion(nil, error as NSError)
      }
    }
  }

  @objc func update(
    sessionId: String,
    name: String,
    goalSeconds: Double,
    startDateMs: Double,
    pausedAtMs: NSNumber?,
    completion: @escaping @Sendable () -> Void
  ) {
    let input = Self.input(sessionId, name, goalSeconds, startDateMs, pausedAtMs)
    controller.update(input, completion: completion)
  }

  @objc func end(activityId: String, completion: @escaping @Sendable () -> Void) {
    controller.end(activityId: activityId, completion: completion)
  }

  @objc func endAll(completion: @escaping @Sendable () -> Void) {
    controller.endAll(completion: completion)
  }

  @objc func list(completion: @escaping @Sendable ([[String: Any]]) -> Void) {
    controller.list { snapshots in
      completion(snapshots.map { s in
        [
          "activityId": s.activityId,
          "sessionId": s.sessionId,
          "startDate": s.state.startDateMs,
          "pausedAt": s.state.pausedAtMs.map { $0 as Any } ?? NSNull(),
          "ended": s.isEnded,
        ]
      })
    }
  }

  private static func input(
    _ sessionId: String,
    _ name: String,
    _ goalSeconds: Double,
    _ startDateMs: Double,
    _ pausedAtMs: NSNumber?
  ) -> SessionInput {
    SessionInput(
      sessionId: sessionId,
      name: name,
      // Clamped: a corrupt value must not trap in Int(_:).
      goalSeconds: goalSeconds.isFinite ? Int(min(max(goalSeconds, 0), 86_400)) : 0,
      state: .init(startDateMs: startDateMs, pausedAtMs: pausedAtMs?.doubleValue)
    )
  }
}
