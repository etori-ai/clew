/**
 * The installation's theme file (D98): colours for Clew's semantic roles, written in the Design Tokens Community
 * Group format (Format Module 2025.10, `.tokens.json`). An administrator uploads one; Clew reads the two groups
 * `light.color` and `dark.color`, whose token names are Astryx's colour tokens without the `--color-` prefix, and
 * nothing else in the file is drawn. Any other group is the file's own (a palette, say) and may be referenced as
 * `{palette.blue}`.
 *
 * Pure functions: the server refuses a file with these and the administration page previews one with the same code,
 * so the two can never disagree. A theme carries colour only. Typography, sizes, motion, component overrides and the
 * colours that carry a warning or an error stay Clew's (D38), which is why those tokens are not in the list.
 */

/** Astryx's semantic colour tokens a theme file may set, without the `--color-` prefix. A closed list (D98). */
export const THEME_COLOR_TOKENS = [
  'accent',
  'accent-muted',
  'on-accent',
  'text-accent',
  'icon-accent',
  'neutral',
  'background-body',
  'background-surface',
  'background-card',
  'background-popover',
  'background-muted',
  'background-inverted',
  'text-primary',
  'text-secondary',
  'text-disabled',
  'icon-primary',
  'icon-secondary',
  'icon-disabled',
  'on-dark',
  'on-light',
  'border',
  'border-emphasized',
  'skeleton',
  'track',
  'info',
  'info-muted',
  'on-info',
  'on-info-muted',
  'text-info',
  'icon-info',
  'border-info',
  'success',
  'success-muted',
  'on-success',
  'on-success-muted',
  'text-success',
  'icon-success',
  'border-success',
  ...(['blue', 'cyan', 'gray', 'green', 'orange', 'pink', 'purple', 'teal'] as const).flatMap(
    hue => [`background-${hue}`, `border-${hue}`, `icon-${hue}`, `text-${hue}`] as const,
  ),
] as const;
export type ThemeColorToken = (typeof THEME_COLOR_TOKENS)[number];
export type ThemeMode = 'light' | 'dark';
/** One colour per appearance, as six-digit lowercase hex: `[light, dark]`, the tuple Astryx's `defineTheme` takes. */
export type ThemeColorPair = readonly [light: string, dark: string];
export type ThemeColors = Readonly<Partial<Record<ThemeColorToken, ThemeColorPair>>>;
/** A theme as Clew keeps and serves it: the file's name and its colours, normalised. Never the uploaded text. */
export interface InstallationTheme {
  name: string | null;
  colors: ThemeColors;
}
/** What is wrong with a file, in the words the administration page shows. `token` and `mode` point at the place. */
export interface ThemeProblem {
  code: 'format' | 'token' | 'value' | 'contrast';
  message: string;
  token?: string;
  mode?: ThemeMode;
}
export type ThemeFileResult = { ok: true; theme: InstallationTheme } | { ok: false; problems: ThemeProblem[] };

export const THEME_FILE_MAX_BYTES = 64_000;
export const THEME_NAME_MAX = 80;
const MAX_PROBLEMS = 20;
const isToken = (name: string): name is ThemeColorToken => (THEME_COLOR_TOKENS as readonly string[]).includes(name);
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const HEX = /^#[0-9a-f]{6}$/;
const MODE_LABEL: Record<ThemeMode, string> = { light: 'ljust', dark: 'mörkt' };

