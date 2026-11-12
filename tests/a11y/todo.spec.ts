import {
  announcements,
  answer,
  composer,
  desktop,
  expect,
  expectNoAxeViolations,
  heading,
  open,
  test,
} from './support';
import { menuRow } from './phonebook';

/** Wide enough for the panel to stand beside the page's column (D50); at the suite's desktop width it lies over it. */
const wide = { width: 1440, height: 900 };
/** Hem's box as it is with nothing added: also with a card open beside it (D111 rule 6). */
const HEM_PLACEHOLDER = 'Skriv eller säg vad du vill göra …';

/**
 * D50: the column is where the person is, the panel is what they hold beside it, and the conversation is never in the
 * panel. A work item opened from Att göra is in its reading pane (D112 item 3, `queue.spec.ts`); the card is drawn
 * there as it is drawn everywhere, so its own reads and its rows' links are tested here, in the pane. Opening is not
 * asking (D111 rule 6): a card goes into the box only with "Lägg till i samtalet", where a box is on the page.
 */
test.describe('the panel beside the page', () => {
  test.use({ viewport: wide });

  test('beside the page the panel comes with what was opened and folds away and back with the one button on its edge; at rest there is no panel', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    const panel = page.getByRole('complementary', { name: 'Bemanning' });
    // The page never scrolls sideways (1.4.10): the folded panel's handle once stood on the window's edge with half of
    // its grab zone past it, which made the shell's main area 8 px wider inside than it shows. The handle is there
    // only while the panel is shown.
    const sideways = () => page.getByRole('main').evaluate(el => el.scrollWidth - el.clientWidth);
    const handle = page.getByRole('separator', { name: 'Ändra panelens bredd' });
    expect(await sideways()).toBe(0);
    await expect(handle).toHaveCount(0);
    // At rest the panel is folded away (D72, revised 2026-11-10): no region for what was opened, and the one button in
    // the page's corner saying the way to the panel.
    await expect(page.getByRole('button', { name: 'Fäll ihop panelen' })).toHaveCount(0);
    const atRest = page.getByRole('button', { name: 'Visa panelen' });
    await expect(atRest).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Öppet bredvid' })).toHaveCount(0);
    // Shown with nothing open the panel says so, with the focus on its heading; Esc folds it and gives the focus to
    // the button.
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
    // A view opened brings the panel with it alone.
    await open(page, '/?open=hr.whoIsOn&open-title=Bemanning');
    await expect(panel).toBeVisible();
    // The button floats over the page's top right corner beside the panel's inner edge, outside the panel, so it is
    // there when the panel is folded away, and in a layer of its own, so no column of the page's is kept for it. It
    // stands clear of a scrollbar that takes space (17 px at most), in the 32 px the page keeps free (D63 item 14,
    // revised 2026-11-10).
    const fold = page.getByRole('button', { name: 'Fäll ihop panelen' });
    await expect(panel.getByRole('button', { name: 'Fäll ihop panelen' })).toHaveCount(0);
    const gap = (await panel.boundingBox())!.x - ((await fold.boundingBox())!.x + (await fold.boundingBox())!.width);
    expect(gap).toBeGreaterThanOrEqual(18);
    expect(gap).toBeLessThanOrEqual(24);
    expect(await fold.evaluate(el => el.closest(':popover-open') !== null)).toBe(true);
    await expect(handle).toBeVisible();
    expect(await sideways()).toBe(0);
    await fold.click();
    // Folding hides and nothing more (D63 item 14, revised): the address keeps the view, the box is as it was
    // (opening is not asking, D111 rule 6), and the focus stays on the button, which now says the way back, at the
    // window's edge.
    await expect(panel).toHaveCount(0);
    await expect(page).toHaveURL(/\/\?open=hr\.whoIsOn&open-title=Bemanning$/);
    await expect(page.getByText(HEM_PLACEHOLDER, { exact: true })).toBeVisible();
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
    // Showing it again brings the view back with the focus on its heading.
    await show.click();
    await expect(panel).toBeVisible();
    await expect(panel.getByRole('heading', { level: 2, name: 'Bemanning' })).toBeFocused();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('Panelen visas'));
    await expectNoAxeViolations(page);
    // Closing what it holds removes the panel, and the button stays.
    await panel.getByRole('button', { name: 'Stäng panelen' }).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(panel).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Fäll ihop panelen' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Visa panelen' })).toBeVisible();
  });

  test('opening a card leaves the box as it was; Lägg till i samtalet puts it in, with its verbs, and its X lets go of the chip, not of the card', async ({
    page,
    api: _,
  }) => {
    // The card's verbs, so the test sees when they show: only for the chip, never for the card merely open (D111 rule 6).
    await page.route('**/api/threads/fakturor/verbs', route =>
      route.fulfill({ json: { verbs: [{ id: 'why', label: 'Varför nu?', kind: 'why', threadId: 'fakturor' }] } }),
    );
    // Beside a conversation, where a box is on the page (Hem holds no card since D112: its cards are Att göra's).
    await open(page, '/conversations/fraga?card=fakturor');
    const panel = page.getByRole('complementary', { name: 'Ärende' });
    const card = panel.locator('#card-fakturor');
    await expect(card.getByRole('button', { name: 'Attestera 2 valda' })).toBeVisible();
    // Opening is not asking: no token and no verbs about the card.
    await expect(page.getByText(/^Fråga om ärendet/)).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Objekt i samtalet' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Om ärendet' })).toHaveCount(0);
    expect(await announcements(page)).not.toContainEqual(expect.stringContaining('Om ärendet'));
    // "Lägg till i samtalet" is the one way in: the chip enters the drawer, the box has the focus, the chip is said aloud,
    // and with nothing typed the card's verbs are offered under the box.
    await card.getByRole('button', { name: 'Lägg till i samtalet' }).click();
    const remove = page.getByRole('button', { name: 'Ta bort Attestera 3 fakturor, 48 200 kr' });
    await expect(remove).toBeVisible();
    await expect(composer(page)).toBeFocused();
    await expect(page.getByRole('status').filter({ hasText: 'är med i samtalet' })).toContainText(
      'Attestera 3 fakturor, 48 200 kr är med i samtalet',
    );
    await expect(card.getByRole('button', { name: 'I samtalet' })).toBeDisabled();
    await expect(
      page.getByRole('group', { name: 'Om ärendet' }).getByRole('button', { name: 'Varför nu?' }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    // The chip's X lets go of the chip and gives the focus to the field; the card stays open beside the conversation.
    await remove.click();
    await expect(remove).toHaveCount(0);
    await expect(composer(page)).toBeFocused();
    await expect(page.getByRole('group', { name: 'Om ärendet' })).toHaveCount(0);
    await expect(page).toHaveURL(/\/conversations\/fraga\?card=fakturor$/);
    await expect(card.getByRole('button', { name: 'Lägg till i samtalet' })).toBeVisible();
  });

  test("a card's own read unfolds inside the card under its buttons, is said aloud, survives a reload and folds again", async ({
    page,
    api,
  }) => {
    api.cardReadDelay = 400;
    await open(page, '/todo?item=omtanke');
    const card = page.getByRole('complementary', { name: 'Valt ärende' });
    const button = card.locator('[data-read="pattern"]');
    await expect(button).toHaveAccessibleName('Se mönstret');
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    await button.click();
    // The address says which read is unfolded, in place of the one before: Back is not a step through every fold.
    await expect(page).toHaveURL(/\/todo\?item=omtanke&open-card=omtanke&open-action=pattern$/);
    const section = card.locator('#read-card-omtanke');
    // While the read is on its way the section holds its shape, and the focus stays on the button.
    await expect(section.locator('[aria-busy="true"]')).toBeVisible();
    await expect(button).toBeFocused();
    await expect(section.getByText('Anna Lindqvist 07:00–16:00')).toBeVisible();
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    await expect(button).toHaveAttribute('aria-controls', 'read-card-omtanke');
    await expect
      .poll(async () => (await announcements(page)).filter(a => a === 'Se mönstret visas i ärendet.'))
      .toHaveLength(1);
    // The card stays whole around it: its title, its decision, and nothing has taken its place in the panel.
    await expect(card.getByRole('article', { name: 'Ärende: Omtankesamtal med Anna Lindqvist' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Boka samtalet' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Se mönstret' })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expectNoAxeViolations(page);
    // A reload is the same card with the same read unfolded.
    await page.reload();
    await expect(section.getByText('Anna Lindqvist 07:00–16:00')).toBeVisible();
    await expect(button).toHaveAttribute('aria-expanded', 'true');
    // The section's own toggle folds it, and the focus goes to the button that unfolded it.
    await section.getByRole('button', { name: 'Se mönstret' }).click();
    await expect(page).toHaveURL(/\/todo\?item=omtanke$/);
    await expect(section).toHaveCount(0);
    await expect(button).toBeFocused();
    await expect(button).toHaveAttribute('aria-expanded', 'false');
    // The button unfolds it again and folds it again; the card stays where it is all along.
    await button.click();
    await expect(section.getByText('Anna Lindqvist 07:00–16:00')).toBeVisible();
    await button.click();
    await expect(section).toHaveCount(0);
    await expect(page).toHaveURL(/\/todo\?item=omtanke$/);
    await expect(button).toBeFocused();
  });

  test("a card's read that fails says so in the card with Försök igen, one that answers with an address opens a tab and unfolds nothing, and one declared as a link out says so", async ({
    page,
    api,
  }) => {
    api.cardReadFails = true;
    await open(page, '/todo?item=omtanke&open-card=omtanke&open-action=pattern');
    const card = page.getByRole('complementary', { name: 'Valt ärende' });
    const section = card.locator('#read-card-omtanke');
    await expect(section.getByText('Källan svarade inte.')).toBeVisible();
    await expect
      .poll(async () => (await announcements(page)).filter(a => a === 'Källan svarade inte.'))
      .toHaveLength(1);
    await expect(card.getByRole('button', { name: 'Boka samtalet' })).toBeVisible();
    await expectNoAxeViolations(page);
    api.cardReadFails = false;
    await section.getByRole('button', { name: 'Försök igen' }).click();
    await expect(section.getByText('Anna Lindqvist 07:00–16:00')).toBeVisible();
    // A read that answers with an address is a way out: a new tab once, and the card stays folded.
    await open(page, '/todo?item=omtanke');
    api.cardReads.pattern = { output: { url: 'https://hr.example.test/franvaro/anna' } };
    await page.evaluate(() => {
      const opened: string[] = [];
      Object.assign(window, { opened });
      window.open = (url?: string | URL) => {
        opened.push(String(url));
        return null;
      };
    });
    await card.locator('[data-read="pattern"]').click();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as { opened: string[] }).opened))
      .toEqual(['https://hr.example.test/franvaro/anna']);
    await expect(page).toHaveURL(/\/todo\?item=omtanke$/);
    await expect(section).toHaveCount(0);
    await expect(card.locator('[data-read="pattern"]')).toBeFocused();
    await expect
      .poll(async () => (await announcements(page)).filter(a => a.includes('öppnades i en ny flik')))
      .toHaveLength(1);
    // A read declared as a link out (`target: 'link'`) says on its button that it leaves Clew, in the words Astryx's own
    // link out says (D111 rule 8).
    await open(page, '/todo?item=fakturor');
    await expect(card.getByRole('button', { name: /^Öppna i ekonomisystemet\s*\(öppnas i ny flik\)$/ })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a view an answer names opens beside the transcript, the conversation stays, and a view that is a tool offers no page', async ({
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
    // No control chooses a surface (D111 rule 7): the tool is in the rail where an administrator put it.
    await expect(panel.getByText('Öppna som sida')).toHaveCount(0);
    await expect(panel.locator('a[href^="/tools/"]')).toHaveCount(0);
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

  test("Fråga Clew on a tool's page asks about the page in the panel; the conversation goes on with the view beside it, searched as it was", async ({
    page,
    api,
  }) => {
    api.menu = [menuRow];
    await open(page, `/tools/phonebook.directory?input=${encodeURIComponent(JSON.stringify({ query: 'lärare' }))}`);
    // The tool's page asks with "Fråga Clew" in its header (D112 item 7): no box at its foot.
    await expect(composer(page)).toHaveCount(0);
    await page.getByRole('main').getByRole('link', { name: 'Fråga Clew' }).click();
    const panel = page.getByRole('complementary', { name: 'Telefonbok' });
    const box = panel.getByRole('textbox', { name: 'Fråga Clew' });
    await box.fill('Vem är på plats?');
    await box.press('Enter');
    await expect(panel.getByText('Tio personer är på plats i dag.')).toBeVisible();
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory\?/);
    await expect(box).toBeFocused();
    expect(api.asked.at(-1)?.chips?.map(c => c.ref)).toEqual(['capability:phonebook.directory']);
    await expectNoAxeViolations(page);
    // "Fortsätt som samtal" leads to the conversation with the view beside it, searched as it was on the page.
    await panel.getByRole('link', { name: 'Fortsätt som samtal' }).click();
    await expect(page).toHaveURL(
      /\/conversations\/[^/?]+\?open=phonebook\.directory&open-title=Telefonbok&open-input=/,
    );
    await expect(page.getByRole('complementary', { name: 'Telefonbok' }).getByRole('searchbox')).toHaveValue('lärare');
    await expect(answer(page)).toBeVisible();
  });
});

