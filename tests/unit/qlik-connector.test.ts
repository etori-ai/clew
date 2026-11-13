import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { fieldTone, placesOf, type Actor } from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createConnector, manifest as qlikManifest } from '../../connectors/qlik/connector.mjs';
import type { Statistics } from '../../connectors/qlik/connector.mjs';
import { StatisticsUnavailable, createFixtureStatistics } from '../../connectors/qlik/statistics.mjs';
import { createQlikStatistics, toRowFromCells, type SocketLike } from '../../connectors/qlik/engine.mjs';
import { assertionFor, testJwks } from '../connector-authority';

/**
 * The Qlik connector (D82), sick leave its first area: aggregates per unit and month, a group below the minimum held back, the
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
    remoteConnector(parseManifest(qlikManifest, 'qlik'), {
      url: 'http://qlik',
      key: secret,
      assert: assertionFor('qlik', secret),
      fetch: connectorFetch,
    }),
  );
  return { registry, connectorFetch, service };
}

describe('the qlik connector', () => {
  test('the manifest is valid: reads for managers, tables, charts, reads about a unit, three areas with figures, no scan', () => {
    const manifest = parseManifest(qlikManifest, 'qlik');
    expect(manifest.capabilities.map(c => [c.name, c.kind, c.view?.kind, c.scope.roles, c.about])).toEqual([
      ['qlik.sickLeaveByUnit', 'read', 'table', ['manager'], undefined],
      ['qlik.sickLeaveTrend', 'read', 'table', ['manager'], undefined],
      ['qlik.unit', 'read', 'list', ['manager'], { entity: 'unit' }],
      ['qlik.sickLeaveChart', 'read', 'series', ['manager'], undefined],
      ['qlik.economyByUnit', 'read', 'table', ['manager'], undefined],
      ['qlik.economyChart', 'read', 'series', ['manager'], undefined],
      ['qlik.economyUnit', 'read', 'list', ['manager'], { entity: 'unit' }],
      ['qlik.hmeByUnit', 'read', 'table', ['manager'], undefined],
      ['qlik.hmeChart', 'read', 'series', ['manager'], undefined],
      ['qlik.hmeUnit', 'read', 'list', ['manager'], { entity: 'unit' }],
    ]);
    expect(manifest.scan).toBe(false);
    expect(manifest.areas).toMatchObject([
      { id: 'sick-leave', roles: ['manager'], figure: true },
      { id: 'economy', roles: ['manager'], figure: true },
      { id: 'hme', roles: ['manager'], figure: true },
    ]);
  });

  test("a manager reads their unit's latest closed month against the same month last year", async () => {
    const { registry } = stack();
    const out = await registry.run<{ updated: string; rows: UnitRow[] }>(hillevi, 'qlik.sickLeaveByUnit', {});
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
    const out = await registry.run<{ rows: UnitRow[] }>(itChief, 'qlik.sickLeaveByUnit', {});
    expect(out.rows.map(r => r.unit)).toEqual(['IT och digitalisering', 'Servicedesk']);
    const small = out.rows[1]!;
    expect(small).toEqual({
      ref: small.ref,
      unit: 'Servicedesk',
      period: '2026-10',
      month: 'oktober 2026',
      note: 'Färre än 5 medarbetare. Visas inte.',
    });
    const trend = await registry.run<{ rows: UnitRow[] }>(itChief, 'qlik.sickLeaveTrend', { unit: small.ref });
    expect(trend.rows).toHaveLength(12);
    expect(trend.rows.every(r => r.total === undefined && r.headcount === undefined && !!r.note)).toBe(true);
    // A lower minimum is the operator's choice, after HR and the data protection officer (D82).
    const lower = stack({ minGroup: 3 });
    const shown = await lower.registry.run<{ rows: UnitRow[] }>(itChief, 'qlik.sickLeaveByUnit', {});
    expect(shown.rows[1]).toMatchObject({ unit: 'Servicedesk', headcount: 4 });
    expect(shown.rows[1]!.total).toBeNumber();
  });

  test('the trend is twelve months newest first, opened from a row; a unit that is not theirs is not found', async () => {
    const { registry } = stack();
    const { rows } = await registry.run<{ rows: UnitRow[] }>(hillevi, 'qlik.sickLeaveByUnit', {});
    const trend = await registry.run<{ unit: string; rows: UnitRow[] }>(hillevi, 'qlik.sickLeaveTrend', {
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
    expect((await registry.run<{ unit: string }>(hillevi, 'qlik.sickLeaveTrend', {})).unit).toBe('Bergsåkers skola');
    const { rows: theirs } = await registry.run<{ rows: UnitRow[] }>(itChief, 'qlik.sickLeaveByUnit', {});
    await expect(registry.run(hillevi, 'qlik.sickLeaveTrend', { unit: theirs[0]!.ref })).rejects.toThrow(
      'Enheten finns inte bland dina enheter.',
    );
    await expect(registry.run(hillevi, 'qlik.sickLeaveTrend', { unit: 'Bergsåkers skola' })).rejects.toThrow();
  });

  test('qlik.unit says it is about a unit (D97): the manager’s own unit by Clew’s id, any other id no row', async () => {
    const declared = parseManifest(qlikManifest, 'qlik').capabilities.find(c => c.name === 'qlik.unit')!;
    expect([declared.model, declared.about]).toEqual([false, { entity: 'unit' }]);
    expect(placesOf(declared)).toEqual(['lens', 'mark', 'section']);
    const watch = declared.view?.kind === 'list' ? declared.view.fields.find(f => f.key === 'watch')! : undefined;
    expect([fieldTone(watch!, 'Bevaka'), fieldTone(watch!, undefined)]).toEqual(['warn', 'none']);
    const { registry } = stack();
    expect(registry.tools(hillevi).map(t => t.name)).not.toContain('qlik.unit');
    const unit = (actor: Actor, keys: string[]) =>
      registry.run<{ rows: Array<Record<string, unknown>> }>(actor, 'qlik.unit', { keys });
    const keys = ['unit-omsorg', 'unit-skola', 'unit-skola', 'unit-okand'];
    const [row, ...more] = (await unit(hillevi, keys)).rows;
    expect(more).toEqual([]);
    expect(row).toEqual({
      key: 'unit-skola',
      ref: expect.stringMatching(/^unit:[0-9a-f]{16}$/),
      unit: 'Bergsåkers skola',
      month: 'oktober 2026',
      total: 5.3,
      lastYear: 5.5,
      change: -0.2,
      headcount: 46,
    });
    // The row opens the unit's trend by its ref.
    const trend = await registry.run<{ unit: string }>(hillevi, 'qlik.sickLeaveTrend', { unit: row!.ref });
    expect(trend.unit).toBe('Bergsåkers skola');
    // Of two source units, the first with a rate to show; a manager whose unit the statistics lack gets no row.
    expect((await unit(itChief, ['unit-it'])).rows).toMatchObject([{ key: 'unit-it', unit: 'IT och digitalisering' }]);
    expect((await unit(elsewhere, ['unit-annan', 'unit-skola'])).rows).toEqual([]);
    await expect(unit(hassan, ['unit-omsorg'])).rejects.toThrow();
    // A rate to watch from is the operator's: at or above it the row says "Bevaka", and Clew marks the unit.
    const watched = await stack({ warnAbove: 5 }).registry.run<{ rows: Array<{ watch?: string }> }>(
      hillevi,
      'qlik.unit',
      { keys: ['unit-skola'] },
    );
    expect(watched.rows[0]!.watch).toBe('Bevaka');
  });

  test('a manager whose unit is not in the statistics gets no rows and no figure', async () => {
    const { registry } = stack();
    expect((await registry.run<{ rows: UnitRow[] }>(elsewhere, 'qlik.sickLeaveByUnit', {})).rows).toEqual([]);
    expect(await registry.run(elsewhere, 'qlik.sickLeaveTrend', {})).toMatchObject({ unit: 'Annan enhet', rows: [] });
    expect((await registry.areas(elsewhere)).find(a => a.id === 'sick-leave')?.figure).toBeNull();
  });

  test('an employee neither sees the area nor gets an answer from the connector itself', async () => {
    const { registry, connectorFetch } = stack();
    expect((await registry.areas(hassan)).map(a => a.id)).not.toContain('sick-leave');
    await expect(registry.run(hassan, 'qlik.sickLeaveByUnit', {})).rejects.toThrow();
    // Past Clew's scope check, the connector refuses on the verified role.
    const response = await connectorFetch('http://qlik/clew/capabilities/qlik.sickLeaveByUnit', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + (await assertionFor('qlik', secret)(hassan)),
        'x-clew-connector-key': secret,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ actor: hassan, input: {} }),
    });
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({
      error: { code: 'denied', message: 'Bara chefer ser statistiken.' },
    });
  });

  test('the area figure (D54) says the rate, the month and last year, and opens the table of units', async () => {
    const plain = await stack().registry.areas(hillevi);
    expect(plain.find(a => a.id === 'sick-leave')?.figure).toMatchObject({
      label: 'Sjukfrånvaro',
      value: '5,3 %',
      comparison: 'oktober 2026 · 5,5 % i fjol, −0,2',
      tone: 'none',
      opens: { capability: 'qlik.sickLeaveByUnit', title: 'Sjukfrånvaro per enhet' },
    });
    // The tone is the organisation's threshold, not the connector's: warn at or above it, ok below.
    const warned = await stack({ warnAbove: 5 }).registry.areas(hillevi);
    expect(warned.find(a => a.id === 'sick-leave')?.figure).toMatchObject({ tone: 'warn' });
    const calm = await stack({ warnAbove: 6 }).registry.areas(hillevi);
    expect(calm.find(a => a.id === 'sick-leave')?.figure).toMatchObject({ tone: 'ok' });
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
      registry.run(hillevi, 'qlik.sickLeaveByUnit', {}),
      registry.run(hillevi, 'qlik.sickLeaveTrend', {}),
      registry.areas(hillevi),
    ]);
    expect(reads).toBe(1);
    clock = 61_000;
    await registry.run(hillevi, 'qlik.sickLeaveByUnit', {});
    expect(reads).toBe(2);
  });

  test('a source that fails is "unavailable" in Swedish, without the source\'s own words', async () => {
    const statistics: Statistics = {
      read: async () => {
        throw new StatisticsUnavailable('Engine error 403 for qlikbot\\abc');
      },
    };
    const { registry, connectorFetch } = stack({ statistics });
    await expect(registry.run(hillevi, 'qlik.sickLeaveByUnit', {})).rejects.toThrow('Qlik svarar inte just nu.');
    const response = await connectorFetch('http://qlik/clew/figure', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + (await assertionFor('qlik', secret)(hillevi)),
        'x-clew-connector-key': secret,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ actor: hillevi, area: 'sick-leave' }),
    });
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('qlikbot');
  });

  test('passes the conformance check and refuses another secret', async () => {
    const { connectorFetch } = stack();
    const sign = (key: string) => assertionFor('qlik', key);
    const report = await checkConnector({
      key: secret,
      url: 'http://qlik',
      id: 'qlik',
      assert: sign(secret),
      assertForeign: sign('another-secret-entirely'),
      fetch: connectorFetch,
    });
    expect(report.findings.filter(f => f.level === 'fail')).toEqual([]);
    expect(report.ok).toBe(true);
  });
});

/**
 * The key figures of the follow-up dialogue (docs/reviews/2026-11-12-absorbing-big-boss-board-into-clew.md): economy and
 * HME beside sick leave, made up by the fixture until their source is settled; the organisation's thresholds as settings;
 * charts as series views; and the fixture's open mode, where every unit Clew asks about has figures.
 */
