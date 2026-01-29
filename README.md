# Claude Maestro

**Orchestrate multiple AI coding assistants in parallel**

A native macOS application that lets you run 1-12 Claude Code (or other AI CLI) sessions simultaneously, each in its own isolated git worktree.

![macOS](https://img.shields.io/badge/macOS-14%2B-blue)
![Swift](https://img.shields.io/badge/Swift-5.9-orange)
![License](https://img.shields.io/badge/license-MIT-green)

<!-- Add your screenshot: save as assets/screenshot.png -->
![Claude Maestro](assets/screenshot.png)

---

## Why Maestro?

**The Problem:** AI coding assistants work on one task at a time. While Claude works on Feature A, you wait. Then you start Feature B. Then you wait again. Context switching is expensive, and your development velocity is bottlenecked by serial execution.

**The Solution:** Run multiple AI sessions in parallel. Each session gets its own:
- Terminal instance with full shell environment
- Git worktree for complete code isolation
- Assigned branch for focused work
- Port allocation for web development

### Core Principles

| Principle | Description |
|-----------|-------------|
| **Parallel Development** | Launch 1-12 AI sessions simultaneously. Work on feature branches, bug fixes, and refactoring all at once. |
| **True Isolation** | Each session operates in its own git worktree. No merge conflicts, no stepping on each other's changes. |
| **AI-Native Workflow** | Built specifically for Claude Code, Gemini CLI, OpenAI Codex, and other AI coding assistants. |

---

## Features

### Multi-Terminal Session Grid
- Dynamic grid layout (1x1 to 3x4) that adapts to your session count
- Real-time status indicators: idle, working, waiting for input, done, error
- Per-session mode selection (Claude Code, Gemini CLI, OpenAI Codex, Plain Terminal)

### Git Worktree Isolation
- Automatic worktree creation at `~/.claude-maestro/worktrees/`
- Each session works on its own branch without conflicts
- Worktrees are pruned on session close
- Visual branch assignment in the sidebar

### MCP Server Integration
- Built-in MCP server for agent status reporting
- AI sessions report their state (idle, working, needs input, finished, error)
- Real-time status updates displayed in the session grid
- Uses the `maestro_status` tool for state communication

### Visual Git Graph
- GitKraken-style commit visualization
- Branch relationship view with colored rails
- Commit detail panel with diffs
- See which sessions are working on which branches

### Template Presets
- Save session configurations (modes, branches, count)
- Quickly load common workflows
- Persist across app restarts

### Quick Actions
- Custom action buttons per session
- "Run App", "Commit & Push", and custom prompts
- Execute commands via AI assistant

### Multi-AI Support
- **Claude Code** - Anthropic's Claude in the terminal
- **Gemini CLI** - Google's Gemini AI
- **OpenAI Codex** - OpenAI's coding assistant
- **Plain Terminal** - Standard shell without AI

### Plugin Marketplace
- Browse and install plugins from marketplace sources
- Plugin types: Skills, Commands, and MCP servers
- Per-session plugin configuration
- Automatic symlink management for commands and skills
- Extend Maestro's capabilities with community plugins

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                    Claude Maestro (Swift/SwiftUI)               │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Session 1   │  │  Session 2   │  │  Session 3   │   ...    │
│  │ Claude Code  │  │ Gemini CLI   │  │  Terminal    │          │
│  │ feature/auth │  │ fix/bug-123  │  │    main      │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
│  ┌──────▼─────────────────▼─────────────────▼───────┐          │
│  │              WorktreeManager                      │          │
│  │     ~/.claude-maestro/worktrees/{repo}/{branch}  │          │
│  └──────────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ MCP Protocol (stdio)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                  MaestroMCPServer (Swift)                       │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                     StatusManager                           ││
│  │  maestro_status tool - agents report their current state    ││
│  │  (idle, working, needs_input, finished, error)              ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Technology Stack

| Component | Technology |
|-----------|------------|
| Desktop App | Swift 5.9, SwiftUI, AppKit |
| Terminal Emulator | SwiftTerm |
| MCP Server | Swift MCP SDK (agent status reporting) |
| Git Operations | Native git CLI |

---

## Installation

### Requirements

- macOS 14 (Sonoma) or later
- Xcode 15 or later
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)

### Build from Source

1. **Clone the repository:**
   ```bash
   git clone https://github.com/jackwakem/claude-maestro.git
   cd claude-maestro
   ```

2. **Open in Xcode:**
   ```bash
   open claude-maestro.xcodeproj
   ```

3. **Build and run** (⌘R)

The Swift MCP server (`MaestroMCPServer/`) is built automatically as part of the Xcode build process.

### Optional: Install AI CLIs

```bash
# Claude Code (recommended)
npm install -g @anthropic-ai/claude-code

# Gemini CLI
npm install -g @anthropic-ai/gemini-cli

# OpenAI Codex
npm install -g @openai/codex
```

---

## Usage

### Quick Start

1. **Launch Claude Maestro**
2. **Select a project directory** (ideally a git repository)
3. **Configure sessions** in the sidebar:
   - Set the number of terminals (1-12)
   - Choose AI mode for each session
   - Assign branches to sessions
4. **Click "Launch"** to start all sessions
5. Each session opens in its own worktree with the AI ready to work

### Session Management

- **Add sessions:** Click the floating `+` button
- **Close sessions:** Click the `×` on the session header
- **Change mode:** Use the mode dropdown in the session header
- **Assign branch:** Select from the branch dropdown

### Git Worktree Isolation

When you assign a branch to a session:
1. Maestro creates a worktree at `~/.claude-maestro/worktrees/{repo-hash}/{branch}`
2. The session's terminal opens in that worktree
3. All file changes are isolated to that worktree
4. Worktrees are cleaned up when sessions close

### Template Presets

Save your session configurations:
1. Configure sessions as desired
2. Click "Save Preset" in the sidebar
3. Name your preset (e.g., "Feature Development", "Bug Triage")
4. Load presets from the dropdown to restore configurations

### Quick Actions

Each session can have quick action buttons:
- **Run App** - Tells the AI to run the application
- **Commit & Push** - Tells the AI to commit and push changes
- **Custom** - Configure your own prompts

---

## Configuration

### Session Persistence

Session configurations (modes, branches, count) are automatically persisted to UserDefaults and restored on app launch.

---

## Troubleshooting

### Claude Command Not Found

The Claude CLI must be installed globally and in your PATH:
```bash
npm install -g @anthropic-ai/claude-code
which claude  # Should show the path
```

### Worktree Issues

If worktrees get into a bad state:
```bash
# List all worktrees
git worktree list

# Remove a specific worktree
git worktree remove /path/to/worktree --force

# Prune stale worktree entries
git worktree prune
```

---

## Contributing

### Development Setup

1. Fork and clone the repository
2. Open `claude-maestro.xcodeproj` in Xcode
3. Make your changes
4. Test thoroughly with multiple sessions

### Project Structure

```
claude-maestro/
├── claude-maestro/              # Swift/SwiftUI macOS app
│   ├── ContentView.swift        # Main view and session management
│   ├── TerminalView.swift       # SwiftTerm integration
│   ├── WorktreeManager.swift    # Git worktree management
│   ├── GitManager.swift         # Git operations
│   ├── GitTreeView.swift        # Commit graph visualization
│   └── ...
├── MaestroMCPServer/            # Swift MCP server
│   ├── Sources/
│   │   └── MaestroMCPServer/    # MCP tool implementations
│   └── Package.swift
└── README.md
```

### Code Style

- Follow Apple's Swift API Design Guidelines

---

## License

MIT License - see [LICENSE](LICENSE) for details.

---

## Acknowledgments

- [SwiftTerm](https://github.com/migueldeicaza/SwiftTerm) - Terminal emulator for Swift
- [Model Context Protocol](https://modelcontextprotocol.io/) - MCP SDK
- [Claude Code](https://claude.ai/claude-code) - AI coding assistant

---

Built with Love by Jack