test.describe('asking from a page on a narrower screen', () => {
  test.use({ viewport: desktop });

  test("the tool's page asks in the drawer over it, with the view as the question's subject", async ({ page, api }) => {
    api.menu = [menuRow];
    await open(page, '/tools/phonebook.directory');
    await page.getByRole('main').getByRole('link', { name: 'Fråga Clew' }).click();
    const drawer = page.getByRole('dialog', { name: 'Telefonbok' });
    const box = drawer.getByRole('textbox', { name: 'Fråga Clew' });
    await box.fill('Vem är på plats?');
    await box.press('Enter');
    await expect(drawer.getByText('Tio personer är på plats i dag.')).toBeVisible();
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory\?ask=1$/);
    expect(api.asked.at(-1)?.chips?.map(c => c.ref)).toEqual(['capability:phonebook.directory']);
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
 * D97 item 6, artboards M and N: a card row that names a person is a link to them, in the source's own words. From Att
 * göra the person opens as their page with Att göra's address (the item still in the reading pane) as the way back.
 */
test.describe('a card row that names a person', () => {
  test.use({ viewport: wide });

  test('the name is a link in the order the item is read, it leads to the person, and Back returns to the item', async ({
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
    await open(page, '/todo?item=omtanke');
    const card = page.getByRole('complementary', { name: 'Valt ärende' }).locator('#card-omtanke');
    const name = card.getByRole('link', { name: 'Anna Lindqvist', exact: true });
    await expect(name).toHaveAttribute('href', '/people/anna?from=%2Ftodo%3Fitem%3Domtanke');
    await expect(card.getByText('Tre sjukperioder sedan juni')).toBeVisible();
    await expectNoAxeViolations(page);
    // From the item's heading the keyboard reaches its buttons in the header, then the name in its rows (board WorkItem).
    await card.getByRole('heading', { name: 'Omtankesamtal med Anna Lindqvist' }).focus();
    const order: string[] = [];
    for (let i = 0; i < 16 && !order.includes('Anna Lindqvist'); i++) {
      await page.keyboard.press('Tab');
      order.push(await page.evaluate(() => document.activeElement?.textContent?.trim() ?? ''));
    }
    expect(order.indexOf('Boka samtalet')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('Boka samtalet')).toBeLessThan(order.indexOf('Anna Lindqvist'));
    await name.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/people\/anna\?from=%2Ftodo%3Fitem%3Domtanke$/);
    await expect(heading(page, 1, 'Anna Lindqvist')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(/\/todo\?item=omtanke$/);
    await expect(page.getByRole('complementary', { name: 'Valt ärende' }).locator('#card-omtanke')).toBeVisible();
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
    await open(page, '/todo?item=sjuk');
    const card = page.getByRole('complementary', { name: 'Valt ärende' }).locator('#card-sjuk');
    const box = card.getByRole('checkbox', { name: /Erik Sandström/ });
    await expect(box).toBeChecked();
    const name = card.getByRole('link', { name: 'Erik Sandström', exact: true });
    await expect(name).toHaveAttribute('href', '/people/erik?from=%2Ftodo%3Fitem%3Dsjuk');
    await expectNoAxeViolations(page);
    // Pressing the link leads away; it does not tick the row.
    await name.click();
    await expect(page).toHaveURL(/\/people\/erik\?/);
    await page.goBack();
    await expect(card.getByRole('checkbox', { name: /Erik Sandström/ })).toBeChecked();
  });
});
