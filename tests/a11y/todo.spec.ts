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
/** The rule the absence pattern's detail view states (`hr.absencePattern`, as the HR connector answers it). */
const RULE = 'Rutin 4.2: samtal inom två veckor efter tredje korta frånvaron på sex månader.';

/** Wide enough for a pane to stand beside the queue or the conversation (D126 rule 2). */
const wide = { width: 1440, height: 900 };

/**
 * One page per thing (D126 rules 1 to 3): nothing lies beside or over a page, and a pane exists in two places only,
 * beside Att göra's queue and beside a conversation. A work item opened from Att göra is in its reading pane
 * (`queue.spec.ts`); the item is drawn there as it is drawn everywhere, so its own reads and its rows' links are tested
 * here, in the pane. The item beside a conversation goes with every question and is never put in the box; a card an
 * answer draws goes into the box with "Lägg till i samtalet".
 */
test.describe('the panes beside the queue and the conversation', () => {
  test.use({ viewport: wide });

  test('nothing stands beside Hem and nothing scrolls sideways; an address that opened a view beside it leads to the view’s page, and Back returns to Hem', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    // The page never scrolls sideways (1.4.10), and there is no panel, no handle and no button for one (rule 3).
    const sideways = () => page.getByRole('main').evaluate(el => el.scrollWidth - el.clientWidth);
    expect(await sideways()).toBe(0);
    await expect(page.getByRole('complementary')).toHaveCount(0);
    await expect(page.getByRole('button', { name: /panelen/ })).toHaveCount(0);
    await expect(page.getByRole('separator', { name: 'Ändra panelens bredd' })).toHaveCount(0);
    await expect(composer(page)).toBeVisible();
    // An address from before D126 that held a view beside Hem is the view's own page in its place, Hem its way back.
    await open(page, '/?open=hr.whoIsOn&open-title=Bemanning');
    await expect(page).toHaveURL(/^[^?]*\/tools\/hr\.whoIsOn\?/);
    await expect(heading(page, 1, 'Bemanning')).toBeVisible();
    await expect(page.getByRole('complementary')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(await sideways()).toBe(0);
    await expectNoAxeViolations(page);
    const back = page
      .getByRole('main')
      .getByRole('link', { name: /Hem|Startsidan/ })
      .first();
    await expect(back).toHaveAttribute('href', '/');
    await back.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/$/);
    await expect(composer(page)).toBeVisible();
  });

  test('the item beside a conversation is not put in the box: it has no Lägg till i samtalet; a card an answer draws has, with its verbs, and its X lets go of the chip', async ({
    page,
    api,
  }) => {
    // The card's verbs, so the test sees when they show: only for the chip, never for the card merely open (D111 rule 6).
    await page.route('**/api/threads/fakturor/verbs', route =>
      route.fulfill({ json: { verbs: [{ id: 'why', label: 'Varför nu?', kind: 'why', threadId: 'fakturor' }] } }),
    );
    // Beside a conversation, where a box is on the page (Hem holds no card since D112: its cards are Att göra's).
    await open(page, '/conversations/fraga?card=omtanke');
    // The pane beside a conversation is named by the thing it holds (D126 rule 2).
    const panel = page.getByRole('complementary', { name: 'Omtankesamtal med Anna Lindqvist' });
    await expect(panel.getByRole('button', { name: 'Boka samtalet' })).toBeVisible();
    // The item in the pane is what the conversation is about: it goes with every question, the assistant is told it
    // stands open there, and nothing puts it in the box. No token and no verbs about it either.
    await expect(panel.getByRole('button', { name: 'Lägg till i samtalet' })).toHaveCount(0);
    await expect(page.getByText(/^Fråga om ärendet/)).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Objekt i samtalet' })).toHaveCount(0);
    await expect(page.getByRole('group', { name: 'Om ärendet' })).toHaveCount(0);
    expect(await announcements(page)).not.toContainEqual(expect.stringContaining('Om ärendet'));
    // A question goes with the item in the pane, and says that it is the thing open beside the transcript.
    await composer(page).fill('Vad ska jag attestera?');
    await composer(page).press('Enter');
    const card = page.getByRole('log').locator('#thread-fakturor');
    await expect(card.getByRole('button', { name: 'Attestera 2 valda' })).toBeVisible();
    expect(api.asked.at(-1)).toMatchObject({ chips: [{ ref: 'thread:omtanke' }], beside: 'thread:omtanke' });
    // On a card an answer draws, "Lägg till i samtalet" is the way into the box: the chip enters the drawer, the box
    // has the focus, the chip is said aloud, and with nothing typed the card's verbs are offered under the box.
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
    // The chip's X lets go of the chip and gives the focus to the field; the item stays open beside the conversation.
    await remove.click();
    await expect(remove).toHaveCount(0);
    await expect(composer(page)).toBeFocused();
    await expect(page.getByRole('group', { name: 'Om ärendet' })).toHaveCount(0);
    await expect(page).toHaveURL(/\/conversations\/fraga\?card=omtanke$/);
    await expect(card.getByRole('button', { name: 'Lägg till i samtalet' })).toBeVisible();
  });

  test("a work item's own read is a link to the read's page under Fler åtgärder, with the queue and the item as the way back, and Back returns to the item", async ({
    page,
    api: _,
  }) => {
    await open(page, '/todo?item=omtanke');
    const pane = page.getByRole('complementary', { name: 'Valt ärende' });
    // Nothing unfolds inside the item (D126 rule 3): the read is a row of the item's menu that is a link to its page.
    await expect(pane.locator('[aria-controls^="read-card-"]')).toHaveCount(0);
    const more = pane.getByRole('button', { name: 'Fler åtgärder' });
    await more.click();
    const read = page.getByRole('menu', { name: 'Fler åtgärder' }).getByRole('menuitem', { name: 'Se mönstret' });
    await expect(read).toHaveAttribute('href', /^\/tools\/hr\.absencePattern\?.*from=%2Ftodo%3Fitem%3Domtanke/);
    await expectNoAxeViolations(page);
    await read.click();
    // The read's own page: its title, its rows, the queue with the item as its way back, and nothing over it.
    await expect(page).toHaveURL(/^[^?]*\/tools\/hr\.absencePattern\?/);
    // A `detail` view's page is headed by its record's title (D116), here the employee the pattern is about.
    await expect(heading(page, 1, 'Anna Lindqvist')).toBeVisible();
    await expect(page.getByRole('main').getByText(RULE, { exact: true })).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(
      page
        .getByRole('main')
        .getByRole('link', { name: /Att göra/ })
        .first(),
    ).toHaveAttribute('href', '/todo?item=omtanke');
    await expectNoAxeViolations(page);
    // Back is the queue with the item in its pane, as it was.
    await page.goBack();
    await expect(page).toHaveURL(/\/todo\?item=omtanke$/);
    await expect(pane.getByRole('heading', { name: 'Omtankesamtal med Anna Lindqvist' })).toBeVisible();
  });

  test("an address that unfolded a read in the item leads to the read's page, which says when its source does not answer and reads again with Försök igen; a read declared as a link out says so", async ({
    page,
    api: _,
  }) => {
    let fails = true;
    await page.route('**/api/cap/hr.absencePattern*', route =>
      fails
        ? route.fulfill({ status: 400, json: { error: 'Personalsystemet svarar inte just nu.' } })
        : route.fallback(),
    );
    // An address from before D126 (`open-card`, `open-action`) is the read's page in its place: never a decision.
    await open(page, '/todo?item=omtanke&open-card=omtanke&open-action=pattern');
    await expect(page).toHaveURL(/^[^?]*\/tools\/hr\.absencePattern\?/);
    const main = page.getByRole('main');
    await expect(main.getByText('Personalsystemet svarar inte just nu.')).toBeVisible();
    await expectNoAxeViolations(page);
    fails = false;
    await main.getByRole('button', { name: 'Försök igen' }).click();
    await expect(main.getByText(RULE, { exact: true })).toBeVisible();
    // A read declared as a link out (`target: 'link'`) says on its row that it leaves Clew, in the words Astryx's own
    // link out says (D111 rule 8).
    await open(page, '/todo?item=fakturor');
    const pane = page.getByRole('complementary', { name: 'Valt ärende' });
    const out = pane
      .getByRole('button', { name: /^Öppna i ekonomisystemet\s*\(öppnas i ny flik\)$/ })
      .or(pane.getByRole('link', { name: /^Öppna i ekonomisystemet\s*\(öppnas i ny flik\)$/ }));
    if (!(await out.first().isVisible())) await pane.getByRole('button', { name: 'Fler åtgärder' }).click();
    await expect(
      out.or(page.getByRole('menuitem', { name: /^Öppna i ekonomisystemet\s*\(öppnas i ny flik\)$/ })).first(),
    ).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a list an answer names is its page, under the tool’s name where it is one, and Back returns to the conversation as it was (D116)', async ({
    page,
    api,
  }) => {
    api.menu = [menuRow];
    await open(page, '/conversations/new');
    await composer(page).fill('telefonboken lärare');
    await composer(page).press('Enter');
    const log = page.getByRole('log');
    await expect(log).toContainText('Sök i telefonboken: 2 rader.');
    const conversation = new URL(page.url()).pathname;
    // "Visa allt" is a link to the list's page, with the conversation as the way back: no panel beside the transcript.
    const all = log.getByRole('link', { name: 'Visa allt' });
    await expect(all).toHaveAttribute(
      'href',
      new RegExp(
        `^/tools/phonebook\\.directory\\?input=.*&from=${encodeURIComponent(conversation).replace(/\./g, '\\.')}$`,
      ),
    );
    await all.click();
    await expect(page).toHaveURL(/\/tools\/phonebook\.directory\?input=/);
    await expect(page.getByRole('complementary')).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const main = page.getByRole('main');
    // The directory is a tool in the menu: its page carries the tool's name and the menu's button is named by it.
    await expect(main.locator('h1:not([aria-level]), [aria-level="1"]')).toHaveText('Telefonbok');
    await expect(
      page
        .getByRole('navigation', { name: 'Mina sidor', exact: true })
        .getByRole('button', { name: 'Telefonbok', exact: true }),
    ).toBeVisible();
    await expect(main.getByRole('searchbox')).toHaveValue('lärare');
    await expect(main.getByRole('table')).toBeVisible();
    await expect(main.getByRole('link', { name: 'Samtalet' })).toHaveAttribute('href', conversation);
    await expectNoAxeViolations(page);
    // Back is the conversation as it was, with the focus on the link that led away.
    await page.goBack();
    await expect(page).toHaveURL(conversation);
    await expect(log).toContainText('Sök i telefonboken: 2 rader.');
    await expect(log.getByRole('link', { name: 'Visa allt' })).toBeFocused();
  });
});

