import { StrictMode, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Theme, generateThemeCSS } from '@astryxdesign/core/theme';
import { InternationalizationProvider } from '@astryxdesign/core/i18n';
import { LayerProvider } from '@astryxdesign/core/Layer';
import { Button } from '@astryxdesign/core/Button';
import { Section } from '@astryxdesign/core/Section';
import { NEUTRAL_BRANDING, readBranding, type Branding } from '@clew/ui/branding';
import { createClewTheme, createHeaderBandTheme } from '@clew/ui/theme';
import { swedish } from '@clew/ui/locale';
import { APPEARANCE_PREFERENCE_KEY, readAppearancePreference, type ColorMode } from '@clew/ui/appearance-preference';
import resetCss from '@astryxdesign/core/reset.css?inline';
import astryxCss from '@astryxdesign/core/astryx.css?inline';
import fontsCss from '@astryxdesign/theme-neutral/fonts.css?inline';
import { SiteHeader } from './site-header';
import { useMediaQuery } from '@astryxdesign/core/hooks';
import { SiteHeaderPerson } from './person';
import { parseSiteMenu, selectedItem, type SiteMenu } from './menu';
import { menuSource, withListing } from './sources';

/**
 * `<site-header>`: the shared header as a custom element for a page Clew does not render (D87), the intranet's first.
 *
 *     <script type="module" src="/shared/site-header/site-header.js"></script>
 *     <site-header menu-src="/shared/site-menu.json" login-href="/intranat/login"></site-header>
 *
 * The header renders in a shadow root, so the host page's CSS cannot restyle it and Astryx's reset and component CSS
 * cannot reach the host page. Astryx's stylesheets and the installation's theme (the same `createClewTheme` the portal
 * uses, so the two are drawn from the same tokens) are adopted into the shadow root; only the font face goes into the
 * document, because a font declared inside a shadow root is not loaded. The menu comes from an inline
 * `<script type="application/json">` child when the host renders one (no request, no late header), else `menu-src`.
 *
 * Public and signed-in visitors, from any content system: with `source` (`sitevision`, `wordpress`, see `sources/`)
 * and `source-root` (the start page's id in that system) the element also asks that system's own API, with the
 * visitor's own session, for the pages under the root. The system answers with what this visitor may read, so an
 * anonymous visitor gets the public sections and a signed-in one their own. The listing keeps the static menu's site
 * name and its `start` item and replaces the rest; the static menu is drawn until it arrives and if it fails, so it
 * must be the public one (the menu script's default). Without `source` the element is the static menu alone, which is
 * all a system that serves the menu JSON itself (per visitor, at `menu-src`) needs.
 *
 * Attributes: `menu-src`, `source`, `source-root`, `source-depth` (levels fetched, 1 default: the bar draws one),
 * `source-base` (the system's origin; the page's own by default), `source-nonce` (WordPress's REST nonce for a
 * signed-in visitor), `selected` (an item id; else the page's address decides), `user-name` with `logout-href`, or
 * `login-href`; `appearance-src` (the installation's own `/api/appearance`, D97: its theme and logo; without it the
 * header is Astryx Neutral), `logo-src`, `logo-dark-src`, `logo-alt` (a logo of the page's own instead), `appearance`.
 *
 * Colour: by default (`appearance="auto"`) the header is drawn in the person's own choice from Clew (D39), which the
 * browser keeps per origin, so on one domain the intranet's header turns dark exactly when the portal does; with no
 * choice it follows the system, as the portal does. `light`, `dark` or `system` fixes it for a page that is only one.
 */

/** The document-wide `:root` and `html` rules become the shadow host's: in a shadow root `:root` matches nothing. */
const scoped = (css: string) => css.replace(/:root\b/g, ':host').replace(/:where\(html\)/g, ':host');

/**
 * The one stylesheet the element adds on its own: the host element starts from initial values so that the page's
 * inherited font, colour and line height stop at the boundary, and it is a block like the header it holds. `all:
 * initial` also clears `color-scheme`, which Astryx's reset sets from `data-theme` on `<html>` (light, dark, or both
 * for the system) and which `light-dark()` in every token depends on; inside a shadow root those rules never match, so
 * the element carries its mode in `data-site-header-mode` and sets the scheme from it the same way.
 */
