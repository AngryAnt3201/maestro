//
//  QuickActionsManagerSheet.swift
//  claude-maestro
//
//  Modal for managing quick actions (add, edit, delete, reset)
//

import SwiftUI

struct QuickActionsManagerSheet: View {
    @ObservedObject var quickActionManager: QuickActionManager
    let onDismiss: () -> Void

    @State private var showAddSheet = false
    @State private var editingAction: QuickAction? = nil
    @State private var actionToDelete: QuickAction? = nil
    @State private var showDeleteConfirmation = false
    @State private var showResetConfirmation = false

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Manage Quick Actions")
                    .font(.headline)
                Spacer()
                Button("Done") { onDismiss() }
                    .buttonStyle(.plain)
                    .foregroundColor(.accentColor)
            }
            .padding()
            .background(Color(NSColor.windowBackgroundColor))

            Divider()

            // Content
            if quickActionManager.quickActions.isEmpty {
                VStack(spacing: 12) {
                    Image(systemName: "bolt.circle")
                        .font(.system(size: 40))
                        .foregroundColor(.secondary)
                    Text("No Quick Actions")
                        .font(.headline)
                        .foregroundColor(.secondary)
                    Text("Add actions to quickly send prompts to Claude")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ScrollView {
                    VStack(spacing: 8) {
                        ForEach(quickActionManager.sortedActions) { action in
                            QuickActionManagerRow(
                                action: action,
                                onEdit: { editingAction = action },
                                onDelete: {
                                    actionToDelete = action
                                    showDeleteConfirmation = true
                                }
                            )
                        }
                    }
                    .padding()
                }
            }

            Divider()

            // Footer with Add and Reset buttons
            HStack {
                Button {
                    showResetConfirmation = true
                } label: {
                    Label("Reset to Defaults", systemImage: "arrow.counterclockwise")
                }
                .buttonStyle(.plain)
                .foregroundColor(.secondary)

                Spacer()

                Button {
                    showAddSheet = true
                } label: {
                    Label("Add Quick Action", systemImage: "plus")
                }
                .buttonStyle(.borderedProminent)
            }
            .padding()
            .background(Color(NSColor.windowBackgroundColor))
        }
        .frame(width: 420, height: 400)
        .sheet(isPresented: $showAddSheet) {
            QuickActionEditorSheet(
                action: nil,
                onSave: { action in
                    quickActionManager.addAction(action)
                    showAddSheet = false
                },
                onCancel: { showAddSheet = false }
            )
        }
        .sheet(item: $editingAction) { action in
            QuickActionEditorSheet(
                action: action,
                onSave: { updated in
                    quickActionManager.updateAction(updated)
                    editingAction = nil
                },
                onCancel: { editingAction = nil }
            )
        }
        .alert("Delete Quick Action?", isPresented: $showDeleteConfirmation) {
            Button("Cancel", role: .cancel) {
                actionToDelete = nil
            }
            Button("Delete", role: .destructive) {
                if let action = actionToDelete {
                    quickActionManager.deleteAction(id: action.id)
                }
                actionToDelete = nil
            }
        } message: {
            if let action = actionToDelete {
                Text("Are you sure you want to delete \"\(action.name)\"? This cannot be undone.")
            }
        }
        .alert("Reset Quick Actions?", isPresented: $showResetConfirmation) {
            Button("Cancel", role: .cancel) { }
            Button("Reset", role: .destructive) {
                quickActionManager.resetToDefaults()
            }
        } message: {
            Text("This will replace all your quick actions with the defaults (Run App, Commit & Push).")
        }
    }
}

struct QuickActionManagerRow: View {
    let action: QuickAction
    let onEdit: () -> Void
    let onDelete: () -> Void

    var body: some View {
        HStack(spacing: 12) {
            // Icon
            Image(systemName: action.icon)
                .foregroundColor(action.color)
                .font(.system(size: 16))
                .frame(width: 24, height: 24)

            // Name and prompt preview
            VStack(alignment: .leading, spacing: 2) {
                Text(action.name)
                    .font(.body)
                    .fontWeight(.medium)
                    .lineLimit(1)
                Text(action.prompt)
                    .font(.caption)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
            }

            Spacer()

            // Edit and Delete buttons
            HStack(spacing: 8) {
                Button { onEdit() } label: {
                    Image(systemName: "pencil")
                        .font(.system(size: 14))
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
                .help("Edit action")

                Button { onDelete() } label: {
                    Image(systemName: "trash")
                        .font(.system(size: 14))
                        .foregroundColor(.red.opacity(0.7))
                }
                .buttonStyle(.plain)
                .help("Delete action")
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(Color(NSColor.controlBackgroundColor))
        )
    }
}

#Preview {
    QuickActionsManagerSheet(
        quickActionManager: QuickActionManager.shared,
        onDismiss: { }
    )
}
