use std::path::{Path, PathBuf};

use serde::Serialize;
use tauri::State;

use crate::core::worktree_manager::{worktree_base_dir, WorktreeManager};
use crate::git::{BranchInfo, Git};

/// Result of preparing a worktree for a session.
#[derive(Debug, Clone, Serialize)]
pub struct WorktreePreparationResult {
    /// The directory where the session should run (worktree or project path).
    pub working_directory: String,
    /// The worktree path if one was created or reused.
    pub worktree_path: Option<String>,
    /// The resolved branch name (auto-detected or explicitly specified).
    /// `None` when no worktree was created (e.g., not a git repo or fallback to project path).
    pub branch: Option<String>,
    /// Whether a new worktree was created (vs. reused or skipped).
    pub created: bool,
    /// Warning message if something unexpected happened but we recovered.
    pub warning: Option<String>,
}

/// Prepares a worktree for a session, handling all edge cases gracefully.
///
/// This command orchestrates worktree creation for a session launch:
/// 1. If no branch is specified, auto-detects the current HEAD branch.
///    Falls back to project path if not a git repo or HEAD is detached.
/// 2. If a **managed** worktree already exists for this branch, reuses it.
/// 3. If the branch is checked out in the main repo, switches main to a fallback first.
/// 4. If the branch doesn't exist locally, creates it (handling remote branches).
/// 5. Creates the worktree via WorktreeManager.
///
/// On any failure, falls back to the project path so sessions always launch.
/// The caller is responsible for updating the session with the worktree path.
#[tauri::command]
pub async fn prepare_session_worktree(
    worktree_manager: State<'_, WorktreeManager>,
    project_path: String,
    branch: Option<String>,
    worktree_base_path: Option<String>,
    force_new: Option<bool>,
) -> Result<WorktreePreparationResult, String> {
    prepare_worktree_inner(
        &worktree_manager,
        project_path,
        branch,
        worktree_base_path,
        force_new.unwrap_or(false),
    )
    .await
}

