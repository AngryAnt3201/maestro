//! Writes session-specific plugin configuration for Claude CLI.
//!
//! This module handles writing `enabledPlugins` to the session's
//! `.claude/settings.local.json` file so Claude CLI knows which plugins
//! to enable or disable. The format matches Claude CLI's native format:
//! ```json
//! {
//!   "enabledPlugins": {
//!     "plugin-name@marketplace": true,
//!     "other-plugin@marketplace": false
//!   }
//! }
//! ```

use std::collections::HashMap;
use std::path::Path;

use serde_json::{json, Value};

use super::path_security::canonical_existing_dir;

/// Merges `enabledPlugins` into an existing settings.local.json file.
///
/// Preserves user-defined settings while replacing the `enabledPlugins` object.
/// Also removes the legacy `plugins` array if present.
fn merge_with_existing(
    settings_path: &Path,
    enabled_plugins: &HashMap<String, bool>,
) -> Result<Value, String> {
    let mut config: Value = if settings_path.exists() {
        let content = std::fs::read_to_string(settings_path)
            .map_err(|e| format!("Failed to read existing settings.local.json: {}", e))?;

        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse existing settings.local.json: {}", e))?
    } else {
        json!({})
    };

    // Remove legacy plugins array if present
    if let Some(obj) = config.as_object_mut() {
        obj.remove("plugins");
    }

    // Build the enabledPlugins object
    let plugins_obj: serde_json::Map<String, Value> = enabled_plugins
        .iter()
        .map(|(id, enabled)| (id.clone(), json!(*enabled)))
        .collect();

    config["enabledPlugins"] = Value::Object(plugins_obj);

    Ok(config)
}

/// Writes plugin enabled/disabled state to the session's .claude/settings.local.json.
///
/// This function:
/// 1. Creates the .claude directory if it doesn't exist
/// 2. Builds the `enabledPlugins` object from the provided map
/// 3. Merges with any existing settings.local.json (preserving other settings)
/// 4. Writes the final config
///
/// # Arguments
///
/// * `working_dir` - Directory where `.claude/settings.local.json` will be written
/// * `enabled_plugins` - Map of CLI plugin IDs to enabled state (e.g. "name@marketplace" -> true/false)
pub async fn write_session_plugin_config(
    working_dir: &Path,
    enabled_plugins: &HashMap<String, bool>,
) -> Result<(), String> {
    let working_dir = canonical_existing_dir(working_dir, "working directory")?;

    // Create .claude directory if needed
    let claude_dir = working_dir.join(".claude");
    if !claude_dir.exists() {
        tokio::fs::create_dir_all(&claude_dir)
            .await
            .map_err(|e| format!("Failed to create .claude directory: {}", e))?;
    }

    // Merge with existing settings
    let settings_path = claude_dir.join("settings.local.json");
    let final_config = merge_with_existing(&settings_path, enabled_plugins)?;

    // Write the file
    let content = serde_json::to_string_pretty(&final_config)
        .map_err(|e| format!("Failed to serialize plugin config: {}", e))?;

    tokio::fs::write(&settings_path, content)
        .await
        .map_err(|e| format!("Failed to write settings.local.json: {}", e))?;

    let enabled_count = enabled_plugins.values().filter(|v| **v).count();
    let disabled_count = enabled_plugins.len() - enabled_count;
    log::debug!(
        "Wrote session plugin config to {:?} ({} enabled, {} disabled)",
        settings_path,
        enabled_count,
        disabled_count,
    );

    Ok(())
}

