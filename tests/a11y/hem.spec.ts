import type { Locator, Page } from '@playwright/test';
import type { Thread } from '@clew/contracts';
import {
  SITE,
  announcements,
  composer,
  desktop,
  expect,
  expectNoAxeViolations,
  heading,
  hemLine,
  narrow,
  open,
  openTools,
  pagesNav,
  phone,
  reflowProblems,
  silentSaidIn,
  test,
  workRowLines,
  type MockApi,
} from './support';
import {
  CERTIFICATE_TITLE,
  ENTITY_UNIT,
  NEWS_LINK,
  NOW,
  asNotice,
  expiredCertificate,
  newsMenuRow,
  newsOutput,
  user,
} from './data';
import { menuRows } from './phonebook';
import { Units } from './unit-data';

/**
 * Hem (D126, D130, boards Hem and HemFraga): the greeting and the day, one line to ask Clew, the item that asks for a
 * read receipt as one focus card, "Läget på <enhet>" for a manager, and then two columns: "Behöver dig" with the
 * person's action points under it, and beside them "I dag" with "Nyheter" under it. No tool tiles, no digest sentence,
 * no suggestion chips, nothing beside or over the page: every row and tile leads to the page of what it names, with
 * Hem as the way back.
 */
const rail = pagesNav;
const needs = (page: Page) => page.getByRole('region', { name: 'Behöver dig' });
const today = (page: Page) => page.getByRole('region', { name: 'I dag' });
const lage = (page: Page) => page.getByRole('region', { name: `Läget på ${user.unitLabel}` });
const news = (page: Page) => page.getByRole('region', { name: 'Nyheter' });
/** The focus card (D130 item 13): a region named by the item it lifts, its heading. */
const callout = (page: Page) => page.getByRole('main').locator('section[aria-labelledby="fokusnyhet"]');
const toasts = (page: Page) => page.getByRole('region', { name: 'Aviseringar' });
/** Hem's line's own button, beside the field. */
const askButton = (page: Page) => page.getByRole('main').getByRole('button', { name: 'Fråga AI', exact: true });
/** The answer under Hem's line (D138 item 9): a region named by the question, its heading. */
const answerCard = (page: Page, question: string) =>
  page.getByRole('main').getByRole('region', { name: question, exact: true });
/** The suite's clock stands at 09:00 in Stockholm on Wednesday 4 November (`NOW`). */
const GREETING = 'God morgon, Testa';

/** "Ny rutin för läkemedelshantering" as the communication fixture pushes it now: a notice with its read receipt. */
const receiptItem = (api: MockApi, id = 'rutin', over: Partial<Thread> = {}): Thread =>
  asNotice(
    api.threads.find(t => t.id === 'rutin')!,
    id,
    over,
  );
/** Everything the board draws: a receipt to give, news from two sources, two tools in the menu. */
function everything(api: MockApi) {
  api.threads = api.threads.map(t => (t.id === 'rutin' ? receiptItem(api) : t));
  api.news = newsOutput();
  api.menu = menuRows;
}
/** The headings of the page's main column in reading order, each with the level assistive technology gets. */
const headingsOf = (page: Page) =>
  page
    .getByRole('main')
    .locator('h1, h2, h3, h4, h5, h6, [role="heading"]')
    .evaluateAll(list =>
      [...new Set(list)]
        .filter(el => (el as HTMLElement).checkVisibility())
        .map(el => ({
          level: Number(el.getAttribute('aria-level') ?? el.tagName.slice(1)),
          text: (el.textContent ?? '').trim(),
        })),
    );
const box = async (l: Locator) => (await l.boundingBox())!;

