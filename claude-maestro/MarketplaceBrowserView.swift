//
//  MarketplaceBrowserView.swift
//  claude-maestro
//
//  Marketplace browser for discovering and installing plugins
//

import SwiftUI

struct MarketplaceBrowserView: View {
    @StateObject private var marketplaceManager = MarketplaceManager.shared
    @Environment(\.dismiss) private var dismiss

    @State private var searchText: String = ""
    @State private var selectedCategory: PluginCategory? = nil
    @State private var selectedType: PluginType? = nil
    @State private var selectedPlugin: MarketplacePlugin? = nil
    @State private var showInstallSheet: Bool = false
    @State private var showAddSource: Bool = false
    @State private var newSourceURL: String = ""

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Marketplace")
                    .font(.headline)

                Spacer()

                if marketplaceManager.isLoading {
                    ProgressView()
                        .scaleEffect(0.7)
                }

                Button { dismiss() } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
            }
            .padding()

            Divider()

            HStack(spacing: 0) {
                // Sidebar: Sources & Filters
                VStack(alignment: .leading, spacing: 12) {
                    // Sources section
                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("Sources")
                                .font(.caption)
                                .fontWeight(.semibold)
                                .foregroundColor(.secondary)

                            Spacer()

                            Button {
                                showAddSource = true
                            } label: {
                                Image(systemName: "plus")
                                    .font(.caption)
                            }
                            .buttonStyle(.plain)
                        }

                        ForEach(marketplaceManager.sources) { source in
                            HStack(spacing: 4) {
                                Image(systemName: source.isOfficial ? "checkmark.seal.fill" : "globe")
                                    .font(.caption2)
                                    .foregroundColor(source.isOfficial ? .blue : .secondary)
                                Text(source.name)
                                    .font(.caption)
                                    .lineLimit(1)
                                Spacer()
                                if source.isEnabled {
                                    Circle()
                                        .fill(.green)
                                        .frame(width: 6, height: 6)
                                }
                            }
                            .padding(.vertical, 2)
                        }
                    }

                    Divider()

                    // Category filter
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Categories")
                            .font(.caption)
                            .fontWeight(.semibold)
                            .foregroundColor(.secondary)

                        Button {
                            selectedCategory = nil
                        } label: {
                            HStack {
                                Image(systemName: "square.grid.2x2")
                                Text("All")
                                Spacer()
                            }
                            .font(.caption)
                            .foregroundColor(selectedCategory == nil ? .accentColor : .primary)
                        }
                        .buttonStyle(.plain)

                        ForEach(PluginCategory.allCases) { category in
                            Button {
                                selectedCategory = category
                            } label: {
                                HStack {
                                    Image(systemName: category.icon)
                                    Text(category.rawValue)
                                    Spacer()
                                }
                                .font(.caption)
                                .foregroundColor(selectedCategory == category ? .accentColor : .primary)
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    Divider()

                    // Type filter
                    VStack(alignment: .leading, spacing: 6) {
                        Text("Type")
                            .font(.caption)
                            .fontWeight(.semibold)
                            .foregroundColor(.secondary)

                        Button {
                            selectedType = nil
                        } label: {
                            HStack {
                                Image(systemName: "square.stack.3d.up")
                                Text("All Types")
                                Spacer()
                            }
                            .font(.caption)
                            .foregroundColor(selectedType == nil ? .accentColor : .primary)
                        }
                        .buttonStyle(.plain)

                        ForEach(PluginType.allCases) { type in
                            Button {
                                selectedType = type
                            } label: {
                                HStack {
                                    Image(systemName: type.icon)
                                    Text(type.displayName)
                                    Spacer()
                                }
                                .font(.caption)
                                .foregroundColor(selectedType == type ? .accentColor : .primary)
                            }
                            .buttonStyle(.plain)
                        }
                    }

                    Spacer()
                }
                .frame(width: 150)
                .padding()
                .background(Color(NSColor.controlBackgroundColor))

                Divider()

                // Main content
                VStack(spacing: 0) {
                    // Search bar
                    HStack {
                        Image(systemName: "magnifyingglass")
                            .foregroundColor(.secondary)
                        TextField("Search plugins...", text: $searchText)
                            .textFieldStyle(.plain)

                        if !searchText.isEmpty {
                            Button {
                                searchText = ""
                            } label: {
                                Image(systemName: "xmark.circle.fill")
                                    .foregroundColor(.secondary)
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .padding(8)
                    .background(Color(NSColor.textBackgroundColor))
                    .cornerRadius(8)
                    .padding()

                    // Plugin list
                    if filteredPlugins.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "puzzlepiece.extension")
                                .font(.largeTitle)
                                .foregroundColor(.secondary)
                            Text("No plugins found")
                                .font(.headline)
                                .foregroundColor(.secondary)
                            if marketplaceManager.availablePlugins.isEmpty {
                                Button("Refresh Marketplace") {
                                    Task {
                                        await marketplaceManager.refreshMarketplaces()
                                    }
                                }
                                .buttonStyle(.bordered)
                            }
                        }
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        ScrollView {
                            LazyVStack(spacing: 8) {
                                ForEach(filteredPlugins) { plugin in
                                    MarketplacePluginCard(
                                        plugin: plugin,
                                        isInstalled: marketplaceManager.isInstalled(plugin),
                                        onInstall: {
                                            selectedPlugin = plugin
                                            showInstallSheet = true
                                        }
                                    )
                                }
                            }
                            .padding()
                        }
                    }
                }
            }

            Divider()

            // Footer
            HStack {
                if let error = marketplaceManager.lastError {
                    Image(systemName: "exclamationmark.triangle")
                        .foregroundColor(.orange)
                    Text(error)
                        .font(.caption)
                        .foregroundColor(.orange)
                        .lineLimit(1)
                }

                Spacer()

                Button {
                    Task {
                        await marketplaceManager.refreshMarketplaces()
                    }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
                .disabled(marketplaceManager.isLoading)
            }
            .padding()
        }
        .frame(width: 700, height: 500)
        .onAppear {
            if marketplaceManager.availablePlugins.isEmpty {
                Task {
                    await marketplaceManager.refreshMarketplaces()
                }
            }
        }
        .sheet(isPresented: $showInstallSheet) {
            if let plugin = selectedPlugin {
                PluginInstallSheet(
                    plugin: plugin,
                    onInstall: { scope in
                        Task {
                            do {
                                _ = try await marketplaceManager.installPlugin(plugin, scope: scope)
                                showInstallSheet = false
                            } catch {
                                // Handle error
                            }
                        }
                    },
                    onCancel: { showInstallSheet = false }
                )
            }
        }
        .sheet(isPresented: $showAddSource) {
            AddSourceSheet(
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

    private var filteredPlugins: [MarketplacePlugin] {
        var plugins = marketplaceManager.availablePlugins

        // Filter by category
        if let category = selectedCategory {
            plugins = plugins.filter { $0.category == category }
        }

        // Filter by type
        if let type = selectedType {
            plugins = plugins.filter { $0.types.contains(type) }
        }

        // Filter by search text
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

// MARK: - Marketplace Plugin Card

struct MarketplacePluginCard: View {
    let plugin: MarketplacePlugin
    let isInstalled: Bool
    let onInstall: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            // Icon
            ZStack {
                RoundedRectangle(cornerRadius: 8)
                    .fill(plugin.primaryType.color.opacity(0.15))
                    .frame(width: 44, height: 44)
                Image(systemName: plugin.primaryType.icon)
                    .font(.title2)
                    .foregroundColor(plugin.primaryType.color)
            }

            // Info
            VStack(alignment: .leading, spacing: 4) {
                HStack {
                    Text(plugin.name)
                        .font(.headline)
                    Text("v\(plugin.version)")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }

                Text(plugin.description)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(2)

                HStack(spacing: 8) {
                    Label(plugin.author, systemImage: "person")
                    Label(plugin.category.rawValue, systemImage: plugin.category.icon)

                    // Type badges
                    ForEach(plugin.types, id: \.self) { type in
                        Text(type.displayName)
                            .font(.caption2)
                            .padding(.horizontal, 4)
                            .padding(.vertical, 1)
                            .background(type.color.opacity(0.2))
                            .cornerRadius(3)
                    }
                }
                .font(.caption2)
                .foregroundColor(.secondary)
            }

            Spacer()

            // Install button
            if isInstalled {
                Label("Installed", systemImage: "checkmark.circle.fill")
                    .font(.caption)
                    .foregroundColor(.green)
            } else {
                Button("Install") { onInstall() }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
            }
        }
        .padding(12)
        .background(Color(NSColor.controlBackgroundColor))
        .cornerRadius(10)
    }
}

// MARK: - Plugin Install Sheet

struct PluginInstallSheet: View {
    let plugin: MarketplacePlugin
    let onInstall: (InstallScope) -> Void
    let onCancel: () -> Void

    @State private var selectedScope: InstallScope = .user

    var body: some View {
        VStack(spacing: 16) {
            // Header
            HStack {
                Image(systemName: plugin.primaryType.icon)
                    .font(.title)
                    .foregroundColor(plugin.primaryType.color)
                VStack(alignment: .leading) {
                    Text(plugin.name)
                        .font(.headline)
                    Text(plugin.description)
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .lineLimit(2)
                }
                Spacer()
            }

            Divider()

            // Scope selection
            VStack(alignment: .leading, spacing: 8) {
                Text("Installation Scope")
                    .font(.subheadline)
                    .fontWeight(.semibold)

                Picker("Scope", selection: $selectedScope) {
                    ForEach(InstallScope.allCases) { scope in
                        VStack(alignment: .leading) {
                            HStack {
                                Image(systemName: scope.icon)
                                Text(scope.rawValue)
                            }
                        }
                        .tag(scope)
                    }
                }
                .pickerStyle(.radioGroup)

                Text(selectedScope.description)
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            Divider()

            // Actions
            HStack {
                Button("Cancel") { onCancel() }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.escape)

                Spacer()

                Button("Install") { onInstall(selectedScope) }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.return)
            }
        }
        .padding()
        .frame(width: 350)
    }
}

// MARK: - Add Source Sheet

struct AddSourceSheet: View {
    @Binding var sourceURL: String
    let onAdd: () -> Void
    let onCancel: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text("Add Marketplace Source")
                .font(.headline)

            VStack(alignment: .leading, spacing: 4) {
                Text("Repository URL")
                    .font(.caption)
                    .foregroundColor(.secondary)
                TextField("owner/repo or https://github.com/owner/repo", text: $sourceURL)
                    .textFieldStyle(.roundedBorder)
            }

            Text("The repository must contain a .claude-plugin/marketplace.json file.")
                .font(.caption)
                .foregroundColor(.secondary)

            HStack {
                Button("Cancel") { onCancel() }
                    .buttonStyle(.bordered)
                    .keyboardShortcut(.escape)

                Spacer()

                Button("Add") { onAdd() }
                    .buttonStyle(.borderedProminent)
                    .keyboardShortcut(.return)
                    .disabled(sourceURL.isEmpty)
            }
        }
        .padding()
        .frame(width: 400)
    }
}

#Preview {
    MarketplaceBrowserView()
}
