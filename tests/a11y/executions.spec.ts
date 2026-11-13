import { desktop, expect, expectNoAxeViolations, narrow, open, reflowProblems, test } from './support';

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
        if (layout === 'desktop')
          await expect(page.locator('#work-fakturor').getByRole('img')).toHaveAccessibleName(
            state === 'unknown' ? 'Behöver kontrolleras' : 'Väntar på källan',
          );
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
    test('a started action not sent because the user name moved says so, and its own button decides again (D116)', async ({
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
      await expect(
        page.getByText(
          'Personen har inte längre det användarnamn som beslutet gällde. Inget skickades. Fatta beslutet igen.',
        ),
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
