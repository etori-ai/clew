import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { type Actor } from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { manifestProblems, parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createConnector, manifest as timesheetManifest } from '../../connectors/timesheet/connector.mjs';
import { memoryState } from '../../connectors/timesheet/state.mjs';
import { assertionFor, testJwks } from '../connector-authority';

/** The time-reporting fixture connector over the protocol: the day's roster, the follower's one step, the deduplicated mark and its undo. */
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
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: 'employee',
};
type Today = { date: string; rows: Array<{ person: string; absent: boolean }> };
type Result = { rows: Array<{ ref: string; outcome: string; detail: string }> };

function stack(options: Parameters<typeof createConnector>[0] = {}) {
  const service = createConnector({ jwks: testJwks, secret, state: memoryState(), clock: () => T0, ...options });
  const connectorFetch: FetchLike = (input, init) => service.handle(new Request(input, init));
  const registry = new Registry();
  registry.register(
    remoteConnector(parseManifest(timesheetManifest, 'timesheet'), {
      url: 'http://timesheet',
      key: secret,
      assert: assertionFor('timesheet', secret),
      fetch: connectorFetch,
    }),
  );
  return { registry, connectorFetch };
}

describe('the time-reporting fixture connector', () => {
  test('the manifest is valid, follows hr:absence with an execute, and passes the conformance check', async () => {
    expect(manifestProblems(timesheetManifest, 'timesheet')).toEqual([]);
    const m = parseManifest(timesheetManifest, 'timesheet');
    expect(m.capabilities.find(c => c.name === 'timesheet.followAbsence')?.follows).toEqual(['hr:absence']);
    expect(m.scan).toBe(false);
    const { connectorFetch } = stack();
    const sign = (key: string) => assertionFor('timesheet', key);
    const report = await checkConnector({
      key: secret,
      url: 'http://timesheet',
      id: 'timesheet',
      assert: sign(secret),
      assertForeign: sign('another-secret-entirely'),
      fetch: connectorFetch,
    });
    expect(report.findings.filter(f => f.level === 'fail')).toEqual([]);
    expect(report.ok).toBe(true);
  });
  test("the day's roster is the manager's, and a marked day shows as absent", async () => {
    const { registry } = stack();
    const before = await registry.run<Today>(hillevi, 'timesheet.today', {});
    expect(before.date).toBe('2026-11-04');
    expect(before.rows.map(r => [r.person, r.absent])).toEqual([
      ['hr:emp:1005', false],
      ['hr:emp:1006', false],
      ['hr:emp:1007', false],
      ['hr:emp:1012', false],
    ]);
    await expect(registry.run(hassan, 'timesheet.today', {})).rejects.toThrow(/behörighet/);
    const steps = await registry.run<{ steps: Array<{ operation: string; payload: unknown; detail?: string }> }>(
      hillevi,
      'timesheet.followAbsence',
      {
        fact: { kind: 'hr:absence', attributes: { person: 'hr:emp:1005', from: '2026-11-04' } },
      },
    );
    expect(steps.steps[0]).toMatchObject({
      operation: 'timesheet.markAbsence',
      payload: { person: 'hr:emp:1005', date: '2026-11-04' },
    });
    expect(steps.steps[0]!.detail).toMatch(/07:00–16:00 på Björken/);
    const marked = await registry.run<Result>(hillevi, 'timesheet.markAbsence', steps.steps[0]!.payload, {
      operationId: 'step-1',
    });
    expect(marked.rows[0]).toMatchObject({ ref: 'timesheet:absence:1005:2026-11-04', outcome: 'done' });
    expect(
      await registry.run<Result>(hillevi, 'timesheet.markAbsence', steps.steps[0]!.payload, { operationId: 'step-1' }),
    ).toEqual(marked);
    expect(await registry.run(hillevi, 'timesheet.lookup', { operationId: 'step-1' })).toEqual({
      found: true,
      result: marked,
    });
    expect((await registry.run<Today>(hillevi, 'timesheet.today', {})).rows[0]!.absent).toBe(true);
    await registry.run(
      hillevi,
      'timesheet.unmarkAbsence',
      { refs: ['timesheet:absence:1005:2026-11-04'] },
      { operationId: 'step-2' },
    );
    expect((await registry.run<Today>(hillevi, 'timesheet.today', {})).rows[0]!.absent).toBe(false);
  });
  test('a fact without a person or a day gives no step; a crash after the commit is found by the lookup', async () => {
    const { registry } = stack();
    expect(
      await registry.run(hillevi, 'timesheet.followAbsence', { fact: { kind: 'hr:absence', attributes: {} } }),
    ).toEqual({ steps: [] });
    const crashing = stack({ fault: 'crash-after-commit' });
    await expect(
      crashing.registry.run(
        hillevi,
        'timesheet.markAbsence',
        { person: 'hr:emp:1007', date: '2026-11-04' },
        { operationId: 'op-9' },
      ),
    ).rejects.toThrow(/svarar inte/);
    expect(await crashing.registry.run(hillevi, 'timesheet.lookup', { operationId: 'op-9' })).toMatchObject({
      found: true,
    });
  });
});
