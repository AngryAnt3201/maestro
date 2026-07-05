//! Terminal backend abstraction layer.
//!
//! Provides a common interface for different terminal backends (xterm.js passthrough,
//! Ghostty VT, etc.) enabling platform-specific optimizations while maintaining
//! cross-platform compatibility.

#![allow(dead_code)]

use std::sync::Arc;
use tauri::AppHandle;

/// Configuration for initializing a terminal backend.
#[derive(Debug, Clone)]
pub struct TerminalConfig {
    /// Session ID for this terminal instance.
    pub session_id: u32,
    /// Initial number of rows.
    pub rows: u16,
    /// Initial number of columns.
    pub cols: u16,
    /// Working directory for the shell.
    pub cwd: Option<String>,
    /// Tauri app handle for emitting events.
    pub app_handle: AppHandle,
}

/// Terminal state information exposed by backends that support it.
#[derive(Debug, Clone, Default)]
pub struct TerminalState {
    /// Current cursor row position (0-indexed).
    pub cursor_row: u16,
    /// Current cursor column position (0-indexed).
    pub cursor_col: u16,
    /// Cursor shape (block, underline, bar).
    pub cursor_shape: CursorShape,
    /// Whether the cursor is visible.
    pub cursor_visible: bool,
    /// Current scrollback position (lines from bottom).
    pub scrollback_position: u32,
    /// Total lines in scrollback buffer.
    pub scrollback_total: u32,
    /// Terminal title (set by shell escape sequences).
    pub title: Option<String>,
}

/// Cursor shape variants.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub enum CursorShape {
    #[default]
    Block,
    Underline,
    Bar,
}

/// Handle for managing output subscriptions.
/// Dropping this handle unsubscribes the callback.
pub struct SubscriptionHandle {
    _inner: Arc<dyn std::any::Any + Send + Sync>,
}

impl SubscriptionHandle {
    /// Creates a new subscription handle wrapping cleanup logic.
    pub fn new<T: Send + Sync + 'static>(inner: T) -> Self {
        Self {
            _inner: Arc::new(inner),
        }
    }
}

/// Error types specific to terminal backend operations.
#[derive(Debug, thiserror::Error)]
pub enum TerminalError {
    #[error("Backend initialization failed: {0}")]
    InitFailed(String),

    #[error("Write operation failed: {0}")]
    WriteFailed(String),

    #[error("Resize operation failed: {0}")]
    ResizeFailed(String),

    #[error("Backend not initialized")]
    NotInitialized,

    #[error("Shutdown failed: {0}")]
    ShutdownFailed(String),

    #[error("PTY error: {0}")]
    PtyError(String),

    #[error("FFI error: {0}")]
    FfiError(String),
}

impl From<super::PtyError> for TerminalError {
    fn from(err: super::PtyError) -> Self {
        TerminalError::PtyError(err.message)
    }
}

/// Capabilities advertised by a terminal backend.
#[derive(Debug, Clone, Default)]
pub struct BackendCapabilities {
    /// Backend supports enhanced terminal state queries.
    pub enhanced_state: bool,
    /// Backend supports text reflow on resize.
    pub text_reflow: bool,
    /// Backend supports Kitty graphics protocol.
    pub kitty_graphics: bool,
    /// Backend supports shell integration hooks.
    pub shell_integration: bool,
    /// Name of the backend implementation.
    pub backend_name: &'static str,
}

/// Trait defining the terminal backend interface.
///
/// Implementations must be Send + Sync to allow sharing across async contexts.
/// Each method operates on `&self` with internal mutability (e.g., Mutex) to
/// avoid lifetime complications with Tauri state management.
pub trait TerminalBackend: Send + Sync {
    /// Initializes the backend with the given configuration.
    ///
    /// This should spawn the PTY/shell and set up the event loop for output.
    /// After successful initialization, `write()`, `resize()`, etc. become valid.
    fn init(&self, config: TerminalConfig) -> Result<(), TerminalError>;

    /// Writes raw bytes to the terminal input (PTY stdin).
    ///
    /// The backend should flush writes immediately to minimize latency.
    fn write(&self, data: &[u8]) -> Result<(), TerminalError>;

    /// Resizes the terminal to the given dimensions.
    ///
    /// On Unix, this propagates SIGWINCH to the child process.
    fn resize(&self, rows: u16, cols: u16) -> Result<(), TerminalError>;

    /// Returns the current terminal state, if the backend supports it.
    ///
    /// Passthrough backends (xterm.js direct) return `None` since they don't
    /// parse VT sequences. Ghostty VT backends return full state.
    fn get_state(&self) -> Option<TerminalState>;

    /// Subscribes to terminal output events.
    ///
    /// The callback receives raw bytes from the PTY. For passthrough backends,
    /// this is the unprocessed output. For VT-parsing backends, this may be
    /// processed output with additional metadata available via `get_state()`.
    ///
    /// Returns a handle that unsubscribes when dropped.
    fn subscribe_output(&self, callback: Box<dyn Fn(&[u8]) + Send + Sync>) -> SubscriptionHandle;

    /// Shuts down the backend, terminating the PTY session.
    ///
    /// This should gracefully terminate the shell (SIGTERM, then SIGKILL),
    /// close file descriptors, and join any background threads.
    fn shutdown(&self) -> Result<(), TerminalError>;

    /// Returns the capabilities of this backend.
    fn capabilities(&self) -> BackendCapabilities;
}

/// Identifies the active backend type for the frontend.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "kebab-case")]
pub enum BackendType {
    /// xterm.js passthrough - raw PTY output sent directly to xterm.js.
    XtermPassthrough,
    /// VTE backend - VT sequences parsed for state tracking, rendered by xterm.js.
    VteParser,
}

impl BackendType {
    /// Returns the default backend type for the current platform.
    #[allow(unreachable_code)]
    pub fn platform_default() -> Self {
        #[cfg(feature = "vte-backend")]
        {
            return BackendType::VteParser;
        }
        BackendType::XtermPassthrough
    }
}
