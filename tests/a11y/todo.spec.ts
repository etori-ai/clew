import {
  announcements,
  answer,
  composer,
  desktop,
  expect,
  expectNoAxeViolations,
  heading,
  open,
  phone,
  test,
} from './support';
import { menuRow } from './phonebook';

/** Wide enough for the panel to stand beside the page's column (D50); at the suite's desktop width it lies over it. */
const wide = { width: 1440, height: 900 };

/**
 * D50: the column is where the person is, the panel is what they hold beside it, and the conversation is never in the
 * panel. Hem is the board (D115 item 4): what needs the person as one list under "Att agera på". A card's state as tabs
 * and the areas as a filter stand on a page of their own, Mina aktiviteter at `/activities`. On both a row opens its
 * card in the panel, which holds only what was opened, while the day and what happened since yesterday stay Hem's own
 * (D72); the box asks about what is open beside it, and the answer opens as a conversation with that beside the
 * transcript.
 */
test.describe("Mina aktiviteter: the day's work by its state", () => {
  test.use({ viewport: desktop });

  test("a card's state is a tab: the tabs speak the tabs pattern, the address names the tab, and each tab has its rows", async ({
    page,
    api: _,
  }) => {
    await open(page, '/activities');
    // The page's own pattern (D115 items 4 and 6): the trail back to the start page, then the title as the one h1.
    const trail = page.getByRole('navigation', { name: 'Du är här' });
    await expect(trail.getByRole('link', { name: 'Startsidan', exact: true })).toHaveAttribute('href', '/');
    await expect(trail.locator('[aria-current="page"]')).toHaveText('Mina aktiviteter');
    await expect(heading(page, 1, 'Mina aktiviteter')).toBeVisible();
    await expect(page.locator('h1:not([aria-level]), [aria-level="1"]')).toHaveCount(1);
    // The box, the key figures and the day are the board's: none of them is repeated here.
    await expect(composer(page)).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Läget' })).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Bredvid' })).toHaveCount(0);
    await expect(page.getByRole('tablist').getByRole('tab')).toHaveCount(4);
    // A tab's count is a badge after its name (artboard A): "Behöver dig 6"; Klart counts what closed today.
    for (const name of [/^Behöver dig 6$/, /^Väntar på andra 2$/, /^Inte nu 1$/, /^Klart 2$/])
      await expect(page.getByRole('tab', { name })).toBeVisible();
    await expect(page.getByRole('tab', { name: /^Behöver dig/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page.getByRole('tabpanel', { name: 'Behöver dig' })).toBeVisible();
    await page.getByRole('tab', { name: /^Väntar/ }).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/activities\?tab=waiting$/);
    const waiting = page.getByRole('tabpanel', { name: 'Väntar på andra' });
    await expect(
      waiting.getByRole('link', { name: 'Tillbud 2026-1182, halkolycka i duschen', exact: true }),
    ).toBeVisible();
    await expect(heading(page, 2, 'Väntar på andra · 2')).toBeVisible();
    await page.getByRole('tab', { name: /^Inte nu/ }).click();
    await expect(page).toHaveURL(/\/activities\?tab=snoozed$/);
    await expect(heading(page, 2, 'Inte nu · 1')).toBeVisible();
    await expect(
      page.getByRole('tabpanel', { name: 'Inte nu' }).getByRole('button', { name: 'Ta upp nu' }),
    ).toBeVisible();
    await page.getByRole('tab', { name: 'Klart' }).click();
    await expect(page).toHaveURL(/\/activities\?tab=done$/);
    await expect(heading(page, 2, 'Redan hanterat')).toBeVisible();
    // Back is the tab before: the address is the state.
    await page.goBack();
    await expect(page.getByRole('tab', { name: /^Inte nu/ })).toHaveAttribute('aria-selected', 'true');
    await expectNoAxeViolations(page);
  });

  test('under Behöver dig the groups keep their headings, each an h2 with its count, and a row opens its card at this address', async ({
    page,
    api,
  }) => {
    // A card with nothing to do and no day is only to know (Till kännedom); the mock has none of its own.
    const base = api.threads.find(t => t.id === 'ledighet')!;
    api.threads = [
      ...api.threads,
      {
        ...base,
        id: 'notis',
        topic: 'notis',
        title: 'Nytt nyhetsbrev från förvaltningen',
        deadline: null,
        actions: [],
        proposals: [],
      },
    ];
    await open(page, '/activities');
    const rows = page.getByRole('tabpanel', { name: 'Behöver dig' });
    // The groups in their order, named regions with a heading each (1.3.1, 2.4.6), the group's rows in a card.
    for (const [name, title] of [
      ['Nu', 'Nu · 1'],
      ['Jag föreslår', 'Jag föreslår · 1'],
      ['Senare', 'Senare · 4'],
      ['Till kännedom', 'Till kännedom · 1'],
    ] as const)
      await expect(rows.getByRole('region', { name, exact: true }).locator('[aria-level="2"]')).toHaveText(title);
    await expect(
      rows.getByRole('region', { name: 'Till kännedom', exact: true }).getByRole('link', {
        name: 'Nytt nyhetsbrev från förvaltningen',
      }),
    ).toBeVisible();
    const title = rows.getByRole('link', { name: 'Omtankesamtal med Anna Lindqvist', exact: true });
    await expect(title).toHaveAttribute('href', '/activities?card=omtanke');
    // A row has its one next step and nothing beside it (D115 item 4).
    await expect(page.locator('#thread-ledighet').getByRole('button')).toHaveText(['Godkänn']);
    // The card opens over the page at this width, a dialog with the focus in it; Esc gives the focus back to the row.
    await title.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/activities\?card=omtanke$/);
    const card = page.getByRole('dialog', { name: 'Kort', exact: true });
    await expect(card.locator('#card-omtanke')).toBeVisible();
    await expect.poll(() => card.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(card).toBeHidden();
    await expect(page).toHaveURL(/\/activities$/);
    await expect(title).toBeFocused();
  });

  test('an address from before the tabs moved leads to the same rows on Mina aktiviteter', async ({ page, api: _ }) => {
    // `/?tab=…` and `/?area=…` were Hem's own (D53); a bookmark or a link in an old notice still lands on the rows.
    await open(page, '/?tab=waiting');
    await expect(page).toHaveURL(/\/activities\?tab=waiting$/);
    await expect(page.getByRole('tab', { name: /^Väntar/ })).toHaveAttribute('aria-selected', 'true');
    await expect(page).toHaveTitle('Mina aktiviteter · Startsidan');
    await open(page, '/?area=personal');
    await expect(page).toHaveURL(/\/activities\?area=personal$/);
    await expect(page.getByRole('button', { name: 'Personal', exact: true })).toBeVisible();
    // The old address is replaced, not stacked: Back does not bounce the person to it again.
    await open(page, '/calendar');
    await page.goto('/?tab=done');
    await expect(page).toHaveURL(/\/activities\?tab=done$/);
    await page.goBack();
    await expect(page).toHaveURL(/\/calendar$/);
  });

  test('the area filter narrows every tab and stays in the address', async ({ page, api: _ }) => {
    await open(page, '/activities?area=personal');
    // The filter is one menu whose button says the chosen area (artboard A: "Alla områden").
    await expect(page.getByRole('button', { name: 'Personal', exact: true })).toBeVisible();
    const rows = page.getByRole('tabpanel', { name: 'Behöver dig' });
    await expect(rows.getByRole('link', { name: 'Omtankesamtal med Anna Lindqvist', exact: true })).toBeVisible();
    await expect(rows.getByRole('link', { name: 'Attestera 3 fakturor, 48 200 kr', exact: true })).toHaveCount(0);
    await page.getByRole('tab', { name: /^Väntar/ }).click();
    await expect(page).toHaveURL(/\/activities\?area=personal&tab=waiting$/);
    await page.getByRole('button', { name: 'Personal', exact: true }).click();
    await page.getByRole('menuitemradio', { name: 'Alla områden' }).click();
    await expect(page).toHaveURL(/\/activities\?tab=waiting$/);
    // The rows changed without a change of page: what is shown now is said aloud (4.1.3).
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Visar alla områden'));
  });
});

