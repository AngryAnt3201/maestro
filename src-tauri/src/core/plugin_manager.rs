//! Plugin and skill discovery and session state management.
//!
//! This module discovers skills from multiple sources:
//! - Project skills: `<project>/.claude/skills/*/SKILL.md`
//! - Project commands: `<project>/.claude/commands/*.md`
//! - Personal skills: `~/.claude/skills/*/SKILL.md`
//! - Personal commands: `~/.claude/commands/*.md`
//! - Installed plugins: `~/.claude/plugins/*/`
//! - CLI-installed plugins: `~/.claude/plugins/installed_plugins.json`
//! - Legacy `.plugins.json` files at project roots
//!
//! It also tracks which skills/plugins are enabled per session.

use dashmap::DashMap;
use directories::BaseDirs;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

/// The source/origin of a skill.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum SkillSource {
    /// From project's .claude/skills/ or .claude/commands/ directory.
    Project,
    /// From user's ~/.claude/skills/ or ~/.claude/commands/ directory.
    Personal,
    /// From an installed plugin in ~/.claude/plugins/.
    Plugin { name: String },
    /// Legacy: from .plugins.json file.
    Legacy,
}

/// The type of a skill - determines how it's executed.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "skill_type", rename_all = "lowercase")]
pub enum SkillType {
    /// Inline prompt-based skill.
    Prompt { prompt: String },
    /// File-based skill (loads prompt from a markdown file).
    File { path: String },
    /// Command-based skill (executes a shell command).
    Command { command: String, args: Vec<String> },
}

/// Configuration for a skill.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SkillConfig {
    /// Unique skill identifier.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Description of what the skill does.
    pub description: String,
    /// Optional icon name (lucide icon).
    pub icon: Option<String>,
    /// Skill type and execution details.
    #[serde(flatten)]
    pub skill_type: SkillType,
    /// ID of the plugin this skill belongs to (None if standalone).
    pub plugin_id: Option<String>,
    /// Source of the skill.
    pub source: SkillSource,
    /// Path to the skill file (SKILL.md or command.md).
    pub path: Option<String>,

    // --- Frontmatter fields ---
    /// Hint shown during autocomplete (e.g., "[issue-number]").
    pub argument_hint: Option<String>,
    /// If true, Claude won't auto-invoke this skill.
    #[serde(default)]
    pub disable_model_invocation: bool,
    /// If false, hide from the / menu (default true).
    #[serde(default = "default_true")]
    pub user_invocable: bool,
    /// Tools that don't require permission prompts.
    pub allowed_tools: Option<String>,
    /// Model override for this skill.
    pub model: Option<String>,
    /// Run context ("fork" for subagent).
    pub context: Option<String>,
    /// Subagent type when context="fork".
    pub agent: Option<String>,
}

/// The source/origin of a plugin bundle.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "plugin_source", rename_all = "lowercase")]
pub enum PluginSource {
    /// Built into Maestro.
    Builtin,
    /// Defined in the project's .plugins.json (legacy).
    Project,
    /// User-installed plugin from ~/.claude/plugins/ (with manifest).
    Installed,
    /// Installed from marketplace.
    Marketplace { url: String },
    /// Installed via Claude CLI (from installed_plugins.json / cache directory).
    #[serde(rename = "cli_installed")]
    CliInstalled,
}

/// Hook configuration (simplified for now).
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HookConfig {
    /// Hook event type.
    pub event: String,
    /// Command to execute.
    pub command: String,
    /// Arguments for the command.
    #[serde(default)]
    pub args: Vec<String>,
}

/// Configuration for a plugin bundle.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PluginConfig {
    /// Unique plugin identifier.
    pub id: String,
    /// Human-readable name.
    pub name: String,
    /// Plugin version.
    pub version: String,
    /// Description of what the plugin provides.
    pub description: String,
    /// Optional icon name (lucide icon).
    pub icon: Option<String>,
    /// Source of the plugin.
    #[serde(flatten)]
    pub plugin_source: PluginSource,
    /// Claude CLI plugin ID (e.g. "name@marketplace") for enabledPlugins config.
    /// None for legacy or builtin plugins.
    pub cli_id: Option<String>,
    /// IDs of skills this plugin provides.
    pub skills: Vec<String>,
    /// Names of MCP servers this plugin references.
    #[serde(default)]
    pub mcp_servers: Vec<String>,
    /// Hooks this plugin provides.
    #[serde(default)]
    pub hooks: Vec<HookConfig>,
    /// Whether this plugin is enabled by default.
    #[serde(default = "default_true")]
    pub enabled_by_default: bool,
    /// Path to the plugin directory.
    pub path: Option<String>,
}