/** WCAG 2.2 relative luminance contrast between two six-digit sRGB hex colours. */
export function contrastRatio(first: string, second: string): number {
  const luminance = (hex: string) =>
    (
      [
        [1, 0.2126],
        [3, 0.7152],
        [5, 0.0722],
      ] as const
    ).reduce((sum, [offset, weight]) => {
      const channel = parseInt(hex.slice(offset, offset + 2), 16) / 255;
      const linear = channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      return sum + linear * weight;
    }, 0);
  const a = luminance(first),
    b = luminance(second);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/**
 * The colours of Clew's base theme (Astryx Neutral with Clew's overrides, `clewBaseTheme`) for every token a contrast
 * pair names. A file that sets one half of a pair is checked against the other half as the page will draw it.
 * `tests/unit/theme-file.test.ts` holds this table to the theme itself, so an Astryx upgrade cannot leave it behind.
 */
export const THEME_BASE_COLORS = {
  accent: ['#1b1b1b', '#f1f1f1'],
  'on-accent': ['#ffffff', '#111111'],
  'text-accent': ['#1b1b1b', '#f1f1f1'],
  'icon-accent': ['#1b1b1b', '#f1f1f1'],
  'background-body': ['#f1f1f1', '#1b1b1b'],
  'background-surface': ['#ffffff', '#262626'],
  'background-card': ['#ffffff', '#1b1b1b'],
  'background-popover': ['#ffffff', '#1b1b1b'],
  'background-muted': ['#f1f1f1', '#1b1b1b'],
  'text-primary': ['#000000', '#ffffff'],
  'text-secondary': ['#474747', '#9e9e9e'],
  'icon-primary': ['#000000', '#ffffff'],
  'icon-secondary': ['#6a6a6a', '#9e9e9e'],
  info: ['#0074e2', '#6d9cfe'],
  'on-info': ['#ffffff', '#111111'],
  'text-info': ['#0067ce', '#a1caff'],
  success: ['#198100', '#64af4c'],
  'on-success': ['#ffffff', '#111111'],
  'text-success': ['#2f7d33', '#90ca90'],
  track: ['#ccd3db', '#5a5e66'],
} as const satisfies ThemeColors;
type PairToken = keyof typeof THEME_BASE_COLORS;

const TEXT = 4.5,
  MARK = 3;
/**
 * What must be readable on what (WCAG 2.2 AA: 1.4.3 for text at 4.5:1, 1.4.11 for marks and the focus ring at 3:1),
 * in both appearances. The base theme passes every row; a file is refused when the theme it would make does not.
 */
export const THEME_CONTRAST_PAIRS: ReadonlyArray<readonly [foreground: PairToken, background: PairToken, min: number]> =
  [
    ['text-primary', 'background-body', TEXT],
    ['text-primary', 'background-surface', TEXT],
    ['text-primary', 'background-card', TEXT],
    ['text-primary', 'background-popover', TEXT],
    ['text-primary', 'background-muted', TEXT],
    ['text-secondary', 'background-body', TEXT],
    ['text-secondary', 'background-surface', TEXT],
    ['text-secondary', 'background-card', TEXT],
    ['text-accent', 'background-surface', TEXT],
    ['text-accent', 'background-card', TEXT],
    ['text-info', 'background-surface', TEXT],
    ['text-success', 'background-surface', TEXT],
    ['on-accent', 'accent', TEXT],
    ['on-info', 'info', TEXT],
    ['on-success', 'success', TEXT],
    ['accent', 'background-surface', MARK],
    ['accent', 'background-body', MARK],
    ['icon-accent', 'background-surface', MARK],
    ['icon-primary', 'background-surface', MARK],
    ['icon-secondary', 'background-surface', MARK],
    // A progress bar's fill on its track: Clew draws its bars in the text colour on Astryx's track colour (D71 item 5).
    ['text-primary', 'track', MARK],
  ];

/** Every pair the theme made of these colours over the base would fail, as problems an administrator can act on. */
export function checkThemeContrast(colors: ThemeColors): ThemeProblem[] {
  const problems: ThemeProblem[] = [];
  const at = (token: PairToken, index: 0 | 1) => (colors[token] ?? THEME_BASE_COLORS[token])[index];
  for (const [foreground, background, min] of THEME_CONTRAST_PAIRS) {
    // A pair the file does not touch is the base theme's own and already holds.
    if (!colors[foreground] && !colors[background]) continue;
    for (const [index, mode] of [
      [0, 'light'],
      [1, 'dark'],
    ] as const) {
      const ratio = contrastRatio(at(foreground, index), at(background, index));
      if (ratio >= min) continue;
      problems.push({
        code: 'contrast',
        token: foreground,
        mode,
        message: `${foreground} (${at(foreground, index)}) mot ${background} (${at(background, index)}) har kontrasten ${ratio.toFixed(1).replace('.', ',')}:1 i ${MODE_LABEL[mode]} läge. Minst ${String(min).replace('.', ',')}:1 krävs.`,
      });
    }
  }
  return problems;
}

/** A DTCG colour value in sRGB without transparency, or a six-digit hex string as older exports write it. */
function colorOf(value: unknown): string | { problem: string } {
  if (typeof value === 'string') {
    const hex = value.trim().toLowerCase();
    return HEX.test(hex) ? hex : { problem: 'Färgen ska vara sex hexadecimala siffror, till exempel #005595.' };
  }
  if (!isObject(value)) return { problem: 'Färgen saknar värde.' };
  if (value.colorSpace !== 'srgb') return { problem: 'Bara färgrymden srgb stöds.' };
  if (value.alpha !== undefined && value.alpha !== 1) return { problem: 'Genomskinliga färger stöds inte.' };
  const components = value.components;
  if (
    !Array.isArray(components) ||
    components.length !== 3 ||
    !components.every(c => typeof c === 'number' && c >= 0 && c <= 1)
  )
    return { problem: 'Färgens components ska vara tre tal mellan 0 och 1.' };
  return (
    '#' +
    (components as number[])
      .map(c =>
        Math.round(c * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')
  );
}

/**
 * Reads a parsed theme file. Every problem found is reported, up to twenty, so a file is corrected in one pass; the
 * contrast check runs only on a file that is otherwise sound.
 */
export function parseThemeFile(file: unknown): ThemeFileResult {
  const problems: ThemeProblem[] = [];
  const fail = (problem: ThemeProblem) => {
    if (problems.length < MAX_PROBLEMS) problems.push(problem);
  };
  if (!isObject(file)) return { ok: false, problems: [{ code: 'format', message: 'Filen är inte en temafil.' }] };
  const description = file.$description;
  if (description !== undefined && (typeof description !== 'string' || description.trim().length > THEME_NAME_MAX))
    fail({ code: 'format', message: `Filens $description ska vara en text på högst ${THEME_NAME_MAX} tecken.` });

  /** A token anywhere in the file by its path, with the `$type` it has or inherits; aliases are followed, a loop is refused. */
  function resolve(path: string, seen: string[] = []): string | { problem: string } {
    if (seen.includes(path)) return { problem: 'Referensen pekar på sig själv.' };
    if (seen.length > 8) return { problem: 'Referensen går i för många led.' };
    let node: unknown = file,
      type: unknown;
    for (const part of path.split('.')) {
      if (!isObject(node) || !Object.hasOwn(node, part) || part.startsWith('$'))
        return { problem: `Referensen {${path}} finns inte i filen.` };
      if (typeof node.$type === 'string') type = node.$type;
      node = node[part];
    }
    if (!isObject(node) || !Object.hasOwn(node, '$value')) return { problem: `{${path}} är inte en token.` };
    if (typeof node.$type === 'string') type = node.$type;
    if (type !== 'color') return { problem: `{${path}} ska ha $type color.` };
    const value = node.$value;
    const alias = typeof value === 'string' ? /^\{([^{}]+)\}$/.exec(value.trim()) : null;
    return alias ? resolve(alias[1]!, [...seen, path]) : colorOf(value);
  }

  const read: Record<ThemeMode, Map<ThemeColorToken, string>> = { light: new Map(), dark: new Map() };
  for (const mode of ['light', 'dark'] as const) {
    const group = isObject(file[mode]) ? (file[mode] as Record<string, unknown>).color : undefined;
    if (!isObject(group)) {
      fail({ code: 'format', mode, message: `Filen saknar gruppen ${mode}.color.` });
      continue;
    }
    for (const name of Object.keys(group)) {
      if (name.startsWith('$')) continue;
      if (!isToken(name)) {
        fail({ code: 'token', token: name, mode, message: `${name} är inte en färg som ett tema kan sätta.` });
        continue;
      }
      const color = resolve(`${mode}.color.${name}`);
      if (typeof color === 'string') read[mode].set(name, color);
      else fail({ code: 'value', token: name, mode, message: `${name} i ${MODE_LABEL[mode]} läge: ${color.problem}` });
    }
  }
  const colors: Partial<Record<ThemeColorToken, ThemeColorPair>> = {};
  for (const token of THEME_COLOR_TOKENS) {
    const light = read.light.get(token),
      dark = read.dark.get(token);
    if (light && dark) colors[token] = [light, dark];
    else if (light || dark)
      // Reported once per token, and not on top of a problem the same token already has in the missing mode.
      if (!problems.some(p => p.token === token))
        fail({
          code: 'token',
          token,
          mode: light ? 'dark' : 'light',
          message: `${token} saknas i ${MODE_LABEL[light ? 'dark' : 'light']} läge. En färg sätts för båda lägena.`,
        });
  }
  if (!problems.length && !Object.keys(colors).length) fail({ code: 'format', message: 'Filen sätter inga färger.' });
  if (!problems.length) for (const problem of checkThemeContrast(colors)) fail(problem);
  if (problems.length) return { ok: false, problems };
  return { ok: true, theme: { name: typeof description === 'string' ? description.trim() || null : null, colors } };
}

/** The same theme as a file again: what Hämta temafil gives, and what the examples in `themes/` are held to. */
export function themeFileOf(theme: InstallationTheme): Record<string, unknown> {
  const group = (index: 0 | 1) => ({
    color: {
      $type: 'color',
      ...Object.fromEntries(
        THEME_COLOR_TOKENS.filter(token => theme.colors[token]).map(token => {
          const hex = theme.colors[token]![index];
          const components = [1, 3, 5].map(offset =>
            Number((parseInt(hex.slice(offset, offset + 2), 16) / 255).toFixed(4)),
          );
          return [token, { $value: { colorSpace: 'srgb', components, hex } }];
        }),
      ),
    },
  });
  return { ...(theme.name ? { $description: theme.name } : {}), light: group(0), dark: group(1) };
}

/**
 * A theme from two colours, for an installation with no file of its own: the strong colour on light, the pale one on
 * dark, black and white text. The same mapping the `custom` profile of D38 drew; the result is an ordinary theme and
 * passes through `checkThemeContrast` like any file.
 */
export function themeFromAccent(accent: string, accentMuted: string, name: string | null = null): InstallationTheme {
  const strong = accent.trim().toLowerCase(),
    pale = accentMuted.trim().toLowerCase();
  return {
    name,
    colors: {
      accent: [strong, pale],
      'accent-muted': [pale, strong],
      'on-accent': ['#ffffff', '#000000'],
      'text-accent': ['#000000', '#ffffff'],
      'icon-accent': [strong, pale],
      'text-primary': ['#000000', '#ffffff'],
      'text-secondary': ['#4b4b4b', '#ececec'],
      'icon-primary': ['#000000', '#ffffff'],
      'icon-secondary': ['#4b4b4b', '#ececec'],
    },
  };
}
/**
 * The theme file as one JSON Schema document, for an editor or a pipeline outside this repository. It bounds the two
 * groups Clew reads; `parseThemeFile` is still the check that decides, since references and contrast are not a schema's
 * to express. Published as `docs/protocol/theme-file.schema.json` and held to this function by `bun run docs:check`.
 */
export function themeFileSchema(): Record<string, unknown> {
  const value = {
    oneOf: [
      { type: 'string', pattern: '^#[0-9a-fA-F]{6}$', description: 'Six-digit sRGB hex.' },
      { type: 'string', pattern: '^\\{[^{}]+\\}$', description: 'A reference to another colour token in the file.' },
      {
        type: 'object',
        required: ['colorSpace', 'components'],
        properties: {
          colorSpace: { const: 'srgb' },
          components: { type: 'array', items: { type: 'number', minimum: 0, maximum: 1 }, minItems: 3, maxItems: 3 },
          alpha: { const: 1 },
          hex: { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' },
        },
      },
    ],
  };
  const token = { type: 'object', required: ['$value'], properties: { $value: value, $type: { const: 'color' } } };
  const mode = (label: string) => ({
    type: 'object',
    required: ['color'],
    description: `The colours of the ${label} appearance. A token set here is set in the other appearance too.`,
    properties: {
      color: {
        type: 'object',
        description: "Astryx's semantic colour tokens without the --color- prefix.",
        properties: { $type: { const: 'color' }, ...Object.fromEntries(THEME_COLOR_TOKENS.map(name => [name, token])) },
        patternProperties: { '^\\$': {} },
        additionalProperties: false,
      },
    },
  });
  return {
    $schema: 'https://json-schema.org/draft/2020-12/schema',
    title: 'Clew theme file',
    description:
      'Colours for an installation of Clew in the Design Tokens Community Group format (Format Module 2025.10). ' +
      "Clew draws light.color and dark.color; any other group is the file's own and may be referenced.",
    type: 'object',
    required: ['light', 'dark'],
    properties: {
      $description: { type: 'string', maxLength: THEME_NAME_MAX, description: "The theme's name." },
      light: mode('light'),
      dark: mode('dark'),
    },
  };
}
export const isThemeHex = (value: string) => HEX.test(value.trim().toLowerCase());

/** The logo an installation shows in its header: stored by Clew and served from its own origin (D98). */
export const LOGO_MEDIA_TYPES = ['image/png', 'image/svg+xml'] as const;
export type LogoMediaType = (typeof LOGO_MEDIA_TYPES)[number];
export const LOGO_MAX_BYTES = 256_000;
export const LOGO_ALT_MAX = 120;
