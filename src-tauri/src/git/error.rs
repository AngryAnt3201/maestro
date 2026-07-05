use std::path::PathBuf;

/// All possible errors from git operations, serialized as a string to the
/// Tauri frontend via the custom `Serialize` impl below.
///
/// Variants cover the full lifecycle: binary not found, spawn failures,
/// non-zero exits, output encoding issues, and domain-specific errors
/// like duplicate worktree checkouts.
#[derive(Debug, thiserror::Error)]
pub enum GitError {
    /// The `git` binary was not found on `$PATH`.
    #[error("git executable not found. Is git installed?")]
    GitNotFound,

    /// A git command exited with a non-zero status code.
    #[error("git command failed (exit code {code}): {stderr}")]
    CommandFailed {
        code: i32,
        stderr: String,
        command: String,
    },

    /// A git command was terminated by a signal before completing.
    #[error("git command was killed by signal")]
    #[allow(dead_code)]
    Killed { command: String },

    /// The git process could not be spawned (e.g., permission denied).
    #[error("failed to spawn git process: {source}")]
    SpawnError {
        source: std::io::Error,
        command: String,
    },

    /// Git produced output that is not valid UTF-8.
    #[error("invalid UTF-8 in git output")]
    InvalidUtf8(#[from] std::string::FromUtf8Error),

    /// Structured output from git could not be parsed as expected.
    #[error("failed to parse git output: {message}")]
    #[allow(dead_code)]
    ParseError { message: String },

    /// The specified path is not a git repository.
    #[error("repository not found at {path}")]
    NotARepo { path: PathBuf },

    /// The target branch is already checked out in another worktree.
    #[error("branch '{branch}' already checked out at {path}")]
    BranchAlreadyCheckedOut { branch: String, path: String },

    /// The specified worktree path does not exist in git's worktree list.
    #[error("worktree not found: {0}")]
    #[allow(dead_code)]
    WorktreeNotFound(String),
}

/// Serializes the error as its `Display` string so the frontend receives a
/// single human-readable message rather than a tagged enum structure.
impl serde::Serialize for GitError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
