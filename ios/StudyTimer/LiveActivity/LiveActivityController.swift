import Foundation

/// What the controller needs from ActivityKit. Abstracted so the controller's
/// ordering and cleanup logic can be unit tested with a fake.
protocol ActivityClient: Sendable {
  var areActivitiesEnabled: Bool { get }
  /// Every activity still on screen (anything not dismissed), oldest first.
  func list() async -> [ActivitySnapshot]
  func request(_ attributes: StudyTimerAttributes, state: StudyTimerAttributes.ContentState) async throws -> String
  func update(activityId: String, state: StudyTimerAttributes.ContentState) async
  func end(activityId: String) async
}

struct ActivitySnapshot: Equatable, Sendable {
  var activityId: String
  var sessionId: String
  var state: StudyTimerAttributes.ContentState
  /// iOS already ended it (the ~8 h limit); it can linger on the Lock Screen
  /// for hours until we dismiss it.
  var isEnded = false
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
}

/// All ActivityKit operations for the study timer. Every operation is
/// submitted to `queue` synchronously, before the method returns, so jobs run
/// in exactly the order callers made them, even when callers don't await
/// (the TurboModule's methods return immediately).
final class LiveActivityController: Sendable {
  private let client: ActivityClient
  private let queue = SerialJobQueue()

  init(client: ActivityClient) {
    self.client = client
  }

  var areActivitiesEnabled: Bool { client.areActivitiesEnabled }

  /// Ends every existing activity (including ones iOS already ended), then
  /// requests one for `session`. "Only ever one activity" is enforced here,
  /// not trusted to callers.
  func start(_ session: SessionInput, completion: @escaping @Sendable (Result<String, Error>) -> Void) {
    queue.submit { [client] in
      for existing in await client.list() {
        await client.end(activityId: existing.activityId)
      }
      do {
        completion(.success(try await client.request(session.attributes, state: session.state)))
      } catch {
        completion(.failure(error))
      }
    }
  }

  /// Pushes new state to this session's live activities. No-op if there are
  /// none (e.g. the user swiped it away).
  func update(_ session: SessionInput, completion: @escaping @Sendable () -> Void) {
    queue.submit { [client] in
      for activity in await client.list() where activity.sessionId == session.sessionId && !activity.isEnded {
        await client.update(activityId: activity.activityId, state: session.state)
      }
      completion()
    }
  }

  func end(activityId: String, completion: @escaping @Sendable () -> Void) {
    queue.submit { [client] in
      await client.end(activityId: activityId)
      completion()
    }
  }

  func endAll(completion: @escaping @Sendable () -> Void) {
    queue.submit { [client] in
      for activity in await client.list() {
        await client.end(activityId: activity.activityId)
      }
      completion()
    }
  }

  func list(completion: @escaping @Sendable ([ActivitySnapshot]) -> Void) {
    queue.submit { [client] in
      completion(await client.list())
    }
  }
}

/// Async conveniences (tests). Each one submits its job when called.
extension LiveActivityController {
  func start(_ session: SessionInput) async throws -> String {
    try await withCheckedThrowingContinuation { cont in start(session) { cont.resume(with: $0) } }
  }

  func update(_ session: SessionInput) async {
    await withCheckedContinuation { cont in update(session) { cont.resume() } }
  }

  func end(activityId: String) async {
    await withCheckedContinuation { cont in end(activityId: activityId) { cont.resume() } }
  }

  func endAll() async {
    await withCheckedContinuation { cont in endAll { cont.resume() } }
  }

  func list() async -> [ActivitySnapshot] {
    await withCheckedContinuation { cont in list { cont.resume(returning: $0) } }
  }
}