const HOST_CSS = `:host { all: initial; display: block; color-scheme: light dark; }
:host([data-site-header-mode="light"]) { color-scheme: light; }
:host([data-site-header-mode="dark"]) { color-scheme: dark; }`;

/** Held only for the frame in which the colour mode changes (see `markMode`). */
const NO_TRANSITIONS = new CSSStyleSheet();
NO_TRANSITIONS.replaceSync('* { transition: none !important; }');

let fontsAdded = false;
function addFonts() {
  if (fontsAdded || document.querySelector('style[data-site-header-fonts]')) return;
  const style = document.createElement('style');
  style.setAttribute('data-site-header-fonts', '');
  style.textContent = fontsCss;
  document.head.append(style);
  fontsAdded = true;
}

const sheets = new Map<string, CSSStyleSheet[]>();
function stylesFor(themeCss: { name: string; prose?: string; component?: string }): CSSStyleSheet[] {
  const cached = sheets.get(themeCss.name);
  if (cached) return cached;
  const sheet = (text: string) => {
    const s = new CSSStyleSheet();
    s.replaceSync(text);
    return s;
  };
  const list = [
    sheet('@layer reset, astryx-base, astryx-theme;'),
    sheet(scoped(resetCss)),
    sheet(scoped(astryxCss)),
    // What Astryx's `Theme` would inject into the document head, put where the header is (see `EmbeddedHeader`).
    sheet(`@layer reset {\n${themeCss.prose ?? ''}\n}`),
    sheet(`@layer astryx-theme {\n${themeCss.component ?? ''}\n}`),
    sheet(HOST_CSS),
  ];
  sheets.set(themeCss.name, list);
  return list;
}

type Settings = Readonly<{
  inlineMenu: string | null;
  menuSrc: string | null;
  source: string | null;
  sourceRoot: string | null;
  sourceDepth: number;
  sourceBase: string | null;
  sourceNonce: string | null;
  selected: string | null;
  userName: string | null;
  loginHref: string | null;
  logoutHref: string | null;
  appearanceSrc: string | null;
  logoSrc: string | null;
  logoDarkSrc: string | null;
  logoAlt: string | null;
  appearance: 'auto' | ColorMode;
}>;

