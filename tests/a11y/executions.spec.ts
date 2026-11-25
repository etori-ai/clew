import { announcements, desktop, expect, expectNoAxeViolations, narrow, open, reflowProblems, test } from './support';

for (const [layout, viewport] of [
  ['desktop', desktop],
  ['narrow', narrow],
] as const)
  test.describe('durable decisions ' + layout, () => {
    test.use({ viewport });
    for (const state of ['pending', 'running', 'unknown'] as const)
      test(state + ' is truthful, operable and has no axe violations', async ({ page, api }) => {
        const card = api.threads.find(t => t.id === 'fakturor')!;
        card.execution = {
          id: 'execution-fixture',
          decisionId: 'decision-fixture',
          operation: 'finance.approve',
          state,
          reason: null,
          compensates: null,
        };
        api.threads = [card];
        // The work item in Att göra (D112): beside the queue on a desktop, whose row says where it stands, alone at 320 px.
        await open(page, '/todo?item=fakturor');
        // The row and the item's notice say the state in one word (D126 item 13), and the notice says why.
        if (layout === 'desktop')
          await expect(page.locator('#work-fakturor')).toContainText(state === 'unknown' ? 'Obekräftat' : 'Skickas');
        await expect(
          page.getByText(
            state === 'unknown' ? 'Utfallet är inte bekräftat' : 'Skickar ditt beslut till Ekonomisystemet',
            { exact: true },
          ),
        ).toBeVisible();
        const check = page.getByRole('button', { name: 'Kontrollera status' });
        await expect(check).toBeVisible();
        await expect(page.getByRole('button', { name: /^Attestera ·/ })).toHaveCount(0);
        await check.focus();
        await expect(check).toBeFocused();
        let release!: () => void, arrived!: () => void;
        const gate = new Promise<void>(resolve => {
          release = resolve;
        });
        const requested = new Promise<void>(resolve => {
          arrived = resolve;
        });
        await page.route('**/api/threads/fakturor/execution/check', async route => {
          arrived();
          await gate;
          await route.fulfill({ json: card });
        });
        await check.press('Enter');
        await requested;
        await expect(check).toBeVisible();
        await expect(check).toBeFocused();
        await expect(page.getByRole('button', { name: /^(Attestera|Inte nu)/ })).toHaveCount(0);
        release();
        await expect(check).toBeFocused();
        await expectNoAxeViolations(page);
        expect(await reflowProblems(page)).toEqual([]);
      });
    test('a started action not sent because the user name moved says so, and its own button decides again (D122)', async ({
      page,
      api,
    }) => {
      // A card started from a person's menu (D97): its row names Anna by her id, and its button is the decision.
      const card = api.threads.find(t => t.id === 'fakturor')!;
      Object.assign(card, {
        title: 'Markera för uppföljning',
        topic: 'started:hr.flag:fixture:person:person',
        items: [
          {
            ref: 'person:anna',
            label: 'Anna Lindqvist',
            detail: 'Bergsåkers skola',
            selectable: false,
            subject: { entity: 'person', key: 'anna' },
          },
        ],
        actions: [
          {
            id: 'decide',
            label: 'Markera för uppföljning',
            capability: 'hr.flag',
            kind: 'execute',
            role: 'primary',
            input: { person: 'anna' },
          },
        ],
        execution: {
          id: 'execution-fixture',
          decisionId: 'decision-fixture',
          operation: 'hr.flag',
          state: 'failed',
          reason: 'subject-changed',
          compensates: null,
        },
      });
      api.threads = [card];
      await open(page, '/todo?item=fakturor');
      // The notice: what (nothing was sent), why, and the decision again as its one move (D126 item 13).
      await expect(page.getByText('Inget skickades', { exact: true })).toBeVisible();
      await expect(
        page.getByText('Personen har inte längre det användarnamn som beslutet gällde. Fatta beslutet igen.', {
          exact: true,
        }),
      ).toBeVisible();
      // Nothing was sent, so there is nothing to check: the way on is the decision, on the name Anna has now.
      await expect(page.getByRole('button', { name: 'Kontrollera status' })).toHaveCount(0);
      const decide = page.getByRole('button', { name: 'Markera för uppföljning', exact: true });
      await expect(decide).toBeVisible();
      await expectNoAxeViolations(page);
      expect(await reflowProblems(page)).toEqual([]);
      await decide.focus();
      await expect(decide).toBeFocused();
      await decide.press('Enter');
      await expect.poll(() => api.acted.map(a => [a.threadId, a.body.actionId])).toEqual([['fakturor', 'decide']]);
    });
    test('a decision in doubt is let go from ⋯ once the person says they saw the source, and the item is decided again (DE-M1, DE-M2)', async ({
      page,
      api,
    }) => {
      const card = api.threads.find(t => t.id === 'fakturor')!;
      card.execution = {
        id: 'execution-fixture',
        decisionId: 'decision-fixture',
        operation: 'finance.approve',
        state: 'unknown',
        reason: null,
        compensates: null,
      };
      api.threads = [card];
      await open(page, '/todo?item=fakturor');
      // Beside the queue on a desktop, the page's own at 320 px.
      const item =
        layout === 'desktop' ? page.getByRole('complementary', { name: 'Valt ärende' }) : page.getByRole('main');
      await expect(item.getByText('Utfallet är inte bekräftat', { exact: true })).toBeVisible();
      // Kontrollera status stays the notice's move; letting it go is under ⋯, and asks first.
      await expect(item.getByRole('button', { name: 'Kontrollera status' })).toBeVisible();
      const more = item.getByRole('button', { name: 'Fler åtgärder' });
      await more.focus();
      await more.press('Enter');
      await page.getByRole('menuitem', { name: 'Markera som inte genomfört' }).press('Enter');
      const dialog = page.getByRole('alertdialog', { name: 'Markera beslutet som inte genomfört?' });
      await expect(dialog).toBeVisible();
      await expect(dialog).toContainText('Gör det bara om du har sett i Ekonomisystemet att det inte gick igenom.');
      await expect(dialog).toContainText('Gick det ändå igenom gör ett nytt beslut samma sak en gång till.');
      await expectNoAxeViolations(page);
      // Avbryt lets nothing go, and the focus is back on ⋯.
      await page.keyboard.press('Escape');
      await expect(dialog).toBeHidden();
      await expect(more).toBeFocused();
      expect(api.released).toEqual([]);
      await more.press('Enter');
      await page.getByRole('menuitem', { name: 'Markera som inte genomfört' }).press('Enter');
      await dialog.getByRole('button', { name: 'Markera som inte genomfört' }).press('Enter');
      await expect.poll(() => api.released).toEqual(['fakturor']);
      // The notice says what holds now, aloud too, and the way on is the item's own decision.
      await expect(item.getByText('Markerat som inte genomfört', { exact: true })).toBeVisible();
      await expect
        .poll(() => announcements(page))
        .toContainEqual(expect.stringContaining('Markerat som inte genomfört'));
      await expect(item.getByRole('button', { name: 'Kontrollera status' })).toHaveCount(0);
      // The dialog gives the focus back to ⋯, which still holds the item's other moves: it is not lost to the page.
      await expect(more).toBeFocused();
      await expectNoAxeViolations(page);
      expect(await reflowProblems(page)).toEqual([]);
      const decide = item.getByRole('button', { name: /^Attestera/ });
      const shown = api.threads.find(t => t.id === 'fakturor')!.updatedAt;
      await decide.focus();
      await decide.press('Enter');
      // A new decision, on the item as it was drawn after it was let go.
      await expect.poll(() => api.acted.map(a => [a.threadId, a.body.version])).toEqual([['fakturor', shown]]);
    });
    test('a decision the source confirmed in part is let go for the rest, and the rows it got done are not chosen again (DE-M1, DE-M2)', async ({
      page,
      api,
    }) => {
      const card = api.threads.find(t => t.id === 'fakturor')!;
      card.execution = {
        id: 'execution-fixture',
        decisionId: 'decision-fixture',
        operation: 'finance.approve',
        state: 'unknown',
        reason: null,
        compensates: null,
      };
      // The first invoice was confirmed, the second never answered for.
      card.receipt = {
        at: '2026-11-04T08:00:00.000Z',
        headline: 'En attesterad, en obekräftad.',
        undoUntil: null,
        undoCapability: null,
        rows: [
          { ref: 'finance:inv:1', label: card.items[0]!.label, outcome: 'done', detail: 'Attesterad.' },
          { ref: 'finance:inv:2', label: card.items[1]!.label, outcome: 'unknown', detail: 'Inget besked.' },
        ],
      };
      api.threads = [card];
      await open(page, '/todo?item=fakturor');
      const item =
        layout === 'desktop' ? page.getByRole('complementary', { name: 'Valt ärende' }) : page.getByRole('main');
      const more = item.getByRole('button', { name: 'Fler åtgärder' });
      await more.focus();
      await more.press('Enter');
      await page.getByRole('menuitem', { name: 'Markera som inte genomfört' }).press('Enter');
      await page
        .getByRole('alertdialog', { name: 'Markera beslutet som inte genomfört?' })
        .getByRole('button', { name: 'Markera som inte genomfört' })
        .press('Enter');
      await expect.poll(() => api.released).toEqual(['fakturor']);
      // The confirmed row stays done: the notice is about the rows the source did not confirm, aloud too.
      const said =
        'Clew väntar inte längre på besked från Ekonomisystemet om de rader som inte bekräftades. Fatta beslutet igen för dem om det behövs.';
      await expect(item.getByText(said, { exact: true })).toBeVisible();
      await expect
        .poll(() => announcements(page))
        .toContainEqual(expect.stringContaining('Markerat som inte genomfört'));
      await expectNoAxeViolations(page);
      expect(await reflowProblems(page)).toEqual([]);
      const decide = item.getByRole('button', { name: /^Attestera/ });
      await decide.focus();
      await decide.press('Enter');
      // The decision again is on the second invoice alone: the first is not sent twice.
      await expect.poll(() => api.acted.map(a => a.body.refs)).toEqual([['finance:inv:2']]);
    });
  });

