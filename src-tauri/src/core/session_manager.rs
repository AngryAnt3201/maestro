use dashmap::DashMap;
use dashmap::mapref::entry::Entry;
use serde::{Deserialize, Serialize};

/// Which AI backend a session is configured to use.
///
/// `Plain` is a raw terminal with no AI agent attached, useful for
/// manual shell work within a worktree.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AiMode {
    Claude,
    Gemini,
    Codex,
    Ollama,
    Plain,
}

/// Lifecycle state of a session, tracked for UI status indicators.
///
/// Transitions are driven by the frontend; the backend does not enforce
/// a state machine. Invalid transitions (e.g., `Done` -> `Working`) are
/// allowed and the caller is responsible for correctness.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SessionStatus {
    Starting,
    Idle,
    Working,
    NeedsInput,
    Done,
    Error,
}

/// Frontend-visible configuration and state for a single session.
///
/// `branch` and `worktree_path` are `None` until `assign_branch` is called,
/// allowing sessions to be created before their worktree is ready.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SessionConfig {
    pub id: u32,
    pub mode: AiMode,
    pub branch: Option<String>,
    pub status: SessionStatus,
    pub worktree_path: Option<String>,
    /// The project directory this session belongs to.
    /// Canonicalized absolute path for reliable comparison.
    pub project_path: String,
}

/// Thread-safe session registry backed by `DashMap` for lock-free concurrent reads.
///
/// Designed to be placed in Tauri managed state. All methods take `&self` so
/// no exclusive access is needed, enabling safe concurrent access from
/// multiple async command handlers.
pub struct SessionManager {
    sessions: DashMap<u32, SessionConfig>,
}

impl Default for SessionManager {
    fn default() -> Self {
        Self::new()
    }
}

impl SessionManager {
    /// Creates an empty session registry.
    pub fn new() -> Self {
        Self {
            sessions: DashMap::new(),
        }
    }

    /// Inserts a new session with `Idle` status and no branch assigned.
    /// Returns `Err` with the existing config if a session with this ID already exists.
    pub fn create_session(&self, id: u32, mode: AiMode, project_path: String) -> Result<SessionConfig, SessionConfig> {
        let config = SessionConfig {
            id,
            mode,
            branch: None,
            status: SessionStatus::Idle,
            worktree_path: None,
            project_path,
        };
        match self.sessions.entry(id) {
            Entry::Occupied(e) => Err(e.get().clone()),
            Entry::Vacant(e) => {
                e.insert(config.clone());
                Ok(config)
            }
        }
    }

    /// Returns a snapshot of the session config, or `None` if not found.
    pub fn get_session(&self, id: u32) -> Option<SessionConfig> {
        self.sessions.get(&id).map(|s| s.clone())
    }

    /// Updates the session's status in place. Returns `false` if the session
    /// does not exist (no error is raised).
    pub fn update_status(&self, id: u32, status: SessionStatus) -> bool {
        if let Some(mut session) = self.sessions.get_mut(&id) {
            session.status = status;
            true
        } else {
            false
        }
    }

    /// Associates a branch (and optional worktree path) with an existing session.
    /// Returns the updated config, or `None` if the session does not exist.
    pub fn assign_branch(&self, id: u32, branch: String, worktree_path: Option<String>) -> Option<SessionConfig> {
        if let Some(mut session) = self.sessions.get_mut(&id) {
            session.branch = Some(branch);
            session.worktree_path = worktree_path;
            Some(session.clone())
        } else {
            None
        }
    }

    /// Returns a snapshot of all active sessions. Order is not guaranteed.
    pub fn all_sessions(&self) -> Vec<SessionConfig> {
        self.sessions.iter().map(|e| e.value().clone()).collect()
    }

    /// Removes and returns a session. Returns `None` if not found.
    pub fn remove_session(&self, id: u32) -> Option<SessionConfig> {
        self.sessions.remove(&id).map(|(_, v)| v)
    }

    /// Returns all sessions for a specific project path.
    /// Performs an exact match on project paths.
    pub fn get_sessions_for_project(&self, project_path: &str) -> Vec<SessionConfig> {
        self.sessions
            .iter()
            .filter(|entry| entry.value().project_path == project_path)
            .map(|entry| entry.value().clone())
            .collect()
    }

    /// Removes all sessions for a project. Returns the removed configs.
    /// Useful when closing a project tab.
    pub fn remove_sessions_for_project(&self, project_path: &str) -> Vec<SessionConfig> {
        let ids_to_remove: Vec<u32> = self.sessions
            .iter()
            .filter(|entry| entry.value().project_path == project_path)
            .map(|entry| *entry.key())
            .collect();

        ids_to_remove
            .into_iter()
            .filter_map(|id| self.sessions.remove(&id).map(|(_, v)| v))
            .collect()
    }
}
