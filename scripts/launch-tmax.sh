#!/usr/bin/env bash
set -euo pipefail

# Resolve the app root directory relative to this script's location.
APP_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP_BIN="$APP_ROOT/target/release/tmax"
LOG_FILE="/tmp/tmax-launch.log"
cd "$APP_ROOT"

# Work around WebKitGTK + NVIDIA GPU compositing performance issues.
# DMABuf renderer causes rendering glitches on multi-GPU NVIDIA systems.
# Compositing mode causes severe input lag due to slow GPU layer composition.
export WEBKIT_DISABLE_DMABUF_RENDERER="${WEBKIT_DISABLE_DMABUF_RENDERER:-1}"
export WEBKIT_DISABLE_COMPOSITING_MODE="${WEBKIT_DISABLE_COMPOSITING_MODE:-1}"

{
  echo "[$(date -Is)] launching tmax from ${APP_BIN}"
} >>"$LOG_FILE"

exec "$APP_BIN" >>"$LOG_FILE" 2>&1
