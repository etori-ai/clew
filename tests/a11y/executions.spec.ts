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
  });

/**
 * Once the person has decided, the item's buttons give way to its status notice (D126 item 13): what came of it, why
 * and since when, and the one move the state calls for. The button that had the focus is gone, so the focus goes to the
 * item's title, which the notice stands under, and the notice is said aloud, since a Banner is no live region.
 */
test('a decision replaced by its notice: the focus goes to the item’s title and the notice is announced', async ({
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
