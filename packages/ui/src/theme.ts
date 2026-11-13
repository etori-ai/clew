import { defineTheme, generateThemeCSS } from '@astryxdesign/core/theme';
import { resolveThemeTokens } from '@astryxdesign/core/theme/tokens';
import { neutralPalettes, neutralTheme } from '@astryxdesign/theme-neutral';
import { THEME_BASE_COLORS } from '@clew/contracts';
import type { Branding } from './branding';

const { red, green, white, neutral } = neutralPalettes;

/**
 * A focused field that has a status shows its focus (WCAG 2.4.7). Astryx 0.7.13 draws a field's focus as an accent
 * border with an inset shadow, and a status replaces both: the border keeps the status colour while focused and the
 * status style sets the shadow to none, so a focused invalid field looks the same as an unfocused one. The focused
 * field gets a 2 px inset, the width of Astryx's own focus inset, in the status text colour inside its 1 px status
 * border (5.9:1 on the field in the light appearance and 8.6:1 in the dark one for an error; the canvas drew 1 px,
 * which told the two apart by a single pixel). Under forced colours the shadow is not painted and Astryx's own
 * Highlight border on the focused field stands. The keys are the bordered wrappers of Astryx's fields, each of which
 * reflects `data-status`; a pseudo-class key inside a `prop:value` key is Astryx's documented way to style a state
 * from the theme. `PowerSearch` has the same defect and is left out: its field reflects no status to the theme, and
 * Clew does not use it.
 */
const STATUS_FIELDS = [
  'text-input',
  'text-area',
  'number-input',
  'date-input',
  'time-input',
  'date-time-input-date-segment',
  'date-time-input-time-segment',
  'date-range-input',
  'typeahead',
  'tokenizer',
];
/** A selector reflects its status in every variant and draws it only as a field, `variant="input"`. */
const STATUS_SELECTORS = ['selector', 'multi-selector'];
const focusedStatusField = (when = '') =>
  Object.fromEntries(
    ['error', 'warning', 'success'].map(type => [
      `${when}status:${type}`,
      { ':focus-within': { boxShadow: `inset 0 0 0 2px var(--color-text-${type})` } },
    ]),
  );

/**
 * Every brand inherits Astryx Neutral with shared component overrides (D31 item 8, D39): ChatLayout docks the composer on a sticky
 * surface and sets no scroll padding, so a control the browser scrolls to the bottom edge would land under the dock
 * (WCAG 2.4.11). The padding is the height of the tallest dock the start page draws (the piles row and the compact
 * composer with its drawer open). An installation's theme changes colour tokens, not behaviour (D38, D98). Runtime
 * rather than built: the page renders after its JavaScript anyway, so first paint is the same.
 */
