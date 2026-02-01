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
        // Prompt user before modifying third-party CLI configs (issue #51)
        ClaudeDocManager.promptForCLIIntegration()

        // Clean up orphaned/corrupted Codex MCP config sections from previous sessions
        ClaudeDocManager.cleanupOrphanedCodexSections()
    }

    var body: some Scene {
        WindowGroup {
            MultiProjectContentView()
        }
        .commands {
            CommandMenu("Terminals") {
                ForEach(1...9, id: \.self) { num in
                    Button("Terminal \(num)") {
                        NotificationCenter.default.post(
                            name: .navigateToTerminal,
                            object: nil,
                            userInfo: ["index": num - 1]
                        )
                    }
                    .keyboardShortcut(KeyEquivalent(Character(String(num))), modifiers: .command)
                }
                Button("Terminal 10") {
                    NotificationCenter.default.post(
                        name: .navigateToTerminal,
                        object: nil,
                        userInfo: ["index": 9]
                    )
                }
                .keyboardShortcut("0", modifiers: .command)

                Divider()

                Button("Next Terminal") {
                    NotificationCenter.default.post(name: .navigateNextTerminal, object: nil)
                }
                .keyboardShortcut("]", modifiers: .command)

                Button("Previous Terminal") {
                    NotificationCenter.default.post(name: .navigatePreviousTerminal, object: nil)
                }
                .keyboardShortcut("[", modifiers: .command)
            }
        }
    }
}

// MARK: - Terminal Navigation Notifications

extension Notification.Name {
    static let navigateToTerminal = Notification.Name("navigateToTerminal")
    static let navigateNextTerminal = Notification.Name("navigateNextTerminal")
    static let navigatePreviousTerminal = Notification.Name("navigatePreviousTerminal")
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
        // Setup MaestroMCPServer from bundle to Application Support
        setupMaestroMCPServer()

        // Check for orphaned processes on startup
        Task {
            let orphanCount = await processRegistry.orphanedAgentCount()
            if orphanCount > 0 {
                print("⚠️ Found \(orphanCount) orphaned agent process(es) from previous sessions")
                print("   Use the Processes sidebar to view and terminate them")
            }
        }
    }

    /// Copy MaestroMCPServer from app bundle to Application Support if needed.
    /// This ensures the MCP server is available for Claude Code sessions even when
    /// running from a downloaded DMG release.
    private func setupMaestroMCPServer() {
        let fm = FileManager.default

        // Find the bundled MaestroMCPServer in Resources
        guard let bundledPath = Bundle.main.url(forResource: "MaestroMCPServer", withExtension: nil) else {
            print("ℹ️ MaestroMCPServer not found in app bundle (development build)")
            return
        }

        // Get Application Support destination
        guard let appSupportURL = fm.urls(for: .applicationSupportDirectory, in: .userDomainMask).first else {
            print("⚠️ Could not find Application Support directory")
            return
        }

        let maestroDir = appSupportURL.appendingPathComponent("Claude Maestro")
        let destPath = maestroDir.appendingPathComponent("MaestroMCPServer")

        do {
            // Create directory if needed
            if !fm.fileExists(atPath: maestroDir.path) {
                try fm.createDirectory(at: maestroDir, withIntermediateDirectories: true)
            }

            // Check if we need to copy (doesn't exist or bundle version is newer)
            var shouldCopy = !fm.fileExists(atPath: destPath.path)

            if !shouldCopy {
                // Compare modification dates - copy if bundle is newer
                let bundledAttrs = try fm.attributesOfItem(atPath: bundledPath.path)
                let destAttrs = try fm.attributesOfItem(atPath: destPath.path)

                if let bundledDate = bundledAttrs[.modificationDate] as? Date,
                   let destDate = destAttrs[.modificationDate] as? Date {
                    shouldCopy = bundledDate > destDate
                }
            }

            if shouldCopy {
                // Remove existing file if present
                if fm.fileExists(atPath: destPath.path) {
                    try fm.removeItem(at: destPath)
                }

                // Copy from bundle
                try fm.copyItem(at: bundledPath, to: destPath)

                // Ensure executable permissions
                try fm.setAttributes([.posixPermissions: 0o755], ofItemAtPath: destPath.path)

                print("✅ MaestroMCPServer installed to Application Support")

                // Refresh MCPServerManager to use the new Application Support path
                Task { @MainActor in
                    MCPServerManager.shared.checkServerAvailability()
                }
            }
        } catch {
            print("⚠️ Failed to setup MaestroMCPServer: \(error.localizedDescription)")
        }
    }
}
