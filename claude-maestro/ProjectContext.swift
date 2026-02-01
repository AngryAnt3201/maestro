//
//  ProjectContext.swift
//  claude-maestro
//
//  Per-project state container that holds SessionManager and all managers
//  for isolated project state in multi-project mode.
//

import Foundation
import SwiftUI
import Combine

/// Represents a single open project with its own isolated state
@MainActor
class ProjectContext: ObservableObject, Identifiable {
    let id: UUID

    /// Display name for the project (folder name)
    @Published var displayName: String

    /// Full path to the project directory
    @Published var projectPath: String

    /// Session manager for this project
    @Published var sessionManager: SessionManager

    /// Whether this project is currently active (visible)
    @Published var isActive: Bool = false

    // MARK: - Terminal Preservation

    /// Store terminal view references to preserve state when switching projects
    /// Key is session ID, value is the terminal view
    var terminalViews: [Int: MaestroTerminalView] = [:]

    /// Store terminal controllers for command sending
    var terminalControllers: [Int: TerminalController] = [:]

    // MARK: - Combine Subscriptions

    /// Cancellables for Combine subscriptions
    private var cancellables = Set<AnyCancellable>()

    // MARK: - Initialization

    init(projectPath: String) {
        self.id = UUID()
        self.projectPath = projectPath
        self.displayName = (projectPath as NSString).lastPathComponent
        self.sessionManager = SessionManager()

        // Subscribe to project path changes to update display name
        setupPathSubscription()
    }

    /// Initialize with an existing session manager (for migration)
    init(projectPath: String, sessionManager: SessionManager) {
        self.id = UUID()
        self.projectPath = projectPath
        self.displayName = (projectPath as NSString).lastPathComponent
        self.sessionManager = sessionManager

        // Subscribe to project path changes to update display name
        setupPathSubscription()
    }

    /// Subscribe to sessionManager.projectPath changes to keep displayName in sync
    private func setupPathSubscription() {
        sessionManager.$projectPath
            .dropFirst() // Skip initial value (already set in init)
            .sink { [weak self] newPath in
                guard let self = self, !newPath.isEmpty else { return }
                self.projectPath = newPath
                self.displayName = (newPath as NSString).lastPathComponent
            }
            .store(in: &cancellables)
    }

    // MARK: - Project Setup

    /// Configure the project path and initialize all managers
    func configure() async {
        await sessionManager.setProjectPath(projectPath)
    }

    // MARK: - Terminal Management

    /// Get or create a terminal view for a session
    func getTerminalView(for sessionId: Int) -> MaestroTerminalView? {
        return terminalViews[sessionId]
    }

    /// Store a terminal view for a session
    func setTerminalView(_ view: MaestroTerminalView, for sessionId: Int) {
        terminalViews[sessionId] = view
    }

    /// Remove a terminal view for a session
    func removeTerminalView(for sessionId: Int) {
        terminalViews.removeValue(forKey: sessionId)
        terminalControllers.removeValue(forKey: sessionId)
    }

    // MARK: - Cleanup

    /// Clean up all resources when closing the project
    func cleanup() async {
        // Reset all sessions (kills processes, removes worktrees)
        await sessionManager.resetAllSessionsForDirectoryChange(oldPath: projectPath)

        // Clear terminal references
        terminalViews.removeAll()
        terminalControllers.removeAll()
    }

    // MARK: - Convenience Accessors

    var gitManager: GitManager {
        sessionManager.gitManager
    }

    var worktreeManager: WorktreeManager {
        sessionManager.worktreeManager
    }

    var claudeMDManager: ClaudeMDManager {
        sessionManager.claudeMDManager
    }

    var processRegistry: ProcessRegistry {
        sessionManager.processRegistry
    }

    var processCoordinator: ManagedProcessCoordinator {
        sessionManager.processCoordinator
    }

    var activityMonitor: ProcessActivityMonitor {
        sessionManager.activityMonitor
    }

    var stateMonitor: MaestroStateMonitor {
        sessionManager.stateMonitor
    }
}

// MARK: - Hashable

extension ProjectContext: Hashable {
    static func == (lhs: ProjectContext, rhs: ProjectContext) -> Bool {
        lhs.id == rhs.id
    }

    nonisolated func hash(into hasher: inout Hasher) {
        hasher.combine(id)
    }
}

// MARK: - Persistable Project

/// Lightweight struct for persisting project state
struct PersistableProject: Codable {
    let path: String
    let isActive: Bool

    init(from project: ProjectContext) {
        self.path = project.projectPath
        self.isActive = project.isActive
    }
}
