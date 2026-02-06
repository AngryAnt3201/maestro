use std::path::PathBuf;

use crate::git::{BranchInfo, CommitInfo, FileChange, Git, GitError, GitUserConfig, RemoteInfo, WorktreeInfo};

/// Information about a detected git repository within a workspace.
#[derive(Debug, Clone, serde::Serialize)]
pub struct RepositoryInfo {
    /// Absolute path to the repository root.
    pub path: String,
    /// Display name (folder name).
    pub name: String,
    /// Current branch name (if available).
    #[serde(rename = "currentBranch")]
    pub current_branch: Option<String>,
    /// Primary remote URL (origin, or first remote if no origin).
    #[serde(rename = "remoteUrl")]
    pub remote_url: Option<String>,
}

/// Returns `Err(GitError::NotARepo)` if the given path string is empty.
fn validate_repo_path(repo_path: &str) -> Result<(), GitError> {
    if repo_path.is_empty() {
        return Err(GitError::NotARepo {
            path: PathBuf::from(""),
        });
    }
    Ok(())
}

/// Exposes `Git::list_branches` to the frontend.
/// Returns all local and remote branches (excluding HEAD pointer entries).
#[tauri::command]
pub async fn git_branches(repo_path: String) -> Result<Vec<BranchInfo>, GitError> {
    validate_repo_path(&repo_path)?;
    let git = Git::new(&repo_path);
    git.list_branches().await
}

/// Exposes `Git::current_branch` to the frontend.
/// Returns the branch name, or a short commit hash if HEAD is detached.
#[tauri::command]
pub async fn git_current_branch(repo_path: String) -> Result<String, GitError> {
    validate_repo_path(&repo_path)?;
    let git = Git::new(&repo_path);
    git.current_branch().await
}

/// Exposes `Git::uncommitted_count` to the frontend.
/// Returns the number of dirty files (staged + unstaged + untracked).
#[tauri::command]
pub async fn git_uncommitted_count(repo_path: String) -> Result<usize, GitError> {
    validate_repo_path(&repo_path)?;
    let git = Git::new(&repo_path);
    git.uncommitted_count().await
}

/// Exposes `Git::worktree_list` to the frontend.
/// Returns all worktrees (including the main one) with path, HEAD, and branch info.
#[tauri::command]
pub async fn git_worktree_list(repo_path: String) -> Result<Vec<WorktreeInfo>, GitError> {
    validate_repo_path(&repo_path)?;
    let git = Git::new(&repo_path);
    git.worktree_list().await
}

/// Exposes `Git::worktree_add` to the frontend.
/// Creates a new worktree at `path`, optionally on a new branch from `checkout_ref`.
#[tauri::command]
pub async fn git_worktree_add(
    repo_path: String,
    path: String,
    new_branch: Option<String>,
    checkout_ref: Option<String>,
) -> Result<WorktreeInfo, GitError> {
    validate_repo_path(&repo_path)?;
    let git = Git::new(&repo_path);
    let wt_path = PathBuf::from(&path);
    git.worktree_add(
        &wt_path,
        new_branch.as_deref(),
        checkout_ref.as_deref(),
    )
    .await
}

/// Exposes `Git::worktree_remove` to the frontend.
/// Removes a worktree directory; `force` bypasses uncommitted-changes checks.
#[tauri::command]
pub async fn git_worktree_remove(
    repo_path: String,
    path: String,
    force: bool,
) -> Result<(), GitError> {
    validate_repo_path(&repo_path)?;
    let git = Git::new(&repo_path);
    let wt_path = PathBuf::from(&path);
    git.worktree_remove(&wt_path, force).await
}

/// Exposes `Git::commit_log` to the frontend.
/// Returns up to `max_count` commits in topological order across all or current branch.
#[tauri::command]
pub async fn git_commit_log(
    repo_path: String,
    max_count: usize,
    all_branches: bool,
) -> Result<Vec<CommitInfo>, GitError> {
    validate_repo_path(&repo_path)?;
    let git = Git::new(&repo_path);
    git.commit_log(max_count, all_branches).await
}

/// Checks out a branch by name.
/// Handles both local and remote branches.
#[tauri::command]
pub async fn git_checkout_branch(repo_path: String, branch_name: String) -> Result<(), GitError> {
    validate_repo_path(&repo_path)?;
    let git = Git::new(&repo_path);
    git.checkout_branch(&branch_name).await
}

/// Creates a new branch, optionally from a specific starting point.
#[tauri::command]
pub async fn git_create_branch(
    repo_path: String,
    branch_name: String,
    start_point: Option<String>,
) -> Result<(), GitError> {
    validate_repo_path(&repo_path)?;
    let git = Git::new(&repo_path);
    git.create_branch(&branch_name, start_point.as_deref()).await
}

/// Returns the list of files changed in a specific commit.
#[tauri::command]
pub async fn git_commit_files(
    repo_path: String,
    commit_hash: String,
) -> Result<Vec<FileChange>, GitError> {
    validate_repo_path(&repo_path)?;
    let git = Git::new(&repo_path);
    git.commit_files(&commit_hash).await
}

/// Gets the git user config (name and email) for this repository.
#[tauri::command]
pub async fn git_user_config(repo_path: String) -> Result<GitUserConfig, GitError> {
    validate_repo_path(&repo_path)?;
    let git = Git::new(&repo_path);
    git.get_user_config().await
}

/// Sets the git user config (name and/or email).
#[tauri::command]
pub async fn git_set_user_config(
    repo_path: String,
    name: Option<String>,
    email: Option<String>,
    global: bool,
) -> Result<(), GitError> {
    validate_repo_path(&repo_path)?;
    let git = Git::new(&repo_path);
    git.set_user_config(name.as_deref(), email.as_deref(), global)
        .await
}