fn default_true() -> bool {
    true
}

/// Combined result of plugin discovery for a project.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectPlugins {
    /// All discovered skills.
    pub skills: Vec<SkillConfig>,
    /// All discovered plugins.
    pub plugins: Vec<PluginConfig>,
}

impl Default for ProjectPlugins {
    fn default() -> Self {
        Self {
            skills: Vec::new(),
            plugins: Vec::new(),
        }
    }
}

/// Raw structure of `.plugins.json` file.
#[derive(Debug, Deserialize)]
struct PluginsJsonFile {
    #[serde(default)]
    skills: HashMap<String, RawSkillEntry>,
    #[serde(default)]
    plugins: HashMap<String, RawPluginEntry>,
}

/// Raw skill entry from JSON.
#[derive(Debug, Deserialize)]
struct RawSkillEntry {
    #[serde(rename = "type")]
    skill_type: String,
    name: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    // Type-specific fields
    #[serde(default)]
    prompt: Option<String>,
    #[serde(default)]
    path: Option<String>,
    #[serde(default)]
    command: Option<String>,
    #[serde(default)]
    args: Option<Vec<String>>,
}

/// Raw plugin entry from JSON.
#[derive(Debug, Deserialize)]
struct RawPluginEntry {
    name: String,
    version: String,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    #[serde(default)]
    source: Option<String>,
    #[serde(default)]
    marketplace_url: Option<String>,
    #[serde(default)]
    skills: Vec<String>,
    #[serde(default)]
    mcp_servers: Vec<String>,
    #[serde(default)]
    hooks: Vec<HookConfig>,
    #[serde(default = "default_true")]
    enabled_by_default: bool,
}

/// Installed plugin manifest from .claude-plugin/plugin.json.
#[derive(Debug, Deserialize)]
struct PluginManifest {
    name: String,
    #[serde(default)]
    version: Option<String>,
    #[serde(default)]
    description: Option<String>,
    #[serde(default)]
    icon: Option<String>,
    /// Marketplace ID (e.g. "official-anthropic-claude-code").
    #[serde(default)]
    marketplace_id: Option<String>,
    /// Plugin ID within the marketplace.
    #[serde(default)]
    plugin_id: Option<String>,
}

/// Structure of ~/.claude/plugins/installed_plugins.json.
#[derive(Debug, Deserialize)]
struct InstalledPluginsJson {
    #[serde(default)]
    version: u32,
    #[serde(default)]
    plugins: HashMap<String, Vec<InstalledPluginEntry>>,
}

/// An entry in installed_plugins.json for a specific scope.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstalledPluginEntry {
    #[serde(default)]
    scope: String,
    install_path: String,
    #[serde(default)]
    version: Option<String>,
}

/// Parsed YAML frontmatter from a skill/command markdown file.
#[derive(Debug, Default)]
struct Frontmatter {
    name: Option<String>,
    description: Option<String>,
    argument_hint: Option<String>,
    disable_model_invocation: bool,
    user_invocable: bool,
    allowed_tools: Option<String>,
    model: Option<String>,
    context: Option<String>,
    agent: Option<String>,
}

impl Frontmatter {
    /// Parses YAML frontmatter from markdown content.
    /// Frontmatter is delimited by `---` at the start of the file.
    fn parse(content: &str) -> Self {
        let mut fm = Frontmatter {
            user_invocable: true, // Default to true
            ..Default::default()
        };

        let trimmed = content.trim_start();
        if !trimmed.starts_with("---") {
            return fm;
        }

        // Find the closing ---
        let after_first = &trimmed[3..];
        let Some(end_idx) = after_first.find("\n---") else {
            return fm;
        };

        let yaml_content = &after_first[..end_idx];

        // Parse line by line (simple key: value parsing)
        for line in yaml_content.lines() {
            let line = line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }

            let Some((key, value)) = line.split_once(':') else {
                continue;
            };

            let key = key.trim();
            let value = value.trim().trim_matches('"').trim_matches('\'');

            match key {
                "name" => fm.name = Some(value.to_string()),
                "description" => fm.description = Some(value.to_string()),
                "argument-hint" => fm.argument_hint = Some(value.to_string()),
                "disable-model-invocation" => {
                    fm.disable_model_invocation = value == "true";
                }
                "user-invocable" => {
                    fm.user_invocable = value != "false";
                }
                "allowed-tools" => fm.allowed_tools = Some(value.to_string()),
                "model" => fm.model = Some(value.to_string()),
                "context" => fm.context = Some(value.to_string()),
                "agent" => fm.agent = Some(value.to_string()),
                _ => {}
            }
        }

