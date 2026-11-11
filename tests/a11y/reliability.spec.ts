import { expect, expectNoAxeViolations, narrow, open, reflowProblems, test } from './support';
import { NOW } from './data';

test('an untouched tab announces a committed reminder after a change notification', async ({ page, api }) => {
  await page.addInitScript(() => {
    class TestEventSource {
      onmessage: ((event: { data: string }) => void) | null = null;
      constructor() {
        (window as unknown as { emitChange(data: object): void }).emitChange = data =>
          this.onmessage?.({ data: JSON.stringify(data) });
      }
      close() {}
    }
    window.EventSource = TestEventSource as unknown as typeof EventSource;
  });
  await open(page, '/calendar');
  await page.evaluate(() =>
    (window as unknown as { emitChange(data: object): void }).emitChange({ revision: '1', policy: '1:1' }),
  );
  const thread = api.threads.find(t => t.id === 'ledighet')!;
  api.deliveries = [{ id: 'untouched-reminder', threadId: thread.id, kind: 'reminder' }];
  await page.evaluate(() =>
    (window as unknown as { emitChange(data: object): void }).emitChange({ revision: '2', policy: '1:1' }),
  );
  await expect(
    page.getByRole('region', { name: 'Aviseringar' }).getByText('Påminnelse: ' + thread.title, { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  expect(api.deliveryClaims).toEqual(['untouched-reminder']);
});

test('two tabs and a reconnect announce a persisted reminder once; Visa opens its card', async ({
  page,
  context,
  api,
}) => {
  const second = await context.newPage();
  await second.clock.setFixedTime(new Date(NOW));
  await second.route('**/api/**', route => api.handle(route));
  const thread = api.threads.find(t => t.id === 'ledighet')!;
  api.deliveries = [{ id: 'reminder-ledighet-v2-1', threadId: thread.id, kind: 'reminder' }];
  try {
    await Promise.all([open(page, '/calendar'), open(second, '/')]);
    await expect.poll(() => api.deliveryClaims.length).toBe(1);
    const body = 'Påminnelse: ' + thread.title;
    await expect
      .poll(
        async () =>
          (await page.getByRole('region', { name: 'Aviseringar' }).getByText(body, { exact: true }).count()) +
          (await second.getByRole('region', { name: 'Aviseringar' }).getByText(body, { exact: true }).count()),
      )
      .toBe(1);
    const winner = (await page.getByRole('region', { name: 'Aviseringar' }).getByText(body, { exact: true }).count())
      ? page
      : second;
    await winner
      .getByRole('region', { name: 'Aviseringar' })
      .getByRole('button', { name: 'Visa', exact: true })
      .click();
    // Visa opens the card over the page the toast was on, Kalender or Hem, never taking the person elsewhere (D107).
    await expect(winner).toHaveURL(winner === page ? '/calendar?card=ledighet' : '/?card=ledighet');
    await expect(winner.getByRole('article', { name: 'Kort: ' + thread.title })).toBeVisible();
    await Promise.all([page.reload(), second.reload()]);
    await expect(page.getByRole('region', { name: 'Aviseringar' }).getByText(body)).toHaveCount(0);
    await expect(second.getByRole('region', { name: 'Aviseringar' }).getByText(body)).toHaveCount(0);
    expect(api.deliveryClaims).toEqual(['reminder-ledighet-v2-1']);
  } finally {
    await second.close();
  }
});
for (const state of ['queued', 'blocked'] as const)
  test(`a ${state} timer is visible at 320 px without claiming delivery`, async ({ page, api }) => {
    const card = api.threads.find(t => t.id === 'ledighet')!;
    card.timers = [{ kind: 'reminder', dueAt: '2026-11-05T10:00:00.000Z', state }];
    api.threads = [card];
    await page.setViewportSize(narrow);
    await open(page, '/');
    // Hem draws rows (D63): the row says the state in its own idiom, words on the line for a reminder that waits and a
    // badge for one that was stopped, and never that it will remind.
    const row = page.getByRole('main').locator('#thread-ledighet');
    if (state === 'queued') await expect(row).toContainText('påminnelsen väntar på schemaläggning');
    else await expect(row.getByText('Påminnelsen stoppad', { exact: true })).toBeVisible();
    await expect(row).not.toContainText('påminner dig');
    await expectNoAxeViolations(page);
    expect(await reflowProblems(page)).toEqual([]);
    // The whole sentence is the open card's, in the sheet at this width (artboard 12).
    await row.getByRole('link', { name: card.title, exact: true }).click();
    await expect(
      page
        .getByRole('dialog', { name: 'Kort: ' + card.title })
        .getByRole('status')
        .filter({
          hasText:
            state === 'queued'
              ? 'Påminnelsen är sparad och väntar på schemaläggning.'
              : /Påminnelsen stoppades eftersom/,
        }),
    ).toBeVisible();
    await expectNoAxeViolations(page);
    expect(await reflowProblems(page)).toEqual([]);
  });
test('an empty local view with an unavailable source says it is awaiting evidence', async ({ page, api }) => {
  api.threads = [];
  api.sources = [{ connector: 'reference', lastSuccess: null, state: 'failed', error: 'unavailable' }];
  await open(page, '/');
  await expect(page.getByRole('heading', { name: 'Inväntar källornas besked' })).toBeVisible();
  await expect(page.getByText('Lugnt läge', { exact: true })).toHaveCount(0);
  await expectNoAxeViolations(page);
});
