interface SidebarResizeHandleProps {
  width: number;
  minWidth: number;
  maxWidth: number;
  onMouseDown: (event: React.MouseEvent) => void;
  onKeyDown: (event: React.KeyboardEvent) => void;
}

export function SidebarResizeHandle({
  width,
  minWidth,
  maxWidth,
  onMouseDown,
  onKeyDown,
}: SidebarResizeHandleProps) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: Vertical resizer requires interactive div for pointer/keyboard handling.
    <div
      role="separator"
      aria-orientation="vertical"
      aria-valuemin={minWidth}
      aria-valuemax={maxWidth}
      aria-valuenow={Math.round(width)}
      aria-valuetext={`${Math.round(width)} pixels`}
      tabIndex={0}
      aria-label="Resize sidebar"
      className="absolute right-0 top-0 h-full w-1 cursor-col-resize hover:bg-maestro-accent/30 active:bg-maestro-accent/40"
      onMouseDown={onMouseDown}
      onKeyDown={onKeyDown}
    />
  );
}
