//! Central event dispatcher with deduplication.
//!
//! The [`EventBus`] accepts [`ClaudeEvent`]s via [`emit`](EventBus::emit),
//! deduplicates them within a 5-second window using each event's
//! [`dedup_key`](super::claude_event::ClaudeEvent::dedup_key), and forwards
//! unique events to a caller-supplied callback.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

use super::claude_event::ClaudeEvent;

/// Maximum number of entries kept in the dedup cache before a full eviction
/// sweep is triggered.
const DEDUP_CACHE_CAP: usize = 10_000;

/// How long a dedup key is remembered before it is considered expired and may
/// be emitted again.
const DEDUP_WINDOW: Duration = Duration::from_secs(5);

/// A central event dispatcher that deduplicates events within a time window.
///
/// Thread-safe: all mutable state is behind a `std::sync::Mutex`.
pub struct EventBus {
    callback: Arc<dyn Fn(ClaudeEvent) + Send + Sync>,
    dedup_cache: Mutex<HashMap<String, Instant>>,
}

impl EventBus {
    /// Create a new `EventBus` that forwards non-duplicate events to `callback`.
    pub fn new(callback: Arc<dyn Fn(ClaudeEvent) + Send + Sync>) -> Self {
        Self {
            callback,
            dedup_cache: Mutex::new(HashMap::new()),
        }
    }

    /// Emit an event. If the same `dedup_key` was seen within the last 5
    /// seconds, the event is silently dropped. Otherwise it is forwarded to the
    /// registered callback.
    pub fn emit(&self, event: ClaudeEvent) {
        let key = event.dedup_key();
        let now = Instant::now();

        let mut cache = self.dedup_cache.lock().expect("dedup cache lock poisoned");

        // Check whether the key is already present and still within the window.
        if let Some(&seen_at) = cache.get(&key) {
            if now.duration_since(seen_at) < DEDUP_WINDOW {
                // Duplicate – drop silently.
                return;
            }
        }

        // Evict expired entries if the cache has grown too large.
        if cache.len() >= DEDUP_CACHE_CAP {
            cache.retain(|_, &mut seen_at| now.duration_since(seen_at) < DEDUP_WINDOW);
        }

        // Record this key.
        cache.insert(key, now);

        // Release the lock before calling back to avoid holding it across
        // user-supplied code.
        drop(cache);

        (self.callback)(event);
    }

    /// Clear the dedup cache entirely.  Useful for testing and cleanup.
    #[cfg(test)]
    pub fn clear_dedup_cache(&self) {
        let mut cache = self.dedup_cache.lock().expect("dedup cache lock poisoned");
        cache.clear();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    /// Helper: build a simple counter-based EventBus and return the bus + counter.
    fn bus_with_counter() -> (EventBus, Arc<AtomicUsize>) {
        let counter = Arc::new(AtomicUsize::new(0));
        let c = Arc::clone(&counter);
        let bus = EventBus::new(Arc::new(move |_event: ClaudeEvent| {
            c.fetch_add(1, Ordering::SeqCst);
        }));
        (bus, counter)
    }

    /// Helper: produce a `UserMessage` event with the given uuid.
    fn user_msg(uuid: &str) -> ClaudeEvent {
        ClaudeEvent::UserMessage {
            session_id: 1,
            uuid: uuid.to_string(),
            text: "hello".to_string(),
            timestamp: "2026-02-24T00:00:00Z".to_string(),
        }
    }

    #[test]
    fn test_emit_single_event() {
        let (bus, counter) = bus_with_counter();
        bus.emit(user_msg("uuid-1"));
        assert_eq!(counter.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn test_dedup_identical_events() {
        let (bus, counter) = bus_with_counter();
        bus.emit(user_msg("uuid-dup"));
        bus.emit(user_msg("uuid-dup"));
        bus.emit(user_msg("uuid-dup"));
        assert_eq!(
            counter.load(Ordering::SeqCst),
            1,
            "identical events should be deduped"
        );
    }

    #[test]
    fn test_different_events_not_deduped() {
        let (bus, counter) = bus_with_counter();
        bus.emit(user_msg("uuid-a"));
        bus.emit(user_msg("uuid-b"));
        bus.emit(user_msg("uuid-c"));
        assert_eq!(
            counter.load(Ordering::SeqCst),
            3,
            "distinct events should all pass through"
        );
    }

    #[test]
    fn test_clear_dedup_cache() {
        let (bus, counter) = bus_with_counter();
        bus.emit(user_msg("uuid-clear"));
        assert_eq!(counter.load(Ordering::SeqCst), 1);

        // Same event should be deduped.
        bus.emit(user_msg("uuid-clear"));
        assert_eq!(counter.load(Ordering::SeqCst), 1);

        // After clearing, the same event should pass through again.
        bus.clear_dedup_cache();
        bus.emit(user_msg("uuid-clear"));
        assert_eq!(counter.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn test_mixed_event_types() {
        let (bus, counter) = bus_with_counter();

        bus.emit(ClaudeEvent::UserMessage {
            session_id: 1,
            uuid: "msg-1".to_string(),
            text: "hi".to_string(),
            timestamp: "t".to_string(),
        });

        bus.emit(ClaudeEvent::ToolUseStarted {
            session_id: 1,
            tool_name: "Read".to_string(),
            tool_use_id: "toolu-1".to_string(),
            input_summary: "file.rs".to_string(),
            timestamp: "t".to_string(),
        });

        bus.emit(ClaudeEvent::FileEdited {
            session_id: 1,
            file_path: "/src/main.rs".to_string(),
            tool: "Edit".to_string(),
            timestamp: "t".to_string(),
        });

        assert_eq!(
            counter.load(Ordering::SeqCst),
            3,
            "different event types should all pass through"
        );
    }
}
