use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use chrono::{DateTime, Utc};
use directories::BaseDirs;
use serde::Serialize;

/// Maximum number of JSONL lines scanned per session file to locate metadata and
/// the first user prompt. Sessions put sessionId/gitBranch on line 1 and the
/// first user message usually within the first few lines; 80 is a conservative
/// upper bound that tolerates heavy caveat preambles without reading the whole
/// transcript.
const MAX_LINES_SCANNED: usize = 80;

/// Maximum sessions returned from [`list_claude_sessions`]. The picker in the UI
/// surfaces the most recent sessions; a user with more than this is almost
/// certainly better served by searching rather than scrolling.
const MAX_SESSIONS_RETURNED: usize = 50;

/// Maximum characters kept from a first-prompt preview. Enough to distinguish
/// sessions in the picker without overflowing the card.
const MAX_PROMPT_CHARS: usize = 200;

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

/// Encodes a filesystem path into Claude Code's projects-directory naming scheme.
///
/// Empirically, Claude Code replaces every character that isn't ASCII alphanumeric,
/// `_`, or `-` with a `-`. That means `/`, `.`, and space all map to `-`, and a
/// dotfile like `/Users/alice/.config` becomes `-Users-alice--config` (the slash
/// *and* the dot each become a dash, producing `--`).
///
/// An earlier version only replaced `/`, which silently returned an empty list
/// for any path containing a dot — e.g. hidden directories or extensions.
fn encode_project_path(project_path: &str) -> String {
    project_path
        .chars()
        .map(|c| {
            if c.is_ascii_alphanumeric() || c == '_' || c == '-' {
                c
            } else {
                '-'
            }
        })
        .collect()
}

/// Converts a project path to Claude's session directory
/// `~/.claude/projects/<encoded-path>/`.
fn project_path_to_claude_dir(project_path: &str) -> Option<PathBuf> {
    let base_dirs = BaseDirs::new()?;
    let home = base_dirs.home_dir();
    Some(
        home.join(".claude")
            .join("projects")
            .join(encode_project_path(project_path)),
    )
}

/// Truncates `s` to at most `max_chars` characters. If the input is longer it
/// is cut on a character boundary and `"..."` is appended.
///
/// This exists because `&s[..n]` slices by *bytes*, and a byte index that falls
/// mid-codepoint panics at runtime. The previous implementation would crash
/// whenever a prompt preview's byte 200 fell inside a multibyte character.
fn truncate_chars(s: &str, max_chars: usize) -> String {
    if s.chars().count() <= max_chars {
        return s.to_string();
    }
    let truncated: String = s.chars().take(max_chars).collect();
    format!("{truncated}...")
}