test.describe('Hem', () => {
  test.use({ viewport: desktop });

  test('the greeting, the line to ask Clew, the focus card, Läget, then Behöver dig beside I dag with Nyheter under it, in one heading order and nothing else', async ({
    page,
    api,
  }) => {
    everything(api);
    await open(page, '/');
    await expect(heading(page, 1, GREETING)).toBeVisible();
    await expect(
      page.getByRole('main').getByText(new RegExp(`^Onsdag 4 november\\s·\\s${user.unitLabel}$`)),
    ).toBeVisible();
    await expect(hemLine(page)).toHaveCount(1);
    await expect(callout(page)).toBeVisible();
    // The focus card under the line, Läget under it, then the two columns: Behöver dig, and beside it I dag with
    // Nyheter under it (D130 item 13).
    const b = await box(hemLine(page)),
      lifted = await box(callout(page)),
      n = await box(needs(page)),
      d = await box(today(page)),
      l = await box(lage(page)),
      w = await box(news(page));
    expect(lifted.y).toBeGreaterThan(b.y + b.height);
    expect(l.y).toBeGreaterThan(lifted.y + lifted.height);
    expect(n.y).toBeGreaterThan(l.y + l.height);
    expect(Math.abs(d.y - n.y)).toBeLessThan(2);
    expect(d.x).toBeGreaterThanOrEqual(n.x + n.width);
    expect(Math.abs(w.x - d.x)).toBeLessThan(2);
    expect(w.y).toBeGreaterThan(d.y + d.height);
    // One h1, then the blocks' h2s in the board's order, never a level skipped (the critique found h1 to h3).
    const headings = await headingsOf(page);
    expect(headings[0]).toEqual({ level: 1, text: GREETING });
    for (const [i, h] of headings.entries())
      if (i > 0)
        expect(h.level, `${h.text} after ${headings[i - 1]!.text}`).toBeLessThanOrEqual(headings[i - 1]!.level + 1);
    const at = (text: string | RegExp) =>
      headings.findIndex(h => (typeof text === 'string' ? h.text === text : text.test(h.text)));
    const order = [
      at('Ny rutin för läkemedelshantering'),
      at(/^Läget på /),
      at('Behöver dig'),
      at(/^Mina åtgärdspunkter/),
      at('I dag'),
      at('Nyheter'),
    ];
    expect(order.every(i => i > 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    // Gone from Hem (D126 rule 8): the tool tiles, the digest, the errands and what the person ordered (tools in the
    // menu), the chips, and anything beside the page.
    await expect(page.getByRole('region', { name: 'Verktygslådan' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Mina ärenden' })).toHaveCount(0);
    await expect(page.getByRole('region', { name: 'Sedan i går' })).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Beställningar och felanmälningar' })).toHaveCount(0);
    await expect(page.getByText(/Anpassa startsidan/)).toHaveCount(0);
    await expect(page.getByRole('complementary')).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('Behöver dig: the most urgent rows, each with one link to its item’s page with Hem as the way back, the count and Visa alla', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    const block = needs(page);
    const rows = block.getByRole('listitem');
    await expect(rows).toHaveCount(4);
    for (const i of [0, 1, 2, 3]) await expect(rows.nth(i).getByRole('link')).toHaveCount(1);
    // How many need the person in all, beside the heading, and the way to all of them in Att göra.
    await expect(block.getByText(/^·\s*7\s*behöver dig$/)).toBeVisible();
    await expect(block.getByRole('link', { name: 'Visa alla' })).toHaveAttribute('href', '/todo');
    const fakturor = block.getByRole('link', { name: /^Öppna Attestera 3 fakturor/ });
    await expect(fakturor).toHaveAttribute('href', '/items/fakturor?from=%2F');
    await expectNoAxeViolations(page);
    // A row leads to the item's page, never beside Hem (D126 rule 1), and Back returns to Hem.
    await fakturor.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/items/fakturor?from=%2F');
    await expect(page.getByRole('heading', { level: 1, name: /^Attestera 3 fakturor/ })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Ärende', exact: true })).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL('/');
    await expect(heading(page, 1, GREETING)).toBeVisible();
  });

  test('Behöver dig: an item with nothing to decide says the source’s reason as its badge, once, and never Försenad (D139)', async ({
    page,
    api,
  }) => {
    api.threads.push(expiredCertificate());
    await open(page, '/');
    const row = needs(page).getByRole('listitem').filter({ hasText: CERTIFICATE_TITLE });
    await expect(row.getByRole('link', { name: `Öppna ${CERTIFICATE_TITLE}` })).toHaveAttribute(
      'href',
      '/items/intyg?from=%2F',
    );
    await expect(row.locator('.astryx-badge')).toHaveText('Har gått ut');
    await expect(row.getByText('Har gått ut', { exact: true })).toHaveCount(1);
    await expect(row).not.toContainText(/försenad/i);
    await expect(row).not.toContainText('Ska göras');
    await expectNoAxeViolations(page);
  });
  test('an address that opened something beside Hem before leads to that thing’s page', async ({ page, api: _ }) => {
    await open(page, '/?card=ledighet');
    await expect(page).toHaveURL('/items/ledighet?from=%2F');
    await expect(page.getByRole('heading', { level: 1, name: /^Ledighetsansökan från Johan Byström/ })).toBeVisible();
    await open(page, '/?open=finance.budget&open-title=Budget+mot+prognos');
    await expect(page).toHaveURL('/tools/finance.budget?title=Budget+mot+prognos&from=%2F');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('Nyheter: the three newest, each row one target, a link out marked as leaving, one in Clew to its page, and Alla nyheter', async ({
    page,
    api,
  }) => {
    api.news = newsOutput();
    await open(page, '/');
    const block = news(page);
    await expect(block.getByRole('heading', { name: 'Nyheter' })).toBeVisible();
    const rows = block.getByRole('listitem');
    await expect(rows).toHaveCount(3);
    // The headline is the row's one link; the sender and the day are its supporting line.
    await expect(rows.nth(0)).toContainText('Nytt lönesystem från årsskiftet');
    await expect(rows.nth(0)).toContainText('4 nov. · HR');
    await expect(rows.nth(1)).toContainText('3 nov. · Barn och utbildning');
    await expect(rows.nth(2)).toContainText('2 nov. · Kommunledningen');
    await expect(block.getByText('Enkät om matsalen')).toHaveCount(0);
    for (const i of [0, 1, 2]) await expect(rows.nth(i).getByRole('link')).toHaveCount(1);
    // A link out of Clew says so in its name and opens a new tab (D111 rule 8).
    const out = rows.nth(0).getByRole('link');
    await expect(out).toHaveAccessibleName(/^Nytt lönesystem från årsskiftet\s*\(öppnas i ny flik\)$/);
    await expect(out).toHaveAttribute('href', NEWS_LINK);
    await expect(out).toHaveAttribute('target', '_blank');
    // A row that opens in Clew is not marked, and a press anywhere on the row follows its link: the item's page.
    const inClew = rows.nth(1).getByRole('link');
    await expect(inClew).toHaveAccessibleName('Så fungerar vinterns skolskjuts');
    await expect(inClew).toHaveAttribute('href', /^\/tools\/communication\.newsItem\?.*from=%2F$/);
    await expectNoAxeViolations(page);
    await rows.nth(1).getByText('3 nov. · Barn och utbildning').click();
    await expect(page).toHaveURL(/\/tools\/communication\.newsItem\?.*from=%2F$/);
    await expect(page.getByRole('dialog')).toHaveCount(0);

    // Alla nyheter: the joined list as a tool's page, there whether or not an administrator placed it in the menu.
    await open(page, '/');
    const all = news(page).getByRole('link', { name: 'Alla nyheter' });
    await expect(all).toHaveAttribute('href', '/tools/clew.news');
    await all.click();
    await expect(page).toHaveURL(/\/tools\/clew\.news$/);
    await expect(heading(page, 1, 'Nyheter')).toBeVisible();
    await expect(page.getByRole('main').getByText('Enkät om matsalen')).toBeVisible();
    await expect(rail(page).getByRole('link', { name: 'Nyheter' })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('Alla nyheter placed in the menu by an administrator is a tool like any other, named by the menu’s button on its page', async ({
    page,
    api,
  }) => {
    api.news = newsOutput();
    api.menu = [newsMenuRow, ...menuRows];
    await open(page, '/');
    const row = (await openTools(page)).getByRole('menuitem', { name: 'Nyheter' });
    await expect(row).toHaveAttribute('href', '/tools/clew.news');
    await row.click();
    await expect(heading(page, 1, 'Nyheter')).toBeVisible();
    await expect(rail(page).getByRole('button', { name: 'Nyheter', exact: true })).toBeVisible();
  });

  test('without a news source there is no Nyheter block, no error, and I dag stands alone in its column', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await expect(news(page)).toHaveCount(0);
    await expect(page.getByRole('heading', { name: 'Nyheter' })).toHaveCount(0);
    const n = await box(needs(page)),
      d = await box(today(page));
    expect(Math.abs(d.y - n.y)).toBeLessThan(2);
    expect(d.x).toBeGreaterThanOrEqual(n.x + n.width);
    // Alla nyheter by its address says there is none, as a tool that is not the person's does.
    await open(page, '/tools/clew.news');
    await expect(heading(page, 1, 'Inga nyheter för dig')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Till startsidan' })).toHaveAttribute('href', '/');
    await expectNoAxeViolations(page);
  });

  test('Fokusnyhet: the item that asks for a read receipt, with Läs to its page and its own Jag har läst, announced and then gone', async ({
    page,
    api,
  }) => {
    everything(api);
    await open(page, '/');
    const lifted = callout(page);
    await expect(lifted).toContainText('Ny rutin för läkemedelshantering');
    // What it is and when it was published over the headline, and under it who published it and what it asks.
    await expect(lifted).toContainText('Fokusnyhet · 3 november');
    await expect(lifted.getByRole('heading', { level: 2, name: 'Ny rutin för läkemedelshantering' })).toBeVisible();
    await expect(lifted).toContainText('Kommunikation · läskvitto krävs');
    // Läs leads to the item's page, as every row on Hem does (D126 rule 1).
    await expect(lifted.getByRole('link', { name: 'Läs', exact: true })).toHaveAttribute(
      'href',
      '/items/rutin?from=%2F',
    );
    // The lifted item is not a row under the blocks too.
    await expect(needs(page).locator('#work-rutin')).toHaveCount(0);
    await expectNoAxeViolations(page);
    // The item's own action, one press: nothing to fill in, nothing asked.
    const ack = lifted.getByRole('button', { name: 'Jag har läst' });
    await ack.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => api.acted.map(a => [a.threadId, a.body.actionId])).toEqual([['rutin', 'ack']]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The receipt is said, and the focus is not left on nothing.
    await expect(toasts(page).getByText(/^Läskvittot är registrerat\. Ärendet ligger under Klart\./)).toBeVisible();
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Läskvittot är registrerat. Ärendet ligger under Klart.'));
    await expect(hemLine(page)).toBeFocused();
    // Once the receipt has had its moment the callout is gone, and nothing takes its place.
    await expect(callout(page)).toHaveCount(0, { timeout: 10_000 });
    await expect(needs(page).locator('#work-rutin')).toHaveCount(0);
  });

  test('Läs leads to the notice’s page, and Back returns to Hem', async ({ page, api }) => {
    everything(api);
    await open(page, '/');
    const read = callout(page).getByRole('link', { name: 'Läs', exact: true });
    await read.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/items/rutin?from=%2F');
    await expect(page.getByRole('heading', { level: 1, name: 'Ny rutin för läkemedelshantering' })).toBeVisible();
    await expect(page.getByRole('complementary', { name: 'Ärende', exact: true })).toHaveCount(0);
    await page.goBack();
    await expect(page).toHaveURL('/');
    await expect(callout(page)).toBeVisible();
  });

  test('with several items that ask for a receipt the most urgent is the callout and the rest are rows; with none, nothing is drawn', async ({
    page,
    api,
  }) => {
    // Only the two receipts are open: the one due tomorrow is the more urgent.
    const open1 = receiptItem(api, 'rutin');
    const open2 = receiptItem(api, 'brandrutin', {
      title: 'Ny brandskyddsrutin',
      deadline: '2026-11-05',
      trigger: {
        reason: 'Nytt meddelande från förvaltningen',
        source: 'Kommunikation',
        at: '2026-11-04T07:00:00.000Z',
      },
    });
    api.threads = [...api.threads.filter(t => t.state !== 'open'), open1, open2];
    await open(page, '/');
    await expect(callout(page)).toContainText('Ny brandskyddsrutin');
    await expect(callout(page)).not.toContainText('Ny rutin för läkemedelshantering');
    await expect(needs(page).locator('#work-rutin')).toBeVisible();
    await expect(needs(page).locator('#work-brandrutin')).toHaveCount(0);
    await expect(callout(page).getByRole('button', { name: 'Jag har läst' })).toHaveCount(1);

    // The same items without the mark are ordinary work items: no callout.
    api.threads = api.threads.map(t => ({ ...t, actions: t.actions.map(({ acknowledgement: _a, ...a }) => a) }));
    await open(page, '/');
    await expect(callout(page)).toHaveCount(0);
    await expect(needs(page).locator('#work-brandrutin')).toBeVisible();
  });
});

/**
 * Hem's line (D126 items 4 and 9, board HemFraga variant a): one field, labelled "Fråga assistenten", filling the row under the
 * greeting, and the button "Fråga AI" (D130). Enter or the button asks the question, and the answer stands in a card
 * under the line while Hem stays (D138 items 2 and 9); with nothing written the button opens Ny fråga and Enter does
 * nothing. Whom to ask, the model and `@` are the conversation page's box's.
 */
test.describe('Hem’s line', () => {
  test.use({ viewport: desktop });

  test('a labelled field and Fråga AI side by side; Enter asks once, and the answer stands in a card under the line while Hem stays', async ({
    page,
    api,
  }) => {
    const release = api.holdAnswer();
    await open(page, '/');
    const line = hemLine(page);
    await expect(line).toHaveAttribute('placeholder', 'Vad vill du göra?');
    // The field fills the row and the button stands at its end, on the same line (board HemFraga a).
    const f = await box(line),
      b = await box(askButton(page));
    expect(Math.abs(f.y + f.height / 2 - (b.y + b.height / 2))).toBeLessThan(2);
    expect(b.x).toBeGreaterThanOrEqual(f.x + f.width);
    expect(f.width).toBeGreaterThan(b.width * 3);
    // None of the box's controls on Hem: no recipient, no model, no `@` (the box on the conversation page has them).
    await expect(page.getByRole('button', { name: /^Till: / })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Modell: / })).toHaveCount(0);
    await expect(page.getByRole('combobox', { name: 'Vad vill du göra' })).toHaveCount(0);
    await expectNoAxeViolations(page);
    // Enter with nothing written does nothing.
    await line.focus();
    await page.keyboard.press('Enter');
    await expect(line).toBeFocused();
    await expect(page).toHaveURL(/\/$/);
    expect(api.asked).toHaveLength(0);
    // Two Enters in the same moment send the question once.
    await line.fill('Vem är på plats?');
    await line.evaluate(el => {
      for (let i = 0; i < 2; i++) el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    });
    // The answer's card stands under the line with the question as its heading (D138 item 9): Hem stays, with its
    // greeting over the line and its board under the card, and the focus stays in the line.
    const card = answerCard(page, 'Vem är på plats?');
    await expect(card.getByRole('heading', { level: 2, name: 'Vem är på plats?', exact: true })).toBeVisible();
    await expect(page).toHaveURL('/');
    await expect(heading(page, 1, GREETING)).toBeVisible();
    await expect(line).toBeFocused();
    const [l, c, n] = [await box(line), await box(card), await box(needs(page))];
    expect(c.y).toBeGreaterThanOrEqual(l.y + l.height);
    expect(n.y).toBeGreaterThanOrEqual(c.y + c.height);
    // On its way the log is busy, and the conversation has no page to open yet.
    const log = card.getByRole('log');
    await expect(log).toHaveAttribute('aria-busy', 'true');
    await expect(card.getByRole('link', { name: 'Öppna som samtal' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Stäng' })).toBeVisible();
    release();
    await expect(log).toContainText('Tio personer är på plats i dag.');
    await expect(log).not.toHaveAttribute('aria-busy', 'true');
    await expect(page).toHaveURL('/');
    await expect(card.getByRole('link', { name: 'Öppna som samtal' })).toHaveAttribute(
      'href',
      '/conversations/konversation',
    );
    expect(api.asked).toHaveLength(1);
    // Clew answers a question asked on the line itself (`own`), in a new conversation.
    expect(api.asked[0]).toMatchObject({ text: 'Vem är på plats?', chips: [], own: true });
    expect(api.asked[0]!.conversationId).toBeUndefined();
    await expectNoAxeViolations(page);
  });

  test('with nothing written the button opens Ny fråga, where the pages mark Samtal; a question half written stays through a visit elsewhere, and the button asks it under the line', async ({
    page,
    api,
  }) => {
    await open(page, '/');
    const ask = askButton(page);
    // It has a valid action with an empty field, so it is not drawn as disabled.
    await expect(ask).toBeEnabled();
    await expect(ask).not.toHaveAttribute('aria-disabled', 'true');
    await ask.click();
    await expect(page).toHaveURL(/\/conversations\/new$/);
    await expect(page.getByRole('combobox', { name: 'Vad vill du göra' })).toBeFocused();
    await expect(rail(page).getByRole('link', { name: 'Samtal', exact: true })).toHaveAttribute('aria-current', 'page');
    expect(api.asked).toHaveLength(0);
    await page.goBack();
    await expect(heading(page, 1, GREETING)).toBeVisible();
    // Either home link keeps the question half written while the person looks at another page.
    await hemLine(page).fill('Vem är på plats?');
    for (const home of [
      rail(page).getByRole('link', { name: 'Start', exact: true }),
      page.getByRole('banner').getByRole('link', { name: SITE }),
    ]) {
      await rail(page)
        .getByRole('link', { name: /^Att göra/ })
        .click();
      await expect(page.getByRole('heading', { level: 1, name: 'Att göra' })).toBeVisible();
      await home.click();
      await expect(hemLine(page)).toHaveValue('Vem är på plats?');
    }
    await askButton(page).click();
    const card = answerCard(page, 'Vem är på plats?');
    await expect(card.getByRole('log')).toContainText('Tio personer är på plats i dag.');
    // Nothing navigates: the answer is under the line and the line is empty for the next question.
    await expect(page).toHaveURL('/');
    await expect(heading(page, 1, GREETING)).toBeVisible();
    await expect(hemLine(page)).toHaveValue('');
    expect(api.asked).toHaveLength(1);
    // Stäng takes the card away and the line has the focus.
    await card.getByRole('button', { name: 'Stäng' }).click();
    await expect(card).toHaveCount(0);
    await expect(hemLine(page)).toBeFocused();
    await expect(hemLine(page)).toHaveValue('');
  });

  test('at 320 px the field and the button fit without sideways scrolling, the button beside the field or under it', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(narrow);
    await open(page, '/');
    const line = hemLine(page),
      ask = askButton(page);
    await expect(line).toBeInViewport({ ratio: 1 });
    await expect(ask).toBeInViewport({ ratio: 1 });
    const f = await box(line),
      b = await box(ask);
    expect(b.x >= f.x + f.width || b.y >= f.y + f.height).toBe(true);
    // Where the row is this narrow the button is its arrow alone (D130), still named and a target of its own size.
    await expect(ask).toHaveAccessibleName('Fråga AI');
    expect(Math.min(b.width, b.height)).toBeGreaterThanOrEqual(24);
    expect(await reflowProblems(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectNoAxeViolations(page);
  });
});

/**
 * The answer under Hem's line (D138 items 2 and 9): one card directly under the line with the board below it. It shows
 * the conversation's newest exchange, with the question as its heading, the work items the answer names as the rows
 * "Behöver dig" has, "Öppna som samtal" and "Stäng". The line is the box: the next question goes on in the same
 * conversation while the card stands, and the corner's "Fråga AI" still leads to the line.
 */
test.describe('the answer under Hem’s line', () => {
  test.use({ viewport: desktop });
  const askOnLine = async (page: Page, question: string) => {
    await hemLine(page).fill(question);
    await hemLine(page).press('Enter');
  };

  test('a second question goes on in the same conversation, and the card shows only the newest exchange', async ({
    page,
    api,
  }) => {
    await open(page, '/');
    await askOnLine(page, 'Vem är på plats?');
    await expect(answerCard(page, 'Vem är på plats?').getByRole('log')).toContainText(
      'Tio personer är på plats i dag.',
    );
    await askOnLine(page, 'Hur många semesterdagar har jag?');
    const card = answerCard(page, 'Hur många semesterdagar har jag?');
    await expect(card.getByRole('log')).toContainText('Du har 18 semesterdagar kvar i år.');
    expect(api.asked).toHaveLength(2);
    expect(api.asked[1]).toMatchObject({ conversationId: 'konversation', own: true });
    // One card, the newest exchange: the earlier one is in the conversation.
    await expect(answerCard(page, 'Vem är på plats?')).toHaveCount(0);
    await expect(page.getByRole('main').getByText('Tio personer är på plats i dag.')).toHaveCount(0);
    await expect(page).toHaveURL('/');
    await expectNoAxeViolations(page);
  });

  test('Stäng takes the card away and gives the focus to the line; the conversation is still under Samtal, and the next question starts a new one', async ({
    page,
    api,
  }) => {
    await open(page, '/');
    await askOnLine(page, 'Vem är på plats?');
    const card = answerCard(page, 'Vem är på plats?');
    await expect(card.getByRole('log')).toContainText('Tio personer är på plats i dag.');
    await card.getByRole('button', { name: 'Stäng' }).focus();
    await page.keyboard.press('Enter');
    await expect(card).toHaveCount(0);
    await expect(hemLine(page)).toBeFocused();
    await askOnLine(page, 'Hur många semesterdagar har jag?');
    await expect(answerCard(page, 'Hur många semesterdagar har jag?').getByRole('log')).toContainText(
      'Du har 18 semesterdagar kvar i år.',
    );
    expect(api.asked[1]!.conversationId).toBeUndefined();
    // The conversation stays where conversations are found (D138 item 10).
    await rail(page).getByRole('link', { name: 'Samtal', exact: true }).click();
    await expect(page.getByRole('main').locator('a[href^="/conversations/konversation"]').first()).toBeVisible();
  });

  test('Stäng while the answer is on its way stops the turn, puts the question back in the line and says so', async ({
    page,
    api,
  }) => {
    const release = api.holdAnswer();
    await open(page, '/');
    await askOnLine(page, 'Vem är på plats?');
    const card = answerCard(page, 'Vem är på plats?');
    await expect(card.getByRole('log')).toHaveAttribute('aria-busy', 'true');
    await card.getByRole('button', { name: 'Stäng' }).click();
    await expect(card).toHaveCount(0);
    await expect(hemLine(page)).toBeFocused();
    await expect(hemLine(page)).toHaveValue('Vem är på plats?');
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringMatching(/Frågan avbröts/));
    release();
    await expect(page).toHaveURL('/');
    await expect(answerCard(page, 'Vem är på plats?')).toHaveCount(0);
  });

  test('Öppna som samtal leads to the conversation’s page with the whole conversation; Back shows the card again with the focus on the line, and a reload shows Hem without it', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await askOnLine(page, 'Vem är på plats?');
    await expect(answerCard(page, 'Vem är på plats?').getByRole('log')).toContainText(
      'Tio personer är på plats i dag.',
    );
    await askOnLine(page, 'Hur många semesterdagar har jag?');
    const card = answerCard(page, 'Hur många semesterdagar har jag?');
    await expect(card.getByRole('log')).toContainText('Du har 18 semesterdagar kvar i år.');
    const whole = card.getByRole('link', { name: 'Öppna som samtal' });
    await whole.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/conversations/konversation');
    const log = page.getByRole('main').getByRole('log');
    await expect(log).toContainText('Tio personer är på plats i dag.');
    await expect(log).toContainText('Du har 18 semesterdagar kvar i år.');
    await expect(page.getByRole('combobox', { name: 'Svara i samtalet' })).toBeFocused();
    await page.goBack();
    await expect(page).toHaveURL('/');
    await expect(card.getByRole('log')).toContainText('Du har 18 semesterdagar kvar i år.');
    await expect(hemLine(page)).toBeFocused();
    // The card is the moment's: Hem at rest is its board, and the conversation is under Samtal.
    await page.reload();
    await expect(heading(page, 1, GREETING)).toBeVisible();
    await expect(needs(page)).toBeVisible();
    await expect(card).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('log')).toHaveCount(0);
  });

  test('the work items an answer names are rows as Behöver dig has them, each a link to its item with Hem as the way back', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    await askOnLine(page, 'Attestera en faktura');
    const card = answerCard(page, 'Attestera en faktura');
    await expect(card.getByRole('log')).toContainText('Två matchar sina beställningar');
    const rows = card.getByRole('list', { name: 'Ärenden i svaret' });
    await expect(rows.getByRole('listitem')).toHaveCount(1);
    await expect(rows.getByRole('link', { name: /Attestera 3 fakturor/ }).first()).toHaveAttribute(
      'href',
      '/items/fakturor?from=%2F',
    );
    // The card's own article of the transcript is not drawn a second time.
    await expect(card.getByRole('article', { name: /^Ärende: / })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('the corner’s Fråga AI still leads to the line while the card stands', async ({ page, api: _ }) => {
    await open(page, '/');
    await askOnLine(page, 'Vem är på plats?');
    const card = answerCard(page, 'Vem är på plats?');
    await expect(card.getByRole('log')).toContainText('Tio personer är på plats i dag.');
    const corner = page.getByRole('button', { name: 'Fråga AI: gå till frågefältet', exact: true });
    await expect(corner).toHaveCount(1);
    await card.getByRole('button', { name: 'Stäng' }).focus();
    await corner.focus();
    await page.keyboard.press('Enter');
    await expect(hemLine(page)).toBeFocused();
    await expect(card).toBeVisible();
  });

  test('at 320 px the card with a named item reflows with nothing cut, its buttons under its heading', async ({
    page,
    api: _,
  }) => {
    await page.setViewportSize(narrow);
    await open(page, '/');
    await askOnLine(page, 'Attestera en faktura');
    const card = answerCard(page, 'Attestera en faktura');
    await expect(card.getByRole('log')).toContainText('Två matchar sina beställningar');
    await expect(card.getByRole('list', { name: 'Ärenden i svaret' }).getByRole('listitem')).toHaveCount(1);
    await expect(card.getByRole('link', { name: 'Öppna som samtal' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Stäng' })).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectNoAxeViolations(page);
  });
});

/**
 * Läget on Hem (D126, the product owner 2026-11-14): one row of at most four tiles, the worst status first, every tile
 * the same shape and a link to its figure's page; a figure with nothing to show is not drawn here, and the unit's page,
 * where every figure is, is "Visa alla (N)" when there are more.
 */
test.describe('Läget on Hem', () => {
  test.use({ viewport: desktop });
  const tile = (page: Page, name: string) => lage(page).getByRole('link', { name, exact: true });
  const TILES = [
    'Öppna tillbud 3, Behöver dig',
    'Sjukfrånvaro 4,2 %, Bevaka',
    'Utvecklingssamtal hållna 1 av 4',
    'Förbrukat av ramen 98 %, Lugnt',
  ];

  test('four tiles in one row, the worst first, each a link to its figure’s page; the empty figure is left out and Visa alla counts it', async ({
    page,
    api: _,
  }) => {
    await new Units().route(page);
    await open(page, '/');
    const block = lage(page);
    await expect(heading(page, 2, `Läget på ${user.unitLabel}`)).toBeVisible();
    // The heading is plain text; the way to the unit's page, where every figure is, ends the heading's line.
    await expect(block.getByRole('heading').getByRole('link')).toHaveCount(0);
    const all = block.getByRole('link', { name: 'Visa alla (5)', exact: true });
    await expect(all).toHaveAttribute('href', `/units/${user.unitId}?from=%2F`);
    await expect(block.getByRole('link', { name: 'Öppna dialogstödet' })).toHaveCount(0);
    // The sentence figure ("Inget nytt sedan i går.") is the unit page's, not Hem's.
    await expect(block.getByText('Inget nytt sedan i går.')).toHaveCount(0);
    const boxes = [];
    for (const name of TILES) boxes.push(await box(tile(page, name)));
    for (const [i, b] of boxes.entries()) {
      expect(Math.abs(b.y - boxes[0]!.y), TILES[i]).toBeLessThan(2);
      if (i > 0) expect(b.x, TILES[i]).toBeGreaterThan(boxes[i - 1]!.x);
    }
    // One shape: no bar; the status stands in words under the value.
    await expect(block.getByRole('progressbar')).toHaveCount(0);
    await expect(tile(page, TILES[1]!)).toHaveAttribute(
      'href',
      '/tools/hr.absenceOverview?title=Fr%C3%A5nvaro+per+person&from=%2F',
    );
    await expect(tile(page, TILES[3]!)).toHaveAttribute(
      'href',
      '/tools/finance.budget?title=Budget+mot+prognos&from=%2F',
    );
    await expectNoAxeViolations(page);
    await all.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(new RegExp(`/units/${user.unitId}\\?from=%2F$`));
    await expect(heading(page, 1, ENTITY_UNIT.label)).toBeVisible();
  });

  test('all figures shown: the link reads Enhetens sida', async ({ page, api }) => {
    api.areas = api.areas.filter(a => a.id !== 'viktigt-nu');
    await open(page, '/');
    await expect(lage(page).getByRole('link', { name: 'Enhetens sida', exact: true })).toHaveAttribute(
      'href',
      `/units/${user.unitId}?from=%2F`,
    );
  });

  test('an employee has no Läget on Hem', async ({ page, api }) => {
    api.employee = true;
    await open(page, '/');
    await expect(heading(page, 1, GREETING)).toBeVisible();
    await expect(page.getByRole('heading', { name: /^Läget på/ })).toHaveCount(0);
  });
});

/**
 * D116, D126: a figure's view is its own page, a table and one thing alike; Back returns to Hem with the focus on the
 * tile that opened it.
 */
test.describe('Läget leads to a figure’s page', () => {
  test.use({ viewport: desktop });
  const talks = {
    kind: 'table' as const,
    capability: 'talks.talks',
    connector: 'talks',
    source: 'Utvecklingssamtal',
    chip: false,
    title: 'name',
    noun: { one: 'person', other: 'personer' },
    fields: [
      { key: 'name', label: 'Namn' },
      { key: 'state', label: 'Samtal', format: 'status' as const, tones: { Saknas: 'warn' as const } },
      { key: 'at', label: 'När' },
    ],
  };
  const rows = [
    { name: 'Anna Lindqvist', state: 'Bokat', at: 'mån 16 nov' },
    { name: 'Karin Lindqvist', state: 'Saknas' },
  ];
  const serve = (page: Page) =>
    page.route('**/api/cap/talks.talks*', route =>
      route.fulfill({ json: { source: 'Utvecklingssamtal', view: talks, output: { rows } } }),
    );
  const tileOf = (page: Page) => lage(page).getByRole('link', { name: 'Utvecklingssamtal hållna 1 av 4', exact: true });
  const PAGE = '/tools/talks.talks?title=Utvecklingssamtal&from=%2F';

  test('a tile whose view is a table leads to the view’s page, which names Hem as its way back; Back returns to Hem with the focus on the tile', async ({
    page,
    api: _,
  }) => {
    await serve(page);
    await open(page, '/');
    const tile = tileOf(page);
    await expect(tile).toHaveAttribute('href', PAGE);
    await tile.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(PAGE);
    const main = page.getByRole('main');
    await expect(heading(page, 1, 'Utvecklingssamtal')).toBeFocused();
    await expect(main.getByRole('columnheader')).toHaveText(['Namn', 'Samtal', 'När']);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('complementary')).toHaveCount(0);
    // The way back names Hem, and the pages' row stands on the place it came from.
    await expect(main.getByRole('link', { name: 'Hem', exact: true })).toHaveAttribute('href', '/');
    await expect(rail(page).locator('a[aria-current="page"]')).toHaveText('Start');
    await expectNoAxeViolations(page);
    await page.goBack();
    await expect(page).toHaveURL('/');
    await expect(tileOf(page)).toBeFocused();
    // A tile is pressed where its text is drawn: ClickableCard lays it over the card's own link.
    await lage(page).getByText('1 av 4', { exact: true }).click();
    await expect(page).toHaveURL(PAGE);
    await page.getByRole('main').getByRole('link', { name: 'Hem', exact: true }).click();
    await expect(page).toHaveURL('/');
    await expect(tileOf(page)).toBeFocused();
  });

  test('a tile whose view is one thing leads to its page too, never beside Hem', async ({ page, api: _ }) => {
    await open(page, '/');
    const tile = lage(page).getByRole('link', { name: 'Förbrukat av ramen 98 %, Lugnt', exact: true });
    await tile.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/tools/finance.budget?title=Budget+mot+prognos&from=%2F');
    await expect(page.getByRole('dialog')).toHaveCount(0);
  });

  test('the view’s page reached from a tile reflows at 320 px with no axe violations', async ({ page, api: _ }) => {
    await page.setViewportSize(narrow);
    await serve(page);
    await open(page, '/');
    await tileOf(page).focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(PAGE);
    const main = page.getByRole('main');
    await expect(heading(page, 1, 'Utvecklingssamtal')).toBeVisible();
    // At 320 px the table is its list.
    await expect(main.getByRole('table')).toHaveCount(0);
    await expect(main.getByRole('listitem').filter({ hasText: 'Karin Lindqvist' })).toContainText('Saknas');
    expect(await reflowProblems(page)).toEqual([]);
    await expectNoAxeViolations(page);
  });
});

test.describe('Hem, narrow', () => {
  test('at 320 px nothing reflows past the edge or is cut, and a row’s whole line is drawn', async ({ page, api }) => {
    everything(api);
    // The longest line a row has: the system, the reason and a reminder that waits to be scheduled.
    api.threads.find(t => t.id === 'ledighet')!.timers = [
      { kind: 'reminder', dueAt: '2026-11-05T10:00:00.000Z', state: 'queued' },
    ];
    await page.setViewportSize(narrow);
    await open(page, '/');
    await expect(callout(page)).toBeVisible();
    await expect(news(page)).toBeVisible();
    expect(await reflowProblems(page)).toEqual([]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    // `reflowProblems` sees what is cut sideways, not what a line clamp cuts downwards: every row under Behöver dig
    // draws its whole line, the system first, the one with the queued reminder too, none of it behind an ellipsis.
    const lines = await workRowLines(needs(page).locator('[id^="work-"]'));
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.map(l => l.text)).toContainEqual(
      expect.stringMatching(/Ansökan väntar på beslut · påminnelsen väntar på schemaläggning$/),
    );
    for (const line of lines) expect(line, line.text).toMatchObject({ cut: false });
  });
});

/** D135: the session person holds two units, the school and a second one, and the leave request is about the second. */
const HAGA = { unitId: 'unit-haga', unitLabel: 'Hagaskolan', role: 'manager' as const };
function twoUnits(api: MockApi) {
  api.assignments = [{ unitId: user.unitId, unitLabel: user.unitLabel, role: 'manager' }, HAGA];
  api.threads = api.threads.map(t =>
    t.id === 'ledighet' ? { ...t, subjects: [{ entity: 'unit' as const, key: HAGA.unitId }] } : t,
  );
}
test.describe('Hem for a person with several units (D135)', () => {
  test('the line under the greeting names both units, and the row whose item is about one of them names it after its system', async ({
    page,
    api,
  }) => {
    twoUnits(api);
    await open(page, '/');
    await expect(page.getByRole('main').getByText(`${user.unitLabel} och ${HAGA.unitLabel}`)).toBeVisible();
    const ledighet = needs(page).locator('#work-ledighet');
    await expect(ledighet).toContainText(`Personalsystemet · ${HAGA.unitLabel} · `);
    // Only the item about a unit says one; the others are as they were.
    await expect(needs(page).locator('#work-fakturor')).not.toContainText(HAGA.unitLabel);
    await expect(needs(page).locator('#work-fakturor')).not.toContainText(user.unitLabel);
    await expectNoAxeViolations(page);
  });
  test('a person with one unit sees no unit on a row, even on an item that names one', async ({ page, api }) => {
    twoUnits(api);
    api.assignments = undefined;
    await open(page, '/');
    await expect(needs(page).locator('#work-ledighet')).not.toContainText(HAGA.unitLabel);
  });
  test('at 320 px the row with its unit reflows and draws its whole line', async ({ page, api }) => {
    twoUnits(api);
    await page.setViewportSize(narrow);
    await open(page, '/');
    expect(await reflowProblems(page)).toEqual([]);
    const lines = await workRowLines(needs(page).locator('#work-ledighet'));
    expect(lines.map(l => l.text)).toContainEqual(expect.stringContaining(HAGA.unitLabel));
    for (const line of lines) expect(line, line.text).toMatchObject({ cut: false });
  });
});

test.describe('Hem on a phone', () => {
  test.use({ viewport: phone, hasTouch: true, isMobile: true });

  test('the line under the greeting, the blocks one under the other, and a finger reaches the callout’s buttons and a news row', async ({
    page,
    api,
  }) => {
    everything(api);
    await open(page, '/');
    const h = await box(heading(page, 1, GREETING)),
      b = await box(hemLine(page)),
      n = await box(needs(page)),
      d = await box(today(page)),
      w = await box(news(page));
    // As the board's phone draws it: the line in the page under the greeting, not docked at the foot.
    expect(b.y).toBeGreaterThan(h.y + h.height);
    expect(n.y).toBeGreaterThan(b.y + b.height);
    expect(Math.abs(d.x - n.x)).toBeLessThan(2);
    expect(d.y).toBeGreaterThan(n.y + n.height);
    expect(Math.abs(w.x - n.x)).toBeLessThan(2);
    expect(w.y).toBeGreaterThan(d.y + d.height);
    for (const name of ['Läs', 'Jag har läst']) {
      const target = callout(page).getByRole(name === 'Läs' ? 'link' : 'button', { name, exact: true });
      expect((await target.boundingBox())!.height, name).toBeGreaterThanOrEqual(44);
    }
    const row = news(page).getByRole('listitem').first();
    expect((await row.boundingBox())!.height).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expectNoAxeViolations(page);
  });
});

/**
 * A system that does not answer is said where its content is missing (D116, amended 2026-11-12), never as a banner at
 * the top of the page: "I dag" stays and says that the calendar does not answer, with Försök igen; the first time in a
 * session it is said aloud once. A person with no calendar is told so in "I dag", with who connects one, and no warning.
 */
test.describe('I dag when the calendar does not answer, and for a person with no calendar', () => {
  test.use({ viewport: desktop });
  const day = today;
  const said = async (page: Page, words: string) =>
    (await announcements(page)).filter(text => text.includes(words)).length;

  test('I dag stays and says that the calendar does not answer, with Försök igen, which reads the day again; it is said once, and nothing tops the page', async ({
    page,
    api,
  }) => {
    api.calendar = 'silent';
    await open(page, '/');
    await expect(day(page).getByRole('heading', { name: 'I dag' })).toBeVisible();
    await expect(day(page).getByText('Kalendern svarar inte', { exact: true })).toBeVisible();
    // Said in the block where the day would be, and nowhere else: no banner above the page.
    expect(await silentSaidIn(page)).toEqual(['I dag']);
    await expect.poll(() => said(page, 'Kalendern svarar inte')).toBe(1);
    await expectNoAxeViolations(page);
    // To Att göra and back by the pages' row: the session has said it once, so it is not said again.
    await rail(page)
      .getByRole('link', { name: /^Att göra/ })
      .click();
    await expect(page).toHaveURL('/todo');
    await rail(page).getByRole('link', { name: 'Start', exact: true }).click();
    await expect(day(page).getByText('Kalendern svarar inte', { exact: true })).toBeVisible();
    expect(await said(page, 'Kalendern svarar inte')).toBe(1);
    // The calendar answers again: Försök igen reads the day, and the meetings stand where the sentence was.
    api.calendar = 'ok';
    await day(page).getByRole('button', { name: 'Försök igen' }).click();
    await expect(day(page).getByText('Rektorsmöte')).toBeVisible();
    await expect(day(page).getByText('Kalendern svarar inte', { exact: true })).toHaveCount(0);
    await expect(day(page).getByRole('link', { name: 'Kalender', exact: true })).toBeVisible();
  });

  test('when the calendar has not answered since a known time it says since when, and once aloud', async ({
    page,
    api,
  }) => {
    api.calendar = 'silent';
    api.sources = [
      { connector: 'calendar', state: 'idle', lastSuccess: '2026-11-04T05:00:00.000Z', error: 'unavailable' },
    ];
    await open(page, '/');
    await expect(day(page).getByText('Kalendern svarar inte sedan 06:00', { exact: true })).toBeVisible();
    // One system, said once, whether the cards' statuses or the day's own read noticed it first.
    await expect.poll(() => said(page, 'Kalendern svarar inte')).toBe(1);
    await expectNoAxeViolations(page);
  });

  test('a person whose calendar is not switched on for them: I dag says so and who connects one, with no warning, and the pages have no Kalender', async ({
    page,
    api,
  }) => {
    api.calendar = 'hidden';
    await open(page, '/');
    await expect(day(page).getByText('Ingen kalender är kopplad till dig.', { exact: true })).toBeVisible();
    await expect(
      day(page).getByText('En administratör kopplar kalendern under Anslutna system.', { exact: true }),
    ).toBeVisible();
    await expect(day(page).getByRole('button', { name: 'Försök igen' })).toHaveCount(0);
    await expect(day(page).getByRole('link', { name: 'Kalender', exact: true })).toHaveCount(0);
    expect(await silentSaidIn(page)).toEqual([]);
    expect(await said(page, 'svarar inte')).toBe(0);
    await expect(rail(page).getByRole('link', { name: 'Kalender', exact: true })).toHaveCount(0);
    await expectNoAxeViolations(page);
  });

  test('an account with no calendar bound: I dag says so and who binds one, and the pages keep Kalender', async ({
    page,
    api,
  }) => {
    api.calendar = 'unbound';
    await open(page, '/');
    await expect(day(page).getByText('Ingen kalender är kopplad till dig.', { exact: true })).toBeVisible();
    await expect(day(page).getByText('En administratör kopplar ditt kalenderkonto.', { exact: true })).toBeVisible();
    expect(await silentSaidIn(page)).toEqual([]);
    expect(await said(page, 'svarar inte')).toBe(0);
    await expect(rail(page).getByRole('link', { name: 'Kalender', exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
  });

  test('a silent calendar and no calendar reflow at 320 px', async ({ page, api }) => {
    await page.setViewportSize(narrow);
    for (const state of ['silent', 'hidden'] as const) {
      api.calendar = state;
      await open(page, '/');
      await expect(day(page).getByRole('heading', { name: 'I dag' })).toBeVisible();
      expect(await reflowProblems(page, day(page)), state).toEqual([]);
    }
  });
});

test.describe('a row whose next press is the decision itself runs it from the row (D142, D70 item 1)', () => {
  test.use({ viewport: desktop });

  test('the button says the action, the title is the link to the item’s page, and one press writes and is said', async ({
    page,
    api,
  }) => {
    // The reference connector's ready-to-send action has its input and asks the person to choose no rows.
    const task: Thread = {
      ...api.threads.find(t => t.id === 'rutin')!,
      id: 'reference',
      topic: 'reference:item:1',
      title: 'Hantera testposten',
      connector: 'reference',
      area: 'reference',
      deadline: '2026-11-04',
      items: [],
      trigger: { source: 'Testkälla', reason: 'Testkällan har en öppen post.', at: NOW },
      actions: [
        {
          id: 'complete',
          label: 'Markera klar',
          capability: 'reference.complete',
          kind: 'execute',
          role: 'primary',
          input: { ref: 'reference:item:1', revision: 1 },
        },
      ],
    };
    api.threads = [task, ...api.threads];
    await open(page, '/');
    const row = needs(page).locator('#work-reference');
    // The button is not a link to the page here, so the item's name is (D142 item 7).
    await expect(row.getByRole('link', { name: 'Hantera testposten' })).toHaveAttribute(
      'href',
      '/items/reference?from=%2F',
    );
    await expect(row.getByRole('link', { name: /^Öppna/ })).toHaveCount(0);
    await expectNoAxeViolations(page);
    const complete = row.getByRole('button', { name: 'Markera klar: Hantera testposten' });
    await complete.focus();
    await page.keyboard.press('Enter');
    await expect.poll(() => api.acted.map(a => [a.threadId, a.body.actionId])).toEqual([['reference', 'complete']]);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(toasts(page).getByText(/^Bekräftat i testkällan\. Ärendet ligger under Klart\./)).toBeVisible();
  });
});

test.describe('the way back from Kalender (D126 rule 7)', () => {
  test.use({ viewport: desktop });
  /** Kalender reached without a link, as a search hit or a button leads there: the address changes, nothing is pressed. */
  const reachKalender = (page: Page) =>
    page.evaluate(() => {
      history.pushState(history.state, '', '/calendar');
      dispatchEvent(new PopStateEvent('popstate', { state: history.state }));
    });

  test('I dag’s Kalender, then Back: the focus is on the link pressed, not on the pages’ Kalender ahead of it; the pages’ own is given back as well', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    const ours = today(page).getByRole('link', { name: 'Kalender', exact: true });
    const pages = rail(page).getByRole('link', { name: 'Kalender', exact: true });
    await expect(pages).toBeVisible();
    await ours.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/calendar');
    await expect(heading(page, 1, 'Vecka 45')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL('/');
    await expect(ours).toBeFocused();
    await expect(pages).not.toBeFocused();
    // The pages' Kalender pressed: it has the focus back.
    await pages.click();
    await expect(heading(page, 1, 'Vecka 45')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL('/');
    await expect(pages).toBeFocused();
  });

  test('Kalender reached without a link: Back gives the focus to a link to it in the page’s own content, never to the pages’ Kalender', async ({
    page,
    api: _,
  }) => {
    await open(page, '/');
    const ours = today(page).getByRole('link', { name: 'Kalender', exact: true });
    await expect(ours).toBeVisible();
    await reachKalender(page);
    await expect(heading(page, 1, 'Vecka 45')).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL('/');
    await expect(ours).toBeFocused();
    // Att göra has no link to Kalender but the pages': the focus is left to the page.
    await open(page, '/todo');
    await expect(heading(page, 1, 'Att göra')).toBeVisible();
    await reachKalender(page);
    await expect(heading(page, 1, 'Vecka 45')).toBeVisible();
    await page.goBack();
    await expect(heading(page, 1, 'Att göra')).toBeVisible();
    await page.waitForTimeout(600);
    await expect(rail(page).getByRole('link', { name: 'Kalender', exact: true })).not.toBeFocused();
  });
});
