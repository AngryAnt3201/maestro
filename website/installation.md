---
layout: default
title: Installation
nav_order: 2
---

# Installation
{: .no_toc }

## Table of Contents
{: .no_toc .text-delta }

1. TOC
{:toc}

---

## Requirements

- **Node.js** 18+ and npm
- **Rust** 1.70+ (for building from source)
- **Git** (for worktree operations)

## Platform Prerequisites

### macOS (13 Ventura or later)

```bash
# Install Xcode Command Line Tools
xcode-select --install
```

### Windows (10 or later)

1. Install [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the **"Desktop development with C++"** workload
2. Install [Rust](https://rustup.rs/)
3. WebView2 Runtime is required (pre-installed on Windows 10 21H2+ and Windows 11; [download here](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) for older versions)

### Linux (Ubuntu/Debian)

```bash
sudo apt-get update
sudo apt-get install -y build-essential pkg-config libssl-dev \
  libwebkit2gtk-4.1-dev libappindicator3-dev librsvg2-dev patchelf
```

### Linux (Fedora)

```bash
sudo dnf install gcc-c++ pkg-config openssl-devel \
  webkit2gtk4.1-devel libappindicator-gtk3-devel librsvg2-devel
```

### Linux (Arch)

```bash
sudo pacman -S base-devel pkgconf openssl \
  webkit2gtk-4.1 libappindicator-gtk3 librsvg
```

---

## Build from Source

1. **Clone the repository:**

   ```bash
   git clone https://github.com/its-maestro-baby/maestro.git
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

   This builds the Rust MCP server binary that Tauri bundles with the application.

4. **Run in development mode:**

   ```bash
   npm run tauri dev
   ```

5. **Build for production:**

   ```bash
   npm run tauri build
   ```

   The built application will be in `src-tauri/target/release/bundle/`.

---

## Pre-Built Binaries

Pre-built binaries are available on the [GitHub Releases](https://github.com/its-maestro-baby/maestro/releases) page.

Download the appropriate package for your platform:

| Platform | Format |
|:---------|:-------|
| macOS | `.dmg` |
| Windows | `.msi` / `.exe` |
| Linux | `.deb` / `.AppImage` |

---

## Install AI CLIs

Maestro works with several AI coding assistants. Install the ones you want to use:

```bash
# Claude Code (recommended)
npm install -g @anthropic-ai/claude-code

# Gemini CLI
npm install -g @google/gemini-cli

# OpenAI Codex
npm install -g @openai/codex
```

{: .note }
You don't need all AI CLIs installed — Maestro will detect which ones are available and only show those as options. You can also use "Plain Terminal" mode without any AI CLI.
