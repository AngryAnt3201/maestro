use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::time::SystemTime;

use chrono::{DateTime, Utc};
use directories::BaseDirs;
use serde::Serialize;

#[derive(Debug, Clone, Serialize)]
pub struct ClaudeSessionInfo {
    pub session_id: String,
    pub first_prompt: Option<String>,
    pub started_at: String,
    pub last_active: String,
    pub git_branch: Option<String>,
}

/// System XML tags that indicate a non-user message (should be skipped entirely).
const SYSTEM_TAGS: &[&str] = &[
    "<local-command-caveat>",
    "<bash-input>",
    "<bash-stdout>",
    "<bash-stderr>",
    "<local-command-stdout>",
    "<local-command-stderr>",
];

/// Checks if a user message is a system-generated message (not a real user prompt).
fn is_system_message(content: &str) -> bool {
    let trimmed = content.trim();
    SYSTEM_TAGS.iter().any(|tag| trimmed.starts_with(tag))
}

/// Extracts readable prompt text from a user message.
/// - Slash commands: extracts `<command-args>` content, or the command name
/// - System messages: returns empty (caller should skip and try next message)
/// - Plain text: returns as-is
fn extract_prompt_text(content: &str) -> String {
    // Try to extract <command-args>...</command-args>
    if let Some(start) = content.find("<command-args>") {
        let after = &content[start + 14..]; // len("<command-args>") == 14
        if let Some(end) = after.find("</command-args>") {
            let args = after[..end].trim();
            if !args.is_empty() {
                return args.to_string();
            }
        }
    }

    // Extract slash command name (e.g., "/review-pr") from <command-name>
    if let Some(start) = content.find("<command-name>") {
        let after = &content[start + 14..]; // len("<command-name>") == 14
        if let Some(end) = after.find("</command-name>") {
            let cmd = after[..end].trim();
            if !cmd.is_empty() {
                return cmd.to_string();
            }
        }
    }

    // If content doesn't contain XML tags, return as-is
    if !content.contains('<') || !content.contains('>') {
        return content.trim().to_string();
    }

    // Strip XML tags and return the text content
    let stripped: String = {
        let mut result = String::with_capacity(content.len());
        let mut in_tag = false;
        for ch in content.chars() {
            if ch == '<' {
                in_tag = true;
            } else if ch == '>' {
                in_tag = false;
            } else if !in_tag {
                result.push(ch);
            }
        }
        result
    };
    let trimmed = stripped.trim().to_string();
    if !trimmed.is_empty() {
        return trimmed;
    }

    content.trim().to_string()
}

/// Converts a project path to Claude's session directory format.
/// Claude stores sessions at `~/.claude/projects/<path-with-slashes-replaced-by-dashes>/`.
fn project_path_to_claude_dir(project_path: &str) -> Option<PathBuf> {
    let base_dirs = BaseDirs::new()?;
    let home = base_dirs.home_dir();
    // Claude uses the absolute path with `/` replaced by `-`
    let dir_name = project_path.replace('/', "-");
    Some(home.join(".claude").join("projects").join(dir_name))
}