const clewBaseTheme = defineTheme({
  name: 'clew-neutral',
  extends: neutralTheme,
  // The canvas's artboards are drawn at 14 px body text (D62): Astryx's own scale setting, base 14, ratio 1.2.
  typography: { scale: { base: 14, ratio: 1.2 } },
  tokens: {
    // The side panel opens over a page that is still its context: half of Astryx's scrim, which keeps a dialog set apart without blacking the page out.
    '--color-overlay': ['#01122833', '#1111124D'],
    // The tinted cards of the canvas (D62): what is due today on a faint red with a red border, Lugnt läge on a faint green.
    // Astryx's own tints are a strong wash. In the dark the same quiet tint comes from Neutral's own dark palette, step 15
    // for the ground and 40 for the border (D63 item 15, amended 2026-11-07): Neutral's step 25 read as brown and held the
    // meta line's secondary text at 4.3:1 on red and 4.1:1 on green, under WCAG's 4.5:1; on step 15 it is 5.8 and 5.6.
    '--color-background-red': ['#fffafa', red.dark[15]],
    '--color-border-red': ['#fca5a5', red.dark[40]],
    '--color-background-green': ['#f6fbf8', green.dark[15]],
    '--color-border-green': ['#bfe5cf', green.dark[40]],
    // The red badge ("i dag", "Påminnelse", "behöver dig"): Neutral's dark error is a salmon as light as its info blue
    // (relative luminance 0.34 both), so the two differed by hue alone. Step 50 of its dark red with white text, as the
    // light appearance has, is darker than info and warning (0.17 against 0.34 and 0.66), keeps 4.8:1 for the badge's
    // words and at least 3.1:1 as a mark on the dark grounds (D63 item 15, amended 2026-11-07). The light half repeats
    // Neutral's own light error, a hand-picked value outside its palette, since a token is set for both appearances.
    '--color-error': ['#c9303a', red.dark[50]],
    '--color-on-error': white,
  },
  // Astryx's own control sizes are drawn for a mouse. Under a finger every size reaches the 44 px of docs/history/handover.md §6 (WCAG 2.5.5).
  // By the pointer, not the width: a narrow window on a computer keeps its compact controls, a tablet does not.
  adaptations: {
    rules: [
      {
        when: { pointer: 'coarse' },
        value: {
          tokens: { '--size-element-sm': '44px', '--size-element-md': '44px', '--size-element-lg': '48px' },
          components: {
            'segmented-control-item': { base: { minHeight: '44px' } },
            item: { base: { minHeight: '44px' } },
            'collapsible-trigger': { base: { minHeight: '44px' } },
          },
        },
      },
    ],
  },
  components: {
    ...Object.fromEntries(STATUS_FIELDS.map(field => [field, focusedStatusField()])),
    ...Object.fromEntries(STATUS_SELECTORS.map(field => [field, focusedStatusField('variant:input+')])),
    // A FileInput takes the same inset. Its focus is otherwise its container's border colour alone, with or without a
    // status, and forced colours paint every border the same: a transparent outline is invisible until forced colours
    // give it a system colour.
    'file-input': {
      ...focusedStatusField(),
      base: { ':focus-within': { outline: '2px solid transparent', outlineOffset: '-2px' } },
    },
    'chat-layout': { base: { scrollPaddingBottom: '240px' } },
    // The area mark (D71, `mark.tsx`): gray, the sixth system hue, on Astryx's own gray tokens, which its Badge has no
    // variant for; and the house, Clew's own systems, outlined with no hue. New `variant:value` keys are Astryx's
    // documented way to extend a component's variants from the theme.
    badge: {
      'variant:gray': { backgroundColor: 'var(--color-background-gray)', color: 'var(--color-text-gray)' },
      'variant:house': {
        backgroundColor: 'var(--color-background-card)',
        color: 'var(--color-text-primary)',
        boxShadow: 'inset 0 0 0 1px var(--color-border-emphasized)',
      },
    },
    // A figure that needs the person (D54, `figure.tsx`): the card's own background with an error-coloured outline,
    // the same documented extension as the badges above. Astryx's Card has tinted variants but no outlined status.
    card: {
      // Neutral's skeleton and muted card share a light colour. Keep the pending lines visible on that surface (D76).
      'variant:muted': { '--color-skeleton': 'var(--color-border-emphasized)' },
      'variant:alert': {
        backgroundColor: 'var(--color-background-card)',
        boxShadow: 'inset 0 0 0 1px var(--color-border-error)',
      },
    },
    'side-nav-heading': { base: { paddingBlock: 'var(--spacing-1)' } },
    // Progress bars (D71 item 5, amended 2026-11-10). Neutral draws the track in `--color-border-emphasized` and the
    // `neutral` variant fills with `--color-text-disabled`: 2.1:1 in the light appearance and the same grey as the track
    // in the dark one, and an installation's theme may make its emphasized border any colour (D98). The track is
    // Astryx's own track colour, which Slider and Spinner read, and the neutral fill is the text colour, as artboard 3
    // draws the bar: 13.9:1 and 6.5:1, held for a theme file by the `text-primary` on `track` pair.
    'progress-bar': { base: { '--color-background-muted': 'var(--color-track)' } },
    'progress-bar-fill': { 'variant:neutral': { backgroundColor: 'var(--color-text-primary)' } },
  },
});

