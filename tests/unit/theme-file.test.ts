import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import {
  THEME_BASE_COLORS,
  THEME_COLOR_TOKENS,
  THEME_CONTRAST_PAIRS,
  SITE_NAME_DEFAULT,
  SITE_NAME_MAX,
  THEME_TEMPLATE,
  checkSiteName,
  checkThemeContrast,
  contrastRatio,
  parseThemeFile,
  themeColorOf,
  themeFileOf,
  themeFileSchema,
  themeFromAccent,
  type ThemeColorPair,
  type ThemeColorToken,
  type ThemeColors,
  type ThemeContrastToken,
} from '@clew/contracts';
import { NEUTRAL_BRANDING, type Branding } from '../../packages/ui/src/branding';
import { resolveClewTokens } from '../../packages/ui/src/theme';

const color = (hex: string) => ({ $value: hex });
const file = (light: Record<string, unknown>, dark: Record<string, unknown>, rest: Record<string, unknown> = {}) => ({
  ...rest,
  light: { color: { $type: 'color', ...light } },
  dark: { color: { $type: 'color', ...dark } },
});
const problemsOf = (value: unknown) => {
  const parsed = parseThemeFile(value);
  if (parsed.ok) throw new Error('The file was expected to be refused.');
  return parsed.problems;
};
const sundsvall = JSON.parse(
  readFileSync(new URL('../../themes/sundsvall/theme.tokens.json', import.meta.url), 'utf8'),
);
const prototype = JSON.parse(
  readFileSync(new URL('../../themes/startsidan-prototype/theme.tokens.json', import.meta.url), 'utf8'),
);
const examples = () =>
  readdirSync(new URL('../../themes/', import.meta.url), { withFileTypes: true })
    .filter(d => d.isDirectory())
    .map(({ name }) => ({
      name,
      file: JSON.parse(readFileSync(new URL(`../../themes/${name}/theme.tokens.json`, import.meta.url), 'utf8')),
    }));
/** A theme as an installation saves it, for Astryx to resolve as the page does. */
const branding = (colors: ThemeColors): Branding => ({
  revision: 1,
  name: SITE_NAME_DEFAULT,
  theme: { name: null, colors },
  logo: null,
});
/** Each pair as one line, for a table compared whole: `foreground on ground` and its minimum. */
const tableOf = (pairs: ReadonlyArray<readonly [string, string, number]>) =>
  Object.fromEntries(pairs.map(([foreground, ground, min]) => [`${foreground} on ${ground}`, min]));
/** `#rrggbbaa` over an opaque ground, as a browser lays a translucent fill over what is under it. */
const composite = (color: string, ground: string) =>
  '#' +
  [1, 3, 5]
    .map(o => {
      const alpha = parseInt(color.slice(7, 9), 16) / 255;
      const value = parseInt(color.slice(o, o + 2), 16) * alpha + parseInt(ground.slice(o, o + 2), 16) * (1 - alpha);
      return Math.round(value).toString(16).padStart(2, '0');
    })
    .join('');
/** A base colour as the page shows it: a translucent tint over the base surface. */
const shown = (token: ThemeContrastToken, index: 0 | 1) => {
  const hex = THEME_BASE_COLORS[token][index];
  return hex.length === 9 ? composite(hex, THEME_BASE_COLORS['background-surface'][index]) : hex;
};

