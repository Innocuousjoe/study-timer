import ActivityKit
import SwiftUI
import WidgetKit

private let accent = Color(red: 0.49, green: 0.55, blue: 1.0)
private let goalGreen = Color(red: 0.40, green: 0.73, blue: 0.42)

/// Whether the goal has been reached, as of this render.
/// - Paused: from the frozen elapsed time.
/// - Running: the app sets the content's `staleDate` to the goal moment
///   (`ContentState.goalDate`), so iOS re-renders with `isStale == true`
///   exactly then, with no app involvement. This is the only place that
///   reads `isStale`; we don't use staleness for anything else.
private func goalReached(_ context: ActivityViewContext<StudyTimerAttributes>) -> Bool {
  let goal = context.attributes.goalSeconds
  guard goal > 0 else { return false }
  if let pausedAt = context.state.pausedAt {
    return context.state.elapsed(at: pausedAt) >= TimeInterval(goal)
  }
  return context.isStale
}

struct StudyTimerLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: StudyTimerAttributes.self) { context in
      LockScreenView(attributes: context.attributes, state: context.state, goalReached: goalReached(context))
        .activityBackgroundTint(Color.black.opacity(0.75))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      let attributes = context.attributes
      let state = context.state
      let reached = goalReached(context)
      return DynamicIsland {
        // Leading/trailing sit beside the camera, where the island's rounded
        // top corners clip anything placed high; keep them vertically centered
        // and put text rows in the bottom region.
        DynamicIslandExpandedRegion(.leading) {
          RingWithStatus(attributes: attributes, state: state, goalReached: reached)
            .padding(.leading, 6)
            .frame(maxHeight: .infinity)
        }
        DynamicIslandExpandedRegion(.trailing) {
          ClockText(state: state)
            .font(.system(size: 30, weight: .light, design: .rounded))
            .foregroundStyle(state.isPaused ? .secondary : .primary)
            .frame(maxWidth: 120, maxHeight: .infinity, alignment: .trailing)
            .padding(.trailing, 6)
        }
        DynamicIslandExpandedRegion(.center) {
          VStack(spacing: 2) {
            // The spec asks for the full name here; names are capped at 60
            // characters, which fits in three lines at this size.
            Text(attributes.name)
              .font(.headline)
              .lineLimit(3)
              .minimumScaleFactor(0.85)
              .multilineTextAlignment(.center)
            if attributes.hasGoal {
              Text("Goal \(formatGoal(attributes.goalSeconds))")
                .font(.caption)
                .foregroundStyle(.secondary)
            }
          }
          .frame(maxHeight: .infinity)
        }
      } compactLeading: {
        HStack(spacing: 4) {
          Image(systemName: state.isPaused ? "pause.fill" : "book.fill")
            .foregroundStyle(accent)
            .accessibilityHidden(true)
          Text(attributes.name)
            .lineLimit(1)
            .truncationMode(.tail)
            .frame(maxWidth: 64, alignment: .leading)
        }
        .font(.caption)
      } compactTrailing: {
        ClockText(state: state)
          .font(.caption.weight(.semibold))
          .foregroundStyle(state.isPaused ? .secondary : accent)
          .frame(maxWidth: 52, alignment: .trailing)
      } minimal: {
        ClockText(state: state)
          .font(.system(size: 10, weight: .semibold))
          .minimumScaleFactor(0.6)
          .foregroundStyle(state.isPaused ? .secondary : accent)
      }
      .keylineTint(accent)
    }
  }
}

// MARK: - Lock Screen

struct LockScreenView: View {
  let attributes: StudyTimerAttributes
  let state: StudyTimerAttributes.ContentState
  let goalReached: Bool

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline) {
        HStack(spacing: 6) {
          Text("📚").accessibilityHidden(true)  // VoiceOver would read "Books"
          Text(attributes.name)
            .lineLimit(1)
            .truncationMode(.tail)
        }
        .font(.headline)
        Spacer(minLength: 8)
        ClockText(state: state, adaptsToReducedLuminance: true)
          .font(.system(.title2, design: .rounded).weight(.semibold))
          .foregroundStyle(state.isPaused ? .secondary : .primary)
      }
      if attributes.hasGoal {
        GoalBar(attributes: attributes, state: state, goalReached: goalReached)
      }
      HStack {
        StatusLabel(state: state, goalReached: goalReached)
        Spacer()
        if attributes.hasGoal {
          Text("Goal \(formatGoal(attributes.goalSeconds))")
            .font(.caption)
            .foregroundStyle(.secondary)
        }
      }
    }
    .foregroundStyle(.white)
    .padding(16)
    .accessibilityElement(children: .combine)
  }
}

