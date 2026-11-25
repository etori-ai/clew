import {
  SITE,
  desktop,
  expect,
  expectNoAxeViolations,
  hemLine,
  open,
  openNav,
  pagesNav,
  phone,
  reflowProblems,
  test,
} from './support';
import type { InstallationTheme, SiteHeaderView } from '@clew/contracts';
import { contrastRatio, parseThemeFile, themeFileOf } from '../../packages/contracts/src/theme-file';

/**
 * The shared header on the web app (D88, D130): the band with the installation's name, Clew's Start (D116; the server
 * puts it first) and the places the person's header connector lists; under the band Clew's own pages stand once, as the
 * row "Mina sidor". Without a connector the band is the heading row alone and Start stands first among Clew's pages.
 * Keyboard, structure, axe and reflow, at desktop, phone and 1024 px.
 */
const fromConnector = (): SiteHeaderView => ({
  menu: {
    version: 1,
    site: { name: 'Intranätet', href: '/' },
    items: [
      // As the server answers since D116, amended: Clew's Start alone, whatever the connector listed there.
      { id: 'start', label: 'Start', href: '/' },
      { id: 'organisation', label: 'Organisation', href: 'https://intranat.example.se/organisation' },
      { id: 'service', label: 'Service, IT och lokaler', href: 'https://intranat.example.se/service' },
    ],
  },
  logo: { src: 'https://intranat.example.se/logo.svg', alt: 'Exempelkommunen' },
  source: { id: 'intranet', label: 'Intranätet' },
});

