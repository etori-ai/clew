import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { type Actor } from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { manifestProblems, parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createConnector, manifest as incidentsManifest } from '../../connectors/incidents/connector.mjs';
import { memoryState } from '../../connectors/incidents/state.mjs';
import { assertionFor, testJwks } from '../connector-authority';

/** The incidents fixture connector over the protocol: the waiting deviation, a report filed and withdrawn, the manager's and the reporter's views. */
const secret = 'test-secret-test-secret';
const T0 = new Date('2026-11-04T08:00:00+01:00');
const hillevi: Actor = {
  id: 'hillevi',
  name: 'Hillevi Berg',
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: 'manager',
};
const hassan: Actor = {
  id: 'hassan',
  name: 'Hassan Ali',
  unitId: 'unit-omsorg',
  unitLabel: 'Hemtjänst Centrum',
  role: 'employee',
};
type Rows = { rows: Array<{ ref: string; title: string; waitingOn?: string }> };
type Result = { rows: Array<{ ref: string; outcome: string }>; undoCapability?: string };

function stack(options: Parameters<typeof createConnector>[0] = {}) {
  const service = createConnector({ jwks: testJwks, secret, state: memoryState(), clock: () => T0, ...options });
  const connectorFetch: FetchLike = (input, init) => service.handle(new Request(input, init));
  const registry = new Registry();
  registry.register(
    remoteConnector(parseManifest(incidentsManifest, 'incidents'), {
      url: 'http://incidents',
      key: secret,
      assert: assertionFor('incidents', secret),
      fetch: connectorFetch,
    }),
  );
  return { registry, connectorFetch };
}

describe('the incidents fixture connector', () => {
  test('the manifest is valid and passes the conformance check', async () => {
    expect(manifestProblems(incidentsManifest, 'incidents')).toEqual([]);
    const { connectorFetch } = stack();
    const sign = (key: string) => assertionFor('incidents', key);
    const report = await checkConnector({
      key: secret,
      url: 'http://incidents',
      id: 'incidents',
      assert: sign(secret),
      assertForeign: sign('another-secret-entirely'),
      fetch: connectorFetch,
    });
    expect(report.findings.filter(f => f.level === 'fail')).toEqual([]);
    expect(report.ok).toBe(true);
  });
  test('the deviation waiting on the safety representative is a card for the manager and a waiting row for the reporter', async () => {
    const { registry } = stack();
    const [draft] = await registry.scan(hillevi);
    expect(draft).toMatchObject({
      topic: 'incidents:dev:incidents:dev:2026-1182',
      area: 'work-environment',
      deadline: '2026-11-06',
    });
    expect(draft!.waitingOn).toMatch(/skyddsombud/);
    const [mine] = await registry.scan(hassan);
    expect(mine).toMatchObject({ topic: 'incidents:mine:incidents:dev:2026-1182', area: 'my-shift' });
    expect((await registry.run<Rows>(hassan, 'incidents.deviations', {})).rows.map(r => r.ref)).toEqual([
      'incidents:dev:2026-1182',
    ]);
    const [area] = await registry.areas(hillevi);
    // Three open, one of them reported more than two weeks ago: the figure needs the manager (D54).
    expect(area!.figure).toEqual({
      label: 'Öppna tillbud',
      value: '3',
      comparison: '1 äldre än 14 dagar',
      tone: 'alert',
      opens: { capability: 'incidents.deviations', title: 'Avvikelser och tillbud' },
    });
  });
  test('a report filed by an employee reaches the manager, runs once per operation id, and can be withdrawn by its reporter only', async () => {
    const { registry } = stack();
    const input = { title: 'Trasig dörrstängare', text: 'Dörren till förrådet går inte att stänga.' };
    const filed = await registry.run<Result>(hassan, 'incidents.report', input, { operationId: 'op-1' });
    expect(filed.rows[0]).toMatchObject({ ref: 'incidents:dev:2026-1200', outcome: 'done' });
    expect(await registry.run<Result>(hassan, 'incidents.report', input, { operationId: 'op-1' })).toEqual(filed);
    expect((await registry.scan(hillevi)).map(d => d.topic)).toContain('incidents:report:incidents:dev:2026-1200');
    expect((await registry.run<Rows>(hillevi, 'incidents.deviations', {})).rows.map(r => r.waitingOn)).toContain(
      'chefens bedömning',
    );
    expect((await registry.areas(hillevi))[0]!.figure?.value).toBe('4');
    const other: Actor = { ...hassan, id: 'erik' };
    const refused = await registry.run<Result>(other, 'incidents.withdraw', { refs: ['incidents:dev:2026-1200'] });
    expect(refused.rows[0]!.outcome).toBe('failed');
    const withdrawn = await registry.run<Result>(
      hassan,
      'incidents.withdraw',
      { refs: ['incidents:dev:2026-1200'] },
      { operationId: 'op-2' },
    );
    expect(withdrawn.rows[0]!.outcome).toBe('done');
    expect((await registry.scan(hillevi)).map(d => d.topic)).not.toContain('incidents:report:incidents:dev:2026-1200');
    expect(await registry.run(hassan, 'incidents.lookup', { operationId: 'op-2' })).toEqual({
      found: true,
      result: withdrawn,
    });
  });
  test('the fault switches: unavailable fails the read, a crash after the commit is found by the lookup', async () => {
    await expect(stack({ fault: 'unavailable' }).registry.run(hillevi, 'incidents.deviations', {})).rejects.toThrow(
      /svarar inte/,
    );
    const crashing = stack({ fault: 'crash-after-commit' });
    await expect(
      crashing.registry.run(
        hassan,
        'incidents.report',
        { title: 'Lampa trasig', text: 'Lampan i korridoren.' },
        { operationId: 'op-9' },
      ),
    ).rejects.toThrow(/svarar inte/);
    expect(await crashing.registry.run(hassan, 'incidents.lookup', { operationId: 'op-9' })).toMatchObject({
      found: true,
    });
  });
});
