import type { Page } from '@playwright/test';
import {
  SITE,
  announcements,
  desktop,
  expect,
  expectNoAxeViolations,
  hiddenFocusStops,
  narrow,
  open,
  phone,
  reflowProblems,
  test,
} from './support';
import { PRESENCE_LENS, TALK_LENS } from './data';

/**
 * Personal as one register (D126 rule 8, board Personal; D94, D97): the title with the unit and the count, the search
 * at the end of its line, the views of the same people as tabs that are links with their own address (Medarbetare, a
 * tab per lens an administrator offers, Kompetens, Introduktion och avslut), then the table: the name as the link to the
 * person (avatar, name, title), the columns an administrator chose with their source under the label, "Just nu" and the
 * row's menu, which opens the action dialog; nothing is created before its last button (rule 4). Old addresses that
 * drew a person, their cards or a talk over the list lead to the person's page. Keyboard, structure, axe and reflow.
 *
 * The mock (`data.ts`): Bergsåkers skola with Anna, Erik, Johan, Karin and Maria; Närvaro from Personalsystemet and
 * Nästa samtal from Utvecklingssamtal (Clew's own) as columns; the lenses Utvecklingssamtal and Frånvaro; Boka samtal
 * and Registrera frånvaro as actions; a work item for Erik and for Johan to act on and a proposal for Karin.
 */
const LENS = `/staff?show=${TALK_LENS}`;
const row = (page: Page, name: string) => page.getByRole('row').filter({ hasText: name });
const tabs = (page: Page) => page.getByRole('navigation', { name: 'Personal' });

