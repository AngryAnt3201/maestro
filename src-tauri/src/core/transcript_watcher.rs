//! Watches Claude Code transcript JSONL files for new content and feeds
//! parsed events into the [`EventBus`].
//!
//! Each session gets its own [`notify`] filesystem watcher and a dedicated
//! tokio task that reads new lines incrementally, parses them via
//! [`parse_transcript_line`](super::transcript_parser::parse_transcript_line),
//! and emits the resulting [`ClaudeEvent`]s.

use std::fs::File;
use std::io::{BufRead, BufReader, Seek, SeekFrom};
use std::path::PathBuf;
use std::sync::Arc;

use dashmap::DashMap;
use notify::{Event as NotifyEvent, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;
use tokio::task::JoinHandle;

#[cfg(test)]
use super::claude_event::ClaudeEvent;
use super::event_bus::EventBus;
use super::transcript_parser::parse_transcript_line;

/// Manages filesystem watchers for Claude Code transcript JSONL files.
///
/// Each watched session has its own `notify` watcher monitoring the parent
/// directory of the transcript file, plus a tokio task that reads new lines
/// as they are appended.
pub struct TranscriptWatcher {
    watchers: DashMap<u32, WatcherState>,
    event_bus: Arc<EventBus>,
}

struct WatcherState {
    _watcher: RecommendedWatcher,
    task_handle: JoinHandle<()>,
}

impl TranscriptWatcher {
    /// Create a new `TranscriptWatcher` that will emit parsed events to `event_bus`.
    pub fn new(event_bus: Arc<EventBus>) -> Self {
        Self {
            watchers: DashMap::new(),
            event_bus,
        }
    }

    /// Start watching a transcript JSONL file for a given session.
    ///
    /// Reads any existing content first (catch-up), then watches for new
    /// writes using `notify`. If the session is already being watched, this
    /// is a no-op.
    pub fn start_watching(&self, session_id: u32, transcript_path: PathBuf) {
        if self.watchers.contains_key(&session_id) {
            log::warn!(
                "TranscriptWatcher: session {session_id} is already being watched, ignoring"
            );
            return;
        }

        let (tx, rx) = mpsc::channel::<()>(64);

        // Create the notify watcher that sends a signal on any file change.
        let watcher = {
            let tx = tx.clone();
            let watched_path = transcript_path.clone();
            let mut watcher =
                notify::recommended_watcher(move |res: Result<NotifyEvent, notify::Error>| {
                    match res {
                        Ok(event) => {
                            // Only care about events that touch our transcript file.
                            let dominated = event.paths.iter().any(|p| p == &watched_path);
                            if dominated {
                                let _ = tx.blocking_send(());
                            }
                        }
                        Err(e) => {
                            log::error!("TranscriptWatcher: notify error: {e}");
                        }
                    }
                })
                .expect("failed to create filesystem watcher");

            // Watch the parent directory so we catch file creation as well.
            let watch_dir = transcript_path
                .parent()
                .unwrap_or(&transcript_path)
                .to_path_buf();

            if let Err(e) = watcher.watch(&watch_dir, RecursiveMode::NonRecursive) {
                log::error!(
                    "TranscriptWatcher: failed to watch directory {}: {e}",
                    watch_dir.display()
                );
            }

            watcher
        };

        // Spawn a tokio task that reads new lines whenever notified.
        let event_bus = Arc::clone(&self.event_bus);
        let path = transcript_path.clone();
        let task_handle = tokio::spawn(async move {
            reader_task(session_id, path, rx, event_bus).await;
        });

        self.watchers.insert(
            session_id,
            WatcherState {
                _watcher: watcher,
                task_handle,
            },
        );

        // Send an initial signal so the task does a catch-up read of any
        // existing content.
        let _ = tx.try_send(());

        log::info!(
            "TranscriptWatcher: started watching session {session_id} at {}",
            transcript_path.display()
        );
    }

    /// Stop watching a session's transcript file and clean up resources.
    #[allow(dead_code)]
    pub fn stop_watching(&self, session_id: u32) {
        if let Some((_, state)) = self.watchers.remove(&session_id) {
            state.task_handle.abort();
            log::info!("TranscriptWatcher: stopped watching session {session_id}");
        }
    }

    /// Return the list of session IDs currently being watched.
    #[allow(dead_code)]
    pub fn watched_sessions(&self) -> Vec<u32> {
        self.watchers.iter().map(|entry| *entry.key()).collect()
    }
}

impl Drop for TranscriptWatcher {
    fn drop(&mut self) {
        for entry in self.watchers.iter() {
            entry.value().task_handle.abort();
        }
    }
}

// ---------------------------------------------------------------------------
// Internal: reader task
// ---------------------------------------------------------------------------

/// Long-running task that drains filesystem notifications and reads new lines.
async fn reader_task(
    session_id: u32,
    path: PathBuf,
    mut rx: mpsc::Receiver<()>,
    event_bus: Arc<EventBus>,
) {
    let mut byte_offset: u64 = 0;

    while rx.recv().await.is_some() {
        // Coalesce rapid notifications: drain any buffered signals so we
        // only read once per burst.
        while rx.try_recv().is_ok() {}

        byte_offset = read_new_lines(session_id, &path, byte_offset, &event_bus);
    }

    log::debug!("TranscriptWatcher: reader task for session {session_id} exiting");
}

// ---------------------------------------------------------------------------
// Internal: incremental line reader
// ---------------------------------------------------------------------------

/// Read new lines from `path` starting at `byte_offset`, parse each one, and
/// emit the resulting events on `event_bus`.
///
/// Returns the updated byte offset (pointing just past the last byte read).
/// If the file does not exist, returns the same `byte_offset` without error.
fn read_new_lines(session_id: u32, path: &PathBuf, byte_offset: u64, event_bus: &EventBus) -> u64 {
    let file = match File::open(path) {
        Ok(f) => f,
        Err(e) => {
            if e.kind() != std::io::ErrorKind::NotFound {
                log::error!("TranscriptWatcher: failed to open {}: {e}", path.display());
            }
            return byte_offset;
        }
    };

    let mut reader = BufReader::new(file);

    if byte_offset > 0 {
        if let Err(e) = reader.seek(SeekFrom::Start(byte_offset)) {
            log::error!("TranscriptWatcher: seek error: {e}");
            return byte_offset;
        }
    }

    let mut current_offset = byte_offset;
    let mut line_buf = String::new();

    loop {
        line_buf.clear();
        match reader.read_line(&mut line_buf) {
            Ok(0) => break, // EOF
            Ok(n) => {
                current_offset += n as u64;
                let trimmed = line_buf.trim();
                if !trimmed.is_empty() {
                    let events = parse_transcript_line(session_id, trimmed);
                    for event in events {
                        event_bus.emit(event);
                    }
                }
            }
            Err(e) => {
                log::error!("TranscriptWatcher: read error: {e}");
                break;
            }
        }
    }

    current_offset
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use tempfile::NamedTempFile;

    /// Test JSONL line representing a user message.
    const USER_MSG_LINE: &str = r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hello"}]},"uuid":"u1","timestamp":"2026-02-24T10:00:00Z"}"#;

    /// Create an EventBus that captures emitted events into a shared Vec.
    fn test_event_bus() -> (Arc<EventBus>, Arc<std::sync::Mutex<Vec<ClaudeEvent>>>) {
        let collected = Arc::new(std::sync::Mutex::new(Vec::<ClaudeEvent>::new()));
        let collected_clone = Arc::clone(&collected);
        let bus = EventBus::new(Arc::new(move |event: ClaudeEvent| {
            collected_clone.lock().unwrap().push(event);
        }));
        (Arc::new(bus), collected)
    }

    #[test]
    fn test_read_new_lines_empty_file() {
        let file = NamedTempFile::new().expect("create temp file");
        let path = file.path().to_path_buf();
        let (bus, collected) = test_event_bus();

        let new_offset = read_new_lines(1, &path, 0, &bus);

        assert_eq!(new_offset, 0, "empty file should keep offset at 0");
        assert!(
            collected.lock().unwrap().is_empty(),
            "empty file should produce no events"
        );
    }

    #[test]
    fn test_read_new_lines_with_content() {
        let mut file = NamedTempFile::new().expect("create temp file");
        writeln!(file, "{}", USER_MSG_LINE).expect("write line");
        file.flush().expect("flush");

        let path = file.path().to_path_buf();
        let (bus, collected) = test_event_bus();

        let new_offset = read_new_lines(1, &path, 0, &bus);

        assert!(
            new_offset > 0,
            "offset should advance past the written line"
        );

        let events = collected.lock().unwrap();
        assert_eq!(events.len(), 1, "one JSONL line should produce one event");

        match &events[0] {
            ClaudeEvent::UserMessage {
                session_id,
                uuid,
                text,
                ..
            } => {
                assert_eq!(*session_id, 1);
                assert_eq!(uuid, "u1");
                assert_eq!(text, "hello");
            }
            other => panic!("expected UserMessage, got {other:?}"),
        }
    }

    #[test]
    fn test_read_new_lines_incremental() {
        let mut file = NamedTempFile::new().expect("create temp file");

        // Write first line.
        writeln!(file, "{}", USER_MSG_LINE).expect("write first line");
        file.flush().expect("flush");

        let path = file.path().to_path_buf();
        let (bus, collected) = test_event_bus();

        // First read picks up the first line.
        let offset1 = read_new_lines(1, &path, 0, &bus);
        assert_eq!(
            collected.lock().unwrap().len(),
            1,
            "first read should yield 1 event"
        );

        // Write a second line (different uuid to avoid dedup).
        let second_line = r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"world"}]},"uuid":"u2","timestamp":"2026-02-24T10:01:00Z"}"#;
        writeln!(file, "{}", second_line).expect("write second line");
        file.flush().expect("flush");

        // Second read starts from offset1 and should only pick up the new line.
        let offset2 = read_new_lines(1, &path, offset1, &bus);
        assert!(
            offset2 > offset1,
            "offset should advance after reading second line"
        );

        let events = collected.lock().unwrap();
        assert_eq!(
            events.len(),
            2,
            "second read should add exactly 1 more event (total 2)"
        );

        // Verify the second event has the right text.
        match &events[1] {
            ClaudeEvent::UserMessage { text, uuid, .. } => {
                assert_eq!(text, "world");
                assert_eq!(uuid, "u2");
            }
            other => panic!("expected UserMessage for second event, got {other:?}"),
        }
    }

    #[test]
    fn test_read_nonexistent_file() {
        let path = PathBuf::from("/tmp/nonexistent_transcript_test_file_12345.jsonl");
        let (bus, collected) = test_event_bus();

        let new_offset = read_new_lines(1, &path, 0, &bus);

        assert_eq!(new_offset, 0, "nonexistent file should return offset 0");
        assert!(
            collected.lock().unwrap().is_empty(),
            "nonexistent file should produce no events"
        );
    }

    /// Integration test: verifies the full TranscriptWatcher + EventBus flow
    /// end-to-end by writing JSONL transcript data, starting a watcher, and
    /// asserting that events are parsed and emitted through the EventBus.
    #[tokio::test]
    async fn test_full_transcript_watcher_flow() {
        use std::time::Duration;

        // 1. Set up EventBus with event capture
        let (event_bus, captured) = test_event_bus();

        // 2. Create TranscriptWatcher
        let watcher = TranscriptWatcher::new(event_bus);

        // 3. Create a temp directory and transcript file with initial content.
        //    Using tempdir() + explicit file ensures the notify watcher can
        //    reliably detect changes on macOS FSEvents.
        let dir = tempfile::tempdir().unwrap();
        let transcript_path = dir.path().join("transcript.jsonl");
        {
            let line1 = r#"{"type":"user","message":{"role":"user","content":[{"type":"text","text":"hello world"}]},"uuid":"msg-001","timestamp":"2026-02-24T10:00:00Z"}"#;
            let mut f = std::fs::File::create(&transcript_path).unwrap();
            writeln!(f, "{}", line1).unwrap();
            f.flush().unwrap();
        }

        // 4. Start watching the transcript file.
        //    Canonicalize the path so that on macOS the notify watcher's path
        //    comparison works correctly (/var/folders -> /private/var/folders).
        let canonical_path = transcript_path.canonicalize().unwrap();
        watcher.start_watching(1, canonical_path.clone());

        // 5. Wait for the initial catch-up read to process existing content
        tokio::time::sleep(Duration::from_millis(500)).await;

        // 6. Verify the initial UserMessage was parsed and emitted
        {
            let events = captured.lock().unwrap();
            assert!(
                events.iter().any(|e| matches!(
                    e,
                    ClaudeEvent::UserMessage { text, .. } if text == "hello world"
                )),
                "Expected UserMessage with 'hello world', got {:?}",
                *events
            );
        }

        // 7. Append an assistant message with an Edit tool_use.
        //    Open-append-close to produce a distinct filesystem event.
        {
            let line2 = r#"{"type":"assistant","message":{"model":"claude-opus-4-6","content":[{"type":"tool_use","id":"toolu_001","name":"Edit","input":{"file_path":"/src/main.rs","old_string":"old","new_string":"new"}}],"usage":{"input_tokens":100,"output_tokens":50}},"uuid":"msg-002","timestamp":"2026-02-24T10:00:05Z"}"#;
            let mut f = std::fs::OpenOptions::new()
                .append(true)
                .open(&canonical_path)
                .unwrap();
            writeln!(f, "{}", line2).unwrap();
            f.flush().unwrap();
        }

        // 8. Poll for the expected event with a generous timeout.
        //    macOS FSEvents can have variable latency, so we poll rather than
        //    doing a single fixed sleep.
        let deadline = tokio::time::Instant::now() + Duration::from_secs(10);
        loop {
            tokio::time::sleep(Duration::from_millis(250)).await;
            let events = captured.lock().unwrap();
            let has_file_edited = events.iter().any(|e| {
                matches!(
                    e,
                    ClaudeEvent::FileEdited { file_path, .. } if file_path == "/src/main.rs"
                )
            });
            if has_file_edited {
                break;
            }
            if tokio::time::Instant::now() >= deadline {
                panic!("Timed out waiting for FileEdited event. Got {:?}", *events);
            }
        }

        // 9. Verify all expected events were emitted
        {
            let events = captured.lock().unwrap();
            assert!(
                events.iter().any(|e| matches!(
                    e,
                    ClaudeEvent::FileEdited { file_path, .. } if file_path == "/src/main.rs"
                )),
                "Expected FileEdited for /src/main.rs, got {:?}",
                *events
            );
            assert!(
                events.iter().any(|e| matches!(
                    e,
                    ClaudeEvent::ToolUseStarted { tool_name, .. } if tool_name == "Edit"
                )),
                "Expected ToolUseStarted for Edit, got {:?}",
                *events
            );
        }

        // 10. Verify watched sessions tracking
        assert_eq!(watcher.watched_sessions(), vec![1]);

        // 11. Cleanup: stop watching and verify it was removed
        watcher.stop_watching(1);
        assert!(watcher.watched_sessions().is_empty());
    }
}
