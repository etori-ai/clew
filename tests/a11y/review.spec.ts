import type { Page } from '@playwright/test';
import type { MockApi } from './support';
import {
  announcements,
  composer,
  desktop,
  scrollPage,
  expect,
  expectNoAxeViolations,
  narrow,
  open,
  phone,
  reflowProblems,
  test,
} from './support';

/** The invoice card as a connector that asks for a review one row at a time declares it (D70). */
const reviewed = (api: MockApi) => {
  const card = api.threads.find(t => t.id === 'fakturor')!;
  card.actions = card.actions.map(a =>
    a.id === 'approve' ? { ...a, review: 'each' as const, preview: 'finance.preview' } : a,
  );
  return card;
};
/** The same card with `count` invoices. */
const invoices = (api: MockApi, count: number) => {
  const card = reviewed(api);
  card.items = Array.from({ length: count }, (_, index) => ({
    ...card.items[0]!,
    ref: `invoice-${index}`,
    label: `Leverantör ${index + 1} · 1 000 kr`,
  }));
  return card;
};
/**
 * The same card after its decision was sent and the source answered each row: confirmed, or as `outcomes` names them
 * by the row's place. A refused row makes the decision partial, which the item's notice then offers to review again (D80).
 */
const sent = (api: MockApi, outcomes: Record<number, 'failed' | 'unknown'> = {}) => {
  const card = reviewed(api);
  const refused = Object.values(outcomes).includes('failed');
  card.state = 'handled';
  card.handledAt = '2026-11-04T07:00:00.000Z';
  card.execution = {
    id: 'rejected-execution',
    decisionId: 'first',
    operation: 'finance.approve',
    state: refused ? 'partial' : 'succeeded',
    reason: null,
    compensates: null,
  };
  card.receipt = {
    at: '2026-11-04T07:00:00.000Z',
    headline: refused ? 'Två bekräftade, en avvisad.' : 'Tre fakturor attesterade.',
    undoUntil: null,
    undoCapability: null,
    rows: card.items.map((i, n) => ({
      ref: i.ref,
      label: i.label,
      outcome: outcomes[n] ?? ('done' as const),
      detail:
        outcomes[n] === 'failed'
          ? 'Beställningsnummer saknas.'
          : outcomes[n] === 'unknown'
            ? 'Källan svarade inte.'
            : 'Attesterad.',
    })),
  };
  return card;
};
const INVOICES = 'Attestera 3 fakturor, 48 200 kr';
const ROWS = ['Energibolaget AB · 21 400 kr', 'Skolmaterial Norrland AB · 18 300 kr', 'Städservice Mitt AB · 8 500 kr'];
/** The item's page, which is its review (D142), opened from Att göra's pane. */
const FROM_TODO = '/items/fakturor?from=%2Ftodo%3Fitem%3Dfakturor';
/** The same page where Att göra has no pane (a phone, D126 rule 2): the queue itself is the way back. */
const FROM_QUEUE = '/items/fakturor?from=%2Ftodo';
const pane = (page: Page) => page.getByRole('complementary', { name: 'Valt ärende' });
const title = (page: Page, name: string) => page.getByRole('heading', { level: 1, name });
const rowHeading = (page: Page, name: string) => page.getByRole('heading', { level: 2, name });
const verb = (page: Page) => page.getByRole('button', { name: 'Attestera', exact: true });
/**
 * The rows, named "Rader" either way: below five they are the steps under the title (with Skicka last until it is
 * sent), from five a list in the end panel. Never both.
 */
const rows = (page: Page) => page.getByRole('main').getByRole('list', { name: 'Rader', exact: true });
/** The end panel: the item about itself, and from five rows the rows before that. */
const about = (page: Page) => page.getByRole('complementary', { name: 'Uppgifter' });
/** The pinned footer with the row's decision, then Skicka; gone once the decision is sent. */
const footer = (page: Page) => page.getByRole('main').locator('[aria-label="Granskningens beslut"]');
/** Where the person stands among the rows, said when the step changes (4.1.3); below five rows it is not drawn. */
const place = (page: Page, words: string) =>
  page
    .getByRole('main')
    .getByRole('status')
    .filter({ hasText: new RegExp(`^${words}$`) });
const draftOf = (page: Page) => page.evaluate(() => window.sessionStorage.getItem('clew.review.fakturor'));
/** 1.4.10: nothing of the page is wider than the window. */
const sideways = (page: Page) => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
/** Nothing decides or sends: the page of a decision already sent is read. */
const expectReadOnly = async (page: Page) => {
  await expect(footer(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: /^Attestera|^Lämna kvar|^Hoppa över/ })).toHaveCount(0);
  // What the review's own page had at its foot is the notice's or under ⋯ now, never a button of the page's.
  await expect(page.getByRole('button', { name: /Tillbaka till ärendet|Visa kvittot/ })).toHaveCount(0);
  await expect(page.getByRole('main').getByText('Inget skrivs förrän du skickar')).toHaveCount(0);
};

