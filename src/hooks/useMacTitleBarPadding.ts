import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useMemo, useState } from "react";
import { isMac } from "@/lib/platform";

/**
 * Left inset (in px) reserved for native macOS traffic lights when overlay title bar is used.
 * Content uses CSS var(--mac-title-bar-inset) so this is the single source of truth.
 * Tune here if alignment differs across macOS versions or display scales.
 */
export const MAC_TITLE_BAR_INSET_PX = 74;

/**
 * On macOS with native traffic lights: returns true when the title bar should
 * reserve left padding for the traffic lights (i.e. when they are visible).
 * When the window is maximized or fullscreen, traffic lights are hidden, so we
 * return false and content can use the full left edge.
 */
export function useMacTitleBarPadding(): boolean {
  const appWindow = useMemo(() => getCurrentWindow(), []);
  const [trafficLightsVisible, setTrafficLightsVisible] = useState(true);

  useEffect(() => {
    if (!isMac()) return;

    let unlistenResized: (() => void) | undefined;

    const updateVisibility = () => {
      Promise.all([appWindow.isMaximized(), appWindow.isFullscreen()])
        .then(([maximized, fullscreen]) => setTrafficLightsVisible(!maximized && !fullscreen))
        .catch(() => setTrafficLightsVisible(true));
    };

    updateVisibility();

    appWindow
      .onResized(updateVisibility)
      .then((fn) => {
        unlistenResized = fn;
      })
      .catch(() => {});

    return () => {
      unlistenResized?.();
    };
  }, [appWindow]);

  return isMac() && trafficLightsVisible;
}
