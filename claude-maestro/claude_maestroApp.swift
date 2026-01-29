//
//  claude_maestroApp.swift
//  claude-maestro
//
//  Created by Jack on 6/1/2026.
//

import SwiftUI
import AppKit

@main
struct claude_maestroApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) var appDelegate

    init() {
        // One-time setup: Configure Codex and Gemini CLI to read CLAUDE.md
        ClaudeDocManager.setupCLIContextFiles()

        // Clean up orphaned/corrupted Codex MCP config sections from previous sessions
        ClaudeDocManager.cleanupOrphanedCodexSections()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}

// MARK: - App Delegate for Lifecycle Events

class AppDelegate: NSObject, NSApplicationDelegate {
    private let processRegistry = ProcessRegistry()

    func applicationWillTerminate(_ notification: Notification) {
        // Clean up all managed processes when app terminates
        Task {
            await processRegistry.cleanupAll(killProcesses: true)
        }

        // Also terminate any orphaned agent processes
        Task {
            _ = await processRegistry.terminateOrphanedAgentProcesses()
        }

        // Give processes a moment to terminate
        Thread.sleep(forTimeInterval: 0.5)
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        // Check for orphaned processes on startup
        Task {
            let orphanCount = await processRegistry.orphanedAgentCount()
            if orphanCount > 0 {
                print("⚠️ Found \(orphanCount) orphaned agent process(es) from previous sessions")
                print("   Use the Processes sidebar to view and terminate them")
            }
        }
    }
}