test.describe('Personal', () => {
  for (const [layout, viewport] of [
    ['desktop', desktop],
    ['phone', phone],
  ] as const)
    test.describe(layout, () => {
      test.use({ viewport });
      for (const [what, path] of [
        ['Medarbetare', '/staff'],
        ['a lens', LENS],
      ] as const)
        test(`${what} has no axe violations and every focus stop is marked`, async ({ page, api: _ }) => {
          await open(page, path);
          await expect(page.getByRole('heading', { level: 1, name: 'Personal' })).toBeVisible();
          await expect(page.getByRole('link', { name: 'Johan Byström' })).toBeVisible();
          await expectNoAxeViolations(page);
          const { unmarked } = await hiddenFocusStops(page);
          expect(unmarked).toEqual([]);
        });
    });

  test.describe('desktop', () => {
    test.use({ viewport: desktop });
    test('a manager reaches it from the rail and sees the register: the line under the title, the tabs, the columns, the name as the link', async ({
      page,
      api: _,
    }) => {
      await open(page, '/');
      await page.getByRole('link', { name: 'Personal', exact: true }).click();
      await expect(page).toHaveURL(/\/staff$/);
      await expect(page).toHaveTitle(`Personal · ${SITE}`);
      await expect(page.getByRole('link', { name: 'Personal', exact: true })).toHaveAttribute('aria-current', 'page');
      await expect(page.getByText('Bergsåkers skola · 5 medarbetare', { exact: true })).toBeVisible();
      // The views of the same people as tabs, each a link; Medarbetare is the current one.
      const strip = tabs(page);
      await expect(strip.getByRole('link', { name: 'Medarbetare', exact: true })).toHaveAttribute(
        'aria-current',
        'true',
      );
      await expect(strip.getByRole('link', { name: /^Utvecklingssamtal/ })).toHaveAttribute('href', LENS);
      await expect(strip.getByRole('link', { name: 'Frånvaro' })).toHaveAttribute(
        'href',
        `/staff?show=${PRESENCE_LENS}`,
      );
      const table = page.getByRole('table');
      await expect(table.getByRole('columnheader')).toHaveText([
        'Namn',
        'NärvaroPersonalsystemet',
        'Nästa samtalUtvecklingssamtal',
        'Just nu',
        'Åtgärder',
      ]);
      // The name is the link to the person (board Personal), the title under it without the unit the page names.
      await expect(page.getByRole('link', { name: 'Johan Byström' })).toHaveAttribute(
        'href',
        '/people/johan?from=%2Fstaff',
      );
      await expect(row(page, 'Johan Byström').getByText('Lärare 4–6', { exact: true })).toBeVisible();
      await expect(row(page, 'Johan Byström').locator('.astryx-avatar')).toHaveAttribute('aria-hidden', 'true');
      await expect(row(page, 'Erik Sandström').getByText('Sjuk · dag 1', { exact: true })).toBeVisible();
      // "Just nu": the one work item about the person is a link to the item's own page, with the register as its way back.
      await expect(row(page, 'Johan Byström').getByRole('link', { name: '1 att agera på' })).toHaveAttribute(
        'href',
        '/items/samtal-svar?from=%2Fstaff',
      );
      await expect(row(page, 'Johan Byström').getByText('2 försenade', { exact: true })).toBeVisible();
    });

    test('a lens is a tab with its own address: Back returns to Medarbetare, and the list is its view, sorted by need', async ({
      page,
      api: _,
    }) => {
      await open(page, '/staff');
      const strip = tabs(page);
      const lens = strip.getByRole('link', { name: /^Utvecklingssamtal/ });
      // What needs the reader under the lens is counted on its tab.
      await expect(lens.locator('.astryx-badge')).toBeVisible();
      await lens.click();
      await expect(page).toHaveURL(LENS);
      await expect(page).toHaveTitle(`Utvecklingssamtal · Personal · ${SITE}`);
      await expect(lens).toHaveAttribute('aria-current', 'true');
      await expect(lens).toBeFocused();
      // The person whose talk is missing comes first.
      await expect(page.getByRole('row').nth(1)).toContainText('Karin Lindqvist');
      await page.goBack();
      await expect(page).toHaveURL('/staff');
      await expect(strip.getByRole('link', { name: 'Medarbetare', exact: true })).toHaveAttribute(
        'aria-current',
        'true',
      );
    });

    test('a figure on Hem that opens a lens leads to Personal’s tab for it, a name there to the person’s tab, Personal marked throughout (D126 rules 1 and 8)', async ({
      page,
      api,
    }) => {
      api.areas.push({
        id: 'presence',
        title: 'Frånvaro',
        connector: 'hr',
        source: 'Personalsystemet',
        figure: {
          label: 'Frånvaro i dag',
          value: '2',
          tone: 'alert',
          opens: { capability: PRESENCE_LENS, title: 'Frånvaro' },
        },
        needsYou: 0,
        waiting: 0,
        urgency: null,
        standing: [],
        schedules: [],
      });
      await open(page, '/');
      const rail = page
        .getByRole('navigation', { name: 'Mina sidor', exact: true })
        .getByRole('link', { name: 'Personal', exact: true });
      const tile = page.getByRole('region', { name: /^Läget/ }).getByRole('link', { name: /Frånvaro i dag/ });
      await tile.focus();
      await page.keyboard.press('Enter');
      // The lens's read is Personal's tab for it, never a page of its own (D126 rule 8).
      await expect(page).toHaveURL(`/staff?show=${PRESENCE_LENS}`);
      await expect(rail).toHaveAttribute('aria-current', 'page');
      await expect(tabs(page).getByRole('link', { name: 'Frånvaro', exact: true })).toHaveAttribute(
        'aria-current',
        'true',
      );
      // A name under the lens leads to the person's tab for that lens, with the lens as the way back.
      const name = page.getByRole('link', { name: 'Johan Byström', exact: true });
      await expect(name).toHaveAttribute(
        'href',
        `/people/johan?section=${PRESENCE_LENS}&from=${encodeURIComponent(`/staff?show=${PRESENCE_LENS}`)}`,
      );
      await name.click();
      await expect(
        page.getByRole('navigation', { name: 'Om Johan Byström' }).getByRole('link', { name: 'Frånvaro', exact: true }),
      ).toHaveAttribute('aria-current', 'true');
      await expect(page.getByRole('main').getByRole('region', { name: 'Frånvaro', exact: true })).toBeVisible();
      await expect(rail).toHaveAttribute('aria-current', 'page');
      await expectNoAxeViolations(page);
    });

    test('the search narrows the rows by name, never in the address or a way back, and says when nobody is found', async ({
      page,
      api: _,
    }) => {
      await open(page, '/staff');
      const search = page.getByRole('searchbox', { name: 'Sök medarbetare' });
      await search.fill('karin');
      // The words are a person's name: they stay with the page, never in its address, which access logs and the
      // browser's history keep, nor in the way back the person's page is given (D100 item 5; WD-M4).
      await expect(page.getByRole('row')).toHaveCount(2);
      await expect(page).toHaveURL('/staff');
      await expect(row(page, 'Karin Lindqvist')).toBeVisible();
      await expect(page.getByRole('link', { name: 'Karin Lindqvist', exact: true })).toHaveAttribute(
        'href',
        /from=%2Fstaff$/,
      );
      await search.press('End');
      await page.keyboard.type('x');
      await expect(page.getByRole('heading', { level: 2, name: 'Ingen medarbetare heter så' })).toBeVisible();
      await expect(search).toBeFocused();
      await page.keyboard.press('Backspace');
      await expect(row(page, 'Karin Lindqvist')).toBeVisible();
      await expect(search).toBeFocused();
      await search.fill('zzz');
      await expectNoAxeViolations(page);
      await page.getByRole('button', { name: 'Visa alla' }).click();
      await expect(page).toHaveURL('/staff');
      await expect(page.getByRole('row')).toHaveCount(6);
      await expect(search).toBeFocused();
    });

    test('the overview counts overlapping memberships once and includes each configured lens', async ({
      page,
      api,
    }) => {
      const [school] = api.entityList.groups;
      const anna = school!.entities.find(person => person.key === 'anna')!;
      api.entityList.groups.push({ id: 'unit-fritids', label: 'Fritids', entities: [anna] });
      const talks = api.entityList.lenses.find(lens => lens.capability === TALK_LENS)!;
      for (const [capability, title] of [
        ['followup.plans', 'Planer'],
        ['followup.meetings', 'Uppföljningar'],
      ] as const) {
        api.entityList.lenses.push({ ...talks, capability, title });
        api.entityRows[capability] = { capability, status: 'ok', rows: [{ key: anna.sourceKey, state: 'Saknas' }] };
      }
      await open(page, '/staff');
      await expect(page.getByText('2 enheter · 5 medarbetare', { exact: true })).toBeVisible();
      await expect(page.getByRole('group', { name: 'Medarbetare 5', exact: true })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Uppföljningar: 1 medarbetare behöver dig' })).toHaveAttribute(
        'href',
        '/staff?show=followup.meetings',
      );
    });

    test("the row's menu is named for the person and grouped by source, and its talk leads to the person's talk tab", async ({
      page,
      api: _,
    }) => {
      await open(page, LENS);
      await page.getByRole('button', { name: 'Åtgärder för Karin Lindqvist' }).click();
      const menu = page.getByRole('menu', { name: 'Åtgärder för Karin Lindqvist' });
      await expect(menu.getByRole('menuitem', { name: 'Registrera frånvaro' })).toBeVisible();
      await expect(menu.getByRole('menuitem', { name: 'Öppna samtalet' })).toHaveAttribute(
        'href',
        `/people/karin?section=${TALK_LENS}&from=${encodeURIComponent(LENS)}`,
      );
      await page.keyboard.press('Escape');
    });

    test('a propose from a row’s menu opens the action dialog, and nothing is started before its last button (D126 rule 4)', async ({
      page,
      api,
    }) => {
      await open(page, '/staff');
      const menuButton = page.getByRole('button', { name: 'Åtgärder för Karin Lindqvist' });
      await menuButton.click();
      await page.getByRole('menuitem', { name: 'Registrera frånvaro' }).click();
      const dialog = page.getByRole('dialog', { name: 'Registrera frånvaro' });
      await expect(dialog).toBeVisible();
      await expect(dialog.getByText('Personalsystemet · Karin Lindqvist')).toBeVisible();
      expect(api.entityStarts).toEqual([]);
      await expect(page).toHaveURL('/staff');
      await expectNoAxeViolations(page);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(menuButton).toBeFocused();
      expect(api.entityStarts).toEqual([]);
      await menuButton.click();
      await page.getByRole('menuitem', { name: 'Registrera frånvaro' }).click();
      await dialog.getByRole('button', { name: 'Registrera frånvaro' }).click();
      await expect(dialog).toBeHidden();
      expect(api.entityStarts).toEqual([{ key: 'karin', capability: 'hr.registerAbsence', values: {} }]);
      await expect(page).toHaveURL('/items/entity-hr-registerAbsence-karin?from=%2Fstaff');
    });

    test('a source that refuses an action says why in the dialog, once and aloud, the list nowhere, and nothing opens', async ({
      page,
      api,
    }) => {
      const refusal = 'Personalsystemet hittar ingen anställning för Karin Lindqvist.';
      api.entityRefusals['hr.registerAbsence'] = refusal;
      await open(page, '/staff');
      const menu = page.getByRole('button', { name: 'Åtgärder för Karin Lindqvist' });
      await menu.click();
      await page.getByRole('menuitem', { name: 'Registrera frånvaro' }).click();
      const dialog = page.getByRole('dialog', { name: 'Registrera frånvaro' });
      await dialog.getByRole('button', { name: 'Registrera frånvaro' }).click();
      await expect(dialog.getByText(refusal)).toBeVisible();
      await expect.poll(async () => (await announcements(page)).filter(a => a.includes(refusal))).toHaveLength(1);
      await expect(page).toHaveURL('/staff');
      await expectNoAxeViolations(page);
      // Said once while the dialog is open, and by nothing on the list once it is closed.
      await expect(page.getByText(refusal).filter({ visible: true })).toHaveCount(1);
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(menu).toBeFocused();
      await expect(page.getByText(refusal).filter({ visible: true })).toHaveCount(0);
      expect((await announcements(page)).filter(a => a.includes(refusal))).toHaveLength(1);
    });

    test('a source that does not answer is said once, its column stays empty, and Försök igen asks again', async ({
      page,
      api,
    }) => {
      api.entitySilent[PRESENCE_LENS] = 'timeout';
      await open(page, '/staff');
      const said = page.getByText('Personalsystemet svarade inte i tid.', { exact: true });
      await expect(said).toHaveCount(1);
      await expect(row(page, 'Erik Sandström').getByRole('cell').nth(1)).toHaveText('');
      await expect(row(page, 'Johan Byström').getByText('2 försenade', { exact: true })).toBeVisible();
      await expect
        .poll(async () => (await announcements(page)).filter(a => a.includes('Personalsystemet svarade inte')))
        .toHaveLength(1);
      await expectNoAxeViolations(page);
      delete api.entitySilent[PRESENCE_LENS];
      await page.getByRole('button', { name: 'Försök igen' }).click();
      await expect(said).toHaveCount(0);
      await expect(row(page, 'Erik Sandström').getByText('Sjuk · dag 1', { exact: true })).toBeVisible();
    });

    test('under a lens whose source does not answer the sentence takes the table’s place', async ({ page, api }) => {
      api.entitySilent[PRESENCE_LENS] = 'unavailable';
      await open(page, `/staff?show=${PRESENCE_LENS}`);
      await expect(page.getByText('Personalsystemet svarade inte.', { exact: true })).toHaveCount(1);
      await expect(page.getByRole('table')).toHaveCount(0);
      await expect(page.getByRole('button', { name: 'Försök igen' })).toBeVisible();
      await expectNoAxeViolations(page);
    });

    test('addresses that drew a person, their cards or a talk over the list lead to the person’s page, the list as the way back', async ({
      page,
      api: _,
    }) => {
      await open(page, `${LENS}&person=johan`);
      await expect(page).toHaveURL(`/people/johan?from=${encodeURIComponent(LENS)}`);
      await expect(page.getByRole('main').getByRole('link', { name: 'Personal', exact: true })).toHaveAttribute(
        'href',
        LENS,
      );
      await open(page, '/staff?cards=johan');
      await expect(page).toHaveURL('/people/johan?section=needs-you&from=%2Fstaff');
      await open(page, '/staff?talk=karin');
      await expect(page).toHaveURL(`/people/karin?section=${TALK_LENS}&from=%2Fstaff`);
    });

    test('someone who manages nobody gets the page’s empty state and the way back', async ({ page, api }) => {
      api.entitiesEmpty = true;
      await open(page, '/staff');
      await expect(page.getByRole('heading', { level: 2, name: 'Inga medarbetare att visa' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Till startsidan' })).toBeVisible();
      await expect(page.getByRole('table')).toHaveCount(0);
      await expect(page.getByRole('searchbox', { name: 'Sök medarbetare' })).toHaveCount(0);
      await expectNoAxeViolations(page);
    });
  });

  test.describe('phone', () => {
    test.use({ viewport: phone });
    test('each unit is a list: the name, the columns’ words, the marks and the menu', async ({ page, api: _ }) => {
      await open(page, '/staff');
      const school = page.getByRole('list', { name: 'Bergsåkers skola' });
      const johan = school.getByRole('listitem').filter({ hasText: 'Johan Byström' });
      await expect(johan.getByRole('link', { name: 'Johan Byström' })).toHaveAttribute(
        'href',
        '/people/johan?from=%2Fstaff',
      );
      await expect(johan.getByText('2 försenade', { exact: true })).toBeVisible();
      await expect(johan.getByRole('link', { name: '1 att agera på' })).toHaveAttribute(
        'href',
        '/items/samtal-svar?from=%2Fstaff',
      );
      await expect(johan.getByRole('button', { name: 'Åtgärder för Johan Byström' })).toBeVisible();
    });
  });

  test.describe('1.4.10 reflow', () => {
    for (const [what, path] of [
      ['Medarbetare', '/staff'],
      ['a lens', LENS],
    ] as const)
      test(`${what} reflows at 320 px`, async ({ page, api: _ }) => {
        await page.setViewportSize(narrow);
        await open(page, path);
        await expect(page.getByRole('list', { name: 'Bergsåkers skola' })).toBeVisible();
        expect(await reflowProblems(page)).toEqual([]);
      });
  });
});
