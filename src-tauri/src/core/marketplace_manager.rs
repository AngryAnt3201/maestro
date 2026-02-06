//! Marketplace management for plugin discovery and installation.
//!
//! The MarketplaceManager handles:
//! - Managing marketplace sources (add/remove/toggle/refresh)
//! - Fetching and parsing marketplace catalogs from GitHub
//! - Cloning and installing plugins
//! - Tracking installed plugins with persistence
//! - Per-session plugin configuration

use dashmap::DashMap;
use directories::BaseDirs;
use std::path::{Path, PathBuf};
use std::sync::RwLock;
use tokio::process::Command;

use super::marketplace_error::{MarketplaceError, MarketplaceResult};
use super::marketplace_models::*;
use super::windows_process::TokioCommandExt;

/// Official Anthropic Claude Code marketplace.
const OFFICIAL_MARKETPLACE_NAME: &str = "Claude Code Official";
const OFFICIAL_MARKETPLACE_URL: &str = "https://github.com/anthropics/claude-code";
const OFFICIAL_MARKETPLACE_ID: &str = "official-anthropic-claude-code";

/// Session key for per-session configuration: (project_path, session_id).
type SessionKey = (String, u32);

/// Manages marketplace sources, available plugins, and installations.
///
/// Thread-safe via `DashMap` and `RwLock`.
pub struct MarketplaceManager {
    /// All marketplace sources.
    sources: RwLock<Vec<MarketplaceSource>>,
    /// Cached available plugins per marketplace ID.
    available_plugins: DashMap<String, Vec<MarketplacePlugin>>,
    /// All installed plugins.
    installed_plugins: RwLock<Vec<InstalledPlugin>>,
    /// Per-session marketplace configuration.
    session_configs: DashMap<SessionKey, SessionMarketplaceConfig>,
}

impl MarketplaceManager {
    /// Creates a new marketplace manager with the official Anthropic marketplace.
    pub fn new() -> Self {
        let official_source = MarketplaceSource {
            id: OFFICIAL_MARKETPLACE_ID.to_string(),
            name: OFFICIAL_MARKETPLACE_NAME.to_string(),
            repository_url: OFFICIAL_MARKETPLACE_URL.to_string(),
            is_official: true,
            is_enabled: true,
            last_fetched: None,
            last_error: None,
        };

        Self {
            sources: RwLock::new(vec![official_source]),
            available_plugins: DashMap::new(),
            installed_plugins: RwLock::new(Vec::new()),
            session_configs: DashMap::new(),
        }
    }

    /// Gets the base plugins directory (~/.claude/plugins/).
    fn get_user_plugins_dir() -> Option<PathBuf> {
        BaseDirs::new().map(|dirs| dirs.home_dir().join(".claude").join("plugins"))
    }

    /// Gets the marketplaces cache directory (~/.claude/plugins/marketplaces/).
    fn get_marketplaces_cache_dir() -> Option<PathBuf> {
        Self::get_user_plugins_dir().map(|p| p.join("marketplaces"))
    }

    /// Gets the repos cache directory (~/.claude/plugins/repos/).
    fn get_repos_cache_dir() -> Option<PathBuf> {
        Self::get_user_plugins_dir().map(|p| p.join("repos"))
    }

    /// Generates a unique ID for a new marketplace source.
    fn generate_source_id() -> String {
        // Simple UUID v4-like generation using random bytes
        use std::time::{SystemTime, UNIX_EPOCH};
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!("{:032x}", timestamp)
    }

