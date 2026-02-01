use serde::Serialize;
use std::path::Path;

use super::error::GitError;
use super::runner::Git;

/// A local or remote branch returned by `list_branches`.
///
/// Remote branches have `is_remote = true` and names like `origin/main`.
/// Synthetic `HEAD` pointer entries (e.g. `origin/HEAD`) are filtered out
/// during parsing and will never appear in results.
#[derive(Debug, Clone, Serialize)]
pub struct BranchInfo {
    pub name: String,
    pub is_remote: bool,
    pub is_current: bool,
}

/// Metadata for a single git worktree, parsed from `git worktree list --porcelain`.
///
/// `branch` is `None` for detached HEAD states or bare repositories.
/// `head` contains the full commit SHA the worktree currently points to.
#[derive(Debug, Clone, Serialize)]
pub struct WorktreeInfo {
    pub path: String,
    pub head: String,
    pub branch: Option<String>,
    pub is_bare: bool,
}

/// A single commit entry parsed from `git log` output.
///
/// `parent_hashes` is empty for root commits and contains multiple entries
/// for merge commits. `timestamp` is a Unix epoch value from `%at`.
/// `summary` is the first line of the commit message (`%s`).
#[derive(Debug, Clone, Serialize)]
pub struct CommitInfo {
    pub hash: String,
    pub short_hash: String,
    pub parent_hashes: Vec<String>,
    pub author_name: String,
    pub author_email: String,
    pub timestamp: i64,
    pub summary: String,
}

/// Represents a file changed in a commit.
#[derive(Debug, Clone, Serialize)]
pub struct FileChange {
    pub path: String,
    pub status: FileChangeStatus,
    /// Original path for renamed files
    pub old_path: Option<String>,
}

/// The type of change made to a file.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileChangeStatus {
    Added,
    Modified,
    Deleted,
    Renamed,
    Copied,
    Unknown,
}

/// Git user configuration (name and email).
#[derive(Debug, Clone, Serialize)]
pub struct GitUserConfig {
    pub name: Option<String>,
    pub email: Option<String>,
}

/// Information about a git remote.
#[derive(Debug, Clone, Serialize)]
pub struct RemoteInfo {
    pub name: String,
    pub url: String,
}

impl Git {
    /// Lists all local and remote branches, excluding `HEAD` pointer entries.
    ///
    /// Parses `git branch -a` with a custom format using `|` delimiters.
    /// Any branch name containing "HEAD" (e.g. `origin/HEAD`) is skipped to
    /// avoid exposing symbolic refs that confuse branch selectors in the UI.
    pub async fn list_branches(&self) -> Result<Vec<BranchInfo>, GitError> {
        let output = self
            .run(&[
                "branch",
                "-a",
                "--no-color",
                "--format=%(HEAD)|%(refname:short)|%(refname:rstrip=-2)",
            ])
            .await?;

        let mut branches = Vec::new();
        for line in output.lines() {
            let parts: Vec<&str> = line.splitn(3, '|').collect();
            if parts.len() < 2 {
                continue;
            }
            let is_current = parts[0].trim() == "*";
            let name = parts[1].trim().to_string();

            // Skip HEAD pointer entries like "origin/HEAD"
            if name == "HEAD" || name.ends_with("/HEAD") {
                continue;
            }

            let is_remote = parts
                .get(2)
                .map(|r| r.trim() == "remotes")
                .unwrap_or(false);

            branches.push(BranchInfo {
                name,
                is_remote,
                is_current,
            });
        }
        Ok(branches)
    }

