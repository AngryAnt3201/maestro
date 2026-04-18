import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";
import { useState } from "react";

export function WebhooksSubSection() {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full cursor-default items-center gap-1.5 px-4 py-1.5 text-left text-[11px] text-maestro-muted hover:bg-maestro-card/30"
      >
        {open ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
        <span className="flex-1">Webhooks</span>
        <span className="text-[10.5px] text-maestro-muted/60">remote</span>
      </button>
      {open && (
        <div className="px-4 py-3 text-[10.5px] text-maestro-muted/70">
          <p className="mb-2">
            Claude Code remote triggers and webhooks are managed at claude.ai. Local listing is not
            exposed by the `claude` CLI yet — manage them directly in the dashboard.
          </p>
          <a
            href="https://claude.ai/code/scheduled"
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-maestro-accent hover:underline"
          >
            Open Claude Code scheduled <ExternalLink size={10} />
          </a>
        </div>
      )}
    </div>
  );
}
