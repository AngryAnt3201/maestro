//
//  claude_maestroApp.swift
//  claude-maestro
//
//  Created by Jack Wakem on 6/1/2026.
//

import SwiftUI

@main
struct claude_maestroApp: App {
    init() {
        // One-time setup: Configure Codex and Gemini CLI to read CLAUDE.md
        ClaudeDocManager.setupCLIContextFiles()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
