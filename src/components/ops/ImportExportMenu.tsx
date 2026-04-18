import { useState } from "react";
import { Download, Upload } from "lucide-react";
import { exportJobsYaml, importJobsYaml } from "@/lib/ops";
import type { Scope } from "@/types/ops";
import { useOpsStore } from "@/stores/useOpsStore";

interface Props {
  scope: Scope;
  projectHash?: string;
}

export function ImportExportMenu({ scope, projectHash }: Props) {
  const [busy, setBusy] = useState(false);

  const onExport = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    try {
      const yaml = await exportJobsYaml(scope, projectHash);
      const blob = new Blob([yaml], { type: "text/yaml" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `ops-${scope}${projectHash ? `-${projectHash.slice(0, 8)}` : ""}.yaml`;
      a.click();
      URL.revokeObjectURL(url);
    } finally { setBusy(false); }
  };

  const onImport = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    try {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".yaml,.yml,text/yaml";
      input.onchange = async () => {
        const file = input.files?.[0];
        if (!file) return;
        const body = await file.text();
        const n = await importJobsYaml(scope, body, projectHash);
        window.alert(`Imported. ${n} job${n === 1 ? "" : "s"} now in this scope.`);
        await useOpsStore.getState().loadJobs(scope, projectHash);
      };
      input.click();
    } finally { setBusy(false); }
  };

  return (
    <>
      <button type="button" onClick={onExport} disabled={busy} aria-label="Export YAML"
        className="rounded p-0.5 text-maestro-muted hover:text-maestro-accent"
      ><Download size={11} /></button>
      <button type="button" onClick={onImport} disabled={busy} aria-label="Import YAML"
        className="rounded p-0.5 text-maestro-muted hover:text-maestro-accent"
      ><Upload size={11} /></button>
    </>
  );
}