/// Inner implementation extracted from the Tauri command for testability.
///
/// All logic lives here so that tests can call this directly without
/// needing a `State<>` wrapper.
pub(crate) async fn prepare_worktree_inner(
    worktree_manager: &WorktreeManager,
    project_path: String,
    branch: Option<String>,
    worktree_base_path: Option<String>,
    force_new: bool,
) -> Result<WorktreePreparationResult, String> {
    // Build git object first so we can call current_branch() for auto-detection
    let repo_path = PathBuf::from(&project_path);
    let git = Git::new(&repo_path);

    // Resolve branch: use provided branch, or auto-detect.
    let branch = match branch {
        Some(b) if !b.is_empty() => b,
        _ => {
            // No branch specified — unless force_new, check for an existing
            // Maestro-managed worktree to reuse so all auto sessions land in the same place.
            if !force_new {
                let base = worktree_base_path
                    .as_deref()
                    .map(PathBuf::from)
                    .unwrap_or_else(worktree_base_dir);
                // Canonicalize so that symlinks (e.g. /var → /private/var on macOS)
                // don't cause starts_with comparisons to fail.
                let base = std::fs::canonicalize(&base).unwrap_or(base);

                if let Ok(worktrees) = git.worktree_list().await {
                    for wt in &worktrees {
                        if wt.is_main_worktree {
                            continue;
                        }
                        // Only reuse worktrees under the Maestro-managed base directory
                        let wt_canonical = std::fs::canonicalize(&wt.path)
                            .unwrap_or_else(|_| PathBuf::from(&wt.path));
                        if wt_canonical.starts_with(&base) {
                            if let Some(ref wt_branch) = wt.branch {
                                log::info!(
                                    "Auto-reusing managed worktree at {} for branch {}",
                                    wt.path,
                                    wt_branch
                                );
                                return Ok(WorktreePreparationResult {
                                    working_directory: wt.path.clone(),
                                    worktree_path: Some(wt.path.clone()),
                                    branch: Some(wt_branch.clone()),
                                    created: false,
                                    warning: None,
                                });
                            }
                        }
                    }
                }
            }

            // No existing managed worktree — detect current HEAD branch
            match git.current_branch().await {
                Ok(b) => b,
                Err(_) => {
                    // Detached HEAD or not a git repo — fall back to project path
                    return Ok(WorktreePreparationResult {
                        working_directory: project_path,
                        worktree_path: None,
                        branch: None,
                        created: false,
                        warning: None,
                    });
                }
            }
        }
    };

    // Fetch branches early so we can correctly resolve local branch names
    // (e.g., distinguish "feature/foo" local branch from "origin/feature-x" remote ref).
    let branches = git.list_branches().await.unwrap_or_default();

    // Resolve the effective local branch name.
    // For remote refs like "origin/feature-x", the local name is "feature-x".
    // For local branches with slashes like "feature/foo", returns as-is.
    let local_branch = resolve_local_branch_name(&branch, &branches);

    // Check if a *managed* worktree already exists for this branch (skip when force_new).
    if !force_new {
        match git.worktree_list().await {
            Ok(worktrees) => {
                for wt in &worktrees {
                    if wt.is_main_worktree {
                        continue;
                    }
                    if let Some(ref wt_branch) = wt.branch {
                        if wt_branch == &local_branch {
                            log::info!(
                                "Reusing existing worktree at {} for branch {}",
                                wt.path,
                                local_branch
                            );
                            return Ok(WorktreePreparationResult {
                                working_directory: wt.path.clone(),
                                worktree_path: Some(wt.path.clone()),
                                branch: Some(local_branch.clone()),
                                created: false,
                                warning: None,
                            });
                        }
                    }
                }
            }
            Err(e) => {
                log::warn!("Failed to list worktrees: {}", e);
            }
        }
    }

    // Check if the branch is checked out in the main repo.
    // If so, we use --force on worktree add instead of switching the main repo,
    // which allows worktree creation even with uncommitted changes present.
    let current_branch = git.current_branch().await.ok();
    let branch_in_main = current_branch.as_ref() == Some(&local_branch);
    let warning = None;

    // Ensure the branch exists locally, handling remote branches correctly
    if let Err(e) = ensure_local_branch(&git, &branch, &local_branch, &branches).await {
        log::error!("Failed to ensure branch {}: {}", local_branch, e);
        return Ok(WorktreePreparationResult {
            working_directory: project_path,
            worktree_path: None,
            branch: None,
            created: false,
            warning: Some(format!("Failed to create branch {}: {}", local_branch, e)),
        });
    }

    // Create the worktree.
    // force_new: always create a fresh worktree with a unique path (ignores existing worktrees).
    // branch_in_main: the branch is currently checked out in the main repo, use --force.
    let base_override = worktree_base_path.as_deref().map(Path::new);
    let create_result = if force_new {
        worktree_manager
            .create_with_base_new(&local_branch, &repo_path, base_override)
            .await
    } else {
        worktree_manager
            .create_with_base(&local_branch, &repo_path, base_override, branch_in_main)
            .await
    };
    match create_result {
        Ok(wt_path) => {
            let wt_path_str = wt_path.to_string_lossy().to_string();
            log::info!(
                "Created worktree at {} for branch {}",
                wt_path_str,
                local_branch
            );

            Ok(WorktreePreparationResult {
                working_directory: wt_path_str.clone(),
                worktree_path: Some(wt_path_str),
                branch: Some(local_branch.clone()),
                created: true,
                warning,
            })
        }
        Err(e) => {
            log::error!("Failed to create worktree for {}: {}", local_branch, e);
            Ok(WorktreePreparationResult {
                working_directory: project_path,
                worktree_path: None,
                branch: None,
                created: false,
                warning: Some(format!("Failed to create worktree: {}", e)),
            })
        }
    }
}

/// Cleans up a worktree when a session ends.
///
/// Removes the worktree from the filesystem and prunes git refs.
/// Failures are logged but don't prevent session cleanup.
#[tauri::command]
pub async fn cleanup_session_worktree(
    worktree_manager: State<'_, WorktreeManager>,
    project_path: String,
    worktree_path: String,
) -> Result<bool, String> {
    cleanup_worktree_inner(&worktree_manager, project_path, worktree_path).await
}

/// Inner implementation for cleanup, extracted for testability.
pub(crate) async fn cleanup_worktree_inner(
    worktree_manager: &WorktreeManager,
    project_path: String,
    worktree_path: String,
) -> Result<bool, String> {
    if worktree_path.is_empty() {
        return Ok(false);
    }

    let repo_path = PathBuf::from(&project_path);
    let wt_path = PathBuf::from(&worktree_path);

    match worktree_manager.remove(&repo_path, &wt_path).await {
        Ok(()) => {
            log::info!("Cleaned up worktree at {}", worktree_path);
            Ok(true)
        }
        Err(e) => {
            log::warn!("Failed to cleanup worktree at {}: {}", worktree_path, e);
            Ok(false)
        }
    }
}