describe('the key figures beside sick leave', () => {
  type EconomyRow = {
    ref: string;
    unit: string;
    month: string;
    budget: number;
    forecast: number;
    deviation: number;
    assessment?: string;
  };
  type HmeRow = {
    ref: string;
    unit: string;
    year?: string;
    total?: number;
    change?: number;
    assessment?: string;
    note?: string;
  };
  type SeriesOut = {
    series: { categories: string[]; series: Array<{ id: string; role: string; values: Array<number | null> }> };
  };

  test('economy per unit: the latest month of the year, the deviation is budget minus forecast, and a chart over the year', async () => {
    const { registry } = stack();
    const { rows } = await registry.run<{ rows: EconomyRow[] }>(hillevi, 'qlik.economyByUnit', {});
    expect(rows).toHaveLength(1);
    const [row] = rows;
    expect(row).toMatchObject({ unit: 'Bergsåkers skola', month: 'oktober 2026' });
    expect(row!.deviation).toBe(Math.round((row!.budget - row!.forecast) * 10) / 10);
    // Without the organisation's rule there is no assessment.
    expect(row!.assessment).toBeUndefined();
    const chart = await registry.run<SeriesOut>(hillevi, 'qlik.economyChart', { unit: row!.ref });
    expect(chart.series.categories).toHaveLength(10);
    expect(chart.series.series.map(s => [s.id, s.role])).toEqual([
      ['deviation', 'actual'],
      ['balance', 'target'],
    ]);
    expect(chart.series.series[0]!.values.at(-1)).toBe(row!.deviation);
  });

  test('HME per unit: the latest measurement against the one before, and a group below the minimum held back', async () => {
    const { registry } = stack();
    const [row] = (await registry.run<{ rows: HmeRow[] }>(hillevi, 'qlik.hmeByUnit', {})).rows;
    expect(row).toMatchObject({ unit: 'Bergsåkers skola', year: '2025' });
    expect(typeof row!.total).toBe('number');
    expect(typeof row!.change).toBe('number');
    const it = (await registry.run<{ rows: HmeRow[] }>(itChief, 'qlik.hmeByUnit', {})).rows;
    expect(it.find(r => r.unit === 'Servicedesk')).toEqual({
      ref: expect.any(String),
      unit: 'Servicedesk',
      year: '2025',
      note: 'Färre än 5 svarande. Visas inte.',
    });
    const chart = await registry.run<SeriesOut>(hillevi, 'qlik.hmeChart', { unit: row!.ref });
    expect(chart.series.categories).toEqual(['2019', '2021', '2023', '2025']);
    expect(chart.series.series.map(s => s.id)).toEqual(['total', 'motivation', 'leadership', 'governance']);
  });

  test("the tones are the organisation's settings: sick leave, economy and HME, each off until set", async () => {
    const plain = await stack().registry.areas(hillevi);
    expect(plain.filter(a => a.figure).map(a => [a.id, a.figure!.tone])).toEqual([
      ['sick-leave', 'none'],
      ['economy', 'none'],
      ['hme', 'none'],
    ]);
    // Bergsåkers skola's latest rate is 5,3 %: at or above the alert rate it says "Åtgärd krävs".
    const strict = stack({ warnAbove: 4, alertAbove: 5 });
    expect((await strict.registry.areas(hillevi)).find(a => a.id === 'sick-leave')?.figure?.tone).toBe('alert');
    const unit = await strict.registry.run<{ rows: Array<{ watch?: string }> }>(hillevi, 'qlik.unit', {
      keys: ['unit-skola'],
    });
    expect(unit.rows[0]!.watch).toBe('Åtgärd krävs');
    // The economy is "Mot underskott" below the operator's deviation, "Klarar budget" at or above it.
    const [e] = (await stack().registry.run<{ rows: EconomyRow[] }>(hillevi, 'qlik.economyByUnit', {})).rows;
    const under = stack({ economyAlertBelow: e!.deviation + 0.1 });
    expect(
      (await under.registry.run<{ rows: EconomyRow[] }>(hillevi, 'qlik.economyByUnit', {})).rows[0]!.assessment,
    ).toBe('Mot underskott');
    expect((await under.registry.areas(hillevi)).find(a => a.id === 'economy')?.figure?.tone).toBe('alert');
    const within = stack({ economyAlertBelow: e!.deviation });
    expect(
      (await within.registry.run<{ rows: EconomyRow[] }>(hillevi, 'qlik.economyByUnit', {})).rows[0]!.assessment,
    ).toBe('Klarar budget');
    // HME: ok from the target, warn from the lower line, alert below it.
    const [h] = (await stack().registry.run<{ rows: HmeRow[] }>(hillevi, 'qlik.hmeByUnit', {})).rows;
    const hmeWith = async (hmeOkFrom: number, hmeWarnFrom?: number) =>
      (await stack({ hmeOkFrom, hmeWarnFrom }).registry.run<{ rows: HmeRow[] }>(hillevi, 'qlik.hmeByUnit', {})).rows[0]!
        .assessment;
    expect(await hmeWith(h!.total!)).toBe('Över mål');
    expect(await hmeWith(h!.total! + 1, h!.total!)).toBe('Bevaka');
    expect(await hmeWith(h!.total! + 2, h!.total! + 1)).toBe('Åtgärd krävs');
  });

  test('the economy and HME figures (D54) say the value and open their tables', async () => {
    const areas = await stack().registry.areas(hillevi);
    expect(areas.find(a => a.id === 'economy')?.figure).toMatchObject({
      label: 'Ekonomi, avvikelse mot budget',
      value: expect.stringMatching(/^[+−]\d+,\d mnkr$/),
      comparison: 'Helårsprognos mot helårsbudget · oktober 2026',
      opens: { capability: 'qlik.economyByUnit' },
    });
    expect(areas.find(a => a.id === 'hme')?.figure).toMatchObject({
      label: 'HME',
      value: expect.stringMatching(/^\d+$/),
      comparison: expect.stringMatching(/^Mätår 2025 · [+−]\d+ sedan 2023$/),
      opens: { capability: 'qlik.hmeByUnit' },
    });
  });

  test('the unit page reads economy and HME about a unit (D97), and the sick-leave section opens its chart', async () => {
    const { registry } = stack();
    const economy = await registry.run<{ rows: Array<{ key: string; deviation: number }> }>(
      hillevi,
      'qlik.economyUnit',
      {
        keys: ['unit-skola', 'unit-omsorg'],
      },
    );
    expect(economy.rows.map(r => r.key)).toEqual(['unit-skola']);
    const hme = await registry.run<{ rows: Array<{ key: string }> }>(hillevi, 'qlik.hmeUnit', { keys: ['unit-skola'] });
    expect(hme.rows.map(r => r.key)).toEqual(['unit-skola']);
    const [sick] = (
      await registry.run<{ rows: Array<{ ref: string }> }>(hillevi, 'qlik.unit', { keys: ['unit-skola'] })
    ).rows;
    const chart = await registry.run<SeriesOut>(hillevi, 'qlik.sickLeaveChart', { unit: sick!.ref });
    expect(chart.series.categories).toHaveLength(12);
    expect(chart.series.series[0]!.values.at(-1)).toBe(5.3);
  });

  test('a source without economy or HME answers no rows and no figure, not an error', async () => {
    const inner = fixture();
    const sickLeaveOnly: Statistics = { read: () => inner.read() };
    const { registry } = stack({ statistics: sickLeaveOnly });
    expect((await registry.run<{ rows: unknown[] }>(hillevi, 'qlik.economyByUnit', {})).rows).toEqual([]);
    expect((await registry.run<{ rows: unknown[] }>(hillevi, 'qlik.hmeUnit', { keys: ['unit-skola'] })).rows).toEqual(
      [],
    );
    const areas = await registry.areas(hillevi);
    expect(areas.find(a => a.id === 'economy')?.figure).toBeNull();
    expect(areas.find(a => a.id === 'sick-leave')?.figure).toMatchObject({ value: '5,3 %' });
  });

  test('open mode: without a unit map every manager has figures for their own unit, by its own id, the same every time', async () => {
    const { registry } = stack({ unitMap: null });
    const own = (await registry.run<{ rows: UnitRow[] }>(hillevi, 'qlik.sickLeaveByUnit', {})).rows;
    expect(own.map(r => [r.ref, r.unit])).toEqual([['unit:unit-skola', 'Bergsåkers skola']]);
    // The scope is the reader's own unit, as with a map: any other id is no row.
    const keys = ['unit-skola', 'unit-hemtjanst', 'unit-ekonomi'];
    for (const read of ['qlik.unit', 'qlik.economyUnit', 'qlik.hmeUnit']) {
      const { rows } = await registry.run<{ rows: Array<{ key: string; ref: string }> }>(hillevi, read, { keys });
      expect(rows.map(r => [r.key, r.ref])).toEqual([['unit-skola', 'unit:unit-skola']]);
    }
    await expect(registry.run(hillevi, 'qlik.hmeChart', { unit: 'unit:unit-hemtjanst' })).rejects.toThrow();
    const chart = await registry.run<SeriesOut>(hillevi, 'qlik.hmeChart', { unit: 'unit:unit-skola' });
    expect(chart.series.categories).toHaveLength(4);
    // A manager of any unit in any tree has every figure, and the same ones the next time.
    const librarian = { ...hillevi, unitId: 'unit-bibliotek', unitLabel: 'Biblioteket' };
    const figures = async () =>
      (await stack({ unitMap: null }).registry.areas(librarian))
        .filter(a => a.figure)
        .map(a => [a.id, a.figure!.value]);
    const first = await figures();
    expect(first.map(([id]) => id)).toEqual(['sick-leave', 'economy', 'hme']);
    expect(await figures()).toEqual(first);
    // About one made-up unit in thirteen is too small to show, as a real one can be.
    const small = { ...hillevi, unitId: 'unit-kommunikation', unitLabel: 'Kommunikation' };
    const { rows } = await registry.run<{ rows: Array<{ total?: number; note?: string }> }>(small, 'qlik.unit', {
      keys: ['unit-kommunikation'],
    });
    expect(rows).toMatchObject([{ note: 'Färre än 5 medarbetare. Visas inte.' }]);
    expect(rows[0]!.total).toBeUndefined();
  });
});

