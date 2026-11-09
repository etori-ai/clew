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
  await page.route('**/api/cap/finance.*', async route => {
    const url = new URL(route.request().url()),
      capability = url.pathname.split('/').at(-1)!;
    const output = await registry.run(actor, capability, JSON.parse(url.searchParams.get('input') ?? '{}'));
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
    const { document: bundle, recovery } = await registry.run<{ document: DocumentBundle; recovery: ReviewRecovery }>(
      actor,
      'finance.record',
      { ref },
    );
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
    correct: (input: unknown) => registry.run(actor, 'finance.correct', input),
  };
}
const viewHref = (capability: string, ref?: string) =>
  `/?open=${capability}&open-title=Underlag${ref ? '&open-input=' + encodeURIComponent(JSON.stringify({ ref })) : ''}`;

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
      await open(page, '/?tab=done');
      await page.getByRole('link', { name: card.title, exact: false }).click();
      const review = page.getByRole('dialog', { name: 'Visa 3 rader' });
      await expect(review.getByRole('status', { name: 'Sida 1 av 2' })).toBeVisible();
      await expect(review.getByRole('button', { name: /^Attestera|^Lämna kvar|^Spara rättelse/ })).toHaveCount(0);
      await review.getByRole('button', { name: 'Nästa', exact: true }).click();
      await expect(review.getByRole('heading', { name: 'Skolgrossisten · 7 200 kr' })).toBeVisible();
      expect(await reflowProblems(page, review)).toEqual([]);
      await expectNoAxeViolations(page);
      await review.getByRole('button', { name: 'Tillbaka till kortet' }).click();
      await expect(page.getByRole('link', { name: 'Visa granskning', exact: true })).toBeFocused();
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
      await open(page, '/?card=fakturor');
      await page.getByRole('link', { name: 'Visa granskning', exact: true }).click();
      const review = page.getByRole('dialog', { name: 'Visa 3 rader' });
      await expect(review.getByRole('button', { name: 'Attestera', exact: true })).toHaveCount(0);
      if (viewport.width === narrow.width) {
        await review.getByRole('button', { name: 'Översikt', exact: true }).click();
        await review.getByRole('button', { name: /Visa rad 3: Energibolaget/ }).click();
      } else {
        await review
          .getByRole('list', { name: 'Rader', exact: true })
          .getByRole('button', { name: /Energibolaget/ })
          .click();
      }
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
      await review.getByRole('button', { name: 'Granska avvisade igen' }).click();
      const retry = page.getByRole('dialog', { name: 'Granska 1 rad' });
      await expect(retry.getByRole('heading', { name: /Energibolaget/ })).toBeVisible();
      await expect(retry.getByRole('button', { name: 'Attestera', exact: true })).toBeEnabled();
      expect(card.receipt.rows.filter(r => r.outcome === 'done')).toHaveLength(2);
    });
  test('named steps distinguish repeated suppliers and preserve decisions made out of order', async ({ page, api }) => {
    await originals(page, api);
    await open(page, '/cards/fakturor/review');
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    const steps = review.getByRole('list', { name: 'Rader', exact: true });
    const firstInvoice = steps.getByRole('button', { name: /Skolgrossisten · 11 200 kr/ });
    const secondInvoice = steps.getByRole('button', { name: /Skolgrossisten · 7 200 kr/ });
    await expect(firstInvoice).toBeVisible();
    await expect(secondInvoice).toBeVisible();
    await secondInvoice.click();
    await expect(page).toHaveURL('/cards/fakturor/review?step=2');
    await expect(review).toContainText('0 av 3 bedömda');
    await expect(steps.getByRole('img', { name: 'Vald för godkännande' })).toHaveCount(0);
    await review.getByRole('button', { name: 'Attestera', exact: true }).click();
    await expect(page).toHaveURL('/cards/fakturor/review?step=3');
    await expect(review.getByRole('heading', { name: /Underlag från/ })).toBeFocused();
    await firstInvoice.focus();
    await expect(firstInvoice).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL('/cards/fakturor/review');
    await expect(review).toContainText('1 av 3 bedömda');
    await review.getByRole('button', { name: 'Lämna kvar', exact: true }).click();
    await steps.getByRole('button', { name: /Skicka/ }).click();
    await expect(review).toContainText('1 av 3 skickas, 1 lämnas kvar');
    const list = review.getByRole('list', { name: 'Hittills' });
    await expect(list.getByRole('listitem').nth(0)).toContainText('Lämnas kvar');
    await expect(list.getByRole('listitem').nth(1)).toContainText('Vald för godkännande');
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
    await open(page, '/cards/fakturor/review');
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
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
      route.fulfill({ status: 409, json: { error: 'Underlaget har ändrats. Läs in kortet igen.' } }),
    );
    await emit(4);
    await expect(review.getByText('Underlaget har ändrats. Läs in kortet igen.')).toBeVisible();
    await expect(approve).toBeDisabled();
    await expect(review.locator('canvas')).toHaveCount(0);
  });
  test('a record opens original PDF, DOCX and XLSX with page, sheet and attachment controls', async ({ page, api }) => {
    await originals(page, api);
    await open(page, viewHref('finance.record', 'finance:inv:55120'));
    const panel = page.getByRole('dialog', { name: 'Underlag' });
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
    expect(await reflowProblems(page, panel)).toEqual([]);
    await page.screenshot({ path: 'test-results/document-record-desktop.png' });
    await attachments.click();
    await page.getByRole('option', { name: 'Faktura · krävs för beslut', exact: true }).click();
    await expect(panel.getByRole('status', { name: 'Sida 2 av 2', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: 'Visa sidan', exact: true })).toBeVisible();
  });
  test('metrics, line/bar series and activity have labelled values and accessible data tables', async ({
    page,
    api,
  }) => {
    await originals(page, api);
    for (const capability of ['finance.metrics', 'finance.trend', 'finance.comparison', 'finance.history']) {
      await open(page, viewHref(capability, capability === 'finance.history' ? 'finance:inv:55120' : undefined));
      const panel = page.getByRole('dialog', { name: 'Underlag' });
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
    await open(page, '/cards/fakturor/review');
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
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
});
test.describe('document review on a narrow phone', () => {
  test.use({ viewport: narrow });
  test('documents and decisions reflow, keyboard controls work and focus returns to the card', async ({
    page,
    api,
  }) => {
    await originals(page, api);
    await open(page, '/?card=fakturor');
    const card = page.getByRole('dialog', { name: 'Kort: Attestera 3 fakturor, 48 200 kr', exact: true });
    await card.getByRole('link', { name: 'Granska 3' }).click();
    const review = page.getByRole('dialog', { name: 'Granska 3 rader' });
    await expect(review.getByRole('button', { name: 'Attestera', exact: true })).toBeEnabled();
    await expectNoAxeViolations(page);
    expect(await reflowProblems(page, review)).toEqual([]);
    await page.screenshot({ path: 'test-results/document-review-phone.png' });
    await review.getByRole('button', { name: 'Stäng', exact: true }).click();
    await expect(card.getByRole('link', { name: 'Granska 3' })).toBeFocused();
  });
});
