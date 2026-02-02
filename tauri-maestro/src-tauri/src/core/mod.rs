pub mod error;
pub mod mcp_config_writer;
pub mod mcp_manager;
pub mod mcp_status_monitor;
pub mod plugin_manager;
pub mod process_manager;
pub mod process_tree;
pub mod session_manager;
pub mod terminal_backend;
pub mod worktree_manager;
pub mod xterm_backend;

#[cfg(feature = "vte-backend")]
pub mod vte_backend;

pub use error::PtyError;
pub use mcp_manager::McpManager;
pub use mcp_status_monitor::McpStatusMonitor;
pub use plugin_manager::PluginManager;
pub use process_manager::ProcessManager;
pub use session_manager::SessionManager;
pub use terminal_backend::{
    BackendCapabilities, BackendType, SubscriptionHandle, TerminalBackend, TerminalConfig,
    TerminalError, TerminalState,
};
pub use worktree_manager::WorktreeManager;
pub use xterm_backend::XtermPassthroughBackend;
pub use process_tree::{ProcessError, ProcessInfo, SessionProcessTree};

#[cfg(feature = "vte-backend")]
pub use vte_backend::VteBackend;
