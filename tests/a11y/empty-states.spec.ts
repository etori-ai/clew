import type { Page } from '@playwright/test';
import { BoardingMock, ANNA } from './boarding';
import { competenceCatalogue, competenceTypes } from './competence';
import { newsOutput } from './data';
import { desktop, expect, expectNoAxeViolations, open, phone, test } from './support';

/*
 * A page or a part of one with nothing to show (WA-M5): each says so where its content would stand, as a heading in the
 * outline or a sentence in its flow, and the page keeps its one level-1 heading (1.3.1, 2.4.6). The answers are what
 * the server sends when there is nothing: an empty list, a plan without items, a module switched off, a thing that is
 * gone (400 "… finns inte.", as `InputError` answers it).
 */

const main = (page: Page) => page.getByRole('main');
const h1 = (page: Page) => main(page).getByRole('heading', { level: 1 });

test.describe('an empty page says so in its place', () => {
  test.use({ viewport: desktop });

  test('Att göra with nothing in it: "Tomt här"', async ({ page, api }) => {
    api.threads = [];
    await open(page, '/todo');
    await expect(main(page).getByRole('heading', { level: 2, name: 'Tomt här' })).toBeVisible();
    await expect(h1(page)).toHaveCount(1);
    await expectNoAxeViolations(page);
  });

  test('Alla samtal before the first question: "Inga samtal än", with the way to ask one', async ({ page, api }) => {
    api.threads = [];
    await open(page, '/conversations');
    await expect(main(page).getByRole('heading', { level: 2, name: 'Inga samtal än' })).toBeVisible();
    await expect(main(page).getByRole('link', { name: 'Ny fråga' }).first()).toBeVisible();
    await expect(h1(page)).toHaveCount(1);
    await expectNoAxeViolations(page);
  });

  test('Alla nyheter with no news: the list says so in a sentence, under the page’s heading', async ({ page, api }) => {
    api.news = { ...newsOutput(), rows: [] };
    await open(page, '/tools/clew.news');
    await expect(main(page).getByText('Inga nyheter just nu.')).toBeVisible();
    await expect(h1(page)).toHaveCount(1);
    await expectNoAxeViolations(page);
  });

  test('the matrix of a manager with no one reporting to them: "Inga medarbetare att visa"', async ({ page, api }) => {
    api.competenceTypes = competenceTypes();
    api.competenceMatrix = { groups: [], awaiting: [], columns: [], rows: [], required: 0 };
    await open(page, '/competence/matrix');
    await expect(main(page).getByRole('heading', { level: 2, name: 'Inga medarbetare att visa' })).toBeVisible();
    await expect(h1(page)).toHaveCount(1);
    await expectNoAxeViolations(page);
  });

  test('a person’s page where no source has anything: "Inget mer att visa om …"', async ({ page, api }) => {
    api.entityRows = {};
    api.entitySilent = {};
    api.entityDetailOf = key =>
      key === 'johan'
        ? {
            entity: { kind: 'person', key: 'johan', sourceKey: 'johan', name: 'Johan Byström', id: 'johan' },
            relation: 'managed',
            actions: [],
            sections: [],
            cards: [],
          }
        : undefined;
    await open(page, '/people/johan');
    await expect(h1(page)).toHaveText(['Johan Byström']);
    await expect(
      main(page).getByRole('heading', { level: 2, name: 'Inget mer att visa om Johan Byström' }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a plan with no items: "Planen har inga punkter"', async ({ page, api }) => {
    api.boarding = new BoardingMock();
    api.boarding.items = [];
    await open(page, `/boarding/${ANNA}`);
    await expect(main(page).getByRole('heading', { level: 2, name: 'Planen har inga punkter' })).toBeVisible();
    await expect(h1(page)).toHaveCount(1);
    await expectNoAxeViolations(page);
  });

  test('the conversation’s pane for a work item that is gone: "Ärendet finns inte längre"', async ({
    page,
    api: _,
  }) => {
    await open(page, '/conversations/fraga?card=borta');
    await expect(page.getByRole('heading', { level: 2, name: 'Ärendet finns inte längre' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});

test.describe('an administration page with nothing to administer says so', () => {
  test.use({ viewport: desktop });

  test('Administration for a person whose every capability belongs to a module switched off', async ({ page, api }) => {
    api.admin = true;
    api.capabilities = ['admin.competence'];
    await open(page, '/admin');
    await expect(page).toHaveURL('/admin');
    await expect(h1(page)).toHaveText(['Inget att administrera ännu']);
    await expectNoAxeViolations(page);
  });

  test('Administration for a person who is no administrator', async ({ page, api }) => {
    api.admin = false;
    await open(page, '/admin');
    await expect(h1(page)).toHaveText(['Du saknar behörighet till administrationen']);
    await expectNoAxeViolations(page);
  });

  test('Anslutna system with none: "Inga anslutningar ännu"', async ({ page, api }) => {
    api.admin = true;
    api.connectors = [];
    await open(page, '/admin/connectors');
    await expect(main(page).getByText('Inga anslutningar ännu')).toBeVisible();
    await expect(h1(page)).toHaveCount(1);
    await expectNoAxeViolations(page);
  });

  test('Modeller with no provider: "Inga modeller ännu", with the way to add one', async ({ page, api }) => {
    api.admin = true;
    api.providers = [];
    api.models = [];
    await open(page, '/admin/models');
    await expect(main(page).getByText('Inga modeller ännu')).toBeVisible();
    await expect(main(page).getByRole('button', { name: 'Lägg till leverantör' })).toHaveCount(2);
    await expect(h1(page)).toHaveCount(1);
    await expectNoAxeViolations(page);
  });

  for (const [path, heading] of [
    ['/admin/connectors/borta', 'Anslutningen finns inte'],
    ['/admin/models/borta', 'Modellen finns inte'],
    ['/admin/models/providers/borta', 'Leverantören finns inte'],
  ] as const)
    test(`${path}: a thing that is gone says so in the page’s heading`, async ({ page, api }) => {
      api.admin = true;
      await open(page, path);
      await expect(h1(page)).toHaveText([heading]);
      await expect(main(page).getByRole('link', { name: 'Till listan' })).toBeVisible();
      await expectNoAxeViolations(page);
    });

  test('Introduktion och avslut with no layer: "Inga lager ännu"', async ({ page, api }) => {
    api.admin = true;
    api.capabilities = [...api.capabilities, 'admin.boarding'];
    api.boarding = new BoardingMock();
    api.boarding.layers = [];
    await open(page, '/admin/boarding');
    await expect(main(page).getByText('Inga lager ännu')).toBeVisible();
    await expect(h1(page)).toHaveCount(1);
    await expectNoAxeViolations(page);
  });

  test('a file’s rows that no search matches: "Ingen rad matchar"', async ({ page, api }) => {
    api.admin = true;
    api.competenceTypes = competenceCatalogue();
    await open(page, '/admin/competence/import');
    await page
      .getByLabel('Fil med kompetenser', { exact: true })
      .and(page.locator('input[type="file"]'))
      .setInputFiles({
        name: 'kompetenser.csv',
        mimeType: 'text/csv',
        buffer: Buffer.from(
          [
            'name,area,kind,validityMonths,uri',
            'Arbete på väg,Säkerhet,certificate,60,',
            'Truckkort,Fordon,Certifikat,,',
          ].join('\n'),
          'utf8',
        ),
      });
    await page.getByRole('searchbox', { name: 'Sök rad' }).fill('ingenting sådant');
    await expect(main(page).getByRole('heading', { level: 2, name: 'Ingen rad matchar' })).toBeVisible();
    await expect(page.getByRole('searchbox', { name: 'Sök rad' })).toBeFocused();
    await expectNoAxeViolations(page);
  });
});

test.describe('on a phone', () => {
  test.use({ viewport: phone, hasTouch: true, isMobile: true });

  test('Att göra with nothing in it says so at 375 px', async ({ page, api }) => {
    api.threads = [];
    await open(page, '/todo');
    await expect(main(page).getByRole('heading', { level: 2, name: 'Tomt här' })).toBeVisible();
    await expectNoAxeViolations(page);
  });
});
