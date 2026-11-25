import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import type { Actor } from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { manifestProblems, parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createConnector } from '../../connectors/billing/connector.mjs';
import {
  createFixtureRecords,
  FIXTURE_CUSTOMERS,
  SourceUnavailable,
  type BillingSource,
} from '../../connectors/billing/records.mjs';
import { customersFrom } from '../../connectors/billing/customers.mjs';
import { createBillingPreprocessor } from '../../connectors/billing/billingpreprocessor.mjs';
import { assertionFor, testJwks } from '../connector-authority';

/** The billing connector over the protocol: Lön och pension's records that wait for attest, decided one by one. */
const secret = 'test-secret-test-secret';
const lena: Actor = {
  id: 'lena',
  name: 'Lena Lönesson',
  unitId: 'unit-lop',
  unitLabel: 'Lön och pension',
  role: 'employee',
  userName: 'len01les',
};
const unnamed: Actor = { ...lena, id: 'unnamed', userName: undefined };
type Result = {
  headline: string;
  rows: Array<{ ref: string; outcome: string; detail: string }>;
  undoCapability?: string;
  undoInput?: { refs: string[]; references: Record<string, string> };
};
const NEW = ['6b1f3c1e-2a51-4d1e-9a3e-0c5a7d2e9b01', '9c2d4e5f-3b62-4e2f-8b4f-1d6b8e3f0c12'].map(id => 'billing:' + id);
const APPROVED = 'billing:c5071829-6e95-4152-9e72-40aeb1623f45';

function stack(source: BillingSource = createFixtureRecords({ today: () => '2026-11-24' }), errandLink?: string) {
  const service = createConnector({
    jwks: testJwks,
    secret,
    source,
    errandLink,
    customers: FIXTURE_CUSTOMERS,
    clock: () => new Date('2026-11-24T09:00:00+01:00'),
  });
  const connectorFetch: FetchLike = (input, init) => service.handle(new Request(input, init));
  const registry = new Registry();
  registry.register(
    remoteConnector(parseManifest(service.manifest, 'billing'), {
      url: 'http://billing',
      key: secret,
      assert: assertionFor('billing', secret),
      fetch: connectorFetch,
    }),
  );
  return { registry, connectorFetch, source, manifest: service.manifest };
}

