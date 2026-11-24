import { describe, expect, test } from 'bun:test';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import { LOGO_MAX_BYTES, themeFileOf, themeFromAccent, type AuthenticatedContext } from '@clew/contracts';
import { ForbiddenError, InputError } from '../../apps/server/src/context';
import { memoryAppearanceStore } from '../../apps/server/src/modules/appearance/adapters/memory';
import { logoImageOf } from '../../apps/server/src/modules/appearance/domain';
import {
  APPEARANCE_SUBJECT,
  ThemeFileError,
  appearanceUsecases,
} from '../../apps/server/src/modules/appearance/usecases';

/**
 * Administration › Utseende (D98) on the memory store: who may change the installation's name, theme and logo, what a
 * save stores and answers, and the audit row each change writes in its transaction.
 */
const T = '2026-11-10T08:00:00.000Z';
const base64 = (bytes: Uint8Array | string) => Buffer.from(bytes).toString('base64');
const PNG = base64(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]));
const SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 8 8"><circle cx="4" cy="4" r="3" fill="url(#g)"/></svg>';
const png = { mediaType: 'image/png' as const, data: PNG };
const svg = (text = SVG) => ({ mediaType: 'image/svg+xml' as const, data: base64(text) });
const theme = themeFromAccent('#005595', '#daeff1', 'Exempelkommunen');

function stack() {
  const store = memoryAppearanceStore();
  let authorized = 0;
  const persona = (capabilities: string[]): AuthenticatedContext => ({
    id: 'mikael',
    name: 'Mikael Lund',
    unitId: 'unit-it',
    unitLabel: 'IT',
    role: 'employee',
    organisationId: 'poc',
    principal: { id: 'person:mikael', kind: 'person' },
    capabilities,
    authorizationVersion: 'v',
    sessionBinding: 'test',
    expiresAt: T,
    authorize: async () => {
      authorized++;
      return { version: 'v' };
    },
  });
  return {
    store,
    usecases: appearanceUsecases({ store, clock: () => new Date(T) }),
    admin: persona(['admin.appearance']),
    other: persona(['admin.connectors', 'admin.users']),
    authorized: () => authorized,
  };
}

describe('Utseende', () => {
  test('anyone reads the appearance, and an installation nobody has configured is Clew in Neutral without a logo', async () => {
    const { usecases } = stack();
    expect(await usecases.read()).toEqual({ revision: 0, name: 'Clew', theme: null, logo: null });
    expect(await usecases.name()).toBe('Clew');
    expect(await usecases.logo('light')).toBeNull();
  });

  test('a name is saved trimmed, after the step-up, with an audit row that says what it was and what it is', async () => {
    const { usecases, admin, store, authorized } = stack();
    const view = await usecases.setName(admin, '  Intranätet ');
    expect(view).toEqual({
      revision: 1,
      name: 'Intranätet',
      theme: null,
      logo: null,
      updatedAt: T,
      updatedBy: 'Mikael Lund',
    });
    expect(authorized()).toBe(1);
    expect(await usecases.name()).toBe('Intranätet');
    expect((await usecases.read()).name).toBe('Intranätet');
    expect(store.audit).toEqual([
      {
        actor: 'person:mikael',
        action: 'appearance.name.set',
        subject: APPEARANCE_SUBJECT,
        details: { from: null, to: 'Intranätet', revision: 1 },
      },
    ]);
    // The same name again is no change and writes nothing; another replaces it and says which it replaced.
    expect((await usecases.setName(admin, 'Intranätet')).revision).toBe(1);
    await usecases.setName(admin, 'Medarbetarwebben');
    expect(store.audit.at(-1)).toMatchObject({
      action: 'appearance.name.set',
      details: { from: 'Intranätet', to: 'Medarbetarwebben', revision: 2 },
    });
    // The theme and the logo are untouched by a name, and the name by them.
    await usecases.setTheme(admin, themeFileOf(theme));
    expect(await usecases.read()).toMatchObject({ name: 'Medarbetarwebben', theme });
    // Back to the default: audited once, and once more writes nothing.
    expect(await usecases.clearName(admin)).toMatchObject({ revision: 4, name: 'Clew', theme });
    expect(store.audit.at(-1)).toEqual({
      actor: 'person:mikael',
      action: 'appearance.name.cleared',
      subject: APPEARANCE_SUBJECT,
      details: { from: 'Medarbetarwebben', revision: 4 },
    });
    expect((await usecases.clearName(admin)).revision).toBe(4);
    expect(store.audit).toHaveLength(4);
  });

  test('a name that is empty, on two lines or too long is refused in Swedish, before the step-up and with nothing written', async () => {
    const { usecases, admin, store, authorized } = stack();
    await expect(usecases.setName(admin, '   ')).rejects.toThrow('Skriv ett namn.');
    await expect(usecases.setName(admin, 'Intra\nnätet')).rejects.toThrow('Namnet ska stå på en rad.');
    await expect(usecases.setName(admin, 'x'.repeat(61))).rejects.toThrow('Namnet får vara högst 60 tecken.');
    await expect(usecases.setName(admin, '   ')).rejects.toBeInstanceOf(InputError);
    expect((await usecases.setName(admin, 'å'.repeat(60))).name).toBe('å'.repeat(60));
    expect(store.audit).toHaveLength(1);
    expect(authorized()).toBe(1);
  });

  test('only a person with admin.appearance reads the administration view or changes anything, and nothing is written', async () => {
    const { usecases, other, store, authorized } = stack();
    await expect(usecases.adminRead(other)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(usecases.setName(other, 'Intranätet')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(usecases.clearName(other)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(usecases.setTheme(other, themeFileOf(theme))).rejects.toBeInstanceOf(ForbiddenError);
    await expect(usecases.clearTheme(other)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(usecases.setLogo(other, { alt: 'Kommun', light: png })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(usecases.clearLogo(other)).rejects.toBeInstanceOf(ForbiddenError);
    expect(store.audit).toEqual([]);
    expect(authorized()).toBe(0);
    expect((await usecases.read()).revision).toBe(0);
  });

  test('a theme file is saved as its colours, after the step-up, with an audit row that names it and never carries it', async () => {
    const { usecases, admin, store, authorized } = stack();
    const view = await usecases.setTheme(admin, themeFileOf(theme));
    expect(view).toEqual({ revision: 1, name: 'Clew', theme, logo: null, updatedAt: T, updatedBy: 'Mikael Lund' });
    expect(authorized()).toBe(1);
    expect(await usecases.read()).toEqual({ revision: 1, name: 'Clew', theme, logo: null });
    expect(store.audit).toEqual([
      {
        actor: 'person:mikael',
        action: 'appearance.theme.set',
        subject: APPEARANCE_SUBJECT,
        details: { name: 'Exempelkommunen', tokens: 9, revision: 1 },
      },
    ]);
    // The saved theme comes back as a file an administrator can keep or change.
    expect(await usecases.themeFile()).toEqual(themeFileOf(theme));
  });

  test('a file that does not hold is refused whole with every problem, before the step-up and with nothing written', async () => {
    const { usecases, admin, store, authorized } = stack();
    const refused = await usecases
      .setTheme(admin, {
        light: { color: { $type: 'color', error: { $value: '#ff0000' }, 'background-surface': { $value: '#222222' } } },
        dark: { color: { $type: 'color', 'background-surface': { $value: '#262626' } } },
      })
      .catch(error => error);
    expect(refused).toBeInstanceOf(ThemeFileError);
    expect(refused).toBeInstanceOf(InputError);
    expect((refused as ThemeFileError).message).toBe('Temafilen kan inte användas.');
    expect((refused as ThemeFileError).problems.map(p => p.code)).toEqual(['token']);
    expect(store.audit).toEqual([]);
    expect(authorized()).toBe(0);
    expect((await usecases.read()).theme).toBeNull();
  });

  test('clearing the theme is Neutral again, audited once; clearing nothing writes nothing', async () => {
    const { usecases, admin, store } = stack();
    expect((await usecases.clearTheme(admin)).revision).toBe(0);
    expect(store.audit).toEqual([]);
    await usecases.setTheme(admin, themeFileOf(theme));
    expect(await usecases.clearTheme(admin)).toMatchObject({ revision: 2, theme: null });
    expect(store.audit.at(-1)).toEqual({
      actor: 'person:mikael',
      action: 'appearance.theme.cleared',
      subject: APPEARANCE_SUBJECT,
      details: { name: 'Exempelkommunen', revision: 2 },
    });
    // With no theme saved the file is the template: Clew's own base colours, itself a valid theme file.
    expect((await usecases.themeFile()).$description).toBe('Mall: Clews standardfärger');
  });

  test('a logo is stored as its bytes and served from an address that changes with every save', async () => {
    const { usecases, admin, store } = stack();
    const view = await usecases.setLogo(admin, { alt: '  Exempelkommunen ', light: png, dark: svg() });
    expect(view.logo).toEqual({
      src: '/api/appearance/logo/light?v=1',
      darkSrc: '/api/appearance/logo/dark?v=1',
      alt: 'Exempelkommunen',
    });
    const light = await usecases.logo('light'),
      dark = await usecases.logo('dark');
    expect(light).toMatchObject({ mediaType: 'image/png', revision: 1 });
    expect(base64(light!.bytes)).toBe(PNG);
    expect(new TextDecoder().decode(dark!.bytes)).toBe(SVG);
    expect(store.audit).toEqual([
      {
        actor: 'person:mikael',
        action: 'appearance.logo.set',
        subject: APPEARANCE_SUBJECT,
        details: {
          alt: 'Exempelkommunen',
          light: { mediaType: 'image/png', bytes: 11 },
          dark: { mediaType: 'image/svg+xml', bytes: SVG.length },
          revision: 1,
        },
      },
    ]);
    // The name alone keeps both images; `dark: null` removes the variant; a new image replaces the old.
    expect((await usecases.setLogo(admin, { alt: 'Annat namn' })).logo).toEqual({
      src: '/api/appearance/logo/light?v=2',
      darkSrc: '/api/appearance/logo/dark?v=2',
      alt: 'Annat namn',
    });
    expect((await usecases.setLogo(admin, { alt: 'Annat namn', dark: null })).logo).toEqual({
      src: '/api/appearance/logo/light?v=3',
      alt: 'Annat namn',
    });
    expect(await usecases.logo('dark')).toBeNull();
    // The theme is untouched by a logo save, and the logo by a theme save.
    await usecases.setTheme(admin, themeFileOf(theme));
    expect((await usecases.read()).logo?.alt).toBe('Annat namn');
    expect(await usecases.clearLogo(admin)).toMatchObject({ revision: 5, logo: null, theme });
    expect(store.audit.at(-1)).toMatchObject({ action: 'appearance.logo.cleared', details: { alt: 'Annat namn' } });
  });

  test('a logo needs an image the first time, and an image that is not what it says is refused', async () => {
    const { usecases, admin, store } = stack();
    await expect(usecases.setLogo(admin, { alt: 'Kommun' })).rejects.toThrow('Välj en bild för logotypen.');
    await expect(
      usecases.setLogo(admin, { alt: 'Kommun', light: { mediaType: 'image/png', data: base64(SVG) } }),
    ).rejects.toThrow('Logotypen är inte en PNG-bild.');
    await expect(usecases.setLogo(admin, { alt: 'Kommun', light: png, dark: svg('<p>hej</p>') })).rejects.toThrow(
      'Logotypen för mörkt läge är inte en SVG-bild.',
    );
    expect(store.audit).toEqual([]);
    expect((await usecases.read()).logo).toBeNull();
  });

  test('an SVG that could run, load or embed anything is refused whole; a plain drawing is kept', () => {
    const refused = (text: string) => {
      const result = logoImageOf(svg(text), 'Logotypen');
      return 'problem' in result ? result.problem : null;
    };
    const wrap = (inner: string, attributes = '') =>
      `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" ${attributes}>${inner}</svg>`;
    expect(refused(wrap('<script>alert(1)</script>'))).toBe(
      'Logotypen innehåller skript, vilket inte tillåts i en logotyp.',
    );
    expect(refused(wrap('<SCRIPT href="x"/>'))).toContain('skript');
    expect(refused(wrap('<rect/>', 'onload="alert(1)"'))).toContain('händelseattribut');
    expect(refused(wrap('<foreignObject><body/></foreignObject>'))).toContain('inbäddat innehåll');
    expect(refused(wrap('<a href="javascript:alert(1)"><rect/></a>'))).toContain('skriptadresser');
    expect(refused(wrap('<image href="https://example.org/track.png"/>'))).toContain('länkar ut ur bilden');
    expect(refused(wrap('<use xlink:href="//example.org/a.svg#b"/>'))).toContain('länkar ut ur bilden');
    expect(refused(wrap('<style>@import url(https://example.org/a.css);</style>'))).toContain('importerade stilmallar');
    expect(refused(wrap('<rect fill="url(https://example.org/a.svg#g)"/>'))).toContain('resurser utanför bilden');
    expect(refused('<!DOCTYPE svg [<!ENTITY x "y">]>' + wrap('<rect/>'))).toContain('dokumenttypsdeklaration');
    // What a drawing tool exports: gradients and reuse by fragment, an embedded bitmap, inline styles.
    expect(
      refused(
        wrap(
          '<defs><linearGradient id="g"/><path id="p" d="M0 0"/></defs><use href="#p"/><use xlink:href="#p"/>' +
            '<rect style="fill:url(#g)"/><image href="data:image/png;base64,AAAA"/>',
        ),
      ),
    ).toBeNull();
    // The spellings the plain patterns let through (ID-6 of the 2026-11-23 review): an element is known by its namespace,
    // a value is read after its references, and a stylesheet may not escape a character.
    const svgns = 'xmlns:s="http://www.w3.org/2000/svg"';
    expect(refused(wrap(`<s:script ${svgns}>alert(1)</s:script>`))).toContain('skript');
    expect(
      refused(wrap(`<s:foreignObject ${svgns}><b xmlns="http://www.w3.org/1999/xhtml"/></s:foreignObject>`)),
    ).toContain('inbäddat innehåll');
    expect(refused(wrap('<h:script xmlns:h="http://www.w3.org/1999/xhtml">alert(1)</h:script>'))).toContain('skript');
    expect(refused(wrap('<h:img xmlns:h="http://www.w3.org/1999/xhtml" src="https://example.org/a.png"/>'))).toContain(
      'inbäddat innehåll',
    );
    expect(refused(wrap('<rect style="fill:\\75rl(https://example.org/a.png)"/>'))).toContain('kodade tecken');
    expect(refused(wrap('<style>@\\69mport "https://example.org/a.css";</style>'))).toContain('kodade tecken');
    expect(refused(wrap('<set attributeName="href" to="&#106;avascript:alert(1)"/>'))).toContain('skriptadresser');
    expect(refused(wrap('<rect fill="&#117;rl(https://example.org/a.png)"/>'))).toContain('resurser utanför bilden');
    expect(refused(wrap('<a href="java&#9;script:alert(1)"><rect/></a>'))).toContain('skriptadresser');
    // A stylesheet is its text as the browser joins it, across comments and sections.
    expect(refused(wrap('<style>@im<!-- -->port "https://example.org/a.css";</style>'))).toContain('importerade');
    expect(refused(wrap('<style>.a{background:image-set("https://example.org/a.png" 1x)}</style>'))).toContain(
      'resurser utanför bilden',
    );
    expect(refused(wrap('<style><rect/></style>'))).toContain('inbäddat innehåll');
    expect(refused(wrap('<animate attributeName="fill" to="red"/>'))).toContain('animering');
    expect(refused(wrap('<marquee/>'))).toContain('elementet <marquee>');
    expect(refused('<?xml-stylesheet href="https://example.org/a.css"?>' + wrap('<rect/>'))).toContain(
      'bearbetningsinstruktion',
    );
    // What a browser would not read as XML, or reads as something other than an SVG, is not a logo.
    expect(refused(wrap('<rect>'))).toBe('Logotypen går inte att läsa som SVG-bild.');
    expect(refused(wrap('<rect x="1" x="2"/>'))).toBe('Logotypen går inte att läsa som SVG-bild.');
    expect(refused(wrap('<p:rect/>'))).toBe('Logotypen går inte att läsa som SVG-bild.');
    expect(refused(wrap('<text>&nbsp;</text>'))).toBe('Logotypen går inte att läsa som SVG-bild.');
    expect(refused(wrap('<rect/>') + '<svg xmlns="http://www.w3.org/2000/svg"/>')).toBe(
      'Logotypen går inte att läsa som SVG-bild.',
    );
    expect(refused('<svg><rect/></svg>')).toBe('Logotypen är inte en SVG-bild.');
    // An editor's export: its own namespaces are inert metadata, and a stylesheet in a section is read as one.
    expect(
      refused(
        '<?xml version="1.0" encoding="UTF-8" standalone="no"?>\n<!-- Created with a drawing tool -->\n' +
          '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ' +
          'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" ' +
          'xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" sodipodi:docname="logo.svg" viewBox="0 0 8 8" ' +
          'xml:space="preserve"><sodipodi:namedview inkscape:zoom="1"/><metadata><rdf:RDF/></metadata>' +
          '<style type="text/css"><![CDATA[ .st0{fill:#0A3D62;} ]]></style>' +
          '<g inkscape:label="Lager 1" inkscape:groupmode="layer"><path class="st0" d="M0 0h8v8z"/>' +
          '<text x="1" y="7" font-family="\'Open Sans\'">Kommun &amp; region</text></g></svg>\n',
      ),
    ).toBeNull();
    // Only what a browser reads as CSS is held to the stylesheet rules: an editor's metadata and an accessible name may
    // hold a backslash, as a Windows path does, and still be a logo; a presentation attribute that takes an address
    // may not escape one.
    expect(
      refused(
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:inkscape="http://www.inkscape.org/namespaces/inkscape" ' +
          'xmlns:sodipodi="http://sodipodi.sourceforge.net/DTD/sodipodi-0.dtd" ' +
          'inkscape:export-filename="C:\\Users\\anna\\logo.png" sodipodi:docbase="C:\\Bilder" ' +
          'aria-label="Kommunens vapen \\ logotyp"><rect/></svg>',
      ),
    ).toBeNull();
    expect(refused(wrap('<rect fill="\\75rl(https://example.org/a.png)"/>'))).toContain('kodade tecken');
    expect(refused(wrap('<rect clip-path="url(https://example.org/a.svg#c)"/>'))).toContain('resurser utanför bilden');
    // What else an editor writes and a browser draws, or ignores: a switch, a view, Inkscape's flowed text, meshes and
    // an element of its own named in any script; an embedded raster image as GIF or WebP, its base64 broken by spaces.
    expect(
      refused(
        wrap(
          '<switch><g systemLanguage="sv"><rect/></g></switch><view id="v" viewBox="0 0 1 1"/>' +
            '<flowRoot><flowRegion><rect/></flowRegion><flowPara>Text</flowPara></flowRoot>' +
            '<defs><meshgradient id="m"><meshrow><meshpatch><stop/></meshpatch></meshrow></meshgradient></defs>' +
            '<x:märke xmlns:x="https://example.org/editor"/>' +
            '<image href="data:image/gif;base64,R0lG ODlh"/><image href="data:image/webp;base64,UklGRg=="/>',
        ),
      ),
    ).toBeNull();
    expect(refused(wrap('<image href="data:image/svg+xml;base64,PHN2Zz4="/>'))).toContain('länkar ut ur bilden');
    // A file read as UTF-8 that names another encoding is one a browser reads otherwise: in ISO-2022-JP the escape
    // sequences turn what this check reads as a comment into text, and the script after it runs.
    expect(
      refused(
        '<?xml version="1.0" encoding="ISO-2022-JP"?><svg xmlns="http://www.w3.org/2000/svg"><desc>\u001b$B<!--' +
          '\u001b(B<script>alert(1)</script>--></desc></svg>',
      ),
    ).toBe('Logotypen är inte en SVG-bild i UTF-8.');
    expect(refused("<?xml version='1.0' encoding='utf8'?>" + wrap('<rect/>'))).toBeNull();
    const large = logoImageOf(
      { mediaType: 'image/png', data: base64(new Uint8Array(LOGO_MAX_BYTES + 1)) },
      'Logotypen',
    );
    expect(large).toEqual({ problem: 'Logotypen är för stor. Högst 256 kB.' });
  });
  test('the operator at the command line makes the same changes under the same checks, audited as bootstrap:appearance', async () => {
    const { usecases, store, authorized } = stack();
    const saved = await usecases.operator.setTheme(themeFileOf(theme));
    expect(saved).toMatchObject({ revision: 1, updatedBy: 'Kommandoraden', theme: { name: 'Exempelkommunen' } });
    await usecases.operator.setLogo({ alt: 'Exempelkommunen', light: png });
    await usecases.operator.setName('Exempelkommunens intranät');
    // The name, the file and the image are checked as an upload is: nothing is written for a refusal.
    await expect(usecases.operator.setName('')).rejects.toBeInstanceOf(InputError);
    await expect(usecases.operator.setTheme({ light: {} })).rejects.toBeInstanceOf(ThemeFileError);
    await expect(usecases.operator.setLogo({ alt: 'X', light: svg('<svg><script/></svg>') })).rejects.toBeInstanceOf(
      InputError,
    );
    await usecases.operator.clearTheme();
    await usecases.operator.clearLogo();
    await usecases.operator.clearName();
    expect(await usecases.read()).toEqual({ revision: 6, name: 'Clew', theme: null, logo: null });
    expect(store.audit.map(row => [row.actor, row.action, row.subject])).toEqual([
      ['bootstrap:appearance', 'appearance.theme.set', APPEARANCE_SUBJECT],
      ['bootstrap:appearance', 'appearance.logo.set', APPEARANCE_SUBJECT],
      ['bootstrap:appearance', 'appearance.name.set', APPEARANCE_SUBJECT],
      ['bootstrap:appearance', 'appearance.theme.cleared', APPEARANCE_SUBJECT],
      ['bootstrap:appearance', 'appearance.logo.cleared', APPEARANCE_SUBJECT],
      ['bootstrap:appearance', 'appearance.name.cleared', APPEARANCE_SUBJECT],
    ]);
    // No session is behind the command line, so there is no step-up to ask for.
    expect(authorized()).toBe(0);
  });

  test('every example folder in themes/ is an appearance that `scripts/appearance-set.ts` can save', async () => {
    const themes = resolve(import.meta.dir, '../../themes');
    const folders = readdirSync(themes, { withFileTypes: true })
      .filter(entry => entry.isDirectory() && existsSync(resolve(themes, entry.name, 'appearance.json')))
      .map(entry => resolve(themes, entry.name));
    expect(folders.map(folder => folder.split('/').pop())).toContain('sundsvall');
    const image = (path: string) => ({
      mediaType: extname(path) === '.svg' ? ('image/svg+xml' as const) : ('image/png' as const),
      data: readFileSync(path).toString('base64'),
    });
    for (const folder of folders) {
      const { usecases } = stack();
      const manifest = JSON.parse(readFileSync(resolve(folder, 'appearance.json'), 'utf8')) as {
        name?: string;
        theme?: string;
        logo?: { alt: string; light: string; dark?: string };
      };
      if (manifest.name) await usecases.operator.setName(manifest.name);
      if (manifest.theme)
        await usecases.operator.setTheme(JSON.parse(readFileSync(resolve(folder, manifest.theme), 'utf8')));
      if (manifest.logo)
        await usecases.operator.setLogo({
          alt: manifest.logo.alt,
          light: image(resolve(folder, manifest.logo.light)),
          dark: manifest.logo.dark ? image(resolve(folder, manifest.logo.dark)) : null,
        });
      const saved = await usecases.read();
      expect(saved.name).toBe(manifest.name ?? 'Clew');
      expect(saved.theme !== null).toBe(manifest.theme !== undefined);
      expect(saved.logo?.alt).toBe(manifest.logo?.alt);
    }
  });
});