/// Lists all configured remotes with their URLs.
#[tauri::command]
pub async fn git_list_remotes(repo_path: String) -> Result<Vec<RemoteInfo>, GitError> {
    validate_repo_path(&repo_path)?;
    let git = Git::new(&repo_path);
    git.list_remotes().await
}

/// Adds a new remote with the given name and URL.
#[tauri::command]
pub async fn git_add_remote(
    repo_path: String,
    name: String,
    url: String,
) -> Result<(), GitError> {
    validate_repo_path(&repo_path)?;
    let git = Git::new(&repo_path);
    git.add_remote(&name, &url).await
}

/// Removes a remote by name.
#[tauri::command]
pub async fn git_remove_remote(repo_path: String, name: String) -> Result<(), GitError> {
    validate_repo_path(&repo_path)?;
    let git = Git::new(&repo_path);
    git.remove_remote(&name).await
}

/// Gets refs (branches and tags) pointing to a specific commit.
#[tauri::command]
pub async fn git_refs_for_commit(
    repo_path: String,
    commit_hash: String,
) -> Result<Vec<String>, GitError> {
    validate_repo_path(&repo_path)?;
    let git = Git::new(&repo_path);
    git.refs_for_commit(&commit_hash).await
}

/// Tests connectivity to a remote.
/// Returns true if reachable, false otherwise.
#[tauri::command]
pub async fn git_test_remote(repo_path: String, remote_name: String) -> Result<bool, GitError> {
    validate_repo_path(&repo_path)?;
    let git = Git::new(&repo_path);
    git.test_remote(&remote_name).await
}

/// Updates the URL of an existing remote.
#[tauri::command]
pub async fn git_set_remote_url(
    repo_path: String,
    name: String,
    url: String,
) -> Result<(), GitError> {
    validate_repo_path(&repo_path)?;
    let git = Git::new(&repo_path);
    git.set_remote_url(&name, &url).await
}

/// Gets the default branch name from git config.
#[tauri::command]
pub async fn git_get_default_branch(repo_path: String) -> Result<Option<String>, GitError> {
    validate_repo_path(&repo_path)?;
    let git = Git::new(&repo_path);
    git.get_default_branch().await
}

/// Sets the default branch name in git config.
#[tauri::command]
pub async fn git_set_default_branch(
    repo_path: String,
    branch: String,
    global: bool,
) -> Result<(), GitError> {
    validate_repo_path(&repo_path)?;
    let git = Git::new(&repo_path);
    git.set_default_branch(&branch, global).await
}

/// Checks if a path is a git repository root.
/// Returns true if the path contains a .git directory or file (could be a worktree).
#[tauri::command]
pub async fn is_git_repository(path: String) -> Result<bool, GitError> {
    let git_path = std::path::Path::new(&path).join(".git");
    Ok(git_path.exists())
}

/// Recursively scans a directory for nested git repositories.
/// Skips common non-project directories (node_modules, .git, etc.) and
/// limits depth to avoid performance issues.
#[tauri::command]
pub async fn detect_repositories(path: String) -> Result<Vec<RepositoryInfo>, GitError> {
    let mut repos = Vec::new();
    let root = std::path::Path::new(&path);

    // Directories to skip during recursive scan
    let skip_dirs = [
        "node_modules",
        ".git",
        "target",
        "build",
        "dist",
        ".next",
        "vendor",
        "__pycache__",
        ".venv",
        "venv",
        ".cargo",
    ];

    // Walk directory recursively (max depth 5 to avoid performance issues)
    detect_repos_recursive(root, &mut repos, &skip_dirs, 0, 5).await;

    Ok(repos)
}

/// Internal recursive helper for detect_repositories.
/// Uses Box::pin for async recursion.
fn detect_repos_recursive<'a>(
    dir: &'a std::path::Path,
    repos: &'a mut Vec<RepositoryInfo>,
    skip_dirs: &'a [&'a str],
    depth: usize,
    max_depth: usize,
) -> std::pin::Pin<Box<dyn std::future::Future<Output = ()> + Send + 'a>> {
    Box::pin(async move {
        if depth > max_depth {
            return;
        }

        // Check if this directory is a git repo
        let git_path = dir.join(".git");
        let is_git_repo = git_path.exists();

        if is_git_repo {
            // Get current branch and remotes (best effort)
            let git = Git::new(dir.to_str().unwrap_or_default());
            let current_branch = git.current_branch().await.ok();

            // Get primary remote URL (prefer "origin", fall back to first remote)
            let remote_url = match git.list_remotes().await {
                Ok(remotes) => {
                    remotes
                        .iter()
                        .find(|r| r.name == "origin")
                        .or_else(|| remotes.first())
                        .map(|r| r.url.clone())
                }
                Err(_) => None,
            };

            repos.push(RepositoryInfo {
                path: dir.to_string_lossy().to_string(),
                name: dir
                    .file_name()
                    .map(|n| n.to_string_lossy().to_string())
                    .unwrap_or_else(|| dir.to_string_lossy().to_string()),
                current_branch,
                remote_url,
            });
            // Continue scanning - there may be nested repos (submodules, monorepo packages, etc.)
        }

        // Read directory entries
        let entries = match std::fs::read_dir(dir) {
            Ok(e) => e,
            Err(_) => return,
        };

        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }

            let name = path
                .file_name()
                .map(|n| n.to_string_lossy().to_string())
                .unwrap_or_default();

            // Skip hidden and excluded directories
            if name.starts_with('.') || skip_dirs.contains(&name.as_str()) {
                continue;
            }

            detect_repos_recursive(&path, repos, skip_dirs, depth + 1, max_depth).await;
        }
    })
}