describe('the billing connector', () => {
  test('the manifest is valid and passes the conformance check', async () => {
    const { connectorFetch, manifest } = stack(undefined, 'https://draken.example.invalid/arende/{errandNumber}');
    expect(manifestProblems(manifest, 'billing')).toEqual([]);
    const sign = (key: string) => assertionFor('billing', key);
    const report = await checkConnector({
      key: secret,
      url: 'http://billing',
      id: 'billing',
      assert: sign(secret),
      assertForeign: sign('another-secret-entirely'),
      fetch: connectorFetch,
    });
    expect(report.findings.filter(f => f.level === 'fail')).toEqual([]);
    expect(report.ok).toBe(true);
  });

  test('the scan gives one card with the waiting records as items, each named as Draken lists it, reviewed one at a time', async () => {
    const { registry } = stack();
    const [draft] = await registry.scan(lena);
    expect(draft!.topic).toBe('billing:records');
    expect(draft!.title).toMatch(/^Attestera 4 fakturor, 21\s374\skr$/);
    expect(draft!.deadline).toBe('2026-12-15');
    expect(draft!.items!.map(i => i.selected)).toEqual([false, false, false, false]);
    expect(draft!.items![0]!.label).toMatch(/^Extra löneutbetalning - Direktinsättning · 12\s500\skr$/);
    expect(draft!.items![0]!.detail).toMatch(
      /^Chef Per Holm · Vård- och omsorgsförvaltningen · 1 × 12\s500\skr · Ärende LoP-26110142$/,
    );
    expect(draft!.items![1]!.detail).toMatch(
      /^Chef Maria Sundin · Barn- och utbildningsförvaltningen · 2 × 1\s850\skr \+ Utvecklingskostnad 2% · /,
    );
    expect(draft!.items![2]!.detail).toMatch(/^Chef Jonas Ek · Kommunledningskontoret · 3 × 300\skr · /);
    expect(draft!.actions.map(a => [a.capability, a.role, !!a.confirm, a.review, a.preview])).toEqual([
      ['billing.approve', 'primary', false, 'each', 'billing.preview'],
      ['billing.reject', 'secondary', true, undefined, undefined],
    ]);
    // Clew refuses an observation whose scope is not the assignment it scanned (`stale-observation`).
    const observed = await registry.scanOne(lena, 'billing');
    expect(observed.observation).toMatchObject({ scope: 'unit-lop:employee', completeness: 'complete' });
  });

  test('the preview draws the record as one page, with its customer, its manager and its rows', async () => {
    const { registry } = stack();
    const out = await registry.run<{ title: string; mediaType: string; data: string }>(lena, 'billing.preview', {
      ref: NEW[1]!,
    });
    expect(out.title).toBe('Extra löneutbetalning - Systemet · LoP-26110198');
    expect(out.mediaType).toBe('image/svg+xml');
    const svg = Buffer.from(out.data, 'base64').toString('utf8');
    for (const text of ['Kommunledningskontoret', 'Jonas Ek', 'Ärende LoP-26110198', 'ansvar 15400', 'Att debitera'])
      expect(svg).toContain(text);
    expect(svg).not.toContain('<script');
    expect(svg).toContain('aria-label="Faktureringsunderlag: Extra löneutbetalning - Systemet');
    await expect(registry.run(lena, 'billing.preview', { ref: 'billing:0000' })).rejects.toThrow(/finns inte/);
  });

  test('the customer table is per type, since internal and external numbers overlap, and a wrong table stops the start', () => {
    const table = customersFrom('{"INTERNAL":{"15":"Servicecenter"},"EXTERNAL":{"15":"SKIFU"}}');
    expect(table).toEqual({ INTERNAL: { 15: 'Servicecenter' }, EXTERNAL: { 15: 'SKIFU' } });
    expect(customersFrom(undefined)).toEqual({ INTERNAL: {}, EXTERNAL: {} });
    expect(() => customersFrom('{"PRIVATE":{}}')).toThrow(/unknown type/);
    expect(() => customersFrom('{"INTERNAL":{"10":""}}')).toThrow(/needs a name/);
    expect(() => customersFrom('not json')).toThrow(/valid JSON/);
  });

  test('attest writes the decision as Draken does, reads it back, and the undo puts it back as it was', async () => {
    const source = createFixtureRecords({ today: () => '2026-11-24' });
    const { registry } = stack(source);
    const result = await registry.run<Result>(lena, 'billing.approve', { refs: NEW }, { operationId: 'op-1' });
    expect(result.rows.map(r => r.outcome)).toEqual(['done', 'done']);
    expect(result.headline).toBe('2 fakturor attesterade.');
    const after = await source.get('len01les', NEW[0]!.slice('billing:'.length));
    expect(after).toMatchObject({ status: 'APPROVED', approvedBy: 'Lena Lönesson' });
    expect(after.invoice.ourReference).toBe('Lena Lönesson');
    expect(source.calls.every(c => c.userName === 'len01les')).toBe(true);
    // The same operation again gets the first answer and changes nothing.
    expect(await registry.run<Result>(lena, 'billing.approve', { refs: NEW }, { operationId: 'op-1' })).toEqual(result);
    // A new decision on an attested record is refused with who decided.
    const again = await registry.run<Result>(lena, 'billing.approve', { refs: [NEW[0]!] });
    expect(again.rows[0]).toMatchObject({
      outcome: 'failed',
      detail: 'Fakturan är redan attesterad av Lena Lönesson.',
    });
    expect((await registry.scan(lena))[0]!.items).toHaveLength(2);

    expect(result.undoCapability).toBe('billing.reopen');
    const undo = await registry.run<Result>(lena, 'billing.reopen', result.undoInput!);
    expect(undo.rows.map(r => r.outcome)).toEqual(['done', 'done']);
    const back = await source.get('len01les', NEW[0]!.slice('billing:'.length));
    expect(back.status).toBe('NEW');
    expect(back.approvedBy).toBeUndefined();
    expect(back.invoice.ourReference).toBe('Lön och pension');
    expect((await registry.scan(lena))[0]!.items).toHaveLength(4);
  });

  test('reject is its own decision, and a record that has left for the economy system cannot be undone', async () => {
    const source = createFixtureRecords({ today: () => '2026-11-24' });
    const { registry } = stack(source);
    const rejected = await registry.run<Result>(lena, 'billing.reject', { refs: [NEW[1]!] });
    expect(rejected.headline).toBe('1 faktura avslagen.');
    expect((await source.get('len01les', NEW[1]!.slice(8))).status).toBe('REJECTED');
    const approved = await registry.run<Result>(lena, 'billing.approve', { refs: [NEW[0]!] });
    source.transfer();
    const undo = await registry.run<Result>(lena, 'billing.reopen', approved.undoInput!);
    expect(undo.rows[0]).toMatchObject({ outcome: 'failed' });
    expect(
      (await registry.run<Result>(lena, 'billing.approve', { refs: [APPROVED, 'billing:0000'] })).rows.map(r => [
        r.outcome,
        r.detail,
      ]),
    ).toEqual([
      ['failed', 'Fakturan är redan överförd till ekonomisystemet.'],
      ['failed', 'Finns inte i Lön och pension.'],
    ]);
  });

  test('a write whose answer is missing is unknown, and the lookup settles it from the source', async () => {
    const fixture = createFixtureRecords({ today: () => '2026-11-24' });
    let lose = true;
    const source: BillingSource = {
      ...fixture,
      async put(userName, record) {
        const written = await fixture.put(userName, record);
        if (lose) throw new SourceUnavailable('The answer was lost.');
        return written;
      },
    };
    const { registry } = stack(source);
    const result = await registry.run<Result>(lena, 'billing.approve', { refs: [NEW[0]!] }, { operationId: 'op-u' });
    expect(result.rows[0]!.outcome).toBe('unknown');
    lose = false;
    const looked = await registry.run<{ found: boolean; result: Result }>(lena, 'billing.lookup', {
      operationId: 'op-u',
    });
    expect(looked.found).toBe(true);
    expect(looked.result.rows[0]!.outcome).toBe('done');
    expect(
      await registry.run<{ found: boolean }>({ ...lena, id: 'someone-else' }, 'billing.lookup', {
        operationId: 'op-u',
      }),
    ).toEqual({ found: false });
  });

  test('a person without a user name reads nothing and decides nothing, and an outage is not an empty list', async () => {
    const { registry } = stack();
    await expect(registry.run(unnamed, 'billing.records', {})).rejects.toThrow(/användarnamn/);
    const decided = await registry.run<Result>(unnamed, 'billing.approve', { refs: [NEW[0]!] });
    expect(decided.rows[0]!.outcome).toBe('failed');
    const down = stack(createFixtureRecords({ fault: 'unavailable' }));
    await expect(down.registry.run(lena, 'billing.records', {})).rejects.toThrow(/svarar inte/);
    const decidedDown = await down.registry.run<Result>(lena, 'billing.approve', { refs: [NEW[0]!] });
    expect(decidedDown.rows[0]).toMatchObject({
      outcome: 'failed',
      detail: 'Lön och pension svarar inte. Inget skickades.',
    });
  });

  test('the record names its manager and customer, and the link leads to its errand', async () => {
    const { registry } = stack(undefined, 'https://draken.example.invalid/arende/{errandNumber}');
    const record = await registry.run<{ chef: string; customer: string; status: string; lines: unknown[] }>(
      lena,
      'billing.record',
      { ref: NEW[0]! },
    );
    expect(record).toMatchObject({ chef: 'Tove Lind', customer: 'Kommunledningskontoret', status: 'Väntar på attest' });
    expect(record.lines).toHaveLength(1);
    expect(await registry.run(lena, 'billing.open', { ref: NEW[0]! })).toEqual({
      url: 'https://draken.example.invalid/arende/LoP-26110214',
    });
  });
});

