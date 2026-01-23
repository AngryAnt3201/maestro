import SwiftUI

/// Process tree visualization view
struct ProcessTreeView: View {
    @ObservedObject var viewModel: ProcessTreeViewModel
    @State private var showingKillConfirmation = false
    @State private var processToKill: ProcessInfoViewModel?
    @State private var viewMode: ViewMode = .tree

    enum ViewMode: String, CaseIterable {
        case tree = "Tree"
        case flat = "List"
    }

    var body: some View {
        VStack(spacing: 0) {
            // Toolbar
            toolbar

            Divider()

            // Content
            if viewModel.flatList.isEmpty && !viewModel.isRefreshing {
                emptyState
            } else {
                switch viewMode {
                case .tree:
                    treeView
                case .flat:
                    listView
                }
            }

            // Status bar
            statusBar
        }
        .alert("Kill Process", isPresented: $showingKillConfirmation) {
            Button("Cancel", role: .cancel) {}
            Button("Kill", role: .destructive) {
                if let process = processToKill {
                    Task {
                        _ = await viewModel.killProcess(process.id)
                    }
                }
            }
            Button("Force Kill", role: .destructive) {
                if let process = processToKill {
                    Task {
                        _ = await viewModel.forceKillProcess(process.id)
                    }
                }
            }
        } message: {
            if let process = processToKill {
                Text("Kill process \(process.info.pid) (\(process.displayName))?")
            }
        }
    }

    // MARK: - Toolbar

    private var toolbar: some View {
        HStack(spacing: 12) {
            // View mode picker
            Picker("View", selection: $viewMode) {
                ForEach(ViewMode.allCases, id: \.self) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .pickerStyle(.segmented)
            .frame(width: 120)

            // Filter picker
            Picker("Filter", selection: $viewModel.filterMode) {
                ForEach(ProcessTreeViewModel.FilterMode.allCases, id: \.self) { mode in
                    Text(mode.rawValue).tag(mode)
                }
            }
            .frame(width: 140)

            // Search
            TextField("Search...", text: $viewModel.searchText)
                .textFieldStyle(.roundedBorder)
                .frame(maxWidth: 200)

            Spacer()

            // Expand/Collapse
            if viewMode == .tree {
                Button(action: { viewModel.expandAll() }) {
                    Image(systemName: "arrow.down.right.and.arrow.up.left")
                }
                .help("Expand All")

                Button(action: { viewModel.collapseAll() }) {
                    Image(systemName: "arrow.up.left.and.arrow.down.right")
                }
                .help("Collapse All")
            }

            // Refresh
            Button(action: { Task { await viewModel.refresh() } }) {
                Image(systemName: "arrow.clockwise")
            }
            .disabled(viewModel.isRefreshing)
            .help("Refresh")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    // MARK: - Tree View

    private var treeView: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                ForEach(viewModel.rootProcesses) { node in
                    ProcessNodeRow(node: node, depth: 0, onKill: { confirmKill($0) }, onToggle: { viewModel.toggleExpanded($0) })
                }
            }
            .padding(.vertical, 4)
        }
    }

    // MARK: - List View

    private var listView: some View {
        ScrollView {
            LazyVStack(spacing: 0) {
                // Header
                ProcessListHeader()

                Divider()

                ForEach(viewModel.flatList) { process in
                    ProcessListRow(process: process, onKill: { confirmKill($0) })
                }
            }
        }
    }

    // MARK: - Empty State

