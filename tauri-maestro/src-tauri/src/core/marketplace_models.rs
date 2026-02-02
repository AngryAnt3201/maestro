//! Data models for the marketplace feature.
//!
//! These models represent:
//! - Marketplace sources (GitHub repos hosting plugin catalogs)
//! - Available plugins (from marketplace catalogs)
//! - Installed plugins (downloaded and configured locally)
//! - Session-specific plugin configuration

use serde::{Deserialize, Serialize};

/// Installation scope for plugins.
///
/// Determines where the plugin is installed and who has access to it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum InstallScope {
    /// Installed to ~/.claude/plugins/ - available to all projects for this user.
    User,
    /// Installed to <project>/.claude/plugins/ - available to this project only.
    Project,
    /// Installed to <project>/.claude.local/plugins/ - local to this machine/project.
    Local,
}

impl Default for InstallScope {
    fn default() -> Self {
        Self::User
    }
}

/// Type of functionality a plugin provides.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PluginType {
    /// Skill (slash command) provider.
    Skill,
    /// Command provider.
    Command,
    /// MCP server integration.
    Mcp,
    /// Agent definition.
    Agent,
    /// Hook implementation.
    Hook,
}

/// Category of a plugin for filtering in the UI.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum PluginCategory {
    /// Development tools (linting, testing, building).
    Development,
    /// Productivity tools (notes, todos, workflows).
    Productivity,
    /// Integration with external services.
    Integration,
    /// AI/LLM assistants and agents.
    Ai,
    /// Data processing and analysis.
    Data,
    /// Security and compliance tools.
    Security,
    /// Documentation generation and management.
    Documentation,
    /// Utilities and miscellaneous.
    Utility,
    /// Uncategorized plugins.
    Other,
}

impl Default for PluginCategory {
    fn default() -> Self {
        Self::Other
    }
}

/// A marketplace source - a GitHub repository hosting a plugin catalog.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplaceSource {
    /// Unique identifier (UUID).
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// GitHub repository URL (e.g., "https://github.com/owner/repo").
    pub repository_url: String,
    /// Whether this is an official Anthropic marketplace.
    pub is_official: bool,
    /// Whether this source is enabled for plugin browsing.
    pub is_enabled: bool,
    /// ISO8601 timestamp of last successful fetch.
    pub last_fetched: Option<String>,
    /// Error message from last fetch attempt (if any).
    pub last_error: Option<String>,
}

/// A plugin available for download from a marketplace.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MarketplacePlugin {
    /// Unique identifier within the marketplace (e.g., "owner/plugin-name").
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Short description of what the plugin does.
    pub description: String,
    /// Version string (semver).
    pub version: String,
    /// Author name or organization.
    pub author: String,
    /// Category for filtering.
    pub category: PluginCategory,
    /// Types of functionality this plugin provides.
    pub types: Vec<PluginType>,
    /// Direct download URL (if different from cloning the repo).
    pub download_url: Option<String>,
    /// Repository URL for cloning.
    pub repository_url: Option<String>,
    /// Tags for additional filtering/search.
    pub tags: Vec<String>,
    /// ID of the marketplace source this came from.
    pub marketplace_id: String,
    /// Optional icon URL.
    pub icon_url: Option<String>,
    /// Optional homepage URL.
    pub homepage_url: Option<String>,
    /// Minimum Claude Code version required.
    pub min_version: Option<String>,
    /// License identifier (e.g., "MIT", "Apache-2.0").
    pub license: Option<String>,
    /// Number of downloads (if tracked by marketplace).
    pub downloads: Option<u64>,
    /// Star/rating count (if tracked by marketplace).
    pub stars: Option<u64>,
}

/// Source of an installed plugin.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "source", rename_all = "lowercase")]
pub enum InstalledPluginSource {
    /// Installed from a marketplace.
    Marketplace {
        /// ID of the marketplace source.
        marketplace_id: String,
        /// Original plugin ID in the marketplace.
        plugin_id: String,
    },
    /// Installed manually from a Git repository.
    Git {
        /// Repository URL.
        repository_url: String,
    },
    /// Installed from a local directory.
    Local {
        /// Original source path.
        source_path: String,
    },
}

/// A plugin that has been installed locally.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct InstalledPlugin {
    /// Unique identifier (UUID).
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Installed version string.
    pub version: String,
    /// Source of the installation.
    #[serde(flatten)]
    pub source: InstalledPluginSource,
    /// Installation scope (user, project, local).
    pub install_scope: InstallScope,
    /// Path to the installed plugin directory.
    pub path: String,
    /// ISO8601 timestamp of installation.
    pub installed_at: String,
    /// ISO8601 timestamp of last update (if any).
    pub updated_at: Option<String>,
    /// IDs of skills provided by this plugin.
    pub skills: Vec<String>,
    /// Names of commands provided by this plugin.
    pub commands: Vec<String>,
    /// Names of MCP servers provided by this plugin.
    pub mcp_servers: Vec<String>,
    /// Names of agents provided by this plugin.
    pub agents: Vec<String>,
    /// Names of hooks provided by this plugin.
    pub hooks: Vec<String>,
    /// Whether the plugin is enabled.
    pub is_enabled: bool,
}

