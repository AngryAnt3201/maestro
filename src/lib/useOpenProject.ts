import { useCallback } from "react";
import { pickProjectFolder } from "@/lib/dialog";
import { useFDAStore } from "@/stores/useFDAStore";
import { useWorkspaceStore } from "@/stores/useWorkspaceStore";

/**
 * Hook for opening project folders with macOS FDA permission handling.
 *
 * On macOS, if the user selects a TCC-protected path (Desktop, Documents,
 * Downloads) and the app lacks Full Disk Access, shows a dialog explaining
 * how to grant permission.
 */
export function useOpenProject(): {
  openProject: () => Promise<void>;
} {
  const openProjectToWorkspace = useWorkspaceStore((s) => s.openProject);
  const requireAccess = useFDAStore((s) => s.requireAccess);

  const openProject = useCallback(async () => {
    try {
      const path = await pickProjectFolder();
      if (!path) return;

      await requireAccess(path, () => {
        openProjectToWorkspace(path);
      });
    } catch (err) {
      console.error("Failed to open project folder:", err);
    }
  }, [openProjectToWorkspace, requireAccess]);

  return { openProject };
}
