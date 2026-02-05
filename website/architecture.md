---
layout: default
title: Architecture
nav_order: 5
---

# Architecture
{: .no_toc }

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## System Overview

Maestro is built with [Tauri 2.0](https://tauri.app/), combining a Rust backend with a React + TypeScript frontend. The architecture follows a clear separation of concerns:

- **Backend (Rust):** PTY management, git CLI orchestration, worktree lifecycle, MCP server, process management
- **Frontend (React):** Terminal rendering via xterm.js, UI components, state management
- **Communication:** Tauri Commands (IPC) for actions, Tauri Events for streams (PTY output, status updates)

```
┌─────────────────────────────────────────────────────────────────┐
│                    Claude Maestro (Tauri)                       │
│                                                                 │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Session 1   │  │  Session 2   │  │  Session 3   │   ...    │
│  │ Claude Code  │  │ Gemini CLI   │  │  Terminal    │          │
│  │ feature/auth │  │ fix/bug-123  │  │    main      │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                   │
│  ┌──────▼─────────────────▼─────────────────▼───────┐          │
│  │              ProcessManager (Rust)               │          │
│  │     ~/.claude-maestro/worktrees/{repo}/{branch}  │          │
│  └──────────────────────────────────────────────────┘          │
│                                                                 │
│  Frontend: React + TypeScript + Tailwind CSS                    │
│  Backend: Rust + Tauri                                          │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ MCP Protocol (stdio)
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                    MCP Server (Rust)                            │
│                                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │                     StatusManager                           ││
│  │  maestro_status tool - agents report their current state    ││
│  │  (idle, working, needs_input, finished, error)              ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Component | Technology |
|:----------|:-----------|
| Desktop App | Tauri 2.0, Rust |
| Frontend | React, TypeScript, Tailwind CSS |
| Terminal Emulator | xterm.js |
| MCP Server | Rust (sidecar binary) |
| Git Operations | Native git CLI via `std::process::Command` |
| State Persistence | `tauri-plugin-store` |
| Build System | Vite (frontend), Cargo (backend) |

---

## Project Structure

```
maestro/
├── src/                     # React/TypeScript frontend
│   ├── components/
│   │   ├── terminal/        # TerminalGrid, TerminalView (xterm.js)
│   │   ├── git/             # GitGraph, CommitRow, BranchList
│   │   ├── sidebar/         # SessionConfig, QuickActions, PluginBrowser
│   │   └── shared/          # StatusPill, ProjectTabs
│   ├── lib/                 # Utility libraries
│   └── App.tsx              # Main application
├── src-tauri/               # Tauri Rust backend
│   ├── src/
│   │   ├── commands/        # Tauri IPC command handlers
│   │   ├── core/            # Business logic (worktree, process, MCP)
│   │   ├── git/             # Git CLI wrappers
│   │   └── lib.rs           # Main Rust entry point
│   ├── Cargo.toml
│   └── tauri.conf.json
├── maestro-mcp-server/      # Rust MCP server (bundled sidecar)
│   ├── src/
│   │   └── main.rs
│   └── Cargo.toml
├── Cargo.toml               # Workspace configuration
├── package.json
└── README.md
```

---

## Key Components

### ProcessManager (Rust)

Manages the lifecycle of terminal sessions:
- Spawns PTY processes with `setsid` for process group isolation
- Routes stdin/stdout between the frontend and shell processes
- Handles session creation, resize, and termination
- Kills entire process groups on session close (prevents orphaned AI agents)

### WorktreeManager (Rust)

Handles git worktree operations:
- Creates worktrees using deterministic paths: `~/.claude-maestro/worktrees/{sha256(repo-path)}/{branch}`
- Detects and reuses existing worktrees for the same branch
- Prunes orphaned worktrees on app launch and session close
- Distinguishes main worktrees from session worktrees to avoid conflicts

### MCP Server (Rust sidecar)

A standalone binary bundled with the application:
- Communicates with AI agents over stdio using the Model Context Protocol
- Provides the `maestro_status` tool for agents to report their state
- Status updates are polled by the frontend every 500ms
- Agent states: `idle`, `working`, `needs_input`, `finished`, `error`

### Frontend State

The React frontend uses component-level state and Tauri event listeners:
- Terminal instances are managed via xterm.js with WebGL rendering
- Session configuration is persisted via `tauri-plugin-store`
- Git graph rendering uses HTML5 Canvas with colored rail paths
- Real-time status updates come from Tauri events

---

## Data Flow

### Session Launch

1. User configures sessions in the sidebar (mode, branch)
2. Frontend calls `create_session` Tauri command
3. Backend creates a git worktree for the assigned branch
4. Backend spawns a PTY process in the worktree directory
5. AI CLI is launched in the terminal (e.g., `claude`)
6. PTY output is streamed to the frontend via Tauri events

### Status Reporting

1. AI agent calls the `maestro_status` MCP tool
2. MCP server writes status to a JSON file
3. Backend polls the status file every 500ms
4. Status update is emitted as a Tauri event
5. Frontend updates the session's status indicator

### Worktree Lifecycle

1. Branch assigned to session → worktree created
2. Session runs → all file ops happen in the worktree
3. Session closes → worktree is removed
4. App launches → orphaned worktrees are pruned
