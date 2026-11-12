import type { Page } from '@playwright/test';
import { menuRows } from './phonebook';
import {
  answer,
  composer,
  desktop,
  expect,
  expectNoAxeViolations,
  focused,
  hiddenFocusStops,
  open,
  snoozeFirst,
  test,
} from './support';
import { mergedSearch } from './unit-data';

test.use({ viewport: desktop });

/**
 * Inte nu on the first row of Att göra, from the keyboard (D111 item 3): the row opens its work item in the reading pane
 * beside the list, with the focus on its heading, where Inte nu stands among the card's own buttons.
 */
async function openSnoozeRows(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('list', { name: 'Behöver dig' }).getByRole('link').first().focus();
  await page.keyboard.press('Enter');
  const panel = page.getByRole('complementary', { name: 'Valt ärende' });
  await expect(panel.getByRole('heading', { level: 2, name: 'Attestera 3 fakturor, 48 200 kr' })).toBeFocused();
  await panel.getByRole('button', { name: 'Inte nu', exact: true }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('menuitem', { name: /^I morgon/ })).toBeVisible();
}

test.describe('2.4.7 focus visible', () => {
  for (const path of ['/', '/todo', '/todo?tab=done', '/calendar'])
    test(`every stop on ${path} shows a focus ring`, async ({ page, api: _ }) => {
      await open(page, path);
      const { unmarked } = await hiddenFocusStops(page);
      expect(unmarked).toEqual([]);
    });

  test('a row that receives focus from the page shows it', async ({ page, api: _ }) => {
    await open(page, '/todo');
    await openSnoozeRows(page);
    await page.getByRole('menuitem', { name: /^I morgon/ }).focus();
    await page.keyboard.press('Enter');
    // The item left its pile: the next row's link takes the focus, and the ring is drawn on it or the row around it.
    const next = page.locator('#work-omtanke').getByRole('link');
    await expect(next).toBeFocused();
    expect(
      await next.evaluate(el => {
        for (let at: Element | null = el, depth = 0; at && depth < 4; at = at.parentElement, depth++) {
          const s = getComputedStyle(at);
          if ((s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || (at === el && s.boxShadow !== 'none'))
            return true;
        }
        return false;
      }),
    ).toBe(true);
  });
});

test.describe('2.4.3 focus order', () => {
  test('regaining the window keeps focus where it was', async ({ page, api }) => {
    await open(page, '/');
    const row = page.locator('#work-fakturor').getByRole('link');
    await row.focus();
    api.sessionDelay = 200;
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
    await page.waitForTimeout(350);
    await expect(row).toBeFocused();
  });

  test('a row leads to its work item in the pane, and gets the focus back when the pane closes', async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo');
    const title = 'Omtankesamtal med Anna Lindqvist';
    const row = page.locator('#work-omtanke');
    const expand = row.getByRole('link');
    await expect(row).not.toHaveAttribute('aria-current', 'true');
    await expand.focus();
    await page.keyboard.press('Enter');
    // Beside the list at this width (the page's box is 1000 px): a region named for what it holds, the focus on the item.
    const panel = page.getByRole('complementary', { name: 'Valt ärende' });
    await expect(panel.getByRole('heading', { name: title })).toBeFocused();
    await expect(page).toHaveURL(/\/todo\?item=omtanke$/);
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(expand).toBeFocused();
    await expect(row).not.toHaveAttribute('aria-current', 'true');
  });

  test('Inte nu moves focus to the next row instead of losing it', async ({ page, api: _ }) => {
    await open(page, '/todo');
    await openSnoozeRows(page);
    await page.getByRole('menuitem', { name: /^I morgon/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('region', { name: 'Aviseringar' })).toBeVisible();
    await expect(page.locator('#work-omtanke').getByRole('link')).toBeFocused();
  });

  test('Ångra in the toast stays available and reachable by keyboard', async ({ page, api: _ }) => {
    await page.clock.install({ time: new Date('2026-11-04T08:00:00.000Z') });
    // At 1440 px the item stands beside the list, so the whole page stays reachable after Inte nu.
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/todo');
    await snoozeFirst(page);
    const undo = page.getByRole('button', { name: 'Ångra' });
    await expect(undo).toBeVisible();
    await page.clock.fastForward('00:30');
    await expect(undo, 'the toast has no time limit (2.2.1)').toBeVisible();
    const { stops } = await hiddenFocusStops(page);
    expect(
      stops.some(stop => stop.includes('Ångra')),
      'the Tab order reaches the toast',
    ).toBe(true);
    await undo.focus();
    await page.keyboard.press('Enter');
    // The item is back in its pile.
    await expect(page.getByRole('list', { name: 'Behöver dig' }).locator('#work-fakturor')).toBeVisible();
  });

  test('the side panel can be closed with a button and hands focus back', async ({ page, api }) => {
    // A row on a tool's page opens its own view over the page at this width (D50); closing it gives the row's link back.
    api.menu = menuRows;
    await open(page, '/tools/phonebook.directory');
    const trigger = page.getByRole('link', { name: 'Anna Lindqvist' });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const panel = page.getByRole('dialog');
    await expect(panel).toBeVisible();
    await panel.getByRole('button', { name: 'Stäng panelen' }).click();
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test('Esc closes the conversation and focus stays in the row', async ({ page, api: _ }) => {
    await open(page, '/');
    const input = composer(page);
    await input.fill('Vem är på plats?');
    await input.press('Enter');
    await expect(answer(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(answer(page)).toBeHidden();
    await expect(input).toBeFocused();
  });
});

test.describe('D26 a source becomes a chip', () => {
  test("Lägg till i samtalet in the sources view beside a conversation puts the passage in the box's drawer and says so on the row", async ({
    page,
    api: _,
  }) => {
    // Beside a conversation's own box (D111 item 7): elsewhere the sources view has its own box in the panel.
    await open(
      page,
      '/conversations/fraga?open=clew.search&open-title=K%C3%A4llor&open-input=%7B%22query%22%3A%22fall%22%7D',
    );
    const panel = page.getByRole('dialog');
    const add = panel
      .getByRole('list', { name: 'Källor' })
      .getByRole('listitem')
      .nth(0)
      .getByRole('button', { name: 'Lägg till i samtalet' });
    await add.focus();
    await page.keyboard.press('Enter');
    await expect(panel.getByRole('button', { name: 'I samtalet', exact: true })).toHaveCount(1);
    await panel.getByRole('button', { name: 'Stäng' }).click();
    await expect(
      page
        .getByRole('group', { name: 'Objekt i samtalet' })
        .or(page.getByText('Rutin vid fall i ordinärt boende').first()),
    ).toBeVisible();
  });
});

test.describe('D29 the Inte nu picker', () => {
  test('every row says when the card comes back, and the free text has a label and a live answer', async ({
    page,
    api: _,
  }) => {
    // The work item's one time action stands among its buttons in Att göra's reading pane.
    await open(page, '/todo?item=fakturor');
    await page.getByRole('button', { name: 'Inte nu', exact: true }).first().click();
    const menu = page.getByRole('menu');
    await expect(menu).toBeVisible();
    for (const row of [
      'Om en timme',
      'Efter lunch',
      'I morgon',
      'Nästa vecka',
      'När jag är tillbaka från Ledningsgrupp',
    ])
      await expect(menu.getByRole('menuitem', { name: new RegExp('^' + row) })).toBeVisible();
    await expect(menu.getByText('06:00 · i genomgången')).toBeVisible();
    await menu.getByRole('menuitem', { name: /^Skriv själv/ }).click();
    // The card is open in the panel, a dialog too at this width: the picker's own dialog is the one meant.
    const dialog = page.getByRole('dialog', { name: 'När ska jag ta upp det igen?' });
    await expect(dialog).toBeVisible();
    const field = dialog.getByRole('textbox', { name: 'När?' });
    await field.fill('fredag kl 9');
    await expect(dialog.getByRole('button', { name: /^Ta upp fre 09:00/ })).toBeEnabled();
    await field.fill('när grisarna flyger');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByRole('button', { name: /^Ta upp/ })).toBeDisabled();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect((await focused(page)).text).toBe('Inte nu');
  });
});

test.describe('D97 a hit about a person', () => {
  test('one hit per person, its name a link to them, the sources that answered at the end of its line, and no axe violations', async ({
    page,
    api: _,
  }) => {
    // No source answers a subject on a hit yet: the suite's search does, merged from two sources (artboard P).
    await page.route('**/api/cap/clew.search*', route => route.fulfill({ json: { output: mergedSearch } }));
    const input = encodeURIComponent(JSON.stringify({ query: 'byström' }));
    await open(page, `/?open=clew.search&open-title=K%C3%A4llor&open-input=${input}`);
    const hits = page.getByRole('dialog').getByRole('list', { name: 'Källor' }).getByRole('listitem');
    await expect(hits).toHaveCount(2);
    const person = hits.nth(0);
    const name = person.getByRole('link', { name: 'Johan Byström', exact: true });
    // Hem with the search open beside it is the way back.
    await expect(name).toHaveAttribute('href', /^\/people\/johan\?from=%2F%3Fopen%3Dclew\.search%26/);
    await expect(person.getByText('Telefonboken · Personalsystemet', { exact: true })).toBeVisible();
    // The hit leads to the person instead of one source's record: no contact card, no link out.
    await expect(person.getByRole('link', { name: 'Kontaktkort' })).toHaveCount(0);
    await expect(person.getByRole('link', { name: /Öppna/ })).toHaveCount(0);
    // On Hem the panel asks about the sources in its own box: no hit goes into a conversation from here (D111 item 7).
    await expect(person.getByRole('button', { name: 'Lägg till i samtalet' })).toHaveCount(0);
    // A document from one source is drawn as before.
    const document = hits.nth(1);
    await expect(document.getByRole('link', { name: 'Öppna' })).toHaveAttribute(
      'href',
      'https://intra.example/rutin-samtal',
    );
    await expect(document.getByText(/^Intranätet · HR-avdelningen/)).toBeVisible();
    await expectNoAxeViolations(page);
    await name.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/people\/johan\?from=/);
    await expect(page.getByRole('heading', { level: 1, name: 'Johan Byström' })).toBeVisible();
  });
});
