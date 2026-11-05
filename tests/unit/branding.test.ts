import { describe, expect, test } from 'bun:test';
import { contrastRatio, resolveBranding, sundsvallPalette } from '../../packages/ui/src/branding';
import { createClewTheme } from '../../packages/ui/src/theme';

describe('installation branding (D37, D38)', () => {
  test('an installation that chooses nothing gets Astryx Neutral without a logo (D46)', () => {
    expect(resolveBranding()).toEqual({ profile: 'neutral', colors: null, logo: null });
  });

  test('the Sundsvall installation uses its local dragon', () => {
    expect(resolveBranding({ profile: 'sundsvall' })).toEqual({
      profile: 'sundsvall', colors: { accent: '#005595', accentMuted: '#daeff1' },
      logo: { src: '/branding/sundsvall-dragon.png', darkSrc: '/branding/sundsvall-dragon-white.png', alt: 'Sundsvalls kommun' },
    });
  });

  test('another municipality chooses its own image and accessible name', () => {
    expect(resolveBranding({ profile: 'neutral', logoSrc: ' /branding/other-municipality.svg ', logoAlt: ' Annan kommun ' }).logo).toEqual({
      src: '/branding/other-municipality.svg', alt: 'Annan kommun',
    });
  });

  test('an installation can explicitly omit the logo', () => {
    expect(resolveBranding({ logoSrc: '', logoAlt: '' }).logo).toBeNull();
    expect(resolveBranding({ logoSrc: '  ' }).logo).toBeNull();
  });

  test('a custom logo must have its own accessible name', () => {
    expect(() => resolveBranding({ logoSrc: '/branding/other.svg' })).toThrow('Set both');
    expect(() => resolveBranding({ logoSrc: '/branding/other.svg', logoAlt: ' ' })).toThrow('Set both');
    expect(() => resolveBranding({ logoAlt: 'Annan kommun' })).toThrow('Set both');
  });

  test('the image is served by the installation itself', () => {
    for (const src of ['https://example.org/logo.svg', '//example.org/logo.svg', '/\\example.org/logo.svg', '/\t/example.org/logo.svg', 'branding/logo.svg']) {
      expect(() => resolveBranding({ logoSrc: src, logoAlt: 'Annan kommun' })).toThrow('same-origin path');
    }
  });

  test('a dark logo is explicit, local and belongs to the same organisation', () => {
    const input = { profile: 'neutral', logoSrc: '/branding/day.svg', logoAlt: 'Annan kommun', logoDarkSrc: ' /branding/night.svg ' };
    expect(resolveBranding(input).logo).toEqual({ src: '/branding/day.svg', alt: 'Annan kommun', darkSrc: '/branding/night.svg' });
    expect(() => resolveBranding({ logoDarkSrc: '/branding/night.svg' })).toThrow('Set both');
    expect(() => resolveBranding({ ...input, logoDarkSrc: 'https://example.org/night.svg' })).toThrow('same-origin path');
    expect(() => resolveBranding({ ...input, logoDarkSrc: '/\\example.org/night.svg' })).toThrow('same-origin path');
  });

  test('neutral and custom installations never inherit Sundsvall identity', () => {
    expect(resolveBranding({ profile: 'neutral' })).toEqual({ profile: 'neutral', colors: null, logo: null });
    expect(resolveBranding({ profile: 'custom', accent: ' #5B1F78 ', accentMuted: '#D7DBF2' })).toEqual({
      profile: 'custom', colors: { accent: '#5b1f78', accentMuted: '#d7dbf2' }, logo: null,
    });
  });

  test('unknown profiles and ignored colour overrides are configuration errors', () => {
    expect(() => resolveBranding({ profile: 'sundsval' })).toThrow('VITE_BRAND_PROFILE');
    expect(() => resolveBranding({ profile: '' })).toThrow('VITE_BRAND_PROFILE');
    expect(() => resolveBranding({ profile: 'neutral', accent: '#005595' })).toThrow('VITE_BRAND_PROFILE=custom');
    expect(() => resolveBranding({ accentMuted: '#daeff1' })).toThrow('VITE_BRAND_PROFILE=custom');
  });

  test('a custom palette requires two valid colours', () => {
    expect(() => resolveBranding({ profile: 'custom' })).toThrow('six-digit hex');
    for (const accent of ['#fff', 'blue', 'rgb(0, 85, 149)', '#gggggg']) {
      expect(() => resolveBranding({ profile: 'custom', accent, accentMuted: '#daeff1' })).toThrow('six-digit hex');
    }
  });

  test('inaccessible custom colours fail before the app starts', () => {
    for (const [accent, accentMuted] of [['#eeeeee', '#ffffff'], ['#005595', '#111111'], ['#666666', '#777777'], ['#005595', '#aaaaaa']]) {
      expect(() => resolveBranding({ profile: 'custom', accent, accentMuted })).toThrow('contrast');
    }
  });
});