    /// Returns the name of the currently checked-out branch.
    ///
    /// Uses `symbolic-ref` first; if that fails (detached HEAD), falls back to
    /// `rev-parse --short HEAD` so the caller always gets a usable label.
    pub async fn current_branch(&self) -> Result<String, GitError> {
        match self.run(&["symbolic-ref", "--short", "HEAD"]).await {
            Ok(output) => Ok(output.trimmed().to_string()),
            Err(GitError::CommandFailed { code, stderr, .. }) => {
                // Git returns: "fatal: ref HEAD is not a symbolic ref"
                if stderr.contains("not a symbolic ref") {
                    // Detached HEAD — fall back to short hash
                    let output = self.run(&["rev-parse", "--short", "HEAD"]).await?;
                    Ok(output.trimmed().to_string())
                } else {
                    // Real error — propagate
                    Err(GitError::CommandFailed {
                        code,
                        stderr,
                        command: "git symbolic-ref --short HEAD".to_string(),
                    })
                }
            }
            Err(e) => Err(e), // Other errors (GitNotFound, SpawnError, etc.)
        }
    }

    /// Returns the number of uncommitted changes (staged + unstaged + untracked).
    ///
    /// Counts non-empty lines from `git status --porcelain`. Each line represents
    /// one changed file, so the count reflects individual file changes.
    pub async fn uncommitted_count(&self) -> Result<usize, GitError> {
        let output = self.run(&["status", "--porcelain"]).await?;
        Ok(output.lines().len())
    }

    /// Lists all worktrees by parsing `git worktree list --porcelain`.
    ///
    /// Porcelain format uses blank-line-separated stanzas with `worktree`, `HEAD`,
    /// `branch`, and `bare` fields. Detached worktrees will have `branch: None`.
    pub async fn worktree_list(&self) -> Result<Vec<WorktreeInfo>, GitError> {
        let output = self.run(&["worktree", "list", "--porcelain"]).await?;

        let mut worktrees = Vec::new();
        let mut current_path = String::new();
        let mut current_head = String::new();
        let mut current_branch: Option<String> = None;
        let mut current_bare = false;

        for line in output.lines() {
            if let Some(path) = line.strip_prefix("worktree ") {
                // Save previous entry if we have one
                if !current_path.is_empty() {
                    worktrees.push(WorktreeInfo {
                        path: current_path,
                        head: current_head,
                        branch: current_branch,
                        is_bare: current_bare,
                    });
                }
                current_path = path.to_string();
                current_head = String::new();
                current_branch = None;
                current_bare = false;
            } else if let Some(head) = line.strip_prefix("HEAD ") {
                current_head = head.to_string();
            } else if let Some(branch) = line.strip_prefix("branch refs/heads/") {
                current_branch = Some(branch.to_string());
            } else if line == "bare" {
                current_bare = true;
            }
        }

        // Push last entry
        if !current_path.is_empty() {
            worktrees.push(WorktreeInfo {
                path: current_path,
                head: current_head,
                branch: current_branch,
                is_bare: current_bare,
            });
        }

        Ok(worktrees)
    }

    /// Creates a new worktree at the given path, optionally on a new branch.
    ///
    /// If `new_branch` is provided, passes `-b <branch>` to create it.
    /// If `checkout_ref` is provided, the new worktree checks out that ref.
    /// After creation, reads back the HEAD and branch from the new worktree
    /// directory to return accurate metadata.
    pub async fn worktree_add(
        &self,
        path: &Path,
        new_branch: Option<&str>,
        checkout_ref: Option<&str>,
    ) -> Result<WorktreeInfo, GitError> {
        let path_str = path.to_string_lossy();
        let mut args = vec!["worktree", "add"];

        // Collect owned strings to extend their lifetime
        let branch_flag;
        if let Some(branch) = new_branch {
            branch_flag = branch.to_string();
            args.push("-b");
            args.push(&branch_flag);
        }

        args.push(&path_str);

        let checkout_ref_owned;
        if let Some(cr) = checkout_ref {
            checkout_ref_owned = cr.to_string();
            args.push(&checkout_ref_owned);
        }

        self.run(&args).await?;

        // Read back the created worktree info
        let head_output = self.run_in(path, &["rev-parse", "HEAD"]).await?;
        let branch_output = self.run_in(path, &["symbolic-ref", "--short", "HEAD"]).await;

        let branch = match branch_output {
            Ok(o) => Some(o.trimmed().to_string()),
            Err(GitError::CommandFailed { ref stderr, .. })
                if stderr.contains("not a symbolic reference") =>
            {
                None // Detached HEAD
            }
            Err(e) => {
                log::warn!("symbolic-ref in worktree {:?} failed unexpectedly: {e}", path);
                None
            }
        };

        Ok(WorktreeInfo {
            path: path.to_string_lossy().to_string(),
            head: head_output.trimmed().to_string(),
            branch,
            is_bare: false,
        })
    }

