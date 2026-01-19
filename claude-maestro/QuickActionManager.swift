//
//  QuickActionManager.swift
//  claude-maestro
//
//  Manages persistence and CRUD operations for custom quick actions
//

import Foundation
import SwiftUI
import Combine

/// Manages the lifecycle and persistence of custom quick actions
@MainActor
class QuickActionManager: ObservableObject {
    static let shared = QuickActionManager()

    @Published var quickActions: [QuickAction] = []

    private let storageKey = "claude-maestro-quick-actions"
    private let hasInitializedKey = "claude-maestro-quick-actions-initialized"

    private init() {
        loadActions()
    }

    // MARK: - Default Actions

    /// Default quick actions provided on first launch
    static var defaultActions: [QuickAction] {
        [
            QuickAction(
                name: "Run App",
                icon: "play.fill",
                colorHex: "#34C759",
                prompt: "Run the application",
                sortOrder: 0
            ),
            QuickAction(
                name: "Commit & Push",
                icon: "arrow.up.circle.fill",
                colorHex: "#007AFF",
                prompt: "Commit all changes with a descriptive message and push to remote",
                sortOrder: 1
            )
        ]
    }

    // MARK: - Computed Properties

    /// Returns enabled actions sorted by sortOrder
    var enabledActions: [QuickAction] {
        quickActions
            .filter { $0.isEnabled }
            .sorted { $0.sortOrder < $1.sortOrder }
    }

    // MARK: - CRUD Operations

    /// Add a new quick action
    func addAction(_ action: QuickAction) {
        var newAction = action
        // Set sort order to be last
        newAction.sortOrder = (quickActions.map { $0.sortOrder }.max() ?? -1) + 1
        quickActions.append(newAction)
        persistActions()
    }

    /// Update an existing quick action
    func updateAction(_ action: QuickAction) {
        if let index = quickActions.firstIndex(where: { $0.id == action.id }) {
            quickActions[index] = action
            persistActions()
        }
    }

    /// Delete a quick action by ID
    func deleteAction(id: UUID) {
        quickActions.removeAll { $0.id == id }
        persistActions()
    }

    /// Toggle the enabled state of an action
    func toggleAction(id: UUID) {
        if let index = quickActions.firstIndex(where: { $0.id == id }) {
            quickActions[index].isEnabled.toggle()
            persistActions()
        }
    }

    /// Reorder actions (used for drag-and-drop)
    func reorderActions(from source: IndexSet, to destination: Int) {
        quickActions.move(fromOffsets: source, toOffset: destination)
        // Update sort orders
        for (index, _) in quickActions.enumerated() {
            quickActions[index].sortOrder = index
        }
        persistActions()
    }

    // MARK: - Persistence

    private func persistActions() {
        if let encoded = try? JSONEncoder().encode(quickActions) {
            UserDefaults.standard.set(encoded, forKey: storageKey)
        }
    }

    private func loadActions() {
        if let data = UserDefaults.standard.data(forKey: storageKey),
           let decoded = try? JSONDecoder().decode([QuickAction].self, from: data) {
            quickActions = decoded.sorted { $0.sortOrder < $1.sortOrder }
        } else if !UserDefaults.standard.bool(forKey: hasInitializedKey) {
            // First launch - add default actions
            quickActions = Self.defaultActions
            UserDefaults.standard.set(true, forKey: hasInitializedKey)
            persistActions()
        }
    }

    /// Reset quick actions to defaults
    func resetToDefaults() {
        quickActions = Self.defaultActions
        persistActions()
    }
}
