import { desktop, expect, expectNoAxeViolations, open, openNav, phone, reflowProblems, test } from './support';
import type { SiteHeaderView } from '@clew/contracts';

/**
 * The shared header on the web app (D88): the band with the installation's name, Clew's Start (D116; the server puts it
 * first, with no row of pages under it since 2026-11-13) and the places the person's header connector lists; Clew's own
 * pages stand once, in the rail. Keyboard, structure, axe and reflow, at desktop, phone and 1024 px.
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
  test('the band holds the name, the connector logo, the places and the person; the current place lists its own pages under the band', async ({
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
    // No row under the band: Clew's pages stand once, in the rail, which marks the page's own.
    await expect(banner.getByRole('navigation', { name: 'Start', exact: true })).toHaveCount(0);
    await expect(banner.getByRole('link', { name: 'Kalender' })).toHaveCount(0);
    await expect(banner.getByRole('button', { name: 'Påminnelser: 0', exact: true })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Testa Testsson, inställningar', exact: true })).toBeVisible();
    // The rail stays the rail: Clew's own places, nothing of the header's, and no heading or person of its own, since
    // the band says who the installation is and who is signed in.
    const rail = page.getByRole('navigation', { name: 'Sidonavigering' });
    await expect(rail.getByRole('link', { name: 'Organisation' })).toHaveCount(0);
    await expect(rail.getByRole('link', { name: /^Hem/ })).toBeVisible();
    await expect(rail.getByRole('link', { name: 'Kalender', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(rail.getByRole('link', { name: 'Intranätet' })).toHaveCount(0);
    await expect(rail.getByRole('button', { name: 'Testa Testsson', exact: true })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
  test('without a header connector there is no band: the rail carries the installation’s name, the bell and the person (D112 item 1)', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(desktop);
    await open(page, '/');
    await expect(page.getByRole('banner')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'Huvudmeny', exact: true })).toHaveCount(0);
    const rail = page.getByRole('navigation', { name: 'Sidonavigering' });
    await expect(rail.getByRole('link', { name: 'Startsidan' })).toHaveAttribute('href', '/');
    await expect(rail.getByRole('button', { name: 'Påminnelser: 0', exact: true })).toBeVisible();
    await expect(rail.getByRole('button', { name: 'Testa Testsson', exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
  });
  test('on a phone the bar holds the heading, the bell and the person, and the places are rows in the drawer', async ({
    page,
    api,
  }) => {
    api.header = fromConnector();
    await page.setViewportSize(phone);
    await open(page, '/');
    const banner = page.getByRole('banner');
    await expect(banner.getByRole('link', { name: /Intranätet/ })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Påminnelser: 0', exact: true })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Testa Testsson, inställningar', exact: true })).toBeVisible();
    await expect(banner.getByRole('link', { name: 'Organisation' })).toHaveCount(0);
    const nav = await openNav(page);
    const places = nav.getByRole('group', { name: 'Huvudmeny' });
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
