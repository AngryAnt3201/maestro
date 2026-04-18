interface Props { open: boolean; onClose: () => void; projectHash?: string }
export function NewJobWizard({ open, onClose }: Props) {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="rounded bg-maestro-surface p-6">Wizard — Task 23</div>
    </div>
  );
}
