import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { type Actor } from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createConnector, manifest as absenceManifest } from '../../connectors/absence/connector.mjs';
import type { Statistics } from '../../connectors/absence/connector.mjs';
import { StatisticsUnavailable, createFixtureStatistics } from '../../connectors/absence/statistics.mjs';
import { createQlikStatistics, toRowFromCells, type SocketLike } from '../../connectors/absence/qlik.mjs';
import { assertionFor, testJwks } from '../connector-authority';

/**
 * The absence statistics connector (D82): aggregates per unit and month, a group below the minimum held back, the
 * area figure, and Qlik's Engine API as an adapter, run here against a fake engine on the socket. Over the protocol.
 */
const secret = 'test-secret-test-secret';
const hillevi: Actor = {
  id: 'hillevi',
  name: 'Hillevi Berg',
  unitId: 'unit-skola',
  unitLabel: 'Bergsåkers skola',
  role: 'manager',
};
const hassan: Actor = {
  id: 'hassan',
  name: 'Hassan Ali',
  unitId: 'unit-omsorg',
  unitLabel: 'Hemtjänst Centrum',
  role: 'employee',
};
const itChief: Actor = {
  id: 'it-chief',
  name: 'Iris Chef',
  unitId: 'unit-it',
  unitLabel: 'IT och digitalisering',
  role: 'manager',
};
const elsewhere: Actor = { ...hillevi, id: 'other', unitId: 'unit-annan', unitLabel: 'Annan enhet' };
const fixture = () => createFixtureStatistics({ now: () => new Date('2026-11-06T09:00:00Z') });

type UnitRow = {
  ref: string;
  unit: string;
  period: string;
  month: string;
  total?: number;
  short?: number;
  long?: number;
  lastYear?: number;
  change?: number;
  headcount?: number;
  note?: string;
};

function stack(options: Parameters<typeof createConnector>[0] = {}) {
  const service = createConnector({ jwks: testJwks, secret, statistics: fixture(), ...options });
  const connectorFetch: FetchLike = (input, init) => service.handle(new Request(input, init));
  const registry = new Registry().register(
    remoteConnector(parseManifest(absenceManifest, 'absence'), {
      url: 'http://absence',
      key: secret,
      assert: assertionFor('absence', secret),
      fetch: connectorFetch,
    }),
  );
  return { registry, connectorFetch, service };
}