/// Removes session plugin config from the session's .claude/settings.local.json.
///
/// Removes both `enabledPlugins` (current format) and legacy `plugins` array.
/// Preserves other settings in the file. Deletes the file if it becomes empty.
///
/// # Arguments
///
/// * `working_dir` - Directory containing the `.claude/settings.local.json` file
pub async fn remove_session_plugin_config(working_dir: &Path) -> Result<(), String> {
    let working_dir = canonical_existing_dir(working_dir, "working directory")?;
    let settings_path = working_dir.join(".claude/settings.local.json");
    if !settings_path.exists() {
        return Ok(());
    }

    let content = tokio::fs::read_to_string(&settings_path)
        .await
        .map_err(|e| format!("Failed to read settings.local.json: {}", e))?;

    let mut config: Value = serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse settings.local.json: {}", e))?;

    // Remove both enabledPlugins and legacy plugins array
    if let Some(obj) = config.as_object_mut() {
        let removed_enabled = obj.remove("enabledPlugins").is_some();
        let removed_legacy = obj.remove("plugins").is_some();
        if removed_enabled || removed_legacy {
            log::debug!("Removed plugin config from {:?}", settings_path);
        }
    }

    // If the config is now empty, delete the file
    if config.as_object().map(|o| o.is_empty()).unwrap_or(false) {
        tokio::fs::remove_file(&settings_path)
            .await
            .map_err(|e| format!("Failed to delete empty settings.local.json: {}", e))?;
        log::debug!("Deleted empty settings.local.json at {:?}", settings_path);
    } else {
        // Otherwise, write the updated config
        let output = serde_json::to_string_pretty(&config)
            .map_err(|e| format!("Failed to serialize config: {}", e))?;

        tokio::fs::write(&settings_path, output)
            .await
            .map_err(|e| format!("Failed to write settings.local.json: {}", e))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_write_session_plugin_config_creates_directory_and_file() {
        let dir = tempdir().unwrap();
        let mut plugins = HashMap::new();
        plugins.insert("plugin-a@official".to_string(), true);
        plugins.insert("plugin-b@official".to_string(), false);

        let result = write_session_plugin_config(dir.path(), &plugins).await;
        assert!(result.is_ok());

        let settings_path = dir.path().join(".claude/settings.local.json");
        assert!(settings_path.exists());

        let content = std::fs::read_to_string(&settings_path).unwrap();
        let config: Value = serde_json::from_str(&content).unwrap();

        let enabled_plugins = config["enabledPlugins"].as_object().unwrap();
        assert_eq!(enabled_plugins.len(), 2);
        assert_eq!(enabled_plugins["plugin-a@official"], true);
        assert_eq!(enabled_plugins["plugin-b@official"], false);
    }

    #[tokio::test]
    async fn test_write_preserves_other_settings_and_removes_legacy() {
        let dir = tempdir().unwrap();
        let claude_dir = dir.path().join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();

        // Write existing settings with legacy plugins array
        let existing = json!({
            "someOtherSetting": "value",
            "plugins": [
                {"path": "/old/plugin", "enabled": false}
            ]
        });
        std::fs::write(
            claude_dir.join("settings.local.json"),
            serde_json::to_string(&existing).unwrap(),
        )
        .unwrap();

        // Write new enabledPlugins
        let mut plugins = HashMap::new();
        plugins.insert("new-plugin@official".to_string(), true);
        write_session_plugin_config(dir.path(), &plugins)
            .await
            .unwrap();

        let content = std::fs::read_to_string(claude_dir.join("settings.local.json")).unwrap();
        let config: Value = serde_json::from_str(&content).unwrap();

        // Other settings should be preserved
        assert_eq!(config["someOtherSetting"], "value");

        // Legacy plugins array should be removed
        assert!(config.get("plugins").is_none());

        // enabledPlugins should be set
        let enabled_plugins = config["enabledPlugins"].as_object().unwrap();
        assert_eq!(enabled_plugins.len(), 1);
        assert_eq!(enabled_plugins["new-plugin@official"], true);
    }

    #[tokio::test]
    async fn test_remove_session_plugin_config() {
        let dir = tempdir().unwrap();
        let claude_dir = dir.path().join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();

        // Write settings with enabledPlugins and other settings
        let existing = json!({
            "someOtherSetting": "value",
            "enabledPlugins": {
                "test-plugin@official": true
            }
        });
        std::fs::write(
            claude_dir.join("settings.local.json"),
            serde_json::to_string(&existing).unwrap(),
        )
        .unwrap();

        remove_session_plugin_config(dir.path()).await.unwrap();

        let content = std::fs::read_to_string(claude_dir.join("settings.local.json")).unwrap();
        let config: Value = serde_json::from_str(&content).unwrap();

        // enabledPlugins should be removed
        assert!(config.get("enabledPlugins").is_none());
        // Other settings should be preserved
        assert_eq!(config["someOtherSetting"], "value");
    }

    #[tokio::test]
    async fn test_remove_cleans_up_legacy_plugins_too() {
        let dir = tempdir().unwrap();
        let claude_dir = dir.path().join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();

        // Write settings with both enabledPlugins and legacy plugins
        let existing = json!({
            "someOtherSetting": "value",
            "enabledPlugins": { "test@official": true },
            "plugins": [{"path": "/old", "enabled": true}]
        });
        std::fs::write(
            claude_dir.join("settings.local.json"),
            serde_json::to_string(&existing).unwrap(),
        )
        .unwrap();

        remove_session_plugin_config(dir.path()).await.unwrap();

        let content = std::fs::read_to_string(claude_dir.join("settings.local.json")).unwrap();
        let config: Value = serde_json::from_str(&content).unwrap();

        assert!(config.get("enabledPlugins").is_none());
        assert!(config.get("plugins").is_none());
        assert_eq!(config["someOtherSetting"], "value");
    }

    #[tokio::test]
    async fn test_remove_deletes_empty_file() {
        let dir = tempdir().unwrap();
        let claude_dir = dir.path().join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();

        // Write settings with only enabledPlugins
        let existing = json!({
            "enabledPlugins": {
                "test-plugin@official": true
            }
        });
        std::fs::write(
            claude_dir.join("settings.local.json"),
            serde_json::to_string(&existing).unwrap(),
        )
        .unwrap();

        remove_session_plugin_config(dir.path()).await.unwrap();

        // File should be deleted since it would be empty
        assert!(!claude_dir.join("settings.local.json").exists());
    }

    #[tokio::test]
    async fn test_remove_handles_missing_file() {
        let dir = tempdir().unwrap();
        // No .claude directory or settings file exists
        let result = remove_session_plugin_config(dir.path()).await;
        assert!(result.is_ok());
    }
}
