//
//  MarketplaceBrowserView.swift
//  claude-maestro
//
//  A beautiful, distinctive marketplace browser with neo-brutalist aesthetics
//

import SwiftUI

// MARK: - Main Marketplace Browser View

struct MarketplaceBrowserView: View {
    @StateObject private var marketplaceManager = MarketplaceManager.shared
    @Environment(\.dismiss) private var dismiss
    @Environment(\.colorScheme) private var colorScheme

    @State private var searchText: String = ""
    @State private var selectedCategory: PluginCategory? = nil
    @State private var selectedType: PluginType? = nil
    @State private var selectedPlugin: MarketplacePlugin? = nil
    @State private var showInstallSheet: Bool = false
    @State private var showAddSource: Bool = false
    @State private var newSourceURL: String = ""
    @State private var installError: String?
    @State private var showErrorAlert: Bool = false
    @State private var hoveredPluginId: String? = nil
    @State private var viewMode: ViewMode = .grid
    @State private var animateHero: Bool = false
    @State private var showSourcesSidebar: Bool = false

    enum ViewMode: String, CaseIterable {
        case grid = "Grid"
        case list = "List"

        var icon: String {
            switch self {
            case .grid: return "square.grid.2x2"
            case .list: return "list.bullet"
            }
        }
    }

    private var isDark: Bool { colorScheme == .dark }

    var body: some View {
        ZStack {
            // Background with subtle texture
            backgroundView

            VStack(spacing: 0) {
                // Dramatic header
                headerView

                // Main content with optional sidebar
                HStack(spacing: 0) {
                    // Main scroll content
                    ScrollView {
                        VStack(spacing: 0) {
                            // Hero/Featured section
                            if searchText.isEmpty && selectedCategory == nil {
                                heroSection
                            }

                            // Category chips
                            categoryChipsSection

                            // Plugin grid/list
                            pluginGridSection
                        }
                    }

                    // Sources sidebar
                    if showSourcesSidebar {
                        Divider()

                        SourcesManagementView()
                            .frame(width: 280)
                            .transition(.move(edge: .trailing).combined(with: .opacity))
                    }
                }
            }
        }
        .frame(width: showSourcesSidebar ? 1180 : 900, height: 700)
        .animation(.spring(response: 0.3), value: showSourcesSidebar)
        .onAppear {
            withAnimation(.easeOut(duration: 0.8).delay(0.2)) {
                animateHero = true
            }
            if marketplaceManager.availablePlugins.isEmpty {
                Task { await marketplaceManager.refreshMarketplaces() }
            }
        }
        .sheet(isPresented: $showInstallSheet) {
            if let plugin = selectedPlugin {
                PluginInstallSheetV2(
                    plugin: plugin,
                    onInstall: { scope, projectPath in
                        Task {
                            do {
                                _ = try await marketplaceManager.installPlugin(plugin, scope: scope, projectPath: projectPath)
                                showInstallSheet = false
                            } catch {
                                installError = error.localizedDescription
                                showErrorAlert = true
                            }
                        }
                    },
                    onCancel: { showInstallSheet = false }
                )
            }
        }
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
        .alert("Installation Failed", isPresented: $showErrorAlert) {
            Button("OK") { installError = nil }
        } message: {
            Text(installError ?? "Unknown error")
        }
    }

    // MARK: - Background

