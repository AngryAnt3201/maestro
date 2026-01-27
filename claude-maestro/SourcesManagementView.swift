//
//  SourcesManagementView.swift
//  claude-maestro
//
//  A beautiful sources management panel with MCP server status integration
//

import SwiftUI

// MARK: - Sources Management View

struct SourcesManagementView: View {
    @StateObject private var marketplaceManager = MarketplaceManager.shared
    @Environment(\.colorScheme) private var colorScheme

    @State private var showAddSource: Bool = false
    @State private var newSourceURL: String = ""
    @State private var expandedSourceId: UUID? = nil
    @State private var isRefreshing: Bool = false

    var body: some View {
        VStack(spacing: 0) {
            // Header
            headerSection

            Divider()

            ScrollView {
                VStack(spacing: 16) {
                    // Connected Sources section
                    connectedSourcesSection

                    // MCP Servers section
                    mcpServersSection

                    // Quick Stats
                    quickStatsSection
                }
                .padding(16)
            }
        }
        .background(Color(NSColor.windowBackgroundColor))
        .sheet(isPresented: $showAddSource) {
            AddSourceSheetV2(
                sourceURL: $newSourceURL,
                onAdd: {
                    Task {
                        do {
                            _ = try await marketplaceManager.addSource(repositoryURL: newSourceURL)
                            newSourceURL = ""
                            showAddSource = false
                        } catch {
                            // Handle error
                        }
                    }
                },
                onCancel: {
                    newSourceURL = ""
                    showAddSource = false
                }
            )
        }
    }

    // MARK: - Header

    private var headerSection: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Sources")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))

                Text("\(marketplaceManager.sources.filter { $0.isEnabled }.count) active")
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
            }

            Spacer()

            HStack(spacing: 8) {
                Button {
                    isRefreshing = true
                    Task {
                        await marketplaceManager.refreshMarketplaces()
                        isRefreshing = false
                    }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 11, weight: .medium))
                        .rotationEffect(.degrees(isRefreshing ? 360 : 0))
                        .animation(isRefreshing ? .linear(duration: 1).repeatForever(autoreverses: false) : .default, value: isRefreshing)
                }
                .buttonStyle(.plain)
                .disabled(isRefreshing)

                Button {
                    showAddSource = true
                } label: {
                    Image(systemName: "plus")
                        .font(.system(size: 11, weight: .medium))
                }
                .buttonStyle(.plain)
            }
            .foregroundColor(.secondary)
        }
        .padding(12)
    }

    // MARK: - Connected Sources

    private var connectedSourcesSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Marketplaces", systemImage: "globe")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.secondary)

                Spacer()
            }

            if marketplaceManager.sources.isEmpty {
                EmptySourcesCard(onAdd: { showAddSource = true })
            } else {
                VStack(spacing: 6) {
                    ForEach(marketplaceManager.sources) { source in
                        SourceCard(
                            source: source,
                            isExpanded: expandedSourceId == source.id,
                            onToggle: {
                                withAnimation(.spring(response: 0.3)) {
                                    expandedSourceId = expandedSourceId == source.id ? nil : source.id
                                }
                            },
                            onEnable: {
                                marketplaceManager.toggleSourceEnabled(id: source.id)
                            },
                            onRemove: {
                                marketplaceManager.removeSource(id: source.id)
                            }
                        )
                    }
                }
            }
        }
    }

    // MARK: - MCP Servers

    private var mcpServersSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("MCP Servers", systemImage: "server.rack")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundColor(.secondary)

                Spacer()

                // Status indicator
                HStack(spacing: 4) {
                    Circle()
                        .fill(Color.green)
                        .frame(width: 6, height: 6)
                    Text("Connected")
                        .font(.system(size: 9, weight: .medium))
                        .foregroundColor(.secondary)
                }
            }

            // Show MCP servers from installed plugins
            let mcpPlugins = marketplaceManager.installedPlugins.filter { !$0.mcpServers.isEmpty }

            if mcpPlugins.isEmpty {
                MCPEmptyCard()
            } else {
                VStack(spacing: 6) {
                    ForEach(mcpPlugins) { plugin in
                        ForEach(plugin.mcpServers, id: \.self) { serverName in
                            MCPServerCard(
                                serverName: serverName,
                                pluginName: plugin.name,
                                isActive: true
                            )
                        }
                    }
                }
            }
        }
    }

    // MARK: - Quick Stats

    private var quickStatsSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Overview", systemImage: "chart.bar.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundColor(.secondary)

            HStack(spacing: 8) {
                MiniStatCard(
                    value: "\(marketplaceManager.availablePlugins.count)",
                    label: "Available",
                    icon: "puzzlepiece.extension",
                    color: .blue
                )

                MiniStatCard(
                    value: "\(marketplaceManager.installedPlugins.count)",
                    label: "Installed",
                    icon: "checkmark.circle.fill",
                    color: .green
                )

                MiniStatCard(
                    value: "\(marketplaceManager.installedPlugins.flatMap { $0.mcpServers }.count)",
                    label: "MCP",
                    icon: "server.rack",
                    color: .purple
                )
            }
        }
    }
}