        fm
    }
}

/// Scans a skills directory for SKILL.md files in subdirectories.
/// Pattern: `dir/*/SKILL.md`
fn scan_skills_directory(dir: &Path, source: SkillSource) -> Vec<SkillConfig> {
    let mut skills = Vec::new();

    let Ok(entries) = fs::read_dir(dir) else {
        return skills;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }

        let skill_file = path.join("SKILL.md");
        if !skill_file.exists() {
            continue;
        }

        let Ok(content) = fs::read_to_string(&skill_file) else {
            continue;
        };

        let fm = Frontmatter::parse(&content);

        // Derive skill name from directory name or frontmatter
        let dir_name = path
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");
        let skill_name = fm.name.clone().unwrap_or_else(|| dir_name.to_string());
        let skill_id = format!("{}:{}", source_prefix(&source), dir_name);

        skills.push(SkillConfig {
            id: skill_id,
            name: skill_name,
            description: fm.description.unwrap_or_default(),
            icon: None,
            skill_type: SkillType::File {
                path: skill_file.to_string_lossy().to_string(),
            },
            plugin_id: match &source {
                SkillSource::Plugin { name } => Some(name.clone()),
                _ => None,
            },
            source: source.clone(),
            path: Some(skill_file.to_string_lossy().to_string()),
            argument_hint: fm.argument_hint,
            disable_model_invocation: fm.disable_model_invocation,
            user_invocable: fm.user_invocable,
            allowed_tools: fm.allowed_tools,
            model: fm.model,
            context: fm.context,
            agent: fm.agent,
        });
    }

    skills
}

/// Scans a commands directory for .md files.
/// Pattern: `dir/*.md`
fn scan_commands_directory(dir: &Path, source: SkillSource) -> Vec<SkillConfig> {
    let mut skills = Vec::new();

    let Ok(entries) = fs::read_dir(dir) else {
        return skills;
    };

    for entry in entries.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let Some(ext) = path.extension() else {
            continue;
        };
        if ext != "md" {
            continue;
        }

        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };

        let fm = Frontmatter::parse(&content);

        // Derive command name from filename (without .md) or frontmatter
        let file_stem = path
            .file_stem()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown");
        let cmd_name = fm.name.clone().unwrap_or_else(|| file_stem.to_string());
        let cmd_id = format!("{}:{}", source_prefix(&source), file_stem);

        skills.push(SkillConfig {
            id: cmd_id,
            name: cmd_name,
            description: fm.description.unwrap_or_default(),
            icon: None,
            skill_type: SkillType::File {
                path: path.to_string_lossy().to_string(),
            },
            plugin_id: match &source {
                SkillSource::Plugin { name } => Some(name.clone()),
                _ => None,
            },
            source: source.clone(),
            path: Some(path.to_string_lossy().to_string()),
            argument_hint: fm.argument_hint,
            disable_model_invocation: fm.disable_model_invocation,
            user_invocable: fm.user_invocable,
            allowed_tools: fm.allowed_tools,
            model: fm.model,
            context: fm.context,
            agent: fm.agent,
        });
    }

    skills
}

