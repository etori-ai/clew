import type { Page } from '@playwright/test';
import { BoardingMock } from './boarding';
import { competenceTypes } from './competence';
import { PRESENCE_LENS, newsOutput, user } from './data';
import { desktop, expect, expectNoAxeViolations, test } from './support';
import { Units } from './unit-data';

/*
 * A page held open on its first read (WA-M5): the surface stands where the content will, says what it is reading in a
 * status where the page has one (4.1.3), and passes axe while it stands; once the read answers, the status goes and the
 * content comes. Every answer is released by the test, never by a timeout.
 *
 * A page has its level-1 heading in every state: a thing's page (a work item, its review, a conversation) whose thing
 * is not yet read is named by the kind of thing it shows, and by the thing's own name once it is.
 */

type Where = (url: URL) => boolean;

/** Holds every request `where` matches until the returned function is called; then each goes on to the mock. */
async function hold(page: Page, where: Where, method?: string) {
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route(where, async route => {
    if (!method || route.request().method() === method) await gate;
    await route.fallback();
  });
  return release;
}
/** Opens `path` and waits until the held read has been asked for, so the surface is the page's own and not the shell's. */
async function openHeld(page: Page, path: string, where: Where) {
  await Promise.all([page.waitForRequest(request => where(new URL(request.url()))), page.goto(path)]);
  await expect(page.getByRole('main')).toBeVisible();
}
const exactly = (path: string) => (url: URL) => url.pathname === path;
const under = (path: string) => (url: URL) => url.pathname === path || url.pathname.startsWith(path + '/');
const status = (page: Page, label: string) => page.getByRole('main').getByRole('status').filter({ hasText: label });
const skeleton = (page: Page) => page.getByRole('main').locator('.astryx-skeleton').first();
const h1 = (page: Page) => page.getByRole('main').getByRole('heading', { level: 1 });

