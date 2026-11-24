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
const karin: Actor = {
  id: 'karin',
  name: 'Karin Holm',
  unitId: 'enhet-17',
  unitLabel: 'Hemtjänst Norr',
  role: 'manager',
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
  test("a mark and its undo answer for the manager's own unit, and another unit's shift is never told (CS-M2)", async () => {
    const { registry } = stack();
    const payload = { person: 'hr:emp:1005', date: '2026-11-04' };
    const marked = await registry.run<Result>(hillevi, 'timesheet.markAbsence', payload, { operationId: 'h1' });
    const ref = marked.rows[0]!.ref;
    // Karin manages a unit with no shifts here.
    const proposed = await registry.run<{ steps: Array<{ detail?: string }> }>(karin, 'timesheet.followAbsence', {
      fact: { kind: 'hr:absence', attributes: { person: 'hr:emp:1006', from: '2026-11-04' } },
    });
    expect(proposed.steps[0]!.detail).toBe('4 nov., ingen schemarad den dagen');
    const foreign = await registry.run<Result & { headline: string }>(
      karin,
      'timesheet.markAbsence',
      { person: 'hr:emp:1006', date: '2026-11-04' },
      { operationId: 'k1' },
    );
    expect([foreign.headline, foreign.rows.map(r => [r.outcome, r.detail])]).toEqual([
      'Passet kunde inte markeras som frånvaro.',
      [['failed', 'inte i din enhet']],
    ]);
    const undo = await registry.run<Result & { headline: string }>(
      karin,
      'timesheet.unmarkAbsence',
      { refs: [ref] },
      { operationId: 'k2' },
    );
    expect([undo.headline, undo.rows.map(r => [r.outcome, r.detail])]).toEqual([
      'Markeringen kunde inte tas bort.',
      [['failed', 'finns inte i tidrapporteringen']],
    ]);
    const roster = (await registry.run<Today>(hillevi, 'timesheet.today', {})).rows;
    expect(roster.map(r => [r.person, r.absent])).toEqual([
      ['hr:emp:1005', true],
      ['hr:emp:1006', false],
      ['hr:emp:1007', false],
      ['hr:emp:1012', false],
    ]);
    await registry.run(hillevi, 'timesheet.unmarkAbsence', { refs: [ref] }, { operationId: 'h2' });
    expect((await registry.run<Today>(hillevi, 'timesheet.today', {})).rows[0]!.absent).toBe(false);
  });
  test('the unit rule covers every unit the actor manages, not the primary one alone, and never one where they are an employee (D135)', async () => {
    const { registry } = stack();
    // Karin's primary unit has no shifts here; she manages the school as well.
    const both: Actor = {
      ...karin,
      assignments: [
        { unitId: karin.unitId, unitLabel: karin.unitLabel, role: 'manager' },
        { unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role: 'manager' },
      ],
    };
    const fact = { kind: 'hr:absence', attributes: { person: 'hr:emp:1006', from: '2026-11-04' } };
    const proposed = await registry.run<{ steps: Array<{ detail?: string }> }>(both, 'timesheet.followAbsence', {
      fact,
    });
    expect(proposed.steps[0]!.detail).toBe('4 nov., 07:00–16:00 på Björken');
    const marked = await registry.run<Result & { headline: string }>(
      both,
      'timesheet.markAbsence',
      { person: 'hr:emp:1006', date: '2026-11-04' },
      { operationId: 'b1' },
    );
    expect(marked.rows.map(r => r.outcome)).toEqual(['done']);
    const undone = await registry.run<Result>(
      both,
      'timesheet.unmarkAbsence',
      { refs: [marked.rows[0]!.ref] },
      { operationId: 'b2' },
    );
    expect(undone.rows.map(r => r.outcome)).toEqual(['done']);
    // The roster and the figure are the school's too.
    expect((await registry.run<Today>(both, 'timesheet.today', {})).rows.map(r => r.person)).toEqual([
      'hr:emp:1005',
      'hr:emp:1006',
      'hr:emp:1007',
      'hr:emp:1012',
    ]);
    // Told only her primary unit, the source answers for it alone, as before.
    const primary: Actor = { ...both };
    delete primary.assignments;
    const refused = await registry.run<Result>(
      primary,
      'timesheet.markAbsence',
      { person: 'hr:emp:1006', date: '2026-11-04' },
      { operationId: 'b3' },
    );
    expect(refused.rows.map(r => [r.outcome, r.detail])).toEqual([['failed', 'inte i din enhet']]);
    // A manager of the finance department who is an employee at the school: the school is not hers.
    const employeeThere: Actor = {
      ...hillevi,
      unitId: 'unit-ekonomi',
      unitLabel: 'Ekonomiavdelningen',
      assignments: [
        { unitId: 'unit-ekonomi', unitLabel: 'Ekonomiavdelningen', role: 'manager' },
        { unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role: 'employee' },
      ],
    };
    const notHers = await registry.run<Result>(
      employeeThere,
      'timesheet.markAbsence',
      { person: 'hr:emp:1005', date: '2026-11-04' },
      { operationId: 'e1' },
    );
    expect(notHers.rows.map(r => [r.outcome, r.detail])).toEqual([['failed', 'inte i din enhet']]);
    const noShift = await registry.run<{ steps: Array<{ detail?: string }> }>(
      employeeThere,
      'timesheet.followAbsence',
      {
        fact,
      },
    );
    expect(noShift.steps[0]!.detail).toBe('4 nov., ingen schemarad den dagen');
    expect((await registry.run<Today>(employeeThere, 'timesheet.today', {})).rows).toEqual([]);
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
