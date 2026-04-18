import { Layers } from "lucide-react";
import { OpsSection } from "../OpsSection";

export function SurfacesPlaceholder() {
  return (
    <OpsSection title="Claude Surfaces" count="Stage 2" defaultOpen={false}>
      <div className="px-4 py-3 text-[11px] text-maestro-muted/70">
        <div className="mb-2 flex items-center gap-1.5 text-maestro-muted">
          <Layers size={12} />
          <span>Coming in Stage 2</span>
        </div>
        <ul className="list-disc pl-4">
          <li>Hooks — view and toggle PreToolUse / PostToolUse / Stop hooks</li>
          <li>MCP — compact health view with restart</li>
          <li>Webhooks — remote triggers you've registered</li>
          <li>Secrets — keychain-backed values by scope</li>
        </ul>
      </div>
    </OpsSection>
  );
}
