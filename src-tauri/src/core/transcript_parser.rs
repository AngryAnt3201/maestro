//! Pure parsing functions for Claude Code JSONL transcript lines.
//!
//! Each line in a transcript file (`~/.claude/projects/{project}/{sessionId}.jsonl`)
//! is a JSON object representing a user message, assistant message, or
//! file-history snapshot.  [`parse_transcript_line`] converts a single line
//! into zero or more [`ClaudeEvent`] variants without performing any file I/O.

use serde_json::Value;

use super::claude_event::{ClaudeEvent, TokenUsage};

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Parse a single JSONL line from a Claude Code transcript into events.
///
/// Returns an empty `Vec` for blank lines, invalid JSON, and
/// `"file-history-snapshot"` entries.
pub fn parse_transcript_line(session_id: u32, line: &str) -> Vec<ClaudeEvent> {
    let trimmed = line.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }

    let obj: Value = match serde_json::from_str(trimmed) {
        Ok(v) => v,
        Err(_) => return Vec::new(),
    };

    let msg_type = obj.get("type").and_then(|v| v.as_str()).unwrap_or("");

    match msg_type {
        "user" => parse_user_message(session_id, &obj),
        "assistant" => parse_assistant_message(session_id, &obj),
        _ => Vec::new(), // skip file-history-snapshot, unknown types
    }
}

// ---------------------------------------------------------------------------
// Helpers: truncation
// ---------------------------------------------------------------------------

/// Truncate a string to `max` characters, appending "..." if truncated.
fn truncate(s: &str, max: usize) -> String {
    if s.len() <= max {
        s.to_string()
    } else {
        let mut result = s[..max].to_string();
        result.push_str("...");
        result
    }
}

// ---------------------------------------------------------------------------
// Helpers: input summary
// ---------------------------------------------------------------------------

/// Produce a human-readable summary of a tool's input object.
fn summarize_tool_input(tool_name: &str, input: &Value) -> String {
    match tool_name {
        "Bash" => {
            let cmd = input.get("command").and_then(|v| v.as_str()).unwrap_or("");
            truncate(cmd, 120)
        }
        "Read" | "Edit" | "Write" => input
            .get("file_path")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "Grep" => {
            let pattern = input.get("pattern").and_then(|v| v.as_str()).unwrap_or("");
            let path = input.get("path").and_then(|v| v.as_str()).unwrap_or(".");
            format!("{pattern} in {path}")
        }
        "Glob" => input
            .get("pattern")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string(),
        "Task" => {
            let desc = input
                .get("description")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            truncate(desc, 80)
        }
        _ => {
            let s = serde_json::to_string(input).unwrap_or_default();
            truncate(&s, 100)
        }
    }
}

// ---------------------------------------------------------------------------
// Internal parsers
// ---------------------------------------------------------------------------

