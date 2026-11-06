import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { type Actor } from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { manifestProblems, parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createConnector, httpFeed, manifest as payrollManifest } from '../../connectors/payroll/connector.mjs';
import { createConnector as createHr } from '../../connectors/hr/connector.mjs';
import { memoryState } from '../../connectors/hr/state.mjs';
import { assertionFor, testJwks } from '../connector-authority';

/**
 * The payroll fixture connector over the protocol, importing from the HR fixture's feed the way the services do in the
 * development stack: a report made today is pending until the night has passed, then registered; the watch step the
 * follower proposes; the feed down means payroll cannot answer.
 */
const secret = 'test-secret-test-secret';
const T0 = new Date('2026-11-04T08:00:00+01:00');
const hillevi: Actor = {
  id: 'hillevi',
  name: 'Hillevi Berg',
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: 'manager',
};
type Status = { status: 'registered' | 'pending'; checkedAt: string };

function stack(options: Parameters<typeof createConnector>[0] = {}) {
  let now = T0;
  const clock = () => now;
  const hr = createHr({ jwks: testJwks, secret, state: memoryState(), clock, feedKey: 'feed-key' });
  const hrFetch = (input: string, init?: RequestInit) => hr.handle(new Request(input, init));
  const feed = httpFeed({ url: 'http://hr/fixture/absences', key: 'feed-key', fetch: hrFetch });
  const service = createConnector({ jwks: testJwks, secret, clock, feed, ...options });
  const connectorFetch: FetchLike = (input, init) => service.handle(new Request(input, init));
  const registry = new Registry();
  registry.register(
    remoteConnector(parseManifest(hr.manifest as never, 'hr'), {
      url: 'http://hr',
      key: secret,
      assert: assertionFor('hr', secret),
      fetch: hrFetch,
    }),
  );
  registry.register(
    remoteConnector(parseManifest(payrollManifest, 'payroll'), {
      url: 'http://payroll',
      key: secret,
      assert: assertionFor('payroll', secret),
      fetch: connectorFetch,
    }),
  );
  return { registry, connectorFetch, advance: (hours: number) => (now = new Date(now.getTime() + hours * 3600000)) };
}

describe('the payroll fixture connector', () => {
  test('the manifest is valid, follows hr:absence with a watch, and passes the conformance check', async () => {
    expect(manifestProblems(payrollManifest, 'payroll')).toEqual([]);
    const m = parseManifest(payrollManifest, 'payroll');
    expect(m.capabilities.map(c => c.kind)).toEqual(['read', 'read', 'propose']);
    const { connectorFetch } = stack();
    const sign = (key: string) => assertionFor('payroll', key);
    const report = await checkConnector({
      key: secret,
      url: 'http://payroll',
      id: 'payroll',
      assert: sign(secret),
      assertForeign: sign('another-secret-entirely'),
      fetch: connectorFetch,
    });
    expect(report.findings.filter(f => f.level === 'fail')).toEqual([]);
    expect(report.ok).toBe(true);
  });
  test('a sick report registered in HR today is pending in payroll until the night has passed, then registered', async () => {
    const { registry, advance } = stack();
    const query = { person: 'hr:emp:1005', date: '2026-11-04' };
    expect((await registry.run<Status>(hillevi, 'payroll.absenceStatus', query)).status).toBe('pending');
    await registry.run(
      hillevi,
      'hr.reportAbsence',
      { person: 'hr:emp:1005', from: '2026-11-04', extent: 100 },
      { operationId: 'job-1' },
    );
    expect((await registry.run<Status>(hillevi, 'payroll.absenceStatus', query)).status).toBe('pending');
    expect(await registry.run(hillevi, 'payroll.absences', {})).toEqual({ rows: [] });
    advance(24);
    expect((await registry.run<Status>(hillevi, 'payroll.absenceStatus', query)).status).toBe('registered');
    expect(await registry.run(hillevi, 'payroll.absences', {})).toEqual({
      rows: [
        {
          ref: 'hr:absence:1005:2026-11-04',
          person: 'hr:emp:1005',
          from: '2026-11-04',
          to: '2026-11-04',
          extent: 100,
          importedAt: '2026-11-04',
        },
      ],
    });
  });
  test('the follower proposes one watch of payroll.absenceStatus within a day', async () => {
    const { registry } = stack();
    const steps = await registry.run<{ steps: Array<Record<string, unknown>> }>(hillevi, 'payroll.followAbsence', {
      fact: { kind: 'hr:absence', attributes: { person: 'hr:emp:1005', from: '2026-11-04' } },
    });
    expect(steps.steps).toEqual([
      expect.objectContaining({
        kind: 'watch',
        operation: 'payroll.absenceStatus',
        input: { person: 'hr:emp:1005', date: '2026-11-04' },
        expect: { path: ['status'], equals: 'registered' },
        within: 'P1D',
      }),
    ]);
  });

  test('source access is scoped to the verified mapped unit, including status and follower requests', async () => {
    const row = {
      ref: 'hr:absence:1005:2026-11-03',
      person: 'hr:emp:1005',
      from: '2026-11-03',
      to: '2026-11-03',
      extent: 100,
      at: '2026-11-03T08:00:00Z',
    };
    const feed = async () => [row, { ...row, person: 'another-system:employee:1' }];
    const w = stack({ feed });
    const outside = { ...hillevi, unitId: 'other-unit' };
    expect(await w.registry.run(outside, 'payroll.absences', {})).toEqual({ rows: [] });
    const query = { person: row.person, date: row.from };
    await expect(w.registry.run(outside, 'payroll.absenceStatus', query)).rejects.toThrow('behörighet');
    await expect(
      w.registry.run(outside, 'payroll.followAbsence', {
        fact: { kind: 'hr:absence', attributes: { person: row.person, from: row.from } },
      }),
    ).rejects.toThrow('behörighet');
    await expect(
      w.registry.run(hillevi, 'payroll.absenceStatus', {
        person: 'hr:emp:9999',
        date: row.from,
      }),
    ).rejects.toThrow('behörighet');
    const mapped = stack({ feed, unitMap: { 'other-unit': 'unit-skola' } });
    expect(await mapped.registry.run<Status>(outside, 'payroll.absenceStatus', query)).toMatchObject({
      status: 'registered',
    });
    expect((await mapped.registry.run<{ rows: unknown[] }>(outside, 'payroll.absences', {})).rows).toHaveLength(1);
    const response = await w.connectorFetch('http://payroll/clew/capabilities/payroll.absences', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + (await assertionFor('payroll', secret)(outside)),
        'x-clew-connector-key': secret,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ actor: hillevi, input: {} }),
    });
    expect(await response.json()).toEqual({ output: { rows: [] } });
  });

  test('when the HR feed is down payroll cannot answer and says so', async () => {
    const broken = stack({
      feed: async () => {
        throw new Error('connection refused');
      },
    });
    await expect(broken.registry.run(hillevi, 'payroll.absences', {})).rejects.toThrow(/svarar inte/);
    await expect(stack({ fault: 'unavailable' }).registry.run(hillevi, 'payroll.absences', {})).rejects.toThrow(
      /svarar inte/,
    );
  });
});
