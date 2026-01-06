//
//  GitSettingsView.swift
//  claude-maestro
//
//  Git configuration settings sheet
//

import SwiftUI

struct GitSettingsView: View {
    @ObservedObject var gitManager: GitManager
    @Environment(\.dismiss) private var dismiss

    // User config state
    @State private var editedUserName: String = ""
    @State private var editedUserEmail: String = ""
    @State private var applyUserConfigGlobally: Bool = false

    // Default branch state
    @State private var editedDefaultBranch: String = ""
    @State private var applyDefaultBranchGlobally: Bool = false

    // New remote state
    @State private var showAddRemote: Bool = false
    @State private var newRemoteName: String = ""
    @State private var newRemoteURL: String = ""

    // Edit remote state
    @State private var editingRemoteName: String? = nil
    @State private var editedRemoteURL: String = ""

    // UI state
    @State private var isSaving: Bool = false
    @State private var showError: Bool = false
    @State private var errorMessage: String = ""

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text("Git Settings")
                    .font(.headline)
                Spacer()
                Button("Done") { dismiss() }
                    .keyboardShortcut(.escape)
            }
            .padding()

            Divider()

            // Content
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    userConfigSection
                    Divider()
                    remotesSection
                    Divider()
                    defaultBranchSection
                }
                .padding()
            }
        }
        .frame(width: 450, height: 550)
        .onAppear { loadCurrentConfig() }
        .alert("Error", isPresented: $showError) {
            Button("OK") { }
        } message: {
            Text(errorMessage)
        }
    }

    // MARK: - User Config Section

    private var userConfigSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("User Identity")
                .font(.subheadline)
                .fontWeight(.semibold)

            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Image(systemName: "person.circle")
                        .foregroundColor(.blue)
                        .frame(width: 20)
                    TextField("Name", text: $editedUserName)
                        .textFieldStyle(.roundedBorder)
                }

                HStack {
                    Image(systemName: "envelope")
                        .foregroundColor(.blue)
                        .frame(width: 20)
                    TextField("Email", text: $editedUserEmail)
                        .textFieldStyle(.roundedBorder)
                }

                Toggle("Apply globally", isOn: $applyUserConfigGlobally)
                    .font(.caption)
                    .foregroundColor(.secondary)

                HStack {
                    Spacer()
                    Button("Save Identity") {
                        saveUserConfig()
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .disabled(isSaving || (editedUserName == gitManager.userName && editedUserEmail == gitManager.userEmail))
                }
            }
            .padding(12)
            .background(Color(NSColor.windowBackgroundColor))
            .cornerRadius(8)
        }
    }

    // MARK: - Remotes Section

    private var remotesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Remotes")
                    .font(.subheadline)
                    .fontWeight(.semibold)
                Spacer()
                Button {
                    showAddRemote.toggle()
                    newRemoteName = ""
                    newRemoteURL = ""
                } label: {
                    Image(systemName: showAddRemote ? "minus.circle" : "plus.circle")
                }
                .buttonStyle(.plain)
            }

            VStack(alignment: .leading, spacing: 8) {
                // Add new remote form
                if showAddRemote {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Add New Remote")
                            .font(.caption)
                            .foregroundColor(.secondary)

                        HStack {
                            TextField("Name (e.g., origin)", text: $newRemoteName)
                                .textFieldStyle(.roundedBorder)
                                .frame(width: 120)
                            TextField("URL", text: $newRemoteURL)
                                .textFieldStyle(.roundedBorder)
                        }

                        HStack {
                            Spacer()
                            Button("Cancel") {
                                showAddRemote = false
                            }
                            .buttonStyle(.bordered)
                            .controlSize(.small)

                            Button("Add") {
                                addRemote()
                            }
                            .buttonStyle(.borderedProminent)
                            .controlSize(.small)
                            .disabled(newRemoteName.isEmpty || newRemoteURL.isEmpty || isSaving)
                        }
                    }
                    .padding(8)
                    .background(Color.accentColor.opacity(0.1))
                    .cornerRadius(6)

                    Divider()
                }

                // Existing remotes list
                if gitManager.remoteURLs.isEmpty {
                    Text("No remotes configured")
                        .font(.caption)
                        .foregroundColor(.secondary)
                        .padding(.vertical, 8)
                } else {
                    ForEach(Array(gitManager.remoteURLs.keys.sorted()), id: \.self) { remoteName in
                        if let url = gitManager.remoteURLs[remoteName] {
                            remoteRow(name: remoteName, url: url)
                        }
                    }
                }
            }
            .padding(12)
            .background(Color(NSColor.windowBackgroundColor))
            .cornerRadius(8)
        }
    }

    private func remoteRow(name: String, url: String) -> some View {
        let status = gitManager.remoteStatuses[name] ?? .unknown
        let isEditing = editingRemoteName == name

        return VStack(alignment: .leading, spacing: 4) {
            HStack {
                Image(systemName: "network")
                    .foregroundColor(.green)
                    .font(.caption)
                Text(name)
                    .font(.caption)
                    .fontWeight(.medium)
                Spacer()

                // Status indicator
                RemoteStatusIndicator(status: status)

                // Test connection button
                Button {
                    Task {
                        gitManager.remoteStatuses[name] = .checking
                        let newStatus = await gitManager.checkRemoteConnectivity(remoteName: name)
                        gitManager.remoteStatuses[name] = newStatus
                    }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.caption2)
                }
                .buttonStyle(.plain)
                .help("Test connection")

                // Edit button
                Button {
                    if isEditing {
                        editingRemoteName = nil
                    } else {
                        editingRemoteName = name
                        editedRemoteURL = url
                    }
                } label: {
                    Image(systemName: isEditing ? "xmark" : "pencil")
                        .font(.caption2)
                }
                .buttonStyle(.plain)
                .help(isEditing ? "Cancel" : "Edit URL")

                // Delete button
                Button {
                    deleteRemote(name: name)
                } label: {
                    Image(systemName: "trash")
                        .font(.caption2)
                        .foregroundColor(.red)
                }
                .buttonStyle(.plain)
                .help("Remove remote")
            }

            if isEditing {
                HStack {
                    TextField("URL", text: $editedRemoteURL)
                        .textFieldStyle(.roundedBorder)
                        .font(.caption)
                    Button("Save") {
                        updateRemoteURL(name: name)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.mini)
                    .disabled(editedRemoteURL.isEmpty || editedRemoteURL == url)
                }
            } else {
                Text(url)
                    .font(.caption2)
                    .foregroundColor(.secondary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
        }
        .padding(8)
        .background(Color(NSColor.controlBackgroundColor))
        .cornerRadius(6)
    }

    // MARK: - Default Branch Section

    private var defaultBranchSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Default Branch")
                .font(.subheadline)
                .fontWeight(.semibold)

            VStack(alignment: .leading, spacing: 8) {
                Text("Branch name for new repositories")
                    .font(.caption)
                    .foregroundColor(.secondary)

                HStack {
                    TextField("e.g., main", text: $editedDefaultBranch)
                        .textFieldStyle(.roundedBorder)
                        .frame(width: 150)

                    // Quick options
                    ForEach(["main", "master", "develop"], id: \.self) { branch in
                        Button(branch) {
                            editedDefaultBranch = branch
                        }
                        .buttonStyle(.bordered)
                        .controlSize(.small)
                        .tint(editedDefaultBranch == branch ? .accentColor : nil)
                    }
                }

                Toggle("Apply globally", isOn: $applyDefaultBranchGlobally)
                    .font(.caption)
                    .foregroundColor(.secondary)

                HStack {
                    Spacer()
                    Button("Save Default Branch") {
                        saveDefaultBranch()
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.small)
                    .disabled(isSaving || editedDefaultBranch.isEmpty || editedDefaultBranch == gitManager.defaultBranch)
                }
            }
            .padding(12)
            .background(Color(NSColor.windowBackgroundColor))
            .cornerRadius(8)
        }
    }

    // MARK: - Actions

    private func loadCurrentConfig() {
        editedUserName = gitManager.userName ?? ""
        editedUserEmail = gitManager.userEmail ?? ""
        editedDefaultBranch = gitManager.defaultBranch ?? "main"
    }

    private func saveUserConfig() {
        isSaving = true
        Task {
            do {
                if editedUserName != gitManager.userName {
                    try await gitManager.setUserName(editedUserName, global: applyUserConfigGlobally)
                }
                if editedUserEmail != gitManager.userEmail {
                    try await gitManager.setUserEmail(editedUserEmail, global: applyUserConfigGlobally)
                }
            } catch {
                errorMessage = error.localizedDescription
                showError = true
            }
            isSaving = false
        }
    }

    private func saveDefaultBranch() {
        isSaving = true
        Task {
            do {
                try await gitManager.setDefaultBranch(editedDefaultBranch, global: applyDefaultBranchGlobally)
            } catch {
                errorMessage = error.localizedDescription
                showError = true
            }
            isSaving = false
        }
    }

    private func addRemote() {
        isSaving = true
        Task {
            do {
                try await gitManager.addRemote(name: newRemoteName, url: newRemoteURL)
                showAddRemote = false
                newRemoteName = ""
                newRemoteURL = ""
            } catch {
                errorMessage = error.localizedDescription
                showError = true
            }
            isSaving = false
        }
    }

    private func updateRemoteURL(name: String) {
        isSaving = true
        Task {
            do {
                try await gitManager.setRemoteURL(name: name, url: editedRemoteURL)
                editingRemoteName = nil
            } catch {
                errorMessage = error.localizedDescription
                showError = true
            }
            isSaving = false
        }
    }

    private func deleteRemote(name: String) {
        isSaving = true
        Task {
            do {
                try await gitManager.removeRemote(name: name)
            } catch {
                errorMessage = error.localizedDescription
                showError = true
            }
            isSaving = false
        }
    }
}

