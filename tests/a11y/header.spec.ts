import { desktop, expect, expectNoAxeViolations, open, openNav, phone, reflowProblems, test } from './support';
import type { SiteHeaderView } from '@clew/contracts';

/**
 * The shared header on the web app (D88, D115): the band with the installation's name and the places the person's
 * header connector lists, and under the band the selected place's row. Under Start that row is Clew's own pages (D115
 * item 3), not the pages the connector lists there; another place of the same origin lists the connector's. There is
 * no rail. Keyboard, structure, axe and reflow, at desktop, phone and 1024 px.
 */
const fromConnector = (): SiteHeaderView => ({
  menu: {
    version: 1,
    site: { name: 'Intranätet', href: '/' },
    items: [
      {
        id: 'start',
        label: 'Start',
        href: '/',
        children: [
          { id: 'kalender', label: 'Kalender', href: '/calendar' },
          { id: 'kort', label: 'Mina kort', href: '/?tab=waiting' },
        ],
      },
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
  test("the band holds the name, the connector logo, the places and the person; under Start the row holds Clew's own pages, not the connector's", async ({
    page,
    api,
  }) => {
    api.header = fromConnector();
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    const banner = page.getByRole('banner');
    const heading = banner.getByRole('navigation', { name: 'Intranätet', exact: true });
    await expect(heading.getByRole('link', { name: /Intranätet/ })).toHaveAttribute('href', '/');
    await expect(heading.getByRole('img', { name: 'Exempelkommunen', exact: true })).toHaveAttribute(
      'src',
      'https://intranat.example.se/logo.svg',
    );
    const places = banner.getByRole('navigation', { name: 'Huvudmeny', exact: true });
    await expect(places.getByRole('link', { name: 'Start', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(places.getByRole('link', { name: 'Organisation' })).toHaveAttribute(
      'href',
      'https://intranat.example.se/organisation',
    );
    await expect(places.getByRole('link', { name: 'Service, IT och lokaler' })).toBeVisible();
    // The row under the band is named after the place and holds Clew's own pages (D115 item 3), the page's own marked.
    // What the connector lists under Start ("Mina kort") is not drawn: every address of the web app belongs to Start.
    const pages = banner.getByRole('navigation', { name: 'Start', exact: true });
    await expect(pages.getByRole('link')).toHaveText(['Mina aktiviteter', 'Min AI', 'Kalender', 'Personal']);
    await expect(pages.getByRole('link', { name: 'Kalender' })).toHaveAttribute('aria-current', 'page');
    await expect(pages.locator('[aria-current]')).toHaveCount(1);
    await expect(page.getByRole('link', { name: 'Mina kort' })).toHaveCount(0);
    await expect(banner.getByRole('button', { name: 'Påminnelser: 0', exact: true })).toBeVisible();
    await expect(banner.getByRole('button', { name: 'Testa Testsson, inställningar', exact: true })).toBeVisible();
    // Three navigation landmarks in the banner, each with a name of its own, and no rail beside the page.
    await expect(banner.getByRole('navigation')).toHaveCount(3);
    await expect(page.getByRole('navigation', { name: 'Sidonavigering' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
  test("a place other than Start lists the connector's pages under the band, as links that load their page", async ({
    page,
    api,
  }) => {
    // A place of the header's that is an address of the web app: the longest matching place is the selected one.
    const header = fromConnector();
    header.menu.items = [
      ...header.menu.items,
      {
        id: 'planering',
        label: 'Planering',
        href: '/calendar',
        children: [
          { id: 'vecka', label: 'Veckan', href: '/calendar?view=week' },
          { id: 'lokaler', label: 'Boka lokal', href: 'https://intranat.example.se/lokaler' },
        ],
      },
    ];
    api.header = header;
    await page.setViewportSize(desktop);
    await open(page, '/calendar');
    const banner = page.getByRole('banner');
    const places = banner.getByRole('navigation', { name: 'Huvudmeny', exact: true });
    await expect(places.locator('[aria-current]')).toHaveText(['Planering']);
    const pages = banner.getByRole('navigation', { name: 'Planering', exact: true });
    await expect(pages.getByRole('link')).toHaveText(['Veckan', 'Boka lokal']);
    await expect(pages.getByRole('link', { name: 'Boka lokal' })).toHaveAttribute(
      'href',
      'https://intranat.example.se/lokaler',
    );
    // Clew's own pages belong to Start, so they are not in this row, and no row is named Start.
    await expect(banner.getByRole('navigation', { name: 'Start', exact: true })).toHaveCount(0);
    await expect(pages.getByRole('link', { name: 'Min AI' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });
  test("without a header connector the default has Start alone, and the row under the band holds Clew's own pages", async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(desktop);
    await open(page, '/');
    const banner = page.getByRole('banner');
    const places = banner.getByRole('navigation', { name: 'Huvudmeny', exact: true });
    await expect(places.getByRole('link')).toHaveText(['Start']);
    await expect(places.getByRole('link', { name: 'Start', exact: true })).toHaveAttribute('aria-current', 'page');
    const pages = banner.getByRole('navigation', { name: 'Start', exact: true });
    await expect(pages.getByRole('link')).toHaveText(['Mina aktiviteter', 'Min AI', 'Kalender', 'Personal']);
    // On the start page none of them is the current one: the place itself is.
    await expect(pages.locator('[aria-current]')).toHaveCount(0);
    // One tab stop after another through the row, in the order it is read.
    await pages.getByRole('link', { name: 'Mina aktiviteter' }).focus();
    await page.keyboard.press('Tab');
    await expect(pages.getByRole('link', { name: 'Min AI' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(pages.getByRole('link', { name: 'Kalender' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(pages.getByRole('link', { name: 'Personal' })).toBeFocused();
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
  test('on a phone the bar holds the heading, the bell, the person and Meny, and the places are rows in its drawer', async ({
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
    const menu = banner.getByRole('button', { name: 'Meny', exact: true });
    await expect(menu).toHaveAttribute('aria-expanded', 'false');
    const nav = await openNav(page);
    // The drawer is a dialog named after the site the header belongs to.
    await expect(page.getByRole('dialog', { name: 'Intranätet', exact: true })).toBeVisible();
    await expect(menu).toHaveAttribute('aria-expanded', 'true');
    const places = nav.getByRole('group', { name: 'Huvudmeny' });
    await expect(places.getByRole('link', { name: 'Start', exact: true })).toHaveAttribute('aria-current', 'page');
    await expect(places.getByRole('link', { name: 'Service, IT och lokaler' })).toHaveAttribute(
      'href',
      'https://intranat.example.se/service',
    );
    // Under Start: Clew's own pages (D115 item 3), not the ones the connector lists there.
    const pages = places.getByRole('group', { name: 'Start', exact: true });
    await expect(pages.getByRole('link')).toHaveText(['Mina aktiviteter', 'Min AI', 'Kalender', 'Personal']);
    await expect(nav.getByRole('link', { name: 'Mina kort' })).toHaveCount(0);
    expect(await reflowProblems(page, nav)).toEqual([]);
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(nav).toBeHidden();
    await expect(menu).toBeFocused();
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
    // The header's own words, and the page's width as a whole. The key figures under it are the start page's and are
    // checked whole at this width in `reflow.spec.ts` (D115 item 4).
    expect(await reflowProblems(page, page.getByRole('banner'))).toEqual([]);
    await expectNoAxeViolations(page);
  });
});