describe('the theme file and the base it is checked against (D98)', () => {
  const resolved = {
    light: resolveClewTokens(NEUTRAL_BRANDING, 'light'),
    dark: resolveClewTokens(NEUTRAL_BRANDING, 'dark'),
  };

  test('contrast uses WCAG sRGB luminance', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#005595', '#005595')).toBe(1);
    expect(contrastRatio('#ffffff', '#777777')).toBeCloseTo(4.478, 3);
  });

  test("every colour a file may set is one of Astryx's colour tokens, and the status colours are not among them", () => {
    for (const token of THEME_COLOR_TOKENS) expect(resolved.light['--color-' + token]).toBeDefined();
    expect(new Set(THEME_COLOR_TOKENS).size).toBe(THEME_COLOR_TOKENS.length);
    for (const reserved of ['error', 'on-error', 'warning', 'text-error', 'background-red', 'text-yellow', 'overlay'])
      expect(THEME_COLOR_TOKENS as readonly string[]).not.toContain(reserved);
  });

  test("the base table is Clew's base theme as Astryx resolves it, so an upgrade cannot leave it behind", () => {
    for (const [token, [light, dark]] of Object.entries(THEME_BASE_COLORS)) {
      expect(resolved.light['--color-' + token]?.toLowerCase()).toBe(light);
      expect(resolved.dark['--color-' + token]?.toLowerCase()).toBe(dark);
    }
  });

  test('the base theme holds every contrast pair in both appearances, its translucent tints laid over the surface', () => {
    for (const [foreground, background, min] of THEME_CONTRAST_PAIRS)
      for (const index of [0, 1] as const)
        expect(contrastRatio(shown(foreground, index), shown(background, index))).toBeGreaterThanOrEqual(min);
    expect(checkThemeContrast({})).toEqual([]);
    expect(checkThemeContrast(THEME_BASE_COLORS)).toEqual([]);
  });

  test('the table holds each colour on the grounds it is drawn on, at its minimum (WA-M1)', () => {
    const grounds = ['background-body', 'background-surface', 'background-card', 'background-popover'];
    const withMuted = [...grounds, 'background-muted'];
    const each = (foreground: string, on: string[], min: number) => on.map(g => [foreground, g, min] as const);
    expect(tableOf(THEME_CONTRAST_PAIRS)).toEqual(
      tableOf([
        ...each('text-primary', [...withMuted, 'accent-muted'], 4.5),
        ...each('text-primary', ['track'], 3),
        ...each('text-secondary', withMuted, 4.5),
        ...each('text-accent', withMuted, 4.5),
        ...each('text-info', grounds, 4.5),
        ...each('text-success', grounds, 4.5),
        ...each('on-accent', ['accent'], 4.5),
        ...each('on-info', ['info'], 4.5),
        ...each('on-success', ['success'], 4.5),
        ...each('text-blue', ['background-blue'], 4.5),
        ...each('text-green', ['background-green'], 4.5),
        ...each('on-info-muted', ['info-muted'], 4.5),
        ...each('on-success-muted', ['success-muted'], 4.5),
        ...each('accent', withMuted, 3),
        ...each('icon-accent', grounds, 3),
        ...each('icon-primary', grounds, 3),
        ...each('icon-secondary', withMuted, 3),
        ...each('icon-info', grounds, 3),
        ...each('icon-success', grounds, 3),
      ]),
    );
    // Each pair once: a row written twice would hide one dropped.
    expect(Object.keys(tableOf(THEME_CONTRAST_PAIRS))).toHaveLength(THEME_CONTRAST_PAIRS.length);
  });

  test('every colour the check measures is the one Astryx draws for the same file, a status icon following its words', () => {
    const tokens = Object.keys(THEME_BASE_COLORS) as ThemeContrastToken[];
    // Each token set alone to a colour of its own, so a token drawn in another's colour shows. A badge's text and ground
    // are left out: Clew draws black or white on a saved badge whose pair fails (`theme.ts`), which this colour would.
    tokens.forEach((set, n) => {
      if (/^(text|background)-(blue|green)$/.test(set)) return;
      const pair: ThemeColorPair = [
        `#0${n.toString(16).padStart(2, '0')}0aa`,
        `#a${n.toString(16).padStart(2, '0')}a01`,
      ];
      const colors: ThemeColors = { [set]: pair };
      const light = resolveClewTokens(branding(colors), 'light'),
        dark = resolveClewTokens(branding(colors), 'dark');
      for (const token of tokens)
        expect(themeColorOf(colors, token), `${token} with ${set} set`).toEqual([
          light['--color-' + token]!.toLowerCase(),
          dark['--color-' + token]!.toLowerCase(),
        ]);
    });
    expect(themeColorOf({ 'text-success': ['#a5d6a7', '#1b3a1c'] }, 'icon-success')).toEqual(['#a5d6a7', '#1b3a1c']);
    expect(themeColorOf({ 'text-info': ['#9fc5f0', '#a1caff'] }, 'icon-success')).toEqual(
      THEME_BASE_COLORS['icon-success'],
    );
  });

  test('every pair is enforced: a foreground drawn in its ground’s colour is refused, one that reads passes', () => {
    for (const [foreground, background, min] of THEME_CONTRAST_PAIRS) {
      const ground = [shown(background, 0), shown(background, 1)] as const;
      const refused = checkThemeContrast({ [foreground]: ground });
      for (const mode of ['light', 'dark'] as const)
        expect(
          refused.some(
            p =>
              p.token === foreground &&
              p.mode === mode &&
              p.message.startsWith(`${foreground} (`) &&
              p.message.includes(` mot ${background} (`) &&
              p.message.endsWith(`Minst ${String(min).replace('.', ',')}:1 krävs.`),
          ),
          `${foreground} on ${background} in ${mode}`,
        ).toBe(true);
      // Black or white, whichever reads more on the ground, holds the pair and every other one it is in.
      const reads = (hex: string) =>
        contrastRatio('#000000', hex) >= contrastRatio('#ffffff', hex) ? '#000000' : '#ffffff';
      expect(checkThemeContrast({ [foreground]: [reads(ground[0]), reads(ground[1])] }), foreground).toEqual([]);
    }
  });

  test('the focus ring, marks, icons and status words are held on a card and on the page, not only on a surface (WA-M1)', () => {
    // A blue card the review found accepted: the accent (the focus ring), the status words and the grey icons on it.
    const problems = checkThemeContrast({
      'background-card': ['#a8c0e8', '#1d2a44'],
      accent: ['#3b6fd0', '#8fb4ff'],
      'text-secondary': ['#1f2a3d', '#d6def0'],
      'text-accent': ['#10244d', '#cfe0ff'],
    });
    const failing = problems.map(p => `${p.token} ${p.message.split(' mot ')[1]!.split(' ')[0]} ${p.mode}`);
    for (const pair of [
      'accent background-card light',
      'text-success background-card light',
      'text-info background-card light',
      'icon-secondary background-card light',
    ])
      expect(failing).toContain(pair);
    expect(failing.every(p => p.includes('background-card'))).toBe(true);
    // The status icons follow those words, held at 4.5:1 on the same card: their problem is the words', named once.
    expect(problems.filter(p => p.token === 'icon-info' || p.token === 'icon-success')).toEqual([]);
    // The same accent and status words on a page whose ground is that blue.
    const page = checkThemeContrast({ 'background-body': ['#a8c0e8', '#1d2a44'], accent: ['#3b6fd0', '#8fb4ff'] });
    expect(page.map(p => `${p.token} ${p.mode}`)).toEqual(
      expect.arrayContaining(['accent light', 'text-info light', 'text-success light', 'icon-secondary light']),
    );
  });

  test('on the muted ground the accent, the secondary icon, the secondary words and a link are held too', () => {
    // A mid-blue muted ground under a blue accent, as the review probed it: a muted card's focus ring, its chevron, its
    // words, and Kalender's week numbers and "+N" link on it.
    const muted = checkThemeContrast({
      'background-muted': ['#7f9cc6', '#1b1b1b'],
      accent: ['#2f5fb3', '#f1f1f1'],
      'text-accent': ['#2f5fb3', '#f1f1f1'],
    });
    expect(muted.map(p => `${p.token} ${p.message.split(' mot ')[1]!.split(' ')[0]} ${p.mode}`)).toEqual([
      'text-secondary background-muted light',
      'text-accent background-muted light',
      'accent background-muted light',
      'icon-secondary background-muted light',
    ]);
  });

  test('a link is held on every ground, and the secondary words on a popover, the ground of the composer and the menus', () => {
    const link = checkThemeContrast({ 'text-accent': ['#757575', '#f1f1f1'] });
    expect(link.map(p => p.message.split(' mot ')[1]!.split(' ')[0])).toEqual(['background-body', 'background-muted']);
    const words = checkThemeContrast({ 'background-popover': ['#8a8a8a', '#1b1b1b'] });
    expect(words.map(p => p.token)).toContain('text-secondary');
  });

  test('a status tint is held to the words drawn on it, a translucent base tint laid over the surface first', () => {
    // Neutral's dark tint is translucent: laid over the base surface its words read, and the base holds.
    const darkInfo = composite(THEME_BASE_COLORS['info-muted'][1], THEME_BASE_COLORS['background-surface'][1]);
    expect(contrastRatio(THEME_BASE_COLORS['on-info-muted'][1], darkInfo)).toBeGreaterThanOrEqual(4.5);
    // Measured as if it were opaque, the same words would fail; the check never does that.
    expect(
      contrastRatio(THEME_BASE_COLORS['on-info-muted'][1], THEME_BASE_COLORS['info-muted'][1].slice(0, 7)),
    ).toBeLessThan(4.5);
    // A pale surface under the base's translucent tint makes a pale fill under pale words: refused, the fill named as
    // it shows over that surface.
    const pale = checkThemeContrast({ 'background-surface': ['#ffffff', '#d0d0d0'] });
    const over = composite(THEME_BASE_COLORS['info-muted'][1], '#d0d0d0');
    expect(pale.map(p => p.message)).toContainEqual(
      expect.stringMatching(new RegExp(`^on-info-muted \\(#a1caff\\) mot info-muted \\(${over}\\) .* i mörkt läge`)),
    );
    // A file's own tint is opaque and measured as it is, light and dark alike.
    expect(checkThemeContrast({ 'info-muted': ['#003978', '#a1caff'] }).map(p => [p.token, p.mode])).toEqual([
      ['on-info-muted', 'light'],
      ['on-info-muted', 'dark'],
    ]);
    expect(checkThemeContrast({ 'success-muted': ['#00490b', '#bce0bb'] }).map(p => p.token)).toEqual([
      'on-success-muted',
      'on-success-muted',
    ]);
    // A selected Item's ground under its label.
    expect(checkThemeContrast({ 'accent-muted': ['#000000', '#ffffff'] }).map(p => p.token)).toEqual([
      'text-primary',
      'text-primary',
    ]);
  });

  test('a pale text-success refuses the file, and the success icon that follows it is drawn and refused in it, named once', () => {
    const pale: ThemeColorPair = ['#a5d6a7', '#1b3a1c'];
    const problems = problemsOf(file({ 'text-success': color(pale[0]) }, { 'text-success': color(pale[1]) }));
    // The success StatusDot is drawn in the pale green, on every ground the words are; the words are held at 4.5:1
    // there, so the file is refused for them, once per ground and appearance, and the icon it never set is not named.
    expect(themeColorOf({ 'text-success': pale }, 'icon-success')).toEqual(pale);
    expect(problems.map(p => `${p.token} ${p.message.split(' mot ')[1]!.split(' ')[0]} ${p.mode}`)).toEqual(
      ['background-body', 'background-surface', 'background-card', 'background-popover'].flatMap(ground => [
        `text-success ${ground} light`,
        `text-success ${ground} dark`,
      ]),
    );
    // Set to the same pale green itself, the icon is the file's own colour and named on its own grounds.
    const icon = checkThemeContrast({ 'icon-success': pale });
    expect(new Set(icon.map(p => p.token))).toEqual(new Set(['icon-success']));
    expect(icon).toHaveLength(8);
  });

  test('a pale text-info is one problem per ground and appearance, never four more for the icon that follows it (N1)', () => {
    const pale = checkThemeContrast({ 'text-info': ['#9fc5f0', '#a1caff'] });
    expect(new Set(pale.map(p => p.token))).toEqual(new Set(['text-info']));
    expect(pale).toHaveLength(4);
  });

  test('every example in themes/ and the base theme are valid theme files that hold every pair', () => {
    expect(
      examples()
        .map(e => e.name)
        .sort(),
    ).toEqual(['clew', 'startsidan-prototype', 'sundsvall']);
    for (const { name, file } of examples()) {
      const parsed = parseThemeFile(file);
      if (!parsed.ok) throw new Error(`${name}: ${parsed.problems.map(p => p.message).join(' ')}`);
      expect(checkThemeContrast(parsed.theme.colors), name).toEqual([]);
    }
    expect(parseThemeFile(themeFileOf(THEME_TEMPLATE))).toEqual({ ok: true, theme: THEME_TEMPLATE });
  });

  test('the template pins no status icon, so they follow the words a file starts from it, and no translucent tint', () => {
    const tokens = Object.keys(THEME_TEMPLATE.colors);
    expect(tokens).not.toContain('icon-info');
    expect(tokens).not.toContain('icon-success');
    expect(tokens).not.toContain('info-muted');
    expect(tokens).not.toContain('success-muted');
    // Everything else the check reads is there, as the base has it.
    expect(tokens.sort()).toEqual(
      Object.keys(THEME_BASE_COLORS)
        .filter(t => !['icon-info', 'icon-success', 'info-muted', 'success-muted'].includes(t))
        .sort(),
    );
    for (const [token, pair] of Object.entries(THEME_TEMPLATE.colors))
      expect(pair).toEqual(THEME_BASE_COLORS[token as ThemeContrastToken]);
  });

  test('a file is read with hex strings, sRGB objects and references to its own palette', () => {
    const parsed = parseThemeFile(
      file(
        { accent: { $value: '{palette.blue}' }, 'on-accent': color('#FFFFFF') },
        {
          accent: { $value: { colorSpace: 'srgb', components: [0.8549, 0.9373, 0.9451], hex: '#daeff1' } },
          'on-accent': color('#000000'),
        },
        { $description: '  Exempelkommunen ', palette: { $type: 'color', blue: color('#005595') } },
      ),
    );
    expect(parsed).toEqual({
      ok: true,
      theme: {
        name: 'Exempelkommunen',
        colors: { accent: ['#005595', '#daeff1'], 'on-accent': ['#ffffff', '#000000'] },
      },
    });
  });

  test('a file that is not a theme file, or sets nothing, is refused', () => {
    expect(problemsOf('text')[0]!.message).toBe('Filen är inte en temafil.');
    expect(problemsOf({}).map(p => p.message)).toEqual([
      'Filen saknar gruppen light.color.',
      'Filen saknar gruppen dark.color.',
    ]);
    expect(problemsOf(file({}, {}))[0]!.message).toBe('Filen sätter inga färger.');
  });

  test('every problem is named at once: an unknown role, a missing appearance, a value that is not an opaque sRGB colour', () => {
    const problems = problemsOf(
      file(
        {
          error: color('#ff0000'),
          accent: color('#005595'),
          info: color('blue'),
          success: { $value: { colorSpace: 'display-p3', components: [0, 1, 0] } },
          border: { $value: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.2 } },
        },
        { info: color('#daeff1'), success: color('#e0f6de'), border: color('#4b4b4b') },
      ),
    );
    expect(problems.map(p => [p.code, p.token, p.mode])).toEqual([
      ['token', 'error', 'light'],
      ['value', 'info', 'light'],
      ['value', 'success', 'light'],
      ['value', 'border', 'light'],
      ['token', 'accent', 'dark'],
    ]);
    expect(problems[0]!.message).toBe('error är inte en färg som ett tema kan sätta.');
    expect(problems[2]!.message).toContain('Bara färgrymden srgb stöds.');
    expect(problems[3]!.message).toContain('Genomskinliga färger stöds inte.');
    expect(problems[4]!.message).toBe('accent saknas i mörkt läge. En färg sätts för båda lägena.');
  });

  test('a reference must reach a colour token and may not loop', () => {
    const referring = (value: string, rest: Record<string, unknown> = {}) =>
      problemsOf(file({ accent: { $value: value } }, { accent: color('#daeff1') }, rest))[0]!.message;
    expect(referring('{palette.missing}')).toContain('Referensen {palette.missing} finns inte i filen.');
    expect(referring('{palette}', { palette: { $type: 'color' } })).toContain('{palette} är inte en token.');
    expect(referring('{sizes.small}', { sizes: { $type: 'dimension', small: { $value: '4px' } } })).toContain(
      '{sizes.small} ska ha $type color.',
    );
    expect(referring('{light.color.accent}')).toContain('Referensen pekar på sig själv.');
    // A type is never guessed from the value (Format Module 2025.10): a token without one is not a colour.
    expect(
      problemsOf({ light: { color: { accent: color('#005595') } }, dark: { color: { accent: color('#daeff1') } } })[0]!
        .message,
    ).toContain('ska ha $type color.');
  });

  test('a theme whose text cannot be read is refused, against the base where the file leaves a colour alone', () => {
    // A dark surface under the base theme's black text.
    const problems = problemsOf(
      file({ 'background-surface': color('#222222') }, { 'background-surface': color('#262626') }),
    );
    expect(problems.every(p => p.code === 'contrast' && p.mode === 'light')).toBe(true);
    expect(problems.map(p => p.token)).toContain('text-primary');
    expect(problems[0]!.message).toBe(
      'text-primary (#000000) mot background-surface (#222222) har kontrasten 1,3:1 i ljust läge. Minst 4,5:1 krävs.',
    );
    // A pale tint of the surface still carries the base theme's text, so the file needs to set nothing else.
    expect(
      parseThemeFile(file({ 'background-surface': color('#f4f8fb') }, { 'background-surface': color('#1f2a33') })),
    ).toEqual({ ok: true, theme: { name: null, colors: { 'background-surface': ['#f4f8fb', '#1f2a33'] } } });
  });

  test('a saved theme written as a file again reads back as the same theme', () => {
    const theme = themeFromAccent('#5B1F78', ' #d7dbf2 ', 'Exempelkommunen');
    expect(theme.colors.accent).toEqual(['#5b1f78', '#d7dbf2']);
    expect(parseThemeFile(themeFileOf(theme))).toEqual({ ok: true, theme });
    expect(parseThemeFile(themeFileOf({ name: null, colors: THEME_TEMPLATE.colors }))).toEqual({
      ok: true,
      theme: { name: null, colors: THEME_TEMPLATE.colors },
    });
  });

  test('uploading a tint checks its text against its ground in each appearance, including an inherited half', () => {
    const problems = problemsOf(
      file(
        { 'text-blue': color(THEME_BASE_COLORS['background-blue'][0]), 'background-green': color('#ffffff') },
        { 'text-blue': color('#ffffff'), 'background-green': color(THEME_BASE_COLORS['text-green'][1]) },
      ),
    );
    expect(problems.map(p => [p.code, p.token, p.mode])).toEqual([
      ['contrast', 'text-blue', 'light'],
      ['contrast', 'text-green', 'dark'],
    ]);
  });

  test('two colours make a theme only when white reads on the strong one and black on the pale one', () => {
    expect(checkThemeContrast(themeFromAccent('#005595', '#daeff1').colors)).toEqual([]);
    const weak = checkThemeContrast(themeFromAccent('#7fb2d9', '#daeff1').colors);
    expect(weak.map(p => [p.token, p.mode])).toContainEqual(['on-accent', 'light']);
  });

  test("the repository's Sundsvall example is a valid theme file carrying the published colours (D38)", () => {
    const parsed = parseThemeFile(sundsvall);
    if (!parsed.ok) throw new Error(parsed.problems.map(p => p.message).join(' '));
    expect(parsed.theme.name).toBe('Sundsvalls kommun');
    const colors = parsed.theme.colors;
    expect(colors.accent).toEqual(['#005595', '#daeff1']);
    expect(colors['on-accent']).toEqual(['#ffffff', '#000000']);
    expect(colors['text-primary']).toEqual(['#000000', '#ffffff']);
    expect(colors['text-secondary']).toEqual(['#4b4b4b', '#ececec']);
    expect(colors['background-card']).toEqual(['#ffffff', '#4b4b4b']);
    for (const [hue, pair] of [
      ['blue', ['#daeff1', '#005595']],
      ['green', ['#e0f6de', '#00733b']],
      ['purple', ['#d7dbf2', '#5b1f78']],
      ['pink', ['#fedfe2', '#a90074']],
    ] as const)
      expect(colors[`background-${hue}` as ThemeColorToken]).toEqual(pair);
  });

  test("the prototype's example holds every contrast pair and carries its page, its band and its two blues (D130)", () => {
    const parsed = parseThemeFile(prototype);
    if (!parsed.ok) throw new Error(parsed.problems.map(p => p.message).join(' '));
    const colors = parsed.theme.colors;
    expect(checkThemeContrast(colors)).toEqual([]);
    expect(colors['background-body']![0]).toBe('#edf1f5');
    expect(colors['background-card']![0]).toBe('#ffffff');
    expect(colors['background-inverted']![0]).toBe('#003c69');
    expect(colors.accent![0]).toBe('#005595');
    expect(colors.info![0]).toBe('#1f64b8');
  });

  test('the published schema bounds the two groups Clew reads and accepts the examples', () => {
    const schema = themeFileSchema();
    const validate = new Ajv2020({ strict: false }).compile(schema);
    expect(validate(sundsvall)).toBe(true);
    expect(validate(prototype)).toBe(true);
    expect(validate(themeFileOf(themeFromAccent('#005595', '#daeff1', 'Två färger')))).toBe(true);
    expect(validate(file({ error: color('#ff0000') }, {}))).toBe(false);
    expect(validate({ light: { color: {} } })).toBe(false);
    expect(
      JSON.parse(readFileSync(new URL('../../docs/protocol/theme-file.schema.json', import.meta.url), 'utf8')),
    ).toEqual(schema);
  });
});