    private var backgroundView: some View {
        ZStack {
            // Base gradient
            LinearGradient(
                colors: isDark
                    ? [Color(NSColor.windowBackgroundColor), Color(NSColor.controlBackgroundColor)]
                    : [Color(NSColor.windowBackgroundColor), Color(NSColor.controlBackgroundColor)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            // Noise texture overlay
            NoiseTextureView(opacity: isDark ? 0.03 : 0.02)

            // Gradient orbs for atmosphere
            GeometryReader { geo in
                Circle()
                    .fill(
                        RadialGradient(
                            colors: [Color.purple.opacity(0.15), Color.clear],
                            center: .center,
                            startRadius: 0,
                            endRadius: 200
                        )
                    )
                    .frame(width: 400, height: 400)
                    .blur(radius: 60)
                    .offset(x: -100, y: -50)

                Circle()
                    .fill(
                        RadialGradient(
                            colors: [Color.blue.opacity(0.12), Color.clear],
                            center: .center,
                            startRadius: 0,
                            endRadius: 200
                        )
                    )
                    .frame(width: 350, height: 350)
                    .blur(radius: 50)
                    .offset(x: geo.size.width - 200, y: geo.size.height - 250)
            }
        }
        .ignoresSafeArea()
    }

    // MARK: - Header

    private var headerView: some View {
        VStack(spacing: 0) {
            HStack(alignment: .center, spacing: 16) {
                // Title with icon
                HStack(spacing: 12) {
                    ZStack {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(
                                LinearGradient(
                                    colors: [Color.purple, Color.blue],
                                    startPoint: .topLeading,
                                    endPoint: .bottomTrailing
                                )
                            )
                            .frame(width: 40, height: 40)

                        Image(systemName: "square.grid.3x3.fill")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundColor(.white)
                    }

                    VStack(alignment: .leading, spacing: 2) {
                        Text("Marketplace")
                            .font(.system(size: 20, weight: .bold, design: .rounded))
                        Text("\(marketplaceManager.availablePlugins.count) extensions available")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundColor(.secondary)
                    }
                }

                Spacer()

                // View mode toggle
                HStack(spacing: 4) {
                    ForEach(ViewMode.allCases, id: \.self) { mode in
                        Button {
                            withAnimation(.spring(response: 0.3)) {
                                viewMode = mode
                            }
                        } label: {
                            Image(systemName: mode.icon)
                                .font(.system(size: 12, weight: .medium))
                                .foregroundColor(viewMode == mode ? .white : .secondary)
                                .frame(width: 28, height: 28)
                                .background(
                                    viewMode == mode
                                        ? Color.accentColor
                                        : Color.clear
                                )
                                .cornerRadius(6)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(4)
                .background(Color(NSColor.controlBackgroundColor).opacity(0.8))
                .cornerRadius(10)

                // Search bar
                HStack(spacing: 8) {
                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundColor(.secondary)

                    TextField("Search plugins, skills, MCP servers...", text: $searchText)
                        .textFieldStyle(.plain)
                        .font(.system(size: 13))

                    if !searchText.isEmpty {
                        Button {
                            withAnimation { searchText = "" }
                        } label: {
                            Image(systemName: "xmark.circle.fill")
                                .font(.system(size: 12))
                                .foregroundColor(.secondary)
                        }
                        .buttonStyle(.plain)
                    }
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color(NSColor.textBackgroundColor).opacity(0.8))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .strokeBorder(Color.primary.opacity(0.08), lineWidth: 1)
                        )
                )
                .frame(width: 280)

                // Action buttons
                HStack(spacing: 8) {
                    // Sources sidebar toggle
                    Button {
                        withAnimation(.spring(response: 0.3)) {
                            showSourcesSidebar.toggle()
                        }
                    } label: {
                        Image(systemName: showSourcesSidebar ? "sidebar.right" : "sidebar.left")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .buttonStyle(.bordered)
                    .tint(showSourcesSidebar ? .accentColor : nil)
                    .help("Toggle sources sidebar")

                    Button {
                        showAddSource = true
                    } label: {
                        Label("Add Source", systemImage: "link.badge.plus")
                            .font(.system(size: 12, weight: .medium))
                    }
                    .buttonStyle(.bordered)

                    if marketplaceManager.isLoading {
                        ProgressView()
                            .scaleEffect(0.7)
                            .frame(width: 24)
                    } else {
                        Button {
                            Task { await marketplaceManager.refreshMarketplaces() }
                        } label: {
                            Image(systemName: "arrow.clockwise")
                                .font(.system(size: 12, weight: .medium))
                        }
                        .buttonStyle(.bordered)
                    }
                }

                Button { dismiss() } label: {
                    Image(systemName: "xmark")
                        .font(.system(size: 12, weight: .bold))
                        .foregroundColor(.secondary)
                        .frame(width: 28, height: 28)
                        .background(Color(NSColor.controlBackgroundColor).opacity(0.8))
                        .cornerRadius(8)
                }
                .buttonStyle(.plain)
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 16)

            // Subtle separator
            Rectangle()
                .fill(
                    LinearGradient(
                        colors: [Color.clear, Color.primary.opacity(0.1), Color.clear],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                )
                .frame(height: 1)
        }
    }

    // MARK: - Hero Section

    private var heroSection: some View {
        VStack(spacing: 16) {
            // Featured plugins carousel
            if let featured = filteredPlugins.prefix(3).first {
                HStack(spacing: 16) {
                    // Main featured card
                    FeaturedPluginCard(
                        plugin: featured,
                        isInstalled: marketplaceManager.isInstalled(featured),
                        onInstall: {
                            selectedPlugin = featured
                            showInstallSheet = true
                        }
                    )
                    .frame(maxWidth: .infinity)
                    .scaleEffect(animateHero ? 1 : 0.95)
                    .opacity(animateHero ? 1 : 0)

                    // Stats sidebar
                    VStack(spacing: 12) {
                        StatCard(
                            icon: "puzzlepiece.extension.fill",
                            value: "\(marketplaceManager.availablePlugins.count)",
                            label: "Total Plugins",
                            color: .purple
                        )

                        StatCard(
                            icon: "checkmark.circle.fill",
                            value: "\(marketplaceManager.installedPlugins.count)",
                            label: "Installed",
                            color: .green
                        )

                        StatCard(
                            icon: "globe",
                            value: "\(marketplaceManager.sources.filter { $0.isEnabled }.count)",
                            label: "Sources",
                            color: .blue
                        )
                    }
                    .frame(width: 140)
                    .opacity(animateHero ? 1 : 0)
                    .offset(x: animateHero ? 0 : 20)
                }
            }
        }
        .padding(.horizontal, 24)
        .padding(.top, 20)
        .padding(.bottom, 8)
    }

    // MARK: - Category Chips

    private var categoryChipsSection: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                // All button
                CategoryChip(
                    label: "All",
                    icon: "square.grid.2x2",
                    isSelected: selectedCategory == nil && selectedType == nil,
                    color: .gray
                ) {
                    withAnimation(.spring(response: 0.3)) {
                        selectedCategory = nil
                        selectedType = nil
                    }
                }

                Divider()
                    .frame(height: 24)
                    .padding(.horizontal, 4)

                // Category chips
                ForEach(PluginCategory.allCases) { category in
                    CategoryChip(
                        label: category.rawValue,
                        icon: category.icon,
                        isSelected: selectedCategory == category,
                        color: category.color
                    ) {
                        withAnimation(.spring(response: 0.3)) {
                            selectedCategory = selectedCategory == category ? nil : category
                        }
                    }
                }

                Divider()
                    .frame(height: 24)
                    .padding(.horizontal, 4)

                // Type chips
                ForEach(PluginType.allCases) { type in
                    CategoryChip(
                        label: type.displayName,
                        icon: type.icon,
                        isSelected: selectedType == type,
                        color: type.color
                    ) {
                        withAnimation(.spring(response: 0.3)) {
                            selectedType = selectedType == type ? nil : type
                        }
                    }
                }
            }
            .padding(.horizontal, 24)
            .padding(.vertical, 12)
        }
    }

    // MARK: - Plugin Grid

    private var pluginGridSection: some View {
        Group {
            if filteredPlugins.isEmpty {
                emptyStateView
            } else {
                switch viewMode {
                case .grid:
                    LazyVGrid(
                        columns: [
                            GridItem(.flexible(), spacing: 16),
                            GridItem(.flexible(), spacing: 16),
                            GridItem(.flexible(), spacing: 16)
                        ],
                        spacing: 16
                    ) {
                        ForEach(filteredPlugins) { plugin in
                            PluginCardV2(
                                plugin: plugin,
                                isInstalled: marketplaceManager.isInstalled(plugin),
                                isHovered: hoveredPluginId == plugin.id,
                                onInstall: {
                                    selectedPlugin = plugin
                                    showInstallSheet = true
                                }
                            )
                            .onHover { isHovered in
                                withAnimation(.easeInOut(duration: 0.15)) {
                                    hoveredPluginId = isHovered ? plugin.id : nil
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.bottom, 24)

                case .list:
                    LazyVStack(spacing: 8) {
                        ForEach(filteredPlugins) { plugin in
                            PluginListRow(
                                plugin: plugin,
                                isInstalled: marketplaceManager.isInstalled(plugin),
                                isHovered: hoveredPluginId == plugin.id,
                                onInstall: {
                                    selectedPlugin = plugin
                                    showInstallSheet = true
                                }
                            )
                            .onHover { isHovered in
                                withAnimation(.easeInOut(duration: 0.15)) {
                                    hoveredPluginId = isHovered ? plugin.id : nil
                                }
                            }
                        }
                    }
                    .padding(.horizontal, 24)
                    .padding(.bottom, 24)
                }
            }
        }
    }

    // MARK: - Empty State

    private var emptyStateView: some View {
        VStack(spacing: 16) {
            ZStack {
                Circle()
                    .fill(Color.purple.opacity(0.1))
                    .frame(width: 80, height: 80)

                Image(systemName: "puzzlepiece.extension")
                    .font(.system(size: 32))
                    .foregroundColor(.purple)
            }

            Text("No plugins found")
                .font(.system(size: 18, weight: .semibold, design: .rounded))

            Text("Try adjusting your search or filters")
                .font(.system(size: 13))
                .foregroundColor(.secondary)

            if marketplaceManager.availablePlugins.isEmpty {
                Button {
                    Task { await marketplaceManager.refreshMarketplaces() }
                } label: {
                    Label("Refresh Marketplace", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.borderedProminent)
                .padding(.top, 8)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 60)
    }

    // MARK: - Filtered Plugins

    private var filteredPlugins: [MarketplacePlugin] {
        var plugins = marketplaceManager.availablePlugins

        if let category = selectedCategory {
            plugins = plugins.filter { $0.category == category }
        }

        if let type = selectedType {
            plugins = plugins.filter { $0.types.contains(type) }
        }

        if !searchText.isEmpty {
            plugins = plugins.filter {
                $0.name.localizedCaseInsensitiveContains(searchText) ||
                $0.description.localizedCaseInsensitiveContains(searchText) ||
                $0.tags.contains { $0.localizedCaseInsensitiveContains(searchText) }
            }
        }

        return plugins
    }
}

// MARK: - Featured Plugin Card

struct FeaturedPluginCard: View {
    let plugin: MarketplacePlugin
    let isInstalled: Bool
    let onInstall: () -> Void

    @Environment(\.colorScheme) private var colorScheme
    @State private var isHovered: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header gradient bar with animated shine
            ZStack(alignment: .topLeading) {
                // Base gradient
                LinearGradient(
                    colors: [plugin.primaryType.color, plugin.primaryType.color.opacity(0.75)],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )

                // Animated shine overlay
                if isHovered {
                    LinearGradient(
                        colors: [Color.white.opacity(0), Color.white.opacity(0.15), Color.white.opacity(0)],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .frame(width: 150)
                    .offset(x: isHovered ? 500 : -150)
                    .animation(.easeInOut(duration: 0.8), value: isHovered)
                }

                HStack {
                    // Type badge
                    HStack(spacing: 6) {
                        Image(systemName: plugin.primaryType.icon)
                            .font(.system(size: 12, weight: .bold))
                        Text(plugin.primaryType.displayName.uppercased())
                            .font(.system(size: 10, weight: .bold, design: .rounded))
                            .tracking(0.8)
                    }
                    .foregroundColor(.white)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(
                        Capsule()
                            .fill(Color.white.opacity(0.2))
                            .overlay(
                                Capsule()
                                    .strokeBorder(Color.white.opacity(0.3), lineWidth: 1)
                            )
                    )

                    Spacer()

                    // Featured badge with star
                    HStack(spacing: 5) {
                        Image(systemName: "star.fill")
                            .font(.system(size: 9))
                        Text("FEATURED")
                            .font(.system(size: 9, weight: .bold, design: .rounded))
                            .tracking(1.2)
                    }
                    .foregroundColor(.white.opacity(0.9))
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(
                        Capsule()
                            .fill(Color.white.opacity(0.15))
                    )
                }
                .padding(18)
            }
            .frame(height: 60)
            .clipShape(
                UnevenRoundedRectangle(topLeadingRadius: 16, topTrailingRadius: 16)
            )

            // Content
            VStack(alignment: .leading, spacing: 14) {
                HStack(alignment: .top, spacing: 16) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text(plugin.name)
                            .font(.system(size: 24, weight: .bold, design: .rounded))

                        Text(plugin.description)
                            .font(.system(size: 13))
                            .foregroundColor(.secondary)
                            .lineLimit(2)
                    }

                    Spacer()

                    // Install button with enhanced styling
                    if isInstalled {
                        HStack(spacing: 6) {
                            Image(systemName: "checkmark.circle.fill")
                                .font(.system(size: 14))
                            Text("Installed")
                                .font(.system(size: 12, weight: .semibold))
                        }
                        .foregroundColor(.green)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 10)
                        .background(
                            RoundedRectangle(cornerRadius: 10)
                                .fill(Color.green.opacity(0.12))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 10)
                                        .strokeBorder(Color.green.opacity(0.2), lineWidth: 1)
                                )
                        )
                    } else {
                        Button {
                            onInstall()
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "arrow.down.circle.fill")
                                    .font(.system(size: 13))
                                Text("Install")
                                    .font(.system(size: 13, weight: .semibold))
                            }
                        }
                        .buttonStyle(.borderedProminent)
                        .tint(plugin.primaryType.color)
                        .controlSize(.regular)
                    }
                }

                // Meta info with improved styling
                HStack(spacing: 14) {
                    HStack(spacing: 5) {
                        Image(systemName: "person.fill")
                            .font(.system(size: 10))
                            .foregroundColor(plugin.primaryType.color.opacity(0.7))
                        Text(plugin.author)
                    }

                    HStack(spacing: 5) {
                        Image(systemName: "tag.fill")
                            .font(.system(size: 10))
                            .foregroundColor(plugin.primaryType.color.opacity(0.7))
                        Text("v\(plugin.version)")
                    }

                    HStack(spacing: 5) {
                        Image(systemName: plugin.category.icon)
                            .font(.system(size: 10))
                            .foregroundColor(plugin.primaryType.color.opacity(0.7))
                        Text(plugin.category.rawValue)
                    }

                    Spacer()

                    // Tags with better styling
                    HStack(spacing: 6) {
                        ForEach(plugin.tags.prefix(3), id: \.self) { tag in
                            Text(tag)
                                .font(.system(size: 10, weight: .medium))
                                .padding(.horizontal, 9)
                                .padding(.vertical, 5)
                                .background(
                                    Capsule()
                                        .fill(plugin.primaryType.color.opacity(0.08))
                                )
                        }
                    }
                }
                .font(.system(size: 11, weight: .medium))
                .foregroundColor(.secondary)
            }
            .padding(18)
        }
        .background(
            ZStack {
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color(NSColor.controlBackgroundColor))
                    .shadow(
                        color: isHovered ? plugin.primaryType.color.opacity(0.2) : .black.opacity(colorScheme == .dark ? 0.4 : 0.1),
                        radius: isHovered ? 24 : 12,
                        y: isHovered ? 10 : 5
                    )

                // Gradient glow on hover
                if isHovered {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(
                            LinearGradient(
                                colors: [plugin.primaryType.color.opacity(0.05), Color.clear],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                }
            }
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(
                    isHovered ? plugin.primaryType.color.opacity(0.2) : Color.primary.opacity(0.06),
                    lineWidth: 1
                )
        )
        .clipShape(RoundedRectangle(cornerRadius: 16))
        .scaleEffect(isHovered ? 1.015 : 1)
        .onHover { isHovered = $0 }
        .animation(.spring(response: 0.35, dampingFraction: 0.75), value: isHovered)
    }
}

