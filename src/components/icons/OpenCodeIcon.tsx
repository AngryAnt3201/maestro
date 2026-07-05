import type { SVGProps } from "react";

interface OpenCodeIconProps extends SVGProps<SVGSVGElement> {
  size?: number | string;
}

/**
 * OpenCode brand icon component.
 * Downloaded from https://dashboardicons.com/icons/opencode
 * Accepts same props as Lucide icons for consistency.
 */
export function OpenCodeIcon({ size = 24, className = "", ...props }: OpenCodeIconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 240 300"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-label="OpenCode"
      {...props}
    >
      <title>OpenCode</title>
      <g clipPath="url(#clip0_1401_86274)">
        <mask
          id="mask0_1401_86274"
          style={{ maskType: "luminance" }}
          maskUnits="userSpaceOnUse"
          x="0"
          y="0"
          width="240"
          height="300"
        >
          <path d="M240 0H0V300H240V0Z" fill="white" />
        </mask>
        <g mask="url(#mask0_1401_86274)">
          <path d="M180 240H60V120H180V240Z" fill="currentColor" />
          <path d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" fill="currentColor" />
        </g>
      </g>
      <defs>
        <clipPath id="clip0_1401_86274">
          <rect width="240" height="300" fill="white" />
        </clipPath>
      </defs>
    </svg>
  );
}
