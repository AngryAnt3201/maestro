//
//  MCPServerEditorSheet.swift
//  claude-maestro
//
//  Sheet for adding/editing custom MCP servers
//

import SwiftUI
import AppKit

struct MCPServerEditorSheet: View {
    let server: MCPServerConfig?
    let onSave: (MCPServerConfig) -> Void
    let onCancel: () -> Void

    @State private var name: String = ""
    @State private var command: String = ""
    @State private var argsText: String = ""
    @State private var envPairs: [EnvPair] = []
    @State private var workingDirectory: String = ""

    struct EnvPair: Identifiable {
        let id = UUID()
        var key: String
        var value: String
    }

    var body: some View {
        VStack(spacing: 0) {
            // Header
            HStack {
                Text(server == nil ? "Add MCP Server" : "Edit MCP Server")
                    .font(.headline)
                Spacer()
                Button {
                    onCancel()
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
            }
            .padding()
            .background(Color(NSColor.windowBackgroundColor))

            Divider()

            // Form content
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Server Details Section
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Server Details")
                            .font(.subheadline)
                            .fontWeight(.semibold)
                            .foregroundColor(.secondary)

                        VStack(alignment: .leading, spacing: 12) {
                            // Name field
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Name")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                TextField("e.g., GitHub MCP", text: $name)
                                    .textFieldStyle(.roundedBorder)
                            }

                            // Command field
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Command")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                TextField("e.g., npx, node, python", text: $command)
                                    .textFieldStyle(.roundedBorder)
                            }

                            // Arguments field
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Arguments (comma-separated)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                TextField("e.g., @github/mcp-server, --verbose", text: $argsText)
                                    .textFieldStyle(.roundedBorder)
                            }

                            // Working Directory field
                            VStack(alignment: .leading, spacing: 4) {
                                Text("Working Directory (optional)")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                HStack {
                                    TextField("Leave empty for default", text: $workingDirectory)
                                        .textFieldStyle(.roundedBorder)
                                    Button("Browse") {
                                        selectDirectory()
                                    }
                                    .buttonStyle(.bordered)
                                    .controlSize(.small)
                                }
                            }
                        }
                        .padding()
                        .background(Color(NSColor.controlBackgroundColor))
                        .cornerRadius(8)
                    }

                    // Environment Variables Section
                    VStack(alignment: .leading, spacing: 8) {
                        HStack {
                            Text("Environment Variables")
                                .font(.subheadline)
                                .fontWeight(.semibold)
                                .foregroundColor(.secondary)

                            Spacer()

                            Button {
                                envPairs.append(EnvPair(key: "", value: ""))
                            } label: {
                                Image(systemName: "plus.circle")
                                    .foregroundColor(.accentColor)
                            }
                            .buttonStyle(.plain)
                            .help("Add environment variable")
                        }

                        VStack(spacing: 8) {
                            if envPairs.isEmpty {
                                Text("No environment variables configured")
                                    .font(.caption)
                                    .foregroundColor(.secondary)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .padding(12)
                            } else {
                                ForEach($envPairs) { $pair in
                                    HStack(spacing: 8) {
                                        TextField("Key", text: $pair.key)
                                            .textFieldStyle(.roundedBorder)
                                            .frame(maxWidth: 120)

                                        Text("=")
                                            .foregroundColor(.secondary)

                                        TextField("Value", text: $pair.value)
                                            .textFieldStyle(.roundedBorder)

                                        Button {
                                            envPairs.removeAll { $0.id == pair.id }
                                        } label: {
                                            Image(systemName: "minus.circle")
                                                .foregroundColor(.red.opacity(0.8))
                                        }
                                        .buttonStyle(.plain)
                                        .help("Remove variable")
                                    }
                                }
                            }
                        }
                        .padding()
                        .background(Color(NSColor.controlBackgroundColor))
                        .cornerRadius(8)
                    }

                    // Preview Section
                    if !name.isEmpty && !command.isEmpty {
                        VStack(alignment: .leading, spacing: 8) {
                            Text("Preview")
                                .font(.subheadline)
                                .fontWeight(.semibold)
                                .foregroundColor(.secondary)

                            VStack(alignment: .leading, spacing: 4) {
                                Text("Command: \(buildCommandPreview())")
                                    .font(.caption)
                                    .fontDesign(.monospaced)
                                    .foregroundColor(.secondary)
                            }
                            .padding()
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(Color(NSColor.controlBackgroundColor))
                            .cornerRadius(8)
                        }
                    }
                }
                .padding()
            }

            Divider()

            // Footer buttons
            HStack {
                Button("Cancel") {
                    onCancel()
                }
                .buttonStyle(.bordered)
                .keyboardShortcut(.escape)

                Spacer()

                Button("Save") {
                    saveServer()
                }
                .buttonStyle(.borderedProminent)
                .disabled(name.isEmpty || command.isEmpty)
                .keyboardShortcut(.return)
            }
            .padding()
            .background(Color(NSColor.windowBackgroundColor))
        }
        .frame(width: 450, height: 520)
        .onAppear {
            loadServer()
        }
    }

    private func loadServer() {
        guard let server = server else { return }
        name = server.name
        command = server.command
        argsText = server.args.joined(separator: ", ")
        workingDirectory = server.workingDirectory ?? ""
        envPairs = server.env.map { EnvPair(key: $0.key, value: $0.value) }
    }

    private func saveServer() {
        let args = argsText
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }

        let env = Dictionary(
            uniqueKeysWithValues: envPairs
                .filter { !$0.key.isEmpty }
                .map { ($0.key, $0.value) }
        )

        let newServer = MCPServerConfig(
            id: server?.id ?? UUID(),
            name: name.trimmingCharacters(in: .whitespaces),
            command: command.trimmingCharacters(in: .whitespaces),
            args: args,
            env: env,
            workingDirectory: workingDirectory.isEmpty ? nil : workingDirectory,
            isEnabled: server?.isEnabled ?? true,
            createdAt: server?.createdAt ?? Date()
        )
        onSave(newServer)
    }

    private func selectDirectory() {
        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.message = "Select working directory for MCP server"

        if panel.runModal() == .OK {
            workingDirectory = panel.url?.path ?? ""
        }
    }

    private func buildCommandPreview() -> String {
        var parts = [command]
        let args = argsText
            .split(separator: ",")
            .map { $0.trimmingCharacters(in: .whitespaces) }
            .filter { !$0.isEmpty }
        parts.append(contentsOf: args)
        return parts.joined(separator: " ")
    }
}
