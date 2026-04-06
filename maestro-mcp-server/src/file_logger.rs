//! File-based logging for the MCP server.
//!
//! Provides a dual-output logger that writes structured log entries to both
//! stderr (safe for MCP stdio protocol) and a persistent log file for
//! post-mortem debugging of disconnections and failures.

use log::{Level, LevelFilter, Log, Metadata, Record};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::path::PathBuf;
use std::sync::Mutex;

/// A logger that writes to both stderr and a log file.
pub struct DualLogger {
    file: Mutex<File>,
}

impl DualLogger {
    /// Initialize the dual logger as the global `log` logger.
    ///
    /// Log files are written to `~/Library/Logs/Maestro/` (macOS) or
    /// `$TMPDIR/maestro-logs/` as fallback. The `MAESTRO_LOG_DIR` env var
    /// overrides the directory.
    ///
    /// Returns the path to the log file on success.
    pub fn init(session_id: Option<u32>) -> Result<PathBuf, Box<dyn std::error::Error>> {
        let log_dir = Self::resolve_log_dir();
        fs::create_dir_all(&log_dir)?;

        let filename = match session_id {
            Some(id) => format!("mcp-server-session-{}.log", id),
            None => "mcp-server.log".to_string(),
        };
        let log_path = log_dir.join(filename);

        let file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(&log_path)?;

        let logger = DualLogger {
            file: Mutex::new(file),
        };

        log::set_boxed_logger(Box::new(logger))?;
        log::set_max_level(LevelFilter::Debug);

        Ok(log_path)
    }

    /// Determine the log directory, checking env var then platform defaults.
    fn resolve_log_dir() -> PathBuf {
        // Allow override via environment variable
        if let Ok(dir) = std::env::var("MAESTRO_LOG_DIR") {
            return PathBuf::from(dir);
        }

        // macOS: ~/Library/Logs/Maestro/
        if let Some(home) = dirs::home_dir() {
            let macos_logs = home.join("Library").join("Logs").join("Maestro");
            if home.join("Library").join("Logs").exists() {
                return macos_logs;
            }
        }

        // Fallback: temp directory
        std::env::temp_dir().join("maestro-logs")
    }
}

impl Log for DualLogger {
    fn enabled(&self, metadata: &Metadata) -> bool {
        metadata.level() <= Level::Debug
    }

    fn log(&self, record: &Record) {
        if !self.enabled(record.metadata()) {
            return;
        }

        let timestamp = chrono::Local::now().format("%Y-%m-%d %H:%M:%S%.3f");
        let level = record.level();
        let target = record.target();
        let message = record.args();

        // Write to stderr (safe for MCP — stdout is reserved for JSON-RPC)
        eprintln!("[{} {} {}] {}", timestamp, level, target, message);

        // Write to log file
        if let Ok(mut file) = self.file.lock() {
            let _ = writeln!(file, "[{} {} {}] {}", timestamp, level, target, message);
            let _ = file.flush();
        }
    }

    fn flush(&self) {
        if let Ok(mut file) = self.file.lock() {
            let _ = file.flush();
        }
    }
}