/**
 * The installation's name (D98 item 11) is checked by one function on the server, on Administration › Utseende and in
 * every browser that reads the saved appearance: one line, nothing invisible or direction-turning, nothing a page cannot
 * draw, no pile of combining marks, at least one letter or digit. Each refusal is named in Swedish for the field.
 */
describe("the installation's name", () => {
  const problem = (value: unknown) => {
    const checked = checkSiteName(value);
    return 'problem' in checked ? checked.problem : undefined;
  };
  test('a name is trimmed and saved in its composed form', () => {
    expect(checkSiteName('  Medarbetarwebben  ')).toEqual({ name: 'Medarbetarwebben' });
    // "Malmö" written with a combining diaeresis is saved as the one precomposed letter.
    expect(checkSiteName('Malmo\u0308')).toEqual({ name: 'Malm\u00f6' });
    expect(checkSiteName("Ånge kommun – Söder & Co's 2")).toEqual({ name: "Ånge kommun – Söder & Co's 2" });
    expect(checkSiteName('Ạ\u0302')).toEqual({ name: 'Ậ' });
  });
  test('nothing, blanks or not a string is refused as no name', () => {
    for (const value of ['', '   ', '\u2028', undefined, null, 7]) expect(problem(value)).toBe('Skriv ett namn.');
  });
  test('a line or paragraph separator or a control character is refused as more than one line', () => {
    for (const value of ['Intra\nnätet', 'Intra\u2028nätet', 'Intra\u2029nätet', 'Intra\tnätet', 'Intra\u0085nätet'])
      expect(problem(value)).toBe('Namnet ska stå på en rad.');
  });
  test('a zero-width character, alone or within, and a direction control are refused as invisible', () => {
    for (const value of [
      '\u200b',
      'Intra\u200bnätet',
      'Intra\u202enätet',
      'Intra\u2067nätet\u2069',
      'Intra\ufeffnätet',
    ])
      expect(problem(value)).toBe('Namnet får inte ha osynliga tecken eller tecken som vänder textens riktning.');
  });
  test('a private-use or unassigned code point, or a lone surrogate, is refused as not drawable', () => {
    for (const value of ['Intra\ue000nätet', 'Intra\u0378nätet', 'Intra\ud800nätet'])
      expect(problem(value)).toBe('Namnet har tecken som inte kan visas.');
  });
  test('two combining marks on a letter are a name, three are refused', () => {
    // Q has no precomposed accented forms, so its marks stay marks in the composed form.
    expect(checkSiteName('Aq\u0301\u0308a')).toEqual({ name: 'Aq\u0301\u0308a' });
    expect(problem('Aq\u0301\u0308\u0303a')).toBe(
      'Namnet får ha högst två accenter eller andra tecken på samma bokstav.',
    );
    expect(problem('Z' + '\u0301'.repeat(60))).toBe(
      'Namnet får ha högst två accenter eller andra tecken på samma bokstav.',
    );
  });
  test('a name of punctuation alone is refused; a digit is enough', () => {
    for (const value of ['...', '– · –', '&&'])
      expect(problem(value)).toBe('Namnet behöver minst en bokstav eller siffra.');
    expect(checkSiteName('1177')).toEqual({ name: '1177' });
  });
  test(`a name is at most ${SITE_NAME_MAX} characters, counted as a person sees them`, () => {
    expect(checkSiteName('å'.repeat(SITE_NAME_MAX))).toEqual({ name: 'å'.repeat(SITE_NAME_MAX) });
    expect(problem('å'.repeat(SITE_NAME_MAX + 1))).toBe(`Namnet får vara högst ${SITE_NAME_MAX} tecken.`);
  });
});
