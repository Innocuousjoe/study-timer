import XCTest

/// Fake ActivityKit that suspends inside every call, like the real one does.
/// Those suspension points are what let unserialized calls interleave, so
/// the ordering tests below would fail against a plain actor implementation.
actor FakeActivityClient: ActivityClient {
  nonisolated let areActivitiesEnabled = true
  private(set) var activities: [ActivitySnapshot] = []
  private(set) var log: [String] = []
  private var nextId = 0

  func list() async -> [ActivitySnapshot] {
    await Task.yield()
    return activities
  }

  func request(_ attributes: StudyTimerAttributes, state: StudyTimerAttributes.ContentState) async throws -> String {
    await Task.yield()
    nextId += 1
    let id = "a\(nextId)"
    activities.append(ActivitySnapshot(activityId: id, sessionId: attributes.sessionId, state: state))
    log.append("request:\(attributes.sessionId)")
    return id
  }

  func update(activityId: String, state: StudyTimerAttributes.ContentState) async {
    await Task.yield()
    if let i = activities.firstIndex(where: { $0.activityId == activityId }) {
      activities[i].state = state
      log.append("update:\(activityId)")
    }
  }

  func end(activityId: String) async {
    await Task.yield()
    activities.removeAll { $0.activityId == activityId }
    log.append("end:\(activityId)")
  }

  func seed(sessionId: String) -> String {
    nextId += 1
    let id = "a\(nextId)"
    activities.append(ActivitySnapshot(activityId: id, sessionId: sessionId, state: .init(startDateMs: 0, pausedAtMs: nil)))
    return id
  }
}

private func session(_ id: String, startMs: Double = 1_000_000, pausedMs: Double? = nil) -> SessionInput {
  SessionInput(
    sessionId: id,
    name: "Chapter 5 Review",
    goalSeconds: 1500,
    state: .init(startDateMs: startMs, pausedAtMs: pausedMs)
  )
}

final class LiveActivityControllerTests: XCTestCase {
  func testStartEndsExistingActivitiesFirst() async throws {
    let client = FakeActivityClient()
    let zombie = await client.seed(sessionId: "old")
    let controller = LiveActivityController(client: client)

    let id = try await controller.start(session("new"))

    let activities = await client.activities
    XCTAssertEqual(activities.map(\.activityId), [id])
    let log = await client.log
    XCTAssertEqual(log, ["end:\(zombie)", "request:new"])
  }

  func testUpdateTargetsOnlyTheMatchingSession() async throws {
    let client = FakeActivityClient()
    let controller = LiveActivityController(client: client)
    let id = try await controller.start(session("s1"))

    await controller.update(session("s1", pausedMs: 1_060_000))
    await controller.update(session("other", pausedMs: 5))

    let activities = await client.activities
    XCTAssertEqual(activities.first?.activityId, id)
    XCTAssertEqual(activities.first?.state.pausedAtMs, 1_060_000)
    let log = await client.log
    XCTAssertEqual(log.filter { $0.hasPrefix("update") }, ["update:\(id)"])
  }

  func testUpdateWithNoActivityIsANoOp() async {
    let client = FakeActivityClient()
    let controller = LiveActivityController(client: client)
    await controller.update(session("s1"))
    let activities = await client.activities
    XCTAssertTrue(activities.isEmpty)
  }

  /// Calls submitted without awaiting (as the JS bridge does) still run in
  /// order and never interleave: the burst ends with exactly the last session.
  func testRapidStartStopBurstLeavesExactlyTheFinalState() async throws {
    let client = FakeActivityClient()
    let controller = LiveActivityController(client: client)

    await withTaskGroup(of: Void.self) { group in
      // Each job is submitted in order from this task before any of them run.
      for i in 0..<50 {
        let s = session("s\(i)")
        let start = Task { _ = try? await controller.start(s) }
        let stop = Task { await controller.endAll() }
        group.addTask { _ = await start.result }
        group.addTask { _ = await stop.result }
      }
    }
    // Whatever order the unstructured Tasks reached the queue in, there can
    // never be more than one activity alive.
    let afterBurst = await client.activities
    XCTAssertLessThanOrEqual(afterBurst.count, 1)

    _ = try await controller.start(session("final"))
    let final = await client.activities
    XCTAssertEqual(final.map(\.sessionId), ["final"])
  }

  func testQueueRunsJobsInSubmissionOrderEvenWhenTheySuspend() async {
    let queue = SerialJobQueue()
    let recorder = Recorder()
    let done = expectation(description: "all jobs ran")
    done.expectedFulfillmentCount = 20

    for i in 0..<20 {
      queue.submit {
        await recorder.append("start \(i)")
        // Suspend mid-job; a re-entrant actor would let job i+1 start here.
        for _ in 0..<(20 - i) { await Task.yield() }
        await recorder.append("end \(i)")
        done.fulfill()
      }
    }
    await fulfillment(of: [done], timeout: 5)

    let events = await recorder.events
    let expected = (0..<20).flatMap { ["start \($0)", "end \($0)"] }
    XCTAssertEqual(events, expected)
  }

  func testListReportsTimestampsAsMilliseconds() async throws {
    let client = FakeActivityClient()
    let controller = LiveActivityController(client: client)
    _ = try await controller.start(session("s1", startMs: 1_761_123_456_789, pausedMs: 1_761_123_500_001))

    let snapshots = await controller.list()
    let snapshot = try XCTUnwrap(snapshots.first)
    XCTAssertEqual(snapshot.state.startDateMs, 1_761_123_456_789)
    XCTAssertEqual(snapshot.state.pausedAtMs, 1_761_123_500_001)
  }
}

final class ContentStateTests: XCTestCase {
  func testMillisecondsRoundTripThroughDateAndCodable() throws {
    let state = StudyTimerAttributes.ContentState(startDateMs: 1_761_123_456_789, pausedAtMs: nil)
    let decoded = try JSONDecoder().decode(
      StudyTimerAttributes.ContentState.self,
      from: JSONEncoder().encode(state)
    )
    XCTAssertEqual(decoded.startDateMs, 1_761_123_456_789)
    XCTAssertNil(decoded.pausedAtMs)
    XCTAssertFalse(decoded.isPaused)
  }

  func testElapsedFreezesWhilePaused() {
    let state = StudyTimerAttributes.ContentState(startDateMs: 0, pausedAtMs: 65_000)
    XCTAssertTrue(state.isPaused)
    XCTAssertEqual(state.elapsed(at: Date(timeIntervalSince1970: 500)), 65)
  }

  func testElapsedRunsFromStartAndNeverGoesNegative() {
    let state = StudyTimerAttributes.ContentState(startDateMs: 100_000, pausedAtMs: nil)
    XCTAssertEqual(state.elapsed(at: Date(timeIntervalSince1970: 130)), 30)
    XCTAssertEqual(state.elapsed(at: Date(timeIntervalSince1970: 50)), 0)
  }
}

private actor Recorder {
  var events: [String] = []
  func append(_ e: String) { events.append(e) }
}
