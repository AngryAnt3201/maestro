//! Writes Claude Code hooks configuration into `.claude/settings.local.json`.
//!
//! This module handles generating and writing hook configuration that tells
//! Claude Code to POST hook events (SessionStart, SessionEnd, PreToolUse, Stop)
//! back to Maestro's HTTP status server via curl commands.

use std::path::Path;

use serde_json::{json, Value};

use super::path_security::canonical_existing_dir;

/// Builds the hooks configuration JSON for a session.
///
/// Generates hook entries for SessionStart, SessionEnd, PreToolUse, and Stop.
/// Each hook uses curl to POST event data back to Maestro's HTTP server.
///
/// Note: PreToolUse is marked `"async": true` (fire-and-forget) so it doesn't
/// block Claude Code. The other hooks do NOT have the async flag.
fn build_hooks_config(session_id: u32, status_port: u16, instance_id: &str) -> Value {
    let base_url = format!("http://127.0.0.1:{}", status_port);
    let common_headers = format!(
        "-H 'Content-Type: application/json' -H 'X-Maestro-Session: {}' -H 'X-Maestro-Instance: {}'",
        session_id, instance_id
    );

    let make_hook = |endpoint: &str, is_async: bool| -> Value {
        let command = format!(
            "curl -s -X POST {}/{} {} -d @/dev/stdin",
            base_url, endpoint, common_headers
        );

        let mut hook = json!({
            "type": "command",
            "command": command,
        });

        if is_async {
            hook["async"] = json!(true);
        }

        json!([{ "hooks": [hook] }])
    };

    json!({
        "SessionStart": make_hook("hook/session-start", false),
        "SessionEnd": make_hook("hook/session-end", false),
        "PreToolUse": make_hook("hook/pre-tool", true),
        "Stop": make_hook("hook/stop", false),
    })
}

/// Writes session hooks configuration to `.claude/settings.local.json`.
///
/// This function:
/// 1. Creates the `.claude/` directory if it doesn't exist
/// 2. Reads existing `.claude/settings.local.json` or starts with `{}`
/// 3. Builds hooks config with `build_hooks_config()`
/// 4. Sets `config["hooks"]` to the generated hooks
/// 5. Writes back with `serde_json::to_string_pretty`
///
/// Other keys in settings.local.json (e.g. `enabledPlugins`) are preserved.
///
/// # Arguments
///
/// * `working_dir` - Directory where `.claude/settings.local.json` will be written
/// * `session_id` - Session identifier for the hook curl headers
/// * `status_port` - Port of the Maestro HTTP status server
/// * `instance_id` - UUID for this Maestro instance
pub async fn write_session_hooks_config(
    working_dir: &Path,
    session_id: u32,
    status_port: u16,
    instance_id: &str,
) -> Result<(), String> {
    let working_dir = canonical_existing_dir(working_dir, "working directory")?;

    // Create .claude directory if needed
    let claude_dir = working_dir.join(".claude");
    if !claude_dir.exists() {
        tokio::fs::create_dir_all(&claude_dir)
            .await
            .map_err(|e| format!("Failed to create .claude directory: {}", e))?;
    }

    // Read existing settings or start fresh
    let settings_path = claude_dir.join("settings.local.json");
    let mut config: Value = if settings_path.exists() {
        let content = tokio::fs::read_to_string(&settings_path)
            .await
            .map_err(|e| format!("Failed to read settings.local.json: {}", e))?;

        serde_json::from_str(&content)
            .map_err(|e| format!("Failed to parse settings.local.json: {}", e))?
    } else {
        json!({})
    };

    // Build and set hooks config
    let hooks = build_hooks_config(session_id, status_port, instance_id);
    config["hooks"] = hooks;

    // Write back
    let content = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize hooks config: {}", e))?;

    tokio::fs::write(&settings_path, content)
        .await
        .map_err(|e| format!("Failed to write settings.local.json: {}", e))?;

    log::debug!(
        "Wrote session {} hooks config to {:?} (port={}, instance={})",
        session_id,
        settings_path,
        status_port,
        instance_id,
    );

    Ok(())
}

