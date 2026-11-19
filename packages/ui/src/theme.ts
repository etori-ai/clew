import { defineTheme, generateThemeCSS } from '@astryxdesign/core/theme';
import { resolveThemeTokens } from '@astryxdesign/core/theme/tokens';
import { neutralPalettes, neutralTheme } from '@astryxdesign/theme-neutral';
import { THEME_BASE_COLORS, contrastRatio } from '@clew/contracts';
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
  // The type of the startsidan prototype (D130 item 2): headings in Raleway at 800, body text in the system's Arial,
  // on Astryx's own scale at base 14, ratio 1.2. Raleway is built into the bundle by `styles.css`; nothing is fetched
  // from a font service. Arial is named, not shipped: a system without it falls through to Helvetica or its sans-serif.
  typography: {
    scale: { base: 14, ratio: 1.2 },
    body: { family: 'Arial', fallbacks: 'Helvetica, sans-serif' },
    heading: {
      family: 'Raleway Variable',
      fallbacks: 'Raleway, Arial, Helvetica, sans-serif',
      weight: '800',
      weights: { 1: '800', 2: '800', 3: '800', 4: '800', 5: '800', 6: '800' },
    },
  },
  tokens: {
    // The prototype's type and form (D130 items 2 and 3), measured in the running prototype: a page title at 32 px, a
    // section's and a card's heading at 17 px with the level under it at 15, and a key figure at 30 px and 800. Body
    // text and supporting text are the scale's own 14 and 12 px, which the prototype's rows and lines also are. A
    // card's corners are 16 px with 8 and 6 inside it, and the low shadow is the prototype's card shadow, darker in
    // the dark appearance where a soft shadow does not show.
    '--text-heading-1-size': '2rem',
    '--text-heading-1-leading': '1.25',
    '--text-heading-2-size': '1.0625rem',
    '--text-heading-2-leading': '1.5',
    '--text-heading-3-size': '0.9375rem',
    '--text-heading-3-leading': '1.4667',
    '--text-display-3-size': '1.875rem',
    '--text-display-3-leading': '1.1',
    '--text-display-3-weight': '800',
    '--radius-container': '1rem',
    '--radius-element': '0.5rem',
    '--radius-inner': '0.375rem',
    '--shadow-low':
      '0 1px 2px light-dark(rgb(31 31 37 / 5%), rgb(0 0 0 / 30%)), 0 12px 30px -20px light-dark(rgb(31 31 37 / 32%), rgb(0 0 0 / 70%))',
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
      // On a phone the page title is 24 px on a 32 px line (D130): Raleway at 800 is wide, and at the desktop's size a
      // title and its controls (the calendar's week, Förslag and Ny bokning) no longer shared a line.
      {
        when: { width: { below: 'md' } },
        value: { tokens: { '--text-heading-1-size': '1.5rem', '--text-heading-1-leading': '1.3333' } },
      },
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
    // A conversation is read, not scanned: what is said in it is one step up the type scale from the interface around
    // it (product owner, 2026-11-14: "the chat text is a bit small"). Astryx's own scale token, on its own bubble.
    'chat-message-bubble': { base: { fontSize: 'var(--font-size-lg)' } },
    // An answer is Markdown, whose paragraphs and lists set the interface's size themselves: they follow what they
    // stand in instead, which is the same size everywhere but in a bubble. Headings keep their own steps.
    markdown: { base: { fontSize: 'inherit' } },
    'markdown-paragraph': { base: { fontSize: 'inherit' } },
    'markdown-list': { base: { fontSize: 'inherit' } },
    // The area mark (D71, `mark.tsx`): gray, the sixth system hue, on Astryx's own gray tokens, which its Badge has no
    // variant for; and the house, Clew's own systems, outlined with no hue. New `variant:value` keys are Astryx's
    // documented way to extend a component's variants from the theme.
    badge: {
      // A badge as the startsidan prototype draws a chip (D130 item 11): 6 px corners and the heading face in bold.
      base: {
        borderRadius: 'var(--radius-inner)',
        fontFamily: 'var(--font-family-heading)',
        fontWeight: 'var(--font-weight-bold)',
      },
      // A status is a tint with its colour's own words, never a filled surface, as the prototype's chips are. Each
      // pair is Astryx's own for a tinted badge (the hue's text on the hue's ground), with the hue's border as the
      // chip's edge, since Clew's red and green grounds are faint (D62). Held in every example theme and both
      // appearances at 5.9:1 or more (`tests/unit/branding.test.ts`).
      'variant:error': {
        backgroundColor: 'var(--color-background-red)',
        color: 'var(--color-text-red)',
        boxShadow: 'inset 0 0 0 1px var(--color-border-red)',
      },
      'variant:warning': {
        backgroundColor: 'var(--color-background-yellow)',
        color: 'var(--color-text-yellow)',
        boxShadow: 'inset 0 0 0 1px var(--color-border-yellow)',
      },
      'variant:success': {
        backgroundColor: 'var(--color-background-green)',
        color: 'var(--color-text-green)',
        boxShadow: 'inset 0 0 0 1px var(--color-border-green)',
      },
      'variant:info': {
        backgroundColor: 'var(--color-background-blue)',
        color: 'var(--color-text-blue)',
        boxShadow: 'inset 0 0 0 1px var(--color-border-blue)',
      },
      'variant:gray': { backgroundColor: 'var(--color-background-gray)', color: 'var(--color-text-gray)' },
      'variant:house': {
        backgroundColor: 'var(--color-background-card)',
        color: 'var(--color-text-primary)',
        boxShadow: 'inset 0 0 0 1px var(--color-border-emphasized)',
      },
    },
    card: {
      // A card rests on the low shadow, as every card of the prototype does (D130 item 3).
      base: { boxShadow: 'var(--shadow-low)' },
      // Neutral's skeleton and muted card share a light colour. Keep the pending lines visible on that surface (D76).
      'variant:muted': { '--color-skeleton': 'var(--color-border-emphasized)' },
      // A figure that needs the person (D54, `figure.tsx`): the card's own background with an error-coloured outline,
      // the same documented extension as the badges above. Astryx's Card has tinted variants but no outlined status.
      'variant:alert': {
        backgroundColor: 'var(--color-background-card)',
        boxShadow: 'inset 0 0 0 1px var(--color-border-error), var(--shadow-low)',
      },
      // The focus news (D130 item 13, `focus-news.tsx`): a card in the blue tint, which in a theme like the prototype's is
      // nearly the page's own colour (1.02:1), so the card has the hue's border as its edge, 2 px as the prototype
      // draws it, and the card's shadow.
      'variant:blue': { boxShadow: 'inset 0 0 0 2px var(--color-border-blue), var(--shadow-low)' },
      // Hem's question (D130 item 14, `start.tsx`): the field, its mark and its button stand in one pill on the card's
      // ground with the assistant's blue as its edge and the card's shadow, as the startsidan prototype draws its ask
      // field. The pill shows the focus of the field in it (2.4.7): a 2 px edge in the assistant's blue, which the
      // theme file holds to 3:1 on the surface as a mark. `ai-mark` is the round mark at the pill's start.
      'variant:ask': {
        backgroundColor: 'var(--color-background-card)',
        borderRadius: 'var(--radius-full)',
        boxShadow: 'inset 0 0 0 1px var(--color-border-blue), var(--shadow-low)',
        ':focus-within': { boxShadow: 'inset 0 0 0 2px var(--color-info), var(--shadow-low)' },
      },
      'variant:ai-mark': {
        backgroundColor: 'var(--color-info)',
        color: 'var(--color-on-info)',
        borderRadius: 'var(--radius-full)',
        boxShadow: 'none',
      },
      // A row in a card that lists what needs the person (D130 item 13, `status-row.tsx`), as the startsidan prototype
      // draws one: the ground's colour, 6 px corners, no shadow, and a 4 px edge at its start in the row's status
      // colour. The row's badge and words still say the status (1.4.1).
      ...Object.fromEntries(
        (
          [
            ['error', 'var(--color-error)'],
            ['warning', 'var(--color-warning)'],
            ['info', 'var(--color-info)'],
            ['success', 'var(--color-success)'],
            ['neutral', 'var(--color-border-emphasized)'],
          ] as const
        ).map(([status, edge]) => [
          `variant:row-${status}`,
          {
            backgroundColor: 'var(--color-background-body)',
            borderRadius: 'var(--radius-inner)',
            boxShadow: `inset 4px 0 0 ${edge}`,
          },
        ]),
      ),
    },
    // A button's label is set in the heading face, as the prototype sets its buttons (D130 item 2). The secondary
    // button is the prototype's quiet one: the card's ground, an edge and the accent's words, so it reads as a button
    // on the tinted page and on a white card alike.
    button: {
      base: { fontFamily: 'var(--font-family-heading)', fontWeight: 'var(--font-weight-bold)' },
      'variant:secondary': {
        backgroundColor: 'var(--color-background-card)',
        color: 'var(--color-text-accent)',
        boxShadow: 'inset 0 0 0 1px var(--color-border-emphasized)',
      },
      // The assistant's button (D130 item 14): a pill in the assistant's blue, the theme's info colour, with the text
      // the theme file is held to on it (`on-info` on `info`, 4.5:1). The documented `variant:value` extension.
      'variant:ai': {
        backgroundColor: 'var(--color-info)',
        color: 'var(--color-on-info)',
        borderRadius: 'var(--radius-full)',
      },
      // In the ask pill and in the corner it is the reference's size: 46 px high with 24 px at each side.
      'variant:ai+size:lg': { minHeight: '46px', paddingInline: '24px' },
    },
    // The current place and the current page in the header are marked with a line under the word, as the reference
    // draws its tabs, not with a filled pill (D130 item 5). The line is the accent: white on the band, whose theme
    // sets the accent to the band's text, and the installation's blue in the row under it.
    'top-nav-item': {
      selected: {
        backgroundColor: 'transparent',
        borderRadius: '0',
        boxShadow: 'inset 0 -3px 0 var(--color-accent)',
        fontWeight: 'var(--font-weight-bold)',
      },
    },
    // A key figure as the startsidan prototype draws one (D130, `figure.tsx`, `lage.tsx`): its label in small capitals
    // with room between the letters, and its value in its tone's colour. `eyebrow` is a text type, not a badge, so a
    // long label wraps instead of being cut, and the capitals are drawn, not written: the label keeps its own spelling
    // for a screen reader. The status colours as text colours are Astryx's own text tokens; the tone's word stands
    // under the value, so the colour is never the only sign (1.4.1).
    text: {
      'type:eyebrow': {
        color: 'var(--color-text-secondary)',
        fontFamily: 'var(--font-family-heading)',
        fontSize: '0.6875rem',
        lineHeight: '1.4',
        fontWeight: 'var(--font-weight-bold)',
        letterSpacing: '0.12em',
        textTransform: 'uppercase',
      },
      'color:success': { color: 'var(--color-text-success)' },
      'color:warning': { color: 'var(--color-text-warning)' },
      'color:error': { color: 'var(--color-text-error)' },
    },
    // A person's initials stand on the identity colour, as the startsidan prototype draws an avatar (D130 item 16):
    // the accent with the text the theme file holds to 4.5:1 on it.
    'avatar-fallback': {
      base: {
        backgroundColor: 'var(--color-accent)',
        color: 'var(--color-on-accent)',
        fontFamily: 'var(--font-family-heading)',
        fontWeight: 'var(--font-weight-bold)',
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
  bands = new Map<string, ClewTheme>(),
  asks = new Map<string, ClewTheme>();

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
 * The band of the shared header (D88): the installation's accent as the ground with its on-accent text and icons, or
 * the theme's inverted background when it sets one (D130), the same in both appearances, as the reference draws a dark
 * blue bar on every page. Nested inside the page's theme by
 * `SiteHeader`, so only the bar changes: Astryx's own selected mark and focus ring swap to the on-accent colour, and
 * every token a `TopNav` and its items read is set, so nothing of the page's surface shows through. Without an accent
 * of the installation's own the bar is Neutral's accent, a near-black, with white text.
 */
export function createHeaderBandTheme(branding: Branding): ClewTheme {
  const colors = branding.theme?.colors;
  // A theme that sets its inverted background has chosen the ground its dark surfaces stand on, and the band is one
  // (D130 item 4): the prototype's band is a darker blue than its accent. Its text is white or black, whichever reads.
  const inverted = colors?.['background-inverted']?.[0];
  const band = inverted ?? (colors?.accent ? colors.accent[0] : neutral.light[10]);
  // The pair the theme file was checked with: its own on-accent, else the base's, which is what the page draws.
  const on = inverted
    ? contrastRatio('#ffffff', inverted) >= 4.5
      ? '#ffffff'
      : '#000000'
    : colors?.accent
      ? (colors['on-accent'] ?? THEME_BASE_COLORS['on-accent'])[0]
      : neutral.light[100];
  const key = themeKey(branding);
  let theme = bands.get(key);
  if (theme) return theme;
  const page = createClewTheme(branding);
  const tokens: Record<string, string> = {
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
  };
  theme = defineTheme({
    name: `clew-header-band-${colors ? key : 'neutral'}`,
    extends: page,
    tokens,
    // A sheet that rises from a control on the band (the reminders on a touch phone) is the page's surface, not the
    // band's: every colour the band changes is set back to the page's on the sheet itself, so its ground, its close
    // button and what it holds are drawn as anywhere else on the page (1.4.3). A popover keeps its own ground already.
    components: {
      'bottom-sheet': {
        base: Object.fromEntries(
          Object.keys(tokens).flatMap(token => {
            const value = (page.tokens as Record<string, string | undefined>)[token];
            return value ? [[token, value]] : [];
          }),
        ),
      },
    },
  });
  bands.set(key, theme);
  return theme;
}

/**
 * The theme inside Hem's ask pill (D130 item 14): the field in it has no edge or ground of its own, since the pill
 * around it is the field a person sees, and the pill shows its focus. Nested inside the page's theme, as the header's
 * band is, so no other field changes.
 */
export function createAskFieldTheme(branding: Branding): ClewTheme {
  const key = themeKey(branding);
  let theme = asks.get(key);
  if (theme) return theme;
  theme = defineTheme({
    name: `clew-ask-field-${branding.theme?.colors ? key : 'neutral'}`,
    extends: createClewTheme(branding),
    components: {
      'text-input': {
        base: {
          borderColor: 'transparent',
          backgroundColor: 'transparent',
          boxShadow: 'none',
          fontSize: 'var(--font-size-lg)',
          ':focus-within': { borderColor: 'transparent', boxShadow: 'none' },
        },
      },
    },
  });
  asks.set(key, theme);
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
