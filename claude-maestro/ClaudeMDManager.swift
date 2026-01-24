//
//  ClaudeMDManager.swift
//  claude-maestro
//
//  Manager for reading/writing the main project's CLAUDE.md file
//

import Foundation
import Combine

@MainActor
class ClaudeMDManager: ObservableObject {
    @Published var content: String = ""
    @Published var hasUnsavedChanges: Bool = false
    @Published var isLoading: Bool = false
    @Published var lastError: String? = nil
    @Published var fileExists: Bool = false

    private var projectPath: String = ""

    /// Path to CLAUDE.md in the main project directory
    var claudeMDPath: String {
        guard !projectPath.isEmpty else { return "" }
        return URL(fileURLWithPath: projectPath)
            .appendingPathComponent("CLAUDE.md").path
    }

    /// Load content from the project's CLAUDE.md file
    func loadContent(from projectPath: String) {
        self.projectPath = projectPath
        isLoading = true
        lastError = nil

        guard !projectPath.isEmpty else {
            content = ""
            fileExists = false
            isLoading = false
            return
        }

        let path = URL(fileURLWithPath: projectPath)
            .appendingPathComponent("CLAUDE.md").path

        let fm = FileManager.default
        fileExists = fm.fileExists(atPath: path)

        if fileExists {
            do {
                content = try String(contentsOfFile: path, encoding: .utf8)
                hasUnsavedChanges = false
            } catch {
                lastError = "Failed to read CLAUDE.md: \(error.localizedDescription)"
                content = ""
            }
        } else {
            content = ""
            hasUnsavedChanges = false
        }

        isLoading = false
    }

    /// Save content to the project's CLAUDE.md file
    func saveContent(_ newContent: String) throws {
        guard !projectPath.isEmpty else {
            throw ClaudeMDError.noProjectPath
        }

        let path = URL(fileURLWithPath: projectPath)
            .appendingPathComponent("CLAUDE.md").path

        try newContent.write(toFile: path, atomically: true, encoding: .utf8)

        content = newContent
        fileExists = true
        hasUnsavedChanges = false
        lastError = nil
    }

    /// Create a new CLAUDE.md file with a default template
    func createWithTemplate() throws {
        let template = """
        # Project Context

        This file provides context for AI coding assistants working in this repository.

        ## Project Overview

        [Describe your project here]

        ## Architecture

        [Key architectural decisions and patterns]

        ## Coding Standards

        [Your team's coding conventions]

        ## Important Notes

        [Any critical information for AI assistants]
        """

        try saveContent(template)
    }

    /// Get the current content for inclusion in worktree CLAUDE.md files
    func getContentForWorktrees() -> String? {
        guard fileExists, !content.isEmpty else { return nil }
        return content
    }

    /// Clear manager state (e.g., when changing projects)
    func clear() {
        projectPath = ""
        content = ""
        fileExists = false
        hasUnsavedChanges = false
        lastError = nil
    }
}

enum ClaudeMDError: LocalizedError {
    case noProjectPath
    case fileNotFound
    case writeError(String)

    var errorDescription: String? {
        switch self {
        case .noProjectPath:
            return "No project path set"
        case .fileNotFound:
            return "CLAUDE.md file not found"
        case .writeError(let message):
            return "Failed to write file: \(message)"
        }
    }
}
