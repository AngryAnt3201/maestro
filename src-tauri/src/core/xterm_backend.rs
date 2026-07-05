//! xterm.js passthrough backend implementation.
//!
//! This backend sends raw PTY output directly to xterm.js for rendering.
//! It wraps the existing ProcessManager PTY logic and implements the
//! TerminalBackend trait for cross-platform compatibility.

#![allow(dead_code)]

use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

#[cfg(unix)]
use libc;

use super::terminal_backend::{
    BackendCapabilities, BackendType, SubscriptionHandle, TerminalBackend, TerminalConfig,
    TerminalError, TerminalState,
};

/// Stateful UTF-8 decoder that handles split multi-byte sequences.
///
/// When reading from a PTY in 4096-byte chunks, a multi-byte UTF-8 character
/// (e.g., emoji, Nerd Font icon, CJK character) can be split across chunk
/// boundaries. Using `String::from_utf8_lossy` replaces incomplete sequences
/// with U+FFFD (�), causing garbled output.
///
/// This decoder buffers incomplete trailing sequences and prepends them to
/// the next chunk, ensuring correct UTF-8 decoding across read boundaries.
struct Utf8Decoder {
    /// Buffer for incomplete UTF-8 sequence (max 4 bytes for any code point).
    incomplete: Vec<u8>,
}

impl Utf8Decoder {
    /// Creates a new decoder with an empty buffer.
    fn new() -> Self {
        Self {
            incomplete: Vec::with_capacity(4),
        }
    }

    /// Decodes bytes, buffering incomplete trailing sequences.
    ///
    /// Returns a valid UTF-8 string. Any bytes that form an incomplete
    /// sequence at the end of `input` are buffered for the next call.
    fn decode(&mut self, input: &[u8]) -> String {
        // Prepend any previously incomplete bytes
        let mut data = std::mem::take(&mut self.incomplete);
        data.extend_from_slice(input);

        // Find the last valid UTF-8 boundary
        let valid_up_to = Self::find_valid_boundary(&data);

        // Buffer any trailing incomplete sequence
        if valid_up_to < data.len() {
            self.incomplete = data[valid_up_to..].to_vec();
        }

        // Convert valid portion (guaranteed valid UTF-8)
        String::from_utf8(data[..valid_up_to].to_vec())
            .unwrap_or_else(|_| String::from_utf8_lossy(&data[..valid_up_to]).into_owned())
    }

    /// Finds the byte index up to which the data is valid UTF-8.
    fn find_valid_boundary(data: &[u8]) -> usize {
        match std::str::from_utf8(data) {
            Ok(_) => data.len(),
            Err(e) => {
                let valid = e.valid_up_to();
                // Check if error is due to incomplete sequence at end
                if e.error_len().is_none() {
                    valid // Incomplete sequence - buffer it
                } else {
                    // Invalid byte - skip it and continue
                    valid + e.error_len().unwrap_or(1)
                }
            }
        }
    }
}

/// Internal session state for an xterm passthrough backend.
struct SessionState {
    /// Writer half of the PTY master — used for stdin.
    writer: Box<dyn Write + Send>,
    /// Master PTY handle — used for resize operations.
    master: Box<dyn MasterPty + Send>,
    /// PID of the child process (shell).
    child_pid: i32,
    /// Process group ID for signal delivery (Unix only).
    #[cfg(unix)]
    pgid: i32,
    /// Signal to shut down the event emitter task.
    shutdown: Arc<Notify>,
    /// Handle to the dedicated reader OS thread.
    reader_handle: Option<JoinHandle<()>>,
}

/// xterm.js passthrough terminal backend.
///
/// Sends raw PTY output directly to the frontend via Tauri events.
/// This provides no VT parsing on the backend; xterm.js handles all
/// terminal emulation.
pub struct XtermPassthroughBackend {
    /// Session state (None until init() is called).
    session: Mutex<Option<SessionState>>,
    /// Session ID for event naming.
    session_id: Mutex<Option<u32>>,
    /// App handle for emitting events.
    app_handle: Mutex<Option<AppHandle>>,
    /// Whether the backend has been initialized.
    initialized: AtomicBool,
}

impl Default for XtermPassthroughBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl XtermPassthroughBackend {
    /// Creates a new uninitialized backend instance.
    pub fn new() -> Self {
        Self {
            session: Mutex::new(None),
            session_id: Mutex::new(None),
            app_handle: Mutex::new(None),
            initialized: AtomicBool::new(false),
        }
    }