test.describe('asking from a page on a narrower screen', () => {
  test.use({ viewport: desktop });

  test('a question on the landing after its answer’s card is closed starts a new conversation', async ({
    page,
    api,
  }) => {
    // The answer stands in a card under Hem's line (D138 item 9); Stäng takes it away and leaves the conversation.
    const card = page.getByRole('main').getByRole('region', { name: 'Vem är på plats?', exact: true });
    await open(page, '/');
    await composer(page).fill('Vem är på plats?');
    await composer(page).press('Enter');
    await expect(card.getByRole('log')).toContainText('Tio personer är på plats i dag.');
    await card.getByRole('button', { name: 'Stäng' }).click();
    await expect(card).toHaveCount(0);
    await composer(page).fill('Vem är på plats?');
    await composer(page).press('Enter');
    await expect(card.getByRole('log')).toContainText('Tio personer är på plats i dag.');
    // Neither question named a conversation to continue.
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
    const name = card.getByRole('region', { name: 'Rader' }).getByRole('link', { name: 'Anna Lindqvist', exact: true });
    await expect(name).toHaveAttribute('href', '/people/anna?from=%2Ftodo%3Fitem%3Domtanke');
    // The item's facts name whom it is about too (D126 rule 1, "Berör"), with the same link to the same page.
    await expect(
      card.getByRole('definition').getByRole('link', { name: 'Anna Lindqvist', exact: true }),
    ).toHaveAttribute('href', '/people/anna?from=%2Ftodo%3Fitem%3Domtanke');
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
    const name = card.getByRole('region', { name: 'Rader' }).getByRole('link', { name: 'Erik Sandström', exact: true });
    await expect(name).toHaveAttribute('href', '/people/erik?from=%2Ftodo%3Fitem%3Dsjuk');
    await expectNoAxeViolations(page);
    // Pressing the link leads away; it does not tick the row.
    await name.click();
    await expect(page).toHaveURL(/\/people\/erik\?/);
    await page.goBack();
    await expect(card.getByRole('checkbox', { name: /Erik Sandström/ })).toBeChecked();
  });
});
