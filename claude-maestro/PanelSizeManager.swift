// PanelSizeManager.swift
// claude-maestro
//
// Manages and persists panel size ratios for the resizable terminal grid.

import SwiftUI
import Combine

/// Manages the size ratios for resizable panels in the terminal grid.
/// Persists sizes to UserDefaults and handles grid reconfiguration.
final class PanelSizeManager: ObservableObject {
    private static let storageKey = "claude-maestro-panel-sizes"

    /// Position of the horizontal divider between rows (0.0-1.0 ratio)
    @Published var horizontalSplit: CGFloat = 0.5

    /// Position of vertical dividers for each row (0.0-1.0 ratios)
    /// Index 0 = first row's column divider, Index 1 = second row's column divider, etc.
    @Published var verticalSplits: [CGFloat] = []

    /// Additional vertical split positions for rows with 3+ columns
    /// Maps row index to array of split positions
    @Published var multiColumnSplits: [Int: [CGFloat]] = [:]

    private var cancellables = Set<AnyCancellable>()

    init() {
        load()
        setupAutoSave()
    }

    // MARK: - Persistence

    private func setupAutoSave() {
        // Debounce saves to avoid excessive disk writes during dragging
        $horizontalSplit
            .debounce(for: .milliseconds(500), scheduler: DispatchQueue.main)
            .sink { [weak self] _ in self?.save() }
            .store(in: &cancellables)

        $verticalSplits
            .debounce(for: .milliseconds(500), scheduler: DispatchQueue.main)
            .sink { [weak self] _ in self?.save() }
            .store(in: &cancellables)

        $multiColumnSplits
            .debounce(for: .milliseconds(500), scheduler: DispatchQueue.main)
            .sink { [weak self] _ in self?.save() }
            .store(in: &cancellables)
    }

    private func load() {
        guard let data = UserDefaults.standard.data(forKey: Self.storageKey),
              let stored = try? JSONDecoder().decode(StoredPanelSizes.self, from: data) else {
            // Initialize with defaults
            initializeDefaults()
            return
        }

        horizontalSplit = stored.horizontalSplit
        verticalSplits = stored.verticalSplits
        multiColumnSplits = stored.multiColumnSplits
    }

    private func save() {
        let stored = StoredPanelSizes(
            version: 1,
            horizontalSplit: horizontalSplit,
            verticalSplits: verticalSplits,
            multiColumnSplits: multiColumnSplits
        )

        if let data = try? JSONEncoder().encode(stored) {
            UserDefaults.standard.set(data, forKey: Self.storageKey)
        }
    }

    private func initializeDefaults() {
        horizontalSplit = 0.5
        verticalSplits = [0.5, 0.5, 0.5]  // Support up to 3 rows
        multiColumnSplits = [:]
    }

    // MARK: - Public API

    /// Resets all panel sizes to equal distribution
    func reset() {
        horizontalSplit = 0.5
        verticalSplits = verticalSplits.map { _ in 0.5 }
        multiColumnSplits = multiColumnSplits.mapValues { $0.map { _ in 0.5 } }
        save()
    }

    /// Ensures we have enough vertical split values for the given number of rows
    func ensureCapacity(forRows rowCount: Int) {
        while verticalSplits.count < rowCount {
            verticalSplits.append(0.5)
        }
    }

    /// Returns the vertical split position for a given row, creating one if needed
    func verticalSplit(forRow row: Int) -> Binding<CGFloat> {
        ensureCapacity(forRows: row + 1)

        return Binding(
            get: { [weak self] in
                guard let self = self, row < self.verticalSplits.count else { return 0.5 }
                return self.verticalSplits[row]
            },
            set: { [weak self] newValue in
                guard let self = self, row < self.verticalSplits.count else { return }
                self.verticalSplits[row] = newValue
            }
        )
    }

    /// Returns column widths as ratios for a given row with the specified number of columns
    /// For 2 columns: uses single vertical split
    /// For 3+ columns: uses multiColumnSplits
    func columnWidths(forRow row: Int, columnCount: Int) -> [CGFloat] {
        switch columnCount {
        case 1:
            return [1.0]
        case 2:
            ensureCapacity(forRows: row + 1)
            let split = verticalSplits[safe: row] ?? 0.5
            return [split, 1.0 - split]
        default:
            // For 3+ columns, use evenly distributed widths
            // or stored multi-column splits if available
            if let splits = multiColumnSplits[row], splits.count == columnCount - 1 {
                var widths: [CGFloat] = []
                var remaining: CGFloat = 1.0
                for split in splits {
                    let width = remaining * split
                    widths.append(width)
                    remaining -= width
                }
                widths.append(remaining)
                return widths
            } else {
                // Equal distribution
                let width = 1.0 / CGFloat(columnCount)
                return Array(repeating: width, count: columnCount)
            }
        }
    }

    /// Called when grid configuration changes (sessions added/removed)
    /// Resets splits that are no longer valid
    func onGridReconfigured(newRows: Int, columnsPerRow: [Int]) {
        // Reset to defaults when configuration changes significantly
        // This prevents awkward sizing when going from 2x2 to 1x3, etc.
        ensureCapacity(forRows: newRows)

        // Clean up multiColumnSplits for rows that no longer exist
        for rowIndex in multiColumnSplits.keys where rowIndex >= newRows {
            multiColumnSplits.removeValue(forKey: rowIndex)
        }
    }
}

// MARK: - Storage Model

private struct StoredPanelSizes: Codable {
    let version: Int
    let horizontalSplit: CGFloat
    let verticalSplits: [CGFloat]
    let multiColumnSplits: [Int: [CGFloat]]

    enum CodingKeys: String, CodingKey {
        case version, horizontalSplit, verticalSplits, multiColumnSplits
    }

    init(version: Int, horizontalSplit: CGFloat, verticalSplits: [CGFloat], multiColumnSplits: [Int: [CGFloat]]) {
        self.version = version
        self.horizontalSplit = horizontalSplit
        self.verticalSplits = verticalSplits
        self.multiColumnSplits = multiColumnSplits
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        version = try container.decode(Int.self, forKey: .version)
        horizontalSplit = try container.decode(CGFloat.self, forKey: .horizontalSplit)
        verticalSplits = try container.decode([CGFloat].self, forKey: .verticalSplits)

        // Decode multiColumnSplits with string keys (JSON limitation)
        let stringKeyedSplits = try container.decodeIfPresent([String: [CGFloat]].self, forKey: .multiColumnSplits) ?? [:]
        multiColumnSplits = Dictionary(uniqueKeysWithValues: stringKeyedSplits.compactMap { key, value in
            guard let intKey = Int(key) else { return nil }
            return (intKey, value)
        })
    }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        try container.encode(version, forKey: .version)
        try container.encode(horizontalSplit, forKey: .horizontalSplit)
        try container.encode(verticalSplits, forKey: .verticalSplits)

        // Encode multiColumnSplits with string keys (JSON limitation)
        let stringKeyedSplits = Dictionary(uniqueKeysWithValues: multiColumnSplits.map { ("\($0.key)", $0.value) })
        try container.encode(stringKeyedSplits, forKey: .multiColumnSplits)
    }
}

