import { describe, expect, test } from 'bun:test';
import { createHmac } from 'node:crypto';
import { Registry } from '../registry';
import { fixtureConnectors } from '../fixture-connectors';
import { invoiceInput } from '../document-fixtures';
import type {
  AuthenticatedContext,
  DocumentBundle,
  DocumentRequest,
  Series,
  View,
} from '../../packages/contracts/src/index';
import { documentReviews } from '../../apps/server/src/connectors/usecases/documents';
import { executionUsecases } from '../../apps/server/src/modules/executions/usecases';
import { memoryExecutionStore } from '../../apps/server/src/modules/executions/adapters/memory';
import { viewOutputProblem, viewProblem } from '../../packages/connectors/src/views';
import { checkOfficeArchive, checkOfficeContent, columnName } from '../../packages/ui/src/document-limits';
import { MAX_DOCUMENT_BYTES } from '../../packages/contracts/src/index';
import { remoteConnector, parseManifest } from '../../packages/connectors/src/remote';
import { manifest as financeManifest } from '../../connectors/finance/connector.mjs';
import { cardDecisions } from '../../apps/server/src/threads/usecases/decisions';
import { draft as cardDraft } from '../store-contract';
const persona: AuthenticatedContext = {
  id: 'hillevi',
  name: 'Hillevi',
  unitId: 'unit-skola',
  unitLabel: 'Skola',
  role: 'manager',
  organisationId: 'test',
  principal: { id: 'person:hillevi', kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01',
  authorize: async () => ({ version: 'v1' }),
};
const ref = 'finance:inv:55120';
function world() {
  let now = Date.parse('2026-11-08T10:00:00.000Z'),
    ids = 0;
  const clock = () => new Date(now);
  const fixtures = fixtureConnectors({ only: ['finance'], clock });
  const registry = new Registry();
  fixtures.connectors.forEach(c => registry.register(c));
  const reviews = documentReviews({
    registry,
    clock,
    sign: input => createHmac('sha256', 'test-review-key').update(JSON.stringify(input)).digest('hex'),
    run: (p, cap, input) => registry.run(p, cap, input),
  });
  const store = memoryExecutionStore();
  const executions = executionUsecases({
    store,
    clock,
    ids: () => `document-execution-${++ids}`,
    digest: input => JSON.stringify(input),
    review: reviews.validate,
    source: {
      authorize: async () => ({
        connector: 'finance',
        safety: { strategy: 'deduplicated', retentionSeconds: 86400, lookup: 'finance.lookup' },
        needsSession: false,
      }),
      current: async () => persona,
      execute: (p, e) => registry.run(p, e.operation, e.payload, { operationId: e.id }),
      lookup: async () => undefined,
    },
  });
  const bundle = async () =>
    (await registry.run<{ document: DocumentBundle }>(persona, 'finance.documents', { ref })).document;
  const request = (b: DocumentBundle, index = 0): DocumentRequest => ({
    capability: 'finance.documents',
    input: { ref },
    ref,
    revision: b.revision,
    document: b.documents[index]!.id,
    documentRevision: b.documents[index]!.revision,
  });
  return { ...fixtures, registry, reviews, store, executions, bundle, request, advance: (ms: number) => (now += ms) };
}
describe('versioned documents', () => {
  test('a correction is audited through the execution ledger and invalidates previous review evidence', async () => {
    const w = world();
    const before = await w.reviews.preview(persona, 'finance.record', ref);
    expect(before.recovery?.correction?.capability).toBe('finance.correct');
    const approved = await w.executions.approve(persona, {
      decisionId: 'correction',
      operation: 'finance.correct',
      payload: { ref, revision: before.bundle.revision, changes: { order: 'PO-CHANGED' } },
    });
    expect(approved.state).toBe('pending');
    expect((await w.bundle()).revision).toBe(before.bundle.revision);
    await w.executions.progress(approved.id);
    expect((await w.executions.read(persona, approved.id))?.state).toBe('succeeded');
    expect(w.store.audit().filter(e => e.action === 'execution.approved')).toHaveLength(1);
    expect(w.store.audit().some(e => e.action === 'execution.succeeded')).toBe(true);
    await expect(
      w.reviews.validate(persona, 'finance.approve', { refs: [ref], reviews: [before.evidence] }),
    ).rejects.toThrow(/ändrats/);
    const current = await w.reviews.preview(persona, 'finance.record', ref);
    expect(current.bundle.revision).not.toBe(before.bundle.revision);
    await w.reviews.validate(persona, 'finance.approve', { refs: [ref], reviews: [current.evidence] });
  });
  test('original bytes round-trip through the signed transport, with exact hash, media and revisions', async () => {
    const w = world(),
      b = await w.bundle();
    expect(b.documents.map(d => d.filename)).toEqual(['Faktura.pdf', 'Avtal.docx', 'Specifikation.xlsx']);
    for (let index = 0; index < 3; index++) {
      const content = await w.registry.document(persona, w.request(b, index));
      expect(content.bytes.length).toBe(b.documents[index]!.size);
      if (index) expect(() => checkOfficeArchive(Uint8Array.from(content.bytes).buffer)).not.toThrow();
      else expect(new TextDecoder().decode(content.bytes).startsWith('%PDF-')).toBe(true);
    }
    expect(columnName(0)).toBe('A');
    expect(columnName(26)).toBe('AA');
    expect(columnName(49)).toBe('AX');
  });
  test('scope, record identity, revision, file identity and read-only capability checks precede content', async () => {
    const w = world(),
      b = await w.bundle(),
      request = w.request(b);
    for (const change of [
      { ref: 'elsewhere' },
      { revision: 'old' },
      { document: '../other' },
      { documentRevision: 'old' },
      { capability: 'finance.approve' },
    ])
      await expect(w.registry.document(persona, { ...request, ...change })).rejects.toThrow();
    await expect(w.registry.document({ ...persona, unitId: 'other-unit' }, request)).rejects.toThrow();
    await expect(w.registry.document({ ...persona, role: 'employee' }, request)).rejects.toThrow();
  });
  test('revocation, content substitution and descriptor replacement during a download release no bytes', async () => {
    for (const failure of ['revoke', 'hash', 'replace'] as const) {
      const w = world(),
        b = await w.bundle(),
        connector = w.registry.connector('finance')!;
      const original = connector.documents!;
      connector.documents = async (...args) => {
        const content = await original(...args);
        if (failure === 'hash') content.bytes[0] = content.bytes[0]! ^ 1;
        if (failure === 'revoke')
          w.registry.govern('finance', { ...w.registry.governance('finance'), state: 'disabled' });
        if (failure === 'replace') w.registry.replace({ ...connector });
        return content;
      };
      await expect(w.registry.document(persona, w.request(b))).rejects.toThrow();
    }
  });
  test('changed source records fail a source-level conditional approval; deduplicated replays keep their receipt', async () => {
    const w = world(),
      payload = await invoiceInput(w.registry, persona, [ref]);
    const state = w.states.finance!;
    const records = state.get<any>('records');
    records.invoices.find((i: any) => i.ref === ref).lines[0].text += ' changed';
    state.set('records', records);
    const stale = await w.registry.run<any>(persona, 'finance.approve', payload);
    expect(stale.rows[0].outcome).toBe('failed');
    expect(state.get('approved', {})).toEqual({});
    const fresh = await invoiceInput(w.registry, persona, [ref]);
    const result = await w.registry.run<any>(persona, 'finance.approve', fresh, { operationId: 'one' });
    expect(result.rows[0].outcome).toBe('done');
    records.invoices.find((i: any) => i.ref === ref).amount += 10;
    state.set('records', records);
    expect(await w.registry.run(persona, 'finance.approve', fresh, { operationId: 'one' })).toEqual(result);
    expect(result.undoInput).toEqual({ refs: [ref] });
  });
  test('Office archive limits reject malformed and oversized inputs before parsing', () => {
    expect(() => checkOfficeArchive(new ArrayBuffer(10))).toThrow();
    expect(() => checkOfficeArchive(new ArrayBuffer(8 * 1024 * 1024 + 1))).toThrow(/stort/);
  });
  test('actual Office expansion is verified, not just the untrusted directory sizes', async () => {
    const w = world(),
      bundle = await w.bundle();
    const content = await w.registry.document(persona, w.request(bundle, 1));
    const bytes = Uint8Array.from(content.bytes).buffer;
    await expect(checkOfficeContent(bytes)).resolves.toBeUndefined();
    const view = new DataView(bytes);
    const directory = view.getUint32(bytes.byteLength - 6, true);
    view.setUint32(directory + 24, 1, true);
    await expect(checkOfficeContent(bytes)).rejects.toThrow();
  });
  test('binary transport cancels oversized declared and chunked bodies and refuses redirects', async () => {
    for (const declared of [true, false]) {
      const w = world(),
        bundle = await w.bundle();
      let cancelled = false,
        redirects: RequestRedirect | undefined;
      const adapter = remoteConnector(parseManifest(financeManifest, 'finance'), {
        url: 'http://finance',
        assert: async () => 'assertion',
        fetch: async (_url, init) => {
          redirects = init?.redirect;
          return new Response(
            new ReadableStream<Uint8Array>({
              pull(controller) {
                controller.enqueue(new Uint8Array(1024 * 1024));
              },
              cancel() {
                cancelled = true;
              },
            }),
            { headers: declared ? { 'content-length': String(MAX_DOCUMENT_BYTES + 1) } : {} },
          );
        },
      });
      w.registry.connector('finance')!.documents = adapter.documents;
      await expect(w.registry.document(persona, w.request(bundle))).rejects.toThrow();
      expect(cancelled).toBe(true);
      expect(redirects).toBe('error');
    }
  });
});
describe('review evidence and the shared decision ledger', () => {
  test('card review never mixes a fresh document with stale card facts', async () => {
    const w = world(),
      preview = await w.reviews.preview(persona, 'finance.record', ref);
    const thread = {
      ...cardDraft(persona.id),
      handledAt: null,
      messages: [],
      proposals: [],
      receipt: null,
      remindedAt: null,
      snoozedUntil: null,
      connector: 'finance',
      items: [{ ref, revision: 'old', label: 'Old invoice', detail: '', selectable: true, selected: true }],
      actions: [
        {
          id: 'approve',
          label: 'Attestera',
          capability: 'finance.approve',
          kind: 'execute' as const,
          role: 'primary' as const,
          usesItems: true,
          review: 'each' as const,
          preview: 'finance.record',
        },
      ],
    };
    let writes = 0;
    const uc = cardDecisions({
      read: async () => thread,
      registry: w.registry,
      run: (p, name, input) => w.registry.run(p, name, input),
      documentPreview: w.reviews.preview,
      approve: async () => {
        writes++;
      },
      clock: () => new Date('2026-11-08T10:00:00.000Z'),
    });
    await expect(uc.preview(persona, thread.id, ref)).rejects.toThrow(/sedan kortet/);
    await expect(uc.act(persona, thread.id, 'approve', [ref], [preview.evidence])).rejects.toThrow(/olika versioner/);
    expect(writes).toBe(0);
    thread.items[0]!.revision = preview.bundle.revision;
    expect(await uc.preview(persona, thread.id, ref)).toMatchObject({ kind: 'documents' });
    await uc.act(persona, thread.id, 'approve', [ref], [preview.evidence]);
    expect(writes).toBe(1);
  });
  test('a review is a read; missing, altered, cross-person, cross-authority and expired evidence cannot approve', async () => {
    const w = world(),
      preview = await w.reviews.preview(persona, 'finance.record', ref);
    const payload = { refs: [ref], reviews: [preview.evidence] };
    expect(w.store.audit()).toEqual([]);
    await w.reviews.validate(persona, 'finance.approve', payload);
    for (const invalid of [
      { refs: [ref] },
      { ...payload, refs: [ref, ref] },
      { ...payload, reviews: [{ ...preview.evidence, proof: '0'.repeat(64) }] },
      { ...payload, reviews: [{ ...preview.evidence, documents: [] }] },
    ])
      await expect(
        w.executions.approve(persona, { decisionId: 'unreviewed', operation: 'finance.approve', payload: invalid }),
      ).rejects.toThrow();
    await expect(w.reviews.validate({ ...persona, id: 'other' }, 'finance.approve', payload)).rejects.toThrow();
    await expect(
      w.reviews.validate({ ...persona, authorizationVersion: 'v2' }, 'finance.approve', payload),
    ).rejects.toThrow();
    w.advance(2 * 3600_000 + 1);
    await expect(w.reviews.validate(persona, 'finance.approve', payload)).rejects.toThrow(/gått ut/);
    expect(w.store.dump()).toEqual([]);
    expect(w.store.audit()).toEqual([]);
  });
  test('an approved version is audited once and exact replays survive evidence expiry; new decisions do not', async () => {
    const w = world(),
      { evidence } = await w.reviews.preview(persona, 'finance.record', ref);
    const input = {
      decisionId: 'reviewed',
      operation: 'finance.approve',
      payload: { refs: [ref], reviews: [evidence] },
    };
    const approved = await w.executions.approve(persona, input);
    expect(w.store.audit().map(e => e.action)).toEqual(['execution.approved']);
    await w.executions.progress(approved.id);
    expect((await w.executions.read(persona, approved.id))?.state).toBe('succeeded');
    w.advance(3 * 3600_000);
    expect((await w.executions.approve(persona, input)).id).toBe(approved.id);
    await expect(w.executions.approve(persona, { ...input, decisionId: 'different' })).rejects.toThrow(/gått ut/);
    expect(w.store.audit().filter(e => e.action === 'execution.approved')).toHaveLength(1);
  });
  test('the shared prepare gate also rejects an unreviewed job step before a transaction can commit', async () => {
    const w = world();
    await expect(
      w.executions.approveJob(persona, {
        decisionId: 'job',
        steps: [{ id: 'invoice', kind: 'execute', operation: 'finance.approve', payload: { refs: [ref] } }],
      }),
    ).rejects.toThrow(/Granska/);
    expect(w.store.audit()).toEqual([]);
    expect(w.store.outbox()).toEqual([]);
  });
});
test('semantic views reject mismatched series and duplicate documents even with loose connector schemas', async () => {
  const w = world();
  const output = await w.registry.run<{ series: Series }>(persona, 'finance.trend', {});
  const view: View = { kind: 'series', body: 'series', chart: 'line' };
  expect(viewOutputProblem(view, output)).toBeUndefined();
  output.series.series[0]!.values.pop();
  expect(viewOutputProblem(view, output)).toBeDefined();
  const b = await w.bundle();
  b.documents.push(b.documents[0]!);
  expect(viewOutputProblem({ kind: 'document', body: 'document' }, { document: b })).toBeDefined();
});