describe('the absence connector', () => {
  test('the manifest is valid: two reads for managers, table views, an area with a figure, no scan', () => {
    const manifest = parseManifest(absenceManifest, 'absence');
    expect(manifest.capabilities.map(c => [c.name, c.kind, c.view?.kind, c.scope.roles])).toEqual([
      ['absence.unitRates', 'read', 'table', ['manager']],
      ['absence.trend', 'read', 'table', ['manager']],
    ]);
    expect(manifest.scan).toBe(false);
    expect(manifest.areas).toMatchObject([{ id: 'absence', roles: ['manager'], figure: true }]);
  });

  test("a manager reads their unit's latest closed month against the same month last year", async () => {
    const { registry } = stack();
    const out = await registry.run<{ updated: string; rows: UnitRow[] }>(hillevi, 'absence.unitRates', {});
    expect(out.updated).toBe('2026-11-06T03:00:00.000Z');
    expect(out.rows).toHaveLength(1);
    const [row] = out.rows;
    expect(row).toMatchObject({
      unit: 'Bergsåkers skola',
      period: '2026-10',
      month: 'oktober 2026',
      total: 5.3,
      lastYear: 5.5,
      change: -0.2,
      headcount: 46,
    });
    expect(row!.ref).toMatch(/^unit:[0-9a-f]{16}$/);
    expect(row!.short! + row!.long!).toBeCloseTo(5.3, 0);
    expect(row).not.toHaveProperty('note');
  });

  test('a group smaller than the minimum is held back, in the table and in every month of its trend', async () => {
    const { registry } = stack();
    const out = await registry.run<{ rows: UnitRow[] }>(itChief, 'absence.unitRates', {});
    expect(out.rows.map(r => r.unit)).toEqual(['IT och digitalisering', 'Servicedesk']);
    const small = out.rows[1]!;
    expect(small).toEqual({
      ref: small.ref,
      unit: 'Servicedesk',
      period: '2026-10',
      month: 'oktober 2026',
      note: 'Färre än 5 medarbetare. Visas inte.',
    });
    const trend = await registry.run<{ rows: UnitRow[] }>(itChief, 'absence.trend', { unit: small.ref });
    expect(trend.rows).toHaveLength(12);
    expect(trend.rows.every(r => r.total === undefined && r.headcount === undefined && !!r.note)).toBe(true);
    // A lower minimum is the operator's choice, after HR and the data protection officer (D82).
    const lower = stack({ minGroup: 3 });
    const shown = await lower.registry.run<{ rows: UnitRow[] }>(itChief, 'absence.unitRates', {});
    expect(shown.rows[1]).toMatchObject({ unit: 'Servicedesk', headcount: 4 });
    expect(shown.rows[1]!.total).toBeNumber();
  });

  test('the trend is twelve months newest first, opened from a row; a unit that is not theirs is not found', async () => {
    const { registry } = stack();
    const { rows } = await registry.run<{ rows: UnitRow[] }>(hillevi, 'absence.unitRates', {});
    const trend = await registry.run<{ unit: string; rows: UnitRow[] }>(hillevi, 'absence.trend', {
      unit: rows[0]!.ref,
    });
    expect(trend.unit).toBe('Bergsåkers skola');
    expect(trend.rows.map(r => r.period)).toEqual([
      '2026-10',
      '2026-09',
      '2026-08',
      '2026-07',
      '2026-06',
      '2026-05',
      '2026-04',
      '2026-03',
      '2026-02',
      '2026-01',
      '2025-12',
      '2025-11',
    ]);
    expect(trend.rows[0]).toMatchObject({ ref: 'month:2026-10', month: 'oktober 2026', total: 5.3, lastYear: 5.5 });
    // Without input it is the first of the person's units.
    expect((await registry.run<{ unit: string }>(hillevi, 'absence.trend', {})).unit).toBe('Bergsåkers skola');
    const { rows: theirs } = await registry.run<{ rows: UnitRow[] }>(itChief, 'absence.unitRates', {});
    await expect(registry.run(hillevi, 'absence.trend', { unit: theirs[0]!.ref })).rejects.toThrow(
      'Enheten finns inte bland dina enheter.',
    );
    await expect(registry.run(hillevi, 'absence.trend', { unit: 'Bergsåkers skola' })).rejects.toThrow();
  });

  test('a manager whose unit is not in the statistics gets no rows and no figure', async () => {
    const { registry } = stack();
    expect((await registry.run<{ rows: UnitRow[] }>(elsewhere, 'absence.unitRates', {})).rows).toEqual([]);
    expect(await registry.run(elsewhere, 'absence.trend', {})).toMatchObject({ unit: 'Annan enhet', rows: [] });
    expect((await registry.areas(elsewhere)).find(a => a.id === 'absence')?.figure).toBeNull();
  });

  test('an employee neither sees the area nor gets an answer from the connector itself', async () => {
    const { registry, connectorFetch } = stack();
    expect((await registry.areas(hassan)).map(a => a.id)).not.toContain('absence');
    await expect(registry.run(hassan, 'absence.unitRates', {})).rejects.toThrow();
    // Past Clew's scope check, the connector refuses on the verified role.
    const response = await connectorFetch('http://absence/clew/capabilities/absence.unitRates', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + (await assertionFor('absence', secret)(hassan)),
        'x-clew-connector-key': secret,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ actor: hassan, input: {} }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: 'denied', message: 'Bara chefer ser sjukfrånvarostatistiken.' },
    });
  });

  test('the area figure (D54) says the rate, the month and last year, and opens the table of units', async () => {
    const plain = await stack().registry.areas(hillevi);
    expect(plain.find(a => a.id === 'absence')?.figure).toMatchObject({
      label: 'Sjukfrånvaro',
      value: '5,3 %',
      comparison: 'oktober 2026 · 5,5 % i fjol, −0,2',
      tone: 'none',
      opens: { capability: 'absence.unitRates', title: 'Sjukfrånvaro per enhet' },
    });
    // The tone is the organisation's threshold, not the connector's: warn at or above it, ok below.
    const warned = await stack({ warnAbove: 5 }).registry.areas(hillevi);
    expect(warned.find(a => a.id === 'absence')?.figure).toMatchObject({ tone: 'warn' });
    const calm = await stack({ warnAbove: 6 }).registry.areas(hillevi);
    expect(calm.find(a => a.id === 'absence')?.figure).toMatchObject({ tone: 'ok' });
  });

  test('aggregates are read once per cache window, and again after it', async () => {
    let reads = 0;
    let clock = 0;
    const inner = fixture();
    const statistics: Statistics = {
      read: () => {
        reads++;
        return inner.read();
      },
    };
    const { registry } = stack({ statistics, cacheSeconds: 60, now: () => clock });
    await Promise.all([
      registry.run(hillevi, 'absence.unitRates', {}),
      registry.run(hillevi, 'absence.trend', {}),
      registry.areas(hillevi),
    ]);
    expect(reads).toBe(1);
    clock = 61_000;
    await registry.run(hillevi, 'absence.unitRates', {});
    expect(reads).toBe(2);
  });

  test('a source that fails is "unavailable" in Swedish, without the source\'s own words', async () => {
    const statistics: Statistics = {
      read: async () => {
        throw new StatisticsUnavailable('Engine error 403 for qlikbot\\abc');
      },
    };
    const { registry, connectorFetch } = stack({ statistics });
    await expect(registry.run(hillevi, 'absence.unitRates', {})).rejects.toThrow(
      'Sjukfrånvarostatistiken svarar inte just nu.',
    );
    const response = await connectorFetch('http://absence/clew/figure', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + (await assertionFor('absence', secret)(hillevi)),
        'x-clew-connector-key': secret,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ actor: hillevi, area: 'absence' }),
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('qlikbot');
  });

  test('passes the conformance check and refuses another secret', async () => {
    const { connectorFetch } = stack();
    const sign = (key: string) => assertionFor('absence', key);
    const report = await checkConnector({
      key: secret,
      url: 'http://absence',
      id: 'absence',
      assert: sign(secret),
      assertForeign: sign('another-secret-entirely'),
      fetch: connectorFetch,
    });
    expect(report.findings.filter(f => f.level === 'fail')).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

/** A fake of the part of Qlik's Engine API the adapter calls, behind a socket: JSON-RPC 2.0, one app, one cube. */
type Cell = { qText?: string; qNum: number | 'NaN' };
function fakeEngine(options: { matrix: Cell[][]; reload?: string; fail?: string; silent?: boolean }) {
  const seen: { url?: string; headers?: Record<string, string>; calls: Array<{ method: string; params: any }> } = {
    calls: [],
  };
  const socket = (url: string, headers: Record<string, string>): SocketLike => {
    seen.url = url;
    seen.headers = headers;
    const target = new EventTarget();
    const emit = (data: unknown) =>
      queueMicrotask(() => target.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(data) })));
    const ws = {
      readyState: 0,
      addEventListener: target.addEventListener.bind(target),
      close() {
        ws.readyState = 3;
        target.dispatchEvent(new Event('close'));
      },
      send(text: string) {
        const m = JSON.parse(text);
        seen.calls.push({ method: m.method, params: m.params });
        if (options.silent) return;
        if (m.method === options.fail)
          return emit({ jsonrpc: '2.0', id: m.id, error: { code: 1002, message: 'secret' } });
        const result =
          m.method === 'OpenDoc'
            ? { qReturn: { qType: 'Doc', qHandle: 1 } }
            : m.method === 'GetAppLayout'
              ? { qLayout: { qTitle: 'Personal', qLastReloadTime: options.reload ?? '2026-11-06T02:14:33.123Z' } }
              : m.method === 'CreateSessionObject'
                ? { qReturn: { qType: 'GenericObject', qHandle: 2 } }
                : m.method === 'GetLayout'
                  ? { qLayout: { qHyperCube: { qSize: { qcx: 6, qcy: options.matrix.length } } } }
                  : m.method === 'GetHyperCubeData'
                    ? (() => {
                        const p = m.params.qPages[0];
                        return { qDataPages: [{ qMatrix: options.matrix.slice(p.qTop, p.qTop + p.qHeight) }] };
                      })()
                    : undefined;
        emit(
          result === undefined
            ? { jsonrpc: '2.0', id: m.id, error: { code: -32601 } }
            : { jsonrpc: '2.0', id: m.id, result },
        );
      },
    };
    setTimeout(() => {
      ws.readyState = 1;
      target.dispatchEvent(new Event('open'));
      emit({ jsonrpc: '2.0', method: 'OnConnected', params: { qSessionState: 'SESSION_CREATED' } });
    }, 0);
    return ws;
  };
  return { socket, seen };
}