/**
 * The units a manager follows up (D117): Clew signs the units below the reader into the actor when a call has them, and
 * the connector answers for those units and refuses every other, with a map and in open mode alike.
 */
describe('the units below the reader (D117)', () => {
  type Row = { key?: string; ref: string; unit: string };
  const ingrid: Actor = {
    id: 'ingrid',
    name: 'Ingrid Holm',
    unitId: 'unit-grundskola',
    unitLabel: 'Grundskola',
    role: 'manager',
    units: [
      { unitId: 'unit-grundskola', unitLabel: 'Grundskola' },
      { unitId: 'unit-skola', unitLabel: 'Bergsåkers skola' },
      { unitId: 'unit-skola-haga', unitLabel: 'Hagaskolan' },
    ],
  };
  test('open mode: a section and a chart for a unit below, the table with every unit, named as Clew names them', async () => {
    const { registry } = stack({ unitMap: null });
    const keys = ['unit-skola', 'unit-skola-haga', 'unit-omsorg'];
    for (const read of ['qlik.unit', 'qlik.economyUnit', 'qlik.hmeUnit']) {
      const { rows } = await registry.run<{ rows: Row[] }>(ingrid, read, { keys });
      expect(rows.map(r => [r.key, r.unit])).toEqual([
        ['unit-skola', 'Bergsåkers skola'],
        ['unit-skola-haga', 'Hagaskolan'],
      ]);
    }
    const table = await registry.run<{ rows: Row[] }>(ingrid, 'qlik.economyByUnit', {});
    expect(table.rows.map(r => r.unit)).toEqual(['Grundskola', 'Bergsåkers skola', 'Hagaskolan']);
    const chart = await registry.run<{ series: { categories: string[] } }>(ingrid, 'qlik.sickLeaveChart', {
      unit: 'unit:unit-skola',
    });
    expect(chart.series.categories).toHaveLength(12);
    await expect(registry.run(ingrid, 'qlik.sickLeaveChart', { unit: 'unit:unit-omsorg' })).rejects.toThrow();
    // Without the units the same manager has her own unit alone.
    const { units: _, ...alone } = ingrid;
    expect((await registry.run<{ rows: Row[] }>(alone, 'qlik.unit', { keys })).rows).toEqual([]);
  });
  test('with a map, a unit below is the source units the map names for it, and an unmapped one is no row', async () => {
    const { registry } = stack({
      unitMap: { 'unit-grundskola': ['IT och digitalisering'], 'unit-skola': ['Bergsåkers skola'] },
    });
    const { rows } = await registry.run<{ rows: Row[] }>(ingrid, 'qlik.unit', {
      keys: ['unit-skola', 'unit-skola-haga'],
    });
    expect(rows.map(r => [r.key, r.unit])).toEqual([['unit-skola', 'Bergsåkers skola']]);
    const table = await registry.run<{ rows: Row[] }>(ingrid, 'qlik.sickLeaveByUnit', {});
    expect(table.rows.map(r => r.unit)).toEqual(['IT och digitalisering', 'Bergsåkers skola']);
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
    const { rows } = await registry.run<{ rows: UnitRow[] }>(hillevi, 'qlik.sickLeaveByUnit', {});
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
