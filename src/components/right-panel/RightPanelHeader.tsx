import { Cpu, GitBranch } from "lucide-react";

export type RightPanelDomain = "git" | "ops";

interface Props {
  active: RightPanelDomain;
  onChange: (d: RightPanelDomain) => void;
}

const ITEMS: Array<{ id: RightPanelDomain; label: string; icon: typeof GitBranch }> = [
  { id: "git", label: "Git", icon: GitBranch },
  { id: "ops", label: "Ops", icon: Cpu },
];

export function RightPanelHeader({ active, onChange }: Props) {
  return (
    <div className="flex shrink-0 border-b border-maestro-border">
      {ITEMS.map((i) => {
        const Icon = i.icon;
        const isActive = active === i.id;
        return (
          <button
            key={i.id}
            type="button"
            onClick={() => onChange(i.id)}
            className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold uppercase tracking-wide ${
              isActive
                ? "border-b-2 border-maestro-accent text-maestro-accent"
                : "text-maestro-muted hover:text-maestro-text"
            }`}
          >
            <Icon size={12} />
            {i.label}
          </button>
        );
      })}
    </div>
  );
}
