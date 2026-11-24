import { expect, expectNoAxeViolations, narrow, open, reflowProblems, test, workRowLines } from './support';
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
    // Visa opens the work item's page, with the page the toast was on, Kalender or Hem, as the way back (D126 rule 1:
    // nothing opens over a page).
    await expect(winner).toHaveURL(winner === page ? '/items/ledighet?from=%2Fcalendar' : '/items/ledighet?from=%2F');
    await expect(winner.getByRole('heading', { level: 1, name: thread.title })).toBeVisible();
    await Promise.all([page.reload(), second.reload()]);
    await expect(page.getByRole('region', { name: 'Aviseringar' }).getByText(body)).toHaveCount(0);
    await expect(second.getByRole('region', { name: 'Aviseringar' }).getByText(body)).toHaveCount(0);
    expect(api.deliveryClaims).toEqual(['reminder-ledighet-v2-1']);
  } finally {
    await second.close();
  }
});
test('five deliveries at once are one toast, which leaves by itself', async ({ page, api }) => {
  api.deliveries = api.threads.slice(0, 5).map(t => ({ id: 'delivery:' + t.id, threadId: t.id, kind: 'automatic' }));
  await open(page, '/calendar');
  const toasts = page.getByRole('region', { name: 'Aviseringar' });
  await expect(toasts.getByText('Nya uppgifter finns i Att göra.', { exact: true })).toBeVisible();
  await expect.poll(() => api.deliveryClaims.length).toBe(5);
  // One card with one way on, however many arrived.
  await expect(toasts.getByRole('button', { name: 'Visa', exact: true })).toHaveCount(1);
  await expectNoAxeViolations(page);
  // Nobody has to close it: what it said is in Att göra (2.2.1 holds, since nothing is lost with it).
  await expect(toasts.getByRole('button', { name: 'Visa', exact: true })).toHaveCount(0, { timeout: 12_000 });
});
test('a reminder and new work together are one toast; Visa opens Att göra', async ({ page, api }) => {
  const [first, second] = api.threads;
  api.deliveries = [
    { id: 'reminded:' + first!.id, threadId: first!.id, kind: 'reminder' },
    { id: 'delivery:' + second!.id, threadId: second!.id, kind: 'automatic' },
  ];
  await open(page, '/calendar');
  const toasts = page.getByRole('region', { name: 'Aviseringar' });
  await expect(toasts.getByText('Påminnelser och nya uppgifter finns i Att göra.', { exact: true })).toBeVisible();
  await expect(toasts.getByRole('button', { name: 'Visa', exact: true })).toHaveCount(1);
  await toasts.getByRole('button', { name: 'Visa', exact: true }).click();
  await expect(page).toHaveURL('/todo');
  await expect(page.getByRole('heading', { level: 1, name: 'Att göra' })).toBeVisible();
  await expect(toasts.getByRole('button', { name: 'Visa', exact: true })).toHaveCount(0);
});
for (const state of ['queued', 'blocked'] as const)
  test(`a ${state} timer is visible at 320 px without claiming delivery`, async ({ page, api }) => {
    const card = api.threads.find(t => t.id === 'ledighet')!;
    card.timers = [{ kind: 'reminder', dueAt: '2026-11-05T10:00:00.000Z', state }];
    api.threads = [card];
    await page.setViewportSize(narrow);
    await open(page, '/todo');
    // Att göra draws rows, on a phone a list of them (D130 item 19, amended 2026-11-23): the row says the state, words
    // on the line for a reminder that waits and the vocabulary's mark with what it concerns for one that was stopped
    // (D126 item 13), and never that it will remind.
    const row = page.getByRole('main').locator('#work-ledighet');
    if (state === 'queued') await expect(row).toContainText('påminnelsen väntar på schemaläggning');
    else await expect(row).toContainText('Behöver dig\u00a0· påminnelsen stoppad');
    // The line is not clamped: at this width it takes the lines it needs, and all of it is drawn.
    expect(await workRowLines(row)).toMatchObject([{ cut: false }]);
    await expect(row).not.toContainText('påminner dig');
    await expectNoAxeViolations(page);
    expect(await reflowProblems(page)).toEqual([]);
    // The whole sentence is the work item's, its page alone on the surface at this width (D112 item 12).
    await row.getByRole('link').click();
    await expect(page.getByRole('heading', { level: 1, name: card.title })).toBeVisible();
    await expect(
      page
        .getByRole('main')
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
  // Hem never says that nothing needs the person while a source has not answered (D8); with nothing to draw it names the
  // source where its work items would be (D116, amended 2026-11-12), by its system's name or, unseen, as a source.
  const needs = page.getByRole('region', { name: 'Behöver dig' });
  await expect(needs.getByText('Inväntar källornas besked.')).toBeVisible();
  await expect(needs.getByText('En källa svarar inte.', { exact: true })).toBeVisible();
  await expect(page.getByText('Inget behöver dig just nu.', { exact: true })).toHaveCount(0);
  await expectNoAxeViolations(page);
});
test('a source not read yet is said over the work, and the pile is never called empty', async ({ page, api }) => {
  api.threads = [];
  api.sources = [{ connector: 'finance', lastSuccess: null, state: 'pending', error: null }];
  await open(page, '/');
  const needs = page.getByRole('region', { name: 'Behöver dig' });
  await expect(needs.getByRole('status')).toHaveText('Källorna kontrolleras. Sparade uppgifter visas under tiden.');
  await expect(needs.getByText('Inväntar källornas besked.')).toBeVisible();
  await expectNoAxeViolations(page);
});
