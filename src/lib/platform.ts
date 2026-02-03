/**
 * Detect whether the app is running on macOS (for platform-specific UI such as native traffic lights).
 */
export function isMac(): boolean {
  return navigator.platform.toLowerCase().includes("mac");
}