/// Removes session hooks configuration from `.claude/settings.local.json`.
///
/// Removes the `"hooks"` key while preserving other settings in the file.
/// No-op if the file doesn't exist.
///
/// # Arguments
///
/// * `working_dir` - Directory containing the `.claude/settings.local.json` file
pub async fn remove_session_hooks_config(working_dir: &Path) -> Result<(), String> {
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

    // Remove the hooks key
    if let Some(obj) = config.as_object_mut() {
        if obj.remove("hooks").is_some() {
            log::debug!("Removed hooks config from {:?}", settings_path);
        }
    }

    // Write back the updated config
    let output = serde_json::to_string_pretty(&config)
        .map_err(|e| format!("Failed to serialize config: {}", e))?;

    tokio::fs::write(&settings_path, output)
        .await
        .map_err(|e| format!("Failed to write settings.local.json: {}", e))?;

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::tempdir;

    #[tokio::test]
    async fn test_write_hooks_config_fresh() {
        let dir = tempdir().unwrap();

        let result = write_session_hooks_config(dir.path(), 3, 9900, "test-instance-abc").await;
        assert!(
            result.is_ok(),
            "write_session_hooks_config failed: {:?}",
            result.err()
        );

        // Verify the file exists
        let settings_path = dir.path().join(".claude/settings.local.json");
        assert!(settings_path.exists(), "settings.local.json should exist");

        // Parse and verify hooks content
        let content = std::fs::read_to_string(&settings_path).unwrap();
        let config: Value = serde_json::from_str(&content).unwrap();

        assert!(config.get("hooks").is_some(), "hooks key should exist");

        // Verify SessionStart curl has correct port and session_id
        let session_start = &config["hooks"]["SessionStart"];
        let command = session_start[0]["hooks"][0]["command"].as_str().unwrap();
        assert!(
            command.contains("127.0.0.1:9900"),
            "SessionStart command should contain port 9900, got: {}",
            command
        );
        assert!(
            command.contains("X-Maestro-Session: 3"),
            "SessionStart command should contain session_id 3, got: {}",
            command
        );
        assert!(
            command.contains("X-Maestro-Instance: test-instance-abc"),
            "SessionStart command should contain instance_id, got: {}",
            command
        );
        assert!(
            command.contains("hook/session-start"),
            "SessionStart command should target /hook/session-start, got: {}",
            command
        );
    }

    #[tokio::test]
    async fn test_write_hooks_preserves_existing() {
        let dir = tempdir().unwrap();
        let claude_dir = dir.path().join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();

        // Write pre-existing config with enabledPlugins
        let existing = json!({
            "enabledPlugins": {
                "some-plugin@official": true
            }
        });
        std::fs::write(
            claude_dir.join("settings.local.json"),
            serde_json::to_string_pretty(&existing).unwrap(),
        )
        .unwrap();

        // Write hooks config
        write_session_hooks_config(dir.path(), 1, 8080, "inst-xyz")
            .await
            .unwrap();

        // Read back and verify both keys exist
        let content = std::fs::read_to_string(claude_dir.join("settings.local.json")).unwrap();
        let config: Value = serde_json::from_str(&content).unwrap();

        // enabledPlugins should be preserved
        assert!(
            config.get("enabledPlugins").is_some(),
            "enabledPlugins should be preserved"
        );
        let plugins = config["enabledPlugins"].as_object().unwrap();
        assert_eq!(plugins["some-plugin@official"], true);

        // hooks should also be present
        assert!(config.get("hooks").is_some(), "hooks key should exist");
        assert!(
            config["hooks"].get("SessionStart").is_some(),
            "SessionStart hook should exist"
        );
    }

    #[tokio::test]
    async fn test_remove_hooks_config() {
        let dir = tempdir().unwrap();
        let claude_dir = dir.path().join(".claude");
        std::fs::create_dir_all(&claude_dir).unwrap();

        // Write a config with hooks + other keys
        let existing = json!({
            "someOtherSetting": "keep-me",
            "hooks": {
                "SessionStart": [{"hooks": [{"type": "command", "command": "curl ..."}]}]
            }
        });
        std::fs::write(
            claude_dir.join("settings.local.json"),
            serde_json::to_string_pretty(&existing).unwrap(),
        )
        .unwrap();

        // Remove hooks
        remove_session_hooks_config(dir.path()).await.unwrap();

        // Read back and verify
        let content = std::fs::read_to_string(claude_dir.join("settings.local.json")).unwrap();
        let config: Value = serde_json::from_str(&content).unwrap();

        // hooks should be gone
        assert!(config.get("hooks").is_none(), "hooks key should be removed");

        // other settings should be preserved
        assert_eq!(
            config["someOtherSetting"], "keep-me",
            "other settings should be preserved"
        );
    }

    #[tokio::test]
    async fn test_async_flag_on_pre_tool_use() {
        let hooks = build_hooks_config(5, 7777, "instance-123");

        // PreToolUse should have "async": true
        let pre_tool_hook = &hooks["PreToolUse"][0]["hooks"][0];
        assert_eq!(
            pre_tool_hook["async"],
            json!(true),
            "PreToolUse should have async: true"
        );

        // SessionStart should NOT have "async"
        let session_start_hook = &hooks["SessionStart"][0]["hooks"][0];
        assert!(
            session_start_hook.get("async").is_none() || session_start_hook["async"].is_null(),
            "SessionStart should NOT have async flag, got: {:?}",
            session_start_hook.get("async")
        );

        // SessionEnd should NOT have "async"
        let session_end_hook = &hooks["SessionEnd"][0]["hooks"][0];
        assert!(
            session_end_hook.get("async").is_none() || session_end_hook["async"].is_null(),
            "SessionEnd should NOT have async flag"
        );

        // Stop should NOT have "async"
        let stop_hook = &hooks["Stop"][0]["hooks"][0];
        assert!(
            stop_hook.get("async").is_none() || stop_hook["async"].is_null(),
            "Stop should NOT have async flag"
        );
    }

    #[tokio::test]
    async fn test_remove_handles_missing_file() {
        let dir = tempdir().unwrap();
        // No .claude directory or settings file exists
        let result = remove_session_hooks_config(dir.path()).await;
        assert!(result.is_ok(), "remove should be a no-op for missing file");
    }
}
