import { invoke } from "@tauri-apps/api/core";
import { type CliAiMode } from "./terminal";

export type Platform = "macos" | "linux" | "windows";

export type InstallSource = "homebrew" | "npm" | "apt" | "choco" | "scoop" | "unknown";

export interface VersionInfo {
  current: string;
  latest: string;
  source: InstallSource;
}

/**
 * Detects the current operating system.
 */
export function getPlatform(): Platform {
  const p = navigator.platform.toLowerCase();
  if (p.includes("mac")) return "macos";
  if (p.includes("win")) return "windows";
  return "linux";
}

/**
 * Gets the package name for the given CLI mode.
 */
function getPackageName(mode: CliAiMode): string {
  switch (mode) {
    case "Claude":
      return "@anthropic-ai/claude-code";
    case "Gemini":
      return "@google/gemini-cli";
    case "Codex":
      return "codex";
    default:
      return "";
  }
}

/**
 * Gets the binary/brew name for the given CLI mode.
 */
function getBinaryName(mode: CliAiMode): string {
  switch (mode) {
    case "Claude":
      return "claude";
    case "Gemini":
      return "gemini-cli";
    case "Codex":
      return "codex";
    default:
      return "";
  }
}

function getHomebrewFormulaName(mode: CliAiMode): string {
  switch (mode) {
    case "Claude":
      return "claude-code";
    case "Gemini":
      return "gemini-cli";
    case "Codex":
      return "codex";
    default:
      return "";
  }
}

function getDetectCommand(mode: CliAiMode): string {
  switch (mode) {
    case "Gemini":
      return "gemini";
    case "Claude":
      return "claude";
    case "Codex":
      return "codex";
    default:
      return "";
  }
}

async function getCliCommandPath(mode: CliAiMode): Promise<string> {
  const command = getDetectCommand(mode);
  try {
    const path = await invoke<string | null>("get_cli_path", { command });
    return path || command;
  } catch {
    return command;
  }
}

/**
 * Gets the absolute path to a package manager if needed.
 */
async function getPackageManagerPath(source: InstallSource, platform: Platform): Promise<string> {
  if (platform === "macos" && source === "homebrew") {
    // Check standard Homebrew locations
    const intelPath = "/usr/local/bin/brew";
    const armPath = "/opt/homebrew/bin/brew";
    
    const hasArm = await invoke<boolean>("check_cli_available", { command: armPath });
    if (hasArm) return armPath;
    
    const hasIntel = await invoke<boolean>("check_cli_available", { command: intelPath });
    if (hasIntel) return intelPath;

    return "brew";
  }
  
  if (source === "npm") {
    // For npm, we might need to find where it's installed
    const npmPath = await invoke<string | null>("get_cli_path", { command: "npm" });
    return npmPath || "npm";
  }

  if (source === "choco") return "choco";
  if (source === "scoop") return "scoop";
  if (source === "apt") return "apt-get";
  return "npm";
}

/**
 * Returns the recommended update command based on platform and source.
 */
export async function getUpdateCommand(
  mode: CliAiMode,
  platform: Platform,
  source: InstallSource
): Promise<string> {
  const pkg = getPackageName(mode);
  const bin = getBinaryName(mode);
  const brewFormula = getHomebrewFormulaName(mode);
  const pmPath = await getPackageManagerPath(source, platform);

  // Claude Code migrated from npm to native installer.
  // Use native self-installer regardless of package manager detection.
  if (mode === "Claude") {
    const claudePath = await getCliCommandPath(mode);
    return `${claudePath} install latest`;
  }

  if (source === "homebrew") {
    // On macOS, CLIs may be installed as formula, cask, or npm under a Homebrew prefix.
    // Try formula/cask first, then fall back to npm to keep auto-launch flow reliable.
    if (platform === "macos") {
      const npmPath = await getPackageManagerPath("npm", platform);
      return `${pmPath} upgrade --formula ${brewFormula} || ${pmPath} upgrade --cask ${brewFormula} || ${npmPath} install -g ${pkg}`;
    }
    return `${pmPath} upgrade ${brewFormula}`;
  }

  if (source === "npm") {
    return `${pmPath} install -g ${pkg}`;
  }

  if (source === "apt") {
    return `sudo ${pmPath} update && sudo ${pmPath} install -y ${bin}`;
  }

  if (source === "choco") {
    return `${pmPath} upgrade ${bin} -y`;
  }

  if (source === "scoop") {
    return `${pmPath} update ${bin}`;
  }

  // Platform defaults if source is unknown
  if (platform === "macos") {
    const brewPath = await getPackageManagerPath("homebrew", "macos");
    return `${brewPath} upgrade ${brewFormula}`;
  }

  if (platform === "windows") {
    return `npm install -g ${pkg}`;
  }

  return `npm install -g ${pkg}`;
}

/**
 * Detects where the CLI was installed from.
 * In a real implementation, this would call a Rust command that checks `which`.
 */
export async function detectInstallSource(command: string): Promise<InstallSource> {
  try {
    const path = await invoke<string>("get_cli_path", { command });
    if (!path) return "unknown";

    if (path.includes("homebrew") || path.includes("Cellar")) return "homebrew";
    if (path.includes("node") || path.includes(".npm") || path.includes("nvm")) return "npm";
    if (path.includes("Chocolatey")) return "choco";
    if (path.includes("scoop")) return "scoop";
    
    return "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Best-effort package-manager fallback for when install source cannot be inferred.
 */
async function detectPreferredSource(platform: Platform, mode: CliAiMode): Promise<InstallSource> {
  const has = async (command: string): Promise<boolean> => {
    try {
      const path = await invoke<string | null>("get_cli_path", { command });
      return Boolean(path);
    } catch {
      return false;
    }
  };

  if (platform === "macos") {
    // Claude is most commonly installed via npm on macOS.
    if (mode === "Claude") {
      if (await has("npm")) return "npm";
      if (await has("brew")) return "homebrew";
      return "unknown";
    }
    if (await has("brew")) return "homebrew";
    if (await has("npm")) return "npm";
    return "unknown";
  }

  if (platform === "windows") {
    if (await has("scoop")) return "scoop";
    if (await has("choco")) return "choco";
    if (await has("npm")) return "npm";
    return "unknown";
  }

  if (await has("npm")) return "npm";
  if (await has("apt-get")) return "apt";
  return "unknown";
}

/**
 * Resolves the install source for a CLI mode.
 */
export async function resolveInstallSource(mode: CliAiMode): Promise<InstallSource> {
  const platform = getPlatform();
  const detected = await detectInstallSource(getDetectCommand(mode));
  if (detected !== "unknown") {
    return detected;
  }
  return detectPreferredSource(platform, mode);
}

/**
 * Legacy compatibility shim for older banner code.
 * Returns null because version-check banners are intentionally removed from launch flow.
 */
export async function checkForUpdates(_mode: CliAiMode): Promise<VersionInfo | null> {
  return null;
}