type Tokens = NonNullable<Parameters<typeof defineTheme>[0]['tokens']>;
type ClewTheme = ReturnType<typeof defineTheme>;
/** Astryx registers a theme by its name, so a theme's name is its colours: the same colours are the same theme, built once. */
function themeKey(branding: Branding): string {
  let hash = 5381;
  for (const char of JSON.stringify(branding.theme?.colors ?? {})) hash = ((hash * 33) ^ char.charCodeAt(0)) >>> 0;
  return hash.toString(36);
}
const themes = new Map<string, ClewTheme>(),
  bands = new Map<string, ClewTheme>();

/**
 * The installation's theme (D98): Clew's base with the colours an administrator saved, each as Astryx's own
 * `[light, dark]` pair. The colours arrive validated (known tokens, opaque hex, contrast held against the base); the
 * focus ring follows the accent, as it does in Neutral. No theme saved is the base itself, Astryx Neutral (D46).
 */
export function createClewTheme(branding: Branding): ClewTheme {
  const colors = branding.theme?.colors;
  if (!colors) return clewBaseTheme;
  const key = themeKey(branding);
  let theme = themes.get(key);
  if (!theme) {
    theme = defineTheme({
      name: `clew-installation-${key}`,
      extends: clewBaseTheme,
      tokens: {
        ...Object.fromEntries(Object.entries(colors).map(([token, pair]) => ['--color-' + token, [pair[0], pair[1]]])),
        ...(colors.accent ? { '--focus-outline-color': [colors.accent[0], colors.accent[1]] } : {}),
      } as Tokens,
    });
    themes.set(key, theme);
  }
  return theme;
}

/**
 * The band of the shared header (D88): the installation's accent as the ground with its on-accent text and icons, the
 * same in both appearances, as the reference draws a dark blue bar on every page. Nested inside the page's theme by
 * `SiteHeader`, so only the bar changes: Astryx's own selected mark and focus ring swap to the on-accent colour, and
 * every token a `TopNav` and its items read is set, so nothing of the page's surface shows through. Without an accent
 * of the installation's own the bar is Neutral's accent, a near-black, with white text.
 */
export function createHeaderBandTheme(branding: Branding): ClewTheme {
  const colors = branding.theme?.colors;
  const band = colors?.accent ? colors.accent[0] : neutral.light[10];
  // The pair the theme file was checked with: its own on-accent, else the base's, which is what the page draws.
  const on = colors?.accent ? (colors['on-accent'] ?? THEME_BASE_COLORS['on-accent'])[0] : neutral.light[100];
  const key = themeKey(branding);
  let theme = bands.get(key);
  if (theme) return theme;
  theme = defineTheme({
    name: `clew-header-band-${colors ? key : 'neutral'}`,
    extends: createClewTheme(branding),
    tokens: {
      '--color-background-body': band,
      '--color-background-surface': band,
      '--color-background-card': band,
      '--color-background-muted': band,
      '--color-text-primary': on,
      '--color-text-secondary': on,
      '--color-text-accent': on,
      '--color-icon-primary': on,
      '--color-icon-secondary': on,
      '--color-icon-accent': on,
      '--color-accent': on,
      '--color-on-accent': band,
      // The selected item's and a secondary button's ground: a lighter wash of the band, white text still above 4.5:1.
      '--color-accent-muted': 'color-mix(in srgb, ' + on + ' 18%, ' + band + ')',
      '--color-neutral': 'color-mix(in srgb, ' + on + ' 18%, ' + band + ')',
      '--color-border': on,
      '--color-border-emphasized': on,
      '--focus-outline-color': on,
    },
  });
  bands.set(key, theme);
  return theme;
}

/** The values a theme's tokens resolve to in one appearance, without React: what `THEME_BASE_COLORS` is held to (D98). */
export const resolveClewTokens = (branding: Branding, mode: 'light' | 'dark') =>
  resolveThemeTokens(createClewTheme(branding), { mode }) as Record<string, string>;
/**
 * The component rules Astryx generates from a theme, as the browser gets them, without React: what a test reads to see
 * that a key in `components` became the rule it was written for, not only that the key is in the object.
 */
export const clewComponentCSS = (branding: Branding) => generateThemeCSS(createClewTheme(branding)).component;
