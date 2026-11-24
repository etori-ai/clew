import type { Locator, Page } from '@playwright/test';
import { ANNA, BoardingMock, PLAN } from './boarding';
import { competenceCatalogue, competenceRequirements, competenceShareTargets, competenceSources } from './competence';
import { competenceTypes, searchHolders, withSkills } from './competence';
import { ENTITY_UNIT, newsOutput, user } from './data';
import { menuRows } from './phonebook';
import { FAILED, SITE, desktop, expect, expectNoAxeViolations, open, phone, test, type MockApi } from './support';
import { Units } from './unit-data';

/*
 * A page whose own read fails (WA-M5): the read answers as the routes answer a failure of Clew's own or of a source
 * behind it, a 503 with "Något gick fel. Försök igen." (`failure` in `apps/server/src/context.ts`). Each page says so in
 * the place its content would stand, as an alert, so it is heard as it appears (4.1.3, 3.3.1). Where the page offers
 * "Försök igen", it is reached and pressed from the keyboard and reads the page again once the server answers. The read
 * is held failing past the page's one retry of a 5xx (D33).
 */

type Where = string | RegExp | ((url: URL) => boolean);
/** The read fails until the returned function is called; a read of another method on the same address passes. */
async function failing(page: Page, where: Where, method = 'GET') {
  let fails = true;
  await page.route(where, route =>
    fails && route.request().method() === method
      ? route.fulfill({ status: 503, json: { error: FAILED } })
      : route.fallback(),
  );
  return () => {
    fails = false;
  };
}
const exactly = (path: string) => (url: URL) => url.pathname === path;
/** A page that cannot name its thing still has its one level-1 heading, saying what could not be read, and the tab too. */
async function named(page: Page, heading: string) {
  await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText([heading]);
  await expect(page).toHaveTitle(`${heading} · ${SITE}`);
}
/** The page's own alert with the server's sentence, in the page's main content. */
const alertIn = (scope: Page | Locator) =>
  ('goto' in scope ? scope.getByRole('main') : scope).getByRole('alert').filter({ hasText: FAILED });
/**
 * The server's change stream, stood in for so a test can say a change: a connection starts by saying the current
 * revision, which invalidates nothing, and `window.refresh()` says a later one, which reads the stream again.
 */
async function changeSignal(page: Page) {
  await page.addInitScript(() => {
    class Changes {
      private listener: ((event: { data: string }) => void) | null = null;
      constructor() {
        (window as unknown as { refresh(): void }).refresh = () => this.say('new');
      }
      get onmessage() {
        return this.listener;
      }
      set onmessage(listener: ((event: { data: string }) => void) | null) {
        this.listener = listener;
        this.say('opened');
      }
      private say(revision: string) {
        this.listener?.({ data: JSON.stringify({ revision, policy: '1:1' }) });
      }
      close() {}
    }
    window.EventSource = Changes as unknown as typeof EventSource;
  });
}
/** "Försök igen" from the keyboard, the read answering this time. */
async function tryAgain(page: Page, scope: Locator, heal: () => void, name = 'Försök igen') {
  heal();
  const button = scope.getByRole('button', { name, exact: true });
  await button.focus();
  await expect(button).toBeFocused();
  await page.keyboard.press('Enter');
}

