import { useEffect, useState } from "react";
import { ChevronDown, ChevronRight, Plus, Trash2 } from "lucide-react";
import type { SecretEntry } from "@/types/ops";
import { listSecrets, putSecret, deleteSecret } from "@/lib/ops";

interface Props { projectHash?: string }

export function SecretsSubSection({ projectHash }: Props) {
  const [open, setOpen] = useState(false);
  const [entries, setEntries] = useState<SecretEntry[]>([]);
  const [adding, setAdding] = useState(false);
  const [key, setKey] = useState("");
  const [value, setValue] = useState("");
  const [scope, setScope] = useState<"global" | "project">("global");
  const [error, setError] = useState<string | null>(null);

  const load = async () => {
    try {
      setEntries(await listSecrets());
    } catch (e) { setError(String(e)); }
  };
  useEffect(() => { if (open) load(); }, [open]);

  const onAdd = async () => {
    if (!key.trim() || !value) return;
    try {
      await putSecret({
        id: "",
        key: key.trim(),
        scope,
        projectHash: scope === "project" ? projectHash : undefined,
        createdAt: 0,
      }, value);
      setKey(""); setValue(""); setAdding(false); setError(null);
      await load();
    } catch (e) { setError(String(e)); }
  };

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-default items-center gap-1.5 px-4 py-1.5 text-left text-[11px] text-maestro-muted hover:bg-maestro-card/30"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="flex-1">Secrets</span>
        <span className="text-[10.5px] text-maestro-muted/60">{entries.length}</span>
      </button>
      {open && (
        <div>
          <div className="flex items-center gap-2 border-b border-maestro-border/20 px-4 py-1">
            <button
              type="button"
              onClick={() => setAdding((a) => !a)}
              className="flex items-center gap-1 text-[10.5px] text-maestro-accent"
            >
              <Plus size={10} /> {adding ? "Cancel" : "Add secret"}
            </button>
          </div>
          {adding && (
            <div className="space-y-2 border-b border-maestro-border/20 px-4 py-2">
              <div className="flex gap-2">
                <input
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder="Env var name (e.g. GITHUB_TOKEN)"
                  className="flex-1 rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11px] text-maestro-text"
                />
                <select
                  value={scope}
                  onChange={(e) => setScope(e.target.value as "global" | "project")}
                  className="rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11px] text-maestro-text"
                >
                  <option value="global">global</option>
                  <option value="project" disabled={!projectHash}>project</option>
                </select>
              </div>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  placeholder="Secret value"
                  className="flex-1 rounded border border-maestro-border bg-maestro-card px-2 py-1 font-mono text-[11px] text-maestro-text"
                />
                <button
                  type="button"
                  onClick={onAdd}
                  className="rounded bg-maestro-accent/20 px-2 py-1 text-[10.5px] text-maestro-accent"
                >
                  Save
                </button>
              </div>
            </div>
          )}
          {error && <p className="px-4 py-1 text-[10.5px] text-maestro-red">{error}</p>}
          {entries.length === 0 ? (
            <p className="px-4 py-2 text-[10.5px] text-maestro-muted/60">No secrets yet.</p>
          ) : (
            <ul>
              {entries.map((s) => (
                <li key={s.id} className="flex items-center gap-2 border-t border-maestro-border/10 px-4 py-1">
                  <span className="w-16 text-[9.5px] uppercase tracking-wider text-maestro-muted">{s.scope}</span>
                  <span className="flex-1 truncate font-mono text-[11px] text-maestro-text">{s.key}</span>
                  <button
                    type="button"
                    onClick={async () => {
                      if (!window.confirm(`Delete secret ${s.key}?`)) return;
                      try { await deleteSecret(s.id); await load(); } catch (e) { window.alert(String(e)); }
                    }}
                    aria-label="Delete secret"
                    className="text-maestro-muted hover:text-maestro-red"
                  >
                    <Trash2 size={11} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
