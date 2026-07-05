import BrainCircuit from "lucide-react/dist/esm/icons/brain-circuit";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down";
import Code2 from "lucide-react/dist/esm/icons/code-2";
import Sparkles from "lucide-react/dist/esm/icons/sparkles";
import Terminal from "lucide-react/dist/esm/icons/terminal";
import type { IconComponent } from "@/components/icons/IconComponent.types";
import { OpenCodeIcon } from "@/components/icons/OpenCodeIcon";
import type { AiMode } from "@/stores/useSessionStore";

const AI_MODES: {
  mode: AiMode;
  icon: IconComponent;
  label: string;
  color: string;
}[] = [
  { mode: "Claude", icon: BrainCircuit, label: "Claude Code", color: "text-violet-500" },
  { mode: "Gemini", icon: Sparkles, label: "Gemini CLI", color: "text-blue-400" },
  { mode: "Codex", icon: Code2, label: "Codex", color: "text-green-400" },
  { mode: "OpenCode", icon: OpenCodeIcon, label: "OpenCode", color: "text-purple-500" },
  { mode: "Plain", icon: Terminal, label: "Terminal", color: "text-maestro-muted" },
];

function getModeConfig(mode: AiMode) {
  return AI_MODES.find((m) => m.mode === mode) ?? AI_MODES[0];
}

interface AiModeSelectorProps {
  mode: AiMode;
  isOpen: boolean;
  onToggleOpen: () => void;
  onModeChange: (mode: AiMode) => void;
  onClose: () => void;
}

export function AiModeSelector({
  mode,
  isOpen,
  onToggleOpen,
  onModeChange,
  onClose,
}: AiModeSelectorProps) {
  const modeConfig = getModeConfig(mode);
  const ModeIcon = modeConfig.icon;

  return (
    <>
      <div className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-maestro-muted">
        AI Mode
      </div>
      <button
        type="button"
        onClick={onToggleOpen}
        className="flex w-full items-center justify-between gap-2 rounded border border-maestro-border bg-maestro-card px-3 py-2 text-left text-sm text-maestro-text transition-colors hover:border-maestro-accent/50"
      >
        <div className="flex items-center gap-2">
          <ModeIcon size={16} className={modeConfig.color} />
          <span>{modeConfig.label}</span>
        </div>
        <ChevronDown size={14} className="text-maestro-muted" />
      </button>

      {isOpen && (
        <div className="absolute left-0 right-0 top-full z-10 mt-1 overflow-hidden rounded border border-maestro-border bg-maestro-card shadow-lg">
          {AI_MODES.map((option) => {
            const Icon = option.icon;
            const isSelected = option.mode === mode;
            return (
              <button
                key={option.mode}
                type="button"
                onClick={() => {
                  onModeChange(option.mode);
                  onClose();
                }}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors ${
                  isSelected
                    ? "bg-maestro-accent/10 text-maestro-text"
                    : "text-maestro-muted hover:bg-maestro-surface hover:text-maestro-text"
                }`}
              >
                <Icon size={16} className={option.color} />
                <span>{option.label}</span>
              </button>
            );
          })}
        </div>
      )}
    </>
  );
}
