import { useEffect, useState } from "react";
import { projectHash as computeProjectHash } from "@/lib/ops";
import { useOpsStore } from "@/stores/useOpsStore";
import { HistorySection } from "./sections/HistorySection";
import { JobsSection } from "./sections/JobsSection";
import { LiveSection } from "./sections/LiveSection";
import { SurfacesPlaceholder } from "./sections/SurfacesPlaceholder";
import { ToolsSection } from "./sections/ToolsSection";

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
    return () => {
      cancelled = true;
    };
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
