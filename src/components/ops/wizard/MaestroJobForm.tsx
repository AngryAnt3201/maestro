import { useMemo, useState } from "react";
import type { Job } from "@/types/ops";
import { useOpsStore } from "@/stores/useOpsStore";

interface Props {
  onCancel: () => void;
  onSubmit: (partial: Partial<Job>) => Promise<void>;
}

/** Validate a cron expression: 5 space-separated fields. Returns an error string or null. */
export function validateCron(expr: string): string | null {
  const trimmed = expr.trim();
  if (trimmed.length === 0) return null;
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return "Cron must have 5 fields (min hour day month dow)";
  const ranges: Array<[number, number]> = [[0, 59], [0, 23], [1, 31], [1, 12], [0, 6]];
  for (let i = 0; i < 5; i++) {
    const f = parts[i];
    if (f === "*") continue;
    const tokens = f.split(",");
    for (const t of tokens) {
      const step = t.includes("*/") ? Number(t.slice(2)) : null;
      if (step !== null) {
        if (!Number.isFinite(step) || step < 1) return `Field ${i + 1}: invalid step`;
        continue;
      }
      const [lo, hi] = t.split("-").map(Number);
      if (!Number.isFinite(lo)) return `Field ${i + 1}: not a number`;
      if (hi !== undefined && !Number.isFinite(hi)) return `Field ${i + 1}: not a number`;
      if (lo < ranges[i][0] || lo > ranges[i][1]) return `Field ${i + 1}: out of range`;
      if (hi !== undefined && (hi < ranges[i][0] || hi > ranges[i][1])) return `Field ${i + 1}: out of range`;
    }
  }
  return null;
}

export function MaestroJobForm({ onCancel, onSubmit }: Props) {
  const tools = useOpsStore((s) => s.tools);
  const [name, setName] = useState("");
  const [toolId, setToolId] = useState<string>("");
  const [command, setCommand] = useState("");
  const [args, setArgs] = useState("");
  const [cwd, setCwd] = useState("");
  const [schedule, setSchedule] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cronError = useMemo(() => validateCron(schedule), [schedule]);

  const pickTool = (id: string) => {
    setToolId(id);
    const t = tools.find((x) => x.id === id);
    if (t) {
      setCommand(t.binary);
      setArgs(t.defaults.args.join(" "));
      if (t.defaults.cwd && !cwd) setCwd(t.defaults.cwd);
    }
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError("Name is required");
    if (!command.trim()) return setError("Command is required");
    if (cronError) return setError(cronError);
    setSubmitting(true);
    const splitArgs = args.trim().length > 0 ? args.trim().split(/\s+/) : [];
    await onSubmit({
      name: name.trim(),
      schedule: schedule.trim() || undefined,
      maestro: {
        command: command.trim(),
        args: splitArgs,
        cwd: cwd.trim() || undefined,
        env: {},
      },
      toolId: toolId || undefined,
    });
    setSubmitting(false);
  };

  return (
    <div className="space-y-3">
      <Field label="Name">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. ghd-daily"
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11.5px] text-maestro-text"
        />
      </Field>
      <Field label="Template (optional)">
        <select
          value={toolId}
          onChange={(e) => pickTool(e.target.value)}
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11.5px] text-maestro-text"
        >
          <option value="">— none —</option>
          {tools.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.binary})</option>)}
        </select>
      </Field>
      <Field label="Command">
        <input
          value={command}
          onChange={(e) => setCommand(e.target.value)}
          placeholder="ghd"
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 font-mono text-[11px] text-maestro-text"
        />
      </Field>
      <Field label="Arguments">
        <input
          value={args}
          onChange={(e) => setArgs(e.target.value)}
          placeholder="list --since 2026-04-01"
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 font-mono text-[11px] text-maestro-text"
        />
      </Field>
      <Field label="Working directory (optional)">
        <input
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
          placeholder="/path/to/dir (defaults to project or $HOME)"
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11px] text-maestro-text"
        />
      </Field>
      <Field label="Schedule (cron, optional)">
        <input
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          placeholder="0 9 * * *  — leave blank for manual-only"
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 font-mono text-[11px] text-maestro-text"
          aria-invalid={!!cronError}
        />
        {cronError && <p className="mt-1 text-[10.5px] text-maestro-red">{cronError}</p>}
      </Field>

      {error && <p className="text-[11px] text-maestro-red">{error}</p>}

      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onCancel} className="text-[11px] text-maestro-muted">← Back</button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !!cronError}
          className="ml-auto rounded bg-maestro-accent/20 px-3 py-1.5 text-[11px] text-maestro-accent disabled:opacity-50"
        >
          {submitting ? "Saving…" : "Create job"}
        </button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-maestro-muted">{label}</label>
      {children}
    </div>
  );
}