/// Gets a fallback branch to switch to when the target branch is checked out.
///
/// Tries init.defaultBranch config, then looks for main/master.
/// Returns None if no suitable fallback branch exists (e.g., single-branch repo).
#[cfg(test)]
pub(crate) async fn get_fallback_branch(git: &Git, avoid_branch: &str) -> Option<String> {
    // Try configured default branch
    if let Ok(Some(default)) = git.get_default_branch().await {
        if default != avoid_branch {
            return Some(default);
        }
    }

    // Check for common default branches
    if let Ok(branches) = git.list_branches().await {
        for candidate in ["main", "master", "develop"] {
            if candidate != avoid_branch
                && branches.iter().any(|b| !b.is_remote && b.name == candidate)
            {
                return Some(candidate.to_string());
            }
        }

        // Pick any local branch that's not the one we're avoiding
        for b in branches {
            if !b.is_remote && b.name != avoid_branch {
                return Some(b.name);
            }
        }
    }

    // No fallback available
    None
}

/// Returns the default worktree base directory path.
///
/// This allows the frontend to display the default path when no custom
/// override is configured for a project.
#[tauri::command]
pub async fn get_default_worktree_base_dir() -> Result<String, String> {
    Ok(worktree_base_dir().to_string_lossy().to_string())
}

/// Returns true if at least one Maestro-managed worktree exists for the given project.
/// Used by the frontend to enable/disable the "Current Worktree" launch option.
///
/// Filters out stale git worktree refs whose directories no longer exist on disk,
/// so the UI correctly disables "Current Worktree" after a worktree is deleted.
#[tauri::command]
pub async fn has_managed_worktree(
    worktree_manager: State<'_, WorktreeManager>,
    project_path: String,
) -> Result<bool, String> {
    let repo_path = std::path::PathBuf::from(&project_path);
    let worktrees = worktree_manager
        .list_managed(&repo_path)
        .await
        .unwrap_or_default();
    Ok(worktrees
        .iter()
        .any(|wt| std::path::Path::new(&wt.path).exists()))
}

/// Resolves a branch reference to the local branch name.
///
/// If the branch exists as a local branch (even with slashes like `feature/foo`),
/// returns it as-is. Otherwise, treats it as a remote ref (e.g., `origin/feature-x`)
/// and strips the first segment.
fn resolve_local_branch_name(branch: &str, local_branches: &[BranchInfo]) -> String {
    // If it exists as a local branch, use as-is (handles feature/foo, fix/bar/baz)
    if local_branches
        .iter()
        .any(|b| !b.is_remote && b.name == branch)
    {
        return branch.to_string();
    }
    // Otherwise strip first segment as remote name (origin/feature-x → feature-x)
    if let Some(pos) = branch.find('/') {
        return branch[pos + 1..].to_string();
    }
    branch.to_string()
}

