#!/bin/bash
# Maestro CLI — launch Maestro from the terminal
# Usage: maestro [path]
#
# Examples:
#   maestro              # Launch/focus Maestro
#   maestro .            # Open current directory as a project
#   maestro /path/to/dir # Open a specific project path

if [ -n "$1" ]; then
    # Resolve to absolute path
    if [ -d "$1" ]; then
        PATH_ARG="$(cd "$1" && pwd)"
    else
        PATH_ARG="$1"
    fi

    case "$(uname -s)" in
        Darwin)
            open -a Maestro --args "$PATH_ARG"
            ;;
        Linux)
            MAESTRO_BIN="${MAESTRO_BIN:-maestro-app}"
            "$MAESTRO_BIN" "$PATH_ARG" &
            disown
            ;;
        MINGW*|MSYS*|CYGWIN*)
            start "" "Maestro.exe" "$PATH_ARG"
            ;;
        *)
            echo "Unsupported platform: $(uname -s)" >&2
            exit 1
            ;;
    esac
else
    case "$(uname -s)" in
        Darwin)
            open -a Maestro
            ;;
        Linux)
            MAESTRO_BIN="${MAESTRO_BIN:-maestro-app}"
            "$MAESTRO_BIN" &
            disown
            ;;
        MINGW*|MSYS*|CYGWIN*)
            start "" "Maestro.exe"
            ;;
        *)
            echo "Unsupported platform: $(uname -s)" >&2
            exit 1
            ;;
    esac
fi