/// Scans the installed plugins directory (~/.claude/plugins/).
/// Returns tuples of (PluginConfig, Vec<SkillConfig>).
fn scan_plugins_directory(dir: &Path) -> Vec<(PluginConfig, Vec<SkillConfig>)> {
    let mut results = Vec::new();

    let Ok(entries) = fs::read_dir(dir) else {
        return results;
    };

    for entry in entries.flatten() {
        let plugin_dir = entry.path();
        if !plugin_dir.is_dir() {
            continue;
        }

        let plugin_name = plugin_dir
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("unknown")
            .to_string();

        // Only process directories that have a plugin manifest
        // This filters out utility directories like cache/, repos/, marketplaces/
        let manifest_path = plugin_dir.join(".claude-plugin").join("plugin.json");
        let manifest: Option<PluginManifest> = fs::read_to_string(&manifest_path)
            .ok()
            .and_then(|content| serde_json::from_str(&content).ok());

        // Skip directories without a valid plugin.json manifest
        let Some(manifest) = manifest else {
            continue;
        };

        let source = SkillSource::Plugin {
            name: plugin_name.clone(),
        };

        // Scan for skills in the plugin
        let mut plugin_skills = Vec::new();

        // Scan skills/ subdirectory
        let skills_dir = plugin_dir.join("skills");
        if skills_dir.exists() {
            plugin_skills.extend(scan_skills_directory(&skills_dir, source.clone()));
        }

        // Scan commands/ subdirectory
        let commands_dir = plugin_dir.join("commands");
        if commands_dir.exists() {
            plugin_skills.extend(scan_commands_directory(&commands_dir, source.clone()));
        }

        let skill_ids: Vec<String> = plugin_skills.iter().map(|s| s.id.clone()).collect();

        // Derive CLI ID from manifest marketplace_id + plugin_id/name
        let cli_id = derive_cli_id_from_manifest(&manifest, &plugin_name);

        let plugin = PluginConfig {
            id: format!("plugin:{}", plugin_name),
            name: manifest.name.clone(),
            version: manifest.version.unwrap_or_else(|| "0.0.0".to_string()),
            description: manifest.description.unwrap_or_default(),
            icon: manifest.icon,
            plugin_source: PluginSource::Installed,
            cli_id,
            skills: skill_ids,
            mcp_servers: Vec::new(), // TODO: parse .mcp.json if present
            hooks: Vec::new(),       // TODO: parse hooks.json if present
            enabled_by_default: true,
            path: Some(plugin_dir.to_string_lossy().to_string()),
        };

        results.push((plugin, plugin_skills));
    }

    results
}

/// Derives a Claude CLI plugin ID from a plugin manifest.
///
/// If the manifest has marketplace_id, constructs "name@marketplace-short-name".
/// Otherwise returns None.
fn derive_cli_id_from_manifest(manifest: &PluginManifest, dir_name: &str) -> Option<String> {
    let marketplace_id = manifest.marketplace_id.as_deref()?;
    let plugin_id = manifest
        .plugin_id
        .as_deref()
        .unwrap_or(dir_name);

    // Convert marketplace ID to short form used by CLI
    // e.g. "official-anthropic-claude-code" -> "claude-plugins-official"
    // For now, use the marketplace ID as-is since the mapping varies
    let marketplace_short = marketplace_id_to_short(marketplace_id);
    Some(format!("{}@{}", plugin_id, marketplace_short))
}

/// Converts a marketplace ID to the short form used by Claude CLI.
///
/// Known mappings:
/// - "official-anthropic-claude-code" -> "claude-plugins-official"
fn marketplace_id_to_short(marketplace_id: &str) -> &str {
    match marketplace_id {
        "official-anthropic-claude-code" => "claude-plugins-official",
        other => other,
    }
}

/// Parses ~/.claude/plugins/installed_plugins.json to discover CLI-installed plugins.
///
/// Returns tuples of (cli_id, install_path, version).
fn parse_installed_plugins_json(plugins_dir: &Path) -> Vec<(String, String, String)> {
    let json_path = plugins_dir.join("installed_plugins.json");
    let content = match fs::read_to_string(&json_path) {
        Ok(c) => c,
        Err(_) => return Vec::new(),
    };

    let parsed: InstalledPluginsJson = match serde_json::from_str(&content) {
        Ok(p) => p,
        Err(e) => {
            log::warn!("Failed to parse installed_plugins.json: {}", e);
            return Vec::new();
        }
    };

    let mut results = Vec::new();
    for (cli_id, entries) in parsed.plugins {
        // Use the first user-scope entry (or any entry)
        if let Some(entry) = entries.into_iter().find(|e| e.scope == "user").or_else(|| None) {
            let version = entry.version.unwrap_or_else(|| "0.0.0".to_string());
            results.push((cli_id, entry.install_path, version));
        }
    }

    results
}