/**
 * Once the person has decided, the item's buttons give way to its status notice (D126 item 13). The server records the
 * decision and queues it (D45), and the source's answer reaches the page as a notice on the change stream (D46). While
 * it is on its way the pressed button shows it for a while (`SETTLE_MS`); a source that answers within that replaces
 * the button with the receipt. The button that had the focus is gone, so the focus goes to the item's title, which the
 * notice stands under, and the notice is said aloud, since a Banner is no live region (4.1.3).
 */
test('a decision the source answers at once: the receipt replaces the button, the focus goes to the item’s title and the receipt is announced', async ({
  page,
  api: _,
}) => {
  await page.setViewportSize(desktop);
  await open(page, '/todo?item=fakturor');
  const pane = page.getByRole('complementary', { name: 'Valt ärende' });
  const decide = pane.getByRole('button', { name: 'Attestera 2 valda' });
  await decide.focus();
  await page.keyboard.press('Enter');
  await expect(pane.getByText('2 fakturor attesterade', { exact: true })).toBeVisible();
  await expect(decide).toHaveCount(0);
  await expect(pane.getByRole('heading', { level: 2, name: 'Attestera 3 fakturor, 48 200 kr' })).toBeFocused();
  // The receipt's words are said as it arrives (the notice's title is its headline).
  await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('2 fakturor attesterade'));
  // The row says the same word as the notice.
  await expect(page.locator('#work-fakturor')).toContainText('Klart');
  await expectNoAxeViolations(page);
});

