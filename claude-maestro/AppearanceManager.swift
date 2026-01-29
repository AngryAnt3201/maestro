//
//  AppearanceManager.swift
//  claude-maestro
//
//  Created by Maestro on 1/29/2026.
//

import Combine
import SwiftUI

enum AppearanceMode: String, CaseIterable, Codable {
    case light = "Light"
    case dark = "Dark"

    var icon: String {
        switch self {
        case .light: return "sun.max.fill"
        case .dark: return "moon.fill"
        }
    }

    var colorScheme: ColorScheme {
        switch self {
        case .light: return .light
        case .dark: return .dark
        }
    }
}

extension AppearanceMode {
    var next: AppearanceMode {
        switch self {
        case .light: return .dark
        case .dark: return .light
        }
    }
}

class AppearanceManager: ObservableObject {
    private static let preferenceKey = "claude-maestro-appearance-mode"

    @Published var currentMode: AppearanceMode {
        didSet {
            UserDefaults.standard.set(currentMode.rawValue, forKey: Self.preferenceKey)
        }
    }

    var nextMode: AppearanceMode {
        currentMode.next
    }

    init() {
        let saved = UserDefaults.standard.string(forKey: Self.preferenceKey)
            .flatMap(AppearanceMode.init(rawValue:))
        self.currentMode = saved ?? .dark
    }

    func cycleMode() {
        let allModes = AppearanceMode.allCases
        let currentIndex = allModes.firstIndex(of: currentMode) ?? 0
        let nextIndex = (currentIndex + 1) % allModes.count
        currentMode = allModes[nextIndex]
    }
}
