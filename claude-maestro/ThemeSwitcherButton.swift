//
//  ThemeSwitcherButton.swift
//  claude-maestro
//
//  Created by Maestro on 1/29/2026.
//

import SwiftUI

struct ThemeSwitcherButton: View {
    @ObservedObject var appearanceManager: AppearanceManager
    @State private var isPressed = false

    var body: some View {
        Button {
            // Haptic feedback
            NSHapticFeedbackManager.defaultPerformer.perform(
                .alignment,
                performanceTime: .default
            )

            withAnimation(.easeInOut(duration: 0.2)) {
                isPressed = true
            }

            appearanceManager.cycleMode()

            DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) {
                withAnimation(.easeOut(duration: 0.2)) {
                    isPressed = false
                }
            }
        } label: {
            HStack(spacing: 6) {
                Image(systemName: appearanceManager.nextMode.icon)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundColor(iconColor)
                    .frame(width: 16)

                Text("Switch to \(appearanceManager.nextMode.rawValue)")
                    .font(.caption)
                    .fontWeight(.medium)

                Spacer()
            }
            .padding(.vertical, 6)
            .padding(.horizontal, 8)
            .background(
                RoundedRectangle(cornerRadius: 6)
                    .fill(backgroundColor)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 6)
                    .stroke(borderColor, lineWidth: 0.5)
            )
            .scaleEffect(isPressed ? 0.97 : 1.0)
        }
        .buttonStyle(.plain)
        .help("Switch to \(appearanceManager.nextMode.rawValue) mode")
        .accessibilityLabel("Switch to \(appearanceManager.nextMode.rawValue) mode")
    }

    private var backgroundColor: Color {
        Color(NSColor.windowBackgroundColor)
    }

    private var iconColor: Color {
        switch appearanceManager.nextMode {
        case .light: return Color.orange
        case .dark: return Color.blue
        }
    }

    private var borderColor: Color {
        iconColor.opacity(0.2)
    }
}

struct ThemeSwitcherButton_Previews: PreviewProvider {
    static var previews: some View {
        ThemeSwitcherButton(appearanceManager: AppearanceManager())
            .padding()
    }
}
