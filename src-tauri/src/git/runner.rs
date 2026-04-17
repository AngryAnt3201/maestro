use std::path::{Path, PathBuf};
use std::sync::OnceLock;
use tokio::process::Command;
use tokio::time::{timeout, Duration};

use super::error::GitError;
#[cfg(unix)]
use crate::core::cli_path::augmented_path;
use crate::core::windows_process::TokioCommandExt;

/// Resolves the `SSH_AUTH_SOCK` path for SSH-based git operations.
///
/// macOS GUI applications (Tauri, Electron, etc.) do not inherit the shell
/// environment, so `SSH_AUTH_SOCK` is typically absent.  Without it, any
/// `git` command that uses SSH transport (e.g. `git ls-remote` on an
/// `git@github.com:…` remote) will fail or hang because the SSH agent is
/// unreachable.
///
/// This function checks the process environment first, then falls back to
/// `launchctl getenv SSH_AUTH_SOCK` on macOS.  The result is cached for the
/// lifetime of the process.
fn resolve_ssh_auth_sock() -> Option<&'static str> {
    static CACHED: OnceLock<Option<String>> = OnceLock::new();
    CACHED
        .get_or_init(|| {
            // 1. Already in the inherited environment – use it directly.
            if let Ok(sock) = std::env::var("SSH_AUTH_SOCK") {
                if !sock.is_empty() {
                    log::debug!("resolve_ssh_auth_sock: found in process env: {sock}");
                    return Some(sock);
                }
            }

            // macOS GUI apps (Tauri, Electron, etc.) do not inherit the shell
            // environment, so SSH_AUTH_SOCK is typically absent.  Try several
            // platform-specific fallbacks.
            #[cfg(target_os = "macos")]
            {
                // 2. Ask launchd directly.
                if let Ok(output) = std::process::Command::new("launchctl")
                    .args(["getenv", "SSH_AUTH_SOCK"])
                    .output()
                {
                    if output.status.success() {
                        let sock = String::from_utf8_lossy(&output.stdout).trim().to_string();
                        if !sock.is_empty() {
                            log::debug!("resolve_ssh_auth_sock: found via launchctl: {sock}");
                            return Some(sock);
                        }
                    }
                    log::debug!("resolve_ssh_auth_sock: launchctl returned empty or failed");
                }

                // 3. Source the user's login shell to pick up profile-defined
                //    SSH_AUTH_SOCK (handles 1Password, gpg-agent, custom agents,
                //    and newer macOS where launchctl getenv may return empty).
                //    Uses a 5-second timeout to avoid hanging if the shell profile
                //    blocks (e.g. slow NFS mounts, misconfigured .zshrc).
                let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".to_string());
                if let Ok(mut child) = std::process::Command::new(&shell)
                    .args(["-lc", "echo $SSH_AUTH_SOCK"])
                    .stdout(std::process::Stdio::piped())
                    .stderr(std::process::Stdio::null())
                    .spawn()
                {
                    let start = std::time::Instant::now();
                    let timeout = std::time::Duration::from_secs(5);
                    loop {
                        match child.try_wait() {
                            Ok(Some(status)) if status.success() => {
                                if let Some(stdout) = child.stdout.take() {
                                    use std::io::Read;
                                    let mut buf = String::new();
                                    let _ = std::io::BufReader::new(stdout)
                                        .read_to_string(&mut buf);
                                    let sock = buf.trim().to_string();
                                    if !sock.is_empty() {
                                        log::debug!(
                                            "resolve_ssh_auth_sock: found via login shell ({shell}): {sock}"
                                        );
                                        return Some(sock);
                                    }
                                }
                                break;
                            }
                            Ok(Some(_)) => break, // non-zero exit
                            Ok(None) if start.elapsed() > timeout => {
                                let _ = child.kill();
                                log::warn!(
                                    "resolve_ssh_auth_sock: login shell timed out after 5s"
                                );
                                break;
                            }
                            Ok(None) => std::thread::sleep(std::time::Duration::from_millis(50)),
                            Err(_) => break,
                        }
                    }
                } else {
                    log::debug!("resolve_ssh_auth_sock: failed to spawn login shell");
                }
            }

            log::warn!(
                "resolve_ssh_auth_sock: could not resolve SSH_AUTH_SOCK – SSH remotes may fail"
            );
            None
        })
        .as_deref()
}

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

    /// Executes a git subcommand with the default 30-second timeout.
    ///
    /// Returns `GitNotFound` if the git binary is missing, `SpawnError` for
    /// other I/O failures, and `CommandFailed` for non-zero exit codes.
    /// Both stdout and stderr are decoded as UTF-8 (returns `InvalidUtf8` on failure).
    pub async fn run(&self, args: &[&str]) -> Result<GitOutput, GitError> {
        self.run_with_timeout(args, Duration::from_secs(30)).await
    }

    /// Like `run`, but with a caller-specified timeout for long-running
    /// operations such as `git fetch`.
    pub async fn run_with_timeout(
        &self,
        args: &[&str],
        timeout_duration: Duration,
    ) -> Result<GitOutput, GitError> {
        let mut cmd = Command::new("git");
        cmd.arg("-C")
            .arg(&self.repo_path)
            .args(args)
            .env("GIT_TERMINAL_PROMPT", "0")
            .env("LC_ALL", "C")
            .kill_on_drop(true)
            .hide_console_window();

        // macOS/Linux GUI launchers start the app with a minimal PATH that
        // excludes Homebrew and user installs. Xcode CLT's `/usr/bin/git`
        // usually works, but Homebrew-git (or git configured helpers that
        // shell out) can be missing — augment PATH for consistency.
        #[cfg(unix)]
        cmd.env("PATH", augmented_path());

        // Ensure the SSH agent socket is reachable so that SSH-based remotes
        // (git@github.com:…) can authenticate without interactive prompts.
        if let Some(sock) = resolve_ssh_auth_sock() {
            cmd.env("SSH_AUTH_SOCK", sock);
        }

        // For SSH transport: prevent hanging on interactive prompts (host key
        // verification, passphrase) since there is no terminal in a GUI app.
        // - BatchMode=yes: never prompt for user input, fail immediately instead
        // - StrictHostKeyChecking=accept-new: auto-accept new host keys but
        //   reject changed ones (secure default for GUI apps)
        // - ConnectTimeout=5: fail fast on unreachable hosts
        // - IdentityAgent=<sock>: directly specify the agent socket so SSH does
        //   not fall back to reading key files (which can trigger a macOS
        //   Keychain prompt that hangs in GUI apps without a terminal)
        // Only set if the user hasn't configured their own SSH command.
        if std::env::var("GIT_SSH_COMMAND").is_err() && std::env::var("GIT_SSH").is_err() {
            let mut ssh_opts = String::from(
                "ssh -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=5",
            );
            if let Some(sock) = resolve_ssh_auth_sock() {
                ssh_opts.push_str(" -o IdentityAgent='");
                ssh_opts.push_str(sock);
                ssh_opts.push('\'');
            }
            cmd.env("GIT_SSH_COMMAND", &ssh_opts);
        }

        let command_str = format!("git -C {} {}", self.repo_path.display(), args.join(" "));
        let timeout_secs = timeout_duration.as_secs();

        let output = timeout(timeout_duration, cmd.output())
            .await
            .map_err(|_| GitError::CommandFailed {
                code: -1,
                stderr: format!("Command timed out after {timeout_secs}s: {command_str}"),
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