// MARK: - Plugin Card V2

struct PluginCardV2: View {
    let plugin: MarketplacePlugin
    let isInstalled: Bool
    let isHovered: Bool
    let onInstall: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header with icon and glow
            HStack(spacing: 12) {
                // Plugin icon with glow effect
                ZStack {
                    // Glow when hovered
                    if isHovered {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(plugin.primaryType.color.opacity(0.3))
                            .frame(width: 48, height: 48)
                            .blur(radius: 10)
                    }

                    RoundedRectangle(cornerRadius: 12)
                        .fill(
                            LinearGradient(
                                colors: [plugin.primaryType.color, plugin.primaryType.color.opacity(0.7)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 46, height: 46)
                        .shadow(
                            color: plugin.primaryType.color.opacity(isHovered ? 0.4 : 0.25),
                            radius: isHovered ? 10 : 6,
                            y: isHovered ? 4 : 2
                        )

                    Image(systemName: plugin.primaryType.icon)
                        .font(.system(size: 20, weight: .semibold))
                        .foregroundColor(.white)
                        .scaleEffect(isHovered ? 1.1 : 1)
                }

                VStack(alignment: .leading, spacing: 3) {
                    Text(plugin.name)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .lineLimit(1)

                    HStack(spacing: 5) {
                        Text(plugin.author)
                            .font(.system(size: 11))
                            .foregroundColor(.secondary)

                        Text("v\(plugin.version)")
                            .font(.system(size: 9, weight: .semibold))
                            .foregroundColor(plugin.primaryType.color.opacity(0.8))
                            .padding(.horizontal, 6)
                            .padding(.vertical, 2)
                            .background(plugin.primaryType.color.opacity(0.1))
                            .cornerRadius(4)
                    }
                }

                Spacer()
            }

            // Description
            Text(plugin.description)
                .font(.system(size: 12))
                .foregroundColor(.secondary)
                .lineLimit(2)
                .frame(maxWidth: .infinity, alignment: .leading)

            Spacer(minLength: 0)

            // Footer with type badges
            HStack {
                // Type badges with better styling
                HStack(spacing: 5) {
                    ForEach(plugin.types.prefix(2), id: \.self) { type in
                        HStack(spacing: 4) {
                            Image(systemName: type.icon)
                                .font(.system(size: 9, weight: .medium))
                            Text(type.displayName)
                                .font(.system(size: 9, weight: .semibold))
                        }
                        .foregroundColor(type.color)
                        .padding(.horizontal, 7)
                        .padding(.vertical, 4)
                        .background(
                            Capsule()
                                .fill(type.color.opacity(0.12))
                        )
                    }
                }

                Spacer()

                // Install button with glow
                if isInstalled {
                    HStack(spacing: 4) {
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 14))
                        Text("Installed")
                            .font(.system(size: 10, weight: .medium))
                    }
                    .foregroundColor(.green)
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.green.opacity(0.1))
                    .cornerRadius(6)
                } else {
                    Button {
                        onInstall()
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: "arrow.down.circle.fill")
                                .font(.system(size: 11))
                            Text("Install")
                                .font(.system(size: 11, weight: .semibold))
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .tint(plugin.primaryType.color)
                    .controlSize(.small)
                }
            }
        }
        .padding(16)
        .frame(height: 170)
        .background(
            ZStack {
                RoundedRectangle(cornerRadius: 16)
                    .fill(Color(NSColor.controlBackgroundColor))
                    .shadow(
                        color: isHovered ? plugin.primaryType.color.opacity(0.15) : .black.opacity(colorScheme == .dark ? 0.3 : 0.08),
                        radius: isHovered ? 16 : 8,
                        y: isHovered ? 8 : 3
                    )

                // Gradient overlay on hover
                if isHovered {
                    RoundedRectangle(cornerRadius: 16)
                        .fill(
                            LinearGradient(
                                colors: [plugin.primaryType.color.opacity(0.06), Color.clear],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                }
            }
        )
        .overlay(
            RoundedRectangle(cornerRadius: 16)
                .strokeBorder(
                    LinearGradient(
                        colors: isHovered
                            ? [plugin.primaryType.color.opacity(0.4), plugin.primaryType.color.opacity(0.2)]
                            : [Color.primary.opacity(0.08), Color.primary.opacity(0.04)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
        )
        .scaleEffect(isHovered ? 1.025 : 1)
        .animation(.spring(response: 0.3, dampingFraction: 0.75), value: isHovered)
    }
}

// MARK: - Plugin List Row

struct PluginListRow: View {
    let plugin: MarketplacePlugin
    let isInstalled: Bool
    let isHovered: Bool
    let onInstall: () -> Void

    @Environment(\.colorScheme) private var colorScheme

    var body: some View {
        HStack(spacing: 14) {
            // Icon
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(plugin.primaryType.color.opacity(0.15))
                    .frame(width: 40, height: 40)

                Image(systemName: plugin.primaryType.icon)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(plugin.primaryType.color)
            }

            // Info
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 8) {
                    Text(plugin.name)
                        .font(.system(size: 13, weight: .semibold))

                    Text("v\(plugin.version)")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundColor(.secondary)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(Color.primary.opacity(0.05))
                        .cornerRadius(3)

                    ForEach(plugin.types.prefix(2), id: \.self) { type in
                        HStack(spacing: 2) {
                            Image(systemName: type.icon)
                                .font(.system(size: 8))
                            Text(type.displayName)
                                .font(.system(size: 9, weight: .medium))
                        }
                        .foregroundColor(type.color)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 2)
                        .background(type.color.opacity(0.1))
                        .cornerRadius(3)
                    }
                }

                Text(plugin.description)
                    .font(.system(size: 11))
                    .foregroundColor(.secondary)
                    .lineLimit(1)
            }

            Spacer()

            // Author
            Label(plugin.author, systemImage: "person.fill")
                .font(.system(size: 10))
                .foregroundColor(.secondary)

            // Install
            if isInstalled {
                Label("Installed", systemImage: "checkmark.circle.fill")
                    .font(.system(size: 11, weight: .medium))
                    .foregroundColor(.green)
            } else {
                Button { onInstall() } label: {
                    Text("Install")
                        .font(.system(size: 11, weight: .medium))
                }
                .buttonStyle(.borderedProminent)
                .controlSize(.small)
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color(NSColor.controlBackgroundColor))
                .shadow(color: .black.opacity(colorScheme == .dark ? 0.2 : 0.05), radius: isHovered ? 8 : 4, y: 2)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10)
                .strokeBorder(
                    isHovered ? plugin.primaryType.color.opacity(0.2) : Color.clear,
                    lineWidth: 1
                )
        )
        .scaleEffect(isHovered ? 1.005 : 1)
        .animation(.easeOut(duration: 0.15), value: isHovered)
    }
}

