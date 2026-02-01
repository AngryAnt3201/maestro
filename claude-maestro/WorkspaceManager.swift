//
//  WorkspaceManager.swift
//  claude-maestro
//
//  Multi-project orchestrator that manages all open projects
//  and handles switching between them.
//

import Foundation
import SwiftUI
import Combine
import AppKit

/// Manages multiple open projects in the workspace
@MainActor
class WorkspaceManager: ObservableObject {
    // MARK: - Published State

    /// All open projects
    @Published var projects: [ProjectContext] = []

    /// ID of the currently active project
    @Published var activeProjectId: UUID?

    // MARK: - Persistence Keys

    private let openProjectsKey = "claude-maestro-open-projects"
    private let activeProjectKey = "claude-maestro-active-project"

    // MARK: - Computed Properties

    /// The currently active project
    var activeProject: ProjectContext? {
        guard let activeId = activeProjectId else { return nil }
        return projects.first { $0.id == activeId }
    }

    /// Whether there are any open projects
    var hasProjects: Bool {
        !projects.isEmpty
    }

    /// Project count
    var projectCount: Int {
        projects.count
    }

    // MARK: - Initialization

    init() {
        // Restore projects will be called after init
    }

    // MARK: - Project Management

    /// Open a new project at the given path
    /// - Parameter path: Full path to the project directory
    /// - Returns: The created ProjectContext
    @discardableResult
    func openProject(path: String) async -> ProjectContext {
        // Check if already open
        if let existing = projects.first(where: { $0.projectPath == path }) {
            switchToProject(existing.id)
            return existing
        }

        // Create new project context
        let project = ProjectContext(projectPath: path)

        // Configure the project (sets up SessionManager, GitManager, etc.)
        await project.configure()

        // Add to projects
        projects.append(project)

        // Make it the active project (this will also sync the project path)
        switchToProject(project.id)

        // Persist
        persistOpenProjects()

        return project
    }

    /// Close a project
    /// - Parameter projectId: ID of the project to close
    func closeProject(_ projectId: UUID) async {
        guard let index = projects.firstIndex(where: { $0.id == projectId }) else {
            return
        }

        let project = projects[index]

        // Clean up the project
        await project.cleanup()

        // Remove from list
        projects.remove(at: index)

        // If this was the active project, switch to another
        if activeProjectId == projectId {
            if let firstProject = projects.first {
                switchToProject(firstProject.id)
            } else {
                activeProjectId = nil
            }
        }

        // Persist
        persistOpenProjects()
    }

    /// Switch to a different project
    /// - Parameter projectId: ID of the project to switch to
    func switchToProject(_ projectId: UUID) {
        guard let switchToProject = projects.first(where: { $0.id == projectId }) else {
            return
        }

        // Update active state on all projects
        for project in projects {
            project.isActive = (project.id == projectId)
        }

        activeProjectId = projectId

        // Sync the active project path with SkillManager and CommandManager
        // This ensures plugin installation uses the correct project path
        syncActiveProjectPath(switchToProject.projectPath)

        // Persist active project
        persistOpenProjects()
    }

    /// Sync the active project path with global managers
    /// This ensures plugin installation and skill scanning use the correct project
    private func syncActiveProjectPath(_ path: String) {
        SkillManager.shared.currentProjectPath = path
        CommandManager.shared.currentProjectPath = path

        // Rescan skills and commands for the new project
        SkillManager.shared.scanForSkills()
        CommandManager.shared.scanForCommands()
    }

    /// Select a directory and open it as a project
    func selectAndOpenProject() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.message = "Select project directory"

        if panel.runModal() == .OK {
            if let url = panel.url {
                Task {
                    await openProject(path: url.path)
                }
            }
        }
    }

    // MARK: - Persistence

    /// Persist open projects to UserDefaults
    func persistOpenProjects() {
        let projectPaths = projects.map { $0.projectPath }
        UserDefaults.standard.set(projectPaths, forKey: openProjectsKey)

        if let activeProject = activeProject {
            UserDefaults.standard.set(activeProject.projectPath, forKey: activeProjectKey)
        } else {
            UserDefaults.standard.removeObject(forKey: activeProjectKey)
        }
    }

    /// Restore open projects from UserDefaults
    func restoreOpenProjects() async {
        guard let savedPaths = UserDefaults.standard.stringArray(forKey: openProjectsKey) else {
            return
        }

        let activeProjectPath = UserDefaults.standard.string(forKey: activeProjectKey)
        let fileManager = FileManager.default

        for path in savedPaths {
            // Only restore if directory still exists
            var isDirectory: ObjCBool = false
            if fileManager.fileExists(atPath: path, isDirectory: &isDirectory), isDirectory.boolValue {
                let project = await openProject(path: path)

                // Set active if this was the previously active project
                if path == activeProjectPath {
                    switchToProject(project.id)
                }
            }
        }

        // If no active project was restored and we have projects, activate the first one
        if activeProjectId == nil, let firstProject = projects.first {
            switchToProject(firstProject.id)
        }
    }

    // MARK: - Cleanup

    /// Clean up all projects (called on app termination)
    func cleanupAll() async {
        for project in projects {
            await project.cleanup()
        }
    }
}

// MARK: - Project Status Helpers

extension WorkspaceManager {
    /// Get session count for a project
    func sessionCount(for projectId: UUID) -> Int {
        guard let project = projects.first(where: { $0.id == projectId }) else {
            return 0
        }
        return project.sessionManager.sessions.count
    }

    /// Get active session count for a project
    func activeSessionCount(for projectId: UUID) -> Int {
        guard let project = projects.first(where: { $0.id == projectId }) else {
            return 0
        }
        return project.sessionManager.sessions.filter { $0.isTerminalLaunched }.count
    }

    /// Get project status color based on session states
    func statusColor(for projectId: UUID) -> Color {
        guard let project = projects.first(where: { $0.id == projectId }) else {
            return .gray
        }

        let sessions = project.sessionManager.sessions

        // If any session is working, show working color
        if sessions.contains(where: { $0.status == .working }) {
            return SessionStatus.working.color
        }

        // If any session needs input, show waiting color
        if sessions.contains(where: { $0.status == .waiting }) {
            return SessionStatus.waiting.color
        }

        // If any session has error, show error color
        if sessions.contains(where: { $0.status == .error }) {
            return SessionStatus.error.color
        }

        // If all sessions are done, show done color
        if sessions.allSatisfy({ $0.status == .done }) && !sessions.isEmpty {
            return SessionStatus.done.color
        }

        // Default to idle
        return SessionStatus.idle.color
    }
}