    /// Removes a worktree at the given path. Pass `force: true` to remove
    /// even if the worktree has uncommitted changes.
    pub async fn worktree_remove(&self, path: &Path, force: bool) -> Result<(), GitError> {
        let path_str = path.to_string_lossy().to_string();
        let mut args = vec!["worktree", "remove"];
        if force {
            args.push("--force");
        }
        args.push(&path_str);
        self.run(&args).await?;
        Ok(())
    }

    /// Prunes stale worktree references whose directories no longer exist on disk.
    pub async fn worktree_prune(&self) -> Result<(), GitError> {
        self.run(&["worktree", "prune"]).await?;
        Ok(())
    }

    /// Returns up to `max_count` commits in topological order.
    ///
    /// Parses a pipe-delimited `git log` format with 7 fields. Lines with fewer
    /// than 7 fields are silently skipped (e.g., malformed or empty repos).
    /// When `all_branches` is true, includes commits from all refs (`--all`).
    pub async fn commit_log(
        &self,
        max_count: usize,
        all_branches: bool,
    ) -> Result<Vec<CommitInfo>, GitError> {
        let count_str = format!("-{}", max_count);
        let mut args = vec![
            "log",
            "--format=%H|%h|%P|%an|%ae|%at|%s",
            &count_str,
            "--topo-order",
        ];
        if all_branches {
            args.push("--all");
        }

        let output = self.run(&args).await?;

        let mut commits = Vec::new();
        for line in output.lines() {
            let parts: Vec<&str> = line.splitn(7, '|').collect();
            if parts.len() < 7 {
                continue;
            }

            let timestamp = parts[5].parse::<i64>().unwrap_or(0);
            let parent_hashes: Vec<String> = if parts[2].is_empty() {
                Vec::new()
            } else {
                parts[2].split(' ').map(|s| s.to_string()).collect()
            };

            commits.push(CommitInfo {
                hash: parts[0].to_string(),
                short_hash: parts[1].to_string(),
                parent_hashes,
                author_name: parts[3].to_string(),
                author_email: parts[4].to_string(),
                timestamp,
                summary: parts[6].to_string(),
            });
        }

        Ok(commits)
    }

    /// Checks out a branch by name.
    ///
    /// For local branches, uses `git checkout <name>`.
    /// For remote branches like `origin/feature`, creates a local tracking branch.
    pub async fn checkout_branch(&self, name: &str) -> Result<(), GitError> {
        // Check if this is a remote branch reference
        if name.contains('/') {
            // Try to extract the local branch name from remote ref (e.g., "origin/main" -> "main")
            if let Some(local_name) = name.split('/').last() {
                // First try checking out the local branch if it exists
                match self.run(&["checkout", local_name]).await {
                    Ok(_) => return Ok(()),
                    Err(GitError::CommandFailed { .. }) => {
                        // Local branch doesn't exist, create tracking branch
                        self.run(&["checkout", "-b", local_name, "--track", name])
                            .await?;
                        return Ok(());
                    }
                    Err(e) => return Err(e),
                }
            }
        }

        // Normal local branch checkout
        self.run(&["checkout", name]).await?;
        Ok(())
    }

    /// Creates a new branch, optionally from a specific starting point.
    ///
    /// If `start_point` is None, creates from HEAD.
    pub async fn create_branch(
        &self,
        name: &str,
        start_point: Option<&str>,
    ) -> Result<(), GitError> {
        let mut args = vec!["branch", name];
        if let Some(point) = start_point {
            args.push(point);
        }
        self.run(&args).await?;
        Ok(())
    }

