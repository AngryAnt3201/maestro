use std::path::{Path, PathBuf};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use super::error::GitHubError;
use crate::core::windows_process::TokioCommandExt;

/// Captured stdout/stderr from a completed gh subprocess.
///
/// Provides convenience methods for common parsing patterns.
#[derive(Debug)]
pub struct GitHubOutput {
    pub stdout: String,
    pub stderr: String,
}

impl GitHubOutput {
    /// Splits stdout into non-empty lines, filtering out blank lines.
    pub fn lines(&self) -> Vec<&str> {
        self.stdout.lines().filter(|l| !l.is_empty()).collect()
    }

    /// Returns stdout with leading/trailing whitespace removed.
    pub fn trimmed(&self) -> &str {
        self.stdout.trim()
    }
}

/// Low-level GitHub CLI command runner bound to a specific repository path.
///
/// All commands are invoked via `tokio::process::Command` with the working
/// directory set to the repository path. Subprocesses are killed on drop
/// via `kill_on_drop(true)`.
#[derive(Debug, Clone)]
pub struct GitHub {
    repo_path: PathBuf,
}

impl GitHub {
    /// Creates a runner targeting the given repository directory.
    pub fn new(repo_path: impl Into<PathBuf>) -> Self {
        Self {
            repo_path: repo_path.into(),
        }
    }

    /// Returns the repository path.
    pub fn repo_path(&self) -> &Path {
        &self.repo_path
    }

    /// Executes a gh subcommand and returns its captured output.
    ///
    /// Returns `GhNotFound` if the gh binary is missing, `SpawnError` for
    /// other I/O failures, and `CommandFailed` for non-zero exit codes.
    /// Both stdout and stderr are decoded as UTF-8 (returns `InvalidUtf8` on failure).
    pub async fn run(&self, args: &[&str]) -> Result<GitHubOutput, GitHubError> {
        let mut cmd = Command::new("gh");
        cmd.current_dir(&self.repo_path)
            .args(args)
            .env("GH_PROMPT_DISABLED", "1")
            .env("NO_COLOR", "1")
            .kill_on_drop(true)
            .hide_console_window();

        let command_str = format!("gh {}", args.join(" "));

        let output = timeout(Duration::from_secs(30), cmd.output())
            .await
            .map_err(|_| GitHubError::CommandFailed {
                code: -1,
                stderr: format!("Command timed out after 30s: {}", command_str),
                command: command_str.clone(),
            })?
            .map_err(|source| {
                if source.kind() == std::io::ErrorKind::NotFound {
                    GitHubError::GhNotFound
                } else {
                    GitHubError::SpawnError {
                        source,
                        command: command_str.clone(),
                    }
                }
            })?;

        let stdout = String::from_utf8(output.stdout)?;
        let stderr = String::from_utf8(output.stderr)?;

        if output.status.success() {
            Ok(GitHubOutput { stdout, stderr })
        } else {
            // Check for specific error conditions
            let stderr_lower = stderr.to_lowercase();
            if stderr_lower.contains("not logged in")
                || stderr_lower.contains("authentication")
                || stderr_lower.contains("gh auth login")
            {
                return Err(GitHubError::NotAuthenticated);
            }
            if stderr_lower.contains("rate limit") {
                return Err(GitHubError::RateLimitExceeded);
            }
            if stderr_lower.contains("not a git repository")
                || stderr_lower.contains("could not determine")
            {
                return Err(GitHubError::NotGitHubRepo);
            }

            Err(GitHubError::CommandFailed {
                code: output.status.code().unwrap_or(-1),
                stderr: stderr.trim().to_string(),
                command: command_str,
            })
        }
    }

    /// Executes a gh subcommand with JSON output format and deserializes the result.
    pub async fn run_json<T: serde::de::DeserializeOwned>(
        &self,
        args: &[&str],
    ) -> Result<T, GitHubError> {
        let output = self.run(args).await?;
        let parsed: T = serde_json::from_str(&output.stdout)?;
        Ok(parsed)
    }

    /// Executes a GraphQL query via `gh api graphql`.
    pub async fn graphql(&self, query: &str) -> Result<serde_json::Value, GitHubError> {
        let output = self.run(&["api", "graphql", "-f", &format!("query={}", query)]).await?;
        let parsed: serde_json::Value = serde_json::from_str(&output.stdout)?;
        Ok(parsed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // GitHubOutput utility tests

    #[test]
    fn test_github_output_lines() {
        let output = GitHubOutput {
            stdout: "line1\nline2\n\nline3\n".to_string(),
            stderr: String::new(),
        };
        assert_eq!(output.lines(), vec!["line1", "line2", "line3"]);
    }

    #[test]
    fn test_github_output_lines_empty() {
        let output = GitHubOutput {
            stdout: String::new(),
            stderr: String::new(),
        };
        assert!(output.lines().is_empty());
    }

    #[test]
    fn test_github_output_trimmed() {
        let output = GitHubOutput {
            stdout: "  hello world  \n".to_string(),
            stderr: String::new(),
        };
        assert_eq!(output.trimmed(), "hello world");
    }

    // GitHub runner integration tests (require gh CLI installed)

    #[tokio::test]
    async fn test_gh_version_command() {
        let gh = GitHub::new(".");
        let result = gh.run(&["--version"]).await;
        // This test will pass if gh is installed, fail gracefully if not
        match result {
            Ok(output) => {
                assert!(
                    output.stdout.contains("gh version"),
                    "output should contain 'gh version'"
                );
            }
            Err(GitHubError::GhNotFound) => {
                // gh not installed - this is acceptable in CI
                println!("gh CLI not installed, skipping test");
            }
            Err(e) => panic!("Unexpected error: {:?}", e),
        }
    }

    #[test]
    fn test_github_error_serialization() {
        let err = GitHubError::GhNotFound;
        let json = serde_json::to_string(&err).unwrap();
        assert!(json.contains("GitHub CLI"));
    }

    #[test]
    fn test_not_authenticated_error_message() {
        let err = GitHubError::NotAuthenticated;
        assert!(err.to_string().contains("gh auth login"));
    }
}