// MARK: - Category Chip

struct CategoryChip: View {
    let label: String
    let icon: String
    let isSelected: Bool
    let color: Color
    let action: () -> Void

    @State private var isHovered: Bool = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 6) {
                Image(systemName: icon)
                    .font(.system(size: 10, weight: .medium))
                Text(label)
                    .font(.system(size: 11, weight: .medium))
            }
            .foregroundColor(isSelected ? .white : (isHovered ? color : .primary))
            .padding(.horizontal, 12)
            .padding(.vertical, 7)
            .background(
                Capsule()
                    .fill(
                        isSelected
                            ? color
                            : (isHovered ? color.opacity(0.1) : Color.primary.opacity(0.05))
                    )
            )
            .overlay(
                Capsule()
                    .strokeBorder(
                        isSelected ? Color.clear : color.opacity(isHovered ? 0.3 : 0),
                        lineWidth: 1
                    )
            )
        }
        .buttonStyle(.plain)
        .onHover { isHovered = $0 }
        .animation(.easeOut(duration: 0.15), value: isHovered)
    }
}

// MARK: - Stat Card

struct StatCard: View {
    let icon: String
    let value: String
    let label: String
    let color: Color

    @Environment(\.colorScheme) private var colorScheme
    @State private var isHovered: Bool = false
    @State private var isAnimating: Bool = false

