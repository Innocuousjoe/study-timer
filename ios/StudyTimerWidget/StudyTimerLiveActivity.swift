import ActivityKit
import SwiftUI
import WidgetKit

private let accent = Color(red: 0.49, green: 0.55, blue: 1.0)
private let goalGreen = Color(red: 0.40, green: 0.73, blue: 0.42)

struct StudyTimerLiveActivity: Widget {
  var body: some WidgetConfiguration {
    ActivityConfiguration(for: StudyTimerAttributes.self) { context in
      LockScreenView(attributes: context.attributes, state: context.state)
        .activityBackgroundTint(Color.black.opacity(0.75))
        .activitySystemActionForegroundColor(.white)
    } dynamicIsland: { context in
      let attributes = context.attributes
      let state = context.state
      return DynamicIsland {
        // Leading/trailing sit beside the camera, where the island's rounded
        // top corners clip anything placed high; keep them vertically centered
        // and put text rows in the bottom region.
        DynamicIslandExpandedRegion(.leading) {
          RingWithStatus(attributes: attributes, state: state)
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
            Text(attributes.name)
              .font(.headline)
              .lineLimit(2)
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

  var body: some View {
    VStack(alignment: .leading, spacing: 10) {
      HStack(alignment: .firstTextBaseline) {
        Text("📚 \(attributes.name)")
          .font(.headline)
          .lineLimit(1)
          .truncationMode(.tail)
        Spacer(minLength: 8)
        ClockText(state: state, adaptsToReducedLuminance: true)
          .font(.system(.title2, design: .rounded).weight(.semibold))
          .foregroundStyle(state.isPaused ? .secondary : .primary)
      }
      if attributes.hasGoal {
        GoalBar(attributes: attributes, state: state)
      }
      HStack {
        StatusLabel(attributes: attributes, state: state)
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

struct GoalBar: View {
  let attributes: StudyTimerAttributes
  let state: StudyTimerAttributes.ContentState

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
    .tint(accent)
  }

  private var goalInterval: ClosedRange<Date> {
    state.startDate...state.startDate.addingTimeInterval(TimeInterval(attributes.goalSeconds))
  }

  private func progress(at date: Date) -> Double {
    min(1, state.elapsed(at: date) / TimeInterval(attributes.goalSeconds))
  }
}

/// Ring + status word for the expanded island. Every piece has a fixed size
/// and the word sits in a fixed-width column, so pausing/resuming changes
/// only the word; the ring never moves.
struct RingWithStatus: View {
  let attributes: StudyTimerAttributes
  let state: StudyTimerAttributes.ContentState

  var body: some View {
    VStack(spacing: 4) {
      GoalRing(attributes: attributes, state: state, lineWidth: 5)
        .frame(width: 44, height: 44)
      Text(state.isPaused ? "Paused" : "Focusing")
        .font(.caption2.weight(.semibold))
        .foregroundStyle(state.isPaused ? Color.secondary : accent)
        .lineLimit(1)
    }
    .frame(width: 64)
  }
}

/// Progress ring toward the goal with a glyph in the middle: a book while
/// running, a pause symbol while paused. The glyph is an overlay in both
/// states (not the ProgressView's own label) so it sits in the same place.
struct GoalRing: View {
  let attributes: StudyTimerAttributes
  let state: StudyTimerAttributes.ContentState
  var lineWidth: CGFloat = 4

  var body: some View {
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
        // Grayed out while paused, so the whole left column reads as inactive.
        .tint(state.isPaused ? Color.gray : accent)
      } else {
        // No goal: a plain track so the layout matches the goal case.
        Circle().stroke((state.isPaused ? Color.gray : accent).opacity(0.35), lineWidth: lineWidth)
      }
      Image(systemName: state.isPaused ? "pause.fill" : "book.fill")
        .font(.system(size: 15, weight: .semibold))
        .foregroundStyle(state.isPaused ? Color.secondary : accent)
    }
  }
}

struct StatusLabel: View {
  let attributes: StudyTimerAttributes
  let state: StudyTimerAttributes.ContentState

  var body: some View {
    if state.isPaused {
      Label("Paused", systemImage: "pause.fill")
        .font(.caption.weight(.semibold))
        .foregroundStyle(.secondary)
    } else {
      Text("Focusing")
        .font(.caption.weight(.semibold))
        .foregroundStyle(accent)
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
