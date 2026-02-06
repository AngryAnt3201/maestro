import { getDeduplicatedCurrentBranch } from "@/lib/git";
import { useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 5_000;

/**
 * Hook that returns the live branch name for a terminal session.
 *
 * - Worktree sessions: returns `initialBranch` immediately (branch is locked).
 * - Non-worktree sessions: fetches the real branch on mount, then polls every
 *   5 s so the header stays in sync after `git checkout` / `git switch`.
 *
 * Returns `null` while the first fetch is in-flight (caller shows "...").
 */
export function useSessionBranch(
  projectPath: string,
  isWorktree: boolean,
  initialBranch: string | null,
  isActive: boolean = true,
): string | null {
  const [branch, setBranch] = useState<string | null>(
    isWorktree ? initialBranch : null,
  );
  const mountedRef = useRef(true);

  // Keep in sync if the store pushes a new initialBranch while mounted
  useEffect(() => {
    if (isWorktree && initialBranch !== null) {
      setBranch(initialBranch);
    }
  }, [isWorktree, initialBranch]);

  // Non-worktree: fetch immediately + poll
  useEffect(() => {
    mountedRef.current = true;

    if (isWorktree || !projectPath) return;

    // Only reset if we don't have a value yet (initial mount)
    if (branch === null) {
      setBranch(null);
    }

    const fetchBranch = (force = false) => {
      // Skip if window is blurred or tab is inactive to avoid annoying
      // macOS permission pop-ups in the background.
      // On mount (force=true), we STILL respect isActive to prevent boot barrage.
      if (!isActive || (!force && !document.hasFocus())) return;

      getDeduplicatedCurrentBranch(projectPath)
        .then((name) => {
          if (mountedRef.current) setBranch(name);
        })
        .catch(() => {
          // Non-git dir or other error — leave current value
        });
    };

    // Initial fetch - no longer "forced" if inactive
    fetchBranch(true);

    const id = setInterval(() => fetchBranch(false), POLL_INTERVAL_MS);

    return () => {
      clearInterval(id);
      mountedRef.current = false;
    };
  }, [isWorktree, projectPath, isActive]);

  return branch;
}
