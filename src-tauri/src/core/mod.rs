pub mod claude_event;
pub mod cli_path;
pub mod error;
pub mod event_bus;
pub mod font_detector;
pub mod hook_config_writer;
pub mod marketplace_error;
pub mod marketplace_manager;
pub mod marketplace_models;
pub mod mcp_config_writer;
pub mod mcp_manager;
pub mod path_security;
pub mod plugin_config_writer;
pub mod plugin_manager;
pub mod process_manager;
pub mod process_tree;
pub mod session_manager;
pub mod status_server;
pub mod terminal_backend;
pub mod transcript_parser;
pub mod transcript_watcher;
pub mod windows_process;
pub mod worktree_manager;
pub mod xterm_backend;

#[cfg(feature = "vte-backend")]
pub mod vte_backend;

pub use claude_event::ClaudeEvent;
pub use error::PtyError;
pub use event_bus::EventBus;
pub use font_detector::{detect_available_fonts, is_font_available, AvailableFont};
pub use process_manager::ProcessManager;
pub use process_tree::SessionProcessTree;
pub use status_server::StatusServer;
pub use terminal_backend::{BackendCapabilities, BackendType};
pub use transcript_watcher::TranscriptWatcher;

#[cfg(feature = "vte-backend")]
pub use vte_backend::VteBackend;