/**
 * A decision is on the item as the person was shown it (AM-4). The source changes the item after the page drew it: the
 * decision is refused and says why in an alert, the focus stays on the pressed button, the item is read again so it
 * shows what it says now, and the next press decides on that, with the version the person now sees. Beside the queue on
 * a desktop, alone at 320 px.
 */
for (const [layout, viewport] of [
  ['desktop', desktop],
  ['narrow', narrow],
] as const)
  test(`a decision on an item that changed since it was drawn is refused, says why, and the item shows what it says now (${layout})`, async ({
    page,
    api,
  }) => {
    await page.setViewportSize(viewport);
    await open(page, '/todo?item=fakturor');
    const pane =
      layout === 'desktop' ? page.getByRole('complementary', { name: 'Valt ärende' }) : page.getByRole('main');
    await expect(pane.getByRole('heading', { name: 'Attestera 3 fakturor, 48 200 kr' })).toBeVisible();
    const card = api.threads.find(t => t.id === 'fakturor')!;
    const shown = card.updatedAt;
    card.title = 'Attestera 3 fakturor, 51 900 kr';
    card.updatedAt = new Date(Date.parse(shown) + 60_000).toISOString();
    const decide = pane.getByRole('button', { name: 'Attestera 2 valda' });
    await decide.focus();
    await page.keyboard.press('Enter');
    await expect(pane.getByRole('alert')).toHaveText(
      'Ärendet har ändrats sedan du öppnade det. Se över det och besluta igen.',
    );
    await expect(pane.getByRole('heading', { name: 'Attestera 3 fakturor, 51 900 kr' })).toBeVisible();
    await expect(pane.getByText('2 fakturor attesterade', { exact: true })).toHaveCount(0);
    await expect(decide).toBeFocused();
    await expectNoAxeViolations(page);
    expect(await reflowProblems(page)).toEqual([]);
    await page.keyboard.press('Enter');
    await expect(pane.getByText('2 fakturor attesterade', { exact: true })).toBeVisible();
    expect(api.acted.map(a => a.body.version)).toEqual([shown, card.updatedAt]);
  });

