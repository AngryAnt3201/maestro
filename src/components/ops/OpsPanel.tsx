import { useEffect, useState } from "react";
import { useOpsStore } from "@/stores/useOpsStore";
import { projectHash as computeProjectHash } from "@/lib/ops";
import { LiveSection } from "./sections/LiveSection";
import { JobsSection } from "./sections/JobsSection";
import { ToolsSection } from "./sections/ToolsSection";
import { HistorySection } from "./sections/HistorySection";
import { SurfacesPlaceholder } from "./sections/SurfacesPlaceholder";

interface OpsPanelProps {
  repoPath: string;
}

export function OpsPanel({ repoPath }: OpsPanelProps) {
  const [projHash, setProjHash] = useState<string | undefined>(undefined);
  const { loadJobs, loadDispatches } = useOpsStore();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const h = await computeProjectHash(repoPath);
      if (cancelled) return;
      setProjHash(h);
      await loadJobs("global");
      await loadJobs("project", h);
      await loadDispatches("global");
      await loadDispatches("project", h);
    })();
    return () => { cancelled = true; };
  }, [repoPath, loadJobs, loadDispatches]);

  return (
    <div className="flex flex-1 flex-col overflow-y-auto">
      <LiveSection />
      <JobsSection projectHash={projHash} />
      <ToolsSection projectHash={projHash} />
      <SurfacesPlaceholder />
      <HistorySection projectHash={projHash} />
    </div>
  );
}
