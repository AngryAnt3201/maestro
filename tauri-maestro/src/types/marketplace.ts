/**
 * TypeScript types for the marketplace feature.
 * These match the Rust models in marketplace_models.rs.
 */

/** Installation scope for plugins. */
export type InstallScope = "user" | "project" | "local";

/** Type of functionality a plugin provides. */
export type PluginType = "skill" | "command" | "mcp" | "agent" | "hook";

/** Category of a plugin for filtering in the UI. */
export type PluginCategory =
  | "development"
  | "productivity"
  | "integration"
  | "ai"
  | "data"
  | "security"
  | "documentation"
  | "utility"
  | "other";

/** A marketplace source - a GitHub repository hosting a plugin catalog. */
export interface MarketplaceSource {
  /** Unique identifier (UUID). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** GitHub repository URL. */
  repository_url: string;
  /** Whether this is an official Anthropic marketplace. */
  is_official: boolean;
  /** Whether this source is enabled for plugin browsing. */
  is_enabled: boolean;
  /** ISO8601 timestamp of last successful fetch. */
  last_fetched: string | null;
  /** Error message from last fetch attempt (if any). */
  last_error: string | null;
}

/** A plugin available for download from a marketplace. */
export interface MarketplacePlugin {
  /** Unique identifier within the marketplace. */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Short description of what the plugin does. */
  description: string;
  /** Version string (semver). */
  version: string;
  /** Author name or organization. */
  author: string;
  /** Category for filtering. */
  category: PluginCategory;
  /** Types of functionality this plugin provides. */
  types: PluginType[];
  /** Direct download URL (if different from cloning the repo). */
  download_url: string | null;
  /** Repository URL for cloning. */
  repository_url: string | null;
  /** Tags for additional filtering/search. */
  tags: string[];
  /** ID of the marketplace source this came from. */
  marketplace_id: string;
  /** Optional icon URL. */
  icon_url: string | null;
  /** Optional homepage URL. */
  homepage_url: string | null;
  /** Minimum Claude Code version required. */
  min_version: string | null;
  /** License identifier. */
  license: string | null;
  /** Number of downloads (if tracked by marketplace). */
  downloads: number | null;
  /** Star/rating count (if tracked by marketplace). */
  stars: number | null;
}

/** Source of an installed plugin - marketplace variant. */
export interface MarketplaceInstalledSource {
  source: "marketplace";
  /** ID of the marketplace source. */
  marketplace_id: string;
  /** Original plugin ID in the marketplace. */
  plugin_id: string;
}

/** Source of an installed plugin - git variant. */
export interface GitInstalledSource {
  source: "git";
  /** Repository URL. */
  repository_url: string;
}

/** Source of an installed plugin - local variant. */
export interface LocalInstalledSource {
  source: "local";
  /** Original source path. */
  source_path: string;
}

/** Union of all installed plugin sources. */
export type InstalledPluginSource =
  | MarketplaceInstalledSource
  | GitInstalledSource
  | LocalInstalledSource;

/** A plugin that has been installed locally. */
export interface InstalledPlugin {
  /** Unique identifier (UUID). */
  id: string;
  /** Human-readable name. */
  name: string;
  /** Installed version string. */
  version: string;
  /** Source of the installation. */
  source: InstalledPluginSource["source"];
  /** Additional source details based on source type. */
  marketplace_id?: string;
  plugin_id?: string;
  repository_url?: string;
  source_path?: string;
  /** Installation scope (user, project, local). */
  install_scope: InstallScope;
  /** Path to the installed plugin directory. */
  path: string;
  /** ISO8601 timestamp of installation. */
  installed_at: string;
  /** ISO8601 timestamp of last update (if any). */
  updated_at: string | null;
  /** IDs of skills provided by this plugin. */
  skills: string[];
  /** Names of commands provided by this plugin. */
  commands: string[];
  /** Names of MCP servers provided by this plugin. */
  mcp_servers: string[];
  /** Names of agents provided by this plugin. */
  agents: string[];
  /** Names of hooks provided by this plugin. */
  hooks: string[];
  /** Whether the plugin is enabled. */
  is_enabled: boolean;
}

/** Session-specific marketplace plugin configuration. */
export interface SessionMarketplaceConfig {
  /** IDs of enabled installed plugins. */
  enabled_plugins: string[];
  /** IDs of explicitly disabled plugins (overrides defaults). */
  disabled_plugins: string[];
}

/** Filter options for browsing plugins. */
export interface MarketplaceFilters {
  /** Filter by category. */
  category: PluginCategory | null;
  /** Filter by plugin type. */
  type: PluginType | null;
  /** Filter by tags. */
  tags: string[];
  /** Filter to only show installed plugins. */
  showInstalled: boolean;
  /** Filter to only show not-installed plugins. */
  showNotInstalled: boolean;
}

/** View mode for the marketplace browser. */
export type ViewMode = "grid" | "list";

/** Sort options for plugin listing. */
export type SortOption =
  | "name"
  | "downloads"
  | "stars"
  | "updated"
  | "relevance";
