import { defineTheme } from '@astryxdesign/core/theme';
import { neutralTheme } from '@astryxdesign/theme-neutral';
import { sundsvallPalette as palette, type Branding } from './branding';

/**
 * Every brand inherits Astryx Neutral with shared component overrides (D31 item 8, D39): ChatLayout docks the composer on a sticky
 * surface and sets no scroll padding, so a control the browser scrolls to the bottom edge would land under the dock
 * (WCAG 2.4.11). The padding is the height of the tallest dock the start page draws (the piles row and the compact
 * composer with its drawer open). Branding changes tokens, not behaviour (D38). Runtime rather than built: the page
 * renders after its JavaScript anyway, so first paint is the same.
 */
const clewBaseTheme = defineTheme({
  name: 'clew-neutral',
  extends: neutralTheme,
  typography: { scale: { base: 15, ratio: 1.2 } },
  // The side panel opens over a page that is still its context: half of Astryx's scrim, which keeps a dialog set apart without blacking the page out.
  tokens: { '--color-overlay': ['#01122833', '#1111124D'] },
  // Astryx's own control sizes are drawn for a mouse. Under a finger every size reaches HANDOVER §6's 44 px (WCAG 2.5.5).
  // By the pointer, not the width: a narrow window on a computer keeps its compact controls, a tablet does not.
  adaptations: { rules: [{ when: { pointer: 'coarse' }, value: { tokens: { '--size-element-sm': '44px', '--size-element-md': '44px', '--size-element-lg': '48px' }, components: { 'segmented-control-item': { base: { minHeight: '44px' } }, item: { base: { minHeight: '44px' } }, 'collapsible-trigger': { base: { minHeight: '44px' } } } } }] },
  components: {
    'chat-layout': { base: { scrollPaddingBottom: '240px' } },
    'side-nav-heading': { base: { paddingBlock: 'var(--spacing-1)' } },
  },
});

/** Explicit published colours; no generated approximations of the municipal palette (D38). */
const sundsvallTokens = {
  '--color-background-body': [palette.white, palette.black],
  '--color-background-surface': [palette.white, palette.black],
  '--color-background-card': [palette.white, palette.darkGray],
  '--color-background-popover': [palette.white, palette.darkGray],
  '--color-background-muted': [palette.lightGray, palette.darkGray],
  '--color-background-inverted': [palette.black, palette.white],
  '--color-neutral': [palette.lightGray, palette.darkGray],
  '--color-border': [palette.lightGray, palette.darkGray],
  '--color-border-emphasized': [palette.darkGray, palette.lightGray],
  '--color-on-dark': palette.white,
  '--color-on-light': palette.black,
  '--color-info': [palette.vattjom.dark, palette.vattjom.light],
  '--color-info-muted': [palette.vattjom.light, palette.vattjom.dark],
  '--color-on-info': [palette.white, palette.black],
  '--color-on-info-muted': [palette.black, palette.white],
  '--color-text-info': [palette.black, palette.white],
  '--color-icon-info': [palette.vattjom.dark, palette.vattjom.light],
  '--color-border-info': [palette.vattjom.dark, palette.vattjom.light],
  '--color-success': [palette.gronsta.dark, palette.gronsta.light],
  '--color-success-muted': [palette.gronsta.light, palette.gronsta.dark],
  '--color-on-success': [palette.white, palette.black],
  '--color-on-success-muted': [palette.black, palette.white],
  '--color-text-success': [palette.black, palette.white],
  '--color-icon-success': [palette.gronsta.dark, palette.gronsta.light],
  '--color-border-success': [palette.gronsta.dark, palette.gronsta.light],
  '--color-background-blue': [palette.vattjom.light, palette.vattjom.dark],
  '--color-border-blue': [palette.vattjom.dark, palette.vattjom.light],
  '--color-icon-blue': [palette.vattjom.dark, palette.vattjom.light],
  '--color-text-blue': [palette.black, palette.white],
  '--color-background-green': [palette.gronsta.light, palette.gronsta.dark],
  '--color-border-green': [palette.gronsta.dark, palette.gronsta.light],
  '--color-icon-green': [palette.gronsta.dark, palette.gronsta.light],
  '--color-text-green': [palette.black, palette.white],
  '--color-background-purple': [palette.bjornstigen.light, palette.bjornstigen.dark],
  '--color-border-purple': [palette.bjornstigen.dark, palette.bjornstigen.light],
  '--color-icon-purple': [palette.bjornstigen.dark, palette.bjornstigen.light],
  '--color-text-purple': [palette.black, palette.white],
  '--color-background-pink': [palette.juniskar.light, palette.juniskar.dark],
  '--color-border-pink': [palette.juniskar.dark, palette.juniskar.light],
  '--color-icon-pink': [palette.juniskar.dark, palette.juniskar.light],
  '--color-text-pink': [palette.black, palette.white],
} satisfies NonNullable<Parameters<typeof defineTheme>[0]['tokens']>;

export function createClewTheme(branding: Branding) {
  if (branding.profile === 'neutral') return clewBaseTheme;
  return defineTheme({
    name: `clew-${branding.profile}`,
    extends: clewBaseTheme,
    tokens: {
      ...(branding.profile === 'sundsvall' ? sundsvallTokens : {}),
      '--color-accent': [branding.colors.accent, branding.colors.accentMuted],
      '--color-accent-muted': [branding.colors.accentMuted, branding.colors.accent],
      '--color-on-accent': [palette.white, palette.black],
      '--color-text-primary': [palette.black, palette.white],
      '--color-text-secondary': [palette.darkGray, palette.lightGray],
      '--color-icon-primary': [palette.black, palette.white],
      '--color-icon-secondary': [palette.darkGray, palette.lightGray],
      '--color-text-accent': 'var(--color-text-primary)',
      '--color-icon-accent': [branding.colors.accent, branding.colors.accentMuted],
      '--focus-outline-color': [branding.colors.accent, branding.colors.accentMuted],
    },
  });
}