const cube = {
  unit: 'Enhet',
  period: 'Månad',
  measures: {
    total: 'Sum(Frånvarotid)/Sum(Arbetstid)',
    short: 'library:abcShort',
    long: 'library:abcLong',
    headcount: 'Count(distinct Anställd)',
  },
};
const cells = (unit: string, month: Cell, total: number, short: number, long: number, headcount: number): Cell[] => [
  { qText: unit, qNum: 'NaN' },
  month,
  { qNum: total },
  { qNum: short },
  { qNum: long },
  { qNum: headcount },
];

describe('the Qlik Engine adapter', () => {
  test('opens the app with the token, asks for one hypercube, pages it and maps fractions to percentages', async () => {
    // 2000 rows over six columns is more than one 10,000-cell page.
    const matrix = Array.from({ length: 2000 }, (_, i) =>
      cells(`Enhet ${i}`, { qText: '2026-10', qNum: 46296 }, 0.0531, 0.0292, 0.0239, 46),
    );
    const engine = fakeEngine({ matrix });
    const statistics = createQlikStatistics({
      url: 'wss://qlik.kommun.example/clew',
      appId: 'a1b2-c3',
      token: async () => 'service-jwt',
      cube,
      socket: engine.socket,
    });
    const data = await statistics.read();
    expect(engine.seen.url).toBe('wss://qlik.kommun.example/clew/app/a1b2-c3');
    expect(engine.seen.headers).toEqual({ authorization: 'Bearer service-jwt' });
    expect(engine.seen.calls.map(c => c.method)).toEqual([
      'OpenDoc',
      'GetAppLayout',
      'CreateSessionObject',
      'GetLayout',
      'GetHyperCubeData',
      'GetHyperCubeData',
    ]);
    expect(engine.seen.calls[0]!.params).toEqual({ qDocName: 'a1b2-c3' });
    const def = engine.seen.calls[2]!.params.qProp.qHyperCubeDef;
    expect(def.qDimensions).toEqual([{ qDef: { qFieldDefs: ['Enhet'] } }, { qDef: { qFieldDefs: ['Månad'] } }]);
    expect(def.qMeasures).toEqual([
      { qDef: { qDef: 'Sum(Frånvarotid)/Sum(Arbetstid)' } },
      { qLibraryId: 'abcShort' },
      { qLibraryId: 'abcLong' },
      { qDef: { qDef: 'Count(distinct Anställd)' } },
    ]);
    expect(engine.seen.calls[4]!.params.qPages).toEqual([{ qLeft: 0, qTop: 0, qWidth: 6, qHeight: 1666 }]);
    expect(engine.seen.calls[5]!.params.qPages).toEqual([{ qLeft: 0, qTop: 1666, qWidth: 6, qHeight: 334 }]);
    expect(data.reloadedAt).toBe('2026-11-06T02:14:33.123Z');
    expect(data.rows).toHaveLength(2000);
    expect(data.rows[0]).toEqual({
      unit: 'Enhet 0',
      period: '2026-10',
      total: 5.3,
      short: 2.9,
      long: 2.4,
      headcount: 46,
    });
  });

  test('reads a month from a Qlik date number, and a missing value as no value', () => {
    const measures = ['total', 'short', 'long', 'headcount'];
    // 46296 is 2026-10-01 in Qlik's day count from 1899-12-30.
    expect(toRowFromCells(cells('A', { qText: 'okt 2026', qNum: 46296 }, 0.05, 0.03, 0.02, 9), measures)).toMatchObject(
      {
        period: '2026-10',
      },
    );
    const missing = toRowFromCells(
      [
        { qText: 'A', qNum: 'NaN' },
        { qText: '2026-10-01', qNum: 46296 },
        { qNum: 'NaN' },
        { qNum: 0.03 },
        { qNum: 0.02 },
        { qNum: 'NaN' },
      ],
      measures,
    );
    expect(missing).toEqual({ unit: 'A', period: '2026-10', total: null, short: 3, long: 2, headcount: null });
    expect(toRowFromCells(cells('A', { qText: '5.2', qNum: 'NaN' }, 5.2, 3, 2.2, 9), measures, 'percent')).toBeNull();
    expect(
      toRowFromCells(cells('A', { qText: '2026-10', qNum: 'NaN' }, 5.2, 3, 2.2, 9), measures, 'percent'),
    ).toMatchObject({
      total: 5.2,
    });
  });

  test("an engine error, a closed socket or no answer in time is unavailable, without the engine's words", async () => {
    const options = { url: 'wss://qlik.kommun.example', appId: 'app', cube };
    for (const engine of [
      fakeEngine({ matrix: [], fail: 'OpenDoc' }),
      fakeEngine({
        matrix: [cells('A', { qText: '2026-10', qNum: 46296 }, 0.05, 0.03, 0.02, 9)],
        fail: 'GetHyperCubeData',
      }),
    ]) {
      const error = await createQlikStatistics({ ...options, socket: engine.socket })
        .read()
        .catch(e => e);
      expect(error).toBeInstanceOf(StatisticsUnavailable);
      expect(error.message).not.toContain('secret');
    }
    const silent = fakeEngine({ matrix: [], silent: true });
    await expect(
      createQlikStatistics({ ...options, socket: silent.socket, timeoutMs: 30 }).read(),
    ).rejects.toBeInstanceOf(StatisticsUnavailable);
  });

  test('refuses a configuration that would read without TLS or without a headcount', () => {
    const base = { appId: 'app', cube };
    expect(() => createQlikStatistics({ ...base, url: 'ws://qlik.kommun.example' })).toThrow('wss://');
    expect(() => createQlikStatistics({ ...base, url: 'ws://localhost:9076' })).not.toThrow();
    expect(() =>
      createQlikStatistics({
        ...base,
        url: 'wss://qlik.kommun.example',
        cube: { ...cube, measures: { total: 'x' } as never },
      }),
    ).toThrow('headcount');
  });

  test('the connector over the Qlik adapter: the operator maps Clew units to Qlik units', async () => {
    const matrix = [
      cells('Barn- och utbildningsförvaltningen', { qText: '2025-10', qNum: 45931 }, 0.061, 0.035, 0.026, 812),
      cells('Barn- och utbildningsförvaltningen', { qText: '2026-10', qNum: 46296 }, 0.052, 0.03, 0.022, 806),
      cells('Socialtjänsten', { qText: '2026-10', qNum: 46296 }, 0.081, 0.04, 0.041, 1204),
    ];
    const engine = fakeEngine({ matrix });
    const statistics = createQlikStatistics({
      url: 'wss://qlik.kommun.example',
      appId: 'app',
      cube,
      socket: engine.socket,
    });
    const { registry } = stack({ statistics, unitMap: { 'unit-skola': ['Barn- och utbildningsförvaltningen'] } });
    const { rows } = await registry.run<{ rows: UnitRow[] }>(hillevi, 'absence.unitRates', {});
    expect(rows).toEqual([
      {
        ref: rows[0]!.ref,
        unit: 'Barn- och utbildningsförvaltningen',
        period: '2026-10',
        month: 'oktober 2026',
        total: 5.2,
        short: 3,
        long: 2.2,
        lastYear: 6.1,
        change: -0.9,
        headcount: 806,
      },
    ]);
    expect(JSON.stringify(rows)).not.toContain('Socialtjänsten');
  });
});
