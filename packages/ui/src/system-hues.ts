/**
 * The hue of a system's mark (D71), beside `branding.ts` and `theme.ts` (D38): six Astryx category hues in the order the
 * administrator registered the systems (D23). Blue is the assistant's and info's; green, yellow and red are status; so
 * none of them is here. The seventh system starts over at teal: the icon and the word still tell the two apart. Clew's
 * own systems (the house) have no ordinal and so no hue. A page asks for a system's mark and gets the Badge variant back.
 */
export const systemHues = ['teal', 'purple', 'orange', 'cyan', 'pink', 'gray'] as const;
export type SystemHue = (typeof systemHues)[number];
export const hueOf = (ordinal: number | null | undefined): SystemHue | null =>
  ordinal ? systemHues[(ordinal - 1) % systemHues.length]! : null;
/** The hue's Swedish word, where the administration names the colour beside its swatch. */
export const hueWord: Record<SystemHue, string> = {
  teal: 'blågrön',
  purple: 'lila',
  orange: 'orange',
  cyan: 'cyan',
  pink: 'rosa',
  gray: 'grå',
};
/** A Swedish ordinal: 1:a, 2:a, 3:e … 11:e, 12:e … 21:a. */
export const ordinalWord = (n: number) =>
  `${n}:${(n % 10 === 1 || n % 10 === 2) && n % 100 !== 11 && n % 100 !== 12 ? 'a' : 'e'}`;
