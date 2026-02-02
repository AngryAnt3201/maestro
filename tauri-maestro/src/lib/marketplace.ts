/**
 * Thin wrappers around Tauri `invoke` for marketplace operations.
 *
 * Each function maps 1:1 to a Rust `#[tauri::command]` handler.
 */

import { invoke } from "@tauri-apps/api/core";
import type {
  InstallScope,
  InstalledPlugin,
  MarketplacePlugin,
  MarketplaceSource,
  SessionMarketplaceConfig,
} from "@/types/marketplace";

// ========== Data Loading ==========

/**
 * Loads persisted marketplace data from the store.
 */
export async function loadMarketplaceData(): Promise<void> {
  return invoke("load_marketplace_data");
}

// ========== Source Management ==========

/**
 * Gets all marketplace sources.
 */
export async function getMarketplaceSources(): Promise<MarketplaceSource[]> {
  return invoke<MarketplaceSource[]>("get_marketplace_sources");
}

/**
 * Adds a new marketplace source.
 */
export async function addMarketplaceSource(
  name: string,
  repositoryUrl: string,
  isOfficial: boolean
): Promise<MarketplaceSource> {
  return invoke<MarketplaceSource>("add_marketplace_source", {
    name,
    repositoryUrl,
    isOfficial,
  });
}

/**
 * Removes a marketplace source by ID.
 */
export async function removeMarketplaceSource(sourceId: string): Promise<void> {
  return invoke("remove_marketplace_source", { sourceId });
}

/**
 * Toggles a marketplace source's enabled state.
 * Returns the new enabled state.
 */
export async function toggleMarketplaceSource(sourceId: string): Promise<boolean> {
  return invoke<boolean>("toggle_marketplace_source", { sourceId });
}

// ========== Marketplace Fetching ==========

/**
 * Refreshes a single marketplace source.
 * Returns the available plugins from that source.
 */
export async function refreshMarketplace(sourceId: string): Promise<MarketplacePlugin[]> {
  return invoke<MarketplacePlugin[]>("refresh_marketplace", { sourceId });
}

/**
 * Refreshes all enabled marketplace sources.
 */
export async function refreshAllMarketplaces(): Promise<void> {
  return invoke("refresh_all_marketplaces");
}

/**
 * Gets all available plugins from enabled marketplaces.
 */
export async function getAvailablePlugins(): Promise<MarketplacePlugin[]> {
  return invoke<MarketplacePlugin[]>("get_available_plugins");
}

// ========== Plugin Installation ==========

/**
 * Gets all installed plugins.
 */
export async function getInstalledPlugins(): Promise<InstalledPlugin[]> {
  return invoke<InstalledPlugin[]>("get_installed_plugins");
}

/**
 * Installs a plugin from a marketplace.
 */
export async function installMarketplacePlugin(
  marketplacePluginId: string,
  scope: InstallScope,
  projectPath?: string
): Promise<InstalledPlugin> {
  return invoke<InstalledPlugin>("install_marketplace_plugin", {
    marketplacePluginId,
    scope,
    projectPath,
  });
}

/**
 * Uninstalls a plugin by its installed ID.
 */
export async function uninstallPlugin(installedPluginId: string): Promise<void> {
  return invoke("uninstall_plugin", { installedPluginId });
}

/**
 * Checks if a marketplace plugin is installed.
 */
export async function isMarketplacePluginInstalled(
  marketplacePluginId: string
): Promise<boolean> {
  return invoke<boolean>("is_marketplace_plugin_installed", { marketplacePluginId });
}

// ========== Session Configuration ==========

/**
 * Gets the marketplace configuration for a session.
 */
export async function getSessionMarketplaceConfig(
  projectPath: string,
  sessionId: number
): Promise<SessionMarketplaceConfig> {
  return invoke<SessionMarketplaceConfig>("get_session_marketplace_config", {
    projectPath,
    sessionId,
  });
}

/**
 * Sets whether a plugin is enabled for a session.
 */
export async function setMarketplacePluginEnabled(
  projectPath: string,
  sessionId: number,
  installedPluginId: string,
  enabled: boolean
): Promise<void> {
  return invoke("set_marketplace_plugin_enabled", {
    projectPath,
    sessionId,
    installedPluginId,
    enabled,
  });
}

/**
 * Clears session marketplace configuration.
 */
export async function clearSessionMarketplaceConfig(
  projectPath: string,
  sessionId: number
): Promise<void> {
  return invoke("clear_session_marketplace_config", { projectPath, sessionId });
}
