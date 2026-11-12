import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import Ajv2020 from 'ajv/dist/2020';
import {
  THEME_BASE_COLORS,
  THEME_COLOR_TOKENS,
  THEME_CONTRAST_PAIRS,
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

  test("the prototype's example holds every contrast pair and carries its page, its band and its two blues (D115)", () => {
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
