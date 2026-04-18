import { ChevronDown, ChevronRight } from "lucide-react";
import { useState, type ReactNode } from "react";

interface OpsSectionProps {
  title: string;
  count?: number | string;
  defaultOpen?: boolean;
  action?: ReactNode;
  children: ReactNode;
}

export function OpsSection({ title, count, defaultOpen = true, action, children }: OpsSectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <section className="border-b border-maestro-border/60">
      <header
        className="flex cursor-default select-none items-center gap-1.5 bg-maestro-card/40 px-3 py-2 text-[10.5px] uppercase tracking-wider text-maestro-muted"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon size={12} />
        <span>{title}</span>
        {count !== undefined && <span className="ml-auto text-maestro-muted/60">{count}</span>}
        {action && <span className="ml-2">{action}</span>}
      </header>
      {open && <div>{children}</div>}
    </section>
  );
}
