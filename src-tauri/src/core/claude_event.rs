//! Unified event types for the Claude Event Bus.
//!
//! Every event flowing through the system is represented as a [`ClaudeEvent`]
//! variant. The enum is serde-tagged so that JSON payloads carry an explicit
//! `"event_type"` discriminator, making frontend consumption straightforward.

use serde::{Deserialize, Serialize};

/// Token usage statistics reported by the Claude API.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct TokenUsage {
    pub input_tokens: u64,
    pub output_tokens: u64,
    pub cache_read_input_tokens: u64,
    pub cache_creation_input_tokens: u64,
}

/// A single event emitted by, or on behalf of, a Claude Code session.
///
/// Variants are internally tagged via `event_type` so the serialized JSON
/// always contains `{ "event_type": "VariantName", ... }`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "event_type")]
pub enum ClaudeEvent {
    // === Lifecycle (Hook-sourced) ===
    /// A new Claude Code session has started (from SessionStart hook).
    SessionStarted {
        session_id: u32,
        claude_session_uuid: String,
        transcript_path: String,
        timestamp: String,
    },

    /// A Claude Code session has ended.
    SessionEnded {
        session_id: u32,
        reason: String,
        timestamp: String,
    },

    // === Messages (Transcript-sourced) ===
    /// The user sent a message to the assistant.
    UserMessage {
        session_id: u32,
        uuid: String,
        text: String,
        timestamp: String,
    },

    /// The assistant produced a response.
    AssistantMessage {
        session_id: u32,
        uuid: String,
        text: String,
        model: String,
        token_usage: Option<TokenUsage>,
        timestamp: String,
    },

    // === Tool Activity (Transcript + Hook-sourced) ===
    /// A tool invocation has started.
    ToolUseStarted {
        session_id: u32,
        tool_name: String,
        tool_use_id: String,
        input_summary: String,
        timestamp: String,
    },

    /// A tool invocation has completed.
    ToolUseCompleted {
        session_id: u32,
        tool_name: String,
        tool_use_id: String,
        success: bool,
        timestamp: String,
    },

    // === File Changes (Transcript-sourced) ===
    /// A file was edited by the assistant.
    FileEdited {
        session_id: u32,
        file_path: String,
        tool: String,
        timestamp: String,
    },

    /// A new file was created by the assistant.
    FileCreated {
        session_id: u32,
        file_path: String,
        timestamp: String,
    },

    // === Subagents (Transcript-sourced) ===
    /// A sub-agent was spawned.
    SubagentSpawned {
        session_id: u32,
        agent_type: String,
        agent_id: String,
        description: String,
        timestamp: String,
    },

    /// A sub-agent finished its work.
    SubagentCompleted {
        session_id: u32,
        agent_id: String,
        timestamp: String,
    },

    // === Status (MCP-sourced) ===
    /// A status/state change reported by the session.
    StatusUpdate {
        session_id: u32,
        state: String,
        message: String,
        needs_input_prompt: Option<String>,
        timestamp: String,
    },

    // === Token Usage (Transcript-sourced) ===
    /// Token usage for a single API call.
    TokenUsageUpdate {
        session_id: u32,
        input_tokens: u64,
        output_tokens: u64,
        cache_read_tokens: u64,
        cache_creation_tokens: u64,
        timestamp: String,
    },
}

impl ClaudeEvent {
    /// Returns the `session_id` carried by every event variant.
    #[allow(dead_code)]
    pub fn session_id(&self) -> u32 {
        match self {
            ClaudeEvent::SessionStarted { session_id, .. }
            | ClaudeEvent::SessionEnded { session_id, .. }
            | ClaudeEvent::UserMessage { session_id, .. }
            | ClaudeEvent::AssistantMessage { session_id, .. }
            | ClaudeEvent::ToolUseStarted { session_id, .. }
            | ClaudeEvent::ToolUseCompleted { session_id, .. }
            | ClaudeEvent::FileEdited { session_id, .. }
            | ClaudeEvent::FileCreated { session_id, .. }
            | ClaudeEvent::SubagentSpawned { session_id, .. }
            | ClaudeEvent::SubagentCompleted { session_id, .. }
            | ClaudeEvent::StatusUpdate { session_id, .. }
            | ClaudeEvent::TokenUsageUpdate { session_id, .. } => *session_id,
        }
    }

