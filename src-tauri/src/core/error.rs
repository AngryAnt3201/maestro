use serde::Serialize;
use std::fmt;

/// Discriminant for PTY errors, serialized to the frontend for programmatic
/// error handling (e.g., distinguishing "session gone" from "write failed").
#[derive(Debug, Clone, Serialize)]
pub enum PtyErrorCode {
    SpawnFailed,
    SessionNotFound,
    WriteFailed,
    ResizeFailed,
    #[allow(dead_code)]
    KillFailed,
    IdOverflow,
}

/// Structured PTY error with a machine-readable code and human-readable message.
///
/// Serialized as JSON to the Tauri frontend. Implements `std::error::Error`
/// so it can be used with `?` in command handlers. Constructors are provided
/// for each error variant to keep call sites concise.
#[derive(Debug, Clone, Serialize)]
pub struct PtyError {
    pub code: PtyErrorCode,
    pub message: String,
}

impl fmt::Display for PtyError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{:?}: {}", self.code, self.message)
    }
}

impl std::error::Error for PtyError {}

impl PtyError {
    /// PTY or shell process could not be created.
    pub fn spawn_failed(msg: impl Into<String>) -> Self {
        Self {
            code: PtyErrorCode::SpawnFailed,
            message: msg.into(),
        }
    }

    /// No session exists with the given ID (already killed or never created).
    pub fn session_not_found(id: u32) -> Self {
        Self {
            code: PtyErrorCode::SessionNotFound,
            message: format!("Session {} not found", id),
        }
    }

    /// Writing to the PTY stdin failed (lock poison or I/O error).
    pub fn write_failed(msg: impl Into<String>) -> Self {
        Self {
            code: PtyErrorCode::WriteFailed,
            message: msg.into(),
        }
    }

    /// PTY resize (SIGWINCH propagation) failed.
    pub fn resize_failed(msg: impl Into<String>) -> Self {
        Self {
            code: PtyErrorCode::ResizeFailed,
            message: msg.into(),
        }
    }

    /// Session termination (SIGTERM/SIGKILL) failed.
    #[allow(dead_code)]
    pub fn kill_failed(msg: impl Into<String>) -> Self {
        Self {
            code: PtyErrorCode::KillFailed,
            message: msg.into(),
        }
    }

    /// Atomic session ID counter overflowed u32::MAX.
    pub fn id_overflow() -> Self {
        Self {
            code: PtyErrorCode::IdOverflow,
            message: "Session ID counter overflowed u32::MAX".to_string(),
        }
    }
}
