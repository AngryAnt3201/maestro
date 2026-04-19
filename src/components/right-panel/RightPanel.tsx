import { useState } from "react";
import type { RightPanelDomain } from "./RightPanelHeader";
import { RightPanelHeader } from "./RightPanelHeader";
import { GitGraphPanel } from "../git/GitGraphPanel";
import { OpsPanel } from "../ops/OpsPanel";
import type { RepositoryInfo, WorkspaceType } from "@/stores/useWorkspaceStore";

interface Props {
  open: boolean;
  onClose: () => void;
  repoPath: string | null;
  currentBranch: string | null;
  repositories: RepositoryInfo[];
  workspaceType: WorkspaceType;
  onRepoChange: (repoPath: string) => void;
}

export function RightPanel(props: Props) {
  const [domain, setDomain] = useState<RightPanelDomain>("git");

  return (
    <aside
      aria-hidden={!props.open}
      tabIndex={props.open ? undefined : -1}
      {...(!props.open ? ({ inert: "" } as { inert: "" }) : {})}
      className={`relative z-30 flex flex-col border-l border-maestro-border bg-maestro-surface transition-all duration-200 overflow-hidden ${
        props.open ? "w-[560px]" : "w-0 border-l-0"
      }`}
    >
      {props.open && <RightPanelHeader active={domain} onChange={setDomain} />}
      <div className="flex min-h-0 flex-1">
        {domain === "git" ? (
          <GitGraphPanel {...props} embedded />
        ) : props.repoPath ? (
          <OpsPanel repoPath={props.repoPath} />
        ) : (
          <div className="flex flex-1 items-center justify-center px-4 text-center">
            <p className="text-xs text-maestro-muted/60">Open a project to see Ops jobs.</p>
          </div>
        )}
      </div>
    </aside>
  );
}
