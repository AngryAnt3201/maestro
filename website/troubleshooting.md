---
layout: default
title: Troubleshooting
nav_order: 7
---

# Troubleshooting
{: .no_toc }

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Claude Command Not Found

The Claude CLI must be installed globally and in your PATH:

```bash
npm install -g @anthropic-ai/claude-code
which claude  # Should show the path
```

If `which claude` returns nothing, ensure your npm global bin directory is in your PATH. Common locations:

- macOS/Linux: `~/.npm-global/bin` or `/usr/local/bin`
- Windows: `%AppData%\npm`

{: .tip }
The same applies to `gemini` and `codex` — they must be globally installed and in your PATH.

---

## Worktree Issues

If worktrees get into a bad state:

```bash
# List all worktrees
git worktree list

# Remove a specific worktree
git worktree remove /path/to/worktree --force

# Prune stale worktree entries
git worktree prune
```

### Common Worktree Problems

**"Branch is already checked out"** — This means another worktree (or your main repo) already has that branch checked out. Either:
- Close the session using that branch first
- Use a different branch name
- Manually remove the stale worktree with `git worktree remove`

**Orphaned worktrees** — If Maestro crashes, worktrees may not be cleaned up. Run `git worktree prune` in your repository to remove stale references, then delete the leftover directories from `~/.claude-maestro/worktrees/`.

---

## Build Issues

If you encounter build issues:

```bash
# Clear all Rust build caches
rm -rf src-tauri/target
rm -rf maestro-mcp-server/target

# Clear node modules and reinstall
rm -rf node_modules
npm install

# Rebuild MCP server first, then Tauri app
cargo build --release -p maestro-mcp-server
npm run tauri build
```

---

## macOS: Full Disk Access (FDA)

On macOS, Maestro may need Full Disk Access to work with projects in certain protected directories (Desktop, Documents, Downloads).

**Symptoms:**
- Terminal sessions can't access project files
- Permission denied errors when opening projects in protected locations

**Fix:**
1. Open **System Settings > Privacy & Security > Full Disk Access**
2. Add Maestro to the allowed applications
3. Restart Maestro

{: .note }
Maestro will prompt you to grant FDA when it detects it's needed. You can also proactively enable it.

---

## Windows: UNC Path Issues

On Windows, terminal sessions may show a UNC path prefix (`\\?\`) in the working directory.

**Symptoms:**
- Terminal prompt shows `\\?\C:\Users\...` instead of `C:\Users\...`
- Some CLI tools don't handle UNC paths correctly

**Fix:** This is handled automatically in recent versions of Maestro. If you still see this issue, update to the latest release.

---

## MCP Connection Issues

If AI agents aren't reporting their status to Maestro:

1. **Check the MCP server binary exists:**
   ```bash
   ls src-tauri/target/release/maestro-mcp-server
   ```
   If missing, rebuild: `cargo build --release -p maestro-mcp-server`

2. **Check the MCP configuration:**
   Ensure `.mcp.json` points to the correct binary path.

3. **Check agent logs:**
   Look for MCP-related errors in the AI agent's output.

---

## Terminal Not Rendering

If terminals appear blank or don't render properly:

- **Try resizing the window** — This can trigger a re-render
- **Check WebView2** (Windows) — Ensure WebView2 Runtime is installed
- **Check webkit2gtk** (Linux) — Ensure `libwebkit2gtk-4.1-dev` is installed
- **GPU acceleration** — Try disabling GPU acceleration if you see rendering artifacts

---

## Session Won't Start

If clicking "Launch" doesn't start sessions:

1. Verify the selected project directory exists and is a git repository
2. Check that the AI CLI is installed (`which claude`, `which gemini`, `which codex`)
3. Look for errors in the terminal output area
4. Try with "Plain Terminal" mode to isolate whether the issue is with the AI CLI or Maestro itself