/// Ensures a branch exists locally, creating it if necessary.
///
/// Handles three cases:
/// 1. Branch already exists locally → no-op
/// 2. Branch is a remote ref (e.g., `origin/feature-x`) → create local tracking branch
/// 3. Branch doesn't exist anywhere → create from HEAD
async fn ensure_local_branch(
    git: &Git,
    original_branch: &str,
    local_branch: &str,
    branches: &[BranchInfo],
) -> Result<(), String> {
    // Check if the local branch already exists
    let local_exists = branches
        .iter()
        .any(|b| !b.is_remote && b.name == local_branch);
    if local_exists {
        return Ok(());
    }

    // Check if there's a remote ref we should track
    let is_remote_ref = original_branch.contains('/');
    let remote_exists = branches
        .iter()
        .any(|b| b.is_remote && b.name == original_branch);

    if is_remote_ref && remote_exists {
        // Create a local tracking branch from the remote ref
        log::info!(
            "Creating local tracking branch {} from remote {}",
            local_branch,
            original_branch
        );
        git.create_branch(local_branch, Some(original_branch))
            .await
            .map_err(|e| e.to_string())?;
    } else {
        // Branch doesn't exist anywhere - create from HEAD
        log::info!(
            "Branch {} doesn't exist locally, creating from HEAD",
            local_branch
        );
        git.create_branch(local_branch, None)
            .await
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::core::worktree_manager::WorktreeManager;
    use tempfile::tempdir;

    /// Checks if a branch exists locally (test helper).
    async fn check_branch_exists(git: &Git, branch: &str) -> bool {
        match git.list_branches().await {
            Ok(branches) => branches.iter().any(|b| !b.is_remote && b.name == branch),
            Err(_) => false,
        }
    }

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

    /// Helper: creates a second branch in the test repo.
    async fn create_branch(git: &Git, name: &str) {
        git.run(&["branch", name]).await.unwrap();
    }

    /// Helper: creates a BranchInfo for testing resolve_local_branch_name.
    fn local_branch(name: &str) -> BranchInfo {
        BranchInfo {
            name: name.to_string(),
            is_remote: false,
            is_current: false,
        }
    }

    #[test]
    fn test_resolve_local_branch_name_local() {
        let branches = vec![local_branch("main"), local_branch("feature-x")];
        assert_eq!(resolve_local_branch_name("main", &branches), "main");
        assert_eq!(
            resolve_local_branch_name("feature-x", &branches),
            "feature-x"
        );
    }

    #[test]
    fn test_resolve_local_branch_name_remote() {
        let branches = vec![local_branch("main")];
        assert_eq!(
            resolve_local_branch_name("origin/feature-x", &branches),
            "feature-x"
        );
        assert_eq!(resolve_local_branch_name("origin/main", &branches), "main");
        assert_eq!(
            resolve_local_branch_name("upstream/fix/nested", &branches),
            "fix/nested"
        );
    }

    #[test]
    fn test_resolve_local_branch_name_slash_branch_exists_locally() {
        // feature/foo exists as a local branch — should NOT be stripped
        let branches = vec![
            local_branch("main"),
            local_branch("feature/foo"),
            local_branch("fix/bar/baz"),
        ];
        assert_eq!(
            resolve_local_branch_name("feature/foo", &branches),
            "feature/foo"
        );
        assert_eq!(
            resolve_local_branch_name("fix/bar/baz", &branches),
            "fix/bar/baz"
        );
    }

    #[test]
    fn test_resolve_local_branch_name_slash_branch_not_local() {
        // feature/foo does NOT exist locally — treat as remote ref, strip first segment
        let branches = vec![local_branch("main")];
        assert_eq!(
            resolve_local_branch_name("origin/feature-x", &branches),
            "feature-x"
        );
    }

    #[tokio::test]
    async fn test_prepare_no_branch_auto_detects_and_creates_worktree() {
        let (_dir, path) = create_test_repo().await;
        let wm = WorktreeManager::new();
        let result =
            prepare_worktree_inner(&wm, path.to_string_lossy().to_string(), None, None, false)
                .await
                .unwrap();

        // Auto-detects current HEAD branch and creates a worktree
        assert!(
            result.created,
            "Should have created a worktree via auto-detection"
        );
        assert!(
            result.worktree_path.is_some(),
            "Should have a worktree path"
        );
        assert_ne!(
            result.working_directory,
            path.to_string_lossy().to_string(),
            "Working directory should be the worktree, not the main repo"
        );

        // Cleanup
        let wt_path = PathBuf::from(result.worktree_path.unwrap());
        let _ = wm.remove(&path, &wt_path).await;
    }

    #[tokio::test]
    async fn test_prepare_empty_branch_auto_detects_and_creates_worktree() {
        let (_dir, path) = create_test_repo().await;
        let wm = WorktreeManager::new();
        let result = prepare_worktree_inner(
            &wm,
            path.to_string_lossy().to_string(),
            Some("".to_string()),
            None,
            false,
        )
        .await
        .unwrap();

        // Empty string treated same as None — auto-detects and creates worktree
        assert!(
            result.created,
            "Should have created a worktree via auto-detection"
        );
        assert!(
            result.worktree_path.is_some(),
            "Should have a worktree path"
        );
        assert_ne!(
            result.working_directory,
            path.to_string_lossy().to_string(),
            "Working directory should be the worktree, not the main repo"
        );

        // Cleanup
        let wt_path = PathBuf::from(result.worktree_path.unwrap());
        let _ = wm.remove(&path, &wt_path).await;
    }

    #[tokio::test]
    async fn test_prepare_second_session_reuses_existing_managed_worktree() {
        // Simulate the second-session scenario:
        // Session 1 creates a worktree (switching main repo to a different branch).
        // Session 2 (no branch selected) must reuse the same worktree, not create a new one.
        let (_dir, path) = create_test_repo().await;
        let git = Git::new(&path);

        // Create a second branch so session 1 can switch away from main
        create_branch(&git, "fallback").await;

        let wm = WorktreeManager::new();
        let base_path = tempdir().unwrap();
        let base_str = base_path.path().to_string_lossy().to_string();

        // Session 1: no branch → creates worktree for current branch (main)
        let result1 = prepare_worktree_inner(
            &wm,
            path.to_string_lossy().to_string(),
            None,
            Some(base_str.clone()),
            false,
        )
        .await
        .unwrap();
        assert!(result1.created, "Session 1 should create a new worktree");

        // Session 2: no branch → must reuse session 1's worktree
        let result2 = prepare_worktree_inner(
            &wm,
            path.to_string_lossy().to_string(),
            None,
            Some(base_str.clone()),
            false,
        )
        .await
        .unwrap();
        assert!(!result2.created, "Session 2 should reuse, not create");
        // Canonicalize both paths before comparing — on macOS /var is a symlink to
        // /private/var, so the worktree creator and git worktree list may disagree.
        let canonical1 = std::fs::canonicalize(&result1.working_directory)
            .unwrap_or_else(|_| PathBuf::from(&result1.working_directory));
        let canonical2 = std::fs::canonicalize(&result2.working_directory)
            .unwrap_or_else(|_| PathBuf::from(&result2.working_directory));
        assert_eq!(
            canonical2, canonical1,
            "Session 2 must land in the same worktree as session 1"
        );

        // Cleanup
        let wt_path = PathBuf::from(result1.worktree_path.unwrap());
        let _ = wm.remove(&path, &wt_path).await;
    }

    #[tokio::test]
    async fn test_prepare_no_branch_non_git_repo_falls_back() {
        let dir = tempdir().unwrap();
        let path = dir.path().to_path_buf();
        // NOT a git repo — current_branch() will fail → fall back gracefully

        let wm = WorktreeManager::new();
        let result =
            prepare_worktree_inner(&wm, path.to_string_lossy().to_string(), None, None, false)
                .await
                .unwrap();

        assert_eq!(result.working_directory, path.to_string_lossy().to_string());
        assert!(result.worktree_path.is_none());
        assert!(!result.created);
        assert!(result.warning.is_none());
    }

    #[tokio::test]
    async fn test_prepare_current_branch_creates_worktree() {
        let (_dir, path) = create_test_repo().await;
        let git = Git::new(&path);

        // Create a second branch so fallback works
        create_branch(&git, "fallback").await;

        let current = git.current_branch().await.unwrap();
        let wm = WorktreeManager::new();

        let result = prepare_worktree_inner(
            &wm,
            path.to_string_lossy().to_string(),
            Some(current.clone()),
            None,
            false,
        )
        .await
        .unwrap();

        // KEY BUG TEST: should create isolated worktree, NOT return main repo path
        assert!(result.created, "Should have created a new worktree");
        assert!(
            result.worktree_path.is_some(),
            "Should have a worktree path"
        );
        assert_ne!(
            result.working_directory,
            path.to_string_lossy().to_string(),
            "Working directory should NOT be the main repo"
        );

        // With --force worktree add, main repo stays on the same branch
        let new_current = git.current_branch().await.unwrap();
        assert_eq!(
            new_current, current,
            "Main repo should stay on the same branch when --force is used"
        );

        // Cleanup
        let wt_path = PathBuf::from(result.worktree_path.unwrap());
        let _ = wm.remove(&path, &wt_path).await;
    }

    #[tokio::test]
    async fn test_prepare_current_branch_single_branch_detaches() {
        let (_dir, path) = create_test_repo().await;
        let git = Git::new(&path);
        let current = git.current_branch().await.unwrap();

        // Single-branch repo: no fallback branch exists
        let wm = WorktreeManager::new();
        let result = prepare_worktree_inner(
            &wm,
            path.to_string_lossy().to_string(),
            Some(current.clone()),
            None,
            false,
        )
        .await
        .unwrap();

        assert!(result.created, "Should have created a new worktree");
        assert!(
            result.worktree_path.is_some(),
            "Should have a worktree path"
        );

        // Cleanup
        let wt_path = PathBuf::from(result.worktree_path.unwrap());
        let _ = wm.remove(&path, &wt_path).await;
    }

    #[tokio::test]
    async fn test_prepare_different_branch_creates_worktree() {
        let (_dir, path) = create_test_repo().await;
        let git = Git::new(&path);

        create_branch(&git, "feature-test").await;

        let wm = WorktreeManager::new();
        let result = prepare_worktree_inner(
            &wm,
            path.to_string_lossy().to_string(),
            Some("feature-test".to_string()),
            None,
            false,
        )
        .await
        .unwrap();

        assert!(result.created);
        assert!(result.worktree_path.is_some());
        assert_ne!(result.working_directory, path.to_string_lossy().to_string());

        // Cleanup
        let wt_path = PathBuf::from(result.worktree_path.unwrap());
        let _ = wm.remove(&path, &wt_path).await;
    }

    #[tokio::test]
    async fn test_prepare_reuses_existing_managed_worktree() {
        let (_dir, path) = create_test_repo().await;
        let git = Git::new(&path);

        create_branch(&git, "reuse-test").await;

        let wm = WorktreeManager::new();

        // First call creates
        let result1 = prepare_worktree_inner(
            &wm,
            path.to_string_lossy().to_string(),
            Some("reuse-test".to_string()),
            None,
            false,
        )
        .await
        .unwrap();
        assert!(result1.created);

        // Second call reuses
        let result2 = prepare_worktree_inner(
            &wm,
            path.to_string_lossy().to_string(),
            Some("reuse-test".to_string()),
            None,
            false,
        )
        .await
        .unwrap();
        assert!(!result2.created);
        assert_eq!(result2.worktree_path, result1.worktree_path);

        // Cleanup
        let wt_path = PathBuf::from(result1.worktree_path.unwrap());
        let _ = wm.remove(&path, &wt_path).await;
    }

    #[tokio::test]
    async fn test_prepare_nonexistent_branch_creates_from_head() {
        let (_dir, path) = create_test_repo().await;

        let wm = WorktreeManager::new();
        let result = prepare_worktree_inner(
            &wm,
            path.to_string_lossy().to_string(),
            Some("brand-new-branch".to_string()),
            None,
            false,
        )
        .await
        .unwrap();

        assert!(result.created);
        assert!(result.worktree_path.is_some());

        // Verify the branch was created
        let git = Git::new(&path);
        assert!(check_branch_exists(&git, "brand-new-branch").await);

        // Cleanup
        let wt_path = PathBuf::from(result.worktree_path.unwrap());
        let _ = wm.remove(&path, &wt_path).await;
    }

    #[tokio::test]
    async fn test_prepare_invalid_repo_falls_back_with_warning() {
        let dir = tempdir().unwrap();
        let path = dir.path().to_path_buf();
        // NOT a git repo

        let wm = WorktreeManager::new();
        let result = prepare_worktree_inner(
            &wm,
            path.to_string_lossy().to_string(),
            Some("main".to_string()),
            None,
            false,
        )
        .await
        .unwrap();

        // Should fall back to project path
        assert_eq!(result.working_directory, path.to_string_lossy().to_string());
        assert!(result.worktree_path.is_none());
        assert!(!result.created);
        assert!(result.warning.is_some());
    }

    #[tokio::test]
    async fn test_get_fallback_branch_avoids_target() {
        let (_dir, path) = create_test_repo().await;
        let git = Git::new(&path);

        // Main branch is the current one (e.g., "main" or "master")
        let current = git.current_branch().await.unwrap();
        create_branch(&git, "other").await;

        let fallback = get_fallback_branch(&git, &current).await;
        assert!(fallback.is_some());
        assert_ne!(fallback.unwrap(), current);
    }

    #[tokio::test]
    async fn test_get_fallback_branch_none_for_single_branch() {
        let (_dir, path) = create_test_repo().await;
        let git = Git::new(&path);
        let current = git.current_branch().await.unwrap();

        let fallback = get_fallback_branch(&git, &current).await;
        assert!(
            fallback.is_none(),
            "Single-branch repo should have no fallback"
        );
    }

    #[tokio::test]
    async fn test_cleanup_empty_path_is_noop() {
        let wm = WorktreeManager::new();
        let result = cleanup_worktree_inner(&wm, "/tmp".to_string(), "".to_string())
            .await
            .unwrap();
        assert!(!result);
    }
}
