---
layout: default
title: Configuration
nav_order: 6
---

# Configuration
{: .no_toc }

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## MCP Configuration

Maestro uses a built-in MCP server to enable AI agents to report their status. To configure it:

1. Copy the example configuration:

   ```bash
   cp .mcp.json.example .mcp.json
   ```

2. Edit `.mcp.json` to set the correct path to the MCP server binary.

The MCP server is automatically bundled when you build the app. The configuration tells AI CLIs where to find the server binary and how to connect.

### MCP Status Schema

AI agents report status using this JSON structure:

```json
{
  "agentId": "agent-1",
  "state": "working",
  "message": "Implementing authentication module",
  "needsInputPrompt": null,
  "timestamp": "2026-01-30T20:14:15.123Z"
}
```

| Field | Type | Description |
|:------|:-----|:------------|
| `agentId` | string | Unique agent identifier (`agent-{session_id}`) |
| `state` | string | One of: `idle`, `working`, `needs_input`, `finished`, `error` |
| `message` | string | Human-readable status description |
| `needsInputPrompt` | string? | Question text when state is `needs_input` |
| `timestamp` | string | ISO 8601 timestamp |

---

## Session Presets

Save and load session configurations as presets. A preset stores:

- Number of sessions
- AI mode for each session
- Branch assignments
- Quick action configurations
- CLI flags per session

### Creating a Preset

1. Configure your sessions as desired
2. Click the save icon in the preset selector
3. Give your preset a name

### Loading a Preset

Select a saved preset from the dropdown to restore all session configurations.

---

## Terminal Appearance

### Theme

Toggle between light and dark themes in the appearance settings.

### Font

Configure the terminal font:

- **System fonts** — Any font installed on your system
- **Nerd Fonts** — Fonts with extra icons and glyphs (recommended for AI CLIs that use icons)
- **Custom fonts** — Specify any font family name

### Text Size

Adjust the terminal text size with the size slider in appearance settings.

---

## CLI Flags

Customize the command-line arguments passed to AI CLIs when sessions launch.

### Per-Session Flags

Each session can have its own set of CLI flags. For example:

- Claude Code: `--model claude-sonnet-4-5-20250929` to use a specific model
- Gemini CLI: `--model gemini-2.5-pro` for model selection

### Global Defaults

Set default CLI flags that apply to all new sessions of a given AI mode.

---

## Quick Actions

Configure custom quick action buttons for each session.

### Built-in Actions

| Action | Prompt Sent |
|:-------|:------------|
| Run App | Tells the AI to run the application |
| Commit & Push | Tells the AI to commit and push changes |

### Custom Actions

Create your own actions with custom prompt text. Custom actions are saved per-session and persist across app restarts.

---

## Storage Locations

Maestro stores data in platform-standard locations:

| Data | Location |
|:-----|:---------|
| Worktrees | `~/.claude-maestro/worktrees/` |
| App config | Platform config dir (e.g., `~/.config/maestro/`) |
| Agent status | `/tmp/maestro/agents/` |
| Plugins | `~/.claude/plugins/` |
