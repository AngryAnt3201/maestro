import Plus from "lucide-react/dist/esm/icons/plus";

interface FloatingAddButtonProps {
  onClick: () => void;
}

export function FloatingAddButton({ onClick }: FloatingAddButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="fixed bottom-16 right-4 z-20 flex h-12 w-12 items-center justify-center rounded-full bg-maestro-accent text-white shadow-lg shadow-maestro-accent/20 transition-all duration-200 hover:bg-maestro-accent/90 hover:shadow-maestro-accent/30 hover:scale-105 active:scale-95"
      aria-label="Add session"
      title="Add new session"
    >
      <Plus size={24} strokeWidth={1.5} />
    </button>
  );
}
