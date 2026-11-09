/**
 * The person's colour choice (D39), stored in the browser under one key so every surface of the installation that
 * shares the origin reads the same choice: the web app, the portal and the shared header on the intranet's pages (D87).
 * Only the display preference is stored; identity and work data never are.
 */
export type ColorMode = 'system' | 'light' | 'dark';
export const APPEARANCE_PREFERENCE_KEY = 'clew:color-mode';

/** The stored choice, or `system` when there is none or the browser refuses storage. */
export function readAppearancePreference(): ColorMode {
  try {
    const stored = localStorage.getItem(APPEARANCE_PREFERENCE_KEY);
    return stored === 'dark' || stored === 'light' ? stored : 'system';
  } catch {
    return 'system';
  }
}
