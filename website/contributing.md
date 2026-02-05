---
layout: default
title: Contributing
nav_order: 8
---

# Contributing
{: .no_toc }

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Development Setup

1. **Fork and clone** the repository:

   ```bash
   git clone https://github.com/YOUR-USERNAME/maestro.git
   cd maestro
   ```

2. **Install npm dependencies:**

   ```bash
   npm install
   ```

3. **Build the MCP server:**

   ```bash
   cargo build --release -p maestro-mcp-server
   ```

4. **Run in development mode:**

   ```bash
   npm run tauri dev
   ```

5. **Make your changes** and test thoroughly with multiple sessions.

---

## Project Structure

```
maestro/
├── src/                     # React/TypeScript frontend
│   ├── components/
│   │   ├── terminal/        # Terminal grid and views (xterm.js)
│   │   ├── git/             # Git graph visualization
│   │   ├── sidebar/         # Session config, plugins, settings
│   │   └── shared/          # Reusable UI components
│   ├── lib/                 # Utility libraries
│   └── App.tsx              # Main application entry
├── src-tauri/               # Tauri Rust backend
│   ├── src/
│   │   ├── commands/        # Tauri IPC command handlers
│   │   ├── core/            # Core business logic
│   │   │   ├── worktree_manager.rs
│   │   │   └── ...
│   │   ├── git/             # Git CLI wrappers
│   │   └── lib.rs           # Rust entry point
│   ├── Cargo.toml
│   └── tauri.conf.json
├── maestro-mcp-server/      # MCP server (bundled sidecar)
├── website/                 # Documentation site (Jekyll)
├── Cargo.toml               # Workspace config
└── package.json
```

---

## Key Areas

### Frontend (TypeScript/React)

- **Terminal components** (`src/components/terminal/`) — xterm.js integration, grid layout, session headers
- **Git visualization** (`src/components/git/`) — Canvas-based commit graph
- **Sidebar** (`src/components/sidebar/`) — Session configuration, quick actions, plugin management

### Backend (Rust)

- **Commands** (`src-tauri/src/commands/`) — Tauri IPC handlers that bridge frontend and backend
- **Core logic** (`src-tauri/src/core/`) — Worktree management, process management, MCP monitoring
- **Git operations** (`src-tauri/src/git/`) — Git CLI wrapper functions

### MCP Server

- **Entry point** (`maestro-mcp-server/src/main.rs`) — Standalone Rust binary providing the `maestro_status` tool

---

## Running Tests

```bash
# Run all Rust tests
cargo test

# Run specific test modules
cargo test -- git::ops::tests
cargo test -- commands::worktree::tests
cargo test -- core::worktree_manager::tests
```

{: .note }
Some tests in `marketplace_manager` and `plugin_manager` may have pre-existing failures unrelated to your changes. Focus on tests relevant to the code you modified.

---

## Code Style

### Rust

- Follow standard Rust conventions (`cargo fmt`, `cargo clippy`)
- Use `thiserror` for error types
- Prefer `std::process::Command` for git operations (not libgit2)
- Extract testable logic from Tauri command handlers into separate functions

### TypeScript

- The project uses ESLint with auto-fix on save
- Unused imports are automatically removed by the linter
- Use TypeScript types for all function signatures
- Follow React functional component patterns with hooks

---

## Pull Request Process

1. **Create a feature branch** from `main`:
   ```bash
   git checkout -b feature/my-feature
   ```

2. **Make your changes** with clear, focused commits

3. **Test thoroughly:**
   - Run the app with `npm run tauri dev`
   - Test with multiple sessions (2+ concurrent)
   - Verify worktree creation and cleanup
   - Check that the MCP status reporting works

4. **Submit a PR** against `main` with:
   - Clear description of what changed and why
   - Screenshots for UI changes
   - Test steps for reviewers

---

## Reporting Issues

Found a bug or have a feature request? [Open an issue on GitHub](https://github.com/its-maestro-baby/maestro/issues).

Include:
- Your platform (macOS, Windows, Linux) and version
- Steps to reproduce
- Expected vs. actual behavior
- Relevant error messages or screenshots
