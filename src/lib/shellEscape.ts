/**
 * Shell-escape file paths for safe pasting into a terminal.
 *
 * Uses POSIX single-quote wrapping: any internal single quotes are escaped
 * as `'\''` (end quote, escaped quote, reopen quote).
 */

export function shellEscapePath(path: string): string {
  return "'" + path.replace(/'/g, "'\\''") + "'";
}

export function shellEscapePaths(paths: string[]): string {
  return paths.map(shellEscapePath).join(" ");
}
