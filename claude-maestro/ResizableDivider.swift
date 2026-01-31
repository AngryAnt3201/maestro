// ResizableDivider.swift
// claude-maestro
//
// Draggable divider component for resizing adjacent panels in the terminal grid.

import SwiftUI
import AppKit

/// A draggable divider that allows resizing of adjacent panels.
/// Supports both horizontal (between rows) and vertical (between columns) orientations.
struct ResizableDivider: View {
    enum Orientation {
        case horizontal  // Divides rows (drag up/down)
        case vertical    // Divides columns (drag left/right)
    }

    let orientation: Orientation
    @Binding var position: CGFloat  // 0.0-1.0 ratio
    let containerSize: CGFloat      // Total size in the relevant dimension

    let minPosition: CGFloat = 0.15
    let maxPosition: CGFloat = 0.85

    @State private var isDragging = false
    @State private var isHovering = false

    /// Width/height of the divider hit target area
    private let dividerThickness: CGFloat = 8

    /// Width of the visible divider line when hovering/dragging
    private let visibleLineThickness: CGFloat = 2

    var body: some View {
        GeometryReader { geometry in
            ZStack {
                // Invisible hit target area
                Color.clear

                // Visible divider line (only shown on hover/drag)
                if isHovering || isDragging {
                    RoundedRectangle(cornerRadius: 1)
                        .fill(Color.accentColor.opacity(isDragging ? 0.8 : 0.5))
                        .frame(
                            width: orientation == .vertical ? visibleLineThickness : nil,
                            height: orientation == .horizontal ? visibleLineThickness : nil
                        )
                }
            }
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 1, coordinateSpace: .named("resizableContainer"))
                    .onChanged { value in
                        isDragging = true
                        updatePosition(with: value, geometry: geometry)
                    }
                    .onEnded { _ in
                        isDragging = false
                    }
            )
            .onTapGesture(count: 2) {
                // Double-click resets to center (50%)
                withAnimation(.easeInOut(duration: 0.2)) {
                    position = 0.5
                }
            }
            .onHover { hovering in
                isHovering = hovering
                updateCursor(hovering: hovering)
            }
        }
        .frame(
            width: orientation == .vertical ? dividerThickness : nil,
            height: orientation == .horizontal ? dividerThickness : nil
        )
    }

    private func updatePosition(with value: DragGesture.Value, geometry: GeometryProxy) {
        // Use absolute position in the container coordinate space
        let absolutePosition: CGFloat
        switch orientation {
        case .horizontal:
            absolutePosition = value.location.y / containerSize
        case .vertical:
            absolutePosition = value.location.x / containerSize
        }

        // Clamp to valid range
        position = min(maxPosition, max(minPosition, absolutePosition))
    }

    private func updateCursor(hovering: Bool) {
        if hovering {
            switch orientation {
            case .horizontal:
                NSCursor.resizeUpDown.push()
            case .vertical:
                NSCursor.resizeLeftRight.push()
            }
        } else {
            NSCursor.pop()
        }
    }
}

// MARK: - Preview

#Preview {
    struct PreviewWrapper: View {
        @State private var horizontalPosition: CGFloat = 0.5
        @State private var verticalPosition: CGFloat = 0.5

        var body: some View {
            GeometryReader { geometry in
                VStack(spacing: 0) {
                    // Top row
                    HStack(spacing: 0) {
                        Color.blue.opacity(0.3)
                            .frame(width: geometry.size.width * verticalPosition)

                        ResizableDivider(
                            orientation: .vertical,
                            position: $verticalPosition,
                            containerSize: geometry.size.width
                        )

                        Color.green.opacity(0.3)
                    }
                    .frame(height: geometry.size.height * horizontalPosition)

                    ResizableDivider(
                        orientation: .horizontal,
                        position: $horizontalPosition,
                        containerSize: geometry.size.height
                    )

                    // Bottom row
                    HStack(spacing: 0) {
                        Color.orange.opacity(0.3)
                            .frame(width: geometry.size.width * verticalPosition)

                        ResizableDivider(
                            orientation: .vertical,
                            position: $verticalPosition,
                            containerSize: geometry.size.width
                        )

                        Color.purple.opacity(0.3)
                    }
                }
            }
            .frame(width: 600, height: 400)
        }
    }

    return PreviewWrapper()
}