/// Scans a CLI-installed plugin at the given install path.
///
/// CLI-installed plugins live in cache directories and may have a different structure
/// than manually installed plugins.
fn scan_cli_installed_plugin(
    cli_id: &str,
    install_path: &str,
    version: &str,
) -> Option<(PluginConfig, Vec<SkillConfig>)> {
    let plugin_dir = Path::new(install_path);
    if !plugin_dir.exists() {
        return None;
    }

    // Extract plugin name from CLI ID (part before @)
    let plugin_name = cli_id.split('@').next().unwrap_or(cli_id);

    let source = SkillSource::Plugin {
        name: plugin_name.to_string(),
    };

    let mut plugin_skills = Vec::new();

    // Scan skills/ subdirectory
    let skills_dir = plugin_dir.join("skills");
    if skills_dir.exists() {
        plugin_skills.extend(scan_skills_directory(&skills_dir, source.clone()));
    }

    // Scan commands/ subdirectory
    let commands_dir = plugin_dir.join("commands");
    if commands_dir.exists() {
        plugin_skills.extend(scan_commands_directory(&commands_dir, source.clone()));
    }

    // Try to read the manifest for description
    let manifest_path = plugin_dir.join(".claude-plugin").join("plugin.json");
    let manifest: Option<PluginManifest> = fs::read_to_string(&manifest_path)
        .ok()
        .and_then(|content| serde_json::from_str(&content).ok());

    let skill_ids: Vec<String> = plugin_skills.iter().map(|s| s.id.clone()).collect();

    let plugin = PluginConfig {
        id: format!("plugin:{}", plugin_name),
        name: manifest
            .as_ref()
            .map(|m| m.name.clone())
            .unwrap_or_else(|| plugin_name.to_string()),
        version: version.to_string(),
        description: manifest
            .as_ref()
            .and_then(|m| m.description.clone())
            .unwrap_or_default(),
        icon: manifest.as_ref().and_then(|m| m.icon.clone()),
        plugin_source: PluginSource::CliInstalled,
        cli_id: Some(cli_id.to_string()),
        skills: skill_ids,
        mcp_servers: Vec::new(),
        hooks: Vec::new(),
        enabled_by_default: true,
        path: Some(install_path.to_string()),
    };

    Some((plugin, plugin_skills))
}

/// Returns a prefix string for skill IDs based on source.
fn source_prefix(source: &SkillSource) -> &'static str {
    match source {
        SkillSource::Project => "project",
        SkillSource::Personal => "personal",
        SkillSource::Plugin { .. } => "plugin",
        SkillSource::Legacy => "legacy",
    }
}

/// Deduplicates skills, preferring project > personal > plugin > legacy.
fn deduplicate_skills(skills: Vec<SkillConfig>) -> Vec<SkillConfig> {
    let mut seen_names: HashSet<String> = HashSet::new();
    let mut result = Vec::new();

    // Skills are already in priority order (project first, then personal, etc.)
    for skill in skills {
        // Use skill name as the deduplication key
        if !seen_names.contains(&skill.name) {
            seen_names.insert(skill.name.clone());
            result.push(skill);
        }
    }

    result
}

/// Session-specific key for enabled items lookup.
type SessionKey = (String, u32); // (project_path, session_id)

/// Manages plugin/skill discovery and per-session enabled state.
///
/// Thread-safe via `DashMap` — can be accessed from multiple async tasks.
pub struct PluginManager {
    /// Cached plugins/skills per project path (canonicalized).
    project_plugins: DashMap<String, ProjectPlugins>,
    /// Enabled skill IDs per (project_path, session_id).
    session_enabled_skills: DashMap<SessionKey, Vec<String>>,
    /// Enabled plugin IDs per (project_path, session_id).
    session_enabled_plugins: DashMap<SessionKey, Vec<String>>,
}

impl PluginManager {
    /// Creates a new plugin manager with empty caches.
    pub fn new() -> Self {
        Self {
            project_plugins: DashMap::new(),
            session_enabled_skills: DashMap::new(),
            session_enabled_plugins: DashMap::new(),
        }
    }

