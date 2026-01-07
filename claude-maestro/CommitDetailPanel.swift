//
//  CommitDetailPanel.swift
//  claude-maestro
//
//  Detail panel showing commit info and actions
//

import SwiftUI
import AppKit

struct CommitDetailPanel: View {
    let commit: Commit
    @ObservedObject var gitManager: GitManager
    let onClose: () -> Void
    let onRefresh: () -> Void

    @State private var showCreateBranch: Bool = false
    @State private var isCheckingOut: Bool = false
    @State private var checkoutError: String?
    @State private var copiedHash: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            // Header
            header

            Divider()

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Commit info section
                    commitInfoSection

                    Divider()

                    // References section (show if has refs or remotes configured)
                    if !commit.refs.isEmpty || !gitManager.remoteURLs.isEmpty {
                        refsSection
                        Divider()
                    }

                    // Actions section
                    actionsSection
                }
                .padding()
            }
        }
        .background(Color(NSColor.windowBackgroundColor))
        .sheet(isPresented: $showCreateBranch) {
            CreateBranchFromCommitSheet(
                commitHash: commit.id,
                commitShortHash: commit.shortHash,
                gitManager: gitManager,
                onCreated: {
                    showCreateBranch = false
                    onRefresh()
                }
            )
        }
    }

    // MARK: - Header

    private var header: some View {
        HStack {
            VStack(alignment: .leading, spacing: 2) {
                Text("Commit Details")
                    .font(.headline)

                if commit.isHead {
                    HStack(spacing: 4) {
                        Image(systemName: "star.fill")
                            .font(.caption2)
                            .foregroundColor(.yellow)
                        Text("HEAD")
                            .font(.caption2)
                            .foregroundColor(.secondary)
                    }
                }
            }

            Spacer()

            Button(action: onClose) {
                Image(systemName: "xmark.circle.fill")
                    .foregroundColor(.secondary)
                    .font(.title3)
            }
            .buttonStyle(.plain)
        }
        .padding()
    }

    // MARK: - Commit Info Section

    private var commitInfoSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            // SHA
            HStack(alignment: .top) {
                Text("SHA")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .frame(width: 60, alignment: .leading)

                VStack(alignment: .leading, spacing: 4) {
                    Text(commit.id)
                        .font(.system(.caption, design: .monospaced))
                        .lineLimit(2)
                        .textSelection(.enabled)

                    Button {
                        copyToClipboard(commit.id)
                    } label: {
                        HStack(spacing: 4) {
                            Image(systemName: copiedHash ? "checkmark" : "doc.on.doc")
                            Text(copiedHash ? "Copied!" : "Copy")
                        }
                        .font(.caption2)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }

            // Author
            HStack(alignment: .top) {
                Text("Author")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .frame(width: 60, alignment: .leading)

                VStack(alignment: .leading, spacing: 2) {
                    Text(commit.author)
                        .font(.caption)
                    Text(commit.authorEmail)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }

            // Date
            HStack(alignment: .top) {
                Text("Date")
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .frame(width: 60, alignment: .leading)

                VStack(alignment: .leading, spacing: 2) {
                    Text(commit.date, style: .date)
                        .font(.caption)
                    Text(commit.date, style: .time)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                    Text(commit.date.relativeDescription)
                        .font(.caption2)
                        .foregroundColor(.secondary)
                }
            }

            // Parents
            if !commit.parentHashes.isEmpty {
                HStack(alignment: .top) {
                    Text("Parents")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .frame(width: 60, alignment: .leading)

                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(commit.parentHashes, id: \.self) { hash in
                            Text(String(hash.prefix(7)))
                                .font(.system(.caption2, design: .monospaced))
                                .foregroundColor(.secondary)
                        }
                    }
                }
            }

            // Message
            VStack(alignment: .leading, spacing: 4) {
                Text("Message")
                    .font(.caption)
                    .foregroundColor(.secondary)

                Text(commit.message)
                    .font(.body)
                    .textSelection(.enabled)
            }
        }
    }

    // MARK: - Refs Section

    private var refsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Remote Status Header
            if !gitManager.remoteURLs.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Remote")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    ForEach(Array(gitManager.remoteURLs.keys.sorted()), id: \.self) { name in
                        if let url = gitManager.remoteURLs[name] {
                            HStack(spacing: 6) {
                                RemoteStatusIndicator(status: gitManager.remoteStatuses[name] ?? .unknown)
                                Text(name)
                                    .fontWeight(.medium)
                                Text("• \(formatRemoteURL(url))")
                                    .foregroundColor(.secondary)
                            }
                            .font(.caption)
                        }
                    }
                }
            }

            // Local Branches (grouped)
            let localRefs = commit.refs.filter { $0.type == .localBranch }
            if !localRefs.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Local Branches")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    ForEach(localRefs) { ref in
                        HStack {
                            RefLabel(ref: ref)
                            // Show tracking info if available
                            if let branch = findBranch(for: ref) {
                                if branch.aheadCount > 0 || branch.behindCount > 0 {
                                    Text("↑\(branch.aheadCount) ↓\(branch.behindCount)")
                                        .font(.caption2)
                                        .foregroundColor(.orange)
                                } else {
                                    Text("✓ pushed")
                                        .font(.caption2)
                                        .foregroundColor(.green)
                                }
                            }
                        }
                    }
                }
            }

            // Remote Branches (grouped)
            let remoteRefs = commit.refs.filter { $0.type == .remoteBranch }
            if !remoteRefs.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Remote Branches")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    FlowLayout(spacing: 6) {
                        ForEach(remoteRefs) { ref in
                            RefLabel(ref: ref)
                        }
                    }
                }
            }

            // Tags (grouped)
            let tagRefs = commit.refs.filter { $0.type == .tag }
            if !tagRefs.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Tags")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    FlowLayout(spacing: 6) {
                        ForEach(tagRefs) { ref in
                            RefLabel(ref: ref)
                        }
                    }
                }
            }
        }
    }

    // Helper to find branch details from GitManager
    private func findBranch(for ref: GitRef) -> Branch? {
        gitManager.branches.first { $0.name == ref.name && !$0.isRemote }
    }

    // Format remote URL for display
    private func formatRemoteURL(_ url: String) -> String {
        var formatted = url
            .replacingOccurrences(of: "git@github.com:", with: "github:")
            .replacingOccurrences(of: "git@gitlab.com:", with: "gitlab:")
            .replacingOccurrences(of: "https://github.com/", with: "github:")
            .replacingOccurrences(of: "https://gitlab.com/", with: "gitlab:")

        if formatted.hasSuffix(".git") {
            formatted = String(formatted.dropLast(4))
        }
        return formatted
    }

    // MARK: - Actions Section

    private var actionsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Actions")
                .font(.caption)
                .foregroundColor(.secondary)

            if let error = checkoutError {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.red.opacity(0.1))
                    .cornerRadius(6)
            }

            // Checkout button
            Button {
                Task { await checkout() }
            } label: {
                HStack {
                    if isCheckingOut {
                        ProgressView()
                            .scaleEffect(0.7)
                            .frame(width: 16, height: 16)
                    } else {
                        Image(systemName: "arrow.uturn.backward")
                    }
                    Text("Checkout this commit")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)
            .disabled(isCheckingOut || commit.isHead)

            if commit.isHead {
                Text("This is the current HEAD")
                    .font(.caption2)
                    .foregroundColor(.secondary)
            }

            // Create branch button
            Button {
                showCreateBranch = true
            } label: {
                HStack {
                    Image(systemName: "plus.circle")
                    Text("Create branch here")
                }
                .frame(maxWidth: .infinity)
            }
            .buttonStyle(.bordered)

            // Checkout branch buttons (if refs exist)
            let branches = commit.refs.filter { $0.type == .localBranch && !$0.isHead }
            if !branches.isEmpty {
                Divider()

                Text("Checkout branch")
                    .font(.caption)
                    .foregroundColor(.secondary)

                ForEach(branches) { branch in
                    Button {
                        Task { await checkoutBranch(branch.name) }
                    } label: {
                        HStack {
                            Image(systemName: "arrow.triangle.branch")
                            Text(branch.name)
                        }
                        .frame(maxWidth: .infinity)
                    }
                    .buttonStyle(.bordered)
                    .disabled(isCheckingOut)
                }
            }
        }
    }

    // MARK: - Actions

    private func copyToClipboard(_ text: String) {
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(text, forType: .string)

        copiedHash = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) {
            copiedHash = false
        }
    }

    private func checkout() async {
        isCheckingOut = true
        checkoutError = nil
        defer { isCheckingOut = false }

        do {
            try await gitManager.checkoutCommit(commit.id)
            onRefresh()
        } catch {
            checkoutError = error.localizedDescription
        }
    }

    private func checkoutBranch(_ name: String) async {
        isCheckingOut = true
        checkoutError = nil
        defer { isCheckingOut = false }

        do {
            try await gitManager.checkoutBranch(name)
            onRefresh()
        } catch {
            checkoutError = error.localizedDescription
        }
    }
}