/// Parses session info from a JSONL transcript file.
/// Reads up to 200 lines to find metadata and the first real user prompt.
fn parse_session_file(path: &PathBuf) -> Option<ClaudeSessionInfo> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut session_id: Option<String> = None;
    let mut git_branch: Option<String> = None;
    let mut started_at: Option<String> = None;
    let mut first_prompt: Option<String> = None;

    for (i, line) in reader.lines().enumerate() {
        if i >= 200 {
            break;
        }
        let line = match line {
            Ok(l) => l,
            Err(_) => continue,
        };
        if line.is_empty() {
            continue;
        }

        let val: serde_json::Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        // Extract sessionId and gitBranch from the first entry
        if session_id.is_none() {
            if let Some(sid) = val.get("sessionId").and_then(|v| v.as_str()) {
                session_id = Some(sid.to_string());
            }
        }
        if git_branch.is_none() {
            if let Some(branch) = val.get("gitBranch").and_then(|v| v.as_str()) {
                git_branch = Some(branch.to_string());
            }
        }
        if started_at.is_none() {
            if let Some(ts) = val.get("timestamp").and_then(|v| v.as_str()) {
                started_at = Some(ts.to_string());
            }
        }

        // Look for the first real user message (skip system-generated messages)
        if first_prompt.is_none() {
            if let Some("user") = val.get("type").and_then(|v| v.as_str()) {
                let raw = val
                    .get("message")
                    .and_then(|m| m.get("content"))
                    .and_then(|c| {
                        // content can be a string or an array of content blocks
                        if let Some(s) = c.as_str() {
                            Some(s.to_string())
                        } else if let Some(arr) = c.as_array() {
                            arr.iter().find_map(|block| {
                                if block.get("type").and_then(|t| t.as_str()) == Some("text") {
                                    block.get("text").and_then(|t| t.as_str()).map(|s| s.to_string())
                                } else {
                                    None
                                }
                            })
                        } else {
                            None
                        }
                    });

                if let Some(content) = raw {
                    // Skip system-generated messages (caveats, bash I/O, etc.)
                    if is_system_message(&content) {
                        continue;
                    }
                    let clean = extract_prompt_text(&content);
                    if !clean.is_empty() {
                        let truncated = if clean.chars().count() > 200 {
                            let s: String = clean.chars().take(200).collect();
                            format!("{}...", s)
                        } else {
                            clean
                        };
                        first_prompt = Some(truncated);
                    }
                }
            }
        }

        // Stop early if we have everything
        if session_id.is_some() && first_prompt.is_some() {
            break;
        }
    }

    let session_id = session_id?;

    // Get file modification time for last_active
    let metadata = fs::metadata(path).ok()?;
    let mtime = metadata.modified().ok().unwrap_or(SystemTime::UNIX_EPOCH);
    let last_active: DateTime<Utc> = mtime.into();

    Some(ClaudeSessionInfo {
        session_id,
        first_prompt,
        started_at: started_at.unwrap_or_default(),
        last_active: last_active.to_rfc3339(),
        git_branch,
    })
}

/// Validates that a session ID is a valid UUID (hex + dashes, 36 chars).
fn is_valid_session_id(id: &str) -> bool {
    id.len() == 36
        && id
            .chars()
            .all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// Deletes a Claude Code session's JSONL transcript and optional snapshot directory.
#[tauri::command]
pub async fn delete_claude_session(project_path: String, session_id: String) -> Result<(), String> {
    if !is_valid_session_id(&session_id) {
        return Err("Invalid session ID format".to_string());
    }

    let canonical = fs::canonicalize(&project_path)
        .unwrap_or_else(|_| PathBuf::from(&project_path))
        .to_string_lossy()
        .into_owned();

    let claude_dir = project_path_to_claude_dir(&canonical)
        .ok_or_else(|| "Could not determine home directory".to_string())?;

    // Delete the JSONL transcript
    let jsonl_path = claude_dir.join(format!("{}.jsonl", session_id));
    if jsonl_path.exists() {
        fs::remove_file(&jsonl_path)
            .map_err(|e| format!("Failed to delete session file: {}", e))?;
    }

    // Delete the optional snapshot directory (same name without extension)
    let snapshot_dir = claude_dir.join(&session_id);
    if snapshot_dir.is_dir() {
        fs::remove_dir_all(&snapshot_dir)
            .map_err(|e| format!("Failed to delete session snapshot directory: {}", e))?;
    }

    Ok(())
}

/// Lists previous Claude Code sessions for a given project path.
/// Reads session data from Claude's native storage at `~/.claude/projects/`.
#[tauri::command]
pub async fn list_claude_sessions(project_path: String) -> Result<Vec<ClaudeSessionInfo>, String> {
    // Canonicalize the project path for consistent matching
    let canonical = fs::canonicalize(&project_path)
        .unwrap_or_else(|_| PathBuf::from(&project_path))
        .to_string_lossy()
        .into_owned();

    let claude_dir = project_path_to_claude_dir(&canonical)
        .ok_or_else(|| "Could not determine home directory".to_string())?;

    if !claude_dir.exists() {
        return Ok(Vec::new());
    }

    let entries = fs::read_dir(&claude_dir).map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut sessions: Vec<ClaudeSessionInfo> = entries
        .filter_map(|entry| {
            let entry = entry.ok()?;
            let path = entry.path();
            if path.extension().and_then(|e| e.to_str()) == Some("jsonl") {
                parse_session_file(&path)
            } else {
                None
            }
        })
        .collect();

    // Sort by last_active descending (most recent first)
    sessions.sort_by(|a, b| b.last_active.cmp(&a.last_active));

    // Cap at 50 entries
    sessions.truncate(50);

    Ok(sessions)
}
