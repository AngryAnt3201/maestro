//
//  UserContentCreatorView.swift
//  claude-maestro
//
//  A wizard for creating user-generated skills, commands, and MCP servers
//

import SwiftUI

// MARK: - User Content Creator View

struct UserContentCreatorView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    @State private var currentStep: CreationStep = .selectType
    @State private var selectedType: ContentType = .skill
    @State private var contentName: String = ""
    @State private var contentDescription: String = ""
    @State private var contentTemplate: String = ""
    @State private var isCreating: Bool = false
    @State private var creationError: String? = nil
    @State private var showSuccessView: Bool = false
    @State private var showSuccessAnimation: Bool = false
    @State private var createdPath: String = ""

    enum CreationStep: Int, CaseIterable {
        case selectType
        case configure
        case preview
        case complete

        var title: String {
            switch self {
            case .selectType: return "Choose Type"
            case .configure: return "Configure"
            case .preview: return "Preview"
            case .complete: return "Complete"
            }
        }
    }

    enum ContentType: String, CaseIterable, Identifiable {
        case skill = "Skill"
        case command = "Command"
        case mcp = "MCP Server"
        case hook = "Hook"

        var id: String { rawValue }

        var icon: String {
            switch self {
            case .skill: return "sparkles"
            case .command: return "terminal"
            case .mcp: return "server.rack"
            case .hook: return "arrow.uturn.right"
            }
        }

        var color: Color {
            switch self {
            case .skill: return .orange
            case .command: return .blue
            case .mcp: return .purple
            case .hook: return .green
            }
        }

        var description: String {
            switch self {
            case .skill: return "Enhance Claude with specialized knowledge and capabilities"
            case .command: return "Create custom slash commands for workflows"
            case .mcp: return "Connect Claude to external services via Model Context Protocol"
            case .hook: return "Automate actions based on Claude Code events"
            }
        }

        var directoryName: String {
            switch self {
            case .skill: return "skills"
            case .command: return "commands"
            case .mcp: return "plugins"
            case .hook: return "hooks"
            }
        }

        var templateFileName: String {
            switch self {
            case .skill: return "SKILL.md"
            case .command: return "command.md"
            case .mcp: return ".mcp.json"
            case .hook: return "hook.md"
            }
        }
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header with progress
            headerSection

            Divider()

            // Content based on step - wrapped in ScrollView for overflow handling
            ScrollView {
                Group {
                    switch currentStep {
                    case .selectType:
                        typeSelectionStep
                    case .configure:
                        configurationStep
                    case .preview:
                        previewStep
                    case .complete:
                        completionStep
                    }
                }
                .frame(maxWidth: .infinity)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)

            Divider()

            // Navigation buttons
            navigationSection
        }
        .frame(width: 680, height: 680)
        .background(
            ZStack {
                Color(NSColor.windowBackgroundColor)

                // Subtle gradient orbs for atmosphere
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [selectedType.color.opacity(0.08), Color.clear],
                            center: .center,
                            startRadius: 0,
                            endRadius: 200
                        )
                    )
                    .frame(width: 400, height: 400)
                    .blur(radius: 60)
                    .offset(x: -150, y: -100)

                Circle()
                    .fill(
                        RadialGradient(
                            colors: [Color.purple.opacity(0.05), Color.clear],
                            center: .center,
                            startRadius: 0,
                            endRadius: 150
                        )
                    )
                    .frame(width: 300, height: 300)
                    .blur(radius: 40)
                    .offset(x: 200, y: 200)
            }
        )
        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: currentStep)
        .animation(.spring(response: 0.3, dampingFraction: 0.85), value: selectedType)
    }

    // MARK: - Header

    private var headerSection: some View {
        VStack(spacing: 18) {
            // Title with close button
            HStack {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 10)
                            .fill(
                                LinearGradient(
                                    colors: [selectedType.color, selectedType.color.opacity(0.7)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .frame(width: 36, height: 36)
                            .shadow(color: selectedType.color.opacity(0.3), radius: 6, y: 2)

                        Image(systemName: selectedType.icon)
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundColor(.white)
                    }

                    VStack(alignment: .leading, spacing: 3) {
                        Text("Create New \(selectedType.rawValue)")
                            .font(.system(size: 18, weight: .bold, design: .rounded))

                        Text(currentStep.title)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(selectedType.color)
                    }
                }

                Spacer()

                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundColor(.secondary)
                        .frame(width: 28, height: 28)
                        .background(Color.primary.opacity(0.06))
                        .cornerRadius(8)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 24)
            .padding(.top, 22)

            // Progress steps with better styling
            HStack(spacing: 0) {
                ForEach(Array(CreationStep.allCases.enumerated()), id: \.element) { index, step in
                    HStack(spacing: 0) {
                        // Step circle with glow
                        ZStack {
                            // Glow for active/completed steps
                            if currentStep.rawValue >= step.rawValue {
                                Circle()
                                    .fill(selectedType.color.opacity(0.3))
                                    .frame(width: 36, height: 36)
                                    .blur(radius: 6)
                            }

                            Circle()
                                .fill(
                                    currentStep.rawValue >= step.rawValue
                                        ? LinearGradient(
                                            colors: [selectedType.color, selectedType.color.opacity(0.8)],
                                            startPoint: .topLeading,
                                            endPoint: .bottomTrailing
                                        )
                                        : LinearGradient(
                                            colors: [Color.secondary.opacity(0.2), Color.secondary.opacity(0.15)],
                                            startPoint: .topLeading,
                                            endPoint: .bottomTrailing
                                        )
                                )
                                .frame(width: 30, height: 30)
                                .shadow(
                                    color: currentStep.rawValue >= step.rawValue ? selectedType.color.opacity(0.3) : .clear,
                                    radius: 4,
                                    y: 2
                                )

                            if currentStep.rawValue > step.rawValue {
                                Image(systemName: "checkmark")
                                    .font(.system(size: 12, weight: .bold))
                                    .foregroundColor(.white)
                            } else {
                                Text("\(index + 1)")
                                    .font(.system(size: 12, weight: .bold, design: .rounded))
                                    .foregroundColor(currentStep.rawValue >= step.rawValue ? .white : .secondary)
                            }
                        }
                        .scaleEffect(currentStep == step ? 1.1 : 1)
                        .animation(.spring(response: 0.3, dampingFraction: 0.6), value: currentStep)

                        // Connector line with animation
                        if step != CreationStep.allCases.last {
                            GeometryReader { geo in
                                ZStack(alignment: .leading) {
                                    // Background line
                                    Rectangle()
                                        .fill(Color.secondary.opacity(0.2))
                                        .frame(height: 3)
                                        .cornerRadius(1.5)

                                    // Progress line
                                    Rectangle()
                                        .fill(
                                            LinearGradient(
                                                colors: [selectedType.color, selectedType.color.opacity(0.7)],
                                                startPoint: .leading,
                                                endPoint: .trailing
                                            )
                                        )
                                        .frame(width: currentStep.rawValue > step.rawValue ? geo.size.width : 0, height: 3)
                                        .cornerRadius(1.5)
                                        .animation(.spring(response: 0.4, dampingFraction: 0.8), value: currentStep)
                                }
                            }
                            .frame(height: 3)
                            .frame(maxWidth: .infinity)
                            .padding(.horizontal, 4)
                        }
                    }
                }
            }
            .padding(.horizontal, 44)
            .padding(.bottom, 18)
        }
        .background(
            LinearGradient(
                colors: [selectedType.color.opacity(0.05), Color.clear],
                startPoint: .top,
                endPoint: .bottom
            )
        )
    }

    // MARK: - Type Selection Step

    private var typeSelectionStep: some View {
        VStack(spacing: 24) {
            VStack(spacing: 6) {
                Text("What would you like to create?")
                    .font(.system(size: 17, weight: .semibold, design: .rounded))

                Text("Choose a content type to get started")
                    .font(.system(size: 13))
                    .foregroundColor(.secondary)
            }
            .padding(.top, 24)

            LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 14) {
                ForEach(ContentType.allCases) { type in
                    ContentTypeCard(
                        type: type,
                        isSelected: selectedType == type,
                        onSelect: {
                            withAnimation(.spring(response: 0.35, dampingFraction: 0.7)) {
                                selectedType = type
                            }
                        }
                    )
                }
            }
            .padding(.horizontal, 28)

            // Selected type details - Bento box style info card
            VStack(alignment: .leading, spacing: 14) {
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 10)
                            .fill(
                                LinearGradient(
                                    colors: [selectedType.color, selectedType.color.opacity(0.7)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .frame(width: 40, height: 40)
                            .shadow(color: selectedType.color.opacity(0.3), radius: 6, y: 3)

                        Image(systemName: selectedType.icon)
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundColor(.white)
                    }

                    VStack(alignment: .leading, spacing: 3) {
                        Text(selectedType.rawValue)
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                        Text(selectedType.description)
                            .font(.system(size: 12))
                            .foregroundColor(.secondary)
                    }
                }

                Divider()
                    .opacity(0.5)

                // Features list with better styling
                VStack(alignment: .leading, spacing: 8) {
                    FeatureRow(icon: "folder.fill", text: "Stored in ~/.claude/\(selectedType.directoryName)/", color: selectedType.color)
                    FeatureRow(icon: "doc.text.fill", text: "Uses \(selectedType.templateFileName) format", color: selectedType.color)
                    FeatureRow(icon: "square.and.arrow.up.fill", text: "Can be shared via marketplace", color: selectedType.color)
                }
            }
            .padding(18)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                ZStack {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(Color(NSColor.controlBackgroundColor))
                        .shadow(color: .black.opacity(colorScheme == .dark ? 0.2 : 0.06), radius: 10, y: 4)

                    // Gradient accent
                    RoundedRectangle(cornerRadius: 16)
                        .fill(
                            LinearGradient(
                                colors: [selectedType.color.opacity(0.08), Color.clear],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                }
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(selectedType.color.opacity(0.2), lineWidth: 1)
            )
            .padding(.horizontal, 28)

            Spacer(minLength: 20)
        }
    }

    // MARK: - Configuration Step

    private var configurationStep: some View {
        VStack(alignment: .leading, spacing: 20) {
            // Name input
            VStack(alignment: .leading, spacing: 8) {
                Text("Name")
                    .font(.system(size: 13, weight: .semibold))

                HStack(spacing: 10) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 8)
                            .fill(selectedType.color.opacity(0.12))
                            .frame(width: 32, height: 32)

                        Image(systemName: selectedType.icon)
                            .font(.system(size: 14, weight: .medium))
                            .foregroundColor(selectedType.color)
                    }

                    TextField("my-\(selectedType.rawValue.lowercased())", text: $contentName)
                        .textFieldStyle(.plain)
                        .font(.system(size: 14))
                }
                .padding(14)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(Color(NSColor.textBackgroundColor))
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .strokeBorder(selectedType.color.opacity(0.2), lineWidth: 1)
                        )
                        .shadow(color: selectedType.color.opacity(0.08), radius: 8, y: 2)
                )

                Text("Use lowercase letters, numbers, and hyphens only")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
            }

            // Description input
            VStack(alignment: .leading, spacing: 8) {
                Text("Description")
                    .font(.system(size: 13, weight: .semibold))

                TextEditor(text: $contentDescription)
                    .font(.system(size: 13))
                    .scrollContentBackground(.hidden)
                    .frame(height: 100)
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color(NSColor.textBackgroundColor))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .strokeBorder(Color.primary.opacity(0.1), lineWidth: 1)
                            )
                    )

                Text("Describe what your \(selectedType.rawValue.lowercased()) does")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
            }

            // Template selection/customization
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text("Template")
                        .font(.system(size: 13, weight: .semibold))

                    Spacer()

                    Button {
                        withAnimation(.spring(response: 0.3)) {
                            contentTemplate = getDefaultTemplate()
                        }
                    } label: {
                        Label("Reset to Default", systemImage: "arrow.counterclockwise")
                            .font(.system(size: 10, weight: .medium))
                    }
                    .buttonStyle(.plain)
                    .foregroundColor(selectedType.color)
                }

                TextEditor(text: $contentTemplate)
                    .font(.system(size: 11, design: .monospaced))
                    .scrollContentBackground(.hidden)
                    .frame(minHeight: 220, maxHeight: 280)
                    .padding(12)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(Color(NSColor.textBackgroundColor).opacity(0.9))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .strokeBorder(Color.primary.opacity(0.1), lineWidth: 1)
                            )
                    )
            }
        }
        .padding(28)
        .onAppear {
            if contentTemplate.isEmpty {
                contentTemplate = getDefaultTemplate()
            }
        }
    }

    // MARK: - Preview Step

    private var previewStep: some View {
        VStack(spacing: 20) {
            // Preview header - Bento box style
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 14)
                        .fill(
                            LinearGradient(
                                colors: [selectedType.color, selectedType.color.opacity(0.7)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 56, height: 56)
                        .shadow(color: selectedType.color.opacity(0.3), radius: 8, y: 4)

                    Image(systemName: selectedType.icon)
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundColor(.white)
                }

                VStack(alignment: .leading, spacing: 6) {
                    Text(contentName.isEmpty ? "my-\(selectedType.rawValue.lowercased())" : contentName)
                        .font(.system(size: 18, weight: .bold, design: .rounded))

                    Text(contentDescription.isEmpty ? "No description" : contentDescription)
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }

                Spacer()

                VStack(alignment: .trailing, spacing: 6) {
                    Text(selectedType.rawValue.uppercased())
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .tracking(0.5)
                        .foregroundColor(.white)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(
                            Capsule()
                                .fill(selectedType.color)
                        )

                    Text("v1.0.0")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(Color.primary.opacity(0.05))
                        .cornerRadius(4)
                }
            }
            .padding(18)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color(NSColor.controlBackgroundColor))
                    .shadow(color: .black.opacity(colorScheme == .dark ? 0.3 : 0.08), radius: 12, y: 4)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(selectedType.color.opacity(0.15), lineWidth: 1)
            )
            .padding(.horizontal, 28)
            .padding(.top, 24)

            // File preview with better styling
            VStack(alignment: .leading, spacing: 10) {
                HStack {
                    HStack(spacing: 6) {
                        Image(systemName: "doc.text.fill")
                            .font(.system(size: 11))
                            .foregroundColor(selectedType.color)
                        Text("Output File")
                            .font(.system(size: 11, weight: .semibold))
                    }

                    Spacer()

                    Text(getOutputPath())
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                        .truncationMode(.middle)
                }

                // Code preview with syntax-like styling
                Text(generateFinalContent())
                    .font(.system(size: 11, design: .monospaced))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .textSelection(.enabled)
                    .padding(14)
                    .frame(minHeight: 200, maxHeight: 300)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(colorScheme == .dark ? Color.black.opacity(0.3) : Color(NSColor.textBackgroundColor))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
                            )
                    )
            }
            .padding(.horizontal, 28)

            // Warning/info
            if let error = creationError {
                HStack(spacing: 10) {
                    Image(systemName: "exclamationmark.triangle.fill")
                        .font(.system(size: 14))
                        .foregroundColor(.orange)
                    Text(error)
                        .font(.system(size: 12))
                        .foregroundColor(.orange)
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color.orange.opacity(0.1))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .strokeBorder(Color.orange.opacity(0.3), lineWidth: 1)
                        )
                )
                .padding(.horizontal, 28)
            }

            Spacer(minLength: 20)
        }
    }

    // MARK: - Completion Step

    private var completionStep: some View {
        VStack(spacing: 24) {
            Spacer()

            // Success animation with pulsing rings
            ZStack {
                // Outer pulse rings
                ForEach(0..<3, id: \.self) { index in
                    Circle()
                        .stroke(selectedType.color.opacity(0.2 - Double(index) * 0.05), lineWidth: 2)
                        .frame(width: CGFloat(100 + index * 40), height: CGFloat(100 + index * 40))
                        .scaleEffect(showSuccessAnimation ? 1.1 : 0.9)
                        .opacity(showSuccessAnimation ? 0.3 : 0.8)
                        .animation(
                            .easeInOut(duration: 1.5)
                            .repeatForever(autoreverses: true)
                            .delay(Double(index) * 0.2),
                            value: showSuccessAnimation
                        )
                }

                // Glow background
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [selectedType.color.opacity(0.4), selectedType.color.opacity(0.1), Color.clear],
                            center: .center,
                            startRadius: 20,
                            endRadius: 70
                        )
                    )
                    .frame(width: 140, height: 140)
                    .blur(radius: 10)

                // Main circle with gradient
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [selectedType.color, selectedType.color.opacity(0.8)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 72, height: 72)
                    .shadow(color: selectedType.color.opacity(0.5), radius: 16, y: 6)
                    .scaleEffect(showSuccessAnimation ? 1 : 0.8)
                    .animation(.spring(response: 0.5, dampingFraction: 0.6), value: showSuccessAnimation)

                Image(systemName: "checkmark")
                    .font(.system(size: 32, weight: .bold))
                    .foregroundColor(.white)
                    .scaleEffect(showSuccessAnimation ? 1 : 0)
                    .animation(.spring(response: 0.4, dampingFraction: 0.5).delay(0.2), value: showSuccessAnimation)
            }
            .onAppear {
                withAnimation {
                    showSuccessAnimation = true
                }
            }

            VStack(spacing: 8) {
                Text("\(selectedType.rawValue) Created!")
                    .font(.system(size: 26, weight: .bold, design: .rounded))
                    .opacity(showSuccessAnimation ? 1 : 0)
                    .offset(y: showSuccessAnimation ? 0 : 20)
                    .animation(.spring(response: 0.5, dampingFraction: 0.7).delay(0.3), value: showSuccessAnimation)

                Text("Your new \(selectedType.rawValue.lowercased()) is ready to use")
                    .font(.system(size: 14))
                    .foregroundColor(.secondary)
                    .opacity(showSuccessAnimation ? 1 : 0)
                    .animation(.easeOut(duration: 0.4).delay(0.4), value: showSuccessAnimation)
            }

            // Created location - Bento box style
            VStack(spacing: 10) {
                HStack {
                    Image(systemName: "folder.fill")
                        .foregroundColor(selectedType.color)
                    Text("Location")
                        .font(.system(size: 12, weight: .semibold))
                    Spacer()
                }

                HStack(spacing: 10) {
                    Text(createdPath)
                        .font(.system(size: 11, design: .monospaced))
                        .lineLimit(1)
                        .truncationMode(.middle)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Button {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(createdPath, forType: .string)
                    } label: {
                        Image(systemName: "doc.on.doc")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.white)
                            .frame(width: 28, height: 28)
                            .background(selectedType.color.opacity(0.8))
                            .cornerRadius(6)
                    }
                    .buttonStyle(.plain)
                    .help("Copy path")

                    Button {
                        NSWorkspace.shared.selectFile(createdPath, inFileViewerRootedAtPath: "")
                    } label: {
                        Image(systemName: "folder")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundColor(.white)
                            .frame(width: 28, height: 28)
                            .background(selectedType.color.opacity(0.8))
                            .cornerRadius(6)
                    }
                    .buttonStyle(.plain)
                    .help("Reveal in Finder")
                }
                .padding(14)
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color(NSColor.textBackgroundColor))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
                        )
                )
            }
            .padding(16)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(Color(NSColor.controlBackgroundColor))
                    .shadow(color: .black.opacity(colorScheme == .dark ? 0.2 : 0.06), radius: 8, y: 3)
            )
            .padding(.horizontal, 28)
            .opacity(showSuccessAnimation ? 1 : 0)
            .offset(y: showSuccessAnimation ? 0 : 30)
            .animation(.spring(response: 0.5, dampingFraction: 0.7).delay(0.5), value: showSuccessAnimation)

            // Next steps - Bento box style
            VStack(alignment: .leading, spacing: 12) {
                HStack {
                    Image(systemName: "arrow.right.circle.fill")
                        .foregroundColor(selectedType.color)
                    Text("Next Steps")
                        .font(.system(size: 13, weight: .semibold))
                }

                VStack(alignment: .leading, spacing: 8) {
                    NextStepRow(number: 1, text: "Edit the generated file to customize behavior", color: selectedType.color)
                    NextStepRow(number: 2, text: "Test your \(selectedType.rawValue.lowercased()) in a Claude Code session", color: selectedType.color)
                    NextStepRow(number: 3, text: "Share via GitHub and add to a marketplace", color: selectedType.color)
                }
            }
            .padding(18)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(Color(NSColor.controlBackgroundColor))
                    .shadow(color: .black.opacity(colorScheme == .dark ? 0.2 : 0.06), radius: 8, y: 3)
            )
            .padding(.horizontal, 28)
            .opacity(showSuccessAnimation ? 1 : 0)
            .offset(y: showSuccessAnimation ? 0 : 30)
            .animation(.spring(response: 0.5, dampingFraction: 0.7).delay(0.6), value: showSuccessAnimation)

            Spacer()
        }
    }

    // MARK: - Navigation

    private var navigationSection: some View {
        HStack(spacing: 12) {
            if currentStep != .selectType && currentStep != .complete {
                Button {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) {
                        currentStep = CreationStep(rawValue: currentStep.rawValue - 1) ?? .selectType
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "chevron.left")
                            .font(.system(size: 11, weight: .semibold))
                        Text("Back")
                    }
                }
                .buttonStyle(.bordered)
                .transition(.opacity.combined(with: .move(edge: .leading)))
            }

            Spacer()

            if currentStep == .complete {
                Button {
                    dismiss()
                } label: {
                    HStack(spacing: 6) {
                        Text("Done")
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .bold))
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(selectedType.color)
                .transition(.opacity.combined(with: .scale))
            } else {
                Button {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) {
                        if currentStep == .preview {
                            createContent()
                        } else {
                            currentStep = CreationStep(rawValue: currentStep.rawValue + 1) ?? .complete
                        }
                    }
                } label: {
                    if isCreating {
                        ProgressView()
                            .scaleEffect(0.7)
                            .frame(width: 80)
                    } else {
                        HStack(spacing: 6) {
                            Text(currentStep == .preview ? "Create" : "Continue")
                            Image(systemName: currentStep == .preview ? "sparkles" : "chevron.right")
                                .font(.system(size: 11, weight: .semibold))
                        }
                    }
                }
                .buttonStyle(.borderedProminent)
                .tint(selectedType.color)
                .disabled(currentStep == .configure && contentName.isEmpty)
            }
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 18)
        .background(
            Rectangle()
                .fill(Color(NSColor.windowBackgroundColor).opacity(0.9))
                .shadow(color: .black.opacity(0.05), radius: 10, y: -5)
        )
    }

    // MARK: - Helpers

    private func getDefaultTemplate() -> String {
        switch selectedType {
        case .skill:
            return """
---
name: \(contentName.isEmpty ? "my-skill" : contentName)
description: \(contentDescription.isEmpty ? "A custom skill for Claude" : contentDescription)
---

# \(contentName.isEmpty ? "My Skill" : contentName.capitalized.replacingOccurrences(of: "-", with: " "))

This skill provides Claude with specialized capabilities.

## Instructions

When this skill is activated, Claude should:

1. Follow these guidelines
2. Apply this knowledge
3. Produce this type of output

## Examples

Here are some examples of how to use this skill:

- Example 1
- Example 2

## Notes

Additional context and information.
"""
        case .command:
            return """
---
name: \(contentName.isEmpty ? "my-command" : contentName)
description: \(contentDescription.isEmpty ? "A custom command" : contentDescription)
---

# /\(contentName.isEmpty ? "my-command" : contentName)

Execute this command to perform the following actions.

## Arguments

- `arg1` - Description of first argument
- `arg2` - Description of second argument (optional)

## Behavior

When executed, this command will:

1. Step one
2. Step two
3. Step three
"""
        case .mcp:
            return """
{
  "mcpServers": {
    "\(contentName.isEmpty ? "my-server" : contentName)": {
      "command": "node",
      "args": ["server.js"],
      "env": {
        "API_KEY": "${API_KEY}"
      }
    }
  }
}
"""
        case .hook:
            return """
---
name: \(contentName.isEmpty ? "my-hook" : contentName)
description: \(contentDescription.isEmpty ? "A custom hook" : contentDescription)
event: PreToolUse
---

# Hook: \(contentName.isEmpty ? "My Hook" : contentName.capitalized.replacingOccurrences(of: "-", with: " "))

This hook runs before tool execution.

## Trigger Conditions

- Event: PreToolUse
- Tools: Bash, Write

## Behavior

When triggered, this hook will validate the tool usage.
"""
        }
    }

    private func getOutputPath() -> String {
        let home = FileManager.default.homeDirectoryForCurrentUser.path
        let name = contentName.isEmpty ? "my-\(selectedType.rawValue.lowercased())" : contentName

        switch selectedType {
        case .skill:
            return "\(home)/.claude/skills/\(name)/SKILL.md"
        case .command:
            return "\(home)/.claude/commands/\(name).md"
        case .mcp:
            return "\(home)/.claude/plugins/\(name)/.mcp.json"
        case .hook:
            return "\(home)/.claude/hooks/\(name).md"
        }
    }

    private func generateFinalContent() -> String {
        var template = contentTemplate

        // Replace placeholders
        let name = contentName.isEmpty ? "my-\(selectedType.rawValue.lowercased())" : contentName
        template = template.replacingOccurrences(of: "my-skill", with: name)
        template = template.replacingOccurrences(of: "my-command", with: name)
        template = template.replacingOccurrences(of: "my-server", with: name)
        template = template.replacingOccurrences(of: "my-hook", with: name)

        if !contentDescription.isEmpty {
            template = template.replacingOccurrences(of: "A custom skill for Claude", with: contentDescription)
            template = template.replacingOccurrences(of: "A custom command", with: contentDescription)
            template = template.replacingOccurrences(of: "A custom hook", with: contentDescription)
        }

        return template
    }

    private func createContent() {
        isCreating = true
        creationError = nil

        let fm = FileManager.default
        let path = getOutputPath()
        let directoryPath = (path as NSString).deletingLastPathComponent

        do {
            // Create directory if needed
            if !fm.fileExists(atPath: directoryPath) {
                try fm.createDirectory(atPath: directoryPath, withIntermediateDirectories: true)
            }

            // Write file
            let content = generateFinalContent()
            try content.write(toFile: path, atomically: true, encoding: .utf8)

            createdPath = path
            currentStep = .complete

            // Trigger skill rescan if we created a skill
            if selectedType == .skill {
                SkillManager.shared.scanForSkills()
            }
        } catch {
            creationError = error.localizedDescription
        }

        isCreating = false
    }
}

