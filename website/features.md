---
layout: default
title: Features
nav_order: 4
---

# Features
{: .no_toc }

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Multi-Terminal Session Grid

Maestro's session grid lets you run 1–6 AI coding assistants simultaneously in a dynamic layout.

- **Dynamic grid layout** — Automatically adjusts from 1x1 to 2x3 based on session count
- **Real-time status indicators** — See each session's state at a glance (idle, working, waiting for input, done, error)
- **Per-session mode selection** — Choose Claude Code, Gemini CLI, OpenAI Codex, or Plain Terminal for each slot
- **Independent terminals** — Each session has its own full terminal with shell environment

---

## Git Worktree Isolation

The core feature that makes parallel AI development possible.

- **Automatic worktree creation** — Worktrees are created at `~/.claude-maestro/worktrees/` when you assign a branch to a session
- **Complete branch isolation** — Each session works on its own branch in its own directory, with no file conflicts
- **Automatic cleanup** — Worktrees are pruned when sessions close
- **Visual branch assignment** — Assign branches from the sidebar with a dropdown

### How It Works

When you assign a branch to a session, Maestro:

1. Creates a git worktree for that branch in a deterministic location
2. Opens the session's terminal in the worktree directory
3. Isolates all file operations to that worktree
4. Cleans up the worktree when the session ends

This means Session 1 can refactor the auth system on `feature/auth` while Session 2 fixes a bug on `fix/bug-123` — simultaneously, with zero conflicts.

---

## MCP Server Integration

Maestro includes a built-in Model Context Protocol (MCP) server that enables real-time communication between AI agents and the Maestro UI.

- **Agent status reporting** — AI sessions report their state using the `maestro_status` tool
- **Real-time updates** — Status changes appear instantly in the session grid
- **State tracking** — Five states: idle, working, needs_input, finished, error
- **Input prompts** — When an agent needs input, the prompt is displayed in the UI

The MCP server runs as a sidecar process and communicates over stdio. It's automatically configured when sessions launch.

---

## Visual Git Graph

A GitKraken-style commit visualization built into Maestro.

- **Colored rail rendering** — Branch paths rendered with distinct colors
- **Commit detail panel** — Click a commit to see its diff
- **Branch relationship view** — See how branches relate to each other
- **Session context** — See which sessions are working on which branches

---

## Quick Actions

Configurable action buttons for common tasks.

- **Built-in actions** — "Run App", "Commit & Push" available out of the box
- **Custom prompts** — Define your own quick action buttons with custom text
- **Per-session configuration** — Different actions for different sessions
- **AI execution** — Actions are sent as prompts to the session's AI assistant

---

## Appearance Settings

Customize Maestro's look and feel.

- **Light and dark themes** — Switch between light and dark mode
- **Terminal font customization** — Choose from:
  - System-installed fonts
  - Nerd Fonts (icons and glyphs)
  - Custom fonts
- **Adjustable text size** — Scale terminal text to your preference

---

## Multi-AI Support

Maestro isn't locked to one AI assistant. Each session can use a different AI:

| AI Assistant | CLI Command | Description |
|:-------------|:------------|:------------|
| **Claude Code** | `claude` | Anthropic's Claude in the terminal |
| **Gemini CLI** | `gemini` | Google's Gemini AI |
| **OpenAI Codex** | `codex` | OpenAI's coding assistant |
| **Plain Terminal** | — | Standard shell, no AI |

Maestro detects which CLIs are installed and shows available options. You can mix and match — run Claude on one session and Gemini on another.

---

## Plugin Marketplace

Extend Maestro with community plugins.

- **Browse and install** — Discover plugins from marketplace sources
- **Plugin types** — Skills, Commands, and MCP servers
- **Per-session configuration** — Enable/disable plugins for individual sessions
- **Automatic management** — Symlink management for commands and skills handled automatically

---

## User-Configurable CLI Flags

Customize how AI CLIs are launched with per-session flags.

- **Custom arguments** — Pass additional flags to Claude Code, Gemini CLI, or Codex
- **Session presets** — Save flag configurations as reusable presets
- **Fine-grained control** — Different flags for different sessions