    /// Generates a unique ID for a new installed plugin.
    fn generate_plugin_id() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        format!("{:032x}", timestamp)
    }

    /// Gets the current ISO8601 timestamp.
    fn now_iso8601() -> String {
        use std::time::{SystemTime, UNIX_EPOCH};
        let duration = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap();
        let secs = duration.as_secs();
        // Simple ISO8601 format: "2024-01-01T00:00:00Z"
        // This is a simplified implementation - in production, use chrono
        format!("{}Z", secs)
    }

    // ========== Source Management ==========

    /// Returns all marketplace sources.
    pub fn get_sources(&self) -> Vec<MarketplaceSource> {
        self.sources.read().unwrap().clone()
    }

    /// Adds a new marketplace source.
    pub fn add_source(&self, name: String, repository_url: String, is_official: bool) -> MarketplaceSource {
        let source = MarketplaceSource {
            id: Self::generate_source_id(),
            name,
            repository_url,
            is_official,
            is_enabled: true,
            last_fetched: None,
            last_error: None,
        };

        self.sources.write().unwrap().push(source.clone());
        source
    }

    /// Removes a marketplace source by ID.
    pub fn remove_source(&self, source_id: &str) -> MarketplaceResult<()> {
        let mut sources = self.sources.write().unwrap();
        let initial_len = sources.len();
        sources.retain(|s| s.id != source_id);

        if sources.len() == initial_len {
            return Err(MarketplaceError::SourceNotFound(source_id.to_string()));
        }

        // Also remove cached plugins for this source
        self.available_plugins.remove(source_id);

        Ok(())
    }

    /// Toggles a marketplace source's enabled state.
    pub fn toggle_source(&self, source_id: &str) -> MarketplaceResult<bool> {
        let mut sources = self.sources.write().unwrap();

        for source in sources.iter_mut() {
            if source.id == source_id {
                source.is_enabled = !source.is_enabled;
                return Ok(source.is_enabled);
            }
        }

        Err(MarketplaceError::SourceNotFound(source_id.to_string()))
    }

    /// Gets a source by ID.
    pub fn get_source(&self, source_id: &str) -> Option<MarketplaceSource> {
        self.sources.read().unwrap()
            .iter()
            .find(|s| s.id == source_id)
            .cloned()
    }

    // ========== Marketplace Fetching ==========

    /// Constructs the raw GitHub URL for a marketplace.json file.
    fn get_marketplace_json_url(repository_url: &str) -> String {
        // Convert GitHub repo URL to raw content URL
        // The marketplace.json is located at .claude-plugin/marketplace.json
        // e.g., "https://github.com/owner/repo" -> "https://raw.githubusercontent.com/owner/repo/main/.claude-plugin/marketplace.json"
        let repo = repository_url
            .trim_end_matches('/')
            .replace("https://github.com/", "");
        format!("https://raw.githubusercontent.com/{}/main/.claude-plugin/marketplace.json", repo)
    }

    /// Fetches and parses a marketplace catalog from a source.
    pub async fn fetch_marketplace(&self, source_id: &str) -> MarketplaceResult<Vec<MarketplacePlugin>> {
        let source = self.get_source(source_id)
            .ok_or_else(|| MarketplaceError::SourceNotFound(source_id.to_string()))?;

        let url = Self::get_marketplace_json_url(&source.repository_url);

        // Fetch the marketplace.json
        let response = reqwest::get(&url)
            .await
            .map_err(|e| MarketplaceError::NetworkError(e.to_string()))?;

        if !response.status().is_success() {
            let error_msg = format!("HTTP {}: {}", response.status(), url);
            self.update_source_error(source_id, &error_msg);
            return Err(MarketplaceError::FetchError(error_msg));
        }

        let text = response
            .text()
            .await
            .map_err(|e| MarketplaceError::NetworkError(e.to_string()))?;

        // Parse the catalog
        let catalog: MarketplaceCatalog = serde_json::from_str(&text)
            .map_err(|e| {
                let error_msg = format!("Invalid JSON: {}", e);
                self.update_source_error(source_id, &error_msg);
                MarketplaceError::ParseError(error_msg)
            })?;

        // Convert to MarketplacePlugin list
        let plugins: Vec<MarketplacePlugin> = catalog.plugins
            .into_iter()
            .map(|p| p.into_marketplace_plugin(source_id, &source.repository_url))
            .collect();

        // Update source status
        self.update_source_success(source_id);

        // Cache the plugins
        self.available_plugins.insert(source_id.to_string(), plugins.clone());

        Ok(plugins)
    }

    /// Updates a source after successful fetch.
    fn update_source_success(&self, source_id: &str) {
        let mut sources = self.sources.write().unwrap();
        if let Some(source) = sources.iter_mut().find(|s| s.id == source_id) {
            source.last_fetched = Some(Self::now_iso8601());
            source.last_error = None;
        }
    }

    /// Updates a source after failed fetch.
    fn update_source_error(&self, source_id: &str, error: &str) {
        let mut sources = self.sources.write().unwrap();
        if let Some(source) = sources.iter_mut().find(|s| s.id == source_id) {
            source.last_error = Some(error.to_string());
        }
    }

    /// Refreshes all enabled marketplace sources.
    pub async fn refresh_all_marketplaces(&self) -> Vec<(String, MarketplaceResult<Vec<MarketplacePlugin>>)> {
        let sources = self.get_sources();
        let enabled_sources: Vec<_> = sources.into_iter()
            .filter(|s| s.is_enabled)
            .collect();

        let mut results = Vec::new();

        for source in enabled_sources {
            let result = self.fetch_marketplace(&source.id).await;
            results.push((source.id, result));
        }

        results
    }

    /// Gets all available plugins from enabled marketplaces.
    pub fn get_available_plugins(&self) -> Vec<MarketplacePlugin> {
        let sources = self.get_sources();
        let enabled_ids: Vec<_> = sources.iter()
            .filter(|s| s.is_enabled)
            .map(|s| &s.id)
            .collect();

        let mut all_plugins = Vec::new();

        for entry in self.available_plugins.iter() {
            if enabled_ids.contains(&entry.key()) {
                all_plugins.extend(entry.value().clone());
            }
        }

        all_plugins
    }

    // ========== Plugin Installation ==========

    /// Gets the installation directory for a plugin based on scope.
    fn get_install_dir(&self, scope: InstallScope, project_path: Option<&str>) -> MarketplaceResult<PathBuf> {
        match scope {
            InstallScope::User => {
                Self::get_user_plugins_dir()
                    .ok_or_else(|| MarketplaceError::InvalidPath("Cannot determine home directory".to_string()))
            }
            InstallScope::Project => {
                let project = project_path
                    .ok_or_else(|| MarketplaceError::InvalidPath("Project path required for project scope".to_string()))?;
                Ok(Path::new(project).join(".claude").join("plugins"))
            }
            InstallScope::Local => {
                let project = project_path
                    .ok_or_else(|| MarketplaceError::InvalidPath("Project path required for local scope".to_string()))?;
                Ok(Path::new(project).join(".claude.local").join("plugins"))
            }
        }
    }

    /// Clones a repository using git.
    ///
    /// If `source_path` is provided, uses sparse checkout to clone only the
    /// specified subdirectory (for monorepo plugins).
    async fn clone_repository(
        repo_url: &str,
        target_dir: &Path,
        source_path: Option<&str>,
    ) -> MarketplaceResult<()> {
        // Ensure parent directory exists
        if let Some(parent) = target_dir.parent() {
            tokio::fs::create_dir_all(parent).await?;
        }

        if let Some(subpath) = source_path {
            // Sparse checkout for subdirectory within a monorepo
            Self::clone_sparse(repo_url, target_dir, subpath).await
        } else {
            // Simple shallow clone for standalone repos
            Self::clone_shallow(repo_url, target_dir).await
        }
    }

    /// Performs a shallow clone of the entire repository.
    async fn clone_shallow(repo_url: &str, target_dir: &Path) -> MarketplaceResult<()> {
        let output = Command::new("git")
            .args(["clone", "--depth", "1", repo_url])
            .arg(target_dir)
            .hide_console_window()
            .output()
            .await
            .map_err(|e| MarketplaceError::CloneError(format!("Failed to run git: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(MarketplaceError::CloneError(stderr.to_string()));
        }

        Ok(())
    }

    /// Performs a sparse checkout to clone only a specific subdirectory.
    ///
    /// This is used for plugins that are subdirectories within a larger monorepo
    /// (e.g., anthropics/claude-code/plugins/frontend-design).
    async fn clone_sparse(repo_url: &str, target_dir: &Path, subpath: &str) -> MarketplaceResult<()> {
        // Create a temporary directory for the sparse checkout
        let temp_dir = target_dir.with_file_name(format!(
            ".{}-sparse-temp",
            target_dir.file_name().unwrap_or_default().to_string_lossy()
        ));

        // Clean up any existing temp directory
        if temp_dir.exists() {
            tokio::fs::remove_dir_all(&temp_dir).await?;
        }

        // Step 1: Clone with no checkout and blob filter for efficiency
        let output = Command::new("git")
            .args([
                "clone",
                "--filter=blob:none",
                "--no-checkout",
                "--depth",
                "1",
                repo_url,
            ])
            .arg(&temp_dir)
            .hide_console_window()
            .output()
            .await
            .map_err(|e| MarketplaceError::CloneError(format!("Failed to run git clone: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let _ = tokio::fs::remove_dir_all(&temp_dir).await;
            return Err(MarketplaceError::CloneError(format!(
                "git clone failed: {}",
                stderr
            )));
        }

        // Step 2: Set up sparse checkout for the specific subdirectory
        let output = Command::new("git")
            .args(["sparse-checkout", "set", "--no-cone", subpath])
            .current_dir(&temp_dir)
            .hide_console_window()
            .output()
            .await
            .map_err(|e| {
                MarketplaceError::CloneError(format!("Failed to run git sparse-checkout: {}", e))
            })?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let _ = tokio::fs::remove_dir_all(&temp_dir).await;
            return Err(MarketplaceError::CloneError(format!(
                "git sparse-checkout failed: {}",
                stderr
            )));
        }

        // Step 3: Checkout the files
        let output = Command::new("git")
            .args(["checkout"])
            .current_dir(&temp_dir)
            .hide_console_window()
            .output()
            .await
            .map_err(|e| MarketplaceError::CloneError(format!("Failed to run git checkout: {}", e)))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            let _ = tokio::fs::remove_dir_all(&temp_dir).await;
            return Err(MarketplaceError::CloneError(format!(
                "git checkout failed: {}",
                stderr
            )));
        }

        // Step 4: Move the subdirectory contents to the target directory
        let source_subdir = temp_dir.join(subpath);
        if !source_subdir.exists() {
            let _ = tokio::fs::remove_dir_all(&temp_dir).await;
            return Err(MarketplaceError::CloneError(format!(
                "Subdirectory '{}' not found in repository",
                subpath
            )));
        }

        // Rename the subdirectory to the target location
        tokio::fs::rename(&source_subdir, target_dir).await.map_err(|e| {
            MarketplaceError::CloneError(format!("Failed to move plugin directory: {}", e))
        })?;

        // Clean up the temporary directory
        let _ = tokio::fs::remove_dir_all(&temp_dir).await;

        Ok(())
    }

    /// Discovers plugin components from an installed directory.
    fn discover_plugin_components(plugin_dir: &Path) -> (Vec<String>, Vec<String>, Vec<String>, Vec<String>, Vec<String>) {
        let mut skills = Vec::new();
        let mut commands = Vec::new();
        let mut mcp_servers = Vec::new();
        let mut agents = Vec::new();
        let mut hooks = Vec::new();

        // Scan skills/ directory
        let skills_dir = plugin_dir.join("skills");
        if skills_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&skills_dir) {
                for entry in entries.flatten() {
                    if entry.path().is_dir() {
                        if let Some(name) = entry.file_name().to_str() {
                            skills.push(name.to_string());
                        }
                    }
                }
            }
        }

        // Scan commands/ directory
        let commands_dir = plugin_dir.join("commands");
        if commands_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&commands_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() && path.extension().map_or(false, |e| e == "md") {
                        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                            commands.push(stem.to_string());
                        }
                    }
                }
            }
        }

        // Check for .mcp.json
        let mcp_json = plugin_dir.join(".mcp.json");
        if mcp_json.exists() {
            if let Ok(content) = std::fs::read_to_string(&mcp_json) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(servers) = json.get("mcpServers").and_then(|v| v.as_object()) {
                        for key in servers.keys() {
                            mcp_servers.push(key.clone());
                        }
                    }
                }
            }
        }

        // Scan agents/ directory
        let agents_dir = plugin_dir.join("agents");
        if agents_dir.exists() {
            if let Ok(entries) = std::fs::read_dir(&agents_dir) {
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() && path.extension().map_or(false, |e| e == "md") {
                        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
                            agents.push(stem.to_string());
                        }
                    }
                }
            }
        }

        // Check for hooks.json
        let hooks_json = plugin_dir.join("hooks.json");
        if hooks_json.exists() {
            if let Ok(content) = std::fs::read_to_string(&hooks_json) {
                if let Ok(json) = serde_json::from_str::<serde_json::Value>(&content) {
                    if let Some(arr) = json.as_array() {
                        for hook in arr {
                            if let Some(event) = hook.get("event").and_then(|v| v.as_str()) {
                                hooks.push(event.to_string());
                            }
                        }
                    }
                }
            }
        }

        (skills, commands, mcp_servers, agents, hooks)
    }

    /// Installs a plugin from a marketplace.
    pub async fn install_plugin(
        &self,
        marketplace_plugin_id: &str,
        scope: InstallScope,
        project_path: Option<&str>,
    ) -> MarketplaceResult<InstalledPlugin> {
        // Find the plugin in available plugins
        let plugin = self.get_available_plugins()
            .into_iter()
            .find(|p| p.id == marketplace_plugin_id)
            .ok_or_else(|| MarketplaceError::PluginNotFound(marketplace_plugin_id.to_string()))?;

        // Get repository URL
        let repo_url = plugin.repository_url.as_ref()
            .or(plugin.download_url.as_ref())
            .ok_or_else(|| MarketplaceError::PluginNotFound(
                format!("{}: No repository URL", marketplace_plugin_id)
            ))?;

        // Check if already installed (scope the lock guard)
        {
            let installed = self.installed_plugins.read().unwrap();
            if installed.iter().any(|p| {
                matches!(&p.source, InstalledPluginSource::Marketplace { plugin_id, .. } if plugin_id == marketplace_plugin_id)
            }) {
                return Err(MarketplaceError::AlreadyInstalled(marketplace_plugin_id.to_string()));
            }
        }

        // Determine install directory
        let install_base = self.get_install_dir(scope, project_path)?;

        // Use plugin name for directory
        let plugin_dir_name = plugin.id.replace('/', "-");
        let plugin_dir = install_base.join(&plugin_dir_name);

        // Clone the repository (with sparse checkout for monorepo plugins)
        Self::clone_repository(repo_url, &plugin_dir, plugin.source_path.as_deref()).await?;

        // Create plugin manifest directory
        let manifest_dir = plugin_dir.join(".claude-plugin");
        tokio::fs::create_dir_all(&manifest_dir).await?;

        // Write plugin.json manifest
        let manifest = serde_json::json!({
            "name": plugin.name,
            "version": plugin.version,
            "description": plugin.description,
            "marketplace_id": plugin.marketplace_id,
            "plugin_id": marketplace_plugin_id,
        });
        let manifest_path = manifest_dir.join("plugin.json");
        tokio::fs::write(&manifest_path, serde_json::to_string_pretty(&manifest)?).await?;

        // Discover components
        let (skills, commands, mcp_servers, agents, hooks) = Self::discover_plugin_components(&plugin_dir);

        // Create installed plugin record
        let installed_plugin = InstalledPlugin {
            id: Self::generate_plugin_id(),
            name: plugin.name.clone(),
            version: plugin.version.clone(),
            source: InstalledPluginSource::Marketplace {
                marketplace_id: plugin.marketplace_id.clone(),
                plugin_id: marketplace_plugin_id.to_string(),
            },
            install_scope: scope,
            path: plugin_dir.to_string_lossy().to_string(),
            installed_at: Self::now_iso8601(),
            updated_at: None,
            skills,
            commands,
            mcp_servers,
            agents,
            hooks,
            is_enabled: true,
        };

        // Add to installed plugins
        self.installed_plugins.write().unwrap().push(installed_plugin.clone());

        Ok(installed_plugin)
    }

    /// Uninstalls a plugin by ID.
    pub async fn uninstall_plugin(&self, installed_plugin_id: &str) -> MarketplaceResult<()> {
        // Extract the plugin path while holding the lock, then release it
        let plugin_path_string = {
            let mut installed = self.installed_plugins.write().unwrap();

            let idx = installed.iter()
                .position(|p| p.id == installed_plugin_id)
                .ok_or_else(|| MarketplaceError::NotInstalled(installed_plugin_id.to_string()))?;

            let plugin = installed.remove(idx);
            plugin.path
        };

        // Remove the plugin directory (lock is released)
        let plugin_path = Path::new(&plugin_path_string);
        if plugin_path.exists() {
            tokio::fs::remove_dir_all(plugin_path).await?;
        }

        Ok(())
    }

    /// Gets all installed plugins.
    pub fn get_installed_plugins(&self) -> Vec<InstalledPlugin> {
        self.installed_plugins.read().unwrap().clone()
    }

    /// Checks if a marketplace plugin is installed.
    pub fn is_plugin_installed(&self, marketplace_plugin_id: &str) -> bool {
        self.installed_plugins.read().unwrap()
            .iter()
            .any(|p| {
                matches!(&p.source, InstalledPluginSource::Marketplace { plugin_id, .. } if plugin_id == marketplace_plugin_id)
            })
    }

    // ========== Session Configuration ==========

    /// Gets the marketplace config for a session.
    pub fn get_session_config(&self, project_path: &str, session_id: u32) -> SessionMarketplaceConfig {
        let key = (project_path.to_string(), session_id);
        self.session_configs
            .get(&key)
            .map(|c| c.clone())
            .unwrap_or_default()
    }

    /// Sets whether a plugin is enabled for a session.
    pub fn set_plugin_enabled_for_session(
        &self,
        project_path: &str,
        session_id: u32,
        installed_plugin_id: &str,
        enabled: bool,
    ) {
        let key = (project_path.to_string(), session_id);

        let mut config = self.session_configs.entry(key).or_default();
        if enabled {
            config.disabled_plugins.retain(|id| id != installed_plugin_id);
            if !config.enabled_plugins.contains(&installed_plugin_id.to_string()) {
                config.enabled_plugins.push(installed_plugin_id.to_string());
            }
        } else {
            config.enabled_plugins.retain(|id| id != installed_plugin_id);
            if !config.disabled_plugins.contains(&installed_plugin_id.to_string()) {
                config.disabled_plugins.push(installed_plugin_id.to_string());
            }
        }
    }

    /// Clears session configuration when a session is closed.
    pub fn clear_session(&self, project_path: &str, session_id: u32) {
        let key = (project_path.to_string(), session_id);
        self.session_configs.remove(&key);
    }

    // ========== Persistence ==========

    /// Loads marketplace data from a JSON string.
    pub fn load_from_json(&self, json: &str) -> MarketplaceResult<()> {
        let data: MarketplaceData = serde_json::from_str(json)?;

        *self.sources.write().unwrap() = data.sources;
        *self.installed_plugins.write().unwrap() = data.installed_plugins;

        Ok(())
    }

    /// Exports marketplace data to a JSON string.
    pub fn export_to_json(&self) -> MarketplaceResult<String> {
        let data = MarketplaceData {
            sources: self.sources.read().unwrap().clone(),
            installed_plugins: self.installed_plugins.read().unwrap().clone(),
        };

        Ok(serde_json::to_string_pretty(&data)?)
    }
}

