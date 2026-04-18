import { Plus } from "lucide-react";
import { useMemo, useState } from "react";
import { useOpsStore } from "@/stores/useOpsStore";
import type { Job } from "@/types/ops";
import { OpsSection } from "../OpsSection";
import { JobRow } from "../JobRow";
import { NewJobWizard } from "../NewJobWizard";

interface Props {
  projectHash?: string;
}

type ScopeFilter = "all" | "project" | "global";

export function JobsSection({ projectHash }: Props) {
  const jobsByScope = useOpsStore((s) => s.jobsByScope);
  const scopeFilter = useOpsStore((s) => s.scopeFilter);
  const setScopeFilter = useOpsStore((s) => s.setScopeFilter);
  const [wizardOpen, setWizardOpen] = useState(false);

  const jobs = useMemo<Job[]>(() => {
    const g = jobsByScope["global"] ?? [];
    const p = projectHash ? (jobsByScope[`project:${projectHash}`] ?? []) : [];
    if (scopeFilter === "global") return g;
    if (scopeFilter === "project") return p;
    return [...g, ...p];
  }, [jobsByScope, projectHash, scopeFilter]);

  return (
    <>
      <OpsSection
        title="Jobs"
        count={jobs.length}
        action={
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); setWizardOpen(true); }}
            aria-label="New job"
            className="rounded p-0.5 text-maestro-accent hover:bg-maestro-accent/10"
          >
            <Plus size={12} />
          </button>
        }
      >
        <ScopeTabs value={scopeFilter} onChange={setScopeFilter} />
        {jobs.length === 0 ? (
          <div className="px-4 py-4 text-center text-[11px] text-maestro-muted/60">
            No jobs yet. Click + to create one.
          </div>
        ) : (
          <ul>{jobs.map((j) => <JobRow key={j.id} job={j} />)}</ul>
        )}
      </OpsSection>
      <NewJobWizard open={wizardOpen} onClose={() => setWizardOpen(false)} projectHash={projectHash} />
    </>
  );
}

function ScopeTabs({ value, onChange }: { value: ScopeFilter; onChange: (v: ScopeFilter) => void }) {
  const items: Array<{ v: ScopeFilter; label: string }> = [
    { v: "all", label: "All" },
    { v: "project", label: "Project" },
    { v: "global", label: "Global" },
  ];
  return (
    <div className="flex gap-1 border-b border-maestro-border/40 px-3 py-1.5">
      {items.map((i) => (
        <button
          key={i.v}
          type="button"
          onClick={() => onChange(i.v)}
          className={`rounded px-2 py-0.5 text-[10.5px] ${
            value === i.v
              ? "bg-maestro-accent/15 text-maestro-accent"
              : "text-maestro-muted hover:text-maestro-text"
          }`}
        >
          {i.label}
        </button>
      ))}
    </div>
  );
}