// MARK: - Building blocks

/// The elapsed clock. Running: ticked by the system from `startDate`, no
/// updates needed. Paused: a fixed string.
///
/// When the Lock Screen dims (Always-On, or the locked simulator), iOS stops
/// ticking seconds and renders a seconds timer as "7:--". With
/// `adaptsToReducedLuminance`, we switch to a minute-precision system format
/// ("7 minutes") in that state instead.
struct ClockText: View {
  let state: StudyTimerAttributes.ContentState
  var adaptsToReducedLuminance = false
  @Environment(\.isLuminanceReduced) private var isLuminanceReduced

  var body: some View {
    Group {
      if let pausedAt = state.pausedAt {
        Text(formatClock(state.elapsed(at: pausedAt)))
      } else if adaptsToReducedLuminance, isLuminanceReduced, #available(iOS 18.0, *) {
        Text(
          .currentDate,
          format: .timer(
            countingUpIn: state.startDate..<Date.distantFuture,
            maxFieldCount: 2,
            maxPrecision: .seconds(60)
          )
        )
      } else {
        Text(timerInterval: state.startDate...Date.distantFuture, countsDown: false)
      }
    }
    .monospacedDigit()
    .multilineTextAlignment(.trailing)
  }
}

/// Running color for goal progress: accent, green once the goal is reached,
/// gray while paused (inactive).
private func progressTint(paused: Bool, goalReached: Bool) -> Color {
  if paused { return .gray }
  return goalReached ? goalGreen : accent
}

struct GoalBar: View {
  let attributes: StudyTimerAttributes
  let state: StudyTimerAttributes.ContentState
  let goalReached: Bool

  var body: some View {
    Group {
      if let pausedAt = state.pausedAt {
        ProgressView(value: progress(at: pausedAt))
      } else {
        ProgressView(timerInterval: goalInterval, countsDown: false) {
          EmptyView()
        } currentValueLabel: {
          EmptyView()
        }
      }
    }
    .progressViewStyle(.linear)
    // The Lock Screen bar keeps its color while paused (only the island ring
    // grays out); it turns green once the goal is reached.
    .tint(goalReached && !state.isPaused ? goalGreen : accent)
  }

  private var goalInterval: ClosedRange<Date> {
    state.startDate...state.startDate.addingTimeInterval(TimeInterval(attributes.goalSeconds))
  }

  private func progress(at date: Date) -> Double {
    min(1, state.elapsed(at: date) / TimeInterval(attributes.goalSeconds))
  }
}

/// Ring + status word for the expanded island. Every piece has a fixed size
/// and the word sits in a fixed-width column, so state changes change only
/// the word (and colors); the ring never moves.
struct RingWithStatus: View {
  let attributes: StudyTimerAttributes
  let state: StudyTimerAttributes.ContentState
  let goalReached: Bool

  var body: some View {
    VStack(spacing: 4) {
      GoalRing(attributes: attributes, state: state, goalReached: goalReached, lineWidth: 5)
        .frame(width: 44, height: 44)
      Text(statusWord)
        .font(.caption2.weight(.semibold))
        .foregroundStyle(state.isPaused ? Color.secondary : progressTint(paused: false, goalReached: goalReached))
        .lineLimit(1)
        .minimumScaleFactor(0.8)
    }
    .frame(width: 64)
  }

  private var statusWord: String {
    if state.isPaused { return "Paused" }
    return goalReached ? "Goal reached" : "Focusing"
  }
}