// MARK: - Create Branch From Commit Sheet

struct CreateBranchFromCommitSheet: View {
    let commitHash: String
    let commitShortHash: String
    @ObservedObject var gitManager: GitManager
    let onCreated: () -> Void

    @State private var branchName: String = ""
    @State private var isCreating: Bool = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(spacing: 20) {
            // Header
            HStack {
                Image(systemName: "plus.circle")
                    .foregroundColor(.accentColor)
                Text("Create New Branch")
                    .font(.headline)
            }

            // Form
            VStack(alignment: .leading, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Branch name")
                        .font(.caption)
                        .foregroundColor(.secondary)

                    TextField("feature/my-branch", text: $branchName)
                        .textFieldStyle(.roundedBorder)
                }

                HStack(spacing: 8) {
                    Image(systemName: "point.3.filled.connected.trianglepath.dotted")
                        .foregroundColor(.secondary)
                    Text("From commit:")
                        .font(.caption)
                        .foregroundColor(.secondary)
                    Text(commitShortHash)
                        .font(.system(.caption, design: .monospaced))
                }
            }

            if let error = error {
                Text(error)
                    .font(.caption)
                    .foregroundColor(.red)
                    .padding(8)
                    .frame(maxWidth: .infinity)
                    .background(Color.red.opacity(0.1))
                    .cornerRadius(6)
            }

