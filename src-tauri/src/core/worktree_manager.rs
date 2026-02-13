use std::collections::HashSet;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

use crate::git::{Git, GitError, WorktreeInfo};

pub(crate) fn worktree_base_dir() -> PathBuf {
    directories::ProjectDirs::from("com", "maestro", "maestro")
        .map(|p| p.data_dir().to_path_buf())
        .unwrap_or_else(|| {
            dirs_fallback()
        })
        .join("worktrees")
}

/// Fallback if ProjectDirs fails (e.g., no HOME set).
/// This GUI app assumes a user session on a desktop environment where HOME is set.
/// Panicking here is intentional to fail fast in headless/container/systemd scenarios.
fn dirs_fallback() -> PathBuf {
    std::env::var("HOME")
        .map(PathBuf::from)
        .map(|p| p.join(".local").join("share").join("maestro"))
        .expect("HOME environment variable must be set for worktree management")
}

/// Produces a 16-hex-char SHA-256 digest of the canonicalized repo path.
/// Falls back to the raw path if canonicalization fails (e.g., path does not exist yet).
async fn repo_hash(repo_path: &Path) -> String {
    let canonical = tokio::fs::canonicalize(repo_path)
        .await
        .unwrap_or_else(|_| repo_path.to_path_buf());
    let digest = Sha256::digest(canonical.to_string_lossy().as_bytes());
    format!("{:x}", digest)[..16].to_string()
}

/// Replaces filesystem-unsafe characters in branch names with hyphens.
/// Covers `/`, `\`, `:`, `*`, `?`, `"`, `<`, `>`, and `|`.
/// Also handles `.` and `..` as special cases returning `unnamed-branch`.
fn sanitize_branch(branch: &str) -> String {
    if branch.is_empty() || branch == "." || branch == ".." {
        return "unnamed-branch".to_string();
    }

    let sanitized: String = branch
        .chars()
        .map(|c| match c {
            '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|' => '-',
            _ => c,
        })
        .collect();

    sanitized
}

/// Returns the override path if provided, otherwise falls back to the default
/// XDG-based worktree base directory.
fn effective_base_dir(base_override: Option<&Path>) -> PathBuf {
    base_override
        .map(|p| p.to_path_buf())
        .unwrap_or_else(worktree_base_dir)
}

/// Manages Maestro-owned git worktrees under a deterministic, repo-specific
/// directory inside XDG data dirs.
///
/// Worktree paths are derived from a SHA-256 hash of the canonical repo path
/// (truncated to 16 hex chars) so that different repos never collide, and a
/// sanitized branch name so each branch gets its own subdirectory.
pub struct WorktreeManager;

impl Default for WorktreeManager {
    fn default() -> Self {
        Self::new()
    }
}

impl WorktreeManager {
    /// Creates a new stateless manager. All path computation is pure and
    /// deterministic from the repo path and branch name.
    pub fn new() -> Self {
        Self
    }

    /// Compute the worktree path for a given repo + branch.
    pub(crate) async fn worktree_path(&self, repo_path: &Path, branch: &str) -> PathBuf {
        self.worktree_path_with_base(repo_path, branch, None).await
    }

    /// Compute the worktree path with an optional base directory override.
    pub(crate) async fn worktree_path_with_base(
        &self,
        repo_path: &Path,
        branch: &str,
        base_override: Option<&Path>,
    ) -> PathBuf {
        let hash = repo_hash(repo_path).await;
        let sanitized = sanitize_branch(branch);
        effective_base_dir(base_override).join(hash).join(sanitized)
    }

    /// Creates a worktree for the given branch, returning its path on disk.
    ///
    /// Checks that the branch is not already checked out in another worktree
    /// before creating (returns `BranchAlreadyCheckedOut` if so). Parent
    /// directories are created automatically. The worktree checks out the
    /// existing branch -- no new branch is created.
    pub async fn create(
        &self,
        branch: &str,
        repo_path: &Path,
    ) -> Result<PathBuf, GitError> {
        self.create_with_base(branch, repo_path, None).await
    }

    /// Creates a worktree with an optional base directory override.
    pub async fn create_with_base(
        &self,
        branch: &str,
        repo_path: &Path,
        base_override: Option<&Path>,
    ) -> Result<PathBuf, GitError> {
        let git = Git::new(repo_path);

        // Check if branch is already checked out in another (non-main) worktree.
        // The main worktree is managed by `prepare_session_worktree` which switches
        // it to a fallback branch before calling `create()`, so we skip it here.
        let existing = git.worktree_list().await?;
        for wt in &existing {
            if wt.is_main_worktree {
                continue;
            }
            if let Some(ref wt_branch) = wt.branch {
                if wt_branch == branch {
                    return Err(GitError::BranchAlreadyCheckedOut {
                        branch: branch.to_string(),
                        path: wt.path.clone(),
                    });
                }
            }
        }

        let wt_path = self.worktree_path_with_base(repo_path, branch, base_override).await;

        // Create parent directories
        if let Some(parent) = wt_path.parent() {
            tokio::fs::create_dir_all(parent).await.map_err(|e| GitError::SpawnError {
                source: e,
                command: format!("create_dir_all {:?}", parent),
            })?;
        }

        git.worktree_add(&wt_path, None, Some(branch)).await?;

        Ok(wt_path)
    }