describe('BillingPreprocessor behind the gateway', () => {
  test('a token from the client credentials, the person in X-Sent-By, and only the category', async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const record = {
      id: 'abc-1',
      category: 'SALARY_AND_PENSION',
      status: 'NEW',
      type: 'INTERNAL',
      created: '2026-11-02T09:00:00Z',
      recipient: { organizationName: 'Kommunstyrelsekontoret' },
      extraParameters: { errandNumber: 'LoP-1' },
      invoice: {
        description: 'Extra utbetalning',
        totalAmount: 306,
        invoiceRows: [
          { descriptions: ['Ärendenummer: LoP-1'], quantity: '1', costPerUnit: 300, totalAmount: 300 },
          {
            descriptions: ['Utvecklingskostnad 2%'],
            quantity: 1,
            costPerUnit: 6,
            totalAmount: 6,
            detailedDescriptions: [''],
          },
        ],
      },
    };
    const fetch = async (url: string, init: RequestInit = {}) => {
      calls.push({ url, init });
      if (url.endsWith('/token')) return Response.json({ access_token: 'gateway-token', expires_in: 3600 });
      if (url.includes('/billingrecords/other'))
        return Response.json({ ...record, id: 'other', category: 'MEX_INVOICE' });
      if (init.method === 'PUT') return new Response(null, { status: 204 });
      if (url.includes('/billingrecords/abc-1')) return Response.json(record);
      return Response.json({ content: [record, { ...record, id: 'x', category: 'MEX_INVOICE' }], last: true });
    };
    const api = createBillingPreprocessor({
      url: 'https://gateway.example.invalid/billingpreprocessor/4.5',
      tokenUrl: 'https://gateway.example.invalid/token',
      clientId: 'clew',
      clientSecret: 'client-secret',
      municipalityId: '2281',
      fetch,
    });
    expect((await api.list('len01les')).map(r => r.id)).toEqual(['abc-1']);
    const listed = calls.find(c => c.url.includes('/2281/billingrecords?'))!;
    expect(decodeURIComponent(listed.url)).toContain("filter=category:'SALARY_AND_PENSION' and status:'NEW'");
    expect(listed.init.headers).toMatchObject({
      authorization: 'Bearer gateway-token',
      'x-sent-by': 'type=adAccount; len01les',
    });
    await expect(api.get('len01les', 'other')).rejects.toThrow();
    expect(await api.put('len01les', { ...record, status: 'APPROVED', approvedBy: 'Lena Lestander' })).toBeNull();
    // Written as Draken shapes it: what the API computes or owns is left out, the rest goes as it was read.
    expect(JSON.parse(String(calls.find(c => c.init.method === 'PUT')!.init.body))).toEqual({
      category: 'SALARY_AND_PENSION',
      type: 'INTERNAL',
      status: 'APPROVED',
      approvedBy: 'Lena Lestander',
      extraParameters: { errandNumber: 'LoP-1' },
      invoice: {
        description: 'Extra utbetalning',
        invoiceRows: [
          { descriptions: ['Ärendenummer: LoP-1'], quantity: 1, costPerUnit: 300, detailedDescriptions: [] },
          { descriptions: ['Utvecklingskostnad 2%'], quantity: 1, costPerUnit: 6, detailedDescriptions: [] },
        ],
      },
    });
    expect(calls.filter(c => c.url.endsWith('/token'))).toHaveLength(1);
    await expect(api.list('not an account')).rejects.toThrow();
  });
});