/// Validates that a session_id looks like a UUID-style identifier and can't be
/// used for path traversal when joined into `~/.claude/projects/<dir>/`.
///
/// Real session ids are UUIDv4s (`01234567-89ab-...`); anything containing a
/// path separator or `..` is rejected.
fn is_safe_session_id(session_id: &str) -> bool {
    if session_id.is_empty() {
        return false;
    }
    if session_id.contains('/') || session_id.contains('\\') || session_id.contains("..") {
        return false;
    }
    // Every character must be hex digit or dash. Cheap upper bound on UUID shape.
    session_id
        .chars()
        .all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// Parses session info from a JSONL transcript file.
fn parse_session_file(path: &Path) -> Option<ClaudeSessionInfo> {
    let file = fs::File::open(path).ok()?;
    let reader = BufReader::new(file);

    let mut session_id: Option<String> = None;
    let mut git_branch: Option<String> = None;
    let mut started_at: Option<String> = None;
    let mut first_prompt: Option<String> = None;

    for (i, line) in reader.lines().enumerate() {
        if i >= MAX_LINES_SCANNED {
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
                                    block
                                        .get("text")
                                        .and_then(|t| t.as_str())
                                        .map(|s| s.to_string())
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
                        first_prompt = Some(truncate_chars(&clean, MAX_PROMPT_CHARS));
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

/// Deletes a Claude Code session's JSONL transcript and optional snapshot directory.
#[tauri::command]
pub async fn delete_claude_session(
    project_path: String,
    session_id: String,
) -> Result<(), String> {
    if !is_safe_session_id(&session_id) {
        return Err(format!("Invalid session id: {session_id}"));
    }

    let canonical = fs::canonicalize(&project_path)
        .unwrap_or_else(|_| PathBuf::from(&project_path))
        .to_string_lossy()
        .into_owned();

    let claude_dir = project_path_to_claude_dir(&canonical)
        .ok_or_else(|| "Could not determine home directory".to_string())?;

    // Delete the JSONL transcript
    let jsonl_path = claude_dir.join(format!("{session_id}.jsonl"));
    if jsonl_path.exists() {
        fs::remove_file(&jsonl_path)
            .map_err(|e| format!("Failed to delete session file: {e}"))?;
    }

    // Delete the optional snapshot directory (same name without extension)
    let snapshot_dir = claude_dir.join(&session_id);
    if snapshot_dir.is_dir() {
        fs::remove_dir_all(&snapshot_dir)
            .map_err(|e| format!("Failed to delete session snapshot directory: {e}"))?;
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

    let entries =
        fs::read_dir(&claude_dir).map_err(|e| format!("Failed to read directory: {e}"))?;

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

    sessions.truncate(MAX_SESSIONS_RETURNED);

    Ok(sessions)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ---- encode_project_path ---------------------------------------------

    #[test]
    fn encodes_slashes_to_dashes() {
        assert_eq!(
            encode_project_path("/Users/alice/project"),
            "-Users-alice-project"
        );
    }

    #[test]
    fn encodes_dotdirs_as_double_dashes() {
        // matches empirical Claude Code behavior where /. -> --
        assert_eq!(
            encode_project_path("/Users/alice/.claude-maestro"),
            "-Users-alice--claude-maestro"
        );
    }

    #[test]
    fn encodes_spaces_to_dashes() {
        assert_eq!(
            encode_project_path("/Users/alice/Maestro Projects/app"),
            "-Users-alice-Maestro-Projects-app"
        );
    }

    #[test]
    fn encodes_double_space_as_double_dash() {
        assert_eq!(
            encode_project_path("/Users/alice/Boilerplates - Starters"),
            "-Users-alice-Boilerplates---Starters"
        );
    }

    #[test]
    fn encode_preserves_existing_dashes_and_underscores() {
        assert_eq!(
            encode_project_path("/a-b_c/d_e-f"),
            "-a-b_c-d_e-f"
        );
    }

    // ---- extract_prompt_text ---------------------------------------------

    #[test]
    fn extract_returns_plain_text_as_is() {
        assert_eq!(extract_prompt_text("hello world"), "hello world");
    }

    #[test]
    fn extract_prefers_command_args() {
        let content = "<command-name>/review-pr</command-name><command-args>222</command-args>";
        assert_eq!(extract_prompt_text(content), "222");
    }

    #[test]
    fn extract_falls_back_to_command_name_when_args_empty() {
        let content = "<command-name>/review-pr</command-name><command-args></command-args>";
        assert_eq!(extract_prompt_text(content), "/review-pr");
    }

    #[test]
    fn extract_strips_generic_xml_tags_preserving_inner_text() {
        // The stripper is intentionally naive: it removes `<...>` but keeps
        // whatever was between the tags.
        let content = "<ctx>irrelevant</ctx>real prompt";
        assert_eq!(extract_prompt_text(content), "irrelevantreal prompt");
    }

    // ---- is_system_message -----------------------------------------------

    #[test]
    fn detects_local_command_caveat_as_system() {
        assert!(is_system_message(
            "<local-command-caveat>skip me</local-command-caveat>"
        ));
    }

    #[test]
    fn detects_bash_stdout_as_system() {
        assert!(is_system_message("<bash-stdout>output</bash-stdout>"));
    }

    #[test]
    fn plain_text_is_not_system() {
        assert!(!is_system_message("hello"));
    }

    // ---- truncate_chars (the UTF-8 panic fix) ----------------------------

    #[test]
    fn truncate_shorter_than_max_is_unchanged() {
        assert_eq!(truncate_chars("short", 200), "short");
    }

    #[test]
    fn truncate_on_ascii_appends_ellipsis() {
        let s = "a".repeat(250);
        let out = truncate_chars(&s, 200);
        assert_eq!(out.chars().count(), 203); // 200 + "..."
        assert!(out.ends_with("..."));
    }

    #[test]
    fn truncate_handles_multibyte_without_panic() {
        // "🦀" is 4 bytes; byte 200 falls mid-character.
        // The previous `&s[..200]` would panic. This must not.
        let long = "🦀".repeat(300);
        let out = truncate_chars(&long, 200);
        assert!(out.ends_with("..."));
        // 200 crabs + 3 dots
        assert_eq!(out.chars().count(), 203);
    }

    // ---- is_safe_session_id ----------------------------------------------

    #[test]
    fn safe_uuid_is_accepted() {
        assert!(is_safe_session_id("01234567-89ab-cdef-0123-456789abcdef"));
    }

    #[test]
    fn traversal_and_separators_rejected() {
        assert!(!is_safe_session_id(""));
        assert!(!is_safe_session_id("../etc/passwd"));
        assert!(!is_safe_session_id("foo/bar"));
        assert!(!is_safe_session_id("foo\\bar"));
        assert!(!is_safe_session_id(".."));
    }

    #[test]
    fn non_hex_chars_rejected() {
        assert!(!is_safe_session_id("not-a-real-uuid-zzz"));
    }

    // ---- parse_session_file ----------------------------------------------

    #[test]
    fn parse_reads_basic_session() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("abc.jsonl");
        let jsonl = r#"{"sessionId":"abc","gitBranch":"main","timestamp":"2024-01-01T00:00:00Z","type":"user","message":{"content":"hello"}}"#;
        fs::write(&path, jsonl).unwrap();
        let info = parse_session_file(&path).expect("parsed");
        assert_eq!(info.session_id, "abc");
        assert_eq!(info.first_prompt.as_deref(), Some("hello"));
        assert_eq!(info.git_branch.as_deref(), Some("main"));
    }

    #[test]
    fn parse_skips_system_messages_and_uses_next_user_line() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("abc.jsonl");
        let jsonl = "\
{\"sessionId\":\"abc\",\"type\":\"user\",\"message\":{\"content\":\"<local-command-caveat>skip me</local-command-caveat>\"}}\n\
{\"sessionId\":\"abc\",\"type\":\"user\",\"message\":{\"content\":\"real prompt\"}}\n";
        fs::write(&path, jsonl).unwrap();
        let info = parse_session_file(&path).expect("parsed");
        assert_eq!(info.first_prompt.as_deref(), Some("real prompt"));
    }

    #[test]
    fn parse_truncates_long_unicode_prompt_without_panic() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("abc.jsonl");
        // 300 crab emojis => far beyond 200 chars and deliberately multibyte.
        let long = "🦀".repeat(300);
        let jsonl = format!(
            r#"{{"sessionId":"abc","type":"user","message":{{"content":"{long}"}}}}"#
        );
        fs::write(&path, &jsonl).unwrap();
        let info = parse_session_file(&path).expect("parsed");
        let prompt = info.first_prompt.expect("prompt captured");
        assert!(prompt.ends_with("..."));
    }

    #[test]
    fn parse_returns_none_without_session_id() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("abc.jsonl");
        fs::write(&path, r#"{"type":"user","message":{"content":"hi"}}"#).unwrap();
        assert!(parse_session_file(&path).is_none());
    }

    #[test]
    fn parse_handles_content_array_form() {
        let tmp = tempfile::tempdir().unwrap();
        let path = tmp.path().join("abc.jsonl");
        let jsonl = r#"{"sessionId":"abc","type":"user","message":{"content":[{"type":"text","text":"array form"}]}}"#;
        fs::write(&path, jsonl).unwrap();
        let info = parse_session_file(&path).expect("parsed");
        assert_eq!(info.first_prompt.as_deref(), Some("array form"));
    }
}