test.describe('a page whose read fails says so where its content would stand', () => {
  test.use({ viewport: desktop });

  test('the manifest reference: an error banner in English, and Try again reads it', async ({ page, api: _ }) => {
    // The reference is static on the server: it fails only where something in front of Clew answers instead.
    let fails = true;
    await page.route('**/api/protocol/manifest-reference.json', route =>
      fails ? route.fulfill({ status: 503, body: '' }) : route.fallback(),
    );
    await open(page, '/protocol/manifest');
    const main = page.getByRole('main');
    await expect(main.getByText('The reference could not be read.')).toBeVisible();
    await expect(main.locator('.astryx-skeleton')).toHaveCount(0);
    await expectNoAxeViolations(page);
    await tryAgain(page, main, () => (fails = false), 'Try again');
    await expect(page.getByRole('navigation', { name: 'On this page' })).toBeVisible();
  });

  test('Alla verktyg', async ({ page, api: _ }) => {
    const heal = await failing(page, '**/api/areas');
    await open(page, '/tools');
    await expect(alertIn(page)).toBeVisible();
    await expectNoAxeViolations(page);
    await tryAgain(page, page.getByRole('main'), heal);
    await expect(alertIn(page)).toHaveCount(0);
  });

  test('a tool’s page whose areas cannot be read', async ({ page, api }) => {
    api.menu = menuRows;
    const heal = await failing(page, '**/api/areas');
    await open(page, '/tools/phonebook.directory');
    const main = page.getByRole('main');
    await expect(main.getByText(FAILED)).toBeVisible();
    await named(page, 'Sidan kunde inte läsas');
    await expectNoAxeViolations(page);
    await tryAgain(page, main, heal);
    await expect(main.getByText(FAILED)).toHaveCount(0);
  });

  test('Alla nyheter', async ({ page, api }) => {
    api.news = newsOutput();
    const heal = await failing(page, '**/api/cap/clew.news', 'POST');
    await open(page, '/tools/clew.news');
    const main = page.getByRole('main');
    await expect(main.getByText(FAILED)).toBeVisible();
    await expect(main.locator('.astryx-skeleton')).toHaveCount(0);
    await expectNoAxeViolations(page);
    await tryAgain(page, main, heal);
    await expect(main.getByText('Nytt lönesystem från årsskiftet')).toBeVisible();
  });

  test('Alla samtal', async ({ page, api: _ }) => {
    // Alla samtal reads its own paged list (WD-L1), not the stream.
    const heal = await failing(page, exactly('/api/conversations'));
    await open(page, '/conversations');
    await expect(alertIn(page)).toBeVisible();
    await expectNoAxeViolations(page);
    await tryAgain(page, page.getByRole('main'), heal);
    await expect(alertIn(page)).toHaveCount(0);
  });

  test('Personal', async ({ page, api: _ }) => {
    const heal = await failing(page, exactly('/api/entities/person'));
    await open(page, '/staff');
    await expect(alertIn(page)).toBeVisible();
    await expectNoAxeViolations(page);
    await tryAgain(page, page.getByRole('main'), heal);
    await expect(page.getByRole('main').getByRole('table').first()).toBeVisible();
  });

  test('a person’s page', async ({ page, api: _ }) => {
    const heal = await failing(page, exactly('/api/entities/person/johan'));
    await open(page, '/people/johan');
    await expect(alertIn(page)).toBeVisible();
    await named(page, 'Personen kunde inte läsas');
    await expectNoAxeViolations(page);
    await tryAgain(page, page.getByRole('main'), heal);
    await expect(page.getByRole('heading', { level: 1, name: 'Johan Byström' })).toBeVisible();
  });

  test('a unit’s page, and its head count alone', async ({ page, api: _ }) => {
    await new Units().route(page);
    const heal = await failing(page, exactly(`/api/entities/unit/${ENTITY_UNIT.id}`));
    await open(page, `/units/${ENTITY_UNIT.id}`);
    await expect(alertIn(page)).toBeVisible();
    await named(page, 'Enheten kunde inte läsas');
    await expectNoAxeViolations(page);
    await tryAgain(page, page.getByRole('main'), heal);
    await expect(page.getByRole('heading', { level: 1, name: ENTITY_UNIT.label })).toBeVisible();
    // Personal's list, which gives the count, fails on its own: the facts say so, with a way to ask again.
    const count = await failing(page, exactly('/api/entities/person'));
    await open(page, `/units/${ENTITY_UNIT.id}`);
    const facts = page.getByRole('complementary', { name: 'Uppgifter' });
    await expect(facts.getByText('Kunde inte hämtas.')).toBeVisible();
    await expectNoAxeViolations(page);
    await tryAgain(page, facts, count, 'Försök igen med Personal');
    await expect(facts.getByText(/\d+ medarbetare/)).toBeVisible();
  });

  for (const [path, read, name] of [
    ['/people/johan', '/api/entities/person/johan', 'Johan Byström'],
    [`/units/${ENTITY_UNIT.id}`, `/api/entities/unit/${ENTITY_UNIT.id}`, ENTITY_UNIT.label],
  ] as const)
    test(`a drawn page whose read fails when it is read again keeps its content and its name: ${path}`, async ({
      page,
      api: _,
    }) => {
      if (path.startsWith('/units/')) await new Units().route(page);
      await changeSignal(page);
      await open(page, path);
      const heading = page.getByRole('main').getByRole('heading', { level: 1 });
      await expect(heading).toHaveText([name]);
      await expect(page).toHaveTitle(`${name} · ${SITE}`);
      await failing(page, exactly(read));
      const refused = page.waitForResponse(r => new URL(r.url()).pathname === read && r.status() === 503);
      await page.evaluate(() => (window as unknown as { refresh(): void }).refresh());
      await refused;
      // What was drawn stays, under the same heading, and the tab says the same as the heading.
      await expect(heading).toHaveText([name]);
      await expect(page).toHaveTitle(`${name} · ${SITE}`);
      await expect(alertIn(page)).toHaveCount(0);
      await expectNoAxeViolations(page);
    });

  test('Läget’s register of the units', async ({ page, api: _ }) => {
    await new Units().route(page);
    const heal = await failing(page, exactly('/api/entities/unit'));
    await open(page, '/units');
    await expect(alertIn(page)).toBeVisible();
    await expectNoAxeViolations(page);
    heal();
    await page.reload();
    await expect(alertIn(page)).toHaveCount(0);
  });

  test('a work item’s page and its review', async ({ page, api: _ }) => {
    const heal = await failing(page, '**/api/threads');
    await open(page, '/items/fakturor');
    await expect(alertIn(page)).toBeVisible();
    await named(page, 'Ärendet kunde inte läsas');
    await expectNoAxeViolations(page);
    await tryAgain(page, page.getByRole('main'), heal);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    await expect(alertIn(page)).toHaveCount(0);

    const again = await failing(page, '**/api/threads');
    await open(page, '/items/fakturor/review');
    const main = page.getByRole('main');
    await expect(main.getByText(FAILED)).toBeVisible();
    await named(page, 'Granskningen kunde inte läsas');
    await expectNoAxeViolations(page);
    await tryAgain(page, main, again);
    await expect(main.getByText(FAILED)).toHaveCount(0);
  });

  for (const [path, drawn] of [
    ['/items/aldre', 'the item'],
    ['/items/aldre/review', 'the review'],
  ] as const)
    test(`an item the stream no longer lists, whose own read fails while the stream fails a refetch: Försök igen reads ${drawn} again`, async ({
      page,
      api,
    }) => {
      // An item handled long ago is read on its own (`/api/threads/:id`). The stream keeps its rows when a refetch
      // fails, so the page's failure is the item's read alone, and that is the read "Försök igen" asks again.
      const fakturor = api.threads.find(t => t.id === 'fakturor')!;
      // Reviewed one row at a time, so its review has steps to draw (D70).
      const older = {
        ...fakturor,
        id: 'aldre',
        title: 'Ett äldre ärende',
        actions: fakturor.actions.map(a =>
          a.id === 'approve' ? { ...a, review: 'each' as const, preview: 'finance.preview' } : a,
        ),
      };
      let itemFails = true;
      let streamFails = false;
      await page.route(exactly('/api/threads/aldre'), route =>
        itemFails ? route.fulfill({ status: 503, json: { error: FAILED } }) : route.fulfill({ json: older }),
      );
      await page.route(exactly('/api/threads'), route =>
        streamFails && route.request().method() === 'GET'
          ? route.fulfill({ status: 503, json: { error: FAILED } })
          : route.fallback(),
      );
      await changeSignal(page);
      await open(page, path);
      const main = page.getByRole('main');
      await expect(main.getByText(FAILED)).toBeVisible();
      await named(page, path.endsWith('/review') ? 'Granskningen kunde inte läsas' : 'Ärendet kunde inte läsas');
      // The stream is read again and fails, its one retry of a 5xx too: its rows stay, and so does the item's failure.
      streamFails = true;
      let refetches = 0;
      page.on('response', r => {
        if (new URL(r.url()).pathname === '/api/threads' && r.status() === 503) refetches++;
      });
      await page.evaluate(() => (window as unknown as { refresh(): void }).refresh());
      await expect.poll(() => refetches).toBe(2);
      await expect(main.getByText(FAILED)).toBeVisible();
      await expectNoAxeViolations(page);
      const asked = page.waitForRequest(r => new URL(r.url()).pathname === '/api/threads/aldre');
      await tryAgain(page, main, () => (itemFails = false));
      await asked;
      await expect(main.getByText(FAILED)).toHaveCount(0);
      // The thing the page is about is drawn under its own name: the item, or the review of it.
      await expect(main.getByRole('heading', { level: 1 })).toHaveText([
        drawn === 'the item' ? older.title : /^Granska /,
      ]);
    });

  test('Kompetens: the person’s own, the matrix and the search', async ({ page, api }) => {
    api.competenceTypes = competenceTypes();
    // `/competence` is the Kompetens tab of the reader's own page (D126 rule 7), which the server answers as theirs.
    await page.route(
      url => url.pathname === `/api/entities/person/${user.id}`,
      route =>
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
    const own = await failing(page, '**/api/cap/competence.holdings', 'POST');
    await open(page, '/competence');
    await expect(page.getByRole('heading', { level: 1, name: user.name })).toBeVisible();
    await expect(alertIn(page)).toBeVisible();
    await expectNoAxeViolations(page);
    await tryAgain(page, page.getByRole('main'), own);
    await expect(alertIn(page)).toHaveCount(0);

    const matrix = await failing(page, exactly('/api/competence/matrix'));
    await open(page, '/competence/matrix');
    await expect(alertIn(page)).toBeVisible();
    await expectNoAxeViolations(page);
    await tryAgain(page, page.getByRole('main'), matrix);
    await expect(page.getByRole('heading', { level: 2, name: 'Medarbetarnas kompetens', exact: true })).toBeVisible();
  });

  test('Kompetenssökning whose options cannot be read', async ({ page, api }) => {
    registrar(api);
    const heal = await failing(page, exactly('/api/competence/search'));
    await open(page, '/competence/search');
    await expect(alertIn(page)).toBeVisible();
    await expectNoAxeViolations(page);
    await tryAgain(page, page.getByRole('main'), heal);
    await expect(alertIn(page)).toHaveCount(0);
  });

  test('Introduktion och avslut: the list, its suggestions, and one person’s plan', async ({ page, api }) => {
    api.boarding = new BoardingMock();
    const plans = await failing(page, exactly('/api/boarding/plans'));
    await open(page, '/boarding');
    await expect(alertIn(page)).toBeVisible();
    await expectNoAxeViolations(page);
    await tryAgain(page, page.getByRole('main'), plans);
    await expect(alertIn(page)).toHaveCount(0);

    const suggestions = await failing(page, exactly('/api/boarding/suggestions'));
    await open(page, '/boarding');
    await expect(alertIn(page)).toBeVisible();
    // The plans stand: only the suggestions are missing.
    await expect(page.getByRole('table', { name: 'Medarbetarnas planer' })).toBeVisible();
    await expectNoAxeViolations(page);
    await tryAgain(page, page.getByRole('main'), suggestions);
    await expect(alertIn(page)).toHaveCount(0);

    const person = await failing(page, exactly(`/api/boarding/people/${ANNA}`));
    await open(page, `/boarding/${ANNA}`);
    await expect(alertIn(page)).toBeVisible();
    await named(page, 'Planen kunde inte läsas');
    await expectNoAxeViolations(page);
    await tryAgain(page, page.getByRole('main'), person);
    await expect(alertIn(page)).toHaveCount(0);

    // The person is read and their plan is not: the tab says what the heading says, never the person's name alone.
    const plan = await failing(page, exactly(`/api/boarding/plans/${PLAN}`));
    await open(page, `/boarding/${ANNA}`);
    await expect(alertIn(page)).toBeVisible();
    await named(page, 'Planen kunde inte läsas');
    await expectNoAxeViolations(page);
    await tryAgain(page, page.getByRole('main'), plan);
    await expect(alertIn(page)).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveText([
      'Introduktion för Anna Lindqvist',
    ]);
  });

  test('a view of one person whose read fails is named for the person, in the heading and the tab', async ({
    page,
    api: _,
  }) => {
    const heal = await failing(page, exactly('/api/cap/clew.commitments'), 'POST');
    const input = encodeURIComponent(JSON.stringify({ person: 'johan.bystrom' }));
    await open(page, `/tools/clew.commitments?input=${input}&of=johan`);
    const main = page.getByRole('main');
    await expect(main.getByText(FAILED)).toBeVisible();
    await named(page, 'Åtgärdspunkter för Johan Byström');
    await expectNoAxeViolations(page);
    await tryAgain(page, main, heal);
    await expect(main.getByText(FAILED)).toHaveCount(0);
  });
});

test.describe('an administration page whose read fails says so in its place', () => {
  test.use({ viewport: desktop });

  for (const [path, read, arrange] of [
    ['/admin/connectors', '/api/admin/connectors', () => {}],
    ['/admin/connectors/finance', '/api/admin/connectors/finance', () => {}],
    ['/admin/models', '/api/admin/models', () => {}],
    ['/admin/models/gpt-oss-120b', '/api/admin/models/gpt-oss-120b', () => {}],
    ['/admin/models/providers/kommunen', '/api/admin/providers/kommunen', () => {}],
    ['/admin/appearance', '/api/admin/appearance', () => {}],
    ['/admin/competence', '/api/competence/types', (api: MockApi) => (api.competenceTypes = competenceCatalogue())],
    [
      '/admin/competence/sources',
      '/api/competence/sources',
      (api: MockApi) => {
        api.competenceTypes = competenceCatalogue();
        api.competenceSources = competenceSources();
      },
    ],
    [
      '/admin/competence/requirements',
      '/api/competence/requirements',
      (api: MockApi) => {
        api.competenceTypes = competenceCatalogue();
        api.competenceRequirements = competenceRequirements();
        api.competenceShareTargets = competenceShareTargets();
      },
    ],
    [
      '/admin/competence/import',
      '/api/competence/types',
      (api: MockApi) => (api.competenceTypes = competenceCatalogue()),
    ],
    [
      '/admin/boarding',
      '/api/boarding/layers',
      (api: MockApi) => {
        api.capabilities = [...api.capabilities, 'admin.boarding'];
        api.boarding = new BoardingMock();
      },
    ],
    [
      '/admin/boarding/import',
      '/api/boarding/layers',
      (api: MockApi) => {
        api.capabilities = [...api.capabilities, 'admin.boarding'];
        api.boarding = new BoardingMock();
      },
    ],
  ] as const)
    test(path, async ({ page, api }) => {
      api.admin = true;
      arrange(api);
      await failing(page, exactly(read));
      await open(page, path);
      await expect(alertIn(page).first()).toBeVisible();
      // A list's page has its own heading; a thing's page that cannot be read says what could not be.
      await expect(page.getByRole('main').getByRole('heading', { level: 1 })).toHaveCount(1);
      await expectNoAxeViolations(page);
    });

  for (const [path, read, heading] of [
    ['/admin/connectors/finance', '/api/admin/connectors/finance', 'Anslutningen kunde inte läsas'],
    ['/admin/models/gpt-oss-120b', '/api/admin/models/gpt-oss-120b', 'Modellen kunde inte läsas'],
    ['/admin/models/providers/kommunen', '/api/admin/providers/kommunen', 'Leverantören kunde inte läsas'],
  ] as const)
    test(`${path} that gets no answer: the heading names the page, the alert what happened and what to do`, async ({
      page,
      api,
    }) => {
      // No answer at all (the network, a proxy): no sentence of the server's, so the page says its own, which is not
      // the heading's said again.
      api.admin = true;
      let fails = true;
      await page.route(exactly(read), route => (fails ? route.abort('connectionfailed') : route.fallback()));
      await open(page, path);
      const main = page.getByRole('main');
      await expect(main.getByRole('heading', { level: 1 })).toHaveText([heading]);
      await expect(main.getByRole('alert').filter({ hasText: 'Tjänsten' })).toHaveText(
        'Tjänsten kunde inte nås. Försök igen.',
      );
      await expectNoAxeViolations(page);
      await tryAgain(page, main, () => (fails = false));
      await expect(main.getByRole('heading', { level: 1 })).not.toHaveText([heading]);
      await expect(main.getByRole('alert').filter({ hasText: 'Tjänsten' })).toHaveCount(0);
    });

  test('a merge whose count cannot be read says so in its dialog', async ({ page, api }) => {
    api.admin = true;
    api.competenceTypes = competenceCatalogue();
    await failing(page, exactly('/api/competence/types/t-fall/merge'));
    await open(page, '/admin/competence?type=t-fall');
    await page.getByRole('dialog', { name: 'Ändra kompetens' }).getByRole('button', { name: 'Slå ihop med …' }).click();
    const merging = page.getByRole('dialog', { name: 'Slå ihop kompetens' });
    const target = merging.getByRole('combobox', { name: /Slå ihop med/ });
    await expect(target).toBeFocused();
    await page.keyboard.type('Heta');
    await page.getByRole('option', { name: /Heta arbeten/ }).click();
    await expect(alertIn(merging)).toBeVisible();
    await expect(merging.getByRole('button', { name: 'Slå ihop', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expectNoAxeViolations(page);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: phone, hasTouch: true, isMobile: true });

  test('a person’s page whose read fails says so at 375 px', async ({ page, api: _ }) => {
    const heal = await failing(page, exactly('/api/entities/person/johan'));
    await open(page, '/people/johan');
    await expect(alertIn(page)).toBeVisible();
    await expectNoAxeViolations(page);
    heal();
  });
});

/** The registrar of Kompetenssökning (D121), as `competence-search.spec.ts` makes them. */
function registrar(api: MockApi) {
  api.competenceTypes = withSkills();
  api.relations = ['registrar'];
  api.employee = true;
  api.competenceSearch = searchHolders(false);
}