test.describe('a page held on its first read stands as placeholders and says what it reads', () => {
  test.use({ viewport: desktop });

  test('Alla samtal', async ({ page, api: _ }) => {
    // Alla samtal reads its own paged list (WD-L1), not the stream.
    const release = await hold(page, exactly('/api/conversations'));
    await openHeld(page, '/conversations', exactly('/api/conversations'));
    await expect(status(page, 'Hämtar dina samtal …')).toBeAttached();
    await expect(skeleton(page)).toBeVisible();
    await expect(h1(page)).toHaveCount(1);
    await expectNoAxeViolations(page);
    release();
    await expect(status(page, 'Hämtar dina samtal …')).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('table').first()).toBeVisible();
  });

  test('Alla verktyg', async ({ page, api: _ }) => {
    const release = await hold(page, exactly('/api/areas'));
    await openHeld(page, '/tools', exactly('/api/areas'));
    await expect(status(page, 'Hämtar verktygen …')).toBeAttached();
    await expect(h1(page)).toHaveCount(1);
    await expectNoAxeViolations(page);
    release();
    await expect(status(page, 'Hämtar verktygen …')).toHaveCount(0);
  });

  for (const [path, kind] of [
    ['/items/fakturor', 'Ärende'],
    ['/items/fakturor/review', 'Ärende'],
  ] as const)
    test(`a work item’s page: ${path}`, async ({ page, api: _ }) => {
      const release = await hold(page, under('/api/threads'));
      await openHeld(page, path, under('/api/threads'));
      await expect(status(page, 'Hämtar innehåll …')).toBeAttached();
      await expect(skeleton(page)).toBeVisible();
      await expect(h1(page)).toHaveText([kind]);
      await expectNoAxeViolations(page);
      release();
      await expect(status(page, 'Hämtar innehåll …')).toHaveCount(0);
      await expect(h1(page)).toHaveCount(1);
      await expect(h1(page)).not.toHaveText([kind]);
    });

  test('a conversation', async ({ page, api: _ }) => {
    const release = await hold(page, under('/api/threads'));
    await openHeld(page, '/conversations/fraga', under('/api/threads'));
    await expect(status(page, 'Hämtar samtalet …')).toBeAttached();
    await expect(h1(page)).toHaveText(['Samtal']);
    await expectNoAxeViolations(page);
    release();
    await expect(status(page, 'Hämtar samtalet …')).toHaveCount(0);
    await expect(page.getByRole('log')).toBeVisible();
  });

  test('Introduktion och avslut', async ({ page, api }) => {
    api.boarding = new BoardingMock();
    const release = await hold(page, exactly('/api/boarding/plans'));
    await openHeld(page, '/boarding', exactly('/api/boarding/plans'));
    await expect(status(page, 'Hämtar innehåll …')).toBeAttached();
    await expect(h1(page)).toHaveCount(1);
    await expectNoAxeViolations(page);
    release();
    await expect(status(page, 'Hämtar innehåll …')).toHaveCount(0);
    await expect(page.getByRole('table', { name: 'Medarbetarnas planer' })).toBeVisible();
  });

  test('Kompetens on the reader’s own page', async ({ page, api }) => {
    api.competenceTypes = competenceTypes();
    await page.route(exactly(`/api/entities/person/${user.id}`), route =>
      route.fulfill({
        json: {
          entity: { kind: 'person', key: user.id, sourceKey: 'testa', name: user.name, id: user.id },
          relation: 'self',
          actions: [],
          sections: [],
          cards: [],
        },
      }),
    );
    const holdings = exactly('/api/cap/competence.holdings');
    const release = await hold(page, holdings, 'POST');
    await openHeld(page, '/competence', holdings);
    await expect(status(page, 'Hämtar innehåll …')).toBeAttached();
    await expect(h1(page)).toHaveText([user.name]);
    await expectNoAxeViolations(page);
    release();
    await expect(status(page, 'Hämtar innehåll …')).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('listitem').filter({ hasText: 'HLR' }).first()).toBeVisible();
  });

  test('the matrix', async ({ page, api }) => {
    api.competenceTypes = competenceTypes();
    const release = await hold(page, exactly('/api/competence/matrix'));
    await openHeld(page, '/competence/matrix', exactly('/api/competence/matrix'));
    await expect(status(page, 'Hämtar innehåll …')).toBeAttached();
    await expect(h1(page)).toHaveCount(1);
    await expectNoAxeViolations(page);
    release();
    await expect(status(page, 'Hämtar innehåll …')).toHaveCount(0);
    await expect(page.getByRole('heading', { level: 2, name: 'Medarbetarnas kompetens', exact: true })).toBeVisible();
  });

  test('a person’s sections, while their sources answer', async ({ page, api: _ }) => {
    const sections = under('/api/entities/person/johan/section');
    const release = await hold(page, sections);
    await openHeld(page, '/people/johan', sections);
    await expect(h1(page)).toHaveText(['Johan Byström']);
    await expect(skeleton(page)).toBeVisible();
    await expectNoAxeViolations(page);
    release();
    await expect(page.getByRole('main').locator('.astryx-skeleton')).toHaveCount(0);
  });

  test('a lens on Personal, while its source answers', async ({ page, api: _ }) => {
    const lens = (url: URL) =>
      url.pathname === '/api/entities/person/rows' && url.searchParams.get('capability') === PRESENCE_LENS;
    const release = await hold(page, lens);
    await openHeld(page, `/staff?show=${PRESENCE_LENS}`, lens);
    await expect(status(page, 'Hämtar innehåll …')).toBeAttached();
    await expect(h1(page)).toHaveCount(1);
    await expectNoAxeViolations(page);
    release();
    await expect(status(page, 'Hämtar innehåll …')).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('table').first()).toBeVisible();
  });

  test('Läget’s register of the units', async ({ page, api: _ }) => {
    await new Units().route(page);
    const release = await hold(page, exactly('/api/entities/unit'));
    await openHeld(page, '/units', exactly('/api/entities/unit'));
    await expect(status(page, 'Hämtar enheterna …')).toBeAttached();
    await expect(h1(page)).toHaveText(['Läget']);
    await expectNoAxeViolations(page);
    release();
    await expect(status(page, 'Hämtar enheterna …')).toHaveCount(0);
  });

  test('Alla nyheter', async ({ page, api }) => {
    api.news = newsOutput();
    const news = exactly('/api/cap/clew.news');
    const release = await hold(page, news, 'POST');
    await openHeld(page, '/tools/clew.news', news);
    await expect(status(page, 'Hämtar innehåll …')).toBeAttached();
    await expect(h1(page)).toHaveCount(1);
    await expectNoAxeViolations(page);
    release();
    await expect(status(page, 'Hämtar innehåll …')).toHaveCount(0);
    await expect(page.getByRole('main').getByText('Nytt lönesystem från årsskiftet')).toBeVisible();
  });

  test('the manifest reference', async ({ page, api: _ }) => {
    const reference = exactly('/api/protocol/manifest-reference.json');
    const release = await hold(page, reference);
    await openHeld(page, '/protocol/manifest', reference);
    await expect(skeleton(page)).toBeVisible();
    await expect(h1(page)).toHaveText(['Clew manifest reference']);
    await expectNoAxeViolations(page);
    release();
    await expect(page.getByRole('main').locator('.astryx-skeleton')).toHaveCount(0);
    await expect(page.getByRole('navigation', { name: 'On this page' })).toBeVisible();
  });
});