/// Session-specific marketplace plugin configuration.
///
/// Tracks which marketplace plugins are enabled for a specific session.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct SessionMarketplaceConfig {
    /// IDs of enabled installed plugins.
    pub enabled_plugins: Vec<String>,
    /// IDs of explicitly disabled plugins (overrides defaults).
    pub disabled_plugins: Vec<String>,
}

/// Raw structure of a marketplace.json catalog file.
#[derive(Debug, Deserialize)]
pub struct MarketplaceCatalog {
    /// Name of the marketplace.
    pub name: String,
    /// Description of the marketplace.
    #[serde(default)]
    pub description: Option<String>,
    /// Version of the catalog format.
    #[serde(default)]
    pub version: Option<String>,
    /// List of available plugins.
    #[serde(default)]
    pub plugins: Vec<CatalogPlugin>,
}

/// Raw plugin entry from a marketplace catalog.
#[derive(Debug, Deserialize)]
pub struct CatalogPlugin {
    /// Unique identifier.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Description.
    #[serde(default)]
    pub description: Option<String>,
    /// Version string.
    #[serde(default)]
    pub version: Option<String>,
    /// Author name.
    #[serde(default)]
    pub author: Option<String>,
    /// Category string (will be parsed into PluginCategory).
    #[serde(default)]
    pub category: Option<String>,
    /// Types as strings (will be parsed into PluginType).
    #[serde(default)]
    pub types: Vec<String>,
    /// Repository URL.
    #[serde(default)]
    pub repository: Option<String>,
    /// Download URL.
    #[serde(default)]
    pub download_url: Option<String>,
    /// Tags.
    #[serde(default)]
    pub tags: Vec<String>,
    /// Icon URL.
    #[serde(default)]
    pub icon: Option<String>,
    /// Homepage URL.
    #[serde(default)]
    pub homepage: Option<String>,
    /// Minimum version.
    #[serde(default)]
    pub min_version: Option<String>,
    /// License.
    #[serde(default)]
    pub license: Option<String>,
    /// Downloads count.
    #[serde(default)]
    pub downloads: Option<u64>,
    /// Stars count.
    #[serde(default)]
    pub stars: Option<u64>,
}

impl CatalogPlugin {
    /// Converts a raw catalog entry to a MarketplacePlugin.
    pub fn into_marketplace_plugin(self, marketplace_id: &str) -> MarketplacePlugin {
        MarketplacePlugin {
            id: self.id,
            name: self.name,
            description: self.description.unwrap_or_default(),
            version: self.version.unwrap_or_else(|| "0.0.0".to_string()),
            author: self.author.unwrap_or_else(|| "Unknown".to_string()),
            category: parse_category(&self.category),
            types: self.types.iter().filter_map(|t| parse_plugin_type(t)).collect(),
            download_url: self.download_url,
            repository_url: self.repository,
            tags: self.tags,
            marketplace_id: marketplace_id.to_string(),
            icon_url: self.icon,
            homepage_url: self.homepage,
            min_version: self.min_version,
            license: self.license,
            downloads: self.downloads,
            stars: self.stars,
        }
    }
}

fn parse_category(s: &Option<String>) -> PluginCategory {
    match s.as_deref() {
        Some("development") => PluginCategory::Development,
        Some("productivity") => PluginCategory::Productivity,
        Some("integration") => PluginCategory::Integration,
        Some("ai") => PluginCategory::Ai,
        Some("data") => PluginCategory::Data,
        Some("security") => PluginCategory::Security,
        Some("documentation") => PluginCategory::Documentation,
        Some("utility") => PluginCategory::Utility,
        _ => PluginCategory::Other,
    }
}

fn parse_plugin_type(s: &str) -> Option<PluginType> {
    match s.to_lowercase().as_str() {
        "skill" => Some(PluginType::Skill),
        "command" => Some(PluginType::Command),
        "mcp" => Some(PluginType::Mcp),
        "agent" => Some(PluginType::Agent),
        "hook" => Some(PluginType::Hook),
        _ => None,
    }
}

/// Persisted marketplace data.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct MarketplaceData {
    /// All marketplace sources.
    pub sources: Vec<MarketplaceSource>,
    /// All installed plugins.
    pub installed_plugins: Vec<InstalledPlugin>,
}