    /// Returns a deduplication key unique to this event's identity.
    ///
    /// Two events with the same dedup key represent the same logical
    /// occurrence and one may safely be dropped.
    pub fn dedup_key(&self) -> String {
        match self {
            ClaudeEvent::SessionStarted {
                session_id,
                claude_session_uuid,
                ..
            } => {
                format!("SessionStarted:{session_id}:{claude_session_uuid}")
            }
            ClaudeEvent::SessionEnded { session_id, .. } => {
                format!("SessionEnded:{session_id}")
            }
            ClaudeEvent::UserMessage { uuid, .. } => {
                format!("UserMessage:{uuid}")
            }
            ClaudeEvent::AssistantMessage { uuid, .. } => {
                format!("AssistantMessage:{uuid}")
            }
            ClaudeEvent::ToolUseStarted { tool_use_id, .. } => {
                format!("ToolUseStarted:{tool_use_id}")
            }
            ClaudeEvent::ToolUseCompleted { tool_use_id, .. } => {
                format!("ToolUseCompleted:{tool_use_id}")
            }
            ClaudeEvent::FileEdited {
                session_id,
                file_path,
                timestamp,
                ..
            } => {
                format!("FileEdited:{session_id}:{file_path}:{timestamp}")
            }
            ClaudeEvent::FileCreated {
                session_id,
                file_path,
                timestamp,
            } => {
                format!("FileCreated:{session_id}:{file_path}:{timestamp}")
            }
            ClaudeEvent::SubagentSpawned { agent_id, .. } => {
                format!("SubagentSpawned:{agent_id}")
            }
            ClaudeEvent::SubagentCompleted { agent_id, .. } => {
                format!("SubagentCompleted:{agent_id}")
            }
            ClaudeEvent::StatusUpdate {
                session_id,
                state,
                message,
                ..
            } => {
                format!("StatusUpdate:{session_id}:{state}:{message}")
            }
            ClaudeEvent::TokenUsageUpdate {
                session_id,
                input_tokens,
                output_tokens,
                ..
            } => {
                format!("TokenUsageUpdate:{session_id}:{input_tokens}:{output_tokens}")
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_dedup_key_uniqueness() {
        let a = ClaudeEvent::ToolUseStarted {
            session_id: 1,
            tool_name: "Read".into(),
            tool_use_id: "toolu_aaa".into(),
            input_summary: "file.rs".into(),
            timestamp: "2026-02-24T00:00:00Z".into(),
        };
        let b = ClaudeEvent::ToolUseStarted {
            session_id: 1,
            tool_name: "Read".into(),
            tool_use_id: "toolu_bbb".into(),
            input_summary: "file.rs".into(),
            timestamp: "2026-02-24T00:00:00Z".into(),
        };
        assert_ne!(a.dedup_key(), b.dedup_key());
    }

    #[test]
    fn test_dedup_key_same_event() {
        let a = ClaudeEvent::UserMessage {
            session_id: 1,
            uuid: "uuid-123".into(),
            text: "hello".into(),
            timestamp: "2026-02-24T00:00:00Z".into(),
        };
        let b = ClaudeEvent::UserMessage {
            session_id: 1,
            uuid: "uuid-123".into(),
            text: "hello".into(),
            timestamp: "2026-02-24T00:00:00Z".into(),
        };
        assert_eq!(a.dedup_key(), b.dedup_key());
    }

    #[test]
    fn test_session_id_extraction() {
        let events: Vec<ClaudeEvent> = vec![
            ClaudeEvent::SessionStarted {
                session_id: 1,
                claude_session_uuid: "u".into(),
                transcript_path: "p".into(),
                timestamp: "t".into(),
            },
            ClaudeEvent::SessionEnded {
                session_id: 2,
                reason: "done".into(),
                timestamp: "t".into(),
            },
            ClaudeEvent::UserMessage {
                session_id: 3,
                uuid: "u".into(),
                text: "hi".into(),
                timestamp: "t".into(),
            },
            ClaudeEvent::AssistantMessage {
                session_id: 4,
                uuid: "u".into(),
                text: "hello".into(),
                model: "opus".into(),
                token_usage: None,
                timestamp: "t".into(),
            },
            ClaudeEvent::ToolUseStarted {
                session_id: 5,
                tool_name: "Read".into(),
                tool_use_id: "x".into(),
                input_summary: "s".into(),
                timestamp: "t".into(),
            },
            ClaudeEvent::ToolUseCompleted {
                session_id: 6,
                tool_name: "Read".into(),
                tool_use_id: "x".into(),
                success: true,
                timestamp: "t".into(),
            },
            ClaudeEvent::FileEdited {
                session_id: 7,
                file_path: "/a".into(),
                tool: "Edit".into(),
                timestamp: "t".into(),
            },
            ClaudeEvent::FileCreated {
                session_id: 8,
                file_path: "/b".into(),
                timestamp: "t".into(),
            },
            ClaudeEvent::SubagentSpawned {
                session_id: 9,
                agent_type: "Explore".into(),
                agent_id: "s".into(),
                description: "d".into(),
                timestamp: "t".into(),
            },
            ClaudeEvent::SubagentCompleted {
                session_id: 10,
                agent_id: "s".into(),
                timestamp: "t".into(),
            },
            ClaudeEvent::StatusUpdate {
                session_id: 11,
                state: "working".into(),
                message: "m".into(),
                needs_input_prompt: None,
                timestamp: "t".into(),
            },
            ClaudeEvent::TokenUsageUpdate {
                session_id: 12,
                input_tokens: 100,
                output_tokens: 50,
                cache_read_tokens: 10,
                cache_creation_tokens: 5,
                timestamp: "t".into(),
            },
        ];
        for (i, event) in events.iter().enumerate() {
            assert_eq!(event.session_id(), (i as u32) + 1);
        }
    }

    #[test]
    fn test_serialize_deserialize_roundtrip() {
        let original = ClaudeEvent::AssistantMessage {
            session_id: 42,
            uuid: "msg-001".into(),
            text: "Hello, world!".into(),
            model: "claude-opus-4-6".into(),
            token_usage: Some(TokenUsage {
                input_tokens: 100,
                output_tokens: 50,
                cache_read_input_tokens: 10,
                cache_creation_input_tokens: 5,
            }),
            timestamp: "2026-02-24T12:00:00Z".into(),
        };
        let json = serde_json::to_string(&original).expect("serialize");
        let recovered: ClaudeEvent = serde_json::from_str(&json).expect("deserialize");

        assert_eq!(recovered.session_id(), 42);
        if let ClaudeEvent::AssistantMessage {
            text,
            model,
            token_usage,
            ..
        } = &recovered
        {
            assert_eq!(text, "Hello, world!");
            assert_eq!(model, "claude-opus-4-6");
            assert!(token_usage.is_some());
            assert_eq!(token_usage.as_ref().unwrap().input_tokens, 100);
        } else {
            panic!("wrong variant after roundtrip");
        }
    }

    #[test]
    fn test_tagged_serialization() {
        let event = ClaudeEvent::ToolUseStarted {
            session_id: 1,
            tool_name: "Read".into(),
            tool_use_id: "abc".into(),
            input_summary: "file.rs".into(),
            timestamp: "2026-02-24T00:00:00Z".into(),
        };
        let json = serde_json::to_string(&event).expect("serialize");
        assert!(
            json.contains(r#""event_type":"ToolUseStarted""#),
            "JSON should contain tagged event_type field, got: {json}"
        );
    }
}
