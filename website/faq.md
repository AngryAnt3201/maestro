---
layout: default
title: FAQ
nav_order: 9
---

# Frequently Asked Questions
{: .no_toc }

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## General

### What is Maestro?

Maestro is a cross-platform desktop application that lets you run multiple AI coding assistants in parallel. Each session gets its own terminal, git worktree, and branch — so multiple AI agents can work on different tasks simultaneously without conflicts.

### Is Maestro free?

Yes. Maestro is open source under the MIT license. You can use it for free, modify it, and distribute it.

### What platforms does Maestro support?

Maestro runs on:
- **macOS** 13 (Ventura) or later
- **Windows** 10 or later
- **Linux** (Ubuntu, Debian, Fedora, Arch, and other distributions)

---

## AI Assistants

### Which AI assistants does Maestro support?

Maestro currently supports:
- **Claude Code** by Anthropic
- **Gemini CLI** by Google
- **OpenAI Codex** by OpenAI
- **Plain Terminal** (no AI, just a standard shell)

### Do I need API keys?

Maestro itself doesn't require API keys. However, the AI CLIs you use (Claude Code, Gemini CLI, Codex) have their own authentication requirements. Refer to each CLI's documentation for setup instructions.

### Can I use different AI assistants in different sessions?

Yes! Each session can use a different AI assistant. For example, you could run Claude Code in Session 1, Gemini CLI in Session 2, and a plain terminal in Session 3 — all at the same time.

### What if an AI CLI isn't installed?

Maestro detects which AI CLIs are available on your system. If a CLI isn't installed, its option won't appear in the mode selector. You can always use "Plain Terminal" mode without any AI CLI installed.

---

## Worktrees & Git

### What is a git worktree?

A git worktree is a feature of git that lets you check out multiple branches simultaneously in separate directories. All worktrees share the same git history and objects, but each has its own working files. This is what allows Maestro sessions to work on different branches without conflicts.

### Do I need a git repository?

Git worktree isolation requires a git repository. If you open a non-git directory, sessions will still work but will share the same directory — which means file conflicts are possible.

### Where are worktrees stored?

Worktrees are created at `~/.claude-maestro/worktrees/{repo-hash}/{branch-name}`. The repo hash is a SHA-256 hash of the repository path, ensuring unique storage per project.

### Are worktrees cleaned up automatically?

Yes. Worktrees are removed when their associated session closes. Additionally, Maestro prunes orphaned worktrees on app launch in case a previous session wasn't cleanly closed.

### Can two sessions work on the same branch?

Maestro will reuse an existing worktree if one already exists for the requested branch. This means two sessions can share a worktree, but you should be careful about file conflicts in that case. For true isolation, assign different branches to different sessions.

---

## Performance & Resources

### How many sessions can I run simultaneously?

Maestro supports 1–6 concurrent sessions. The practical limit depends on your system resources (RAM, CPU) and the AI CLIs' own requirements.

### Does Maestro use a lot of memory?

Maestro itself is lightweight thanks to Tauri's efficient architecture. Most resource usage comes from the AI CLI processes running in each session. As a rough guide, each Claude Code session uses 100–200MB of RAM.

### Does Maestro work offline?

Maestro itself works offline. However, AI coding assistants typically require internet access to communicate with their respective APIs.

---

## Troubleshooting

### Where can I get help?

- [Troubleshooting guide](/maestro/troubleshooting) — Common issues and fixes
- [GitHub Issues](https://github.com/its-maestro-baby/maestro/issues) — Report bugs or request features
- [Discord](https://discord.gg/3tQyFUYPVP) — Community support and discussion

### Maestro crashes on launch — what should I do?

1. Ensure all [platform prerequisites](/maestro/installation#platform-prerequisites) are installed
2. Try rebuilding from source with a clean build
3. Check the [Troubleshooting page](/maestro/troubleshooting) for platform-specific issues
4. If the issue persists, [open a GitHub issue](https://github.com/its-maestro-baby/maestro/issues) with your platform details and error logs
