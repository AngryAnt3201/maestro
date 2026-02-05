---
layout: default
title: Getting Started
nav_order: 3
---

# Getting Started
{: .no_toc }

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Quick Start

### 1. Launch Maestro

Open the application after [installing](/maestro/installation) it.

### 2. Select a Project

Choose a project directory — ideally a git repository. Maestro uses git worktrees to isolate each session, so a git repo is required for full functionality.

### 3. Configure Sessions

In the sidebar, set up your sessions:

- **Number of terminals** — Choose between 1 and 6 concurrent sessions
- **AI mode** — Select the AI assistant for each session (Claude Code, Gemini CLI, OpenAI Codex, or Plain Terminal)
- **Branch assignment** — Pick a branch for each session to work on

### 4. Launch

Click **"Launch"** to start all sessions. Each session opens in its own worktree with the AI ready to work.

### 5. Work in Parallel

Each session now runs independently. You can:

- Watch AI agents work on different tasks simultaneously
- Respond to input prompts as they appear
- Monitor status indicators for each session
- Use quick actions to trigger common commands

---

## Session Management

### Adding Sessions

Click the floating **+** button to add a new session to the grid. The grid layout adjusts automatically.

### Closing Sessions

Click the **x** on the session header to close it. The associated worktree is cleaned up automatically.

### Changing Mode

Use the mode dropdown in the session header to switch between AI assistants (or plain terminal) for any session.

### Assigning Branches

Select a branch from the branch dropdown in each session's configuration. When you assign a branch:

1. Maestro creates a worktree at `~/.claude-maestro/worktrees/{repo-hash}/{branch}`
2. The session's terminal opens in that worktree directory
3. All file changes are isolated to that worktree
4. The worktree is cleaned up when the session closes

---

## Git Worktree Isolation

Worktree isolation is the core of Maestro's parallel workflow. Here's how it works:

**Without Maestro:** All AI sessions share one working directory. If Session A modifies `app.tsx` while Session B is also editing it, you get conflicts and broken code.

**With Maestro:** Each session gets a separate copy of the repository (a git worktree). Session A's changes to `app.tsx` are completely invisible to Session B until you merge the branches.

### How Worktrees Work

- Each worktree is a full checkout of the repo at a specific branch
- Worktrees share the same `.git` data (history, objects) but have independent working files
- Changes in one worktree don't affect others
- When you merge a branch, the changes flow through git as normal

---

## Quick Actions

Each session can have quick action buttons that send commands to the AI:

| Action | What It Does |
|:-------|:-------------|
| **Run App** | Tells the AI to run the application |
| **Commit & Push** | Tells the AI to commit and push changes |
| **Custom** | Configure your own prompts |

Quick actions are configurable per session and can be customized in the sidebar.

---

## Status Indicators

The MCP integration gives you real-time visibility into what each AI session is doing:

| Status | Meaning |
|:-------|:--------|
| **Idle** | AI is ready and waiting for input |
| **Working** | AI is actively processing a task |
| **Needs Input** | AI is waiting for your response |
| **Finished** | AI has completed its task |
| **Error** | Something went wrong |

Status updates appear as colored indicators in the session grid, so you can see at a glance which sessions need your attention.
