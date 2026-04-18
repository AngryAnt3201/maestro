import { OpsSection } from "../OpsSection";
import { HooksSubSection } from "../surfaces/HooksSubSection";
import { McpSubSection } from "../surfaces/McpSubSection";
import { WebhooksSubSection } from "../surfaces/WebhooksSubSection";
import { SecretsSubSection } from "../surfaces/SecretsSubSection";

interface Props {
  projectPath?: string;
  projectHash?: string;
}

export function SurfacesSection({ projectPath, projectHash }: Props) {
  return (
    <OpsSection title="Claude Surfaces" count="Hooks · MCP · Webhooks · Secrets" defaultOpen={false}>
      <div className="divide-y divide-maestro-border/20">
        <HooksSubSection projectPath={projectPath} />
        <McpSubSection projectPath={projectPath} />
        <WebhooksSubSection />
        <SecretsSubSection projectHash={projectHash} />
      </div>
    </OpsSection>
  );
}