// MARK: - Source Card

struct SourceCard: View {
    let source: MarketplaceSource
    let isExpanded: Bool
    let onToggle: () -> Void
    let onEnable: () -> Void
    let onRemove: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @State private var isHovered: Bool = false

    private var statusColor: Color {
        source.isOfficial ? .blue : (source.isEnabled ? .green : .gray)
    }

    var body: some View {
        VStack(spacing: 0) {
            // Main row
            HStack(spacing: 10) {
                // Status indicator with glow
                ZStack {
                    // Glow effect
                    if source.isEnabled {
                        Circle()
                            .fill(statusColor.opacity(0.3))
                            .frame(width: 32, height: 32)
                            .blur(radius: isHovered ? 6 : 3)
                    }

                    Circle()
                        .fill(
                            LinearGradient(
                                colors: source.isEnabled
                                    ? [statusColor.opacity(0.2), statusColor.opacity(0.1)]
                                    : [Color.gray.opacity(0.12), Color.gray.opacity(0.08)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 30, height: 30)

                    Image(systemName: source.isOfficial ? "checkmark.seal.fill" : "globe")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundColor(statusColor)
                        .scaleEffect(isHovered ? 1.1 : 1)
                }

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 6) {
                        Text(source.name)
                            .font(.system(size: 12, weight: .semibold))
                            .lineLimit(1)

                        if source.isOfficial {
                            HStack(spacing: 3) {
                                Image(systemName: "checkmark.seal.fill")
                                    .font(.system(size: 7))
                                Text("OFFICIAL")
                                    .font(.system(size: 8, weight: .bold))
                                    .tracking(0.3)
                            }
                            .foregroundColor(.blue)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 2)
                            .background(
                                Capsule()
                                    .fill(Color.blue.opacity(0.12))
                            )
                        }
                    }

                    if let lastFetched = source.lastFetched {
                        Text("Updated \(lastFetched.formatted(.relative(presentation: .named)))")
                            .font(.system(size: 9, weight: .medium))
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()

                // Toggle with better styling
                Toggle("", isOn: Binding(
                    get: { source.isEnabled },
                    set: { _ in onEnable() }
                ))
                .toggleStyle(.switch)
                .controlSize(.mini)
                .tint(.green)

                // Expand button with rotation animation
                Button(action: onToggle) {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundColor(.secondary)
                        .rotationEffect(.degrees(isExpanded ? 90 : 0))
                        .frame(width: 24, height: 24)
                        .background(Color.primary.opacity(isHovered ? 0.08 : 0.04))
                        .cornerRadius(6)
                }
                .buttonStyle(.plain)
            }
            .padding(12)
            .contentShape(Rectangle())
            .onTapGesture(perform: onToggle)

            // Expanded content with smooth reveal
            if isExpanded {
                VStack(alignment: .leading, spacing: 10) {
                    Divider()
                        .padding(.horizontal, 4)

                    // Repository URL
                    HStack(spacing: 8) {
                        ZStack {
                            Circle()
                                .fill(Color.blue.opacity(0.1))
                                .frame(width: 22, height: 22)

                            Image(systemName: "link")
                                .font(.system(size: 9, weight: .medium))
                                .foregroundColor(.blue)
                        }

                        Text(source.repositoryURL)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }

                    // Error if any
                    if let error = source.lastError {
                        HStack(spacing: 8) {
                            ZStack {
                                Circle()
                                    .fill(Color.orange.opacity(0.15))
                                    .frame(width: 22, height: 22)

                                Image(systemName: "exclamationmark.triangle.fill")
                                    .font(.system(size: 9))
                                    .foregroundColor(.orange)
                            }

                            Text(error)
                                .font(.system(size: 10))
                                .foregroundColor(.orange)
                                .lineLimit(2)
                        }
                        .padding(8)
                        .background(
                            RoundedRectangle(cornerRadius: 8)
                                .fill(Color.orange.opacity(0.08))
                        )
                    }

                    // Actions
                    if !source.isOfficial {
                        HStack {
                            Spacer()

                            Button(role: .destructive) {
                                onRemove()
                            } label: {
                                HStack(spacing: 4) {
                                    Image(systemName: "trash")
                                        .font(.system(size: 9))
                                    Text("Remove")
                                        .font(.system(size: 10, weight: .medium))
                                }
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.mini)
                            .tint(.red)
                        }
                    }
                }
                .padding(.horizontal, 12)
                .padding(.bottom, 12)
                .transition(.opacity.combined(with: .move(edge: .top)))
            }
        }
        .background(
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color(NSColor.controlBackgroundColor))
                    .shadow(
                        color: isHovered ? statusColor.opacity(0.15) : .black.opacity(colorScheme == .dark ? 0.2 : 0.05),
                        radius: isHovered ? 8 : 4,
                        y: isHovered ? 3 : 1
                    )

                // Subtle gradient on hover
                if isHovered {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(
                            LinearGradient(
                                colors: [statusColor.opacity(0.04), Color.clear],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                }
            }
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(
                    LinearGradient(
                        colors: source.isEnabled
                            ? [statusColor.opacity(isHovered ? 0.35 : 0.15), statusColor.opacity(isHovered ? 0.15 : 0.05)]
                            : [Color.primary.opacity(0.08), Color.primary.opacity(0.04)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
        )
        .scaleEffect(isHovered ? 1.01 : 1)
        .onHover { isHovered = $0 }
        .animation(.spring(response: 0.25, dampingFraction: 0.75), value: isHovered)
        .animation(.spring(response: 0.35, dampingFraction: 0.8), value: isExpanded)
    }
}

// MARK: - Empty Sources Card

struct EmptySourcesCard: View {
    let onAdd: () -> Void

    @State private var isHovered: Bool = false

    var body: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [Color.blue.opacity(0.15), Color.purple.opacity(0.1)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 48, height: 48)

                Image(systemName: "globe.badge.chevron.backward")
                    .font(.system(size: 22, weight: .medium))
                    .foregroundStyle(
                        LinearGradient(
                            colors: [.blue, .purple],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
            }

            VStack(spacing: 4) {
                Text("No marketplace sources")
                    .font(.system(size: 12, weight: .semibold))

                Text("Add a source to discover plugins")
                    .font(.system(size: 10))
                    .foregroundColor(.secondary)
            }

            Button {
                onAdd()
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: "plus.circle.fill")
                        .font(.system(size: 11))
                    Text("Add Source")
                        .font(.system(size: 11, weight: .medium))
                }
            }
            .buttonStyle(.borderedProminent)
            .tint(.blue)
            .controlSize(.small)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 22)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(NSColor.controlBackgroundColor))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(
                            style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]),
                            antialiased: true
                        )
                        .foregroundStyle(
                            LinearGradient(
                                colors: [Color.blue.opacity(isHovered ? 0.4 : 0.2), Color.purple.opacity(isHovered ? 0.3 : 0.15)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                )
        )
        .scaleEffect(isHovered ? 1.02 : 1)
        .onHover { isHovered = $0 }
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovered)
    }
}