    /// Returns the backend type identifier.
    pub fn backend_type() -> BackendType {
        BackendType::XtermPassthrough
    }
}

impl TerminalBackend for XtermPassthroughBackend {
    fn init(&self, config: TerminalConfig) -> Result<(), TerminalError> {
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: config.rows,
                cols: config.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| TerminalError::InitFailed(format!("Failed to open PTY: {e}")))?;

        // Determine the user's shell (platform-specific)
        #[cfg(unix)]
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        #[cfg(windows)]
        let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());

        let mut cmd = CommandBuilder::new(&shell);
        #[cfg(unix)]
        cmd.arg("-l"); // Login shell for proper env on Unix

        if let Some(ref dir) = config.cwd {
            cmd.cwd(dir);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| TerminalError::InitFailed(format!("Failed to spawn shell: {e}")))?;

        let child_pid = child
            .process_id()
            .map(|pid| pid as i32)
            .ok_or_else(|| TerminalError::InitFailed("Could not obtain child PID".to_string()))?;

        // Capture process group ID before moving master (Unix only).
        #[cfg(unix)]
        let pgid = pair.master.process_group_leader().unwrap_or(child_pid);

        // Get writer from master
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| TerminalError::InitFailed(format!("Failed to take PTY writer: {e}")))?;

        // Get reader from master
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| TerminalError::InitFailed(format!("Failed to clone PTY reader: {e}")))?;

        let shutdown = Arc::new(Notify::new());
        let shutdown_clone = shutdown.clone();

        // Bounded channel for PTY output (256 slots × 4KB = ~1MB buffer)
        let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(256);

        let session_id = config.session_id;
        let reader_handle = std::thread::Builder::new()
            .name(format!("pty-reader-{session_id}"))
            .spawn(move || {
                let mut buf = [0u8; 4096];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break, // EOF — shell exited
                        Ok(n) => {
                            if tx.blocking_send(buf[..n].to_vec()).is_err() {
                                log::warn!(
                                    "PTY reader {session_id}: channel send failed, dropping {} bytes",
                                    n
                                );
                                break;
                            }
                        }
                        Err(e) => {
                            #[cfg(unix)]
                            {
                                let raw = e.raw_os_error().unwrap_or(0);
                                if raw == libc::EAGAIN || raw == libc::EINTR {
                                    continue;
                                }
                            }
                            log::debug!("PTY reader {session_id} error: {e}");
                            break;
                        }
                    }
                }
                log::debug!("PTY reader {session_id} exited");
            })
            .map_err(|e| TerminalError::InitFailed(format!("Failed to spawn reader thread: {e}")))?;

        // Tokio task: drain the channel and emit Tauri events
        let event_name = format!("pty-output-{session_id}");
        let app = config.app_handle.clone();
        tokio::spawn(async move {
            let mut decoder = Utf8Decoder::new();
            loop {
                tokio::select! {
                    data = rx.recv() => {
                        match data {
                            Some(bytes) => {
                                let text = decoder.decode(&bytes);
                                if !text.is_empty() {
                                    let _ = app.emit(&event_name, text);
                                }
                            }
                            None => break,
                        }
                    }
                    _ = shutdown_clone.notified() => {
                        break;
                    }
                }
            }
            log::debug!("PTY event emitter {session_id} exited");
        });

        // Drop the slave — the master keeps the PTY alive
        drop(pair.slave);

        let state = SessionState {
            writer,
            master: pair.master,
            child_pid,
            #[cfg(unix)]
            pgid,
            shutdown,
            reader_handle: Some(reader_handle),
        };

        *self.session.lock().unwrap() = Some(state);
        *self.session_id.lock().unwrap() = Some(config.session_id);
        *self.app_handle.lock().unwrap() = Some(config.app_handle);
        self.initialized.store(true, Ordering::Release);

        #[cfg(unix)]
        log::info!(
            "XtermPassthroughBackend initialized session {} (pid={}, pgid={}, shell={})",
            session_id,
            child_pid,
            pgid,
            shell
        );
        #[cfg(windows)]
        log::info!(
            "XtermPassthroughBackend initialized session {} (pid={}, shell={})",
            session_id,
            child_pid,
            shell
        );

        Ok(())
    }

    fn write(&self, data: &[u8]) -> Result<(), TerminalError> {
        if !self.initialized.load(Ordering::Acquire) {
            return Err(TerminalError::NotInitialized);
        }

        let mut session_guard = self.session.lock().unwrap();
        let session = session_guard
            .as_mut()
            .ok_or(TerminalError::NotInitialized)?;

        session
            .writer
            .write_all(data)
            .map_err(|e| TerminalError::WriteFailed(format!("Write failed: {e}")))?;

        session
            .writer
            .flush()
            .map_err(|e| TerminalError::WriteFailed(format!("Flush failed: {e}")))?;

        Ok(())
    }

    fn resize(&self, rows: u16, cols: u16) -> Result<(), TerminalError> {
        if !self.initialized.load(Ordering::Acquire) {
            return Err(TerminalError::NotInitialized);
        }

        let session_guard = self.session.lock().unwrap();
        let session = session_guard
            .as_ref()
            .ok_or(TerminalError::NotInitialized)?;

        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| TerminalError::ResizeFailed(format!("Resize failed: {e}")))?;

        Ok(())
    }

    fn get_state(&self) -> Option<TerminalState> {
        // Passthrough backend doesn't parse VT sequences, so no state available
        None
    }

    fn subscribe_output(&self, _callback: Box<dyn Fn(&[u8]) + Send + Sync>) -> SubscriptionHandle {
        // For passthrough backend, output is emitted via Tauri events.
        // This subscription method is primarily for backends that need
        // programmatic access to output (e.g., for VT parsing).
        // Return a no-op handle since events handle the subscription.
        SubscriptionHandle::new(())
    }

    fn shutdown(&self) -> Result<(), TerminalError> {
        if !self.initialized.load(Ordering::Acquire) {
            return Ok(()); // Already shut down or never initialized
        }

        let mut session_guard = self.session.lock().unwrap();
        let session = match session_guard.take() {
            Some(s) => s,
            None => return Ok(()),
        };

        let session_id = self.session_id.lock().unwrap().unwrap_or(0);
        let pid = session.child_pid;

        #[cfg(unix)]
        {
            let pgid = session.pgid;

            // Send SIGTERM to the process group
            let term_result = unsafe { libc::kill(-pgid, libc::SIGTERM) };
            if term_result != 0 {
                log::warn!(
                    "Failed to SIGTERM session {} (pgid={}): {}",
                    session_id,
                    pgid,
                    std::io::Error::last_os_error()
                );
            }

            // Brief sync wait - in async context, caller should use async wrapper
            std::thread::sleep(std::time::Duration::from_millis(100));

            // Check if still alive and SIGKILL if needed
            let alive = unsafe { libc::kill(pid, 0) } == 0;
            if alive {
                let kill_result = unsafe { libc::kill(-pgid, libc::SIGKILL) };
                if kill_result != 0 {
                    log::warn!(
                        "Failed to SIGKILL session {} (pgid={}): {}",
                        session_id,
                        pgid,
                        std::io::Error::last_os_error()
                    );
                }
                log::warn!(
                    "Session {} (pid={}, pgid={}) required SIGKILL",
                    session_id,
                    pid,
                    pgid
                );
            }
        }

        #[cfg(windows)]
        {
            use super::windows_process::StdCommandExt;
            use std::process::Command;
            let result = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .hide_console_window()
                .output();

            if let Err(e) = result {
                log::warn!(
                    "Failed to taskkill session {} (pid={}): {}",
                    session_id,
                    pid,
                    e
                );
            }
        }

        // Signal the tokio event emitter to shut down
        session.shutdown.notify_one();

        // Drop writer and master to close the PTY fd
        drop(session.writer);
        drop(session.master);

        // Join the reader thread
        if let Some(handle) = session.reader_handle {
            let _ = handle.join();
        }

        self.initialized.store(false, Ordering::Release);
        *self.app_handle.lock().unwrap() = None;

        log::info!("XtermPassthroughBackend shut down session {}", session_id);
        Ok(())
    }

    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            enhanced_state: false,
            text_reflow: false,
            kitty_graphics: false,
            shell_integration: false,
            backend_name: "xterm-passthrough",
        }
    }
}

impl Drop for XtermPassthroughBackend {
    fn drop(&mut self) {
        if self.initialized.load(Ordering::Acquire) {
            let _ = self.shutdown();
        }
    }
}