    /// Force-removes a worktree and prunes its git ref, then attempts to
    /// clean up the empty parent directory (silently ignored if non-empty).
    pub async fn remove(&self, repo_path: &Path, wt_path: &Path) -> Result<(), GitError> {
        let git = Git::new(repo_path);
        git.worktree_remove(wt_path, true).await?;
        git.worktree_prune().await?;

        // Clean up empty parent directories
        if let Some(parent) = wt_path.parent() {
            let _ = tokio::fs::remove_dir(parent).await; // only succeeds if empty
        }

        Ok(())
    }

    /// Lists only worktrees that live under Maestro's managed base directory,
    /// filtering out the main worktree and any manually created worktrees.
    pub async fn list_managed(&self, repo_path: &Path) -> Result<Vec<WorktreeInfo>, GitError> {
        self.list_managed_with_base(repo_path, None).await
    }

    /// Lists managed worktrees with an optional base directory override.
    pub async fn list_managed_with_base(
        &self,
        repo_path: &Path,
        base_override: Option<&Path>,
    ) -> Result<Vec<WorktreeInfo>, GitError> {
        let git = Git::new(repo_path);
        let all = git.worktree_list().await?;

        let base = effective_base_dir(base_override);

        Ok(all
            .into_iter()
            .filter(|wt| Path::new(&wt.path).starts_with(&base))
            .collect())
    }