    var body: some View {
        VStack(spacing: 8) {
            ZStack {
                // Glow background
                Circle()
                    .fill(color.opacity(0.15))
                    .frame(width: 36, height: 36)
                    .blur(radius: isHovered ? 8 : 4)
                    .scaleEffect(isHovered ? 1.2 : 1)

                Image(systemName: icon)
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundColor(color)
                    .scaleEffect(isHovered ? 1.15 : 1)
            }

            Text(value)
                .font(.system(size: 24, weight: .bold, design: .rounded))
                .foregroundColor(.primary)
                .contentTransition(.numericText())

            Text(label)
                .font(.system(size: 10, weight: .semibold))
                .foregroundColor(.secondary)
                .textCase(.uppercase)
                .tracking(0.3)
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, 16)
        .background(
            ZStack {
                RoundedRectangle(cornerRadius: 14)
                    .fill(Color(NSColor.controlBackgroundColor))
                    .shadow(
                        color: isHovered ? color.opacity(0.2) : .black.opacity(colorScheme == .dark ? 0.2 : 0.05),
                        radius: isHovered ? 12 : 6,
                        y: isHovered ? 6 : 3
                    )

                // Subtle gradient overlay
                RoundedRectangle(cornerRadius: 14)
                    .fill(
                        LinearGradient(
                            colors: [color.opacity(isHovered ? 0.08 : 0.03), Color.clear],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
            }
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(
                    LinearGradient(
                        colors: [color.opacity(isHovered ? 0.4 : 0.2), color.opacity(isHovered ? 0.2 : 0.1)],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    ),
                    lineWidth: 1
                )
        )
        .scaleEffect(isHovered ? 1.03 : 1)
        .onHover { isHovered = $0 }
        .animation(.spring(response: 0.3, dampingFraction: 0.7), value: isHovered)
    }
}

// MARK: - Noise Texture View

struct NoiseTextureView: View {
    let opacity: Double

    var body: some View {
        Canvas { context, size in
            for _ in 0..<Int(size.width * size.height * 0.01) {
                let x = Double.random(in: 0..<size.width)
                let y = Double.random(in: 0..<size.height)
                let gray = Double.random(in: 0...1)

                context.fill(
                    Path(ellipseIn: CGRect(x: x, y: y, width: 1, height: 1)),
                    with: .color(Color(white: gray, opacity: opacity))
                )
            }
        }
    }
}

// MARK: - Plugin Install Sheet V2

struct PluginInstallSheetV2: View {
    let plugin: MarketplacePlugin
    let onInstall: (InstallScope, String?) -> Void
    let onCancel: () -> Void

    @StateObject private var skillManager = SkillManager.shared
    @State private var selectedScope: InstallScope = .user
    @State private var projectPath: String = ""
    @Environment(\.colorScheme) private var colorScheme

    /// Whether the current scope requires a project path
    private var requiresProjectPath: Bool {
        selectedScope == .project || selectedScope == .local
    }

    /// Whether the install button should be enabled
    private var canInstall: Bool {
        if requiresProjectPath {
            return !projectPath.isEmpty
        }
        return true
    }

    /// Whether we have a detected project path from the app
    private var hasDetectedProject: Bool {
        skillManager.currentProjectPath != nil && !skillManager.currentProjectPath!.isEmpty
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header with gradient
            VStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [plugin.primaryType.color, plugin.primaryType.color.opacity(0.6)],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 56, height: 56)

                    Image(systemName: plugin.primaryType.icon)
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundColor(.white)
                }

                Text(plugin.name)
                    .font(.system(size: 18, weight: .bold, design: .rounded))

                Text(plugin.description)
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
            }
            .padding(24)
            .frame(maxWidth: .infinity)
            .background(
                LinearGradient(
                    colors: [
                        plugin.primaryType.color.opacity(0.15),
                        Color.clear
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )

            Divider()

            // Scope selection
            VStack(alignment: .leading, spacing: 12) {
                Text("Installation Scope")
                    .font(.system(size: 13, weight: .semibold))

                VStack(spacing: 8) {
                    ForEach(InstallScope.allCases) { scope in
                        ScopeOptionRow(
                            scope: scope,
                            isSelected: selectedScope == scope,
                            onSelect: { selectedScope = scope }
                        )
                    }
                }

                // Project path selector (shown when Project or Local scope is selected)
                if requiresProjectPath {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Project Directory")
                                .font(.system(size: 13, weight: .semibold))

                            if hasDetectedProject && projectPath == skillManager.currentProjectPath {
                                Text("(auto-detected)")
                                    .font(.system(size: 11))
                                    .foregroundColor(.green)
                            }
                        }
                        .padding(.top, 8)

                        HStack(spacing: 8) {
                            HStack(spacing: 8) {
                                Image(systemName: hasDetectedProject && projectPath == skillManager.currentProjectPath ? "checkmark.circle.fill" : "folder.fill")
                                    .font(.system(size: 12))
                                    .foregroundColor(hasDetectedProject && projectPath == skillManager.currentProjectPath ? .green : .secondary)

                                if projectPath.isEmpty {
                                    Text("No directory selected")
                                        .font(.system(size: 12))
                                        .foregroundColor(.secondary)
                                } else {
                                    Text(projectPath)
                                        .font(.system(size: 12))
                                        .lineLimit(1)
                                        .truncationMode(.middle)
                                }

                                Spacer()
                            }
                            .padding(10)
                            .frame(maxWidth: .infinity)
                            .background(
                                RoundedRectangle(cornerRadius: 8)
                                    .fill(Color(NSColor.textBackgroundColor))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 8)
                                            .strokeBorder(
                                                hasDetectedProject && projectPath == skillManager.currentProjectPath
                                                    ? Color.green.opacity(0.3)
                                                    : Color.primary.opacity(0.1),
                                                lineWidth: 1
                                            )
                                    )
                            )

                            Button {
                                selectProjectDirectory()
                            } label: {
                                Image(systemName: "folder.badge.plus")
                                    .font(.system(size: 14))
                            }
                            .buttonStyle(.bordered)
                            .help("Select a different directory")
                        }

                        if projectPath.isEmpty {
                            HStack(spacing: 4) {
                                Image(systemName: "exclamationmark.triangle.fill")
                                    .font(.system(size: 10))
                                Text("Please select the project directory")
                                    .font(.system(size: 11))
                            }
                            .foregroundColor(.orange)
                        } else {
                            HStack(spacing: 4) {
                                Image(systemName: "info.circle")
                                    .font(.system(size: 10))
                                Text(selectedScope == .project
                                    ? "Plugin will be installed to .claude/plugins/ (shared with collaborators)"
                                    : "Plugin will be installed to .claude.local/plugins/ (local only)")
                                    .font(.system(size: 11))
                            }
                            .foregroundColor(.secondary)
                        }
                    }
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }
            }
            .padding(20)
            .animation(.spring(response: 0.3), value: requiresProjectPath)

            Divider()

            // Actions
            HStack(spacing: 12) {
                Button("Cancel") { onCancel() }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.escape)

                Spacer()

                Button {
                    onInstall(selectedScope, requiresProjectPath ? projectPath : nil)
                } label: {
                    Label("Install Plugin", systemImage: "arrow.down.circle.fill")
                }
                .buttonStyle(.borderedProminent)
                .tint(plugin.primaryType.color)
                .keyboardShortcut(.return)
                .disabled(!canInstall)
            }
            .padding(20)
        }
        .frame(width: 380)
        .onAppear {
            // Pre-fill with the current project path if available
            if let currentPath = skillManager.currentProjectPath, !currentPath.isEmpty {
                projectPath = currentPath
            }
        }
    }

    /// Opens a directory picker for selecting the project path
    private func selectProjectDirectory() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.message = "Select project directory for plugin installation"
        panel.prompt = "Select"

        if panel.runModal() == .OK {
            projectPath = panel.url?.path ?? ""
        }
    }
}

