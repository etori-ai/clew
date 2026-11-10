import { describe, expect, test } from 'bun:test';
import { themeFromAccent } from '@clew/contracts';
import { NEUTRAL_BRANDING, readBranding, type Branding } from '../../packages/ui/src/branding';
import { createClewTheme, createHeaderBandTheme } from '../../packages/ui/src/theme';

const custom: Branding = { revision: 3, theme: themeFromAccent('#5b1f78', '#d7dbf2', 'Exempelkommunen'), logo: null };

describe('the appearance the browser draws (D97)', () => {
  test('what the server answers is read as it is, and nothing saved is Neutral without a logo (D46)', () => {
    expect(readBranding({ revision: 0, theme: null, logo: null })).toEqual(NEUTRAL_BRANDING);
    expect(
      readBranding({
        ...custom,
        logo: { src: '/api/appearance/logo/light?v=3', darkSrc: '/api/appearance/logo/dark?v=3', alt: ' Exempel ' },
        updatedBy: 'Mikael Lund',
      }),
    ).toEqual({
      ...custom,
      logo: { src: '/api/appearance/logo/light?v=3', darkSrc: '/api/appearance/logo/dark?v=3', alt: 'Exempel' },
    });
  });

  test('a kept copy is only text in a browser: anything that is not a known colour or a same-origin logo is dropped', () => {
    expect(readBranding(null)).toEqual(NEUTRAL_BRANDING);
    expect(readBranding('{"theme":')).toEqual(NEUTRAL_BRANDING);
    const read = readBranding({
      revision: 'x',
      theme: {
        name: 7,
        colors: {
          accent: ['#005595', '#DAEFF1'],
          'on-accent': ['#fff', '#000000'],
          'text-primary': ['url(https://example.org/x)', '#ffffff'],
          error: ['#000000', '#000000'],
          __proto__: ['#000000', '#000000'],
        },
      },
      logo: { src: '/logo.svg', alt: 'Kommun' },
    });
    expect(read).toEqual({
      revision: 0,
      theme: { name: null, colors: { accent: ['#005595', '#daeff1'] } },
      logo: { src: '/logo.svg', alt: 'Kommun' },
    });
    for (const src of ['https://example.org/logo.svg', '//example.org/logo.svg', '/\\example.org/logo.svg', 'logo.svg'])
      expect(readBranding({ logo: { src, alt: 'Kommun' } }).logo).toBeNull();
    expect(readBranding({ logo: { src: '/logo.svg', alt: ' ' } }).logo).toBeNull();
    // A dark variant that is not on the origin is dropped; the logo itself stays.
    expect(readBranding({ logo: { src: '/a.svg', darkSrc: 'https://example.org/b.svg', alt: 'Kommun' } }).logo).toEqual(
      {
        src: '/a.svg',
        alt: 'Kommun',
      },
    );
  });

  test("the shared header on another site reads the logo from the installation's own origin", () => {
    expect(
      readBranding(
        { logo: { src: '/api/appearance/logo/light?v=2', alt: 'Kommun' } },
        'https://clew.example.org/api/appearance',
      ).logo,
    ).toEqual({ src: 'https://clew.example.org/api/appearance/logo/light?v=2', alt: 'Kommun' });
  });

  test("a saved theme sets its colours as Astryx's light and dark pairs over Clew's base, the focus ring with the accent", () => {
    const neutral = createClewTheme(NEUTRAL_BRANDING);
    const theme = createClewTheme(custom);
    expect(neutral.name).toBe('clew-neutral');
    expect(theme.tokens['--color-accent']).toBe('light-dark(#5b1f78, #d7dbf2)');
    expect(theme.tokens['--color-on-accent']).toBe('light-dark(#ffffff, #000000)');
    expect(theme.tokens['--color-text-primary']).toBe('light-dark(#000000, #ffffff)');
    expect(theme.tokens['--color-text-secondary']).toBe('light-dark(#4b4b4b, #ececec)');
    expect(theme.tokens['--focus-outline-color']).toBe('light-dark(#5b1f78, #d7dbf2)');
    // What a theme file cannot set stays the base's: surfaces it left alone, status colours, behaviour.
    expect(theme.tokens['--color-background-body']).toBe(neutral.tokens['--color-background-body']);
    expect(theme.tokens['--color-error']).toBe(neutral.tokens['--color-error']);
    expect(theme.tokens['--color-warning']).toBe(neutral.tokens['--color-warning']);
    expect(neutral.components?.['chat-layout']).toEqual({ base: { scrollPaddingBottom: '240px' } });
    expect(theme.components?.['chat-layout']).toEqual(neutral.components?.['chat-layout']);
  });

  test('the same colours are the same theme, built once, whatever the revision or the name', () => {
    expect(createClewTheme({ ...custom, revision: 9, theme: { ...custom.theme!, name: 'Annat namn' } })).toBe(
      createClewTheme(custom),
    );
    expect(createClewTheme({ ...custom, theme: themeFromAccent('#005595', '#daeff1') }).name).not.toBe(
      createClewTheme(custom).name,
    );
  });

  test("the header's band is the accent with its on-accent text, and Neutral's near-black without one (D88)", () => {
    const band = createHeaderBandTheme(custom).tokens;
    expect(band['--color-background-surface']).toBe('#5b1f78');
    expect(band['--color-text-primary']).toBe('#ffffff');
    expect(band['--color-on-accent']).toBe('#5b1f78');
    const plain = createHeaderBandTheme(NEUTRAL_BRANDING).tokens;
    expect(plain['--color-background-surface']).not.toBe('#5b1f78');
    expect(plain['--color-text-primary']).toBe('#ffffff');
    expect(createHeaderBandTheme(custom)).toBe(createHeaderBandTheme({ ...custom, revision: 4 }));
  });
});