    /// Returns the list of files changed in a specific commit.
    ///
    /// Parses `git show --name-status --format=` output.
    pub async fn commit_files(&self, hash: &str) -> Result<Vec<FileChange>, GitError> {
        let output = self
            .run(&["show", "--name-status", "--format=", hash])
            .await?;

        let mut files = Vec::new();
        for line in output.lines() {
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.is_empty() {
                continue;
            }

            let status_char = parts[0].chars().next().unwrap_or('?');
            let (status, path, old_path) = match status_char {
                'A' => (FileChangeStatus::Added, parts.get(1).unwrap_or(&"").to_string(), None),
                'M' => (FileChangeStatus::Modified, parts.get(1).unwrap_or(&"").to_string(), None),
                'D' => (FileChangeStatus::Deleted, parts.get(1).unwrap_or(&"").to_string(), None),
                'R' => {
                    // Renamed: R100\told_path\tnew_path
                    let old = parts.get(1).map(|s| s.to_string());
                    let new = parts.get(2).unwrap_or(&"").to_string();
                    (FileChangeStatus::Renamed, new, old)
                }
                'C' => {
                    // Copied: C100\told_path\tnew_path
                    let old = parts.get(1).map(|s| s.to_string());
                    let new = parts.get(2).unwrap_or(&"").to_string();
                    (FileChangeStatus::Copied, new, old)
                }
                _ => (FileChangeStatus::Unknown, parts.get(1).unwrap_or(&"").to_string(), None),
            };

            if !path.is_empty() {
                files.push(FileChange {
                    path,
                    status,
                    old_path,
                });
            }
        }

        Ok(files)
    }

    /// Gets the git user config (name and email) for this repository.
    ///
    /// First checks local config, falls back to global if not set.
    pub async fn get_user_config(&self) -> Result<GitUserConfig, GitError> {
        let name = match self.run(&["config", "user.name"]).await {
            Ok(output) => Some(output.trimmed().to_string()),
            Err(GitError::CommandFailed { code: 1, .. }) => None, // Not set
            Err(e) => return Err(e),
        };

        let email = match self.run(&["config", "user.email"]).await {
            Ok(output) => Some(output.trimmed().to_string()),
            Err(GitError::CommandFailed { code: 1, .. }) => None, // Not set
            Err(e) => return Err(e),
        };

        Ok(GitUserConfig { name, email })
    }

    /// Sets the git user config (name and/or email).
    ///
    /// If `global` is true, sets the global config; otherwise, sets repository-local config.
    pub async fn set_user_config(
        &self,
        name: Option<&str>,
        email: Option<&str>,
        global: bool,
    ) -> Result<(), GitError> {
        let scope = if global { "--global" } else { "--local" };

        if let Some(n) = name {
            self.run(&["config", scope, "user.name", n]).await?;
        }

        if let Some(e) = email {
            self.run(&["config", scope, "user.email", e]).await?;
        }

        Ok(())
    }

    /// Lists all configured remotes with their URLs.
    pub async fn list_remotes(&self) -> Result<Vec<RemoteInfo>, GitError> {
        let output = self.run(&["remote", "-v"]).await?;

        let mut remotes: Vec<RemoteInfo> = Vec::new();
        let mut seen_names = std::collections::HashSet::new();

        for line in output.lines() {
            // Format: "origin\thttps://github.com/user/repo.git (fetch)"
            let parts: Vec<&str> = line.split('\t').collect();
            if parts.len() < 2 {
                continue;
            }

            let name = parts[0].to_string();
            if seen_names.contains(&name) {
                continue; // Skip duplicate entries (fetch/push)
            }

            // Extract URL (remove the (fetch) or (push) suffix)
            let url_part = parts[1];
            let url = url_part
                .split_whitespace()
                .next()
                .unwrap_or(url_part)
                .to_string();

            seen_names.insert(name.clone());
            remotes.push(RemoteInfo { name, url });
        }

        Ok(remotes)
    }

