import { useState } from "react";
import type { Job, WorktreeSpec } from "@/types/ops";

interface Props {
  onCancel: () => void;
  onSubmit: (partial: Partial<Job>) => Promise<void>;
}

const INTERVAL_PATTERN = /^\d+\s*(s|m|h)$/i;

function validateInterval(raw: string): string | null {
  if (!raw.trim()) return "Interval is required";
  if (!INTERVAL_PATTERN.test(raw.trim())) return "Format: <N><unit> (e.g. 5m, 1h, 30s)";
  return null;
}

export function LoopForm({ onCancel, onSubmit }: Props) {
  const [name, setName] = useState("");
  const [prompt, setPrompt] = useState("");
  const [interval, setInterval] = useState("5m");
  const [autostart, setAutostart] = useState(true);
  const [worktreeMode, setWorktreeMode] = useState<"dedicated" | "existing">("dedicated");
  const [worktreePath, setWorktreePath] = useState("");
  const [worktreeBranch, setWorktreeBranch] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const intervalError = validateInterval(interval);

  const submit = async () => {
    setError(null);
    if (!name.trim()) return setError("Name is required");
    if (!prompt.trim()) return setError("Prompt is required");
    if (intervalError) return setError(intervalError);
    if (worktreeMode === "existing" && !worktreePath.trim()) {
      return setError("Path is required when worktree mode is 'existing'");
    }

    const worktree: WorktreeSpec =
      worktreeMode === "dedicated"
        ? { mode: "dedicated" }
        : {
            mode: "existing",
            path: worktreePath.trim(),
            branch: worktreeBranch.trim() || undefined,
          };

    setSubmitting(true);
    await onSubmit({
      name: name.trim(),
      loop: {
        prompt: prompt.trim(),
        interval: interval.trim(),
        autostart,
        worktree,
      },
    });
    setSubmitting(false);
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-maestro-muted">
          Name
        </label>
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="e.g. hourly-pr-scan"
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11.5px] text-maestro-text"
        />
      </div>

      <div>
        <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-maestro-muted">
          Prompt (runs on every loop tick)
        </label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="e.g. list new PRs since last run and write a summary to /tmp/pr-report.md"
          rows={4}
          className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 text-[11px] text-maestro-text"
        />
      </div>

      <div>
        <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-maestro-muted">
          Interval
        </label>
        <input
          value={interval}
          onChange={(e) => setInterval(e.target.value)}
          className="w-28 rounded border border-maestro-border bg-maestro-card px-2 py-1 font-mono text-[11px] text-maestro-text"
        />
        {intervalError && <p className="mt-1 text-[10.5px] text-maestro-red">{intervalError}</p>}
      </div>

      <div>
        <label className="mb-1 block text-[10.5px] uppercase tracking-wider text-maestro-muted">
          Worktree
        </label>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => setWorktreeMode("dedicated")}
            className={`rounded px-3 py-1 text-[11px] ${
              worktreeMode === "dedicated"
                ? "bg-maestro-accent/15 text-maestro-accent"
                : "text-maestro-muted hover:text-maestro-text"
            }`}
          >
            Dedicated (default)
          </button>
          <button
            type="button"
            onClick={() => setWorktreeMode("existing")}
            className={`rounded px-3 py-1 text-[11px] ${
              worktreeMode === "existing"
                ? "bg-maestro-accent/15 text-maestro-accent"
                : "text-maestro-muted hover:text-maestro-text"
            }`}
          >
            Existing path
          </button>
        </div>
        {worktreeMode === "existing" && (
          <div className="mt-2 space-y-1">
            <input
              value={worktreePath}
              onChange={(e) => setWorktreePath(e.target.value)}
              placeholder="/absolute/path/to/repo"
              className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 font-mono text-[11px] text-maestro-text"
            />
            <input
              value={worktreeBranch}
              onChange={(e) => setWorktreeBranch(e.target.value)}
              placeholder="Branch (optional)"
              className="w-full rounded border border-maestro-border bg-maestro-card px-2 py-1 font-mono text-[11px] text-maestro-text"
            />
          </div>
        )}
      </div>

      <label className="flex cursor-default items-center gap-2 text-[11px] text-maestro-text">
        <input
          type="checkbox"
          checked={autostart}
          onChange={(e) => setAutostart(e.target.checked)}
        />
        Autostart on app launch
      </label>

      {error && <p className="text-[11px] text-maestro-red">{error}</p>}

      <div className="flex gap-2 pt-2">
        <button type="button" onClick={onCancel} className="text-[11px] text-maestro-muted">
          ← Back
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || !!intervalError}
          className="ml-auto rounded bg-maestro-accent/20 px-3 py-1.5 text-[11px] text-maestro-accent disabled:opacity-50"
        >
          {submitting ? "Creating…" : "Create loop"}
        </button>
      </div>
    </div>
  );
}