fn extract_timestamp(obj: &Value) -> String {
    obj.get("timestamp")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn extract_uuid(obj: &Value) -> String {
    obj.get("uuid")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string()
}

fn parse_user_message(session_id: u32, obj: &Value) -> Vec<ClaudeEvent> {
    let uuid = extract_uuid(obj);
    let timestamp = extract_timestamp(obj);

    let text = obj
        .get("message")
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array())
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|b| {
                    if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                        b.get("text").and_then(|t| t.as_str())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();

    vec![ClaudeEvent::UserMessage {
        session_id,
        uuid,
        text,
        timestamp,
    }]
}

fn parse_assistant_message(session_id: u32, obj: &Value) -> Vec<ClaudeEvent> {
    let uuid = extract_uuid(obj);
    let timestamp = extract_timestamp(obj);
    let message = obj.get("message");

    let model = message
        .and_then(|m| m.get("model"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();

    let content_blocks = message
        .and_then(|m| m.get("content"))
        .and_then(|c| c.as_array());

    // Collect all text blocks into one string.
    let text = content_blocks
        .map(|blocks| {
            blocks
                .iter()
                .filter_map(|b| {
                    if b.get("type").and_then(|t| t.as_str()) == Some("text") {
                        b.get("text").and_then(|t| t.as_str())
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>()
                .join("\n")
        })
        .unwrap_or_default();

    // Parse usage.
    let usage_obj = message.and_then(|m| m.get("usage"));
    let token_usage = usage_obj.and_then(|u| {
        Some(TokenUsage {
            input_tokens: u.get("input_tokens")?.as_u64()?,
            output_tokens: u.get("output_tokens")?.as_u64()?,
            cache_read_input_tokens: u
                .get("cache_read_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
            cache_creation_input_tokens: u
                .get("cache_creation_input_tokens")
                .and_then(|v| v.as_u64())
                .unwrap_or(0),
        })
    });

    let mut events: Vec<ClaudeEvent> = Vec::new();

    // Always emit an AssistantMessage.
    events.push(ClaudeEvent::AssistantMessage {
        session_id,
        uuid: uuid.clone(),
        text,
        model,
        token_usage: token_usage.clone(),
        timestamp: timestamp.clone(),
    });

    // Process tool_use blocks.
    if let Some(blocks) = content_blocks {
        for block in blocks {
            if block.get("type").and_then(|t| t.as_str()) != Some("tool_use") {
                continue;
            }

            let tool_name = block
                .get("name")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let tool_use_id = block
                .get("id")
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .to_string();
            let input = block.get("input").cloned().unwrap_or(Value::Null);
            let input_summary = summarize_tool_input(&tool_name, &input);

            events.push(ClaudeEvent::ToolUseStarted {
                session_id,
                tool_name: tool_name.clone(),
                tool_use_id,
                input_summary,
                timestamp: timestamp.clone(),
            });

            // Emit higher-level events for specific tools.
            match tool_name.as_str() {
                "Edit" => {
                    let file_path = input
                        .get("file_path")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    events.push(ClaudeEvent::FileEdited {
                        session_id,
                        file_path,
                        tool: "Edit".to_string(),
                        timestamp: timestamp.clone(),
                    });
                }
                "Write" => {
                    let file_path = input
                        .get("file_path")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    events.push(ClaudeEvent::FileCreated {
                        session_id,
                        file_path,
                        timestamp: timestamp.clone(),
                    });
                }
                "Task" => {
                    let description = input
                        .get("description")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let agent_type = input
                        .get("subagent_type")
                        .and_then(|v| v.as_str())
                        .unwrap_or("unknown")
                        .to_string();
                    let agent_id = block
                        .get("id")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    events.push(ClaudeEvent::SubagentSpawned {
                        session_id,
                        agent_type,
                        agent_id,
                        description,
                        timestamp: timestamp.clone(),
                    });
                }
                _ => {}
            }
        }
    }

    // Emit a TokenUsageUpdate when usage data is present.
    if let Some(tu) = &token_usage {
        events.push(ClaudeEvent::TokenUsageUpdate {
            session_id,
            input_tokens: tu.input_tokens,
            output_tokens: tu.output_tokens,
            cache_read_tokens: tu.cache_read_input_tokens,
            cache_creation_tokens: tu.cache_creation_input_tokens,
            timestamp: timestamp.clone(),
        });
    }

    events
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;

    const USER_MSG: &str = r#"{"parentUuid":"parent-1","isSidechain":false,"type":"user","message":{"role":"user","content":[{"type":"text","text":"Fix the login bug"}]},"uuid":"uuid-user-1","timestamp":"2026-02-24T10:00:00.000Z"}"#;

    const ASSISTANT_MSG_WITH_TOOL: &str = r#"{"parentUuid":"uuid-user-1","isSidechain":false,"type":"assistant","message":{"model":"claude-opus-4-6","id":"msg_001","type":"message","role":"assistant","content":[{"type":"text","text":"Let me read the file."},{"type":"tool_use","id":"toolu_abc","name":"Read","input":{"file_path":"/src/login.rs"}}],"usage":{"input_tokens":500,"output_tokens":100,"cache_read_input_tokens":50,"cache_creation_input_tokens":10}},"uuid":"uuid-asst-1","timestamp":"2026-02-24T10:00:05.000Z"}"#;

    const ASSISTANT_MSG_EDIT: &str = r#"{"parentUuid":"uuid-asst-1","isSidechain":false,"type":"assistant","message":{"model":"claude-opus-4-6","id":"msg_002","type":"message","role":"assistant","content":[{"type":"tool_use","id":"toolu_def","name":"Edit","input":{"file_path":"/src/login.rs","old_string":"bug","new_string":"fix"}}],"usage":{"input_tokens":600,"output_tokens":50}},"uuid":"uuid-asst-2","timestamp":"2026-02-24T10:00:10.000Z"}"#;

    const ASSISTANT_MSG_TASK: &str = r#"{"parentUuid":"uuid-user-1","isSidechain":false,"type":"assistant","message":{"model":"claude-opus-4-6","id":"msg_003","type":"message","role":"assistant","content":[{"type":"tool_use","id":"toolu_task1","name":"Task","input":{"description":"Search for auth code","prompt":"Find authentication","subagent_type":"Explore"}}],"usage":{"input_tokens":200,"output_tokens":30}},"uuid":"uuid-asst-3","timestamp":"2026-02-24T10:00:15.000Z"}"#;

    const FILE_HISTORY: &str =
        r#"{"type":"file-history-snapshot","messageId":"e2c301be","snapshot":{}}"#;

    #[test]
    fn test_parse_user_message() {
        let events = parse_transcript_line(1, USER_MSG);
        assert_eq!(events.len(), 1);
        match &events[0] {
            ClaudeEvent::UserMessage {
                session_id,
                uuid,
                text,
                timestamp,
            } => {
                assert_eq!(*session_id, 1);
                assert_eq!(uuid, "uuid-user-1");
                assert_eq!(text, "Fix the login bug");
                assert_eq!(timestamp, "2026-02-24T10:00:00.000Z");
            }
            other => panic!("Expected UserMessage, got {other:?}"),
        }
    }

    #[test]
    fn test_parse_assistant_with_tool() {
        let events = parse_transcript_line(2, ASSISTANT_MSG_WITH_TOOL);
        // Should produce: AssistantMessage + ToolUseStarted(Read) + TokenUsageUpdate
        assert!(
            events.len() >= 3,
            "Expected at least 3 events, got {}",
            events.len()
        );

        // First event is always the AssistantMessage.
        assert!(
            matches!(&events[0], ClaudeEvent::AssistantMessage { text, model, .. }
                if text == "Let me read the file." && model == "claude-opus-4-6"),
            "First event should be AssistantMessage, got {:?}",
            events[0]
        );

        // Find ToolUseStarted for Read.
        let tool_event = events.iter().find(
            |e| matches!(e, ClaudeEvent::ToolUseStarted { tool_name, .. } if tool_name == "Read"),
        );
        assert!(tool_event.is_some(), "Should have a ToolUseStarted(Read)");
        if let Some(ClaudeEvent::ToolUseStarted {
            tool_use_id,
            input_summary,
            ..
        }) = tool_event
        {
            assert_eq!(tool_use_id, "toolu_abc");
            assert_eq!(input_summary, "/src/login.rs");
        }

        // Find TokenUsageUpdate.
        let token_event = events
            .iter()
            .find(|e| matches!(e, ClaudeEvent::TokenUsageUpdate { .. }));
        assert!(token_event.is_some(), "Should have a TokenUsageUpdate");
        if let Some(ClaudeEvent::TokenUsageUpdate {
            input_tokens,
            output_tokens,
            cache_read_tokens,
            cache_creation_tokens,
            ..
        }) = token_event
        {
            assert_eq!(*input_tokens, 500);
            assert_eq!(*output_tokens, 100);
            assert_eq!(*cache_read_tokens, 50);
            assert_eq!(*cache_creation_tokens, 10);
        }
    }

    #[test]
    fn test_parse_file_edit() {
        let events = parse_transcript_line(3, ASSISTANT_MSG_EDIT);

        let edit_event = events
            .iter()
            .find(|e| matches!(e, ClaudeEvent::FileEdited { .. }));
        assert!(edit_event.is_some(), "Should have a FileEdited event");
        if let Some(ClaudeEvent::FileEdited {
            file_path, tool, ..
        }) = edit_event
        {
            assert_eq!(file_path, "/src/login.rs");
            assert_eq!(tool, "Edit");
        }
    }

    #[test]
    fn test_parse_subagent_spawn() {
        let events = parse_transcript_line(4, ASSISTANT_MSG_TASK);

        let spawn_event = events
            .iter()
            .find(|e| matches!(e, ClaudeEvent::SubagentSpawned { .. }));
        assert!(spawn_event.is_some(), "Should have a SubagentSpawned event");
        if let Some(ClaudeEvent::SubagentSpawned {
            agent_type,
            agent_id,
            description,
            ..
        }) = spawn_event
        {
            assert_eq!(agent_type, "Explore");
            assert_eq!(agent_id, "toolu_task1");
            assert_eq!(description, "Search for auth code");
        }
    }

    #[test]
    fn test_skip_file_history_snapshot() {
        let events = parse_transcript_line(5, FILE_HISTORY);
        assert!(
            events.is_empty(),
            "file-history-snapshot should produce no events"
        );
    }

    #[test]
    fn test_skip_empty_line() {
        assert!(parse_transcript_line(6, "").is_empty());
        assert!(parse_transcript_line(6, "   ").is_empty());
    }

    #[test]
    fn test_skip_invalid_json() {
        assert!(parse_transcript_line(7, "not json at all!!!").is_empty());
        assert!(parse_transcript_line(7, "{bad json").is_empty());
    }

    #[test]
    fn test_truncate_long_input() {
        // Verify truncation adds "..." and respects max length.
        let short = "hello";
        assert_eq!(truncate(short, 10), "hello");

        let long = "a".repeat(200);
        let result = truncate(&long, 50);
        assert!(result.ends_with("..."));
        // The base portion is 50 chars, plus "..." = 53.
        assert_eq!(result.len(), 53);
        assert_eq!(&result[..50], &long[..50]);

        // Verify summarize_tool_input uses truncation for Bash commands.
        let long_cmd = "x".repeat(200);
        let input = serde_json::json!({ "command": long_cmd });
        let summary = summarize_tool_input("Bash", &input);
        assert!(summary.ends_with("..."));
        assert_eq!(summary.len(), 123); // 120 + "..."
    }
}