// MARK: - Scope Option Row

struct ScopeOptionRow: View {
    let scope: InstallScope
    let isSelected: Bool
    let onSelect: () -> Void

    var body: some View {
        Button(action: onSelect) {
            HStack(spacing: 12) {
                ZStack {
                    Circle()
                        .strokeBorder(isSelected ? Color.accentColor : Color.secondary.opacity(0.3), lineWidth: 2)
                        .frame(width: 20, height: 20)

                    if isSelected {
                        Circle()
                            .fill(Color.accentColor)
                            .frame(width: 10, height: 10)
                    }
                }

                Image(systemName: scope.icon)
                    .font(.system(size: 14))
                    .foregroundColor(isSelected ? .accentColor : .secondary)
                    .frame(width: 20)

                VStack(alignment: .leading, spacing: 2) {
                    Text(scope.rawValue)
                        .font(.system(size: 13, weight: .medium))
                    Text(scope.description)
                        .font(.system(size: 11))
                        .foregroundColor(.secondary)
                }

                Spacer()
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(isSelected ? Color.accentColor.opacity(0.1) : Color.clear)
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .strokeBorder(
                                isSelected ? Color.accentColor.opacity(0.3) : Color.primary.opacity(0.1),
                                lineWidth: 1
                            )
                    )
            )
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Add Source Sheet V2

struct AddSourceSheetV2: View {
    @Binding var sourceURL: String
    let onAdd: () -> Void
    let onCancel: () -> Void

    @State private var isValidating: Bool = false

    var body: some View {
        VStack(spacing: 0) {
            // Header
            VStack(spacing: 12) {
                ZStack {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [.blue, .purple],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .frame(width: 56, height: 56)

                    Image(systemName: "link.badge.plus")
                        .font(.system(size: 24, weight: .semibold))
                        .foregroundColor(.white)
                }

                Text("Add Marketplace Source")
                    .font(.system(size: 18, weight: .bold, design: .rounded))

                Text("Connect to a third-party plugin marketplace")
                    .font(.system(size: 12))
                    .foregroundColor(.secondary)
            }
            .padding(24)
            .frame(maxWidth: .infinity)
            .background(
                LinearGradient(
                    colors: [Color.blue.opacity(0.1), Color.clear],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )

            Divider()

            // Input
            VStack(alignment: .leading, spacing: 12) {
                Text("Repository URL")
                    .font(.system(size: 13, weight: .semibold))

                HStack(spacing: 10) {
                    Image(systemName: "link")
                        .foregroundColor(.secondary)

                    TextField("owner/repo or https://github.com/owner/repo", text: $sourceURL)
                        .textFieldStyle(.plain)
                }
                .padding(12)
                .background(
                    RoundedRectangle(cornerRadius: 10)
                        .fill(Color(NSColor.textBackgroundColor))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10)
                                .strokeBorder(Color.primary.opacity(0.1), lineWidth: 1)
                        )
                )

                HStack(spacing: 6) {
                    Image(systemName: "info.circle")
                        .font(.system(size: 11))
                    Text("Repository must contain a .claude-plugin/marketplace.json file")
                        .font(.system(size: 11))
                }
                .foregroundColor(.secondary)
            }
            .padding(20)

            Divider()

            // Actions
            HStack(spacing: 12) {
                Button("Cancel") { onCancel() }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.escape)

                Spacer()

                Button {
                    isValidating = true
                    onAdd()
                } label: {
                    if isValidating {
                        ProgressView()
                            .scaleEffect(0.7)
                    } else {
                        Label("Add Source", systemImage: "plus.circle.fill")
                    }
                }
                .buttonStyle(.borderedProminent)
                .keyboardShortcut(.return)
                .disabled(sourceURL.isEmpty || isValidating)
            }
            .padding(20)
        }
        .frame(width: 420)
    }
}

// MARK: - Preview

#Preview {
    MarketplaceBrowserView()
}
