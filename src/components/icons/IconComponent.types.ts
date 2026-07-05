import type React from "react";

/**
 * Icon component type for AI mode icons - supports both Lucide and custom icons
 * This type is compatible with Lucide icons and custom SVG icon components.
 */
export type IconComponent = React.ComponentType<{
  size?: number | string;
  className?: string;
  strokeWidth?: number | string;
}>;
