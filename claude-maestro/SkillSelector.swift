//
//  SkillSelector.swift
//  claude-maestro
//
//  Skill selection dropdown for session headers
//

import SwiftUI

struct SkillSelector: View {
    let sessionId: Int
    @ObservedObject var skillManager: SkillManager
    var isDisabled: Bool = false

    private var sessionConfig: SessionSkillConfig {
        skillManager.getSkillConfig(for: sessionId)
    }

    /// Count of enabled skills for this session
    private var enabledCount: Int {
        skillManager.installedSkills.filter { skill in
            skill.isEnabled && sessionConfig.isSkillEnabled(skill.id)
        }.count
    }

    /// List of enabled skill names for tooltip
    private var enabledSkillNames: [String] {
        skillManager.installedSkills
            .filter { $0.isEnabled && sessionConfig.isSkillEnabled($0.id) }
            .map { "/\($0.commandName)" }
    }

    /// Globally enabled skills (available for selection)
    private var availableSkills: [SkillConfig] {
        skillManager.installedSkills.filter { $0.isEnabled }
    }

    var body: some View {
        Group {
            if isDisabled {
                // Post-launch: Read-only badge
                readOnlyBadge
            } else {
                // Pre-launch: Interactive dropdown
                interactiveDropdown
            }
        }
        .onAppear {
            // Initialize session config with defaults if needed
            skillManager.initializeSessionConfig(for: sessionId)
        }
    }

    // MARK: - Read-Only Badge (Post-Launch)

    private var readOnlyBadge: some View {
        HStack(spacing: 4) {
            Image(systemName: "sparkles")
            Text("\(enabledCount) Skills")
        }
        .font(.caption2)
        .foregroundColor(.orange)
        .padding(.horizontal, 6)
        .padding(.vertical, 3)
        .background(Color.orange.opacity(0.15))
        .cornerRadius(6)
        .help(enabledSkillNames.isEmpty ? "No skills enabled" : enabledSkillNames.joined(separator: ", "))
    }

    // MARK: - Interactive Dropdown (Pre-Launch)

    private var interactiveDropdown: some View {
        Menu {
            Section("Skills") {
                if availableSkills.isEmpty {
                    Text("No skills installed")
                        .foregroundColor(.secondary)
                } else {
                    ForEach(availableSkills) { skill in
                        Toggle(isOn: Binding(
                            get: { sessionConfig.isSkillEnabled(skill.id) },
                            set: { skillManager.setSkillEnabled(skill.id, enabled: $0, for: sessionId) }
                        )) {
                            Label {
                                VStack(alignment: .leading) {
                                    Text("/\(skill.commandName)")
                                    if !skill.description.isEmpty {
                                        Text(skill.description)
                                            .font(.caption2)
                                            .foregroundColor(.secondary)
                                    }
                                }
                            } icon: {
                                Image(systemName: skill.source.icon)
                            }
                        }
                    }
                }
            }

            Divider()

            Button {
                skillManager.scanForSkills()
            } label: {
                Label("Rescan Skills", systemImage: "arrow.clockwise")
            }
        } label: {
            HStack(spacing: 4) {
                Image(systemName: "sparkles")
                Text("\(enabledCount)")
                Image(systemName: "chevron.down")
                    .font(.caption2)
            }
            .font(.caption)
            .padding(.horizontal, 8)
            .padding(.vertical, 4)
            .background(Color.orange.opacity(0.15))
            .cornerRadius(6)
        }
    }
}

#Preview {
    HStack {
        SkillSelector(
            sessionId: 1,
            skillManager: SkillManager.shared,
            isDisabled: false
        )
        SkillSelector(
            sessionId: 1,
            skillManager: SkillManager.shared,
            isDisabled: true
        )
    }
    .padding()
}