// MARK: - Content Type Card

struct ContentTypeCard: View {
    let type: UserContentCreatorView.ContentType
    let isSelected: Bool
    let onSelect: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @State private var isHovered: Bool = false

    var body: some View {
        Button(action: onSelect) {
            VStack(spacing: 12) {
                ZStack {
                    // Glow effect when selected
                    if isSelected {
                        Circle()
                            .fill(type.color.opacity(0.3))
                            .frame(width: 56, height: 56)
                            .blur(radius: 8)
                    }

                    Circle()
                        .fill(
                            isSelected
                                ? LinearGradient(
                                    colors: [type.color, type.color.opacity(0.8)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                                : LinearGradient(
                                    colors: [type.color.opacity(isHovered ? 0.2 : 0.12), type.color.opacity(isHovered ? 0.15 : 0.08)],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                        )
                        .frame(width: 52, height: 52)
                        .shadow(color: isSelected ? type.color.opacity(0.4) : .clear, radius: 8, y: 4)

                    Image(systemName: type.icon)
                        .font(.system(size: 22, weight: .semibold))
                        .foregroundColor(isSelected ? .white : type.color)
                        .scaleEffect(isSelected ? 1.1 : 1)
                }

                VStack(spacing: 5) {
                    Text(type.rawValue)
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundColor(isSelected ? type.color : .primary)

                    Text(type.description)
                        .font(.system(size: 10))
                        .foregroundColor(.secondary)
                        .multilineTextAlignment(.center)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 18)
            .frame(maxWidth: .infinity)
            .background(
                RoundedRectangle(cornerRadius: 16)
                    .fill(
                        isSelected
                            ? type.color.opacity(colorScheme == .dark ? 0.15 : 0.08)
                            : Color(NSColor.controlBackgroundColor)
                    )
                    .shadow(
                        color: isSelected ? type.color.opacity(0.2) : .black.opacity(colorScheme == .dark ? 0.2 : 0.05),
                        radius: isSelected ? 12 : (isHovered ? 8 : 4),
                        y: isSelected ? 6 : (isHovered ? 4 : 2)
                    )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16)
                    .strokeBorder(
                        isSelected ? type.color.opacity(0.6) : (isHovered ? type.color.opacity(0.3) : Color.primary.opacity(0.06)),
                        lineWidth: isSelected ? 2 : 1
                    )
            )
            .scaleEffect(isHovered && !isSelected ? 1.02 : 1)
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovered)
        .animation(.spring(response: 0.35, dampingFraction: 0.65), value: isSelected)
    }
}

// MARK: - Feature Row

struct FeatureRow: View {
    let icon: String
    let text: String
    var color: Color = .secondary

    var body: some View {
        HStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(color.opacity(0.12))
                    .frame(width: 22, height: 22)

                Image(systemName: icon)
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(color)
            }

            Text(text)
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.secondary)
        }
    }
}

// MARK: - Next Step Row

struct NextStepRow: View {
    let number: Int
    let text: String
    var color: Color = .accentColor

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [color.opacity(0.2), color.opacity(0.1)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 26, height: 26)

                Text("\(number)")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundColor(color)
            }

            Text(text)
                .font(.system(size: 12))
                .foregroundColor(.primary.opacity(0.85))
        }
    }
}

// MARK: - Preview

#Preview {
    UserContentCreatorView()
}
