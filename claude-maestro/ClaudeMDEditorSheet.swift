//
//  ClaudeMDEditorSheet.swift
//  claude-maestro
//
//  Sheet for viewing and editing the project's CLAUDE.md file
//

import SwiftUI
import AppKit

struct ClaudeMDEditorSheet: View {
    @ObservedObject var claudeMDManager: ClaudeMDManager
    @Environment(\.dismiss) private var dismiss

    @State private var editedContent: String = ""
    @State private var isSaving: Bool = false
    @State private var showError: Bool = false
    @State private var errorMessage: String = ""

    private var hasLocalChanges: Bool {
        editedContent != claudeMDManager.content
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Project CLAUDE.md")
                        .font(.headline)
                    if !claudeMDManager.claudeMDPath.isEmpty {
                        Text(claudeMDManager.claudeMDPath)
                            .font(.caption2)
                            .foregroundColor(.secondary)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }

                Spacer()

                // Status indicator
                if hasLocalChanges {
                    HStack(spacing: 4) {
                        Circle()
                            .fill(Color.orange)
                            .frame(width: 8, height: 8)
                        Text("Unsaved")
                            .font(.caption)
                            .foregroundColor(.orange)
                    }
                }

                Button {
                    dismiss()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
            }
            .padding()
            .background(Color(NSColor.windowBackgroundColor))

            Divider()

            // Main content
            VStack(alignment: .leading, spacing: 12) {
                // Info banner
                HStack(spacing: 8) {
                    Image(systemName: "info.circle")
                        .foregroundColor(.blue)
                    Text("This content will be included in all session CLAUDE.md files across worktrees.")
                        .font(.caption)
                        .foregroundColor(.secondary)
                }
                .padding(10)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(Color.blue.opacity(0.1))
                .cornerRadius(8)

                // Editor
                if claudeMDManager.fileExists || !editedContent.isEmpty {
                    TextEditor(text: $editedContent)
                        .font(.system(.body, design: .monospaced))
                        .frame(minHeight: 350)
                        .padding(4)
                        .background(Color(NSColor.textBackgroundColor))
                        .cornerRadius(8)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(Color.gray.opacity(0.3), lineWidth: 1)
                        )
                } else {
                    // No file exists - show create prompt
                    VStack(spacing: 16) {
                        Spacer()

                        Image(systemName: "doc.badge.plus")
                            .font(.system(size: 48))
                            .foregroundColor(.secondary)

                        Text("No CLAUDE.md file exists in this project")
                            .font(.headline)
                            .foregroundColor(.secondary)

                        Text("Create one to provide context for AI assistants working in your codebase.")
                            .font(.caption)
                            .foregroundColor(.secondary)
                            .multilineTextAlignment(.center)

                        Button("Create with Template") {
                            createWithTemplate()
                        }
                        .buttonStyle(.borderedProminent)

                        Spacer()
                    }
                    .frame(maxWidth: .infinity, minHeight: 350)
                    .background(Color(NSColor.controlBackgroundColor))
                    .cornerRadius(8)
                }
            }
            .padding()

            Divider()

            // Footer
            HStack {
                if claudeMDManager.fileExists {
                    Button("Reveal in Finder") {
                        revealInFinder()
                    }
                    .buttonStyle(.bordered)
                }

                Spacer()

                if claudeMDManager.fileExists || !editedContent.isEmpty {
                    Button("Discard Changes") {
                        editedContent = claudeMDManager.content
                    }
                    .buttonStyle(.bordered)
                    .disabled(!hasLocalChanges)

                    Button("Save") {
                        saveContent()
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(!hasLocalChanges || isSaving)
                    .keyboardShortcut(.return, modifiers: .command)
                }
            }
            .padding()
            .background(Color(NSColor.windowBackgroundColor))
        }
        .frame(width: 650, height: 580)
        .onAppear {
            editedContent = claudeMDManager.content
        }
        .alert("Error", isPresented: $showError) {
            Button("OK") { }
        } message: {
            Text(errorMessage)
        }
    }

    private func saveContent() {
        isSaving = true
        do {
            try claudeMDManager.saveContent(editedContent)
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
        isSaving = false
    }

    private func createWithTemplate() {
        do {
            try claudeMDManager.createWithTemplate()
            editedContent = claudeMDManager.content
        } catch {
            errorMessage = error.localizedDescription
            showError = true
        }
    }

    private func revealInFinder() {
        let path = claudeMDManager.claudeMDPath
        if !path.isEmpty {
            NSWorkspace.shared.selectFile(path, inFileViewerRootedAtPath: "")
        }
    }
}

#Preview {
    ClaudeMDEditorSheet(claudeMDManager: ClaudeMDManager())
}
