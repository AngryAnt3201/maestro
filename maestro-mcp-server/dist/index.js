#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import * as fs from "node:fs";
import * as path from "node:path";
const STATE_DIR = "/tmp/maestro/agents";
// Get agent ID from environment variable or generate default
const AGENT_ID = process.env.MAESTRO_AGENT_ID || `agent-${process.pid}`;
// Ensure state directory exists
function ensureStateDir() {
    if (!fs.existsSync(STATE_DIR)) {
        fs.mkdirSync(STATE_DIR, { recursive: true });
    }
}
// Write agent state to JSON file
function writeAgentState(state) {
    ensureStateDir();
    const filePath = path.join(STATE_DIR, `${state.agentId}.json`);
    fs.writeFileSync(filePath, JSON.stringify(state, null, 2));
}
// Create MCP server
const server = new McpServer({
    name: "maestro-status",
    version: "1.0.0",
});
// Define the maestro_status tool schema
const MaestroStatusSchema = z.object({
    state: z.enum(["idle", "working", "needs_input", "finished", "error"]).describe("The current state of the agent: idle (ready for work), working (actively processing), needs_input (waiting for user input), finished (task complete), error (hit a blocker)"),
    message: z.string().describe("A brief description of what the agent is doing or waiting for"),
    needsInputPrompt: z.string().optional().describe("When state is 'needs_input', the specific question or prompt for the user"),
});
// Register the maestro_status tool
server.tool("maestro_status", "Report agent status to Claude Maestro. Call this whenever your state changes (starting work, waiting for input, finished, encountering errors). This enables the Maestro UI to display meaningful status information.", MaestroStatusSchema.shape, async (params) => {
    const { state, message, needsInputPrompt } = params;
    // Validate needs_input has a prompt
    if (state === "needs_input" && !needsInputPrompt) {
        return {
            content: [
                {
                    type: "text",
                    text: "Error: needsInputPrompt is required when state is 'needs_input'",
                },
            ],
            isError: true,
        };
    }
    // Create agent state object
    const agentState = {
        agentId: AGENT_ID,
        state,
        message,
        needsInputPrompt: state === "needs_input" ? needsInputPrompt : undefined,
        timestamp: new Date().toISOString(),
    };
    // Write state to file
    try {
        writeAgentState(agentState);
        return {
            content: [
                {
                    type: "text",
                    text: `Status updated: ${state} - ${message}`,
                },
            ],
        };
    }
    catch (error) {
        return {
            content: [
                {
                    type: "text",
                    text: `Error writing status: ${error instanceof Error ? error.message : String(error)}`,
                },
            ],
            isError: true,
        };
    }
});
// Start the server
async function main() {
    // Write initial idle state on startup
    writeAgentState({
        agentId: AGENT_ID,
        state: "idle",
        message: "Agent ready",
        timestamp: new Date().toISOString(),
    });
    const transport = new StdioServerTransport();
    await server.connect(transport);
}
main().catch(console.error);
