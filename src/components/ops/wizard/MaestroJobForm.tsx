import type { Job } from "@/types/ops";

interface Props {
  onCancel: () => void;
  onSubmit: (partial: Partial<Job>) => Promise<void>;
}

export function MaestroJobForm({ onCancel }: Props) {
  return (
    <div className="text-[11px] text-maestro-muted">
      Maestro form — implemented in Task 24.
      <div className="mt-3">
        <button type="button" onClick={onCancel} className="text-maestro-muted">← Back</button>
      </div>
    </div>
  );
}
