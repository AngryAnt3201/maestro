import { useMemo, useState } from "react";
import type { Job } from "@/types/ops";
import { validateCron } from "./MaestroJobForm";

interface Props {
  onCancel: () => void;
  onSubmit: (partial: Partial<Job>) => Promise<void>;
}

/** Rough estimate: parses the minute+hour fields to decide if the interval is < 1h. */
export function estimateMinIntervalSec(expr: string): number | null {
  const trimmed = expr.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(/\s+/);
  if (parts.length !== 5) return null;
  const [min, hour] = parts;
  if (min.startsWith("*/")) {
    const step = Number(min.slice(2));
    if (Number.isFinite(step) && step > 0) return step * 60;
  }
  if (min === "*" && hour.startsWith("*/")) {
    const step = Number(hour.slice(2));
    if (Number.isFinite(step)) return step * 3600;
  }
  if (min === "*") return 60;
  return 3600;
}

const KNOWN_CONNECTORS = ["gmail", "google-calendar"];

export function ClaudeTriggerForm({ onCancel, onSubmit }: Props) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [schedule, setSchedule] = useState("0 9 * * *");
  const [connectors, setConnectors] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const cronError = useMemo(() => validateCron(schedule), [schedule]);
  const intervalSec = useMemo(() => estimateMinIntervalSec(schedule), [schedule]);
  const intervalError = useMemo(() => {
    if (intervalSec === null) return null;
    if (intervalSec < 3600) return "Claude triggers require at least 1 hour between runs.";
    return null;
  }, [intervalSec]);

  const toggleConnector = (c: string) => {
    setConnectors((prev) => prev.includes(c) ? prev.filter((x) => x !== c) : [...prev, c]);
  };

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError("Name is required");
    if (!prompt.trim()) return setError("Prompt is required");
    if (cronError) return setError(cronError);
    if (intervalError) return setError(intervalError);
    setSubmitting(true);
    await onSubmit({
      name: name.trim(),
      schedule: schedule.trim(),
      claudeTrigger: {
        prompt: prompt.trim(),
        mcpConnectors: connectors,
      },
    });
    setSubmitting(false);
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-maestro-muted">Name</label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. pr-triage"
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11.5px] text-maestro-text"
        />
      </div>
      <div>
        <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-maestro-muted">Prompt</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Describe what Claude should do on each run. Remember: remote execution, no local files."
          rows={4}
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11px] text-maestro-text"
        />
      </div>
      <div>
        <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-maestro-muted">Schedule (cron)</label>
        <input
          value={schedule}
          onChange={(e) => setSchedule(e.target.value)}
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 font-mono text-[11px] text-maestro-text"
        />
        {cronError && <p className="mt-1 text-[10.5px] text-maestro-red">{cronError}</p>}
        {!cronError && intervalError && (
          <p className="mt-1 text-[10.5px] text-maestro-red">{intervalError}</p>
        )}
      </div>
      <div>
        <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-maestro-muted">MCP Connectors (optional)</label>
        <div className="flex flex-wrap gap-1.5">
          {KNOWN_CONNECTORS.map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => toggleConnector(c)}
              className={`rounded border px-2 py-0.5 text-[10.5px] ${
                connectors.includes(c)
                  ? "border-maestro-accent bg-maestro-accent/10 text-maestro-accent"
                  : "border-maestro-border text-maestro-muted"
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <p className="mt-1 text-[10.5px] text-maestro-muted/60">
          Additional connectors must be enabled at{" "}
          <a href="https://claude.ai/settings/connectors" target="_blank" rel="noreferrer" className="text-maestro-accent underline">
            claude.ai/settings/connectors
          </a>.
        </p>
      </div>

      {error && <p className="text-[11px] text-maestro-red">{error}</p>}

      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onCancel} className="text-[11px] text-maestro-muted">← Back</button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !!cronError || !!intervalError}
          className="ml-auto rounded bg-maestro-accent/20 px-3 py-1.5 text-[11px] text-maestro-accent disabled:opacity-50"
        >
          {submitting ? "Calling /schedule…" : "Create trigger"}
        </button>
      </div>
    </div>
  );
}