impl Default for MarketplaceManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_add_remove_source() {
        let manager = MarketplaceManager::new();
        let initial_len = manager.get_sources().len();

        let source = manager.add_source(
            "Test Marketplace".to_string(),
            "https://github.com/test/marketplace".to_string(),
            false,
        );

        assert_eq!(manager.get_sources().len(), initial_len + 1);
        let added = manager
            .get_sources()
            .into_iter()
            .find(|s| s.id == source.id)
            .expect("expected added source to exist");
        assert_eq!(added.name, "Test Marketplace");

        manager.remove_source(&source.id).unwrap();
        assert_eq!(manager.get_sources().len(), initial_len);
    }

    #[test]
    fn test_toggle_source() {
        let manager = MarketplaceManager::new();
        let initial_len = manager.get_sources().len();

        let source = manager.add_source(
            "Test".to_string(),
            "https://github.com/test/repo".to_string(),
            false,
        );

        assert_eq!(manager.get_sources().len(), initial_len + 1);
        let added = manager
            .get_sources()
            .into_iter()
            .find(|s| s.id == source.id)
            .expect("expected added source to exist");
        assert!(added.is_enabled);

        let new_state = manager.toggle_source(&source.id).unwrap();
        assert!(!new_state);
        let toggled = manager
            .get_sources()
            .into_iter()
            .find(|s| s.id == source.id)
            .expect("expected toggled source to exist");
        assert!(!toggled.is_enabled);
    }

    #[test]
    fn test_marketplace_json_url() {
        let url = MarketplaceManager::get_marketplace_json_url("https://github.com/owner/repo");
        assert_eq!(url, "https://raw.githubusercontent.com/owner/repo/main/.claude-plugin/marketplace.json");

        let url_trailing = MarketplaceManager::get_marketplace_json_url("https://github.com/owner/repo/");
        assert_eq!(url_trailing, "https://raw.githubusercontent.com/owner/repo/main/.claude-plugin/marketplace.json");
    }
}