test.describe('the shared header on every page', () => {
  test.beforeEach(async ({ page }) => {
    await page.route('https://intranat.example.se/logo.svg', route =>
      route.fulfill({
        contentType: 'image/svg+xml',
        body: '<svg xmlns="http://www.w3.org/2000/svg" width="80" height="28"><rect width="80" height="28" fill="#fff"/></svg>',
      }),
    );
  });
  test('the intranet’s white logo keeps its dark ground on a pale band and in forced colours', async ({
    page,
    api,
  }) => {
    // A white mark (the routed `logo.svg` is a white plate), which needs the dark ground the header gives it.
    api.header = fromConnector();
    const mark = api.header.logo!;
    const theme: InstallationTheme = {
      name: null,
      colors: {
        'background-inverted': ['#ffffff', '#000000'],
        'on-light': ['#ffffff', '#ffffff'],
        'on-dark': ['#000000', '#000000'],
      },
    };
    expect(parseThemeFile(themeFileOf(theme))).toEqual({ ok: true, theme });
    api.appearance = { ...api.appearance, revision: 1, theme };
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    const logo = page.getByRole('banner').getByRole('img', { name: mark.alt });
    await expect(logo).toHaveAttribute('src', mark.src);
    const contrastWithWhiteMark = async () => {
      const pixel = await logo.evaluate(img => {
        const ctx = document.createElement('canvas').getContext('2d')!;
        ctx.fillStyle = getComputedStyle(img).backgroundColor;
        ctx.fillRect(0, 0, 1, 1);
        return Array.from(ctx.getImageData(0, 0, 1, 1).data);
      });
      const plate =
        '#' +
        pixel
          .slice(0, 3)
          .map(c => c.toString(16).padStart(2, '0'))
          .join('');
      return pixel[3] === 255 ? contrastRatio('#ffffff', plate) : 0;
    };
    for (const colorScheme of ['light', 'dark'] as const) {
      await page.emulateMedia({ colorScheme });
      await expect.poll(contrastWithWhiteMark).toBeGreaterThanOrEqual(4.5);
    }
    await page.setViewportSize(phone);
    await page.emulateMedia({ colorScheme: 'light', forcedColors: 'active' });
    await expect.poll(contrastWithWhiteMark).toBeGreaterThanOrEqual(4.5);
  });

  test('the band holds the name, the connector logo, the places and the person; Clew’s own pages stand under the band', async ({
    page,
    api,
  }) => {
    api.header = fromConnector();
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    const banner = page.getByRole('banner');
    const heading = banner.getByRole('navigation', { name: 'Intranätet', exact: true });
    await expect(heading.getByRole('link', { name: /Intranätet/ })).toHaveAttribute('href', '/');
    const logo = heading.getByRole('img', { name: 'Exempelkommunen', exact: true });
    await expect(logo).toHaveAttribute('src', 'https://intranat.example.se/logo.svg');
    // The connector's logo is its own band's (D88): drawn as given, not on the light plate that hid a white mark.
    expect(await logo.evaluate(img => getComputedStyle(img).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
    const places = banner.getByRole('navigation', { name: 'Huvudmeny', exact: true });
    await expect(places.getByRole('link', { name: 'Start', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(places.getByRole('link', { name: 'Organisation' })).toHaveAttribute(
      'href',
      'https://intranat.example.se/organisation',
    );
    await expect(places.getByRole('link', { name: 'Service, IT och lokaler' })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Påminnelser: 0', exact: true })).toBeVisible();
    await expect(
      banner.getByRole('button', { name: 'Testa Testsson, Skönsmons skola, inställningar', exact: true }),
    ).toBeVisible();
    // Under the band Clew's own pages, once: nothing of the header's among them, Start not a second time, and no
    // heading or person of their own, since the band says who the installation is and who is signed in.
    const pages = pagesNav(page);
    await expect(pages).toHaveCount(1);
    await expect(pages.getByRole('link', { name: 'Organisation' })).toHaveCount(0);
    await expect(pages.getByRole('link', { name: 'Start', exact: true })).toHaveCount(0);
    await expect(pages.getByRole('link', { name: /^Att göra/ })).toBeVisible();
    await expect(pages.getByRole('link', { name: 'Kalender', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(pages.getByRole('link', { name: 'Intranätet' })).toHaveCount(0);
    // The reminders are the band's bell, not a page of the row as well.
    await expect(pages.getByRole('button', { name: /^Påminnelser/ })).toHaveCount(0);
    // The places come before Clew's pages, top to bottom and for the keyboard.
    expect((await places.boundingBox())!.y).toBeLessThan((await pages.boundingBox())!.y);
    await expectNoAxeViolations(page);
  });
  for (const viewport of [desktop, phone])
    test(`a connector’s Start and absolute site address return to the unfinished question at ${viewport.width}px`, async ({
      page,
      api,
      baseURL,
    }) => {
      api.header = fromConnector();
      api.header.menu.site.href = new URL('/', baseURL).href;
      await page.setViewportSize(viewport);
      await open(page, '/');
      await hemLine(page).fill('Vilka är på plats?');
      await (await openNav(page)).getByRole('link', { name: /^Att göra/ }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Att göra' })).toBeVisible();
      const places =
        viewport === phone ? await openNav(page) : page.getByRole('navigation', { name: 'Huvudmeny', exact: true });
      await places.getByRole('link', { name: 'Start', exact: true }).click();
      await expect(hemLine(page)).toHaveValue('Vilka är på plats?');
      await (await openNav(page)).getByRole('link', { name: /^Att göra/ }).click();
      await expect(page).toHaveURL('/todo');
      await page
        .getByRole('banner')
        .getByRole('link', { name: /Intranätet/ })
        .click();
      await expect(hemLine(page)).toHaveValue('Vilka är på plats?');
    });

  test('a connector’s site link loads the intranet’s own page on the shared origin', async ({ page, api }) => {
    api.header = fromConnector();
    api.header.menu.site.href = '/intranat/organisation';
    await page.route('**/intranat/organisation', route =>
      route.fulfill({ contentType: 'text/html; charset=utf-8', body: '<h1>Intranätets organisation</h1>' }),
    );
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    await page
      .getByRole('banner')
      .getByRole('link', { name: /Intranätet/ })
      .click();
    await expect(page).toHaveURL('/intranat/organisation');
    await expect(page.getByRole('heading', { name: 'Intranätets organisation' })).toBeVisible();
  });

  test('the phone drawer closes on Enter and on Back when only the queue filter changes', async ({ page, api: _ }) => {
    await page.setViewportSize(phone);
    await open(page, '/todo?tab=done');
    for (const before of ['/todo?tab=done', '/todo']) {
      await expect(page).toHaveURL(before);
      const drawer = await openNav(page);
      await drawer.getByRole('link', { name: /^Att göra/ }).press('Enter');
      await expect(drawer).toBeHidden();
      await expect(page).toHaveURL('/todo');
    }
    const drawer = await openNav(page);
    await page.goBack();
    await expect(page).toHaveURL('/todo?tab=done');
    await expect(drawer).toBeHidden();
  });

  test('opening a drawer link in a new tab keeps the original drawer and unfinished question', async ({
    page,
    context,
    api,
  }) => {
    // The second tab reads its own session and queue through the same API fixture.
    await context.route('**/api/**', route => api.handle(route));
    await page.setViewportSize(phone);
    await open(page, '/');
    await hemLine(page).fill('Vilka är på plats?');
    const drawer = await openNav(page);
    const [queue] = await Promise.all([
      context.waitForEvent('page'),
      drawer.getByRole('link', { name: /^Att göra/ }).click({ modifiers: ['ControlOrMeta'] }),
    ]);
    await expect(queue).toHaveURL('/todo');
    await expect(queue.getByRole('heading', { level: 1, name: 'Att göra' })).toBeVisible();
    await queue.close();
    await expect(page).toHaveURL('/');
    await expect(drawer).toBeVisible();
    await drawer.getByRole('button', { name: 'Stäng navigering' }).click();
    await expect(hemLine(page)).toHaveValue('Vilka är på plats?');
  });

  test('without a header connector the band is the heading row alone, and Start stands first among Clew’s pages (D130)', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(desktop);
    await open(page, '/');
    const banner = page.getByRole('banner');
    await expect(banner.getByRole('navigation', { name: SITE, exact: true })).toHaveCount(1);
    await expect(banner.getByRole('link', { name: SITE })).toHaveAttribute('href', '/');
    await expect(page.getByRole('navigation', { name: 'Huvudmeny', exact: true })).toHaveCount(0);
    await expect(banner.getByRole('button', { name: 'Påminnelser: 0', exact: true })).toBeVisible();
    await expect(
      banner.getByRole('button', { name: 'Testa Testsson, Skönsmons skola, inställningar', exact: true }),
    ).toBeVisible();
    const pages = pagesNav(page);
    await expect(pages.getByRole('link').first()).toHaveText('Start');
    await expect(pages.getByRole('link', { name: 'Start', exact: true })).toHaveAttribute('aria-current', 'page');
    await expectNoAxeViolations(page);
  });
  test('on a phone the bar holds the heading, the bell and the person, and “Meny” lists Clew’s pages and then the places', async ({
    page,
    api,
  }) => {
    api.header = fromConnector();
    await page.setViewportSize(phone);
    await open(page, '/');
    const banner = page.getByRole('banner');
    await expect(banner.getByRole('link', { name: /Intranätet/ })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Påminnelser: 0', exact: true })).toBeVisible();
    // On a phone the person is a glyph alone, so the name says no more than the person and what the button opens.
    await expect(banner.getByRole('button', { name: 'Testa Testsson, inställningar', exact: true })).toBeVisible();
    await expect(banner.getByRole('link', { name: 'Organisation' })).toHaveCount(0);
    const nav = await openNav(page);
    // Clew's own pages first, Start not among them: it is the first of the places.
    const own = nav.getByRole('group', { name: 'Mina sidor' });
    await expect(own.getByRole('link').first()).toHaveText(/^Att göra/);
    await expect(own.getByRole('link', { name: 'Start', exact: true })).toHaveCount(0);
    const places = nav.getByRole('group', { name: 'Huvudmeny' });
    expect((await own.boundingBox())!.y).toBeLessThan((await places.boundingBox())!.y);
    await expect(places.getByRole('link', { name: 'Start', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(places.getByRole('link', { name: 'Service, IT och lokaler' })).toHaveAttribute(
      'href',
      'https://intranat.example.se/service',
    );
    expect(await reflowProblems(page, nav)).toEqual([]);
    await expectNoAxeViolations(page);
  });
  test('eight long places wrap onto more rows instead of scrolling sideways at 1024 px', async ({ page, api }) => {
    const header = fromConnector();
    header.menu.items = [
      ...header.menu.items,
      ...[
        'Anställning och arbetsmiljö',
        'Chefsstöd',
        'Ekonomi och styrning',
        'Kompetensförsörjning',
        'Digitalisering, IT och AI',
      ].map((label, i) => ({ id: `plats-${i}`, label, href: `https://intranat.example.se/${i}` })),
    ];
    api.header = header;
    await page.setViewportSize({ width: 1024, height: 768 });
    await open(page, '/');
    const places = page.getByRole('banner').getByRole('navigation', { name: 'Huvudmeny', exact: true });
    await expect(places.getByRole('link')).toHaveCount(8);
    await expect(places.getByRole('link', { name: 'Digitalisering, IT och AI' })).toBeInViewport();
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
