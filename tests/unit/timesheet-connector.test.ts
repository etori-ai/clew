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
  test('the unit rule covers every unit the actor leads, not the one they are employed on alone, and never one where they are an employee (D135, D149)', async () => {
    const { registry } = stack();
    // The units are the actor's `leads`, which Clew sends every connector: this one does not take the assignments.
    expect(timesheetManifest).not.toHaveProperty('assignments');
    // Karin's own unit has no shifts here; she leads the school as well.
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
    // The roster is the school's too. The figure is one unit's, her own, where she is employed and nothing is
    // scheduled: the unit Clew says Läget of.
    expect((await registry.run<Today>(both, 'timesheet.today', {})).rows.map(r => r.person)).toEqual([
      'hr:emp:1005',
      'hr:emp:1006',
      'hr:emp:1007',
      'hr:emp:1012',
    ]);
    expect((await registry.areas(both)).find(a => a.id === 'staffing')?.figure).toEqual({
      label: 'Inga pass i dag.',
      tone: 'none',
    });
    // Leading her own unit alone, the source answers for it alone.
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
    // D149: `role` says that a person is a manager and `unitId` where they are employed, and neither says what they
    // lead. Employed at the school and leading the finance department, the school's roster, figure and writes are
    // not hers; a manager because people report to her, who leads no unit, is answered for no unit at all.
    expect((await registry.run<Today>(hillevi, 'timesheet.today', {})).rows).toHaveLength(4);
    const employedThere: Actor = {
      ...hillevi,
      assignments: [
        { unitId: 'unit-ekonomi', unitLabel: 'Ekonomiavdelningen', role: 'manager' },
        { unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role: 'employee' },
      ],
    };
    const reportedTo: Actor = {
      ...hillevi,
      assignments: [{ unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role: 'employee' }],
    };
    for (const [n, actor] of [employedThere, reportedTo].entries()) {
      expect((await registry.run<Today>(actor, 'timesheet.today', {})).rows).toEqual([]);
      // The department she leads has no shifts, which is said; with no unit to lead there is no figure. Never the school's.
      expect((await registry.areas(actor)).find(a => a.id === 'staffing')?.figure ?? null).toEqual(
        actor === employedThere ? { label: 'Inga pass i dag.', tone: 'none' } : null,
      );
      const refusedThere = await registry.run<Result>(
        actor,
        'timesheet.markAbsence',
        { person: 'hr:emp:1005', date: '2026-11-04' },
        { operationId: 'l' + n },
      );
      expect(refusedThere.rows.map(r => [r.outcome, r.detail])).toEqual([['failed', 'inte i din enhet']]);
    }
    // The figure is one unit's, the unit Clew says Läget of: the one she is employed on when she leads it, else the
    // first she leads. Leading both, it is the school's when she is employed there and the department's when not;
    // never the two added up. The roster is still every unit's she leads.
    const leadsBoth = employedThere.assignments!.map(a => ({ ...a, role: 'manager' as const })),
      figureOf = async (actor: Actor) => (await registry.areas(actor)).find(a => a.id === 'staffing')?.figure;
    expect(await figureOf({ ...hillevi, assignments: leadsBoth })).toEqual(await figureOf(hillevi));
    expect((await figureOf(hillevi))?.label).toBe('Vikarier i dag');
    const atTheDepartment: Actor = {
      ...hillevi,
      unitId: 'unit-ekonomi',
      unitLabel: 'Ekonomiavdelningen',
      assignments: leadsBoth,
    };
    expect(await figureOf(atTheDepartment)).toEqual({ label: 'Inga pass i dag.', tone: 'none' });
    expect((await registry.run<Today>(atTheDepartment, 'timesheet.today', {})).rows).toHaveLength(4);
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