    /// Prunes stale git worktree refs and removes orphaned directories.
    ///
    /// First runs `git worktree prune`, then scans the managed directory for
    /// subdirectories that are no longer in git's worktree list. Orphaned
    /// directories are deleted with `remove_dir_all`. No-ops gracefully if
    /// the managed directory does not exist yet.
    pub async fn prune(&self, repo_path: &Path) -> Result<(), GitError> {
        let git = Git::new(repo_path);
        git.worktree_prune().await?;

        // Scan managed directory for orphans not in git worktree list
        let hash = repo_hash(repo_path).await;
        let managed_dir = worktree_base_dir().join(&hash);

        let managed_exists = tokio::fs::try_exists(&managed_dir)
            .await
            .map_err(|e| GitError::SpawnError {
                source: e,
                command: format!("try_exists {:?}", managed_dir),
            })?;
        if !managed_exists {
            return Ok(());
        }

        let active_raw: Vec<String> = git
            .worktree_list()
            .await?
            .iter()
            .map(|wt| wt.path.clone())
            .collect();

        // Canonicalize active paths for reliable comparison; fall back to raw path
        let mut active: HashSet<String> = HashSet::with_capacity(active_raw.len());
        for raw in &active_raw {
            let p = Path::new(raw);
            let canonical = tokio::fs::canonicalize(p).await.unwrap_or_else(|_| p.to_path_buf());
            active.insert(canonical.to_string_lossy().to_string());
        }

        if let Ok(mut entries) = tokio::fs::read_dir(&managed_dir).await {
            while let Ok(Some(entry)) = entries.next_entry().await {
                let path = entry.path();
                let canonical_entry = tokio::fs::canonicalize(&path)
                    .await
                    .unwrap_or_else(|_| path.clone());
                let entry_key = canonical_entry.to_string_lossy().to_string();
                let is_dir = tokio::fs::metadata(&path)
                    .await
                    .map(|m| m.is_dir())
                    .unwrap_or(false);
                if !active.contains(&entry_key) && is_dir {
                    log::info!("Removing orphaned worktree dir: {}", path.display());
                    let _ = tokio::fs::remove_dir_all(&path).await;
                }
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::git::Git;
    use tempfile::tempdir;

    /// Helper: creates a temp git repo with an initial commit and returns its path.
    async fn create_test_repo() -> (tempfile::TempDir, PathBuf) {
        let dir = tempdir().unwrap();
        let path = dir.path().to_path_buf();
        let git = Git::new(&path);

        git.run(&["init"]).await.unwrap();
        git.run(&["config", "user.email", "test@test.com"])
            .await
            .unwrap();
        git.run(&["config", "user.name", "Test"]).await.unwrap();

        // Create initial commit
        let file_path = path.join("README.md");
        tokio::fs::write(&file_path, "# Test").await.unwrap();
        git.run(&["add", "."]).await.unwrap();
        git.run(&["commit", "-m", "initial"]).await.unwrap();

        (dir, path)
    }

    #[test]
    fn test_sanitize_branch_normal() {
        assert_eq!(sanitize_branch("main"), "main");
    }

    #[test]
    fn test_sanitize_branch_with_slashes() {
        assert_eq!(sanitize_branch("feature/x"), "feature-x");
    }

    #[test]
    fn test_sanitize_branch_empty() {
        assert_eq!(sanitize_branch(""), "unnamed-branch");
    }

    #[test]
    fn test_sanitize_branch_dot() {
        assert_eq!(sanitize_branch("."), "unnamed-branch");
        assert_eq!(sanitize_branch(".."), "unnamed-branch");
    }

    #[test]
    fn test_sanitize_branch_special_chars() {
        assert_eq!(sanitize_branch("a:b*c"), "a-b-c");
        assert_eq!(sanitize_branch("a?b\"c"), "a-b-c");
        assert_eq!(sanitize_branch("a<b>c|d"), "a-b-c-d");
    }

    #[tokio::test]
    async fn test_create_worktree_for_existing_branch() {
        let (_dir, path) = create_test_repo().await;
        let git = Git::new(&path);
        git.run(&["branch", "feature-test"]).await.unwrap();

        let wm = WorktreeManager::new();
        let wt_path = wm.create("feature-test", &path).await.unwrap();

        assert!(wt_path.exists());

        // Verify worktree is on the correct branch
        let wt_git = Git::new(&wt_path);
        let branch = wt_git.current_branch().await.unwrap();
        assert_eq!(branch, "feature-test");

        // Cleanup
        let _ = wm.remove(&path, &wt_path).await;
    }

    #[tokio::test]
    async fn test_create_skips_main_worktree_check() {
        let (_dir, path) = create_test_repo().await;
        let git = Git::new(&path);

        // The current branch is checked out in the main worktree.
        // After detaching HEAD, create() should succeed because it
        // now skips the main worktree in its duplicate check.
        let current = git.current_branch().await.unwrap();
        git.run(&["branch", "fallback"]).await.unwrap();
        git.run(&["checkout", "fallback"]).await.unwrap();

        let wm = WorktreeManager::new();
        let wt_path = wm.create(&current, &path).await.unwrap();

        assert!(wt_path.exists());

        // Cleanup
        let _ = wm.remove(&path, &wt_path).await;
    }

    #[tokio::test]
    async fn test_create_fails_for_branch_in_existing_worktree() {
        let (_dir, path) = create_test_repo().await;
        let git = Git::new(&path);
        git.run(&["branch", "dup-test"]).await.unwrap();

        let wm = WorktreeManager::new();

        // First creation should succeed
        let wt_path1 = wm.create("dup-test", &path).await.unwrap();

        // Second creation should fail with BranchAlreadyCheckedOut
        let result = wm.create("dup-test", &path).await;
        assert!(result.is_err());
        match result.unwrap_err() {
            GitError::BranchAlreadyCheckedOut { branch, .. } => {
                assert_eq!(branch, "dup-test");
            }
            e => panic!("Expected BranchAlreadyCheckedOut, got {:?}", e),
        }

        // Cleanup
        let _ = wm.remove(&path, &wt_path1).await;
    }

    #[tokio::test]
    async fn test_remove_worktree() {
        let (_dir, path) = create_test_repo().await;
        let git = Git::new(&path);
        git.run(&["branch", "remove-test"]).await.unwrap();

        let wm = WorktreeManager::new();
        let wt_path = wm.create("remove-test", &path).await.unwrap();
        assert!(wt_path.exists());

        wm.remove(&path, &wt_path).await.unwrap();
        // Worktree directory should be gone
        assert!(!wt_path.exists());
    }

    #[tokio::test]
    async fn test_list_managed_excludes_main() {
        let (_dir, path) = create_test_repo().await;
        let git = Git::new(&path);
        git.run(&["branch", "managed-test"]).await.unwrap();

        let wm = WorktreeManager::new();
        let wt_path = wm.create("managed-test", &path).await.unwrap();

        let managed = wm.list_managed(&path).await.unwrap();
        // Should contain only the managed worktree, not the main repo
        assert!(managed.len() >= 1);
        for wt in &managed {
            assert!(!wt.is_main_worktree);
        }

        // Cleanup
        let _ = wm.remove(&path, &wt_path).await;
    }

    #[tokio::test]
    async fn test_list_managed_empty_for_fresh_repo() {
        let (_dir, path) = create_test_repo().await;
        let wm = WorktreeManager::new();

        let managed = wm.list_managed(&path).await.unwrap();
        assert!(managed.is_empty());
    }

    #[tokio::test]
    async fn test_worktree_path_deterministic() {
        let (_dir, path) = create_test_repo().await;
        let wm = WorktreeManager::new();

        let path1 = wm.worktree_path(&path, "feature-x").await;
        let path2 = wm.worktree_path(&path, "feature-x").await;
        assert_eq!(path1, path2);
    }

    #[tokio::test]
    async fn test_worktree_path_differs_for_different_branches() {
        let (_dir, path) = create_test_repo().await;
        let wm = WorktreeManager::new();

        let path1 = wm.worktree_path(&path, "branch-a").await;
        let path2 = wm.worktree_path(&path, "branch-b").await;
        assert_ne!(path1, path2);
    }
}