    private var emptyState: some View {
        VStack(spacing: 12) {
            Image(systemName: "cpu")
                .font(.system(size: 48))
                .foregroundColor(.secondary)

            Text("No Processes Found")
                .font(.headline)

            Text("No processes match the current filter")
                .font(.caption)
                .foregroundColor(.secondary)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: - Status Bar

    private var statusBar: some View {
        HStack {
            Text("\(viewModel.flatList.count) processes")
                .font(.caption)
                .foregroundColor(.secondary)

            Spacer()

            if let lastRefresh = viewModel.lastRefresh {
                Text("Updated: \(lastRefresh, style: .time)")
                    .font(.caption)
                    .foregroundColor(.secondary)
            }

            if viewModel.isRefreshing {
                ProgressView()
                    .scaleEffect(0.5)
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 4)
        .background(Color(NSColor.windowBackgroundColor))
    }

    // MARK: - Actions

    private func confirmKill(_ process: ProcessInfoViewModel) {
        processToKill = process
        showingKillConfirmation = true
    }
}

// MARK: - Process Node Row (Tree)

struct ProcessNodeRow: View {
    @ObservedObject var node: ProcessNodeViewModel
    let depth: Int
    let onKill: (ProcessInfoViewModel) -> Void
    let onToggle: (pid_t) -> Void

    @State private var isHovered = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // This node
            HStack(spacing: 4) {
                // Indentation
                ForEach(0..<depth, id: \.self) { _ in
                    Rectangle()
                        .fill(Color.clear)
                        .frame(width: 16)
                }

                // Expand/collapse button
                if node.hasChildren {
                    Button(action: { onToggle(node.id) }) {
                        Image(systemName: node.isExpanded ? "chevron.down" : "chevron.right")
                            .font(.caption)
                            .foregroundColor(.secondary)
                    }
                    .buttonStyle(.plain)
                    .frame(width: 16)
                } else {
                    Rectangle()
                        .fill(Color.clear)
                        .frame(width: 16)
                }

                // Status indicator
                Circle()
                    .fill(node.isManagedByMaestro ? Color.green : Color.gray)
                    .frame(width: 8, height: 8)

                // Process name
                Text(node.info.displayName)
                    .font(.system(.body, design: .monospaced))
                    .fontWeight(node.isManagedByMaestro ? .medium : .regular)

                // PID
                Text("(\(node.info.pid))")
                    .font(.caption)
                    .foregroundColor(.secondary)

                // PGID indicator
                if node.info.pgid != node.info.pid {
                    Text("pgid:\(node.info.pgid)")
                        .font(.caption2)
                        .foregroundColor(.orange)
                        .padding(.horizontal, 4)
                        .background(Color.orange.opacity(0.1))
                        .cornerRadius(3)
                }

                Spacer()

                // Child count
                if node.hasChildren {
                    Text("\(node.totalCount) processes")
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }

                // Kill button (on hover)
                if isHovered {
                    Button(action: {
                        onKill(ProcessInfoViewModel(info: node.info, isManagedByMaestro: node.isManagedByMaestro, isCurrentUser: true))
                    }) {
                        Image(systemName: "xmark.circle.fill")
                            .foregroundColor(.red)
                    }
                    .buttonStyle(.plain)
                    .help("Kill Process")
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(isHovered ? Color(NSColor.selectedContentBackgroundColor).opacity(0.3) : Color.clear)
            .onHover { isHovered = $0 }

            // Children (if expanded)
            if node.isExpanded {
                ForEach(node.children) { child in
                    ProcessNodeRow(node: child, depth: depth + 1, onKill: onKill, onToggle: onToggle)
                }
            }
        }
    }
}

// MARK: - Process List Header

struct ProcessListHeader: View {
    var body: some View {
        HStack(spacing: 0) {
            Text("PID")
                .frame(width: 60, alignment: .leading)
            Text("PPID")
                .frame(width: 60, alignment: .leading)
            Text("PGID")
                .frame(width: 60, alignment: .leading)
            Text("Name")
                .frame(minWidth: 120, alignment: .leading)
            Text("Path")
                .frame(maxWidth: .infinity, alignment: .leading)
            Text("Actions")
                .frame(width: 60, alignment: .center)
        }
        .font(.caption.bold())
        .foregroundColor(.secondary)
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(Color(NSColor.controlBackgroundColor))
    }
}

// MARK: - Process List Row

struct ProcessListRow: View {
    let process: ProcessInfoViewModel
    let onKill: (ProcessInfoViewModel) -> Void

    @State private var isHovered = false

    var body: some View {
        HStack(spacing: 0) {
            // PID
            Text("\(process.info.pid)")
                .font(.system(.body, design: .monospaced))
                .frame(width: 60, alignment: .leading)

            // PPID
            Text("\(process.info.ppid)")
                .font(.system(.caption, design: .monospaced))
                .foregroundColor(.secondary)
                .frame(width: 60, alignment: .leading)

            // PGID
            HStack(spacing: 2) {
                Text("\(process.info.pgid)")
                    .font(.system(.caption, design: .monospaced))
                if process.info.pgid == process.info.pid {
                    Text("★")
                        .font(.caption2)
                        .foregroundColor(.orange)
                }
            }
            .frame(width: 60, alignment: .leading)

            // Name with status indicator
            HStack(spacing: 4) {
                Circle()
                    .fill(process.isManagedByMaestro ? Color.green : Color.gray.opacity(0.5))
                    .frame(width: 6, height: 6)

                Text(process.displayName)
                    .font(.system(.body, design: .monospaced))
                    .fontWeight(process.isManagedByMaestro ? .medium : .regular)
                    .lineLimit(1)
            }
            .frame(minWidth: 120, alignment: .leading)

            // Path
            Text(process.shortPath ?? "-")
                .font(.caption)
                .foregroundColor(.secondary)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)

            // Kill button
            Button(action: { onKill(process) }) {
                Image(systemName: "xmark.circle")
                    .foregroundColor(isHovered ? .red : .secondary)
            }
            .buttonStyle(.plain)
            .frame(width: 60, alignment: .center)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 6)
        .background(isHovered ? Color(NSColor.selectedContentBackgroundColor).opacity(0.3) : Color.clear)
        .onHover { isHovered = $0 }
    }
}

// MARK: - Preview

#Preview {
    let processTree = ProcessTree()
    let registry = ProcessRegistry()
    let viewModel = ProcessTreeViewModel(processTree: processTree, registry: registry)

    return ProcessTreeView(viewModel: viewModel)
        .frame(width: 800, height: 600)
}