test.describe('the item’s page is the review of its rows, one address before and after it is sent (D70, D142)', () => {
  test.use({ viewport: desktop });

  test('the item’s page keeps what it pins while it is reviewed, while a thing’s page scrolls as one: its title and its decision stay, and only its column scrolls (D130 item 8 as amended 2026-11-21)', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await page.setViewportSize({ width: 1280, height: 560 });
    await open(page, FROM_TODO);
    await expect(title(page, INVOICES)).toBeVisible();
    // The page has nothing to scroll under the shell: it is a fixed work surface.
    expect((await scrollPage(page, 400)).room).toBeLessThanOrEqual(1);
    await expect(title(page, INVOICES)).toBeInViewport();
    await expect(verb(page)).toBeInViewport();
  });

  test('Granska on the work item in Att göra leads to the item’s page; the keyboard takes each row beside its document, the step in the address; Skicka writes once, shows the check and the page stays, read, with the item’s notice', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/todo');
    await page.locator('#work-fakturor').getByRole('link').click();
    const granska = pane(page).getByRole('link', { name: 'Granska 3' });
    await expect(granska).toHaveAttribute('href', FROM_TODO);
    await granska.click();
    // The item's own page in the shell, not a dialog and not a page beside the item's: the item's title is the h1 and
    // the tab's, and the way back names Att göra, where it was opened.
    await expect(page).toHaveURL(FROM_TODO);
    await expect(title(page, INVOICES)).toBeVisible();
    await expect(page).toHaveTitle(`${INVOICES} · Startsidan`);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(page.getByRole('main')).toContainText('Inget skrivs förrän du skickar');
    await expect(page.getByRole('main').getByRole('link', { name: 'Att göra' })).toHaveAttribute(
      'href',
      '/todo?item=fakturor',
    );
    // Below five rows the rows are the steps, with Skicka last, and no second list of them; the end panel holds the
    // item about itself.
    await expect(rows(page)).toHaveCount(1);
    await expect(rows(page).getByRole('listitem')).toHaveCount(4);
    await expect(about(page).getByRole('heading', { name: 'Uppgifter' })).toBeVisible();
    await expect(about(page).getByRole('button', { name: 'Varför ser jag detta?' })).toBeVisible();
    await expect(about(page).getByRole('list', { name: 'Rader' })).toHaveCount(0);
    // ⋯ at the end of the title's line holds what else the item offers.
    await page.getByRole('main').getByRole('button', { name: 'Fler åtgärder' }).click();
    await expect(page.getByRole('menuitem', { name: 'Inte nu' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Avfärda · inte aktuellt' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Visa granskning' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    // The document is read from the connector and named; the row's one next step holds the focus, so Enter takes it.
    await expect(page.getByRole('img', { name: /Energibolaget AB/ })).toBeVisible();
    await verb(page).focus();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining(INVOICES));
    await page.screenshot({ path: 'test-results/review-page-desktop.png' });
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${FROM_TODO}&step=2`);
    await expect(rowHeading(page, ROWS[1]!)).toBeVisible();
    await expect(verb(page)).toBeFocused();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('2 av 3'));
    await page.getByRole('button', { name: 'Lämna kvar' }).click();
    await expect(page).toHaveURL(`${FROM_TODO}&step=3`);
    await expect(rowHeading(page, ROWS[2]!)).toBeVisible();
    await verb(page).focus();
    await page.keyboard.press('Enter');
    // The last step says what was chosen, and nothing has been written yet.
    await expect(page).toHaveURL(`${FROM_TODO}&step=4`);
    await expect(rowHeading(page, 'Det du valt')).toBeVisible();
    await expect(page.getByRole('main')).toContainText('2 av 3 skickas, 1 lämnas kvar');
    await expect(rows(page).getByRole('listitem').nth(0)).toContainText('Vald för godkännande');
    await expect(rows(page).getByRole('listitem').nth(1)).toContainText('Lämnas kvar');
    await expect(page.getByRole('button', { name: 'Attestera 2' })).toBeFocused();
    expect(api.threads.find(t => t.id === 'fakturor')!.state).toBe('open');
    await expectNoAxeViolations(page);
    await page.keyboard.press('Enter');
    // The source's answer is read back: the check, then the same page at the same address without a step, read and no
    // longer decided, with the item's notice under the title and Ångra as its move. The draft has done its work.
    await expect(page.getByRole('status', { name: 'Bekräftat av källan' })).toContainText('2 fakturor attesterade');
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('2 fakturor attesterade'));
    await expect(page.getByRole('status', { name: 'Bekräftat av källan' })).toHaveCount(0);
    await expect(page).toHaveURL(FROM_TODO);
    expect(api.acted.at(-1)?.body.refs).toEqual(['finance:inv:1', 'finance:inv:3']);
    // The source's answer has arrived: the focus is on the item's title, above the notice that says it.
    await expect(title(page, INVOICES)).toBeFocused();
    await expect(page.getByRole('main')).toContainText('2 fakturor attesterade');
    await expect(page.getByRole('main')).toContainText('Bekräftat av Ekonomisystemet');
    await expect(page.getByRole('main').getByRole('button', { name: /^Ångra · \d+ min kvar$/ })).toBeVisible();
    await expectReadOnly(page);
    // The steps are the rows alone, each with what the source answered; there is no step for a result.
    await expect(rows(page).getByRole('listitem')).toHaveCount(3);
    await expect(rows(page).getByRole('listitem').nth(0)).toContainText('Bekräftad');
    await expect(rows(page).getByRole('listitem').nth(1)).toContainText('Inte skickad');
    await expect(rows(page).getByRole('listitem').nth(2)).toContainText('Bekräftad');
    await expect(rowHeading(page, ROWS[0]!)).toBeVisible();
    await expect(page.getByRole('main')).toContainText('Underlaget visar källans nuvarande version.');
    expect(await draftOf(page)).toBeNull();
    await expectNoAxeViolations(page);
    await page.screenshot({ path: 'test-results/review-page-sent.png' });
    // A row of the sent decision is read from its step; the document's heading takes the focus as between rows before.
    await rows(page)
      .getByRole('button', { name: new RegExp(ROWS[1]!) })
      .click();
    await expect(page).toHaveURL(`${FROM_TODO}&step=2`);
    await expect(rowHeading(page, ROWS[1]!)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Underlag från Ekonomisystemet' })).toBeFocused();
    // The steps took no place in the history: Back is Att göra with the item beside it, where the row keeps its place
    // with the receipt, and Forward is the sent item's page again.
    await page.goBack();
    await expect(page).toHaveURL('/todo?item=fakturor');
    await expect(pane(page).getByRole('list', { name: 'Kvitto, rad för rad' }).getByRole('listitem')).toHaveCount(2);
    await expect(pane(page).getByRole('button', { name: /^Ångra · \d+ min kvar$/ })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(`${FROM_TODO}&step=2`);
    await expect(title(page, INVOICES)).toBeVisible();
    await expectReadOnly(page);
  });

  test('12 rows: a progress bar instead of steps, the keyboard through every row, the rows as a list in the end panel before the facts, and a decision changed from it', async ({
    page,
    api,
  }) => {
    invoices(api, 12);
    await open(page, '/todo?item=fakturor');
    await pane(page).getByRole('link', { name: 'Granska 12' }).click();
    await expect(title(page, INVOICES)).toBeVisible();
    // No steps from five rows: the bar, the way between the rows under it, and the rows as the end panel's list.
    await expect(page.getByRole('button', { name: /^Gå till steg/ })).toHaveCount(0);
    const progress = page.getByRole('progressbar', { name: 'Bedömda rader' });
    await expect(progress).toHaveAttribute('aria-valuenow', '0');
    await expect(rows(page)).toHaveCount(1);
    await expect(about(page).getByRole('list', { name: 'Rader' }).getByRole('listitem')).toHaveCount(12);
    await expect(about(page).getByRole('heading', { name: 'Uppgifter' })).toBeVisible();
    const [list, facts] = await Promise.all([
      about(page).getByRole('heading', { name: 'Rader' }).boundingBox(),
      about(page).getByRole('heading', { name: 'Uppgifter' }).boundingBox(),
    ]);
    expect(list!.y).toBeLessThan(facts!.y);
    for (let n = 1; n <= 12; n++) {
      await expect(rowHeading(page, `Leverantör ${n} · 1 000 kr`)).toBeVisible();
      await expect(page.getByText(`${n} av 12`, { exact: true })).toBeVisible();
      await expect(verb(page)).toBeFocused();
      if (n === 6) {
        await expect(page.getByText('5 av 12 bedömda')).toBeVisible();
        await expectNoAxeViolations(page);
        expect(await reflowProblems(page)).toEqual([]);
        await page.screenshot({ path: 'test-results/review-page-twelve.png' });
      }
      await page.keyboard.press('Enter');
    }
    await expect(rowHeading(page, 'Det du valt')).toBeVisible();
    await expect(progress).toHaveAttribute('aria-valuenow', '12');
    await expect(page.getByRole('main')).toContainText('12 av 12 skickas');
    // Changing an earlier decision: Ändra on its row in the list, then Lämna kvar there.
    await page.getByRole('button', { name: 'Ändra rad 5: Leverantör 5 · 1 000 kr' }).click();
    await expect(page).toHaveURL(/step=5$/);
    await page.getByRole('button', { name: 'Lämna kvar' }).click();
    await expect(rowHeading(page, 'Leverantör 6 · 1 000 kr')).toBeVisible();
    await page.getByRole('button', { name: 'Översikt', exact: true }).click();
    await expect(page.getByRole('main')).toContainText('11 av 12 skickas, 1 lämnas kvar');
    await expect(rows(page).getByRole('listitem').nth(4)).toContainText('Lämnas kvar');
    await expect(page.getByRole('button', { name: 'Attestera 11' })).toBeEnabled();
    expect(api.acted).toHaveLength(0);
  });

  test('the decisions are kept: through a reload, Back and Forward between Att göra and the steps, and a way out and back; the item says the review is begun and goes on where it stopped', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/todo');
    await page.locator('#work-fakturor').getByRole('link').click();
    await pane(page).getByRole('link', { name: 'Granska 3' }).click();
    await page.getByRole('button', { name: 'Lämna kvar' }).click();
    await verb(page).click();
    await expect(page).toHaveURL(`${FROM_TODO}&step=3`);
    await page.reload();
    await expect(rowHeading(page, ROWS[2]!)).toBeVisible();
    await expect(rows(page).getByRole('listitem').nth(0)).toContainText('Lämnas kvar');
    await expect(rows(page).getByRole('listitem').nth(1)).toContainText('Vald för godkännande');
    // Back to the item in Att göra: "Fortsätt granska", to the first row not judged; the decisions as its ticks.
    await page.goBack();
    await expect(page).toHaveURL('/todo?item=fakturor');
    const going = pane(page).getByRole('link', { name: 'Fortsätt granska' });
    await expect(going).toHaveAttribute('href', `${FROM_TODO}&step=3`);
    await expect(pane(page).getByRole('link', { name: 'Granska 3' })).toHaveCount(0);
    const boxes = pane(page).getByRole('checkbox');
    await expect(boxes.nth(0)).not.toBeChecked();
    await expect(boxes.nth(1)).toBeChecked();
    await expect(boxes.nth(2)).not.toBeChecked();
    // Forward is the item's page where it was.
    await page.goForward();
    await expect(rowHeading(page, ROWS[2]!)).toBeVisible();
    await expect(rows(page).getByRole('listitem').nth(1)).toContainText('Vald för godkännande');
    // Out by the trail and in again by "Fortsätt granska".
    await page.getByRole('main').getByRole('link', { name: 'Att göra' }).click();
    await expect(page).toHaveURL('/todo?item=fakturor');
    await going.click();
    await expect(rowHeading(page, ROWS[2]!)).toBeVisible();
    await verb(page).click();
    await expect(page.getByRole('main')).toContainText('2 av 3 skickas, 1 lämnas kvar');
    // A person opened on the way, and back: the same.
    await open(page, '/staff');
    await open(page, '/todo?item=fakturor');
    await expect(pane(page).getByRole('link', { name: 'Fortsätt granska' })).toHaveAttribute(
      'href',
      `${FROM_TODO}&step=4`,
    );
    // An address that names no step opens where the next press is: every row is judged, so the last step.
    await open(page, '/items/fakturor');
    await expect(rowHeading(page, 'Det du valt')).toBeVisible();
    await expect(page).toHaveURL('/items/fakturor');
    expect(api.acted).toHaveLength(0);
    expect(api.threads.find(t => t.id === 'fakturor')!.state).toBe('open');
  });

  test('a change to the rows takes the draft back: the item is another than the one decided on', async ({
    page,
    api,
  }) => {
    const card = reviewed(api);
    await open(page, '/todo?item=fakturor');
    await pane(page).getByRole('link', { name: 'Granska 3' }).click();
    await verb(page).click();
    await expect(rows(page).getByRole('listitem').nth(0)).toContainText('Vald för godkännande');
    card.items = card.items.map((i, n) => (n === 0 ? { ...i, detail: 'Konto 4010 · förfaller 5 nov · ny summa' } : i));
    card.updatedAt = '2026-11-04T08:30:00.000Z';
    await page.reload();
    await expect(rowHeading(page, ROWS[1]!)).toBeVisible();
    await expect(rows(page).getByRole('listitem').nth(0)).not.toContainText('Vald för godkännande');
    expect(await draftOf(page)).toBeNull();
  });

  test('Back from the item’s page gives the focus to the control that was pressed in Att göra: Granska N', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/todo?item=fakturor');
    const granska = pane(page).getByRole('link', { name: 'Granska 3' });
    await granska.focus();
    await page.keyboard.press('Enter');
    await expect(title(page, INVOICES)).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL('/todo?item=fakturor');
    // The focus comes back into the item beside the queue, to a link that leads where the person was (2.4.3).
    await expect(pane(page).locator(`a[href="${FROM_TODO}"]:focus`)).toHaveCount(1);
    // The item's name in the pane leads to the same address (D142), and it is the first of the two: the focus may
    // stand on either.
  });

  test('a row under Rader in Att göra opens the item’s page at that row, and Back gives the focus to the row', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/todo?item=fakturor');
    const document = pane(page)
      .getByRole('region', { name: 'Rader' })
      .getByRole('link', { name: `Öppna underlaget för ${ROWS[1]}` });
    await document.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(`${FROM_TODO}&step=2`);
    await expect(rowHeading(page, ROWS[1]!)).toBeVisible();
    await expect(place(page, '2 av 3')).toBeAttached();
    await expect(page.getByRole('main').getByRole('link', { name: 'Att göra' })).toHaveAttribute(
      'href',
      '/todo?item=fakturor',
    );
    await expectNoAxeViolations(page);
    await page.goBack();
    await expect(page).toHaveURL('/todo?item=fakturor');
    await expect(document).toBeFocused();
  });

  test('the item’s page opened from Personal is the review with Personal as the way back; Fortsätt granska in a conversation’s answer leads to it, and Back to the answer with the focus on the link', async ({
    page,
    api,
  }) => {
    reviewed(api);
    const card = page.getByRole('article', { name: 'Ärende: Attestera 3 fakturor, 48 200 kr' });
    // An address from before D126 that held the item beside Personal is its page, Personal as the way back.
    await open(page, '/staff?card=fakturor');
    await expect(page).toHaveURL('/items/fakturor?from=%2Fstaff');
    await expect(title(page, INVOICES)).toBeVisible();
    await expect(verb(page)).toBeFocused();
    await page.getByRole('button', { name: 'Lämna kvar' }).click();
    await expect(page).toHaveURL('/items/fakturor?from=%2Fstaff&step=2');
    const back = page.getByRole('main').getByRole('link', { name: 'Personal', exact: true });
    await expect(back).toHaveAttribute('href', '/staff');
    await back.click();
    await expect(page).toHaveURL('/staff');

    // On the conversation's own page: a question on Hem's line is answered under the line (D138 item 9).
    await open(page, '/conversations/new');
    await composer(page).fill('attestera en faktura');
    await composer(page).press('Enter');
    await expect(card).toBeVisible();
    await expect(page).toHaveURL(/\/conversations\/(?!new$)[^/?]+$/);
    const conversation = new URL(page.url()).pathname;
    await card.getByRole('link', { name: 'Fortsätt granska' }).click();
    await expect(page).toHaveURL(`/items/fakturor?from=${encodeURIComponent(conversation)}&step=2`);
    await expect(rowHeading(page, ROWS[1]!)).toBeVisible();
    await page.goBack();
    await expect(page).toHaveURL(conversation);
    await expect(card.getByRole('link', { name: 'Fortsätt granska' })).toBeFocused();
  });

  test('a sent decision is read on the item’s page, opened at the row the source refused; the notice offers Granska avvisade igen, which puts the new item’s page in its place', async ({
    page,
    api,
  }) => {
    const card = sent(api, { 2: 'failed' });
    await page.route('**/api/threads/fakturor/retry', async route => {
      const retry = {
        ...card,
        id: 'retry:rejected-execution',
        topic: 'retry:rejected-execution',
        state: 'open' as const,
        handledAt: null,
        receipt: null,
        execution: null,
        items: [card.items[2]!],
      };
      api.threads.push(retry);
      await route.fulfill({ json: retry });
    });
    await open(page, '/todo?tab=done&item=fakturor');
    const shown = pane(page).getByRole('link', { name: 'Visa granskning' });
    await expect(shown).toHaveAttribute('href', '/items/fakturor?from=%2Ftodo%3Ftab%3Ddone%26item%3Dfakturor');
    await shown.click();
    await expect(page).toHaveURL('/items/fakturor?from=%2Ftodo%3Ftab%3Ddone%26item%3Dfakturor');
    // Read, with the focus on the item's title: the notice under it says what happened and holds the one move.
    await expect(title(page, INVOICES)).toBeFocused();
    await expectReadOnly(page);
    await expect(page.getByRole('main')).toContainText('Två bekräftade, en avvisad');
    // No step in the address: the page opens where the next press is, the row the source refused.
    await expect(rowHeading(page, ROWS[2]!)).toBeVisible();
    await expect(place(page, '3 av 3')).toBeAttached();
    await expect(page.getByRole('main')).toContainText('Beställningsnummer saknas.');
    await expect(rows(page).getByRole('listitem')).toHaveCount(3);
    await expect(rows(page).getByRole('listitem').nth(0)).toContainText('Bekräftad');
    await expect(rows(page).getByRole('listitem').nth(2)).toContainText('Avvisad');
    // Nothing on the item's own page leads to the review, since the person is on it.
    await page.getByRole('main').getByRole('button', { name: 'Fler åtgärder' }).click();
    await expect(page.getByRole('menu')).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Visa granskning' })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await expectNoAxeViolations(page);
    // Another row is read from its step, named in the address; the document's heading takes the focus.
    await rows(page)
      .getByRole('button', { name: new RegExp(ROWS[0]!) })
      .click();
    await expect(page).toHaveURL('/items/fakturor?from=%2Ftodo%3Ftab%3Ddone%26item%3Dfakturor&step=1');
    await expect(rowHeading(page, ROWS[0]!)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Underlag från Ekonomisystemet' })).toBeFocused();
    await page.getByRole('button', { name: 'Granska avvisade igen' }).click();
    await expect(page).toHaveURL(
      '/items/retry%3Arejected-execution?from=%2Ftodo%3Ftab%3Ddone%26item%3Dretry%253Arejected-execution',
    );
    await expect(title(page, INVOICES)).toBeVisible();
    await expect(rowHeading(page, ROWS[2]!)).toBeVisible();
    await expect(verb(page)).toBeEnabled();
    await expect(footer(page)).toBeVisible();
    // The new item's page took the old one's place in the history: Back is Att göra as it was before.
    await page.goBack();
    await expect(page).toHaveURL('/todo?tab=done&item=fakturor');
  });

  test('an address that names no step opens where the next press is once it is sent: the first row the source refused or left unanswered, else the first row', async ({
    page,
    api,
  }) => {
    sent(api, { 1: 'unknown', 2: 'failed' });
    await open(page, '/items/fakturor');
    await expect(rowHeading(page, ROWS[1]!)).toBeVisible();
    await expect(rows(page).getByRole('listitem').nth(1)).toContainText('Obekräftad');
    await expect(page).toHaveURL('/items/fakturor');
    await expect(title(page, INVOICES)).toBeFocused();
    sent(api);
    await open(page, '/items/fakturor');
    await expect(rowHeading(page, ROWS[0]!)).toBeVisible();
    await expect(title(page, INVOICES)).toBeFocused();
    // A step the address names is the person's own choice and is kept, the first too.
    sent(api, { 2: 'failed' });
    await open(page, '/items/fakturor?step=1');
    await expect(rowHeading(page, ROWS[0]!)).toBeVisible();
    // The last step was Skicka, which a sent decision does not have: its address opens where the next press is.
    await open(page, '/items/fakturor?step=4');
    await expect(rowHeading(page, ROWS[2]!)).toBeVisible();
  });

  test('the addresses from before lead to the item’s page, in their own place in the history; a step or an item that is not there says so', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/todo?item=fakturor&review=fakturor&step=2');
    await expect(page).toHaveURL(`${FROM_TODO}&step=2`);
    await expect(rowHeading(page, ROWS[1]!)).toBeVisible();
    await expect(place(page, '2 av 3')).toBeAttached();
    await open(page, '/staff?card=fakturor&review=fakturor');
    await expect(page).toHaveURL('/items/fakturor?from=%2Fstaff%3Fcard%3Dfakturor');
    await expect(page.getByRole('main').getByRole('link', { name: 'Personal' })).toBeVisible();
    await open(page, '/cards/fakturor/review?step=2');
    await expect(page).toHaveURL('/items/fakturor?step=2');
    await expect(rowHeading(page, ROWS[1]!)).toBeVisible();
    // Replaced, not stepped through: Back is the page before the old address.
    await page.goBack();
    await expect(page).toHaveURL('/items/fakturor?from=%2Fstaff%3Fcard%3Dfakturor');
    // The review's page beside the item's, 2026-11-12 to 2026-11-21: the item's page, the step and the way back kept.
    await open(page, '/items/fakturor/review?step=2&from=%2Ftodo');
    await expect(page).toHaveURL('/items/fakturor?step=2&from=%2Ftodo');
    await expect(title(page, INVOICES)).toBeVisible();
    await expect(rowHeading(page, ROWS[1]!)).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Att göra' })).toHaveAttribute('href', '/todo');
    await page.goBack();
    await expect(page).toHaveURL('/items/fakturor?from=%2Fstaff%3Fcard%3Dfakturor');
    await open(page, '/items/fakturor/review');
    await expect(page).toHaveURL('/items/fakturor');
    await expect(rowHeading(page, ROWS[0]!)).toBeVisible();

    await open(page, '/items/fakturor?step=9');
    await expect(title(page, 'Steget finns inte')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Till första steget' })).toHaveAttribute(
      'href',
      '/items/fakturor?step=1',
    );
    await expectNoAxeViolations(page);
    await open(page, '/items/okand/review');
    await expect(page).toHaveURL('/items/okand');
    await expect(title(page, 'Ärendet finns inte')).toBeVisible();
    await expect(page).toHaveTitle('Ärendet finns inte · Startsidan');
  });

  test('a card without a review has nothing to review: the address of the review’s page from before is its own page', async ({
    page,
    api,
  }) => {
    expect(api.threads.find(t => t.id === 'fakturor')!.actions.some(a => a.review)).toBe(false);
    await open(page, '/items/fakturor/review');
    await expect(page).toHaveURL('/items/fakturor');
    await expect(title(page, INVOICES)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Attestera 2 valda' })).toBeVisible();
    await expect(footer(page)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Gå till steg/ })).toHaveCount(0);
  });
});

test.describe('Hem’s row names the next press and leads to the item’s page (D142)', () => {
  test.use({ viewport: desktop });
  const needs = (page: Page) => page.getByRole('region', { name: 'Behöver dig' });

  test('Granska N leads to the item’s page with Hem as the way back; once begun it is Fortsätt granska, at the first row not judged', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/');
    const granska = needs(page).getByRole('link', { name: `Granska 3: ${INVOICES}` });
    await expect(granska).toHaveText('Granska 3');
    await expect(granska).toHaveAttribute('href', '/items/fakturor?from=%2F');
    // The row's one link: there is no "Öppna" beside it.
    await expect(needs(page).getByRole('link', { name: `Öppna ${INVOICES}` })).toHaveCount(0);
    await expectNoAxeViolations(page);
    await granska.focus();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/items/fakturor?from=%2F');
    await expect(title(page, INVOICES)).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Hem', exact: true })).toHaveAttribute('href', '/');
    await expect(verb(page)).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/items/fakturor?from=%2F&step=2');
    await page.goBack();
    await expect(page).toHaveURL('/');
    const going = needs(page).getByRole('link', { name: `Fortsätt granska: ${INVOICES}` });
    await expect(going).toHaveAttribute('href', '/items/fakturor?from=%2F&step=2');
    await expect(needs(page).getByRole('link', { name: `Granska 3: ${INVOICES}` })).toHaveCount(0);
    await going.click();
    await expect(rowHeading(page, ROWS[1]!)).toBeVisible();
    expect(api.acted).toHaveLength(0);
  });

  test('after a decision the source answered in part, the row says Granska 1 avvisad and leads to the item’s page, which opens at the refused row', async ({
    page,
    api,
  }) => {
    sent(api, { 2: 'failed' });
    await open(page, '/');
    const refused = needs(page).getByRole('link', { name: `Granska 1 avvisad: ${INVOICES}` });
    await expect(refused).toHaveText('Granska 1 avvisad');
    await expect(refused).toHaveAttribute('href', '/items/fakturor?from=%2F');
    await expectNoAxeViolations(page);
    await refused.click();
    await expect(page).toHaveURL('/items/fakturor?from=%2F');
    await expect(rowHeading(page, ROWS[2]!)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Granska avvisade igen' })).toBeVisible();
  });
});

test.describe('confirmed review completion', () => {
  test.use({ viewport: desktop });
  for (const reducedMotion of ['no-preference', 'reduce'] as const) {
    test(`a confirmed receipt shows a check and respects ${reducedMotion} motion`, async ({ page, api }) => {
      await page.emulateMedia({ reducedMotion });
      reviewed(api);
      await open(page, FROM_TODO);
      await verb(page).click();
      await page.getByRole('button', { name: 'Lämna kvar', exact: true }).click();
      await page.getByRole('button', { name: 'Lämna kvar', exact: true }).click();
      await expect(rowHeading(page, 'Det du valt')).toBeVisible();
      await page.getByRole('button', { name: 'Attestera 1', exact: true }).click();
      const completion = page.getByRole('status', { name: 'Bekräftat av källan' });
      await expect(completion).toBeVisible();
      const check = completion.getByRole('img', { name: 'Klart' });
      const animation = await check.evaluate(el => ({
        name: getComputedStyle(el).animationName,
        duration: getComputedStyle(el).animationDuration,
      }));
      if (reducedMotion === 'reduce')
        expect(animation.name === 'none' || animation.duration.split(',').every(value => parseFloat(value) === 0)).toBe(
          true,
        );
      else expect(animation.name).not.toBe('none');
      await expect(completion).toContainText('1 faktura attesterad');
      if (reducedMotion === 'no-preference') await page.screenshot({ path: 'test-results/review-completed.png' });
      // The check gives way to the same page, read: the address without its step, the notice under the title, and
      // the focus on the title.
      await expect(completion).toHaveCount(0);
      await expect(page).toHaveURL(FROM_TODO);
      await expect(title(page, INVOICES)).toBeFocused();
      await expect(page.getByRole('main')).toContainText('1 faktura attesterad');
      await expectReadOnly(page);
    });
  }
  test('an uncertain source result never shows the success animation; the page stays, opened at the row left unanswered', async ({
    page,
    api,
  }) => {
    reviewed(api);
    let completionShown = false;
    await page.exposeFunction('recordCompletion', () => {
      completionShown = true;
    });
    await page.addInitScript(() => {
      new MutationObserver(() => {
        if (document.querySelector('[aria-label="Bekräftat av källan"]'))
          (window as unknown as { recordCompletion(): void }).recordCompletion();
      }).observe(document, { childList: true, subtree: true });
    });
    await page.route('**/api/threads/fakturor/act', async route => {
      const card = api.threads.find(t => t.id === 'fakturor')!;
      const refs = route.request().postDataJSON().refs as string[];
      const next = {
        ...card,
        state: 'handled' as const,
        receipt: {
          at: '2026-11-04T08:00:00.000Z',
          headline: 'Resultatet kunde inte bekräftas',
          undoUntil: null,
          undoCapability: null,
          rows: refs.map(ref => ({ ref, label: ref, outcome: 'unknown' as const, detail: 'Källan svarade inte.' })),
        },
      };
      api.threads = api.threads.map(t => (t.id === card.id ? next : t));
      await route.fulfill({ json: { kind: 'execute', thread: next } });
    });
    await open(page, '/todo?item=fakturor');
    await pane(page).getByRole('link', { name: 'Granska 3' }).click();
    await page.getByRole('button', { name: 'Hoppa över', exact: true }).click();
    await verb(page).click();
    await page.getByRole('button', { name: 'Hoppa över', exact: true }).click();
    await page.getByRole('button', { name: 'Attestera 1', exact: true }).click();
    // The page stays and is read; the row the source did not answer is the one it opens at, and says so.
    await expect(page).toHaveURL(FROM_TODO);
    await expectReadOnly(page);
    await expect(title(page, INVOICES)).toBeFocused();
    await expect(rowHeading(page, ROWS[1]!)).toBeVisible();
    await expect(rows(page).getByRole('listitem').nth(1)).toContainText('Obekräftad');
    await expect(rows(page).getByRole('listitem').nth(0)).toContainText('Inte skickad');
    await expect(page.getByRole('main')).toContainText('Källan svarade inte.');
    expect(completionShown).toBe(false);
    await expectNoAxeViolations(page);
  });
  test('a refusal from the source keeps the decisions and says why', async ({ page, api }) => {
    reviewed(api);
    api.actRefusal = 'Fakturan är redan attesterad i ekonomisystemet.';
    await open(page, '/items/fakturor');
    await verb(page).click();
    await verb(page).click();
    await page.getByRole('button', { name: 'Lämna kvar', exact: true }).click();
    await page.getByRole('button', { name: 'Attestera 2', exact: true }).click();
    await expect(page.getByRole('alert').filter({ hasText: 'Fakturan är redan attesterad' })).toBeVisible();
    // Nothing was sent: the last step stands with its button, and the decisions as they were.
    await expect(page).toHaveURL('/items/fakturor?step=4');
    await expect(page.getByRole('button', { name: 'Attestera 2', exact: true })).toBeEnabled();
    await expect(page.getByRole('main')).toContainText('2 av 3 skickas, 1 lämnas kvar');
    await expect(rows(page).getByRole('listitem')).toHaveCount(4);
    expect(await draftOf(page)).not.toBeNull();
  });
});

test.describe('the item’s page as the review on a phone: the same page, stacked (D73 amended 2026-11-12, D142)', () => {
  test.use({ viewport: phone });

  test('the item in Att göra is its page, which is the review, no sheet; a step opens on its document with the verb pinned under it; Back gives the focus to the row in the queue', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/todo');
    // Where the pane does not fit there is no pane: the item is its page (D126 rule 2), and its page is the review.
    const row = page.locator('#work-fakturor').getByRole('link');
    await row.click();
    await expect(page).toHaveURL(FROM_QUEUE);
    await expect(title(page, INVOICES)).toBeVisible();
    await expect(page.getByRole('main').getByRole('link', { name: 'Granska 3' })).toHaveCount(0);
    await expect(page.getByRole('dialog')).toHaveCount(0);
    // The document above the decision; on a phone a step opens on its document, the verb a thumb's reach below it.
    const img = page.getByRole('img', { name: /Energibolaget AB/ });
    await expect(img).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Underlag från ekonomisystemet' })).toBeFocused();
    // The decision is pinned at the window's foot and nothing of the assistant's stands in it or over it: the one
    // "Fråga AI" is by the title (D138 as amended 2026-11-20, `ask-pane.spec.ts`).
    await expect(page.getByRole('link', { name: 'Fråga AI', exact: true })).toHaveCount(0);
    const door = page.getByRole('button', { name: 'Fråga AI', exact: true });
    await expect(door).toHaveCount(1);
    await expect(footer(page).getByRole('button', { name: 'Fråga AI', exact: true })).toHaveCount(0);
    const [paper, button] = [await img.boundingBox(), await verb(page).boundingBox()];
    expect(paper!.y).toBeLessThan(button!.y);
    await expect(verb(page)).toBeInViewport();
    // The item about itself is under the step, not beside it.
    await expect(about(page)).toHaveCount(0);
    await expect(page.getByRole('main').getByRole('region', { name: 'Uppgifter' })).toBeAttached();
    await expect(page.getByRole('main').getByRole('button', { name: 'Varför ser jag detta?' })).toBeAttached();
    await expectNoAxeViolations(page);
    await page.screenshot({ path: 'test-results/review-page-phone.png' });
    await page.getByRole('button', { name: 'Lämna kvar' }).click();
    await expect(page).toHaveURL(`${FROM_QUEUE}&step=2`);
    await expect(rowHeading(page, ROWS[1]!)).toBeVisible();
    await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('2 av 3'));
    await verb(page).click();
    await expect(page).toHaveURL(`${FROM_QUEUE}&step=3`);
    expect(await reflowProblems(page)).toEqual([]);
    // The steps took no place in the history: Back is the queue, the focus on the row that was pressed.
    await page.goBack();
    await expect(page).toHaveURL('/todo');
    await expect(row).toBeFocused();
    expect(await draftOf(page)).not.toBeNull();
    // In again: the page opens where the next press is, the first row not judged, with the decisions kept.
    await row.click();
    await expect(page).toHaveURL(FROM_QUEUE);
    await expect(rowHeading(page, ROWS[2]!)).toBeVisible();
    await page.getByRole('button', { name: 'Hoppa över' }).click();
    await expect(page.getByRole('main')).toContainText('1 av 3 skickas, 1 lämnas kvar, 1 är inte bedömd');
    expect(api.threads.find(t => t.id === 'fakturor')!.state).toBe('open');
  });

  test('narrowing the page to a phone keeps the step and the decisions', async ({ page, api }) => {
    reviewed(api);
    await page.setViewportSize(desktop);
    await open(page, '/items/fakturor');
    await verb(page).click();
    await expect(page).toHaveURL('/items/fakturor?step=2');
    await page.setViewportSize(phone);
    await expect(rowHeading(page, ROWS[1]!)).toBeVisible();
    await expect(page).toHaveURL('/items/fakturor?step=2');
    await page.getByRole('button', { name: 'Hoppa över' }).click();
    await page.getByRole('button', { name: 'Hoppa över' }).click();
    await expect(page.getByRole('main')).toContainText('1 av 3 skickas, 2 är inte bedömda');
  });

  test('below five rows on a phone a row already judged is reached again to change its decision (2.1.1, 3.3.4)', async ({
    page,
    api,
  }) => {
    reviewed(api);
    await open(page, '/items/fakturor');
    await page.getByRole('button', { name: 'Lämna kvar' }).click();
    await expect(rowHeading(page, ROWS[1]!)).toBeVisible();
    // The steps are a bare track at this width: "Föregående" under them leads back to the row.
    const first = page
      .getByRole('navigation', { name: 'Granskningens rader' })
      .getByRole('button', { name: 'Föregående' });
    await expect(first).toBeVisible();
    await first.click();
    await expect(page).toHaveURL('/items/fakturor?step=1');
    await expect(rowHeading(page, ROWS[0]!)).toBeVisible();
    await verb(page).click();
    await page.getByRole('button', { name: 'Hoppa över' }).click();
    await page.getByRole('button', { name: 'Hoppa över' }).click();
    await expect(page.getByRole('main')).toContainText('1 av 3 skickas, 2 är inte bedömda');
  });

  test('below five rows on a phone every row of a sent decision is read, not only the one the page opens at', async ({
    page,
    api,
  }) => {
    sent(api, { 2: 'failed' });
    await open(page, '/items/fakturor');
    await expect(title(page, INVOICES)).toBeFocused();
    await expect(rowHeading(page, ROWS[2]!)).toBeVisible();
    const before = page
      .getByRole('navigation', { name: 'Granskningens rader' })
      .getByRole('button', { name: 'Föregående' });
    await expect(before).toBeVisible();
    await before.click();
    await expect(page).toHaveURL('/items/fakturor?step=2');
    await before.click();
    await expect(page).toHaveURL('/items/fakturor?step=1');
    await expect(rowHeading(page, ROWS[0]!)).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Underlag från Ekonomisystemet' })).toBeFocused();
  });
});

test.describe('the item’s page as the review at 320 px', () => {
  test.use({ viewport: narrow });

  for (const [name, count] of [
    ['3 rows', 3],
    ['12 rows', 12],
  ] as const)
    test(`reflows without sideways scrolling, a step and the summary, with ${name}`, async ({ page, api }) => {
      invoices(api, count);
      await open(page, FROM_TODO);
      await expect(title(page, INVOICES)).toBeVisible();
      await expect(page.getByRole('img', { name: /Leverantör 1/ })).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      expect(await sideways(page)).toBeLessThanOrEqual(0);
      // From five rows Översikt is the way to the last step; below five the rows are passed one at a time.
      if (count >= 5) await page.getByRole('button', { name: 'Översikt', exact: true }).click();
      else for (let n = 0; n < count; n++) await page.getByRole('button', { name: 'Hoppa över' }).click();
      await expect(rowHeading(page, 'Det du valt')).toBeVisible();
      expect(await reflowProblems(page)).toEqual([]);
      expect(await sideways(page)).toBeLessThanOrEqual(0);
      await expectNoAxeViolations(page);
    });
});

/**
 * One page before the decision is sent and after it (D142): each state passes axe and stays inside the window at the
 * desktop's, a phone's and the reflow limit's width, with three rows (the steps) and with twelve (the bar and the list).
 */
test.describe('the item’s page before and after it is sent, at every width', () => {
  for (const viewport of [desktop, phone, narrow])
    for (const count of [3, 12]) {
      test(`before it is sent, ${count} rows at ${viewport.width} px: axe passes and nothing scrolls sideways`, async ({
        page,
        api,
      }) => {
        await page.setViewportSize(viewport);
        invoices(api, count);
        await open(page, '/items/fakturor');
        await expect(title(page, INVOICES)).toBeVisible();
        await expect(page.getByRole('img', { name: /Leverantör 1/ })).toBeVisible();
        await expect(footer(page)).toBeVisible();
        await expectNoAxeViolations(page);
        expect(await sideways(page)).toBeLessThanOrEqual(0);
        if (viewport.width <= phone.width) expect(await reflowProblems(page)).toEqual([]);
      });
      test(`after it is sent, ${count} rows at ${viewport.width} px: axe passes and nothing scrolls sideways`, async ({
        page,
        api,
      }) => {
        await page.setViewportSize(viewport);
        invoices(api, count);
        sent(api, { 2: 'failed' });
        await open(page, '/items/fakturor');
        await expect(title(page, INVOICES)).toBeFocused();
        await expect(rowHeading(page, 'Leverantör 3 · 1 000 kr')).toBeVisible();
        await expect(page.getByRole('img', { name: /Leverantör 3/ })).toBeVisible();
        await expect(page.getByRole('button', { name: 'Granska avvisade igen' })).toBeVisible();
        await expectReadOnly(page);
        if (count >= 5) {
          await expect(page.getByRole('progressbar', { name: 'Bekräftade rader' })).toHaveAttribute(
            'aria-valuenow',
            '11',
          );
          await expect(page.getByText('11 av 12 bekräftade')).toBeVisible();
          await expect(page.getByRole('button', { name: 'Visa rad 1: Leverantör 1 · 1 000 kr' })).toBeAttached();
        }
        await expectNoAxeViolations(page);
        expect(await sideways(page)).toBeLessThanOrEqual(0);
        if (viewport.width <= phone.width) expect(await reflowProblems(page)).toEqual([]);
        if (count === 3) await page.screenshot({ path: `test-results/review-page-sent-${viewport.width}.png` });
      });
    }
});