/**
 * A source slower than the button's window: the first notice says that the decision waits on the source, and the
 * receipt replaces it when the source answers, with nobody touching anything. The focus stays on the title while the
 * notice changes, each notice is said, and Ångra, which comes with the receipt, is reached from the title.
 */
test('a decision the source answers later: the waiting notice, then the receipt, each announced, the focus kept on the title, and Ångra reached from it', async ({
  page,
  api,
}) => {
  await page.setViewportSize(desktop);
  api.holdSettle = true;
  await open(page, '/todo?item=fakturor');
  const pane = page.getByRole('complementary', { name: 'Valt ärende' });
  const title = pane.getByRole('heading', { level: 2, name: 'Attestera 3 fakturor, 48 200 kr' });
  const decide = pane.getByRole('button', { name: 'Attestera 2 valda' });
  await decide.focus();
  await page.keyboard.press('Enter');
  // Approved and queued: once the button's window has passed (`SETTLE_MS`, 4 s), the notice says so, the button is
  // gone, and the focus is on the title.
  const waiting = pane.getByText('Skickar ditt beslut till Ekonomisystemet', { exact: true });
  await expect(waiting).toBeVisible({ timeout: 10_000 });
  await expect(decide).toHaveCount(0);
  await expect(title).toBeFocused();
  await expect
    .poll(() => announcements(page))
    .toContainEqual(expect.stringContaining('Skickar ditt beslut till Ekonomisystemet'));
  await expect(pane.getByRole('button', { name: /^Ångra/ })).toHaveCount(0);
  await expectNoAxeViolations(page);
  // The source answers: the receipt replaces the notice and is said as it arrives, and the focus has not moved.
  await api.settle();
  await expect(pane.getByText('2 fakturor attesterade', { exact: true })).toBeVisible();
  await expect(waiting).toHaveCount(0);
  await expect.poll(() => announcements(page)).toContainEqual(expect.stringContaining('2 fakturor attesterade'));
  await expect(title).toBeFocused();
  await expect(page.locator('#work-fakturor')).toContainText('Klart');
  // Ångra came with the receipt, under the title, where Tab reaches it.
  const undo = pane.getByRole('button', { name: /^Ångra · / });
  await expect(undo).toBeVisible();
  for (let i = 0; i < 10 && !(await undo.evaluate(el => el === document.activeElement)); i++)
    await page.keyboard.press('Tab');
  await expect(undo).toBeFocused();
  await expectNoAxeViolations(page);
});