// MARK: - MCP Server Card

struct MCPServerCard: View {
    let serverName: String
    let pluginName: String
    let isActive: Bool

    @Environment(\.colorScheme) private var colorScheme
    @State private var isHovered: Bool = false
    @State private var pulseAnimation: Bool = false

    var body: some View {
        HStack(spacing: 12) {
            // Status icon with animated glow
            ZStack {
                // Pulse effect for active servers
                if isActive {
                    Circle()
                        .fill(Color.purple.opacity(0.2))
                        .frame(width: 32, height: 32)
                        .blur(radius: isHovered ? 6 : 3)
                        .scaleEffect(pulseAnimation ? 1.2 : 1)
                        .opacity(pulseAnimation ? 0.3 : 0.6)
                        .animation(
                            .easeInOut(duration: 1.5).repeatForever(autoreverses: true),
                            value: pulseAnimation
                        )
                }

                Circle()
                    .fill(
                        LinearGradient(
                            colors: isActive
                                ? [Color.purple.opacity(0.2), Color.purple.opacity(0.1)]
                                : [Color.gray.opacity(0.12), Color.gray.opacity(0.08)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 30, height: 30)

                Image(systemName: "server.rack")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundColor(isActive ? .purple : .gray)
                    .scaleEffect(isHovered ? 1.1 : 1)
            }
            .onAppear {
                if isActive {
                    pulseAnimation = true
                }
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(serverName)
                    .font(.system(size: 12, weight: .semibold))

                HStack(spacing: 4) {
                    Image(systemName: "puzzlepiece.extension.fill")
                        .font(.system(size: 8))
                        .foregroundColor(.purple.opacity(0.6))
                    Text(pluginName)
                        .font(.system(size: 9, weight: .medium))
                        .foregroundColor(.secondary)
                }
            }

            Spacer()

            // Status badge with better styling
            HStack(spacing: 5) {
                Circle()
                    .fill(isActive ? Color.green : Color.gray)
                    .frame(width: 6, height: 6)
                    .shadow(color: isActive ? .green.opacity(0.5) : .clear, radius: 3)

                Text(isActive ? "Active" : "Inactive")
                    .font(.system(size: 9, weight: .semibold))
                    .foregroundColor(isActive ? .green : .gray)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 5)
            .background(
                Capsule()
                    .fill(isActive ? Color.green.opacity(0.12) : Color.gray.opacity(0.1))
                    .overlay(
                        Capsule()
                            .strokeBorder(isActive ? Color.green.opacity(0.2) : Color.gray.opacity(0.1), lineWidth: 1)
                    )
            )
        }
        .padding(12)
        .background(
            ZStack {
                RoundedRectangle(cornerRadius: 12)
                    .fill(Color(NSColor.controlBackgroundColor))
                    .shadow(
                        color: isHovered ? Color.purple.opacity(0.12) : .black.opacity(colorScheme == .dark ? 0.15 : 0.04),
                        radius: isHovered ? 8 : 4,
                        y: isHovered ? 3 : 1
                    )

                // Gradient on hover
                if isHovered {
                    RoundedRectangle(cornerRadius: 12)
                        .fill(
                            LinearGradient(
                                colors: [Color.purple.opacity(0.04), Color.clear],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                }
            }
        )
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .strokeBorder(
                    LinearGradient(
                        colors: isHovered
                            ? [Color.purple.opacity(0.3), Color.purple.opacity(0.1)]
                            : [Color.primary.opacity(0.06), Color.primary.opacity(0.03)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
        )
        .scaleEffect(isHovered ? 1.01 : 1)
        .onHover { isHovered = $0 }
        .animation(.spring(response: 0.25, dampingFraction: 0.75), value: isHovered)
    }
}

// MARK: - MCP Empty Card

struct MCPEmptyCard: View {
    @State private var isHovered: Bool = false

    var body: some View {
        VStack(spacing: 10) {
            ZStack {
                Circle()
                    .fill(
                        LinearGradient(
                            colors: [Color.purple.opacity(0.12), Color.purple.opacity(0.06)],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
                    .frame(width: 44, height: 44)

                Image(systemName: "server.rack")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundColor(.purple)
            }

            VStack(spacing: 4) {
                Text("No MCP servers installed")
                    .font(.system(size: 11, weight: .semibold))

                Text("Install plugins with MCP servers to extend capabilities")
                    .font(.system(size: 9))
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 18)
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(NSColor.controlBackgroundColor))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .strokeBorder(
                            style: StrokeStyle(lineWidth: 1.5, dash: [6, 4]),
                            antialiased: true
                        )
                        .foregroundStyle(
                            LinearGradient(
                                colors: [Color.purple.opacity(isHovered ? 0.3 : 0.15), Color.purple.opacity(isHovered ? 0.2 : 0.1)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                )
        )
        .scaleEffect(isHovered ? 1.01 : 1)
        .onHover { isHovered = $0 }
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovered)
    }
}

// MARK: - Mini Stat Card

struct MiniStatCard: View {
    let value: String
    let label: String
    let icon: String
    let color: Color

    @Environment(\.colorScheme) private var colorScheme
    @State private var isHovered: Bool = false

    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                // Subtle glow
                Circle()
                    .fill(color.opacity(0.2))
                    .frame(width: 24, height: 24)
                    .blur(radius: isHovered ? 6 : 3)
                    .scaleEffect(isHovered ? 1.3 : 1)

                Image(systemName: icon)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundColor(color)
                    .scaleEffect(isHovered ? 1.1 : 1)
            }

            Text(value)
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundColor(.primary)
                .contentTransition(.numericText())

            Text(label)
                .font(.system(size: 9, weight: .semibold))
                .foregroundColor(.secondary)
                .textCase(.uppercase)
                .tracking(0.2)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 12)
        .background(
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(color.opacity(colorScheme == .dark ? 0.12 : 0.08))
                    .shadow(
                        color: isHovered ? color.opacity(0.15) : .clear,
                        radius: 8,
                        y: 3
                    )

                // Gradient shine
                RoundedRectangle(cornerRadius: 10)
                    .fill(
                        LinearGradient(
                            colors: [color.opacity(isHovered ? 0.1 : 0.05), Color.clear],
                            startPoint: .topLeading,
                            endPoint: .bottomTrailing
                        )
                    )
            }
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(
                    LinearGradient(
                        colors: [color.opacity(isHovered ? 0.35 : 0.2), color.opacity(isHovered ? 0.15 : 0.1)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
        )
        .scaleEffect(isHovered ? 1.05 : 1)
        .onHover { isHovered = $0 }
        .animation(.spring(response: 0.25, dampingFraction: 0.7), value: isHovered)
    }
}

// MARK: - Preview

#Preview {
    SourcesManagementView()
        .frame(width: 280, height: 500)
}