/// Progress ring toward the goal with a glyph in the middle: a book while
/// running, a checkmark once the goal is reached, a pause symbol while
/// paused. The glyph is an overlay in every state (not the ProgressView's own
/// label) so it always sits in the same place.
struct GoalRing: View {
  let attributes: StudyTimerAttributes
  let state: StudyTimerAttributes.ContentState
  let goalReached: Bool
  var lineWidth: CGFloat = 4

  var body: some View {
    let tint = progressTint(paused: state.isPaused, goalReached: goalReached)
    ZStack {
      if attributes.hasGoal {
        Group {
          if let pausedAt = state.pausedAt {
            ProgressView(value: min(1, state.elapsed(at: pausedAt) / TimeInterval(attributes.goalSeconds)))
          } else {
            ProgressView(
              timerInterval: state.startDate...state.startDate.addingTimeInterval(TimeInterval(attributes.goalSeconds)),
              countsDown: false
            ) {
              EmptyView()
            } currentValueLabel: {
              EmptyView()
            }
          }
        }
        .progressViewStyle(.circular)
        .tint(tint)
      } else {
        // No goal: a plain track so the layout matches the goal case.
        Circle().stroke(tint.opacity(0.35), lineWidth: lineWidth)
      }
      Image(systemName: glyph)
        .font(.system(size: 15, weight: .semibold))
        .foregroundStyle(state.isPaused ? Color.secondary : tint)
        .accessibilityHidden(true)  // the status word below says the same
    }
  }

  private var glyph: String {
    if state.isPaused { return "pause.fill" }
    return goalReached ? "checkmark" : "book.fill"
  }
}

struct StatusLabel: View {
  let state: StudyTimerAttributes.ContentState
  let goalReached: Bool

  var body: some View {
    if state.isPaused {
      Label("Paused", systemImage: "pause.fill")
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
    } else {
      Text(goalReached ? "Goal reached" : "Focusing")
        .font(.caption.weight(.semibold))
        .foregroundStyle(goalReached ? goalGreen : accent)
    }
  }
}

/// Matches the system timer's style (H:MM:SS, or M:SS under an hour) so the
/// paused text doesn't jump format when the timer stops ticking.
func formatClock(_ seconds: TimeInterval) -> String {
  let s = max(0, Int(seconds))
  let h = s / 3600, m = (s % 3600) / 60, sec = s % 60
  if h > 0 { return String(format: "%d:%02d:%02d", h, m, sec) }
  return String(format: "%d:%02d", m, sec)
}

func formatGoal(_ goalSeconds: Int) -> String {
  let minutes = goalSeconds / 60
  let h = minutes / 60, m = minutes % 60
  if h == 0 { return "\(m) min" }
  return m == 0 ? "\(h) h" : "\(h) h \(m) min"
}

// MARK: - Previews

private let previewAttributes = StudyTimerAttributes(
  sessionId: "preview", name: "Chapter 5 Review", goalSeconds: 25 * 60)
private let longNameAttributes = StudyTimerAttributes(
  sessionId: "preview", name: "Organic Chemistry: Reaction Mechanisms and Stereochemistry", goalSeconds: 50 * 60)
private let running = StudyTimerAttributes.ContentState(startDate: .now.addingTimeInterval(-754), pausedAt: nil)
private let paused = StudyTimerAttributes.ContentState(startDate: .now.addingTimeInterval(-754), pausedAt: .now)
private let pastGoal = StudyTimerAttributes.ContentState(startDate: .now.addingTimeInterval(-5025), pausedAt: nil)

#Preview("Lock Screen", as: .content, using: previewAttributes) {
  StudyTimerLiveActivity()
} contentStates: {
  running
  paused
  pastGoal
}

#Preview("Long name", as: .content, using: longNameAttributes) {
  StudyTimerLiveActivity()
} contentStates: {
  running
}

#Preview("Compact", as: .dynamicIsland(.compact), using: previewAttributes) {
  StudyTimerLiveActivity()
} contentStates: {
  running
  paused
}

#Preview("Expanded", as: .dynamicIsland(.expanded), using: previewAttributes) {
  StudyTimerLiveActivity()
} contentStates: {
  running
  paused
}

#Preview("Minimal", as: .dynamicIsland(.minimal), using: previewAttributes) {
  StudyTimerLiveActivity()
} contentStates: {
  running
}
