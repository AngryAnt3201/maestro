import type { Job } from "@/types/ops";

interface Props {
  onCancel: () => void;
  onSubmit: (partial: Partial<Job>) => Promise<void>;
}

export function ClaudeTriggerForm({ onCancel }: Props) {
  return (
    <div className="text-[11px] text-maestro-muted">
      Claude-trigger form — implemented in Task 25.
      <div className="mt-3">
        <button type="button" onClick={onCancel} className="text-maestro-muted">← Back</button>
      </div>
    </div>
  );
}
