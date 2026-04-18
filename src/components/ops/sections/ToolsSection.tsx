import { Plus, Package } from "lucide-react";
import { useState } from "react";
import { useOpsStore } from "@/stores/useOpsStore";
import { OpsSection } from "../OpsSection";
import type { Tool } from "@/types/ops";

interface Props { projectHash?: string }

export function ToolsSection(_: Props) {
  const tools = useOpsStore((s) => s.tools);
  const saveTool = useOpsStore((s) => s.saveTool);
  const deleteTool = useOpsStore((s) => s.deleteTool);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [binary, setBinary] = useState("");

  const onAdd = async () => {
    if (!name.trim() || !binary.trim()) return;
    const t: Tool = {
      id: "",
      name: name.trim(),
      binary: binary.trim(),
      defaults: { args: [], env: {} },
      createdAt: 0,
    };
    await saveTool(t);
    setName(""); setBinary(""); setAdding(false);
  };

  return (
    <OpsSection
      title="Tools"
      count={tools.length}
      defaultOpen={false}
      action={
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); setAdding(true); }}
          aria-label="New tool"
          className="rounded p-0.5 text-maestro-accent hover:bg-maestro-accent/10"
        >
          <Plus size={12} />
        </button>
      }
    >
      {adding && (
        <div className="flex gap-2 border-b border-maestro-border/40 px-3 py-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Display name"
            className="flex-1 rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11px] text-maestro-text"
          />
          <input
            value={binary}
            onChange={(e) => setBinary(e.target.value)}
            placeholder="binary"
            className="w-24 rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11px] text-maestro-text"
          />
          <button type="button" onClick={onAdd} className="rounded bg-maestro-accent/15 px-2 py-1 text-[10.5px] text-maestro-accent">
            Add
          </button>
          <button type="button" onClick={() => setAdding(false)} className="text-[10.5px] text-maestro-muted">
            Cancel
          </button>
        </div>
      )}
      {tools.length === 0 && !adding ? (
        <div className="px-4 py-3 text-center text-[11px] text-maestro-muted/60">
          No tools registered. Tools are templates for quickly creating jobs.
        </div>
      ) : (
        <ul>
          {tools.map((t) => (
            <li key={t.id} className="flex items-center gap-2 border-t border-maestro-border/20 px-3 py-1.5">
              <Package size={12} className="text-maestro-muted" />
              <span className="flex-1 truncate text-[12px] text-maestro-text">{t.name}</span>
              <span className="font-mono text-[10.5px] text-maestro-muted/70">{t.binary}</span>
              <button
                type="button"
                aria-label="Delete tool"
                onClick={() => deleteTool(t.id)}
                className="text-[10.5px] text-maestro-muted hover:text-maestro-red"
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </OpsSection>
  );
}
