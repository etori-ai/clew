import type { Page } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
import type { DocumentBundle, PanelViewSpec, ReviewEvidence, ReviewRecovery } from '@clew/contracts';
import { desktop, expect, expectNoAxeViolations, narrow, open, reflowProblems, test, type MockApi } from './support';
import { fixtureConnectors } from '../fixture-connectors';
import { Registry } from '../registry';
import { user } from './data';

async function originals(page: Page, api: MockApi) {
  const registry = new Registry();
  fixtureConnectors({ only: ['finance'], clock: () => new Date('2026-11-04T08:00:00.000Z') }).connectors.forEach(c =>
    registry.register(c),
  );
  const actor = { ...user, role: 'manager' as const };
  const [draft] = await registry.scan(actor);
  const card = api.threads.find(t => t.id === 'fakturor')!;
  card.items = draft!.items!;
  card.actions = draft!.actions;
  const evidence: Record<string, ReviewEvidence> = {};
  const reads = { preview: 0, content: 0 };
  let unavailable = false;
  // A source whose record has moved on since it was read: the same documents under another revision.
  let revised = false;
  await page.route('**/api/cap/finance.*', async route => {
    const capability = new URL(route.request().url()).pathname.split('/').at(-1)!;
    const output = await registry.run(actor, capability, route.request().postDataJSON() ?? {});
    const view = registry.find(capability)!.capability.view!;
    await route.fulfill({
      json: {
        output,
        view: {
          ...view,
          capability,
          source: 'Ekonomisystemet',
          connector: 'finance',
          chip: false,
        } satisfies PanelViewSpec,
      },
    });
  });
  await page.route('**/api/threads/*/preview?*', async route => {
    reads.preview++;
    const ref = new URL(route.request().url()).searchParams.get('ref')!;
    const { document: read, recovery } = await registry.run<{ document: DocumentBundle; recovery: ReviewRecovery }>(
      actor,
      'finance.record',
      { ref },
    );
    const bundle = revised ? { ...read, revision: `${read.revision}-moved` } : read;
    evidence[ref] = {
      ref,
      revision: bundle.revision,
      documents: bundle.documents.map(d => ({ id: d.id, revision: d.revision })),
      expiresAt: '2026-11-04T10:00:00.000Z',
      proof: 'a'.repeat(64),
    };
    await route.fulfill({
      json: { kind: 'documents', capability: 'finance.record', bundle, evidence: evidence[ref], recovery },
    });
  });
  await page.route('**/api/documents/content?*', async route => {
    reads.content++;
    if (unavailable) return route.fulfill({ status: 403, json: { error: 'Underlaget kan inte längre läsas.' } });
    const request = JSON.parse(new URL(route.request().url()).searchParams.get('request')!);
    const content = await registry.document(actor, request);
    await route.fulfill({ body: Buffer.from(content.bytes), contentType: content.mediaType });
  });
  return {
    evidence,
    reads,
    outage: (value: boolean) => (unavailable = value),
    revise: (value: boolean) => (revised = value),
    correct: (input: unknown) => registry.run(actor, 'finance.correct', input),
  };
}
/** The invoices' own page, which is their review (D142), with Att göra's pane as its way back. */
const REVIEW = '/items/fakturor?from=%2Ftodo%3Fitem%3Dfakturor';
/** The item's title, which is the page's heading before the decision is sent and after it. */
const INVOICES = /^Attestera 3 fakturor/;
/** The rows as the steps under the title (below five rows): each a button named with its row, Skicka last. */
const stepsOf = (page: Page) => page.getByRole('main').getByRole('list', { name: 'Rader', exact: true });
/** One thing's own page (D126 rule 1), as a row's name in a register or an answer's link leads to it. */
const viewHref = (capability: string, ref?: string) =>
  `/tools/${capability}?${ref ? 'input=' + encodeURIComponent(JSON.stringify({ ref })) + '&' : ''}title=Underlag`;

