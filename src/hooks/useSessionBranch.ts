import { getCurrentBranch } from "@/lib/git";
import { useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS = 15_000;

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

    setBranch(null);

    const fetchBranch = () => {
      getCurrentBranch(projectPath)
        .then((name) => {
          if (mountedRef.current) setBranch(name);
        })
        .catch(() => {
          // Non-git dir or other error — leave current value
        });
    };

    // Initial fetch
    fetchBranch();

    const id = setInterval(fetchBranch, POLL_INTERVAL_MS);

    return () => {
      clearInterval(id);
      mountedRef.current = false;
    };
  }, [isWorktree, projectPath]);

  return branch;
}