function useMenu(settings: Settings): SiteMenu | null {
  const inline = useMemo(() => {
    if (!settings.inlineMenu) return null;
    try {
      return parseSiteMenu(JSON.parse(settings.inlineMenu));
    } catch (error) {
      console.error(error);
      return null;
    }
  }, [settings.inlineMenu]);
  const [fetched, setFetched] = useState<SiteMenu | null>(null);
  useEffect(() => {
    if (inline || !settings.menuSrc) return;
    const controller = new AbortController();
    fetch(settings.menuSrc, { signal: controller.signal, credentials: 'same-origin' })
      .then(response => {
        if (!response.ok) throw new Error(`The site menu at ${settings.menuSrc} answered ${response.status}.`);
        return response.json();
      })
      .then(json => setFetched(parseSiteMenu(json)))
      .catch(error => {
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, [inline, settings.menuSrc]);
  const base = inline ?? fetched;
  const [live, setLive] = useState<SiteMenu | null>(null);
  useEffect(() => {
    if (!base || !settings.source || !settings.sourceRoot) return;
    const controller = new AbortController();
    Promise.resolve()
      .then(() =>
        menuSource(settings.source!).list({
          base: settings.sourceBase ?? window.location.origin,
          root: settings.sourceRoot!,
          depth: settings.sourceDepth,
          ...(settings.sourceNonce ? { nonce: settings.sourceNonce } : {}),
          // The visitor's own session, never a stored credential: the content system decides what this person may see.
          init: { signal: controller.signal, credentials: settings.sourceBase ? 'include' : 'same-origin' },
        }),
      )
      .then(listing => {
        // Nothing listed is no menu: keep the static one rather than a bar with Start alone.
        if (listing.length) setLive(parseSiteMenu(withListing(base, listing)));
      })
      .catch(error => {
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, [base, settings.source, settings.sourceRoot, settings.sourceDepth, settings.sourceBase, settings.sourceNonce]);
  return live ?? base;
}

/**
 * The mode to draw in and, unless the attribute fixes one, a way to choose: the person's stored choice, written under
 * the same key the portal and the web app use, so a choice made here holds there too, and kept current across tabs.
 */
function useColorMode(appearance: Settings['appearance']): [ColorMode, ((mode: ColorMode) => void) | null] {
  const [stored, setStored] = useState(readAppearancePreference);
  useEffect(() => {
    if (appearance !== 'auto') return;
    const changed = (event: StorageEvent) => {
      if (event.key === null || event.key === APPEARANCE_PREFERENCE_KEY) setStored(readAppearancePreference());
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [appearance]);
  if (appearance !== 'auto') return [appearance, null];
  const choose = (mode: ColorMode) => {
    try {
      localStorage.setItem(APPEARANCE_PREFERENCE_KEY, mode);
    } catch {
      // Storage refused: the choice holds on this page until it is reloaded, as in the web app.
    }
    setStored(mode);
  };
  return [stored, choose];
}

function EmbeddedHeader({
  settings,
  onTheme,
  onMode,
}: {
  settings: Settings;
  onTheme: (sheets: CSSStyleSheet[]) => void;
  onMode: (mode: ColorMode) => void;
}) {
  // The installation's saved theme and logo (D97), read from Clew itself; Neutral until it answers and if it does not.
  const [installation, setInstallation] = useState<Branding>(NEUTRAL_BRANDING);
  useEffect(() => {
    if (!settings.appearanceSrc) return setInstallation(NEUTRAL_BRANDING);
    const controller = new AbortController();
    const src = new URL(settings.appearanceSrc, window.location.href).href;
    fetch(src, { signal: controller.signal })
      .then(response => {
        if (!response.ok) throw new Error(`The appearance at ${src} answered ${response.status}.`);
        return response.json();
      })
      // The logo's address is a path on the installation, so it is resolved against where the appearance came from.
      .then(json => setInstallation(readBranding(json, src)))
      .catch(error => {
        if (!controller.signal.aborted) console.error(error);
      });
    return () => controller.abort();
  }, [settings.appearanceSrc]);
  const branding = useMemo<Branding>(
    () =>
      settings.logoSrc && settings.logoAlt
        ? {
            ...installation,
            logo: {
              src: settings.logoSrc,
              alt: settings.logoAlt,
              ...(settings.logoDarkSrc ? { darkSrc: settings.logoDarkSrc } : {}),
            },
          }
        : installation,
    [installation, settings.logoSrc, settings.logoDarkSrc, settings.logoAlt],
  );
  const theme = useMemo(() => createClewTheme(branding), [branding]);
  const band = useMemo(() => createHeaderBandTheme(branding), [branding]);
  // Astryx's `Theme` writes an unbuilt theme's CSS into the document head, scoped to `[data-astryx-theme]`, and marks
  // `<html>` with that attribute: on the host page that CSS would restyle the page. The element generates the same CSS
  // into its shadow root instead and hands `Theme` the theme as built, which is how a pre-built theme skips injection.
  const styles = useMemo(() => {
    const css = generateThemeCSS(theme);
    // The band (D88) is a nested theme of its own; its CSS goes into the shadow root the same way.
    const bandCss = generateThemeCSS(band);
    return [
      ...stylesFor({ name: theme.name, prose: css.prose, component: css.component }),
      ...stylesFor({ name: band.name, prose: bandCss.prose, component: bandCss.component }),
    ];
  }, [theme, band]);
  useLayoutEffect(() => onTheme(styles), [styles, onTheme]);
  const built = useMemo(() => ({ ...theme, __built: true }) as typeof theme, [theme]);
  const builtBand = useMemo(() => ({ ...band, __built: true }) as typeof band, [band]);
  const menu = useMenu(settings);
  const [mode, chooseMode] = useColorMode(settings.appearance);
  const prefersDark = useMediaQuery('(prefers-color-scheme: dark)');
  const drawn = mode === 'system' ? (prefersDark ? 'dark' : 'light') : mode;
  // Also on the system's own switch while `system`: the scheme changes then too.
  useLayoutEffect(() => onMode(mode), [mode, drawn, onMode]);
  if (!menu) return null;
  const selected = settings.selected ?? selectedItem(menu, window.location.href);
  const end = settings.userName ? (
    <SiteHeaderPerson
      name={settings.userName}
      onSignOut={settings.logoutHref ? () => window.location.assign(settings.logoutHref!) : undefined}
      appearance={chooseMode ? { mode, onChange: chooseMode } : undefined}
    />
  ) : settings.loginHref ? (
    <Button label="Logga in" href={settings.loginHref} variant="secondary" size="sm" />
  ) : null;
  return (
    <InternationalizationProvider locale="sv-SE" messages={{ 'sv-SE': swedish }}>
      <Theme theme={built} mode={mode}>
        <LayerProvider>
          {/* What the web app's AppShell (`variant="section"`) paints under its top bar: the surface and a divider. */}
          <Section variant="section" padding={0} dividers={['bottom']}>
            <SiteHeader
              menu={menu}
              selected={selected}
              location={window.location.href}
              logo={branding.logo}
              band={builtBand}
              end={end}
            />
          </Section>
        </LayerProvider>
      </Theme>
    </InternationalizationProvider>
  );
}

const ATTRIBUTES = [
  'menu-src',
  'source',
  'source-root',
  'source-depth',
  'source-base',
  'source-nonce',
  'selected',
  'user-name',
  'login-href',
  'logout-href',
  'appearance-src',
  'logo-src',
  'logo-dark-src',
  'logo-alt',
  'appearance',
] as const;

class SiteHeaderElement extends HTMLElement {
  static observedAttributes = ATTRIBUTES;
  private root: Root | null = null;
  private mount: HTMLDivElement | null = null;
  private adopt = (list: CSSStyleSheet[]) => {
    if (this.shadowRoot) this.shadowRoot.adoptedStyleSheets = list;
  };
  private markMode = (mode: ColorMode) => {
    const shadow = this.shadowRoot;
    // Chrome keeps a colour under a CSS transition at its old value when only `color-scheme` changes (a token's
    // `light-dark()`, 2026-11-09), so the switch happens with transitions off for one frame; nothing is redrawn and
    // an open dialog stays open.
    if (shadow) shadow.adoptedStyleSheets = [...shadow.adoptedStyleSheets, NO_TRANSITIONS];
    if (mode === 'system') this.removeAttribute('data-site-header-mode');
    else this.setAttribute('data-site-header-mode', mode);
    if (shadow) {
      void getComputedStyle(this).colorScheme;
      requestAnimationFrame(() => {
        shadow.adoptedStyleSheets = shadow.adoptedStyleSheets.filter(sheet => sheet !== NO_TRANSITIONS);
      });
    }
  };

  connectedCallback() {
    addFonts();
    const shadow = this.shadowRoot ?? this.attachShadow({ mode: 'open' });
    if (!this.mount) {
      this.mount = document.createElement('div');
      shadow.append(this.mount);
    }
    this.root ??= createRoot(this.mount);
    this.render();
  }

  attributeChangedCallback() {
    if (this.root) this.render();
  }

  disconnectedCallback() {
    const root = this.root;
    this.root = null;
    // Unmount after the current task so a move within the page (disconnect, then connect) does not tear down twice.
    queueMicrotask(() => root?.unmount());
    this.mount?.remove();
    this.mount = null;
  }

  private render() {
    const attr = (name: (typeof ATTRIBUTES)[number]) => this.getAttribute(name)?.trim() || null;
    const appearance = attr('appearance');
    const settings: Settings = {
      inlineMenu: this.querySelector('script[type="application/json"]')?.textContent ?? null,
      menuSrc: attr('menu-src'),
      source: attr('source'),
      sourceRoot: attr('source-root'),
      sourceDepth: Math.min(Math.max(Number(attr('source-depth') ?? 1) || 1, 1), 3),
      sourceBase: attr('source-base'),
      sourceNonce: attr('source-nonce'),
      selected: attr('selected'),
      userName: attr('user-name'),
      loginHref: attr('login-href'),
      logoutHref: attr('logout-href'),
      appearanceSrc: attr('appearance-src'),
      logoSrc: attr('logo-src'),
      logoDarkSrc: attr('logo-dark-src'),
      logoAlt: attr('logo-alt'),
      appearance: appearance === 'light' || appearance === 'dark' || appearance === 'system' ? appearance : 'auto',
    };
    this.root?.render(
      <StrictMode>
        <EmbeddedHeader settings={settings} onTheme={this.adopt} onMode={this.markMode} />
      </StrictMode>,
    );
  }
}

if (!customElements.get('site-header')) customElements.define('site-header', SiteHeaderElement);
