interface OpsPanelProps {
  repoPath: string;
}

export function OpsPanel({ repoPath: _repoPath }: OpsPanelProps) {
  return (
    <div className="flex flex-1 items-center justify-center text-xs text-maestro-muted/60">
      Ops panel — scaffolded, sections land in Phase E.
    </div>
  );
}
