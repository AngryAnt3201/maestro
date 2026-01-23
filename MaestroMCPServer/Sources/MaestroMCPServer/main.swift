import Foundation
import MCP

let stateDir = "/tmp/maestro/agents"

/// Write agent state to a JSON file for MaestroStateMonitor to pick up
func writeAgentState(agentId: String, state: String, message: String, prompt: String? = nil) {
    let fm = FileManager.default
    try? fm.createDirectory(atPath: stateDir, withIntermediateDirectories: true)

    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]

    var dict: [String: Any] = [
        "agentId": agentId,
        "state": state,
        "message": message,
        "timestamp": formatter.string(from: Date())
    ]
    if let prompt = prompt {
        dict["needsInputPrompt"] = prompt
    }

    if let data = try? JSONSerialization.data(withJSONObject: dict, options: .prettyPrinted) {
        let path = (stateDir as NSString).appendingPathComponent("\(agentId).json")
        try? data.write(to: URL(fileURLWithPath: path))
    }
}

/// Main entry point for the MCP server
@main
struct MaestroMCPServer {
    static func main() async throws {
        // Get agent ID from environment or generate from process ID
        let agentId = ProcessInfo.processInfo.environment["MAESTRO_AGENT_ID"]
            ?? "agent-\(ProcessInfo.processInfo.processIdentifier)"

        // Write initial idle state
        writeAgentState(agentId: agentId, state: "idle", message: "Agent ready")

        // Create MCP server
        let server = Server(
            name: "maestro-status",
            version: "1.0.0",
            capabilities: .init(tools: .init(listChanged: false))
        )

        // Define the maestro_status tool schema using the Value type
        let inputSchema: Value = [
            "type": "object",
            "properties": [
                "state": [
                    "type": "string",
                    "description": "The current state of the agent: idle (ready for work), working (actively processing), needs_input (waiting for user input), finished (task complete), error (hit a blocker)",
                    "enum": ["idle", "working", "needs_input", "finished", "error"]
                ],
                "message": [
                    "type": "string",
                    "description": "A brief description of what the agent is doing or waiting for"
                ],
                "needsInputPrompt": [
                    "type": "string",
                    "description": "When state is 'needs_input', the specific question or prompt for the user"
                ]
            ],
            "required": ["state", "message"]
        ]

        let tool = Tool(
            name: "maestro_status",
            description: "Report agent status to Claude Maestro. Call this whenever your state changes (starting work, waiting for input, finished, encountering errors). This enables the Maestro UI to display meaningful status information.",
            inputSchema: inputSchema
        )

        // Handler for listing tools
        await server.withMethodHandler(ListTools.self) { _ in
            ListTools.Result(tools: [tool])
        }

        // Handler for calling tools
        await server.withMethodHandler(CallTool.self) { params in
            guard params.name == "maestro_status" else {
                throw MCPError.invalidParams("Unknown tool: \(params.name)")
            }

            // Extract parameters from the tool call
            let state = extractString(from: params.arguments, key: "state") ?? "idle"
            let message = extractString(from: params.arguments, key: "message") ?? ""
            let prompt = extractString(from: params.arguments, key: "needsInputPrompt")

            // Write the state file
            writeAgentState(agentId: agentId, state: state, message: message, prompt: prompt)

            return CallTool.Result(content: [.text("Status updated: \(state) - \(message)")])
        }

        // Start the server with stdio transport
        let transport = StdioTransport()
        try await server.start(transport: transport)
        await server.waitUntilCompleted()
    }

    /// Helper to extract string values from MCP Value arguments
    static func extractString(from arguments: [String: Value]?, key: String) -> String? {
        guard let args = arguments, let value = args[key] else { return nil }
        return value.stringValue
    }
}
