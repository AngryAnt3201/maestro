/**
 * macOS Full Disk Access permission handling.
 *
 * On macOS, TCC (Transparency, Consent, and Control) protects certain
 * locations like ~/Desktop, ~/Documents, ~/Downloads. Apps need FDA
 * to access these. External drives and network mounts do NOT need FDA.
 */

// Dynamic import for macOS-only permissions plugin
let macPermissions: {
  checkFullDiskAccessPermission: () => Promise<boolean>;
  requestFullDiskAccessPermission: () => Promise<unknown>;
} | null = null;

let initialized = false;
let initPromise: Promise<void> | null = null;

/**
 * Initialize the permissions module.
 * On macOS, this dynamically imports the permissions plugin.
 * On other platforms, this is a no-op.
 *
 * Returns a promise that resolves when initialization is complete.
 * Safe to call multiple times - subsequent calls return the same promise.
 */
export function initPermissions(): Promise<void> {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    if (initialized) return;
    initialized = true;

    // Try to load the macOS permissions plugin
    // If it fails (wrong platform or plugin not available), that's fine
    try {
      const mod = await import("tauri-plugin-macos-permissions-api");
      macPermissions = {
        checkFullDiskAccessPermission: mod.checkFullDiskAccessPermission,
        requestFullDiskAccessPermission: mod.requestFullDiskAccessPermission,
      };
    } catch {
      // Not on macOS or plugin not available - that's expected
      macPermissions = null;
    }
  })();

  return initPromise;
}

/**
 * Check if the app has Full Disk Access permission.
 * Returns true on non-macOS platforms or if plugin unavailable.
 */
export async function checkFullDiskAccess(): Promise<boolean> {
  // Ensure initialization is complete before checking
  await initPermissions();

  if (!macPermissions) return true;
  try {
    return await macPermissions.checkFullDiskAccessPermission();
  } catch {
    // On error, assume access to avoid blocking the user
    return true;
  }
}

/**
 * Request Full Disk Access permission.
 * Opens System Settings > Privacy & Security > Full Disk Access on macOS.
 * No-op on other platforms.
 */
export async function requestFullDiskAccess(): Promise<void> {
  await initPermissions();

  if (!macPermissions) return;
  try {
    await macPermissions.requestFullDiskAccessPermission();
  } catch {
    // Silently fail - user can manually open System Settings
  }
}

/**
 * Check if a path requires Full Disk Access on macOS.
 *
 * TCC-protected locations:
 * - ~/Desktop, ~/Documents, ~/Downloads (and subdirectories)
 * - Other locations in the user's home directory may also be protected
 *
 * NOT protected (no FDA needed):
 * - External drives (/Volumes/*)
 * - Network mounts (/Volumes/*)
 * - System directories (/Applications, /usr, etc.)
 */
export function pathRequiresFDA(path: string): boolean {
  // External drives and network mounts are at /Volumes/*
  // These do NOT require FDA - they have their own permission model
  if (path.startsWith("/Volumes/")) {
    return false;
  }

  // TCC protects specific folders in the user's home directory
  // The home directory is /Users/<username>/
  const userHomeMatch = path.match(/^\/Users\/[^/]+\//);
  if (!userHomeMatch) {
    // Not in a user's home directory - no FDA needed
    return false;
  }

  // Check for TCC-protected subdirectories
  const homeDir = userHomeMatch[0]; // e.g., "/Users/john/"
  const tccProtectedDirs = [
    `${homeDir}Desktop`,
    `${homeDir}Documents`,
    `${homeDir}Downloads`,
    `${homeDir}Library/Mobile Documents`, // iCloud Drive
  ];

  // Check if path is in or under any protected directory
  return tccProtectedDirs.some((dir) => path === dir || path.startsWith(`${dir}/`));
}

/**
 * Check if we have access to a given path.
 * For TCC-protected paths on macOS, checks FDA status.
 * For external drives and network mounts, always returns true.
 */
export async function ensurePathAccess(path: string): Promise<{
  hasAccess: boolean;
  needsFDA: boolean;
}> {
  const needsFDA = pathRequiresFDA(path);

  if (!needsFDA) {
    return { hasAccess: true, needsFDA: false };
  }

  const hasAccess = await checkFullDiskAccess();
  return { hasAccess, needsFDA: true };
}
