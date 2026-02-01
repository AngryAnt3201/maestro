//
//  MultiProjectContentView.swift
//  claude-maestro
//
//  Root view wrapper with ZStack preservation for terminal state.
//  Uses opacity and hit-testing to keep all project views alive
//  so terminal NSViews maintain their state when switching.
//

import SwiftUI
import AppKit

/// Root content view that manages multiple projects with state preservation
struct MultiProjectContentView: View {
    @StateObject private var workspaceManager = WorkspaceManager()
    @StateObject private var appearanceManager = AppearanceManager()

    var body: some View {
        VStack(spacing: 0) {
            // Project tab bar
            ProjectTabBar(workspaceManager: workspaceManager)

            Divider()

            // Content area with ZStack preservation
            ZStack {
                // Render all project views (keeps them alive)
                ForEach(workspaceManager.projects) { project in
                    // Use ProjectContentView which accepts an external SessionManager
                    // This ensures we get the exact same PreLaunchView and MainContentView behavior
                    ProjectContentView(
                        manager: project.sessionManager,
                        appearanceManager: appearanceManager
                    )
                    .opacity(project.id == workspaceManager.activeProjectId ? 1 : 0)
                    .allowsHitTesting(project.id == workspaceManager.activeProjectId)
                }

                // Empty workspace state (shown when no projects open)
                if workspaceManager.projects.isEmpty {
                    EmptyWorkspaceView(onOpenProject: {
                        workspaceManager.selectAndOpenProject()
                    })
                }
            }
        }
        .preferredColorScheme(appearanceManager.currentMode.colorScheme)
        .task {
            // Restore open projects on launch
            await workspaceManager.restoreOpenProjects()
        }
    }
}

#Preview {
    MultiProjectContentView()
}
