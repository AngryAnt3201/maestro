use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use dashmap::DashMap;
use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter};
use tokio::sync::Notify;

#[cfg(unix)]
use libc;

use super::error::PtyError;

/// Stateful UTF-8 decoder that handles split multi-byte sequences.
///
/// When reading from a PTY in 4096-byte chunks, a multi-byte UTF-8 character
/// (e.g., emoji, Nerd Font icon, CJK character) can be split across chunk
/// boundaries. Using `String::from_utf8_lossy` replaces incomplete sequences
/// with U+FFFD (�), causing garbled output.
///
/// This decoder buffers incomplete trailing sequences and prepends them to
/// the next chunk, ensuring correct UTF-8 decoding across read boundaries.
pub(crate) struct Utf8Decoder {
    /// Buffer for incomplete UTF-8 sequence (max 4 bytes for any code point).
    incomplete: Vec<u8>,
}

impl Utf8Decoder {
    /// Creates a new decoder with an empty buffer.
    pub fn new() -> Self {
        Self {
            incomplete: Vec::with_capacity(4),
        }
    }

    /// Decodes bytes, buffering incomplete trailing sequences.
    ///
    /// Returns a valid UTF-8 string. Any bytes that form an incomplete
    /// sequence at the end of `input` are buffered for the next call.
    pub fn decode(&mut self, input: &[u8]) -> String {
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

/// A single PTY session with its associated resources.
struct PtySession {
    /// Writer half of the PTY master — used for stdin.
    writer: Mutex<Box<dyn Write + Send>>,
    /// Master PTY handle — used for resize operations.
    master: Mutex<Box<dyn MasterPty + Send>>,
    /// PID of the child process (shell).
    child_pid: i32,
    /// Process group ID for signal delivery (Unix only). portable-pty calls
    /// setsid() on spawn, so the child becomes a session+group leader (PGID == child PID).
    /// We capture this from master.process_group_leader() for correctness.
    #[cfg(unix)]
    pgid: i32,
    /// Signal to shut down the reader thread.
    shutdown: Arc<Notify>,
    /// Handle to the dedicated reader OS thread.
    reader_handle: Mutex<Option<JoinHandle<()>>>,
}

struct Inner {
    sessions: DashMap<u32, PtySession>,
    next_id: AtomicU32,
    /// Tracks last spawn time on Windows to prevent rapid consecutive spawns
    /// that may cause terminal spawning loops (Bug #76).
    #[cfg(windows)]
    last_spawn_time: Mutex<std::time::Instant>,
}

/// Owns and manages all PTY sessions for the application lifetime.
///
/// Wraps an `Arc<Inner>` so it can be cheaply cloned into Tauri's managed state
/// and shared across async command handlers without lifetime issues.
/// Each session gets a monotonically increasing ID (never reused).
#[derive(Clone)]
pub struct ProcessManager {
    inner: Arc<Inner>,
}

impl Default for ProcessManager {
    fn default() -> Self {
        Self::new()
    }
}

impl ProcessManager {
    /// Creates a new manager with no active sessions.
    /// Session IDs start at 1 and increment atomically.
    pub fn new() -> Self {
        Self {
            inner: Arc::new(Inner {
                sessions: DashMap::new(),
                next_id: AtomicU32::new(1),
                #[cfg(windows)]
                last_spawn_time: Mutex::new(std::time::Instant::now()),
            }),
        }
    }

    /// Spawns a login shell in a new PTY and returns its session ID.
    ///
    /// Uses `$SHELL` (falling back to `/bin/sh`) with `-l` for a login environment.
    /// The child process calls `setsid()` via portable-pty, making it a session
    /// leader so `kill_session` can signal the entire process group.
    /// A dedicated OS thread reads PTY output into a bounded 256-slot channel
    /// (~1 MB of 4 KB chunks), and a tokio task drains it into Tauri events
    /// named `pty-output-{id}`. If the channel fills, output is dropped and a
    /// log message is emitted to make the loss visible.
    ///
    /// # Environment Variables
    /// - `MAESTRO_SESSION_ID` is automatically set to the session ID
    /// - Additional env vars can be passed via the `env` parameter (e.g., `MAESTRO_PROJECT_HASH`)
    ///
    /// # Windows Debouncing
    /// On Windows, rapid consecutive spawn calls (within 500ms) are rejected to prevent
    /// terminal spawning loops (Bug #76).
    pub fn spawn_shell(
        &self,
        app_handle: AppHandle,
        cwd: Option<String>,
        env: Option<HashMap<String, String>>,
    ) -> Result<u32, PtyError> {
        // Windows spawn debounce: prevent rapid consecutive spawns (Bug #76)
        #[cfg(windows)]
        {
            let mut last = self
                .inner
                .last_spawn_time
                .lock()
                .map_err(|e| PtyError::spawn_failed(format!("Spawn time lock poisoned: {e}")))?;
            let elapsed = last.elapsed();
            if elapsed < std::time::Duration::from_millis(500) {
                log::warn!(
                    "Windows spawn debounce: rejecting spawn attempt {}ms after previous spawn",
                    elapsed.as_millis()
                );
                return Err(PtyError::spawn_failed(
                    "Too rapid spawn attempts - please wait before spawning another session",
                ));
            }
            *last = std::time::Instant::now();
        }

        let id = self
            .inner
            .next_id
            .fetch_update(Ordering::Relaxed, Ordering::Relaxed, |current| {
                current.checked_add(1)
            })
            .map_err(|_| PtyError::id_overflow())?;

        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| PtyError::spawn_failed(format!("Failed to open PTY: {e}")))?;

        // Determine the user's shell (platform-specific)
        #[cfg(unix)]
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".to_string());
        #[cfg(windows)]
        let shell = std::env::var("COMSPEC").unwrap_or_else(|_| "cmd.exe".to_string());

        let mut cmd = CommandBuilder::new(&shell);
        #[cfg(unix)]
        cmd.arg("-l"); // Login shell for proper env on Unix

        // Set TERM for proper terminal emulation on Unix.
        // xterm-256color is the standard for modern terminal emulators and enables:
        // - Proper cursor positioning and line editing
        // - 256-color support
        // - Correct handling of escape sequences
        //
        // On Windows, we don't set TERM because:
        // - Windows ConPTY handles terminal emulation internally
        // - cmd.exe/PowerShell don't use the TERM variable
        // - Setting TERM can cause shell initialization issues (Issue #93)
        #[cfg(unix)]
        cmd.env("TERM", "xterm-256color");

        // Inject MAESTRO_SESSION_ID automatically (used by MCP status server)
        cmd.env("MAESTRO_SESSION_ID", id.to_string());

        // Apply any additional environment variables from caller
        if let Some(envs) = env {
            for (key, value) in envs {
                cmd.env(&key, &value);
            }
        }

        if let Some(ref dir) = cwd {
            cmd.cwd(dir);
        }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| PtyError::spawn_failed(format!("Failed to spawn shell: {e}")))?;

        let child_pid = child
            .process_id()
            .map(|pid| pid as i32)
            .ok_or_else(|| PtyError::spawn_failed("Could not obtain child PID"))?;

        // Capture process group ID before moving master into Mutex (Unix only).
        // portable-pty calls setsid() on spawn, so PGID == child PID.
        // Using the API is safer than assuming the identity holds.
        #[cfg(unix)]
        let pgid = pair.master.process_group_leader().unwrap_or(child_pid);

        // Get writer from master
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| PtyError::spawn_failed(format!("Failed to take PTY writer: {e}")))?;