    /// Parses the legacy `.plugins.json` file at the given project path.
    ///
    /// Returns empty ProjectPlugins if the file doesn't exist or can't be parsed.
    fn parse_legacy_plugins_json(project_path: &str) -> ProjectPlugins {
        let plugins_path = Path::new(project_path).join(".plugins.json");

        let content = match fs::read_to_string(&plugins_path) {
            Ok(c) => c,
            Err(_) => return ProjectPlugins::default(),
        };

        let parsed: PluginsJsonFile = match serde_json::from_str(&content) {
            Ok(p) => p,
            Err(e) => {
                log::warn!("Failed to parse .plugins.json at {:?}: {}", plugins_path, e);
                return ProjectPlugins::default();
            }
        };

        // Convert skills
        let skills: Vec<SkillConfig> = parsed
            .skills
            .into_iter()
            .filter_map(|(id, entry)| {
                let skill_type = match entry.skill_type.as_str() {
                    "prompt" => {
                        let prompt = entry.prompt?;
                        SkillType::Prompt { prompt }
                    }
                    "file" => {
                        let path = entry.path.clone()?;
                        SkillType::File { path }
                    }
                    "command" => {
                        let command = entry.command?;
                        SkillType::Command {
                            command,
                            args: entry.args.unwrap_or_default(),
                        }
                    }
                    other => {
                        log::warn!("Unknown skill type '{}' for skill '{}'", other, id);
                        return None;
                    }
                };

                Some(SkillConfig {
                    id: format!("legacy:{}", id),
                    name: entry.name,
                    description: entry.description.unwrap_or_default(),
                    icon: entry.icon,
                    skill_type,
                    plugin_id: None,
                    source: SkillSource::Legacy,
                    path: entry.path,
                    argument_hint: None,
                    disable_model_invocation: false,
                    user_invocable: true,
                    allowed_tools: None,
                    model: None,
                    context: None,
                    agent: None,
                })
            })
            .collect();

        // Convert plugins
        let plugins: Vec<PluginConfig> = parsed
            .plugins
            .into_iter()
            .map(|(id, entry)| {
                let plugin_source = match entry.source.as_deref() {
                    Some("builtin") => PluginSource::Builtin,
                    Some("marketplace") => PluginSource::Marketplace {
                        url: entry.marketplace_url.unwrap_or_default(),
                    },
                    _ => PluginSource::Project,
                };

                PluginConfig {
                    id: format!("legacy:{}", id),
                    name: entry.name,
                    version: entry.version,
                    description: entry.description.unwrap_or_default(),
                    icon: entry.icon,
                    plugin_source,
                    cli_id: None,
                    skills: entry.skills,
                    mcp_servers: entry.mcp_servers,
                    hooks: entry.hooks,
                    enabled_by_default: entry.enabled_by_default,
                    path: None,
                }
            })
            .collect();

        ProjectPlugins { skills, plugins }
    }

    /// Discovers all skills and plugins from multiple sources.
    ///
    /// Sources are scanned in priority order:
    /// 1. Project skills: `<project>/.claude/skills/*/SKILL.md`
    /// 2. Project commands: `<project>/.claude/commands/*.md`
    /// 3. Personal skills: `~/.claude/skills/*/SKILL.md`
    /// 4. Personal commands: `~/.claude/commands/*.md`
    /// 5. Installed plugins: `~/.claude/plugins/*/` (with .claude-plugin/plugin.json)
    /// 5b. CLI-installed plugins: `~/.claude/plugins/installed_plugins.json`
    /// 6. Legacy .plugins.json
    ///
    /// Skills are deduplicated, with earlier sources taking priority.
    fn discover_all(project_path: &str) -> ProjectPlugins {
        let mut all_skills = Vec::new();
        let mut all_plugins = Vec::new();

        let project = Path::new(project_path);

        // 1. Project skills: <project>/.claude/skills/*/SKILL.md
        let project_skills_dir = project.join(".claude").join("skills");
        if project_skills_dir.exists() {
            all_skills.extend(scan_skills_directory(
                &project_skills_dir,
                SkillSource::Project,
            ));
        }

        // 2. Project commands: <project>/.claude/commands/*.md
        let project_commands_dir = project.join(".claude").join("commands");
        if project_commands_dir.exists() {
            all_skills.extend(scan_commands_directory(
                &project_commands_dir,
                SkillSource::Project,
            ));
        }

        // Get home directory for personal/plugin locations
        if let Some(base_dirs) = BaseDirs::new() {
            let home = base_dirs.home_dir();
            let claude_dir = home.join(".claude");

            // 3. Personal skills: ~/.claude/skills/*/SKILL.md
            let personal_skills_dir = claude_dir.join("skills");
            if personal_skills_dir.exists() {
                all_skills.extend(scan_skills_directory(
                    &personal_skills_dir,
                    SkillSource::Personal,
                ));
            }

            // 4. Personal commands: ~/.claude/commands/*.md
            let personal_commands_dir = claude_dir.join("commands");
            if personal_commands_dir.exists() {
                all_skills.extend(scan_commands_directory(
                    &personal_commands_dir,
                    SkillSource::Personal,
                ));
            }

            // 5. Installed plugins: ~/.claude/plugins/*/
            let plugins_dir = claude_dir.join("plugins");
            if plugins_dir.exists() {
                // Track which plugin names we've already seen from manual installs
                let mut seen_plugin_names: HashSet<String> = HashSet::new();

                for (plugin, plugin_skills) in scan_plugins_directory(&plugins_dir) {
                    seen_plugin_names.insert(plugin.name.clone());
                    all_plugins.push(plugin);
                    all_skills.extend(plugin_skills);
                }

                // 5b. CLI-installed plugins from installed_plugins.json
                // These live in cache/ subdirectories and aren't found by scan_plugins_directory
                for (cli_id, install_path, version) in parse_installed_plugins_json(&plugins_dir) {
                    let plugin_name = cli_id.split('@').next().unwrap_or(&cli_id);

                    // Skip if already discovered via manual install
                    if seen_plugin_names.contains(plugin_name) {
                        // But update the existing plugin's cli_id if it doesn't have one
                        if let Some(existing) = all_plugins.iter_mut().find(|p| p.name == plugin_name) {
                            if existing.cli_id.is_none() {
                                existing.cli_id = Some(cli_id.clone());
                            }
                        }
                        continue;
                    }

                    if let Some((plugin, plugin_skills)) =
                        scan_cli_installed_plugin(&cli_id, &install_path, &version)
                    {
                        seen_plugin_names.insert(plugin_name.to_string());
                        all_plugins.push(plugin);
                        all_skills.extend(plugin_skills);
                    }
                }
            }
        }

        // 6. Legacy .plugins.json
        let legacy = Self::parse_legacy_plugins_json(project_path);
        all_skills.extend(legacy.skills);
        all_plugins.extend(legacy.plugins);

        // Deduplicate skills (project > personal > plugin > legacy)
        let deduped_skills = deduplicate_skills(all_skills);

        ProjectPlugins {
            skills: deduped_skills,
            plugins: all_plugins,
        }
    }

