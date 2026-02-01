//
//  ProjectTabBar.swift
//  claude-maestro
//
//  Tab bar UI component showing open projects with + button
//

import SwiftUI
import AppKit

/// Tab bar displaying open projects at the top of the window
struct ProjectTabBar: View {
    @ObservedObject var workspaceManager: WorkspaceManager
    @State private var hoveredTabId: UUID?

    var body: some View {
        HStack(spacing: 0) {
            // Project tabs
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 1) {
                    ForEach(workspaceManager.projects) { project in
                        ProjectTab(
                            project: project,
                            isActive: project.id == workspaceManager.activeProjectId,
                            isHovered: hoveredTabId == project.id,
                            statusColor: workspaceManager.statusColor(for: project.id),
                            sessionCount: workspaceManager.activeSessionCount(for: project.id),
                            onSelect: {
                                workspaceManager.switchToProject(project.id)
                            },
                            onClose: {
                                Task {
                                    await workspaceManager.closeProject(project.id)
                                }
                            }
                        )
                        .onHover { hovering in
                            hoveredTabId = hovering ? project.id : nil
                        }
                    }
                }
                .padding(.horizontal, 4)
            }

            // Add project button
            Button(action: {
                workspaceManager.selectAndOpenProject()
            }) {
                Image(systemName: "plus")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundColor(.secondary)
                    .frame(width: 28, height: 28)
                    .background(
                        RoundedRectangle(cornerRadius: 6)
                            .fill(Color(NSColor.controlBackgroundColor))
                    )
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 8)
            .help("Open project")

            Spacer()
        }
        .frame(height: 36)
        .background(Color(NSColor.windowBackgroundColor))
    }
}

/// Individual project tab
struct ProjectTab: View {
    let project: ProjectContext
    let isActive: Bool
    let isHovered: Bool
    let statusColor: Color
    let sessionCount: Int
    let onSelect: () -> Void
    let onClose: () -> Void

    var body: some View {
        HStack(spacing: 6) {
            // Status indicator
            Circle()
                .fill(statusColor)
                .frame(width: 8, height: 8)

            // Project name
            Text(project.displayName)
                .font(.system(size: 12, weight: isActive ? .medium : .regular))
                .lineLimit(1)
                .foregroundColor(isActive ? .primary : .secondary)

            // Session count badge
            if sessionCount > 0 {
                Text("\(sessionCount)")
                    .font(.system(size: 10, weight: .medium))
                    .foregroundColor(.white)
                    .padding(.horizontal, 5)
                    .padding(.vertical, 2)
                    .background(
                        Capsule()
                            .fill(statusColor.opacity(0.8))
                    )
            }

            // Close button (visible on hover or when active)
            if isHovered || isActive {
                Button(action: onClose) {
                    Image(systemName: "xmark")
                        .font(.system(size: 9, weight: .medium))
                        .foregroundColor(.secondary)
                        .frame(width: 16, height: 16)
                        .background(
                            Circle()
                                .fill(Color(NSColor.controlBackgroundColor))
                        )
                }
                .buttonStyle(.plain)
                .help("Close project")
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 6)
        .background(
            RoundedRectangle(cornerRadius: 6)
                .fill(isActive
                    ? Color.accentColor.opacity(0.15)
                    : (isHovered ? Color(NSColor.controlBackgroundColor) : Color.clear))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 6)
                .stroke(isActive ? Color.accentColor.opacity(0.5) : Color.clear, lineWidth: 1)
        )
        .contentShape(Rectangle())
        .onTapGesture {
            onSelect()
        }
    }
}

/// Empty workspace view shown when no projects are open
struct EmptyWorkspaceView: View {
    let onOpenProject: () -> Void

    var body: some View {
        VStack(spacing: 20) {
            Image(systemName: "folder.badge.plus")
                .font(.system(size: 64))
                .foregroundColor(.secondary)

            Text("No Project Open")
                .font(.title2)
                .fontWeight(.medium)

            Text("Open a project directory to get started")
                .font(.subheadline)
                .foregroundColor(.secondary)

            Button(action: onOpenProject) {
                Label("Open Project", systemImage: "folder")
            }
            .buttonStyle(.borderedProminent)
            .controlSize(.large)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}

#Preview {
    VStack(spacing: 0) {
        ProjectTabBar(workspaceManager: WorkspaceManager())
        Divider()
        EmptyWorkspaceView(onOpenProject: {})
    }
    .frame(width: 800, height: 600)
}