            // Buttons
            HStack(spacing: 12) {
                Button("Cancel") {
                    dismiss()
                }
                .buttonStyle(.bordered)
                .keyboardShortcut(.cancelAction)

                Button {
                    Task { await createBranch() }
                } label: {
                    if isCreating {
                        ProgressView()
                            .scaleEffect(0.7)
                    } else {
                        Text("Create")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(branchName.trimmingCharacters(in: .whitespaces).isEmpty || isCreating)
                .keyboardShortcut(.defaultAction)
            }
        }
        .padding(24)
        .frame(width: 350)
    }

    private func createBranch() async {
        isCreating = true
        error = nil

        do {
            try await gitManager.createBranchAtCommit(name: branchName, commitHash: commitHash)
            onCreated()
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }

        isCreating = false
    }
}

// MARK: - Flow Layout

struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let result = FlowResult(in: proposal.width ?? 0, spacing: spacing, subviews: subviews)
        return result.size
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let result = FlowResult(in: bounds.width, spacing: spacing, subviews: subviews)

        for (index, subview) in subviews.enumerated() {
            subview.place(at: CGPoint(x: bounds.minX + result.positions[index].x,
                                      y: bounds.minY + result.positions[index].y),
                         proposal: .unspecified)
        }
    }

    struct FlowResult {
        var size: CGSize = .zero
        var positions: [CGPoint] = []

        init(in maxWidth: CGFloat, spacing: CGFloat, subviews: Subviews) {
            var currentX: CGFloat = 0
            var currentY: CGFloat = 0
            var lineHeight: CGFloat = 0

            for subview in subviews {
                let size = subview.sizeThatFits(.unspecified)

                if currentX + size.width > maxWidth && currentX > 0 {
                    currentX = 0
                    currentY += lineHeight + spacing
                    lineHeight = 0
                }

                positions.append(CGPoint(x: currentX, y: currentY))
                lineHeight = max(lineHeight, size.height)
                currentX += size.width + spacing
            }

            self.size = CGSize(width: maxWidth, height: currentY + lineHeight)
        }
    }
}

// MARK: - Preview

#Preview {
    CommitDetailPanel(
        commit: Commit(
            id: "abc1234567890def1234567890abc1234567890de",
            shortHash: "abc1234",
            message: "Initial commit with some important changes that need to be documented properly",
            author: "John Doe",
            authorEmail: "john@example.com",
            date: Date().addingTimeInterval(-86400),
            parentHashes: ["def5678901234"],
            isHead: false,
            refs: [
                GitRef(id: "main", name: "main", type: .localBranch, isHead: false),
                GitRef(id: "origin/main", name: "origin/main", type: .remoteBranch, isHead: false),
                GitRef(id: "v1.0.0", name: "v1.0.0", type: .tag, isHead: false)
            ]
        ),
        gitManager: GitManager(),
        onClose: {},
        onRefresh: {}
    )
    .frame(width: 300, height: 600)
}
