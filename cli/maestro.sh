#!/bin/bash
# Maestro CLI — launch Maestro from the terminal
# Usage: maestro [path]
#
# Examples:
#   maestro              # Launch/focus Maestro
#   maestro .            # Open current directory as a project
#   maestro /path/to/dir # Open a specific project path

resolve_path() {
    if [ -d "$1" ]; then
        (cd "$1" && pwd)
    else
        echo "$1"
    fi
}

launch_macos() {
    # Try bundle identifier first (most reliable)
    if open -b com.maestro.app "$@" 2>/dev/null; then
        return 0
    fi
    # Fall back to app name
    if open -a Maestro "$@" 2>/dev/null; then
        return 0
    fi
    echo "Error: Maestro.app not found. Is it installed?" >&2
    return 1
}

case "$(uname -s)" in
    Darwin)
        if [ -n "$1" ]; then
            PATH_ARG="$(resolve_path "$1")"
            launch_macos --args "$PATH_ARG"
        else
            launch_macos
        fi
        ;;
    Linux)
        MAESTRO_BIN="${MAESTRO_BIN:-maestro-app}"
        if [ -n "$1" ]; then
            PATH_ARG="$(resolve_path "$1")"
            "$MAESTRO_BIN" "$PATH_ARG" &
        else
            "$MAESTRO_BIN" &
        fi
        disown
        ;;
    MINGW*|MSYS*|CYGWIN*)
        if [ -n "$1" ]; then
            PATH_ARG="$(resolve_path "$1")"
            start "" "Maestro.exe" "$PATH_ARG"
        else
            start "" "Maestro.exe"
        fi
        ;;
    *)
        echo "Unsupported platform: $(uname -s)" >&2
        exit 1
        ;;
esac
