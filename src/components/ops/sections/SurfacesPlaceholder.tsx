import { OpsSection } from "../OpsSection";

export function SurfacesPlaceholder() {
  return (
    <OpsSection title="Claude Surfaces" count="Stage 2" defaultOpen={false}>
      <div className="px-4 py-3 text-[11px] text-maestro-muted/60">
        Hooks · MCP · Webhooks · Secrets — coming in Stage 2.
      </div>
    </OpsSection>
  );
}
