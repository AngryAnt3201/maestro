import type { ReactNode } from "react";

interface SidebarTabButtonProps<Tab extends string> {
  tab: Tab;
  activeTab: Tab;
  icon: ReactNode;
  children: ReactNode;
  onSelect: (tab: Tab) => void;
}

export function SidebarTabButton<Tab extends string>({
  tab,
  activeTab,
  icon,
  children,
  onSelect,
}: SidebarTabButtonProps<Tab>) {
  const isActive = activeTab === tab;

  return (
    <button
      type="button"
      onClick={() => onSelect(tab)}
      className={`flex flex-1 items-center justify-center gap-1.5 py-2.5 text-[11px] font-semibold tracking-wide uppercase ${
        isActive
          ? "border-b-2 border-maestro-accent text-maestro-accent"
          : "text-maestro-muted hover:text-maestro-text"
      }`}
    >
      {icon}
      {children}
    </button>
  );
}
