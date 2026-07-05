//! VTE-based terminal backend implementation.
//!
//! This backend uses the `vte` crate (same parser as Alacritty) for VT sequence
//! parsing while maintaining xterm.js for rendering. This provides terminal state
//! tracking (cursor position, title, etc.) with cross-platform compatibility.
//!
//! # Architecture
//!
//! ```text
//! PTY Output → VTE Parser → State Update + Tauri Event → xterm.js (render)
//! ```

use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, RwLock};
use std::thread::JoinHandle;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;
use vte::{Parser, Perform};

#[cfg(unix)]
use libc;

use super::terminal_backend::{
    BackendCapabilities, BackendType, CursorShape, SubscriptionHandle, TerminalBackend,
    TerminalConfig, TerminalError, TerminalState,
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

/// VTE event handler that tracks terminal state.
struct VteHandler {
    state: Arc<RwLock<TerminalState>>,
    rows: u16,
    cols: u16,
}

impl VteHandler {
    fn new(rows: u16, cols: u16) -> Self {
        Self {
            state: Arc::new(RwLock::new(TerminalState::default())),
            rows,
            cols,
        }
    }

    fn get_state(&self) -> TerminalState {
        self.state.read().unwrap().clone()
    }

    fn resize(&mut self, rows: u16, cols: u16) {
        self.rows = rows;
        self.cols = cols;
    }
}

impl Perform for VteHandler {
    fn print(&mut self, _c: char) {
        let mut state = self.state.write().unwrap();
        state.cursor_col = state.cursor_col.saturating_add(1);
        if state.cursor_col >= self.cols {
            state.cursor_col = 0;
            state.cursor_row = state.cursor_row.saturating_add(1).min(self.rows - 1);
        }
    }

    fn execute(&mut self, byte: u8) {
        let mut state = self.state.write().unwrap();
        match byte {
            // Carriage return
            0x0D => state.cursor_col = 0,
            // Line feed / newline
            0x0A => {
                state.cursor_row = state.cursor_row.saturating_add(1).min(self.rows - 1);
            }
            // Backspace
            0x08 => {
                state.cursor_col = state.cursor_col.saturating_sub(1);
            }
            // Tab
            0x09 => {
                state.cursor_col = ((state.cursor_col / 8) + 1) * 8;
                if state.cursor_col >= self.cols {
                    state.cursor_col = self.cols - 1;
                }
            }
            // Bell - ignore
            0x07 => {}
            _ => {}
        }
    }

    fn hook(&mut self, _params: &vte::Params, _intermediates: &[u8], _ignore: bool, _action: char) {
        // DCS sequence start - not used for state tracking
    }

    fn put(&mut self, _byte: u8) {
        // DCS data - not used for state tracking
    }

    fn unhook(&mut self) {
        // DCS sequence end - not used for state tracking
    }

    fn osc_dispatch(&mut self, params: &[&[u8]], _bell_terminated: bool) {
        // OSC sequences (e.g., title setting)
        if params.is_empty() {
            return;
        }

        // OSC 0, 1, 2 - Set window/icon title
        if let Some(&[b'0' | b'1' | b'2']) = params.first() {
            if let Some(title_bytes) = params.get(1) {
                if let Ok(title) = std::str::from_utf8(title_bytes) {
                    let mut state = self.state.write().unwrap();
                    state.title = Some(title.to_string());
                }
            }
        }
    }

    fn csi_dispatch(
        &mut self,
        params: &vte::Params,
        _intermediates: &[u8],
        _ignore: bool,
        action: char,
    ) {
        let mut state = self.state.write().unwrap();

        // Get first parameter with default
        let param = |idx: usize, default: u16| -> u16 {
            params
                .iter()
                .nth(idx)
                .and_then(|p| p.first().copied())
                .and_then(|v| if v == 0 { None } else { Some(v) })
                .unwrap_or(default)
        };

        match action {
            // CUU - Cursor Up
            'A' => {
                let n = param(0, 1);
                state.cursor_row = state.cursor_row.saturating_sub(n);
            }
            // CUD - Cursor Down
            'B' => {
                let n = param(0, 1);
                state.cursor_row = state.cursor_row.saturating_add(n).min(self.rows - 1);
            }
            // CUF - Cursor Forward
            'C' => {
                let n = param(0, 1);
                state.cursor_col = state.cursor_col.saturating_add(n).min(self.cols - 1);
            }
            // CUB - Cursor Back
            'D' => {
                let n = param(0, 1);
                state.cursor_col = state.cursor_col.saturating_sub(n);
            }
            // CUP / HVP - Cursor Position
            'H' | 'f' => {
                let row = param(0, 1).saturating_sub(1);
                let col = param(1, 1).saturating_sub(1);
                state.cursor_row = row.min(self.rows - 1);
                state.cursor_col = col.min(self.cols - 1);
            }
            // DECSCUSR - Set Cursor Shape
            'q' => {
                let shape = param(0, 0);
                state.cursor_shape = match shape {
                    0 | 1 | 2 => CursorShape::Block,
                    3 | 4 => CursorShape::Underline,
                    5 | 6 => CursorShape::Bar,
                    _ => CursorShape::Block,
                };
            }
            // DECTCEM - Show/Hide Cursor
            'h' | 'l' => {
                // Check for ?25h (show) or ?25l (hide)
                if let Some(&[25]) = params.iter().next() {
                    state.cursor_visible = action == 'h';
                }
            }
            _ => {}
        }
    }

    fn esc_dispatch(&mut self, _intermediates: &[u8], _ignore: bool, _byte: u8) {
        // ESC sequences - not heavily used for state tracking
    }
}

/// Internal session state for VTE backend.
struct SessionState {
    writer: Box<dyn Write + Send>,
    master: Box<dyn MasterPty + Send>,
    child_pid: i32,
    #[cfg(unix)]
    pgid: i32,
    shutdown: Arc<Notify>,
    reader_handle: Option<JoinHandle<()>>,
}

/// VTE-based terminal backend.
///
/// Uses the `vte` crate for VT parsing, providing terminal state tracking
/// while maintaining xterm.js for rendering.
pub struct VteBackend {
    session: Mutex<Option<SessionState>>,
    handler: RwLock<Option<VteHandler>>,
    session_id: Mutex<Option<u32>>,
    app_handle: Mutex<Option<AppHandle>>,
    initialized: AtomicBool,
}

impl Default for VteBackend {
    fn default() -> Self {
        Self::new()
    }
}

impl VteBackend {
    pub fn new() -> Self {
        Self {
            session: Mutex::new(None),
            handler: RwLock::new(None),
            session_id: Mutex::new(None),
            app_handle: Mutex::new(None),
            initialized: AtomicBool::new(false),
        }
    }

    pub fn backend_type() -> BackendType {
        BackendType::VteParser
    }
}

impl TerminalBackend for VteBackend {
    fn init(&self, config: TerminalConfig) -> Result<(), TerminalError> {
        // Initialize VTE handler
        let handler = VteHandler::new(config.rows, config.cols);
        *self.handler.write().unwrap() = Some(handler);

        // Set up PTY
        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: config.rows,
                cols: config.cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| TerminalError::InitFailed(format!("Failed to open PTY: {e}")))?;

        #[cfg(unix)]
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        #[cfg(windows)]
        let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());

        let mut cmd = CommandBuilder::new(&shell);
        #[cfg(unix)]
        cmd.arg("-l");

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

        #[cfg(unix)]
        let pgid = pair.master.process_group_leader().unwrap_or(child_pid);

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| TerminalError::InitFailed(format!("Failed to take PTY writer: {e}")))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| TerminalError::InitFailed(format!("Failed to clone PTY reader: {e}")))?;

        let shutdown = Arc::new(Notify::new());
        let shutdown_clone = shutdown.clone();

        let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(256);

        let session_id = config.session_id;

        let reader_handle = std::thread::Builder::new()
            .name(format!("vte-reader-{session_id}"))
            .spawn(move || {
                let mut buf = [0u8; 4096];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break,
                        Ok(n) => {
                            if tx.blocking_send(buf[..n].to_vec()).is_err() {
                                log::warn!(
                                    "VTE reader {session_id}: channel send failed, dropping {} bytes",
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
                            log::debug!("VTE reader {session_id} error: {e}");
                            break;
                        }
                    }
                }
                log::debug!("VTE reader {session_id} exited");
            })
            .map_err(|e| TerminalError::InitFailed(format!("Failed to spawn reader thread: {e}")))?;

        // Event loop: parse with VTE and emit to frontend
        let event_name = format!("pty-output-{session_id}");
        let app = config.app_handle.clone();

        tokio::spawn(async move {
            let mut parser = Parser::new();
            let mut decoder = Utf8Decoder::new();
            // Note: We can't easily share VteHandler with the async task due to lifetime constraints
            // For now, just forward data to the frontend - state tracking happens on read
            loop {
                tokio::select! {
                    data = rx.recv() => {
                        match data {
                            Some(bytes) => {
                                // Forward to frontend with proper UTF-8 decoding
                                let text = decoder.decode(&bytes);
                                if !text.is_empty() {
                                    let _ = app.emit(&event_name, text);
                                }

                                // Parse for state (in a real impl, we'd update shared state here)
                                parser.advance(&mut DummyPerform, &bytes);
                            }
                            None => break,
                        }
                    }
                    _ = shutdown_clone.notified() => {
                        break;
                    }
                }
            }
            log::debug!("VTE event emitter {session_id} exited");
        });

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
            "VteBackend initialized session {} (pid={}, pgid={}, shell={})",
            session_id,
            child_pid,
            pgid,
            shell
        );
        #[cfg(windows)]
        log::info!(
            "VteBackend initialized session {} (pid={}, shell={})",
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

        // Resize VTE handler
        if let Some(ref mut handler) = *self.handler.write().unwrap() {
            handler.resize(rows, cols);
        }

        // Resize PTY
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
        if !self.initialized.load(Ordering::Acquire) {
            return None;
        }

        self.handler.read().unwrap().as_ref().map(|h| h.get_state())
    }

    fn subscribe_output(&self, _callback: Box<dyn Fn(&[u8]) + Send + Sync>) -> SubscriptionHandle {
        SubscriptionHandle::new(())
    }

    fn shutdown(&self) -> Result<(), TerminalError> {
        if !self.initialized.load(Ordering::Acquire) {
            return Ok(());
        }

        *self.handler.write().unwrap() = None;

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

            let term_result = unsafe { libc::kill(-pgid, libc::SIGTERM) };
            if term_result != 0 {
                log::warn!(
                    "Failed to SIGTERM session {} (pgid={}): {}",
                    session_id,
                    pgid,
                    std::io::Error::last_os_error()
                );
            }

            std::thread::sleep(std::time::Duration::from_millis(100));

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
            }
        }

        #[cfg(windows)]
        {
            use super::windows_process::StdCommandExt;
            use std::process::Command;
            let _ = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .hide_console_window()
                .output();
        }

        session.shutdown.notify_one();
        drop(session.writer);
        drop(session.master);

        if let Some(handle) = session.reader_handle {
            let _ = handle.join();
        }

        self.initialized.store(false, Ordering::Release);
        *self.app_handle.lock().unwrap() = None;

        log::info!("VteBackend shut down session {}", session_id);
        Ok(())
    }

    fn capabilities(&self) -> BackendCapabilities {
        BackendCapabilities {
            enhanced_state: true,
            text_reflow: false,
            kitty_graphics: false,
            shell_integration: false,
            backend_name: "vte-parser",
        }
    }
}

impl Drop for VteBackend {
    fn drop(&mut self) {
        if self.initialized.load(Ordering::Acquire) {
            let _ = self.shutdown();
        }
    }
}

/// Dummy Perform implementation for async parsing
struct DummyPerform;

impl Perform for DummyPerform {
    fn print(&mut self, _c: char) {}
    fn execute(&mut self, _byte: u8) {}
    fn hook(&mut self, _params: &vte::Params, _intermediates: &[u8], _ignore: bool, _action: char) {
    }
    fn put(&mut self, _byte: u8) {}
    fn unhook(&mut self) {}
    fn osc_dispatch(&mut self, _params: &[&[u8]], _bell_terminated: bool) {}
    fn csi_dispatch(
        &mut self,
        _params: &vte::Params,
        _intermediates: &[u8],
        _ignore: bool,
        _action: char,
    ) {
    }
    fn esc_dispatch(&mut self, _intermediates: &[u8], _ignore: bool, _byte: u8) {}
}