test('a policy update removes retained source content without a page reload', async ({ page, api }) => {
  await page.addInitScript(() => {
    class TestEventSource {
      onmessage: ((event: { data: string }) => void) | null = null;
      constructor() {
        (window as unknown as { emitChange: (data: object) => void }).emitChange = data =>
          this.onmessage?.({ data: JSON.stringify(data) });
      }
      close() {}
    }
    window.EventSource = TestEventSource as unknown as typeof EventSource;
  });
  const title = api.threads[0]!.title;
  await open(page, '/');
  await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
  await page.evaluate(() =>
    (window as unknown as { emitChange(data: object): void }).emitChange({ revision: '1', policy: '1:1' }),
  );
  api.threads = [];
  await page.evaluate(() =>
    (window as unknown as { emitChange(data: object): void }).emitChange({ revision: '2', policy: '2:1' }),
  );
  await expect(page.getByText(title, { exact: true })).toHaveCount(0);
});

/**
 * The planning card's own decision in doubt (DE-M2): the card says it and stops, with Kontrollera status and the way to
 * let it go beside it. Let go, the card sends its times again (DE-M1), and the focus is on the card, since the button
 * that had it is gone with the doubt.
 */
for (const [layout, viewport] of [
  ['desktop', desktop],
  ['narrow', narrow],
] as const)
  test(`a planning card whose invitations are in doubt is let go and sends its times again (DE-M1, DE-M2, ${layout})`, async ({
    page,
    api,
  }) => {
    await page.setViewportSize(viewport);
    const samtal = api.threads.find(t => t.id === 'samtal')!;
    samtal.execution = {
      id: 'execution-samtal',
      decisionId: 'calendar:samtal:1',
      operation: 'calendar.confirmProposals',
      state: 'unknown',
      reason: null,
      compensates: null,
    };
    await open(page, '/todo?item=samtal');
    // Beside the queue on a desktop, the page's own at 320 px.
    const card = (
      layout === 'desktop' ? page.getByRole('complementary', { name: 'Valt ärende' }) : page.getByRole('main')
    ).locator('#card-samtal, #thread-samtal');
    await expect(card.getByRole('status').filter({ hasText: 'Källans besked saknas.' })).toBeVisible();
    await expect(card.getByRole('button', { name: /^Skicka/ })).toHaveCount(0);
    const letGo = card.getByRole('button', { name: 'Markera som inte genomfört' });
    await letGo.focus();
    await letGo.press('Enter');
    const dialog = page.getByRole('alertdialog', { name: 'Markera beslutet som inte genomfört?' });
    await expect(dialog).toBeVisible();
    await expectNoAxeViolations(page);
    await dialog.getByRole('button', { name: 'Avbryt' }).press('Enter');
    await expect(dialog).toBeHidden();
    await expect(letGo).toBeFocused();
    expect(api.released).toEqual([]);
    await letGo.press('Enter');
    await dialog.getByRole('button', { name: 'Markera som inte genomfört' }).press('Enter');
    await expect.poll(() => api.released).toEqual(['samtal']);
    await expect(
      card.getByRole('status').filter({ hasText: 'Beslutet är markerat som inte genomfört.' }),
    ).toBeVisible();
    await expect(card.getByRole('button', { name: 'Kontrollera status' })).toHaveCount(0);
    await expect(card.getByRole('button', { name: 'Skicka 2 inbjudningar' })).toBeVisible();
    await expect(card).toBeFocused();
    await expect
      .poll(() => announcements(page))
      .toContainEqual(expect.stringContaining('Beslutet är markerat som inte genomfört.'));
    await expectNoAxeViolations(page);
    expect(await reflowProblems(page)).toEqual([]);
  });
