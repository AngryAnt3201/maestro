use std::path::{Path, PathBuf};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use super::error::GitError;
use crate::core::windows_process::TokioCommandExt;

/// Captured stdout/stderr from a completed git subprocess.
///
/// Provides convenience methods for common parsing patterns: `lines()` splits
/// stdout into non-empty lines, and `trimmed()` returns whitespace-stripped stdout.
#[derive(Debug)]
pub struct GitOutput {
    pub stdout: String,
    pub stderr: String,
}

impl GitOutput {
    /// Splits stdout into non-empty lines, filtering out blank lines.
    pub fn lines(&self) -> Vec<&str> {
        self.stdout.lines().filter(|l| !l.is_empty()).collect()
    }

    /// Returns stdout with leading/trailing whitespace removed.
    pub fn trimmed(&self) -> &str {
        self.stdout.trim()
    }
}

/// Low-level git command runner bound to a specific repository path.
///
/// All commands are invoked via `tokio::process::Command` with `git -C <repo>`,
/// `GIT_TERMINAL_PROMPT=0` (prevents credential prompts from hanging), and
/// `LC_ALL=C` (ensures English, parseable output). Subprocesses are killed
/// on drop via `kill_on_drop(true)`.
#[derive(Debug, Clone)]
pub struct Git {
    repo_path: PathBuf,
}

impl Git {
    /// Creates a runner targeting the given repository directory.
    pub fn new(repo_path: impl Into<PathBuf>) -> Self {
        Self {
            repo_path: repo_path.into(),
        }
    }

    /// Executes a git subcommand and returns its captured output.
    ///
    /// Returns `GitNotFound` if the git binary is missing, `SpawnError` for
    /// other I/O failures, and `CommandFailed` for non-zero exit codes.
    /// Both stdout and stderr are decoded as UTF-8 (returns `InvalidUtf8` on failure).
    pub async fn run(&self, args: &[&str]) -> Result<GitOutput, GitError> {
        let mut cmd = Command::new("git");
        cmd.arg("-C")
            .arg(&self.repo_path)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("LC_ALL", "C")
            .kill_on_drop(true)
            .hide_console_window();

        let command_str = format!("git -C {} {}", self.repo_path.display(), args.join(" "));

        let output = timeout(Duration::from_secs(30), cmd.output())
            .await
            .map_err(|_| GitError::CommandFailed {
                code: -1,
                stderr: format!("Command timed out after 30s: {}", command_str),
                command: command_str.clone(),
            })?
            .map_err(|source| {
                if source.kind() == std::io::ErrorKind::NotFound {
                    GitError::GitNotFound
                } else {
                    GitError::SpawnError {
                        source,
                        command: command_str.clone(),
                    }
                }
            })?;

        let stdout = String::from_utf8(output.stdout)?;
        let stderr = String::from_utf8(output.stderr)?;

        if output.status.success() {
            Ok(GitOutput { stdout, stderr })
        } else {
            Err(GitError::CommandFailed {
                code: output.status.code().unwrap_or(-1),
                stderr: stderr.trim().to_string(),
                command: command_str,
            })
        }
    }

    /// Convenience wrapper that runs a git command in a different directory
    /// by constructing a temporary `Git` instance for that path.
    pub async fn run_in(&self, path: &Path, args: &[&str]) -> Result<GitOutput, GitError> {
        Git::new(path).run(args).await
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // GitOutput utility tests

    #[test]
    fn test_git_output_lines() {
        let output = GitOutput {
            stdout: "line1\nline2\n\nline3\n".to_string(),
            stderr: String::new(),
        };
        assert_eq!(output.lines(), vec!["line1", "line2", "line3"]);
    }

    #[test]
    fn test_git_output_lines_empty() {
        let output = GitOutput {
            stdout: String::new(),
            stderr: String::new(),
        };
        assert!(output.lines().is_empty());
    }

    #[test]
    fn test_git_output_trimmed() {
        let output = GitOutput {
            stdout: "  hello world  \n".to_string(),
            stderr: String::new(),
        };
        assert_eq!(output.trimmed(), "hello world");
    }

    // Git runner integration tests

    #[tokio::test]
    async fn test_git_version_command() {
        // Use current directory - tests run from repo root
        let git = Git::new(".");
        let result = git.run(&["--version"]).await;
        assert!(result.is_ok(), "git --version should succeed");
        assert!(
            result.unwrap().stdout.contains("git version"),
            "output should contain 'git version'"
        );
    }

    #[tokio::test]
    async fn test_git_status_in_repo() {
        let git = Git::new(".");
        let result = git.run(&["status", "--porcelain"]).await;
        assert!(result.is_ok(), "git status should succeed in repo");
    }

    #[tokio::test]
    async fn test_git_not_a_repo_error() {
        use tempfile::tempdir;
        let dir = tempdir().unwrap();
        let git = Git::new(dir.path());
        let result = git.run(&["status"]).await;
        assert!(result.is_err(), "git status should fail in non-repo");
        match result.unwrap_err() {
            GitError::CommandFailed { stderr, .. } => {
                assert!(
                    stderr.contains("not a git repository"),
                    "error should mention 'not a git repository'"
                );
            }
            e => panic!("Expected CommandFailed, got {:?}", e),
        }
    }

    // Error handling tests

    #[test]
    fn test_git_not_found_error_message() {
        let err = GitError::GitNotFound;
        assert_eq!(
            err.to_string(),
            "git executable not found. Is git installed?"
        );
    }

    #[test]
    fn test_error_serialization() {
        let err = GitError::GitNotFound;
        let json = serde_json::to_string(&err).unwrap();
        assert_eq!(json, "\"git executable not found. Is git installed?\"");
    }
}
