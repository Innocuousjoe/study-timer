import Foundation

/// What the controller needs from ActivityKit. Abstracted so the controller's
/// ordering and cleanup logic can be unit tested with a fake.
protocol ActivityClient: Sendable {
  var areActivitiesEnabled: Bool { get }
  /// Live (active or stale) activities, oldest first.
  func list() async -> [ActivitySnapshot]
  func request(_ attributes: StudyTimerAttributes, state: StudyTimerAttributes.ContentState) async throws -> String
  func update(activityId: String, state: StudyTimerAttributes.ContentState) async
  func end(activityId: String) async
}

struct ActivitySnapshot: Equatable, Sendable {
  var activityId: String
  var sessionId: String
  var state: StudyTimerAttributes.ContentState
}

struct SessionInput: Equatable, Sendable {
  var sessionId: String
  var name: String
  var goalSeconds: Int
  var state: StudyTimerAttributes.ContentState

  var attributes: StudyTimerAttributes {
    StudyTimerAttributes(sessionId: sessionId, name: name, goalSeconds: goalSeconds)
  }
}

/// Runs submitted jobs one at a time, in submission order.
///
/// An `actor` alone is not enough: actors are re-entrant, so while one call is
/// suspended in `await activity.end(...)`, a second call (say, the next
/// `start`) can run and request a new activity, and the first call's cleanup
/// then misses it or ends the wrong one. Rapid start/stop leaves zombies. A
/// single consumer draining a FIFO stream rules that out.
final class SerialJobQueue: @unchecked Sendable {
  typealias Job = @Sendable () async -> Void
  private let continuation: AsyncStream<Job>.Continuation

  init() {
    let (stream, continuation) = AsyncStream<Job>.makeStream()
    self.continuation = continuation
    Task.detached {
      for await job in stream {
        await job()
      }
    }
  }

  func submit(_ job: @escaping Job) {
    continuation.yield(job)
  }

  /// Submit and await the result.
  func run<T: Sendable>(_ work: @escaping @Sendable () async throws -> T) async throws -> T {
    try await withCheckedThrowingContinuation { cont in
      submit {
        do { cont.resume(returning: try await work()) } catch { cont.resume(throwing: error) }
      }
    }
  }
}

/// All ActivityKit operations for the study timer. Every operation goes
/// through `queue`, so they never interleave.
final class LiveActivityController: Sendable {
  private let client: ActivityClient
  private let queue = SerialJobQueue()

  init(client: ActivityClient) {
    self.client = client
  }

  var areActivitiesEnabled: Bool { client.areActivitiesEnabled }

  /// Ends every existing activity, then requests one for `session`.
  /// "Only ever one activity" is enforced here, not trusted to callers.
  func start(_ session: SessionInput) async throws -> String {
    try await queue.run { [client] in
      for existing in await client.list() {
        await client.end(activityId: existing.activityId)
      }
      return try await client.request(session.attributes, state: session.state)
    }
  }

  /// Pushes new state to this session's activities. No-op if there are none
  /// (e.g. the user swiped it away); the app's reconcile recreates it later.
  func update(_ session: SessionInput) async {
    try? await queue.run { [client] in
      for activity in await client.list() where activity.sessionId == session.sessionId {
        await client.update(activityId: activity.activityId, state: session.state)
      }
    }
  }

  func end(activityId: String) async {
    try? await queue.run { [client] in
      await client.end(activityId: activityId)
    }
  }

  func endAll() async {
    try? await queue.run { [client] in
      for activity in await client.list() {
        await client.end(activityId: activity.activityId)
      }
    }
  }

  func list() async -> [ActivitySnapshot] {
    (try? await queue.run { [client] in await client.list() }) ?? []
  }
}