    /// Gets the plugins/skills for a project, discovering from all sources if not cached.
    pub fn get_project_plugins(&self, project_path: &str) -> ProjectPlugins {
        // Return cached if available
        if let Some(plugins) = self.project_plugins.get(project_path) {
            return plugins.clone();
        }

        // Discover and cache
        let plugins = Self::discover_all(project_path);
        self.project_plugins
            .insert(project_path.to_string(), plugins.clone());
        plugins
    }

    /// Refreshes the cached plugins for a project by re-discovering from all sources.
    pub fn refresh_project_plugins(&self, project_path: &str) -> ProjectPlugins {
        let plugins = Self::discover_all(project_path);
        self.project_plugins
            .insert(project_path.to_string(), plugins.clone());
        plugins
    }

    /// Resolves Maestro internal plugin IDs to Claude CLI `enabledPlugins` map.
    ///
    /// Takes the list of enabled Maestro plugin IDs and returns a HashMap
    /// mapping CLI plugin IDs to their enabled state (true/false).
    /// Only plugins with a `cli_id` are included (standalone/legacy plugins are excluded).
    pub fn resolve_enabled_plugins_map(
        &self,
        project_path: &str,
        enabled_plugin_ids: &[String],
    ) -> HashMap<String, bool> {
        let project_plugins = self.get_project_plugins(project_path);
        let enabled_set: HashSet<&str> = enabled_plugin_ids.iter().map(|s| s.as_str()).collect();

        let mut result = HashMap::new();
        for plugin in &project_plugins.plugins {
            if let Some(cli_id) = &plugin.cli_id {
                let is_enabled = enabled_set.contains(plugin.id.as_str());
                result.insert(cli_id.clone(), is_enabled);
            }
        }

        result
    }

    /// Gets the enabled skill IDs for a session.
    ///
    /// If not explicitly set, returns all available skills as enabled by default.
    pub fn get_session_skills(&self, project_path: &str, session_id: u32) -> Vec<String> {
        let key = (project_path.to_string(), session_id);

        if let Some(enabled) = self.session_enabled_skills.get(&key) {
            return enabled.clone();
        }

        // Default: all skills enabled
        self.get_project_plugins(project_path)
            .skills
            .into_iter()
            .map(|s| s.id)
            .collect()
    }