test.describe('the shared document and semantic catalogue', () => {
  test.use({ viewport: desktop });
  for (const viewport of [desktop, narrow])
    test(`a confirmed review reopens from Klart after its undo window at ${viewport.width}px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize(viewport);
      await originals(page, api);
      const card = api.threads.find(t => t.id === 'fakturor')!;
      card.state = 'handled';
      card.handledAt = '2026-11-04T07:00:00.000Z';
      card.receipt = {
        at: card.handledAt,
        headline: 'Tre fakturor attesterade.',
        undoUntil: '2026-11-04T07:10:00.000Z',
        undoCapability: 'finance.unapprove',
        rows: card.items.map(i => ({ ref: i.ref, label: i.label, outcome: 'done', detail: 'Attesterad.' })),
      };
      await open(page, '/todo?tab=done');
      // The row opens its work item beside Klart, where "Visa granskning" leads to the item's page, or straight to the
      // item's page where the pane does not fit (D126 rule 2). That page is the review, read (D142), with where the
      // item was shown as its way back.
      const pane = viewport === desktop;
      const shown = pane ? '/todo?tab=done&item=fakturor' : '/todo?tab=done';
      const row = page.locator('#work-fakturor').getByRole('link');
      await row.click();
      if (pane) await page.getByRole('link', { name: 'Visa granskning', exact: true }).click();
      await expect(page).toHaveURL(`/items/fakturor?from=${encodeURIComponent(shown)}`);
      // The decision is sent: the focus is on the item's title, and nothing decides.
      await expect(page.getByRole('heading', { level: 1, name: INVOICES })).toBeFocused();
      const review = page.getByRole('main');
      await expect(review.getByRole('status', { name: 'Sida 1 av 2' })).toBeVisible();
      await expect(review.getByRole('button', { name: /^Attestera|^Lämna kvar|^Spara rättelse/ })).toHaveCount(0);
      await expect(review.getByRole('button', { name: /Tillbaka till ärendet|Visa kvittot/ })).toHaveCount(0);
      await expect(review).toContainText('Underlaget visar källans nuvarande version.');
      // Another row is read from its step where the steps are drawn as controls; the row the page opens at otherwise.
      if (pane) {
        await stepsOf(page)
          .getByRole('button', { name: /Skolgrossisten · 7 200 kr/ })
          .click();
        await expect(review.getByRole('heading', { name: 'Skolgrossisten · 7 200 kr' })).toBeVisible();
        await expect(review.getByRole('heading', { name: /Underlag från/ })).toBeFocused();
      } else await expect(review.getByRole('heading', { name: 'Skolgrossisten · 11 200 kr' })).toBeVisible();
      expect(await reflowProblems(page, review)).toEqual([]);
      await expectNoAxeViolations(page);
      // The page's own way back names where the item was shown: Klart as it was with the item beside it, or the queue.
      await review.getByRole('link', { name: 'Att göra', exact: true }).click();
      await expect(page).toHaveURL(shown);
      // The focus returns to a link that leads to the page that was left (2.4.3): in the pane, where the item's name
      // and "Visa granskning" both do (which of the two is `review.spec.ts`'s to say), or the row in the queue.
      if (pane)
        await expect(page.locator(`a[href="/items/fakturor?from=${encodeURIComponent(shown)}"]:focus`)).toHaveCount(1);
      else await expect(row).toBeFocused();
    });
  for (const viewport of [desktop, narrow])
    test(`a completed review stays viewable; a rejected row can be corrected and opened as a fresh retry at ${viewport.width}px`, async ({
      page,
      api,
    }) => {
      await page.setViewportSize(viewport);
      const fixture = await originals(page, api);
      const card = api.threads.find(t => t.id === 'fakturor')!;
      card.execution = {
        id: 'rejected-execution',
        decisionId: 'first',
        operation: 'finance.approve',
        state: 'partial',
        reason: null,
        compensates: null,
      };
      card.receipt = {
        at: '2026-11-04T08:00:00.000Z',
        headline: 'Två bekräftade, en avvisad.',
        undoUntil: null,
        undoCapability: null,
        rows: card.items.map((i, n) => ({
          ref: i.ref,
          label: i.label,
          outcome: n === 2 ? 'failed' : 'done',
          detail: n === 2 ? 'Beställningsnummer saknas.' : 'Attesterad.',
        })),
      };
      let saved = false;
      let execution: object;
      await page.route('**/api/executions', async route => {
        const request = route.request().postDataJSON();
        expect(request.operation).toBe('finance.correct');
        expect(request.payload.ref).toBe(card.items[2]!.ref);
        const result = await fixture.correct(request.payload);
        saved = true;
        execution = { id: 'correction-1', state: 'succeeded', result };
        await route.fulfill({ json: execution });
      });
      await page.route('**/api/executions/correction-1', route => route.fulfill({ json: execution }));
      await page.route('**/api/threads/fakturor/retry', async route => {
        expect(saved).toBe(true);
        const retry = {
          ...card,
          id: 'retry:rejected-execution',
          topic: 'retry:rejected-execution',
          state: 'open' as const,
          receipt: null,
          execution: null,
          items: [{ ...card.items[2]!, revision: undefined }],
        };
        api.threads.push(retry);
        await route.fulfill({ json: retry });
      });
      // Beside the queue "Visa granskning" leads to the item's page; where the pane does not fit the item is its page.
      await open(page, '/todo?item=fakturor');
      if (viewport.width === desktop.width)
        await page.getByRole('link', { name: 'Visa granskning', exact: true }).click();
      await expect(page).toHaveURL(/^[^?]*\/items\/fakturor\?from=/);
      await expect(page.getByRole('heading', { level: 1, name: INVOICES })).toBeFocused();
      const review = page.getByRole('main');
      await expect(review.getByRole('button', { name: 'Attestera', exact: true })).toHaveCount(0);
      // The address names no step: the page opens at the row the source refused, where the correction is made.
      await expect(review.getByRole('heading', { level: 2, name: /Energibolaget/ })).toBeVisible();
      await expect(review).toContainText('Beställningsnummer saknas.');
      await review.getByRole('textbox', { name: 'Beställningsnummer' }).fill('PO-2026-333');
      await review.getByRole('button', { name: 'Spara rättelse', exact: true }).click();
      await expect(page.getByRole('region', { name: 'Aviseringar' })).toContainText('Beställningsnumret är sparat');
      await expect(review.getByRole('textbox', { name: 'Beställningsnummer' })).toHaveValue('PO-2026-333');
      await expectNoAxeViolations(page);
      expect(await reflowProblems(page, review)).toEqual([]);
      await page.screenshot({ path: `test-results/review-recovery-${viewport.width}.png` });
      const notice = page.getByRole('region', { name: 'Aviseringar' });
      if (await notice.getByRole('button', { name: 'Stäng avisering' }).isVisible())
        await notice.getByRole('button', { name: 'Stäng avisering' }).click();
      // The notice's move puts the new item's page, which is its review, in this one's place (D80).
      await review.getByRole('button', { name: 'Granska avvisade igen' }).click();
      await expect(page).toHaveURL(/^[^?]*\/items\/retry%3Arejected-execution\?from=/);
      await expect(page.getByRole('heading', { level: 1, name: INVOICES })).toBeVisible();
      const retry = page.getByRole('main');
      await expect(retry.getByRole('heading', { name: /Energibolaget/ })).toBeVisible();
      await expect(retry.getByRole('button', { name: 'Attestera', exact: true })).toBeEnabled();
      expect(card.receipt.rows.filter(r => r.outcome === 'done')).toHaveLength(2);
    });
  test('named steps distinguish repeated suppliers and preserve decisions made out of order', async ({ page, api }) => {
    await originals(page, api);
    await open(page, REVIEW);
    const review = page.getByRole('main');
    const steps = stepsOf(page);
    const firstInvoice = steps.getByRole('button', { name: /Skolgrossisten · 11 200 kr/ });
    const secondInvoice = steps.getByRole('button', { name: /Skolgrossisten · 7 200 kr/ });
    await expect(firstInvoice).toBeVisible();
    await expect(secondInvoice).toBeVisible();
    await secondInvoice.click();
    await expect(page).toHaveURL(`${REVIEW}&step=2`);
    await expect(steps).not.toContainText('Vald för godkännande');
    await expect(steps.getByRole('img', { name: 'Vald för godkännande' })).toHaveCount(0);
    await review.getByRole('button', { name: 'Attestera', exact: true }).click();
    await expect(page).toHaveURL(`${REVIEW}&step=3`);
    await expect(review.getByRole('heading', { name: /Underlag från/ })).toBeFocused();
    await firstInvoice.focus();
    await expect(firstInvoice).toBeFocused();
    await page.keyboard.press('Enter');
    // A step the person chose is named in the address, the first too (D142).
    await expect(page).toHaveURL(`${REVIEW}&step=1`);
    await expect(steps.getByRole('listitem').nth(1)).toContainText('Vald för godkännande');
    await review.getByRole('button', { name: 'Lämna kvar', exact: true }).click();
    await steps.getByRole('button', { name: /Skicka/ }).click();
    await expect(review).toContainText('1 av 3 skickas, 1 lämnas kvar');
    // The steps are the one list of the rows: each says what was decided on it.
    await expect(steps.getByRole('listitem').nth(0)).toContainText('Lämnas kvar');
    await expect(steps.getByRole('listitem').nth(1)).toContainText('Vald för godkännande');
    await expectNoAxeViolations(page);
    await page.screenshot({ path: 'test-results/review-step-amounts.png' });
  });
  test('change notices preserve the open document, reading position and focus; a changed revision is reread', async ({
    page,
    api,
  }) => {
    await page.addInitScript(() => {
      class Changes {
        onmessage: ((event: { data: string }) => void) | null = null;
        constructor() {
          (window as unknown as { emitChange: (data: object) => void }).emitChange = data =>
            this.onmessage?.({ data: JSON.stringify(data) });
        }
        close() {}
      }
      window.EventSource = Changes as unknown as typeof EventSource;
    });
    const fixture = await originals(page, api);
    await open(page, REVIEW);
    const review = page.getByRole('main');
    const approve = review.getByRole('button', { name: 'Attestera', exact: true });
    await expect(approve).toBeEnabled();
    await page.screenshot({ path: 'test-results/document-review-desktop.png' });
    await review.getByRole('button', { name: 'Nästa sida', exact: true }).click();
    const textMode = review.getByRole('button', { name: 'Visa sidans text', exact: true });
    await textMode.click();
    const reading = review.getByRole('button', { name: 'Visa sidan', exact: true });
    await reading.focus();
    const emit = async (revision: number) => {
      const refreshed = page.waitForResponse(
        r => new URL(r.url()).pathname === '/api/threads' && r.request().method() === 'GET',
      );
      await page.evaluate(
        revision =>
          (window as unknown as { emitChange: (data: object) => void }).emitChange({
            revision: String(revision),
            policy: '1:1',
          }),
        revision,
      );
      await refreshed;
    };
    // A connection starts by saying the current revision, which is what the page's first reads answered and so no
    // notice (`changeNotices`): the stand-in says it once before the three changes.
    await page.evaluate(() =>
      (window as unknown as { emitChange: (data: object) => void }).emitChange({ revision: '0', policy: '1:1' }),
    );
    for (let revision = 1; revision <= 3; revision++) {
      await emit(revision);
      await expect(reading).toBeFocused();
      await expect(review.getByRole('status', { name: 'Sida 2 av 2' })).toBeVisible();
      await expect(approve).toBeEnabled();
    }
    expect(fixture.reads).toEqual({ preview: 1, content: 1 });
    await expectNoAxeViolations(page);
    api.threads.find(t => t.id === 'fakturor')!.items[0]!.revision = 'new-source-revision';
    await page.route('**/api/threads/fakturor/preview?*', route =>
      // The route's refusal of a row whose source revision moved since the item was made (`decisions.ts`, `preview`).
      route.fulfill({
        status: 400,
        json: { error: 'Underlaget har ändrats sedan ärendet skapades. Läs in ärendet igen.' },
      }),
    );
    await emit(4);
    await expect(review.getByText('Underlaget har ändrats sedan ärendet skapades. Läs in ärendet igen.')).toBeVisible();
    await expect(approve).toBeDisabled();
    await expect(review.locator('canvas')).toHaveCount(0);
  });
  test('a record opens original PDF, DOCX and XLSX with page, sheet and attachment controls', async ({ page, api }) => {
    await originals(page, api);
    await open(page, viewHref('finance.record', 'finance:inv:55120'));
    const panel = page.getByRole('main');
    await expect(panel.getByRole('status', { name: 'Sida 1 av 2', exact: true })).toBeVisible();
    await panel.getByRole('button', { name: 'Visa sidans text' }).click();
    await expect(panel.getByText(/Faktura 55120\s+Skolgrossisten/)).toBeVisible();
    await panel.getByRole('button', { name: 'Nästa sida' }).click();
    await expect(panel.getByText(/Betalningsunderlag\s+Kostnadsstalle/)).toBeVisible();
    await expectNoAxeViolations(page);
    const attachments = panel.getByRole('combobox', { name: 'Dokument och bilagor' });
    await attachments.click();
    await page.getByRole('option', { name: 'Inköpsavtal', exact: true }).click();
    const word = panel.frameLocator('iframe[title="Inköpsavtal"]');
    await expect(word.getByText('Leverantör: Skolgrossisten')).toBeVisible();
    await expect(panel.locator('iframe')).toHaveAttribute('sandbox', 'allow-same-origin');
    // The no-script document deliberately cannot host axe's cross-frame messaging. Audit the surrounding controls;
    // assert the frame's accessible text separately and retain a manual screen-reader check for document fidelity.
    expect(
      (
        await new AxeBuilder({ page })
          .exclude('iframe')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
    await attachments.focus();
    await page.keyboard.press('Enter');
    await page.getByRole('option', { name: 'Specifikation', exact: true }).click();
    await expect(panel.getByRole('table', { name: 'Specifikation', exact: true })).toBeVisible();
    await expect(panel.getByRole('columnheader', { name: 'A', exact: true })).toBeVisible();
    await expect(panel.getByText('Beskrivning', { exact: true })).toBeVisible();
    await panel.getByRole('combobox', { name: 'Kalkylblad', exact: true }).click();
    await page.getByRole('option', { name: 'Referenser', exact: true }).click();
    await expect(panel.getByRole('cell', { name: 'finance:inv:55120', exact: true })).toBeVisible();
    await expectNoAxeViolations(page);
    // The sheet is a data table, which 1.4.10 lets scroll in two dimensions: its columns run on in the Table's own
    // scroll region (a tab stop while it overflows, which axe checks above); the panel around it reflows.
    expect(await reflowProblems(page, panel, { table: panel.getByRole('table', { name: 'Referenser' }) })).toEqual([]);
    await page.screenshot({ path: 'test-results/document-record-desktop.png' });
    await attachments.click();
    await page.getByRole('option', { name: 'Faktura · krävs för beslut', exact: true }).click();
    await expect(panel.getByRole('status', { name: 'Sida 2 av 2', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Visa sidan', exact: true })).toBeVisible();
  });
  test('an invoice opened over a page from before is its own page, the thing’s page with its facts beside the read, and Back returns (D126)', async ({
    page,
    api,
  }) => {
    await originals(page, api);
    // An address from before D126 that held the record beside Hem leads to the record's page, Hem as its way back.
    await open(
      page,
      '/?open=finance.record&open-title=Underlag&open-input=' +
        encodeURIComponent(JSON.stringify({ ref: 'finance:inv:55120' })),
    );
    await expect(page).toHaveURL(
      `/tools/finance.record?input=${encodeURIComponent(JSON.stringify({ ref: 'finance:inv:55120' }))}&title=Underlag&from=%2F`,
    );
    await expect(page.getByRole('dialog')).toHaveCount(0);
    const main = page.getByRole('main');
    // The record's own name is the page's heading; the read it was opened under stands on the source line.
    await expect(main.locator('h1:not([aria-level]), [aria-level="1"]')).toHaveText('Faktura 55120');
    await expect(main.getByText(/Underlag$/).first()).toBeVisible();
    await expect(main.getByRole('status', { name: 'Sida 1 av 2', exact: true })).toBeVisible();
    await expect(main.getByRole('combobox', { name: 'Dokument och bilagor' })).toBeVisible();
    // The facts in the end panel (board Ärende).
    await expect(page.getByRole('complementary', { name: 'Uppgifter' })).toBeVisible();
    await expect(main.getByRole('link', { name: 'Hem', exact: true })).toHaveAttribute('href', '/');
    expect(
      (
        await new AxeBuilder({ page })
          .exclude('iframe')
          .withTags(['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'])
          .analyze()
      ).violations,
    ).toEqual([]);
  });
  test('metrics, line/bar series and activity have labelled values and accessible data tables', async ({
    page,
    api,
  }) => {
    await originals(page, api);
    for (const capability of ['finance.metrics', 'finance.trend', 'finance.comparison', 'finance.history']) {
      await open(page, viewHref(capability, capability === 'finance.history' ? 'finance:inv:55120' : undefined));
      const panel = page.getByRole('main');
      if (capability === 'finance.metrics')
        await expect(panel.getByText('uppgifter från', { exact: false }).first()).toBeVisible();
      else if (capability === 'finance.history')
        await expect(panel.getByText('Faktura mottagen', { exact: true })).toBeVisible();
      else {
        await expect(panel.getByRole('table')).toBeVisible();
        await expect(panel.getByRole('columnheader', { name: 'Prognos (Prognos)' })).toBeVisible();
      }
      await expectNoAxeViolations(page);
    }
  });
  test('failed required documents prevent approval and a successful retry sends the reviewed versions', async ({
    page,
    api,
  }) => {
    const fixture = await originals(page, api);
    fixture.outage(true);
    await open(page, REVIEW);
    const review = page.getByRole('main');
    await expect(review.getByText('Underlaget kan inte längre läsas.')).toBeVisible();
    await expect(review.getByRole('button', { name: 'Attestera', exact: true })).toBeDisabled();
    await expect(review.getByRole('link', { name: 'Hämta originalet' })).toBeVisible();
    fixture.outage(false);
    await review.getByRole('button', { name: 'Försök igen', exact: true }).click();
    const approve = review.getByRole('button', { name: 'Attestera', exact: true });
    await expect(approve).toBeEnabled();
    await approve.focus();
    await page.keyboard.press('Enter');
    await review.getByRole('button', { name: 'Lämna kvar', exact: true }).click();
    await review.getByRole('button', { name: 'Hoppa över', exact: true }).click();
    const submitted = page.waitForRequest(r => r.url().endsWith('/api/threads/fakturor/act') && r.method() === 'POST');
    await review.getByRole('button', { name: 'Attestera 1', exact: true }).click();
    expect((await submitted).postDataJSON().reviews).toEqual([fixture.evidence['finance:inv:55120']]);
  });
  for (const moved of [false, true])
    test(`an approval kept through a reload is sent with a fresh read of the versions it was taken on${moved ? ', and taken back when the record has moved on' : ''} (D79)`, async ({
      page,
      api,
    }) => {
      const fixture = await originals(page, api);
      await open(page, REVIEW);
      const review = page.getByRole('main');
      const approve = review.getByRole('button', { name: 'Attestera', exact: true });
      await expect(approve).toBeEnabled();
      await approve.click();
      await expect(page).toHaveURL(`${REVIEW}&step=2`);
      // The draft keeps the decision and the versions it was taken on, never the evidence.
      const kept = await page.evaluate(() => window.sessionStorage.getItem('clew.review.fakturor'));
      expect(kept).toContain(fixture.evidence['finance:inv:55120']!.revision);
      expect(kept).not.toContain(fixture.evidence['finance:inv:55120']!.proof);
      await page.reload();
      const steps = stepsOf(page);
      await expect(steps.getByRole('listitem').nth(0)).toContainText('Vald för godkännande');
      await steps.getByRole('button', { name: /Skicka/ }).click();
      const reads = fixture.reads.preview;
      fixture.revise(moved);
      if (!moved) {
        const submitted = page.waitForRequest(
          r => r.url().endsWith('/api/threads/fakturor/act') && r.method() === 'POST',
        );
        await review.getByRole('button', { name: 'Attestera 1', exact: true }).click();
        expect((await submitted).postDataJSON().reviews).toEqual([fixture.evidence['finance:inv:55120']]);
        expect(fixture.reads.preview).toBe(reads + 1);
        return;
      }
      await review.getByRole('button', { name: 'Attestera 1', exact: true }).click();
      await expect(review.getByRole('alert')).toContainText(
        'Underlaget för Skolgrossisten · 11 200 kr har ändrats sedan du godkände raden. Granska den igen innan du skickar.',
      );
      expect(fixture.reads.preview).toBe(reads + 1);
      await expect(steps.getByRole('listitem').nth(0)).not.toContainText('Vald för godkännande');
      await expect(review.getByRole('button', { name: 'Attestera 0', exact: true })).toBeDisabled();
      // The row is reached again from its step, to be read and judged anew. It is not opened here: this mock's item
      // keeps the row's old revision, so the page would ask for the old document, which the mock refuses by throwing.
      await expect(steps.getByRole('button', { name: /Skolgrossisten · 11 200 kr/ })).toBeVisible();
      expect(api.acted).toHaveLength(0);
    });
});
test.describe('document review on a narrow phone', () => {
  test.use({ viewport: narrow });
  test('documents and decisions reflow, keyboard controls work and focus returns to the item', async ({
    page,
    api,
  }) => {
    await originals(page, api);
    // On a phone the item is its page, alone on the surface (D112 item 12), and that page is the review (D142): the
    // row in the queue leads straight to it, the decision pinned to the foot.
    await open(page, '/todo');
    const row = page.locator('#work-fakturor').getByRole('link');
    await row.click();
    await expect(page).toHaveURL('/items/fakturor?from=%2Ftodo');
    await expect(page.getByRole('heading', { level: 1, name: INVOICES })).toBeVisible();
    const review = page.getByRole('main');
    await expect(review.getByRole('link', { name: 'Granska 3' })).toHaveCount(0);
    await expect(review.getByRole('button', { name: 'Attestera', exact: true })).toBeEnabled();
    await expectNoAxeViolations(page);
    expect(await reflowProblems(page, review)).toEqual([]);
    await page.screenshot({ path: 'test-results/document-review-phone.png' });
    // Back is the queue, with the focus on the row that led to the page (2.4.3).
    await page.goBack();
    await expect(page).toHaveURL('/todo');
    await expect(row).toBeFocused();
  });
});
