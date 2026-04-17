pub mod claude_event;
pub mod cli_path;
pub mod error;
pub mod event_bus;
pub mod transcript_parser;
pub mod transcript_watcher;
pub mod font_detector;
pub mod hook_config_writer;
pub mod marketplace_error;
pub mod marketplace_manager;
pub mod marketplace_models;
pub mod mcp_config_writer;
pub mod mcp_manager;
pub mod plugin_config_writer;
pub mod plugin_manager;
pub mod process_manager;
pub mod process_tree;
pub mod session_manager;
pub mod status_server;
pub mod terminal_backend;
pub mod windows_process;
pub mod worktree_manager;
pub mod xterm_backend;

#[cfg(feature = "vte-backend")]
pub mod vte_backend;

pub use claude_event::ClaudeEvent;
pub use error::PtyError;
pub use event_bus::EventBus;
pub use font_detector::{detect_available_fonts, is_font_available, AvailableFont};
pub use marketplace_manager::MarketplaceManager;
pub use mcp_manager::McpManager;
pub use plugin_manager::PluginManager;
pub use process_manager::ProcessManager;
pub use session_manager::SessionManager;
pub use status_server::StatusServer;
pub use terminal_backend::{
    BackendCapabilities, BackendType, SubscriptionHandle, TerminalBackend, TerminalConfig,
    TerminalError, TerminalState,
};
pub use transcript_watcher::TranscriptWatcher;
pub use worktree_manager::WorktreeManager;
pub use xterm_backend::XtermPassthroughBackend;
pub use process_tree::{ProcessError, ProcessInfo, SessionProcessTree};

#[cfg(feature = "vte-backend")]
pub use vte_backend::VteBackend;