    /// Sets the enabled skill IDs for a session.
    pub fn set_session_skills(&self, project_path: &str, session_id: u32, enabled: Vec<String>) {
        let key = (project_path.to_string(), session_id);
        self.session_enabled_skills.insert(key, enabled);
    }

    /// Gets the enabled plugin IDs for a session.
    ///
    /// If not explicitly set, returns plugins where enabled_by_default is true.
    pub fn get_session_plugins(&self, project_path: &str, session_id: u32) -> Vec<String> {
        let key = (project_path.to_string(), session_id);

        if let Some(enabled) = self.session_enabled_plugins.get(&key) {
            return enabled.clone();
        }

        // Default: plugins with enabled_by_default = true
        self.get_project_plugins(project_path)
            .plugins
            .into_iter()
            .filter(|p| p.enabled_by_default)
            .map(|p| p.id)
            .collect()
    }

    /// Sets the enabled plugin IDs for a session.
    pub fn set_session_plugins(&self, project_path: &str, session_id: u32, enabled: Vec<String>) {
        let key = (project_path.to_string(), session_id);
        self.session_enabled_plugins.insert(key, enabled);
    }

    /// Removes session state when a session is closed.
    pub fn remove_session(&self, project_path: &str, session_id: u32) {
        let key = (project_path.to_string(), session_id);
        self.session_enabled_skills.remove(&key);
        self.session_enabled_plugins.remove(&key);
    }

    /// Counts enabled skills for a session.
    pub fn get_skills_count(&self, project_path: &str, session_id: u32) -> usize {
        self.get_session_skills(project_path, session_id).len()
    }

    /// Counts enabled plugins for a session.
    pub fn get_plugins_count(&self, project_path: &str, session_id: u32) -> usize {
        self.get_session_plugins(project_path, session_id).len()
    }
}

impl Default for PluginManager {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_empty_project() {
        let manager = PluginManager::new();
        let plugins = manager.get_project_plugins("/nonexistent/path");
        assert!(plugins.skills.iter().all(|skill| {
            !matches!(skill.source, SkillSource::Project | SkillSource::Legacy)
        }));
        assert!(plugins.plugins.iter().all(|plugin| {
            !matches!(plugin.plugin_source, PluginSource::Project)
        }));
    }

    #[test]
    fn test_marketplace_id_to_short() {
        assert_eq!(
            marketplace_id_to_short("official-anthropic-claude-code"),
            "claude-plugins-official"
        );
        assert_eq!(
            marketplace_id_to_short("custom-marketplace"),
            "custom-marketplace"
        );
    }

    #[test]
    fn test_resolve_enabled_plugins_map() {
        let manager = PluginManager::new();

        // Manually insert some test plugins
        let plugins = ProjectPlugins {
            skills: Vec::new(),
            plugins: vec![
                PluginConfig {
                    id: "plugin:frontend-design".to_string(),
                    name: "frontend-design".to_string(),
                    version: "1.0.0".to_string(),
                    description: "Test".to_string(),
                    icon: None,
                    plugin_source: PluginSource::Installed,
                    cli_id: Some("frontend-design@claude-plugins-official".to_string()),
                    skills: Vec::new(),
                    mcp_servers: Vec::new(),
                    hooks: Vec::new(),
                    enabled_by_default: true,
                    path: None,
                },
                PluginConfig {
                    id: "plugin:stripe".to_string(),
                    name: "stripe".to_string(),
                    version: "0.1.0".to_string(),
                    description: "Test".to_string(),
                    icon: None,
                    plugin_source: PluginSource::Installed,
                    cli_id: None, // No CLI ID (manually installed, no marketplace)
                    skills: Vec::new(),
                    mcp_servers: Vec::new(),
                    hooks: Vec::new(),
                    enabled_by_default: true,
                    path: None,
                },
            ],
        };

        manager
            .project_plugins
            .insert("/test/path".to_string(), plugins);

        // Enable only frontend-design
        let enabled = vec!["plugin:frontend-design".to_string()];
        let result = manager.resolve_enabled_plugins_map("/test/path", &enabled);

        // Only plugins with cli_id should be in the result
        assert_eq!(result.len(), 1);
        assert_eq!(
            result.get("frontend-design@claude-plugins-official"),
            Some(&true)
        );
        // stripe has no cli_id, so it's not in the result
        assert!(result.get("stripe").is_none());
    }
}