test.describe('Hem: what needs the person', () => {
  test.use({ viewport: desktop });

  test('Att agera på is one list in the groups’ order without their headings, with the way to Mina aktiviteter', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    const section = page.getByRole('region', { name: 'Att agera på' });
    // One h2 with the count of everything that needs the person; the tabs and the groups' headings are not on Hem.
    await expect(section.locator('[aria-level="2"]')).toHaveText('Att agera på · 6');
    await expect(page.getByRole('tablist')).toHaveCount(0);
    for (const gone of ['Nu · ', 'Jag föreslår · ', 'Senare · ', 'Till kännedom · '])
      await expect(heading(page, 2, gone)).toHaveCount(0);
    await expect(section.getByRole('listitem')).toHaveCount(6);
    await expect(section.getByRole('list')).toHaveCount(1);
    // What is due comes first, as under Nu, and every row has its one next step and nothing beside it.
    await expect(section.getByRole('listitem').first()).toHaveAttribute('id', 'thread-fakturor');
    for (const row of await section.getByRole('listitem').all())
      expect(await row.getByRole('button').count()).toBeLessThanOrEqual(1);
    await expect(section.getByRole('button', { name: 'Lägg till i samtalet' })).toHaveCount(0);
    // "Visa alla" is reached from the keyboard and leads to the whole list with its tabs, without a page load.
    const all = section.getByRole('link', { name: 'Visa alla', exact: true });
    await expect(all).toHaveAttribute('href', '/activities');
    await expectNoAxeViolations(page);
    await all.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/activities$/);
    await expect(page.getByRole('tab', { name: /^Behöver dig 6$/ })).toHaveAttribute('aria-selected', 'true');
  });

  test('on a phone the threads are rows with the next step under the line, and the card the address names rises in a sheet (D71)', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(phone);
    await open(page, '/');
    const row = page.locator('#thread-ledighet');
    const title = row.getByRole('link', { name: 'Ledighetsansökan från Johan Byström', exact: true });
    const step = row.getByRole('button', { name: 'Godkänn', exact: true });
    expect((await step.boundingBox())!.y).toBeGreaterThan((await title.boundingBox())!.y);
    // The row has its one next step (D115 item 4); "Lägg till i samtalet" is among the open card's buttons.
    await expect(row.getByRole('button')).toHaveCount(1);
    await title.click();
    await expect(page).toHaveURL(/\/\?card=ledighet$/);
    const sheet = page.getByRole('dialog', { name: 'Kort: Ledighetsansökan från Johan Byström' });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByRole('heading', { level: 2, name: 'Ledighetsansökan från Johan Byström' })).toBeVisible();
    await expect(sheet.getByText('Personal', { exact: true })).toBeVisible();
    await expect(sheet.getByRole('button', { name: 'Lägg till i samtalet' })).toBeVisible();
    await expect.poll(() => sheet.evaluate(el => el.contains(document.activeElement))).toBe(true);
    await expectNoAxeViolations(page);
    await sheet.getByRole('button', { name: 'Stäng kortet' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
  });
});

