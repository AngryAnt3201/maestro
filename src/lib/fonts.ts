/**
 * Font detection and management utilities for terminal fonts.
 *
 * Provides functions to detect available system fonts, check font availability,
 * and build CSS font-family strings with appropriate fallbacks.
 */

import { invoke } from "@tauri-apps/api/core";

/** Information about an available font on the system. */
export interface AvailableFont {
  /** The font family name (e.g., "JetBrains Mono") */
  family: string;
  /** Whether this is a Nerd Font variant */
  is_nerd_font: boolean;
  /** Whether this font is monospace (suitable for terminals) */
  is_monospace: boolean;
}

/** The embedded fallback font bundled with the app. */
export const EMBEDDED_FONT = "JetBrains Mono";

/** Default fallback fonts for CSS font-family. */
export const FALLBACK_FONTS = "monospace";

/** Cached list of available fonts. */
let cachedFonts: AvailableFont[] | null = null;

/**
 * Fetches the list of available terminal-suitable fonts on the system.
 * Results are cached after the first call.
 *
 * @returns Array of available fonts, sorted by priority (Nerd Fonts first)
 */
export async function getAvailableFonts(): Promise<AvailableFont[]> {
  if (cachedFonts) {
    return cachedFonts;
  }
  cachedFonts = await invoke<AvailableFont[]>("get_available_fonts");
  return cachedFonts;
}

/**
 * Clears the cached font list, forcing a fresh detection on next call.
 * Useful if the user installs new fonts while the app is running.
 */
export function clearFontCache(): void {
  cachedFonts = null;
}

/**
 * Checks if a specific font family is available on the system.
 *
 * @param family - The font family name to check
 * @returns True if the font is available
 */
export async function checkFontAvailable(family: string): Promise<boolean> {
  return invoke<boolean>("check_font_available", { family });
}

/**
 * Builds a CSS font-family string with appropriate fallbacks.
 *
 * The resulting string will include:
 * 1. The preferred font (if provided and different from embedded)
 * 2. The embedded JetBrains Mono font
 * 3. Generic monospace fallback
 *
 * @param preferredFont - The user's preferred font family
 * @returns CSS font-family value string
 */
export function buildFontFamily(preferredFont?: string): string {
  const fonts: string[] = [];

  if (preferredFont && preferredFont !== EMBEDDED_FONT) {
    fonts.push(quoteFont(preferredFont));
  }

  fonts.push(quoteFont(EMBEDDED_FONT));
  fonts.push(FALLBACK_FONTS);

  return fonts.join(", ");
}

/**
 * Quotes a font family name if it contains spaces.
 */
function quoteFont(font: string): string {
  if (font.includes(" ")) {
    return `"${font}"`;
  }
  return font;
}

/**
 * Waits for a font to be loaded and ready for use.
 *
 * Uses the CSS Font Loading API to detect when a font is available.
 * Times out after the specified duration and resolves to false.
 *
 * @param fontFamily - The font family to wait for
 * @param timeout - Timeout in milliseconds (default: 2000)
 * @returns True if the font loaded successfully, false on timeout
 */
export async function waitForFont(fontFamily: string, timeout: number = 2000): Promise<boolean> {
  // Extract the first font from the font-family string
  const firstFont = fontFamily.split(",")[0].trim().replace(/["']/g, "");

  try {
    // Use the CSS Font Loading API
    const font = await Promise.race([
      document.fonts.load(`16px "${firstFont}"`),
      new Promise<FontFace[]>((resolve) => setTimeout(() => resolve([]), timeout)),
    ]);

    // Check if any fonts were loaded
    return font.length > 0;
  } catch (error) {
    console.warn(`Failed to wait for font "${firstFont}":`, error);
    return false;
  }
}

/**
 * Selects the best available font based on priority.
 *
 * Priority order:
 * 1. First available Nerd Font
 * 2. First available monospace font
 * 3. Embedded JetBrains Mono
 *
 * @param fonts - List of available fonts
 * @returns The best available font family name
 */
export function selectBestFont(fonts: AvailableFont[]): string {
  // First, try to find a Nerd Font
  const nerdFont = fonts.find((f) => f.is_nerd_font);
  if (nerdFont) {
    return nerdFont.family;
  }

  // Otherwise, use the first monospace font
  const monoFont = fonts.find((f) => f.is_monospace);
  if (monoFont) {
    return monoFont.family;
  }

  // Fall back to embedded font
  return EMBEDDED_FONT;
}
