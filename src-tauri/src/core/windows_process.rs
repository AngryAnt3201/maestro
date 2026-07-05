//! Windows-specific process spawning utilities.
//!
//! Provides extension traits to apply CREATE_NO_WINDOW flag to process commands,
//! preventing visible console windows from spawning for background operations.
//!
//! On Windows, spawning a process via `std::process::Command` or `tokio::process::Command`
//! without the `CREATE_NO_WINDOW` flag causes a visible console window to appear for
//! each subprocess. This module provides a clean, cross-platform way to hide these
//! windows for background operations like git commands and process termination.

/// The CREATE_NO_WINDOW flag for Windows process creation (0x08000000).
/// When set, the new process does not inherit or create a console window.
#[cfg(windows)]
pub const CREATE_NO_WINDOW: u32 = 0x08000000;

/// Extension trait for `std::process::Command` to hide console windows on Windows.
#[allow(dead_code)]
pub trait StdCommandExt {
    /// Configures the command to not create a visible console window on Windows.
    /// On non-Windows platforms, this is a no-op.
    fn hide_console_window(&mut self) -> &mut Self;
}

/// Extension trait for `tokio::process::Command` to hide console windows on Windows.
pub trait TokioCommandExt {
    /// Configures the command to not create a visible console window on Windows.
    /// On non-Windows platforms, this is a no-op.
    fn hide_console_window(&mut self) -> &mut Self;
}

#[cfg(windows)]
impl StdCommandExt for std::process::Command {
    fn hide_console_window(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        self.creation_flags(CREATE_NO_WINDOW)
    }
}

#[cfg(not(windows))]
impl StdCommandExt for std::process::Command {
    fn hide_console_window(&mut self) -> &mut Self {
        self // No-op on non-Windows
    }
}

#[cfg(windows)]
impl TokioCommandExt for tokio::process::Command {
    fn hide_console_window(&mut self) -> &mut Self {
        use std::os::windows::process::CommandExt;
        self.creation_flags(CREATE_NO_WINDOW)
    }
}

#[cfg(not(windows))]
impl TokioCommandExt for tokio::process::Command {
    fn hide_console_window(&mut self) -> &mut Self {
        self // No-op on non-Windows
    }
}