    /// Adds a new remote with the given name and URL.
    pub async fn add_remote(&self, name: &str, url: &str) -> Result<(), GitError> {
        self.run(&["remote", "add", name, url]).await?;
        Ok(())
    }

    /// Removes a remote by name.
    pub async fn remove_remote(&self, name: &str) -> Result<(), GitError> {
        self.run(&["remote", "remove", name]).await?;
        Ok(())
    }

    /// Gets refs (branches and tags) pointing to a specific commit.
    ///
    /// Returns refs formatted as "refname" entries.
    pub async fn refs_for_commit(&self, hash: &str) -> Result<Vec<String>, GitError> {
        // Get branches pointing to this commit
        let output = self
            .run(&[
                "branch",
                "-a",
                "--points-at",
                hash,
                "--format=%(refname:short)",
            ])
            .await?;

        let mut refs: Vec<String> = output
            .lines()
            .iter()
            .filter(|l| !l.is_empty() && !l.contains("HEAD"))
            .map(|l| l.to_string())
            .collect();

        // Get tags pointing to this commit
        if let Ok(tag_output) = self
            .run(&["tag", "--points-at", hash])
            .await
        {
            for tag in tag_output.lines() {
                if !tag.is_empty() {
                    refs.push(format!("tag:{}", tag));
                }
            }
        }

        Ok(refs)
    }

    /// Tests connectivity to a remote by running `git ls-remote --heads`.
    ///
    /// Returns `true` if the remote is reachable, `false` otherwise.
    /// Uses a 10-second timeout to avoid hanging on unresponsive remotes.
    pub async fn test_remote(&self, remote_name: &str) -> Result<bool, GitError> {
        match tokio::time::timeout(
            std::time::Duration::from_secs(10),
            self.run(&["ls-remote", "--heads", remote_name]),
        )
        .await
        {
            Ok(Ok(_)) => Ok(true),
            Ok(Err(GitError::CommandFailed { .. })) => Ok(false),
            Ok(Err(e)) => Err(e),
            Err(_) => Ok(false), // Timeout = disconnected
        }
    }

    /// Updates the URL of an existing remote.
    pub async fn set_remote_url(&self, name: &str, url: &str) -> Result<(), GitError> {
        self.run(&["remote", "set-url", name, url]).await?;
        Ok(())
    }

    /// Gets the default branch name from git config (init.defaultBranch).
    ///
    /// First checks local config, then global. Returns None if not set.
    pub async fn get_default_branch(&self) -> Result<Option<String>, GitError> {
        // Try local first
        match self.run(&["config", "--local", "init.defaultBranch"]).await {
            Ok(output) => return Ok(Some(output.trimmed().to_string())),
            Err(GitError::CommandFailed { code: 1, .. }) => {} // Not set locally
            Err(e) => return Err(e),
        }

        // Fall back to global
        match self.run(&["config", "--global", "init.defaultBranch"]).await {
            Ok(output) => Ok(Some(output.trimmed().to_string())),
            Err(GitError::CommandFailed { code: 1, .. }) => Ok(None), // Not set
            Err(e) => Err(e),
        }
    }

    /// Sets the default branch name in git config (init.defaultBranch).
    ///
    /// If `global` is true, sets the global config; otherwise, sets repository-local config.
    pub async fn set_default_branch(&self, branch: &str, global: bool) -> Result<(), GitError> {
        let scope = if global { "--global" } else { "--local" };
        self.run(&["config", scope, "init.defaultBranch", branch]).await?;
        Ok(())
    }

    /// Detaches HEAD at the current commit.
    ///
    /// Used when we need to free up a branch for worktree creation
    /// but have no other branch to switch to.
    pub async fn detach_head(&self) -> Result<(), GitError> {
        self.run(&["checkout", "--detach"]).await?;
        Ok(())
    }
}