test.describe('the panel beside the page', () => {
  test.use({ viewport: wide });

  test('a row opens its card beside the list: a named region, not a dialog, with the focus on its heading; Esc gives the focus back', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    const title = page.getByRole('link', { name: 'Attestera 3 fakturor, 48 200 kr', exact: true });
    await title.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/\?card=fakturor$/);
    const panel = page.getByRole('complementary', { name: 'Kort' });
    await expect(panel).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(panel.locator('[aria-level="2"]').filter({ hasText: 'Kort' })).toBeFocused();
    // The row is marked as the one whose card is open, and its card has the card's own controls.
    await expect(page.locator('#thread-fakturor')).toHaveAttribute('aria-current', 'true');
    await expect(page.locator('#thread-fakturor')).toContainText('öppet bredvid');
    await expect(panel.locator('#card-fakturor').getByRole('checkbox')).toHaveCount(3);
    await expect(panel.locator('#card-fakturor').getByRole('button', { name: 'Attestera 2 valda' })).toBeVisible();
    await expectNoAxeViolations(page);
    // The list is still in use beside it: another row takes the panel, and the new card is named by its own title.
    await page.getByRole('link', { name: 'Omtankesamtal med Anna Lindqvist', exact: true }).click();
    await expect(panel.locator('#card-omtanke')).toBeVisible();
    await expect(panel.locator('#card-fakturor')).toHaveCount(0);
    // Both stay open (D66): the earlier card waits behind a menu that reads the current card's name and has the focus,
    // ✕ beside it names what it closes, and the card's own buttons, Inte nu among them, stay in the card.
    const openThings = panel.getByRole('navigation', { name: 'Öppet bredvid' });
    const current = openThings.getByRole('button', { name: 'Omtankesamtal med Anna Lindqvist' });
    await expect(current).toHaveAttribute('aria-haspopup', 'menu');
    await expect(current).toBeFocused();
    await expect(panel.getByRole('button', { name: 'Stäng Omtankesamtal med Anna Lindqvist' })).toBeVisible();
    await expect(panel.locator('#card-omtanke').getByRole('button', { name: 'Inte nu', exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    await current.click();
    const list = page.getByRole('menu', { name: '2 öppna bredvid' });
    await expect(list.getByRole('menuitemradio')).toHaveCount(2);
    await expect(list.getByRole('menuitemradio', { name: 'Omtankesamtal med Anna Lindqvist' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expectNoAxeViolations(page);
    await list.getByRole('menuitemradio', { name: 'Attestera 3 fakturor, 48 200 kr' }).click();
    await expect(page).toHaveURL(/\/\?card=fakturor$/);
    await expect(panel.locator('#card-fakturor')).toBeVisible();
    await expect(openThings.getByRole('button', { name: 'Attestera 3 fakturor, 48 200 kr' })).toBeVisible();
    // Esc closes the current card and the other takes its place; with one left the heading is back, and the last Esc empties the panel.
    await page.keyboard.press('Escape');
    await expect(page).toHaveURL(/\/\?card=omtanke$/);
    await expect(panel.locator('#card-omtanke')).toBeVisible();
    await expect(panel.getByRole('navigation', { name: 'Öppet bredvid' })).toHaveCount(0);
    await expect(panel.getByRole('button', { name: 'Stäng panelen' })).toBeVisible();
    await expect(panel.locator('[aria-level="2"]').filter({ hasText: 'Kort' })).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
    // From two open, a menu beside ✕ closes all at once (D66 item 3, revised): the panel empties and the focus goes back to the row that opened it.
    const first = page.getByRole('link', { name: 'Attestera 3 fakturor, 48 200 kr', exact: true });
    await first.click();
    await page.getByRole('link', { name: 'Omtankesamtal med Anna Lindqvist', exact: true }).click();
    await expect(openThings).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Fler val för panelen' })).toHaveCount(1);
    await panel.getByRole('button', { name: 'Fler val för panelen' }).click();
    const closeAll = page.getByRole('menuitem', { name: 'Stäng alla (2)' });
    await expect(closeAll).toBeVisible();
    // The menu fades in: axe measures a colour, so it waits for the one the fade ends on.
    await page.evaluate(() => Promise.all(document.getAnimations().map(animation => animation.finished)));
    await expectNoAxeViolations(page);
    await closeAll.click();
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
    await expect(page.locator('#thread-fakturor')).not.toContainText('öppet bredvid');
    await expect(page.locator('#thread-omtanke')).not.toContainText('öppet bredvid');
    await expect(first).toBeFocused();
  });

  test('beside the page the panel comes with what was opened and folds away and back with the one button on its edge; at rest there is no panel and the day stands beside the work', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/');
    const panel = page.getByRole('complementary', { name: 'Kort' });
    const aside = page.getByRole('complementary', { name: 'Bredvid' });
    const work = page.getByRole('region', { name: 'Att agera på' });
    // The page never scrolls sideways (1.4.10): the folded panel's handle once stood on the window's edge with half of
    // its grab zone past it, which made the shell's main area 8 px wider inside than it shows. The handle is there
    // only while the panel is shown.
    const sideways = () => page.getByRole('main').evaluate(el => el.scrollWidth - el.clientWidth);
    const handle = page.getByRole('separator', { name: 'Ändra panelens bredd' });
    expect(await sideways()).toBe(0);
    await expect(handle).toHaveCount(0);
    // At rest the panel is folded away (D72, revised 2026-11-10): no region for what was opened, the day beside the
    // day's work, and the one button in the page's corner saying the way to the panel.
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Fäll ihop panelen' })).toHaveCount(0);
    const atRest = page.getByRole('button', { name: 'Visa panelen' });
    await expect(atRest).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Öppet bredvid' })).toHaveCount(0);
    await expect(aside.getByRole('region', { name: 'I dag' })).toBeVisible();
    const besideWork = async () => {
      const w = (await work.boundingBox())!,
        a = (await aside.boundingBox())!;
      return a.x >= w.x + w.width;
    };
    expect(await besideWork()).toBe(true);
    // Shown with nothing open the panel says so, with the focus on its heading; Esc folds it and gives the focus to
    // the button, and the day is beside the work again.
    await atRest.click();
    const empty = page.getByRole('complementary', { name: 'Öppet bredvid' });
    await expect(empty.getByRole('heading', { name: 'Inget är öppet bredvid sidan' })).toBeVisible();
    await expect(empty.locator('[aria-level="2"]').filter({ hasText: 'Öppet bredvid' })).toBeFocused();
    await expect(page).toHaveURL(/\/$/);
    await expect(handle).toBeVisible();
    expect(await sideways()).toBe(0);
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(empty).toHaveCount(0);
    await expect(atRest).toBeFocused();
    await expect(handle).toHaveCount(0);
    expect(await sideways()).toBe(0);
    await expect.poll(besideWork).toBe(true);
    // A card opened brings the panel with it alone; the day stays on the page, under the day's work at this width (A2).
    await page.getByRole('link', { name: 'Attestera 3 fakturor, 48 200 kr', exact: true }).click();
    await expect(panel.locator('#card-fakturor').getByRole('button', { name: 'Attestera 2 valda' })).toBeVisible();
    await expect(aside.getByRole('region', { name: 'I dag' })).toBeVisible();
    await expect(aside.getByRole('region', { name: 'Sedan i går' })).toBeVisible();
    expect(await besideWork()).toBe(false);
    // The button floats over the page's top right corner beside the panel's inner edge, outside the panel, so it is
    // there when the panel is folded away, and in a layer of its own, so no column of the page's is kept for it. It
    // stands clear of a scrollbar that takes space (17 px at most) and above the page's header, in the 32 px the page
    // keeps free (D63 item 14, revised 2026-11-10).
    const fold = page.getByRole('button', { name: 'Fäll ihop panelen' });
    await expect(panel.getByRole('button', { name: 'Fäll ihop panelen' })).toHaveCount(0);
    const gap = (await panel.boundingBox())!.x - ((await fold.boundingBox())!.x + (await fold.boundingBox())!.width);
    expect(gap).toBeGreaterThanOrEqual(18);
    expect(gap).toBeLessThanOrEqual(24);
    const foldBox = (await fold.boundingBox())!;
    expect(foldBox.y + foldBox.height).toBeLessThanOrEqual((await page.locator('#hem').boundingBox())!.y);
    expect(await fold.evaluate(el => el.closest(':popover-open') !== null)).toBe(true);
    await expect(handle).toBeVisible();
    expect(await sideways()).toBe(0);
    await fold.click();
    // Folding hides and nothing more (D63 item 14, revised): the address, the row and the box keep the card, and the
    // focus stays on the button, which now says the way back, at the window's edge.
    await expect(panel.locator('#card-fakturor')).toHaveCount(0);
    await expect(page).toHaveURL(/\/\?card=fakturor$/);
    await expect(page.locator('#thread-fakturor')).toContainText('öppet bredvid');
    await expect(page.getByText('Om kortet', { exact: true })).toBeVisible();
    const show = page.getByRole('button', { name: 'Visa panelen' });
    await expect(show).toBeFocused();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Panelen är ihopfälld'));
    // The button stands at the window's edge with the folded panel, the handle is gone and nothing scrolls sideways.
    await expect
      .poll(async () => (await show.boundingBox())!.x + (await show.boundingBox())!.width)
      .toBeGreaterThan(1440 - 40);
    expect((await show.boundingBox())!.x + (await show.boundingBox())!.width).toBeLessThanOrEqual(1440 - 18);
    await expect(handle).toHaveCount(0);
    expect(await sideways()).toBe(0);
    // Showing it again brings the card back with the focus on its heading.
    await show.click();
    await expect(panel.locator('#card-fakturor').getByRole('button', { name: 'Attestera 2 valda' })).toBeVisible();
    await expect(panel.locator('[aria-level="2"]').filter({ hasText: 'Kort' })).toBeFocused();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Panelen visas'));
    await expectNoAxeViolations(page);
    // A card opened while the panel is folded shows the panel again, with the new card in it.
    await fold.click();
    await expect(show).toBeFocused();
    await page.getByRole('link', { name: 'Omtankesamtal med Anna Lindqvist', exact: true }).click();
    await expect(panel.locator('#card-omtanke')).toBeVisible();
    // Closing the last thing removes the panel, and the day steps back up beside the work (D72 item 3).
    await panel.getByRole('button', { name: 'Fler val för panelen' }).click();
    await page.getByRole('menuitem', { name: 'Stäng alla (2)' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Fäll ihop panelen' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Visa panelen' })).toBeVisible();
    await expect(aside.getByRole('region', { name: 'I dag' })).toBeVisible();
    await expect.poll(besideWork).toBe(true);
  });

  test("the card's token in the box has an X that lets go of the card, like Ny fråga i stället", async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await open(page, '/?card=fakturor');
    await page.getByRole('button', { name: 'Ta bort Attestera 3 fakturor, 48 200 kr' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('Om kortet')).toHaveCount(0);
    await expect(page.getByRole('complementary', { name: 'Kort' })).toHaveCount(0);
    await expect(page.locator('#thread-fakturor')).not.toContainText('öppet bredvid');
  });

  test("beside Hem the day and what happened since yesterday are the page's own; a row's card opens in the panel without taking their place, the box asks about the card, and Esc gives it all back", async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    // Beside the day's work (artboard A): the day as a card and what happened since yesterday as a muted card.
    const aside = page.getByRole('complementary', { name: 'Bredvid' });
    await expect(aside.getByRole('region', { name: 'I dag' }).getByText('Rektorsmöte', { exact: true })).toBeVisible();
    const since = aside.getByRole('region', { name: 'Sedan i går' });
    await expect(since.getByText(/^2 klara: attesterade fakturor/)).toBeVisible();
    await expect(since.getByRole('link', { name: 'Allt som är klart' })).toHaveAttribute(
      'href',
      '/activities?tab=done',
    );
    // Nothing in the column repeats what stands beside it.
    await expect(page.getByRole('region', { name: 'I dag' })).toHaveCount(1);
    const title = page.getByRole('link', { name: 'Attestera 3 fakturor, 48 200 kr', exact: true });
    await title.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/\?card=fakturor$/);
    const panel = page.getByRole('complementary', { name: 'Kort' });
    await expect(panel.locator('#card-fakturor').getByRole('button', { name: 'Attestera 2 valda' })).toBeVisible();
    await expect(panel.locator('[aria-level="2"]').filter({ hasText: 'Kort' })).toBeFocused();
    // The day is not the panel's to give way (D72): it stays on the page, one landmark wherever it stands.
    await expect(aside.getByRole('region', { name: 'I dag' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'I dag' })).toHaveCount(1);
    // Hem is still the column, and its box now asks about the card, with the way to a new question beside it (artboard E).
    await expect(heading(page, 1, 'God morgon, Testa!')).toBeVisible();
    await expect(page.getByText('Fråga om kortet Attestera 3 fakturor, 48 200 kr …')).toBeVisible();
    await expect(page.getByText('Om kortet', { exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ny fråga i stället' })).toHaveAttribute('href', '/');
    await expectNoAxeViolations(page);
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(/\/$/);
    await expect(title).toBeFocused();
    await expect(aside).toBeVisible();
    await expect(page.getByRole('link', { name: 'Ny fråga i stället' })).toHaveCount(0);
  });

  test("a card's own read lies over the card: closing the view leaves the card", async ({ page, api: _ }) => {
    await open(page, '/?card=omtanke');
    const card = page.getByRole('complementary', { name: 'Kort' });
    await card.getByRole('button', { name: 'Se mönstret' }).click();
    await expect(page).toHaveURL(/card=omtanke&open-card=omtanke&open-action=pattern$/);
    const view = page.getByRole('complementary', { name: 'Se mönstret' });
    await expect(view).toBeVisible();
    await view.getByRole('button', { name: 'Stäng panelen' }).click();
    await expect(page.getByRole('complementary', { name: 'Kort' }).locator('#card-omtanke')).toBeVisible();
    await expect(page).toHaveURL(/\/\?card=omtanke$/);
  });

  test('the box on Hem asks about the open card: the answer stands under the box, the card stays beside it, and the address stays', async ({
    page,
    api,
  }) => {
    await open(page, '/?card=fakturor');
    await expect(page.getByText('Fråga om kortet Attestera 3 fakturor, 48 200 kr …')).toBeVisible();
    api.answerDelay = 300;
    const box = composer(page);
    await box.fill('Vem är på plats?');
    await box.press('Enter');
    // The answer is a section under the box with its own heading (D115 item 5), at Hem's address, and the card has not
    // moved.
    const reply = page.getByRole('region', { name: 'Svar', exact: true });
    await expect(reply.locator('[aria-level="2"]').filter({ hasText: 'Svar' })).toBeVisible();
    await expect(reply.getByRole('log')).toContainText('Vem är på plats?');
    await expect(page.getByRole('complementary', { name: 'Kort' }).locator('#card-fakturor')).toBeVisible();
    await expect(composer(page)).toBeFocused();
    await expect(answer(page)).toBeVisible();
    await expect(page).toHaveURL(/\/\?card=fakturor$/);
    await expect(page).toHaveTitle('Hem · Startsidan');
    await expect(heading(page, 1, 'God morgon, Testa!')).toBeVisible();
    await expect(reply.getByRole('link', { name: 'Fortsätt i Min AI', exact: true })).toHaveAttribute(
      'href',
      /^\/conversations\/[^/?]+$/,
    );
    await expectNoAxeViolations(page);
    // The card went along as what the question is about.
    expect(api.asked.at(-1)?.chips?.map(c => c.ref)).toEqual(['thread:fakturor']);
    // "Stäng svaret" puts the answer away; the card stays open beside the page, and the focus is not lost (2.4.3).
    await reply.getByRole('button', { name: 'Stäng svaret', exact: true }).click();
    await expect(reply).toHaveCount(0);
    await expect(page).toHaveURL(/\/\?card=fakturor$/);
    await expect(page.getByRole('complementary', { name: 'Kort' }).locator('#card-fakturor')).toBeVisible();
    expect(await page.evaluate(() => document.activeElement !== document.body)).toBe(true);
  });

  test('a view an answer names opens beside the transcript, the conversation stays, and a view that is a tool offers its page', async ({
    page,
    api,
  }) => {
    api.menu = [menuRow];
    await open(page, '/');
    await composer(page).fill('telefonboken lärare');
    await composer(page).press('Enter');
    const log = page.getByRole('log');
    await expect(log).toContainText('Sök i telefonboken: 2 rader.');
    const address = page.url();
    await log.getByRole('button', { name: 'Visa allt' }).click();
    const panel = page.getByRole('complementary', { name: 'Sök i telefonboken' });
    await expect(panel.getByRole('searchbox')).toHaveValue('lärare');
    // Beside the transcript a table is its list: the panel is as narrow as a phone.
    await expect(panel.getByRole('table')).toHaveCount(0);
    await expect(panel.getByRole('listitem').filter({ hasText: 'Anna Lindqvist' })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(page.url().startsWith(address)).toBe(true);
    await expect(log).toContainText('Sök i telefonboken: 2 rader.');
    await expect(panel.getByRole('heading', { level: 2, name: 'Sök i telefonboken' })).toBeFocused();
    await expectNoAxeViolations(page);
    await expect(panel.getByRole('link', { name: 'Öppna som sida' })).toHaveAttribute(
      'href',
      /^\/tools\/phonebook\.directory\?input=/,
    );
    // The box is in use while the panel is open, and typing there never loses the panel.
    await composer(page).fill('Vem är på plats?');
    await composer(page).press('Enter');
    await expect(answer(page)).toBeVisible();
    await expect(panel).toBeVisible();
    // Esc in the panel lets go of the panel, not of the conversation.
    await panel.getByRole('searchbox').focus();
    await page.keyboard.press('Escape');
    await expect(panel).toHaveCount(0);
    await expect(answer(page)).toBeVisible();
  });

  test("the panel on a tool's page asks about the page, and Min AI takes the conversation on", async ({
    page,
    api,
  }) => {
    api.menu = [menuRow];
    const input = encodeURIComponent(JSON.stringify({ query: 'lärare' }));
    await open(page, `/tools/phonebook.directory?input=${input}`);
    // A tool's page has no box of its own (D115 item 5): the floating Fråga AI asks about what the page shows.
    await expect(composer(page)).toHaveCount(0);
    await page.getByRole('button', { name: 'Fråga AI', exact: true }).click();
    const panel = page.getByRole('dialog', { name: 'Fråga AI', exact: true });
    await expect(panel.getByText('Fråga om Telefonbok …', { exact: true })).toBeVisible();
    await composer(page).fill('Vem är på plats?');
    await composer(page).press('Enter');
    await expect(
      panel.locator('.astryx-chat-message-bubble').filter({ hasText: 'Tio personer är på plats i dag.' }),
    ).toBeVisible();
    expect(api.asked.at(-1)?.chips?.map(c => c.ref)).toEqual(['capability:phonebook.directory']);
    // The page and its search stay under the panel.
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory\?input=/);
    await expectNoAxeViolations(page);
    // "Fortsätt i Min AI" opens the same conversation in its own place, and the panel is closed.
    await panel.getByRole('link', { name: 'Fortsätt i Min AI', exact: true }).click();
    await expect(page).toHaveURL(/\/conversations\/[^/?]+$/);
    await expect(panel).toBeHidden();
    await expect(page.locator('h1:not([aria-level]), [aria-level="1"]')).toHaveCount(1);
    await expect(page.getByRole('log')).toContainText('Vem är på plats?');
    await expect(answer(page)).toBeVisible();
    await expect(composer(page)).toHaveAccessibleName('Svara i samtalet');
    await expectNoAxeViolations(page);
  });
});

test.describe('asking from a page on a narrower screen', () => {
  test.use({ viewport: desktop });

  test('the answer stays in the panel over the page: one dialog, the view went along as a chip, and a card it is about is a link', async ({
    page,
    api,
  }) => {
    api.menu = [menuRow];
    await open(page, '/tools/phonebook.directory');
    const ask = page.getByRole('button', { name: 'Fråga AI', exact: true });
    await ask.click();
    const panel = page.getByRole('dialog', { name: 'Fråga AI', exact: true });
    await composer(page).fill('Vem är på plats?');
    await composer(page).press('Enter');
    await expect(answer(page)).toBeVisible();
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory$/);
    await expect(page.getByRole('dialog')).toHaveCount(1);
    expect(api.asked.at(-1)?.chips?.map(c => c.ref)).toEqual(['capability:phonebook.directory']);
    // The panel draws no card (D115 item 5): a card an answer is about is a link to it on the start page.
    await composer(page).fill('attestera en faktura');
    await composer(page).press('Enter');
    await expect(panel.getByRole('link', { name: 'Attestera 3 fakturor, 48 200 kr', exact: true })).toHaveAttribute(
      'href',
      '/?card=fakturor',
    );
    await expect(panel.getByRole('article', { name: /^Kort:/ })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('a question on the landing after a closed conversation starts a new one', async ({ page, api }) => {
    await open(page, '/');
    await composer(page).fill('Vem är på plats?');
    await composer(page).press('Enter');
    await expect(answer(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(answer(page)).toBeHidden();
    await composer(page).fill('Vem är på plats?');
    await composer(page).press('Enter');
    await expect(answer(page).first()).toBeVisible();
    // Neither question named a conversation to continue (the mock answers both under one id, so both turns are drawn).
    expect(api.asked.map(a => a.conversationId ?? null)).toEqual([null, null]);
  });
});

/**
 * D97 item 6, artboards M and N: a card row that names a person is a link to them, in the source's own words. From Hem
 * the person opens as their page with Hem's address (the card still open beside it) as the way back.
 */
test.describe('a card row that names a person', () => {
  test.use({ viewport: wide });

  test('the name is a link in the order the card is read, it leads to the person, and Back returns to the card', async ({
    page,
    api,
  }) => {
    api.threads = api.threads.map(t =>
      t.id === 'omtanke'
        ? {
            ...t,
            items: [
              {
                ref: 'hr:person:anna',
                label: 'Anna Lindqvist',
                detail: 'Tre sjukperioder sedan juni',
                selectable: false,
                selected: false,
                subject: { entity: 'person', key: 'anna' },
              },
            ],
          }
        : t,
    );
    await open(page, '/?card=omtanke');
    const card = page.getByRole('complementary', { name: 'Kort' }).locator('#card-omtanke');
    const name = card.getByRole('link', { name: 'Anna Lindqvist', exact: true });
    await expect(name).toHaveAttribute('href', '/people/anna?from=%2F%3Fcard%3Domtanke');
    await expect(card.getByText('Tre sjukperioder sedan juni')).toBeVisible();
    await expectNoAxeViolations(page);
    // From the card's heading the name comes before the card's next step.
    await card.getByRole('heading', { name: 'Omtankesamtal med Anna Lindqvist' }).focus();
    const order: string[] = [];
    for (let i = 0; i < 12 && !order.includes('Boka samtalet'); i++) {
      await page.keyboard.press('Tab');
      order.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''));
    }
    expect(order.indexOf('Anna Lindqvist')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('Anna Lindqvist')).toBeLessThan(order.indexOf('Boka samtalet'));
    await name.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/people\/anna\?from=%2F%3Fcard%3Domtanke$/);
    await expect(heading(page, 1, 'Anna Lindqvist')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/\?card=omtanke$/);
    await expect(page.getByRole('complementary', { name: 'Kort' }).locator('#card-omtanke')).toBeVisible();
  });

  test('a row the person ticks keeps its checkbox, named by the row, and the name inside it is a link of its own', async ({
    page,
    api,
  }) => {
    const base = api.threads.find(t => t.id === 'fakturor')!;
    api.threads = [
      {
        ...base,
        id: 'sjuk',
        topic: 'sjuk',
        title: 'Sjukanmälan att godkänna',
        connector: 'hr',
        area: 'personal',
        summary: 'Personalsystemet tog emot en sjukanmälan.',
        items: [
          {
            ref: 'hr:sick:1',
            label: 'Erik Sandström',
            detail: 'sjuk 10–11 nov · 2 pass berörs',
            selectable: true,
            selected: true,
            subject: { entity: 'person', key: 'erik' },
          },
        ],
        actions: [
          {
            id: 'approve',
            label: 'Godkänn',
            capability: 'hr.approveSick',
            kind: 'execute',
            role: 'primary',
            usesItems: true,
          },
        ],
      },
      ...api.threads,
    ];
    await open(page, '/?card=sjuk');
    const card = page.getByRole('complementary', { name: 'Kort' }).locator('#card-sjuk');
    const box = card.getByRole('checkbox', { name: /Erik Sandström/ });
    await expect(box).toBeChecked();
    const name = card.getByRole('link', { name: 'Erik Sandström', exact: true });
    await expect(name).toHaveAttribute('href', '/people/erik?from=%2F%3Fcard%3Dsjuk');
    await expectNoAxeViolations(page);
    // Pressing the link leads away; it does not tick the row.
    await name.click();
    await expect(page).toHaveURL(/\/people\/erik\?/);
    await page.goBack();
    await expect(card.getByRole('checkbox', { name: /Erik Sandström/ })).toBeChecked();
  });
});