        // Get reader from master
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| PtyError::spawn_failed(format!("Failed to clone PTY reader: {e}")))?;

        let shutdown = Arc::new(Notify::new());
        let shutdown_clone = shutdown.clone();

        // Dedicated OS thread for reading PTY output.
        // Sends data through a bounded mpsc channel (~1 MB of 4 KB chunks) to a
        // tokio task that emits Tauri events.
        let (tx, mut rx) = tokio::sync::mpsc::channel::<Vec<u8>>(256);

        // Shutdown mechanism: dropping the master/writer FDs closes the PTY
        // file descriptor, which causes the blocking `reader.read()` call
        // below to return `Ok(0)` (EOF). This is the primary way the reader
        // thread terminates — no explicit signal is needed.
        let reader_handle = std::thread::Builder::new()
            .name(format!("pty-reader-{id}"))
            .spawn(move || {
                let mut buf = [0u8; 4096];
                loop {
                    match reader.read(&mut buf) {
                        Ok(0) => break, // EOF — shell exited
                        Ok(n) => {
                            // blocking_send is used because this is an OS thread, not async.
                            // If the channel is full or closed, we break out of the loop.
                            if tx.blocking_send(buf[..n].to_vec()).is_err() {
                                log::warn!(
                                    "PTY reader {id}: channel send failed, dropping {} bytes",
                                    n
                                );
                                break; // Channel full or receiver dropped
                            }
                        }
                        Err(e) => {
                            // EAGAIN/EINTR are retriable on Unix; anything else is fatal
                            #[cfg(unix)]
                            {
                                let raw = e.raw_os_error().unwrap_or(0);
                                if raw == libc::EAGAIN || raw == libc::EINTR {
                                    continue;
                                }
                            }
                            log::debug!("PTY reader {id} error: {e}");
                            break;
                        }
                    }
                }
                log::debug!("PTY reader {id} exited");
            })
            .map_err(|e| PtyError::spawn_failed(format!("Failed to spawn reader thread: {e}")))?;

        // Tokio task: drain the channel and emit Tauri events
        let event_name = format!("pty-output-{id}");
        let app = app_handle.clone();
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
                            None => break, // Channel closed
                        }
                    }
                    _ = shutdown_clone.notified() => {
                        break;
                    }
                }
            }
            log::debug!("PTY event emitter {id} exited");
        });

        // Drop the slave — the master keeps the PTY alive
        drop(pair.slave);

        let session = PtySession {
            writer: Mutex::new(writer),
            master: Mutex::new(pair.master),
            child_pid,
            #[cfg(unix)]
            pgid,
            shutdown,
            reader_handle: Mutex::new(Some(reader_handle)),
        };

        self.inner.sessions.insert(id, session);
        #[cfg(unix)]
        log::info!("Spawned PTY session {id} (pid={child_pid}, pgid={pgid}, shell={shell})");
        #[cfg(windows)]
        log::info!("Spawned PTY session {id} (pid={child_pid}, shell={shell})");

        Ok(id)
    }

    /// Writes raw bytes to a session's PTY stdin and flushes immediately.
    ///
    /// Acquires the writer mutex; returns `WriteFailed` if the lock is poisoned
    /// (indicating a prior panic) or if the underlying write/flush fails.
    pub fn write_stdin(&self, session_id: u32, data: &str) -> Result<(), PtyError> {
        let session = self
            .inner
            .sessions
            .get(&session_id)
            .ok_or_else(|| PtyError::session_not_found(session_id))?;

        let mut writer = session
            .writer
            .lock()
            .map_err(|e| PtyError::write_failed(format!("Writer lock poisoned: {e}")))?;

        writer
            .write_all(data.as_bytes())
            .map_err(|e| PtyError::write_failed(format!("Write failed: {e}")))?;

        writer
            .flush()
            .map_err(|e| PtyError::write_failed(format!("Flush failed: {e}")))?;

        Ok(())
    }

    /// Resizes the PTY to the given dimensions, propagating SIGWINCH to the child.
    ///
    /// Pixel dimensions are always set to 0 (unused by terminal emulators).
    /// Callers should validate that rows/cols are non-zero before calling.
    pub fn resize_pty(&self, session_id: u32, rows: u16, cols: u16) -> Result<(), PtyError> {
        let session = self
            .inner
            .sessions
            .get(&session_id)
            .ok_or_else(|| PtyError::session_not_found(session_id))?;

        let master = session
            .master
            .lock()
            .map_err(|e| PtyError::resize_failed(format!("Master lock poisoned: {e}")))?;

        master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| PtyError::resize_failed(format!("Resize failed: {e}")))?;

        Ok(())
    }

    /// Terminates a PTY session with graceful escalation.
    ///
    /// On Unix: Sends SIGTERM to the entire process group (via negative PGID),
    /// waits up to 3 seconds for the lead process to exit, then escalates to
    /// SIGKILL if it is still alive.
    ///
    /// On Windows: Uses taskkill to terminate the process tree.
    ///
    /// After signaling, drops the master/writer FDs to EOF the reader thread,
    /// notifies the tokio event emitter to shut down, and joins the reader
    /// thread via `spawn_blocking` to avoid blocking the async runtime.
    /// The session is removed from the map before signaling, so concurrent
    /// calls with the same ID return `SessionNotFound`.
    pub async fn kill_session(&self, session_id: u32) -> Result<(), PtyError> {
        let session = self
            .inner
            .sessions
            .remove(&session_id)
            .ok_or_else(|| PtyError::session_not_found(session_id))?
            .1;

        let pid = session.child_pid;

        #[cfg(unix)]
        {
            let pgid = session.pgid;

            // Send SIGTERM to the process group (negative pgid targets the group)
            let term_result = unsafe { libc::kill(-pgid, libc::SIGTERM) };
            if term_result != 0 {
                log::warn!(
                    "Failed to SIGTERM session {session_id} (pgid={pgid}): {}",
                    std::io::Error::last_os_error()
                );
            }

            // Wait up to 3 seconds for the lead process to exit
            let exited = tokio::time::timeout(std::time::Duration::from_secs(3), async {
                loop {
                    let result = unsafe { libc::kill(pid, 0) };
                    if result != 0 {
                        return; // Process gone
                    }
                    tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                }
            })
            .await;

            if exited.is_err() {
                // Still alive after grace period — SIGKILL the process group
                let kill_result = unsafe { libc::kill(-pgid, libc::SIGKILL) };
                if kill_result != 0 {
                    log::warn!(
                        "Failed to SIGKILL session {session_id} (pgid={pgid}): {}",
                        std::io::Error::last_os_error()
                    );
                }
                log::warn!("Session {session_id} (pid={pid}, pgid={pgid}) required SIGKILL");
            }
        }

        #[cfg(windows)]
        {
            use std::process::Command;
            use super::windows_process::StdCommandExt;
            // Use taskkill to terminate process tree
            let result = Command::new("taskkill")
                .args(["/PID", &pid.to_string(), "/T", "/F"])
                .hide_console_window()
                .output();

            if let Err(e) = result {
                log::warn!("Failed to taskkill session {session_id} (pid={pid}): {e}");
            }
        }

        // Signal the tokio event emitter to shut down
        session.shutdown.notify_one();

        // Drop the master and writer first — this closes the PTY fd,
        // which causes the reader thread to get EOF and exit.
        drop(session.writer);
        drop(session.master);

        // Join the reader thread off the async runtime to avoid blocking tokio
        let reader_handle = session
            .reader_handle
            .lock()
            .map_err(|e| log::warn!("Reader handle lock poisoned during cleanup: {e}"))
            .ok()
            .and_then(|mut h| h.take());

        if let Some(handle) = reader_handle {
            let _ = tokio::task::spawn_blocking(move || handle.join()).await;
        }

        log::info!("Killed PTY session {session_id}");
        Ok(())
    }

    /// Returns the child PID for a specific session.
    ///
    /// Returns None if the session doesn't exist.
    pub fn get_session_pid(&self, session_id: u32) -> Option<i32> {
        self.inner
            .sessions
            .get(&session_id)
            .map(|session| session.child_pid)
    }

    /// Returns all active session IDs with their root PIDs.
    ///
    /// Used for building process trees for all sessions at once.
    pub fn get_all_session_pids(&self) -> Vec<(u32, i32)> {
        self.inner
            .sessions
            .iter()
            .map(|entry| (*entry.key(), entry.value().child_pid))
            .collect()
    }

    /// Kills all active PTY sessions.
    ///
    /// This is used to clean up orphaned sessions when the frontend reloads.
    /// Returns the number of sessions that were killed.
    pub async fn kill_all_sessions(&self) -> Result<u32, PtyError> {
        let session_ids: Vec<u32> = self
            .inner
            .sessions
            .iter()
            .map(|entry| *entry.key())
            .collect();

        let count = session_ids.len() as u32;
        log::info!("Killing all {} PTY sessions", count);

        for id in session_ids {
            if let Err(e) = self.kill_session(id).await {
                log::warn!("Failed to kill session {}: {}", id, e);
            }
        }

        Ok(count)
    }
}
