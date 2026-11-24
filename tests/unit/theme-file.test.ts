import { describe, expect, test } from 'bun:test';
import { readdirSync, readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import {
  THEME_BASE_COLORS,
  THEME_COLOR_TOKENS,
  THEME_CONTRAST_PAIRS,
  SITE_NAME_MAX,
  checkSiteName,
  checkThemeContrast,
  contrastRatio,
  parseThemeFile,
  themeFileOf,
  themeFileSchema,
  themeFromAccent,
  type ThemeColorToken,
} from '@clew/contracts';
import { NEUTRAL_BRANDING } from '../../packages/ui/src/branding';
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

  test('the base theme holds every contrast pair in both appearances', () => {
    for (const [foreground, background, min] of THEME_CONTRAST_PAIRS)
      for (const index of [0, 1] as const)
        expect(
          contrastRatio(THEME_BASE_COLORS[foreground][index], THEME_BASE_COLORS[background][index]),
        ).toBeGreaterThanOrEqual(min);
    expect(checkThemeContrast(THEME_BASE_COLORS)).toEqual([]);
  });

  test('every pair is enforced: a foreground drawn in its ground’s colour is refused, one that reads passes', () => {
    const mark = (token: string, index: 0 | 1) => THEME_BASE_COLORS[token as keyof typeof THEME_BASE_COLORS][index];
    for (const [foreground, background, min] of THEME_CONTRAST_PAIRS) {
      const ground = [mark(background, 0), mark(background, 1)] as const;
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
      'icon-success background-card light',
      'icon-info background-card light',
    ])
      expect(failing).toContain(pair);
    expect(failing.every(p => p.includes('background-card'))).toBe(true);
    // The same accent and status words on a page whose ground is that blue.
    const page = checkThemeContrast({ 'background-body': ['#a8c0e8', '#1d2a44'], accent: ['#3b6fd0', '#8fb4ff'] });
    expect(page.map(p => `${p.token} ${p.mode}`)).toEqual(
      expect.arrayContaining(['accent light', 'text-info light', 'text-success light', 'icon-secondary light']),
    );
  });

  test('a status icon a file leaves alone is checked in the status text colour it follows, as Astryx draws it', () => {
    const pale = checkThemeContrast({ 'text-info': ['#9fc5f0', '#a1caff'] });
    expect(pale.filter(p => p.token === 'icon-info').map(p => p.message)).toContainEqual(
      expect.stringMatching(/^icon-info \(#9fc5f0\) mot background-card \(#ffffff\)/),
    );
    // Set on its own, the icon is held to its own colour, and the words keep theirs.
    const icon = checkThemeContrast({ 'icon-success': ['#a5d6a7', '#90ca90'] });
    expect(new Set(icon.map(p => p.token))).toEqual(new Set(['icon-success']));
  });

  test('every example in themes/ is a valid theme file that holds every pair', () => {
    const examples = readdirSync(new URL('../../themes/', import.meta.url), { withFileTypes: true }).filter(d =>
      d.isDirectory(),
    );
    expect(examples.map(d => d.name).sort()).toEqual(['clew', 'startsidan-prototype', 'sundsvall']);
    for (const { name } of examples) {
      const parsed = parseThemeFile(
        JSON.parse(readFileSync(new URL(`../../themes/${name}/theme.tokens.json`, import.meta.url), 'utf8')),
      );
      if (!parsed.ok) throw new Error(`${name}: ${parsed.problems.map(p => p.message).join(' ')}`);
      expect(checkThemeContrast(parsed.theme.colors), name).toEqual([]);
    }
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
    expect(parseThemeFile(themeFileOf({ name: null, colors: THEME_BASE_COLORS }))).toEqual({
      ok: true,
      theme: { name: null, colors: THEME_BASE_COLORS },
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
