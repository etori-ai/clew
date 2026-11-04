import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';

/**
 * Clew's theme is Astryx Neutral with one component override (D31 item 8): ChatLayout docks the composer on a sticky
 * surface and sets no scroll padding, so a control the browser scrolls to the bottom edge would land under the dock
 * (WCAG 2.4.11). The padding is the height of the tallest dock the start page draws (the piles row and the compact
 * composer with its drawer open); more padding only leaves more room. Nothing else is themed: the POC keeps the plain
 * Astryx look. Runtime rather than built: the page renders after its JavaScript anyway, so first paint is the same.
 */
export const clewTheme = defineTheme({
  name: 'clew',
  extends: neutralTheme,
  components: {
    'chat-layout': { base: { scrollPaddingBottom: '240px' } },
  },
});