describe('Sundsvall colour contracts', () => {
  test('contrast uses WCAG sRGB luminance', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBe(21);
    expect(contrastRatio('#005595', '#005595')).toBe(1);
    expect(contrastRatio('#ffffff', '#777777')).toBeCloseTo(4.478, 3);
  });

  test('primary fills support white text, pale fills support black text, and secondary text remains readable', () => {
    const { white, black, darkGray, lightGray, ...pairs } = sundsvallPalette;
    for (const pair of Object.values(pairs)) {
      expect(contrastRatio(white, pair.dark)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(black, pair.light)).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(pair.dark, pair.light)).toBeGreaterThanOrEqual(3);
    }
    expect(contrastRatio(darkGray, white)).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(darkGray, lightGray)).toBeGreaterThanOrEqual(4.5);
  });

  test('the resolved Astryx tokens carry the published colours and black text on pale surfaces', () => {
    const theme = createClewTheme(resolveBranding({ profile: 'sundsvall' }));
    expect(theme.tokens['--color-accent']).toContain('#005595');
    expect(theme.tokens['--color-accent-muted']).toContain('#daeff1');
    expect(theme.tokens['--color-on-accent']).toContain('#ffffff');
    expect(theme.tokens['--color-text-primary']).toContain('#000000');
    expect(theme.tokens['--color-text-secondary']).toContain('#4b4b4b');
    expect(theme.tokens['--color-background-body']).toContain('#ffffff');
    expect(theme.tokens['--color-text-blue']).toContain('#000000');
    expect(theme.tokens['--color-on-info-muted']).toContain('#000000');
    expect(theme.tokens['--color-text-accent']).toContain('--color-text-primary');
    for (const [family, pair] of [['blue', sundsvallPalette.vattjom], ['green', sundsvallPalette.gronsta], ['purple', sundsvallPalette.bjornstigen], ['pink', sundsvallPalette.juniskar]] as const) {
      expect(theme.tokens[`--color-background-${family}`]).toContain(pair.light);
      expect(theme.tokens[`--color-icon-${family}`]).toContain(pair.dark);
    }
  });

  test('choosing another brand changes its accent while retaining shared accessibility and status semantics', () => {
    const neutral = createClewTheme(resolveBranding({ profile: 'neutral' }));
    const custom = createClewTheme(resolveBranding({ profile: 'custom', accent: '#5b1f78', accentMuted: '#d7dbf2' }));
    const sundsvall = createClewTheme(resolveBranding({ profile: 'sundsvall' }));
    expect(custom.tokens['--color-accent']).toContain('#5b1f78');
    expect(custom.tokens['--color-background-body']).toBe(neutral.tokens['--color-background-body']);
    expect(neutral.tokens['--color-accent']).not.toBe(sundsvall.tokens['--color-accent']);
    expect(neutral.components?.['chat-layout']).toEqual({ base: { scrollPaddingBottom: '240px' } });
    for (const theme of [sundsvall, custom]) {
      expect(theme.components?.['chat-layout']).toEqual(neutral.components?.['chat-layout']);
      expect(theme.tokens['--color-error']).toBe(neutral.tokens['--color-error']);
      expect(theme.tokens['--color-warning']).toBe(neutral.tokens['--color-warning']);
    }
  });

  test('dark mode swaps brand fills and foregrounds with readable published pairs', () => {
    for (const profile of [resolveBranding({ profile: 'sundsvall' }), resolveBranding({ profile: 'custom', accent: '#5b1f78', accentMuted: '#d7dbf2' })]) {
      const tokens = createClewTheme(profile).tokens;
      if (!profile.colors) throw new Error('The test requires a branded profile');
      expect(tokens['--color-accent']).toBe(`light-dark(${profile.colors.accent}, ${profile.colors.accentMuted})`);
      expect(tokens['--color-on-accent']).toBe('light-dark(#ffffff, #000000)');
      expect(tokens['--color-text-primary']).toBe('light-dark(#000000, #ffffff)');
      expect(tokens['--color-text-secondary']).toBe('light-dark(#4b4b4b, #ececec)');
      expect(contrastRatio(profile.colors.accentMuted, sundsvallPalette.darkGray)).toBeGreaterThanOrEqual(4.5);
    }
    const dark = createClewTheme(resolveBranding({ profile: 'sundsvall' })).tokens;
    expect(dark['--color-background-body']).toBe('light-dark(#ffffff, #000000)');
    expect(dark['--color-background-card']).toBe('light-dark(#ffffff, #4b4b4b)');
    expect(contrastRatio('#ececec', '#4b4b4b')).toBeGreaterThanOrEqual(4.5);
  });
});
