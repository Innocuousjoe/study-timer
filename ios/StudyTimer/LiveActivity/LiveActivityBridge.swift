import Foundation

/// Objective-C-visible facade over `LiveActivityController`, called by the
/// TurboModule shim (`RCTLiveActivity.mm`). The codegen'd TurboModule protocol
/// is Objective-C++, which Swift can't adopt, hence the thin shim + this class.
///
/// Timestamps cross the bridge as epoch milliseconds (JS `Date.now()`).
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
    Task {
      do {
        completion(try await controller.start(input), nil)
      } catch {
        completion(nil, error as NSError)
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
    Task {
      await controller.update(input)
      completion()
    }
  }

  @objc func end(activityId: String, completion: @escaping @Sendable () -> Void) {
    Task {
      await controller.end(activityId: activityId)
      completion()
    }
  }

  @objc func endAll(completion: @escaping @Sendable () -> Void) {
    Task {
      await controller.endAll()
      completion()
    }
  }

  @objc func list(completion: @escaping @Sendable ([[String: Any]]) -> Void) {
    Task {
      let snapshots = await controller.list()
      completion(snapshots.map { s in
        [
          "activityId": s.activityId,
          "sessionId": s.sessionId,
          "startDate": s.state.startDateMs,
          "pausedAt": s.state.pausedAtMs.map { $0 as Any } ?? NSNull(),
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
      goalSeconds: max(0, Int(goalSeconds)),
      state: .init(startDateMs: startDateMs, pausedAtMs: pausedAtMs?.doubleValue)
    )
  }
}
