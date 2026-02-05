---
layout: default
title: Home
nav_order: 1
permalink: /
---

# Maestro
{: .fs-9 }

Orchestrate multiple AI coding assistants in parallel.
{: .fs-6 .fw-300 }

A cross-platform desktop application that lets you run 1–6 Claude Code (or other AI CLI) sessions simultaneously, each in its own isolated git worktree.

[Get Started](/maestro/getting-started){: .btn .btn-primary .fs-5 .mb-4 .mb-md-0 .mr-2 }
[Download](https://github.com/its-maestro-baby/maestro/releases){: .btn .fs-5 .mb-4 .mb-md-0 }

---

## Why Maestro?

**The Problem:** AI coding assistants work on one task at a time. While Claude works on Feature A, you wait. Then you start Feature B. Then you wait again. Context switching is expensive, and your development velocity is bottlenecked by serial execution.

**The Solution:** Run multiple AI sessions in parallel. Each session gets its own:

- **Terminal instance** with full shell environment
- **Git worktree** for complete code isolation
- **Assigned branch** for focused work
- **Port allocation** for web development

## Core Principles

| Principle | Description |
|:----------|:------------|
| **Parallel Development** | Launch 1–6 AI sessions simultaneously. Work on feature branches, bug fixes, and refactoring all at once. |
| **True Isolation** | Each session operates in its own git worktree. No merge conflicts, no stepping on each other's changes. |
| **AI-Native Workflow** | Built specifically for Claude Code, Gemini CLI, OpenAI Codex, and other AI coding assistants. |
| **Cross-Platform** | Runs on macOS, Windows, and Linux with native performance via Tauri. |

---

## Overview

Maestro provides a multi-terminal session grid where each panel runs an independent AI coding assistant. Sessions are isolated through git worktrees — each AI works on its own branch in its own copy of the codebase, so there are never merge conflicts between parallel tasks.

A built-in MCP server lets AI agents report their status (idle, working, needs input, finished, error) back to the Maestro UI in real time. You can see at a glance what each session is doing and respond to input requests.

### Supported AI Assistants

- **Claude Code** — Anthropic's Claude in the terminal
- **Gemini CLI** — Google's Gemini AI
- **OpenAI Codex** — OpenAI's coding assistant
- **Plain Terminal** — Standard shell without AI

---

## Quick Links

- [Installation](/maestro/installation) — Requirements and build instructions
- [Getting Started](/maestro/getting-started) — Launch your first parallel session
- [Features](/maestro/features) — Full feature reference
- [Architecture](/maestro/architecture) — How Maestro works under the hood
- [Configuration](/maestro/configuration) — Customize your setup
- [Troubleshooting](/maestro/troubleshooting) — Common issues and fixes
- [Contributing](/maestro/contributing) — Help improve Maestro
- [FAQ](/maestro/faq) — Frequently asked questions
