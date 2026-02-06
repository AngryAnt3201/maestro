/// All possible errors from GitHub CLI operations, serialized as a string to the
/// Tauri frontend via the custom `Serialize` impl below.
#[derive(Debug, thiserror::Error)]
pub enum GitHubError {
    /// The `gh` CLI binary was not found on `$PATH`.
    #[error("GitHub CLI (gh) not found. Install it from https://cli.github.com")]
    GhNotFound,

    /// User is not authenticated with `gh`.
    #[error("Not authenticated with GitHub. Run `gh auth login` to authenticate.")]
    NotAuthenticated,

    /// A gh command exited with a non-zero status code.
    #[error("gh command failed (exit code {code}): {stderr}")]
    CommandFailed {
        code: i32,
        stderr: String,
        command: String,
    },

    /// A gh command was terminated by a signal before completing.
    #[error("gh command was killed by signal")]
    Killed { command: String },

    /// The gh process could not be spawned (e.g., permission denied).
    #[error("failed to spawn gh process: {source}")]
    SpawnError {
        source: std::io::Error,
        command: String,
    },

    /// gh produced output that is not valid UTF-8.
    #[error("invalid UTF-8 in gh output")]
    InvalidUtf8(#[from] std::string::FromUtf8Error),

    /// Structured output from gh could not be parsed as expected.
    #[error("failed to parse gh output: {message}")]
    ParseError { message: String },

    /// JSON deserialization failed.
    #[error("failed to deserialize JSON: {0}")]
    JsonError(#[from] serde_json::Error),

    /// The repository is not a GitHub repository.
    #[error("not a GitHub repository")]
    NotGitHubRepo,

    /// Discussions are not enabled for this repository.
    #[error("Discussions are not enabled for this repository")]
    DiscussionsNotEnabled,

    /// Rate limit exceeded.
    #[error("GitHub API rate limit exceeded. Try again later.")]
    RateLimitExceeded,

    /// Pull request not found.
    #[error("Pull request #{number} not found")]
    PullRequestNotFound { number: u64 },

    /// Issue not found.
    #[error("Issue #{number} not found")]
    IssueNotFound { number: u64 },
}

/// Serializes the error as its `Display` string so the frontend receives a
/// single human-readable message rather than a tagged enum structure.
impl serde::Serialize for GitHubError {
    fn serialize<S: serde::Serializer>(&self, serializer: S) -> Result<S::Ok, S::Error> {
        serializer.serialize_str(&self.to_string())
    }
}
