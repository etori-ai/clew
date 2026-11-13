import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { markFields, placesOf, type Actor, type ThreadDraft } from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { manifestProblems, parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createConnector, manifest as hrManifest } from '../../connectors/hr/connector.mjs';
import { memoryState } from '../../connectors/hr/state.mjs';
import { assertionFor, testJwks } from '../connector-authority';
import { ThreadDraftSchema } from '../../packages/connectors/src/protocol';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';

/**
 * The HR fixture connector run over the protocol with its memory store: the scan's cards, the deduplicated writes and
 * their read-back, undo, the fault switches a real source shows, and the id maps. What the unit suites use as the HR
 * system of their scenarios, and what `connectors/hr/server.mjs` serves from SQLite in the development stack.
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
const hassan: Actor = {
  id: 'hassan',
  name: 'Hassan Ali',
  unitId: 'unit-omsorg',
  unitLabel: 'Hemtjänst Centrum',
  role: 'employee',
};
const stranger: Actor = {
  id: 'karin',
  name: 'Karin Holm',
  unitId: 'enhet-17',
  unitLabel: 'Hemtjänst Norr',
  role: 'manager',
};
type Rows<T = Record<string, unknown>> = { rows: T[] };
type Result = {
  headline: string;
  rows: Array<{ ref: string; outcome: string; detail: string }>;
  undoCapability?: string;
};

function stack(options: Parameters<typeof createConnector>[0] = {}) {
  const state = memoryState();
  let now = T0;
  const service = createConnector({ jwks: testJwks, secret, state, clock: () => now, ...options });
  const connectorFetch: FetchLike = (input, init) => service.handle(new Request(input, init));
  const registry = new Registry();
  registry.register(
    remoteConnector(parseManifest(hrManifest, 'hr'), {
      url: 'http://hr',
      key: secret,
      assert: assertionFor('hr', secret),
      fetch: connectorFetch,
    }),
  );
  return {
    registry,
    connectorFetch,
    state,
    service,
    advance: (days: number) => (now = new Date(now.getTime() + days * 86400000)),
  };
}

describe('the HR fixture connector', () => {
  test('the manifest is a valid connector manifest with the fact, its follower and deduplicated writes', () => {
    expect(manifestProblems(hrManifest, 'hr')).toEqual([]);
    const m = parseManifest(hrManifest, 'hr');
    expect(m.facts?.map(f => f.kind)).toEqual(['hr:absence']);
    const follower = m.capabilities.find(c => c.name === 'hr.proposeAbsence')!;
    expect([follower.kind, follower.follows, follower.creates]).toEqual(['propose', ['hr:absence'], 'hr:absence']);
    for (const c of m.capabilities.filter(c => c.kind === 'execute'))
      expect(c.execution).toEqual({ strategy: 'deduplicated', retentionSeconds: 86400, lookup: 'hr.lookup' });
    // The action about a person (D97): a propose that takes the user name alone, in the person's menu, no tool, no fact.
    const prepare = m.capabilities.find(c => c.name === 'hr.prepareAbsence')!;
    expect([prepare.kind, prepare.model, prepare.about, prepare.scope.roles, prepare.creates]).toEqual([
      'propose',
      false,
      { entity: 'person', param: 'person' },
      ['manager'],
      undefined,
    ]);
    expect((prepare.input as { required: string[] }).required).toEqual(['person']);
    expect(placesOf(prepare)).toEqual(['menu']);
    expect(m.areas.map(a => [a.id, a.roles])).toEqual([
      ['employees', ['manager']],
      ['my-shift', ['employee']],
    ]);
  });
  test('passes the conformance check and refuses another secret', async () => {
    const { connectorFetch } = stack();
    const sign = (key: string) => assertionFor('hr', key);
    const report = await checkConnector({
      key: secret,
      url: 'http://hr',
      id: 'hr',
      assert: sign(secret),
      assertForeign: sign('another-secret-entirely'),
      fetch: connectorFetch,
    });
    expect(report.findings.filter(f => f.level === 'fail')).toEqual([]);
    expect(report.ok).toBe(true);
    // hr.person asked as Clew asks it (D97): the keys of the manager's people, signed as the manager.
    const about = await checkConnector({
      key: secret,
      url: 'http://hr',
      id: 'hr',
      assert: sign(secret),
      assertForeign: sign('another-secret-entirely'),
      fetch: connectorFetch,
      about: { keys: ['anna', 'erik', 'maria', 'johan', 'karin', 'hassan'], as: hillevi },
    });
    expect(about.ok).toBe(true);
    expect(
      about.findings
        .filter(f => f.text.startsWith('hr.person about person, '))
        .map(f => [f.level, f.text.split(': ')[0]!.slice('hr.person about person, '.length)]),
    ).toEqual([
      ['ok', 'batch'],
      ['ok', 'key'],
      ['ok', 'one row per key'],
      ['ok', 'unknown key'],
      ['ok', 'out of scope'],
    ]);
    expect(about.findings).toContainEqual({ level: 'ok', text: 'hr.person: employee refused by scope' });
    // The action about a person: takes the key, is no tool, and an employee is refused before anything is prepared.
    expect(about.findings.filter(f => f.text.startsWith('hr.prepareAbsence'))).toEqual([
      { level: 'ok', text: 'hr.prepareAbsence: employee refused by scope' },
      { level: 'ok', text: 'hr.prepareAbsence about person, propose, input: takes person' },
      { level: 'ok', text: 'hr.prepareAbsence about person, propose, model tool: not offered to the model' },
    ]);
  });
  test('the scan gives the manager the rehab talk and the leave requests, and the employee the delegation and the waiting leave', async () => {
    const { registry } = stack();
    const manager = await registry.scan(hillevi);
    const topics = manager.map(d => d.topic);
    expect(topics).toContain('hr:rehab:hr:emp:1001');
    expect(topics.filter(t => t.startsWith('hr:leave:'))).toHaveLength(2);
    expect(manager.every(d => d.area === 'employees')).toBe(true);
    expect(manager.find(d => d.topic === 'hr:rehab:hr:emp:1001')?.deadline).toBe('2026-11-16');
    // When a request came in is a long date with its time, in Swedish time, as the other dates on the card are long.
    expect(manager.filter(d => d.topic.startsWith('hr:leave:')).map(d => d.reason)).toEqual([
      'Ansökan kom 2 november kl. 16:40',
      'Ansökan kom 3 november kl. 06:35',
    ]);
    // A row about one employee names them by user name (D97), so the card shows on that person; the text keeps no name.
    expect(
      manager.flatMap(d => (d.items ?? []).map(i => [d.topic.split(':').slice(0, 2).join(':'), i.label, i.subject])),
    ).toEqual([
      ['hr:rehab', 'Medarbetare', { entity: 'person', key: 'anna' }],
      ['hr:leave', 'Ansökan', { entity: 'person', key: 'johan' }],
      ['hr:leave', 'Ansökan', { entity: 'person', key: 'hassan' }],
    ]);
    const employee = await registry.scan(hassan);
    expect(employee.map(d => d.area)).not.toContain('employees');
    expect(employee.find(d => d.topic === 'hr:delegation:hr:deleg:301')?.actions[0]?.capability).toBe(
      'hr.renewDelegation',
    );
    expect(employee.find(d => d.topic.startsWith('hr:leave-waiting:'))?.waitingOn).toBe('din chef');
    // A manager of a unit the HR system has no staff for gets nothing, not a denial.
    expect(await registry.scan(stranger)).toEqual([]);
    expect(await registry.run<Rows>(stranger, 'hr.leaveRequests', {})).toEqual({ rows: [] });
  });
  test('the figures and the reads follow the role: names for the manager, "En kollega" for an employee', async () => {
    const { registry } = stack();
    const [employees] = await registry.areas(hillevi);
    // The figure (D54): the period's sick leave against the target, opening absence per person, which only the manager may read.
    expect(employees!.figure).toEqual({
      label: 'Sjukfrånvaro',
      value: '4,2 %',
      comparison: 'mål ≤ 4,0 % · +0,3 sedan oktober',
      tone: 'warn',
      opens: { capability: 'hr.absenceOverview', title: 'Frånvaro per person' },
    });
    const [myShift] = await registry.areas(hassan);
    expect(myShift!.figure).toEqual({ label: '07:00–16:00 på Björken.', tone: 'none' });
    const forManager = await registry.run<{ absent: Array<{ name: string }> }>(hillevi, 'hr.whoIsOn', {});
    // Lena's long sick leave, Jonas's vab and Erik's sick report of this morning.
    expect(forManager.absent.map(a => a.name)).toEqual(['Lena Öhman', 'Jonas Kask', 'Erik Sandström']);
    const forEmployee = await registry.run<{ absent: Array<{ name: string }> }>(hassan, 'hr.whoIsOn', {});
    expect(forEmployee.absent.map(a => a.name)).toEqual(['En kollega', 'En kollega', 'En kollega']);
    await expect(registry.run(hassan, 'hr.absenceOverview', {})).rejects.toThrow(/behörighet/);
  });
  test('a write runs once per operation id, is read back by hr.lookup, refuses changed input under the same id, and is undone', async () => {
    const { registry } = stack();
    const input = { refs: ['hr:leave:7781'], decision: 'approve' };
    const first = await registry.run<Result>(hillevi, 'hr.decideLeave', input, { operationId: 'op-1' });
    expect(first.rows.map(r => r.outcome)).toEqual(['done']);
    expect(first.undoCapability).toBe('hr.undecideLeave');
    const again = await registry.run<Result>(hillevi, 'hr.decideLeave', input, { operationId: 'op-1' });
    expect(again).toEqual(first);
    await expect(
      registry.run(hillevi, 'hr.decideLeave', { ...input, decision: 'reject' }, { operationId: 'op-1' }),
    ).rejects.toThrow(/annat innehåll/);
    expect(await registry.run(hillevi, 'hr.lookup', { operationId: 'op-1' })).toEqual({ found: true, result: first });
    expect(await registry.run(hillevi, 'hr.lookup', { operationId: 'op-2' })).toEqual({ found: false });
    // Another person never reads back someone else's operation.
    expect(await registry.run(stranger, 'hr.lookup', { operationId: 'op-1' })).toEqual({ found: false });
    expect((await registry.scan(hillevi)).filter(d => d.topic.startsWith('hr:leave:'))).toHaveLength(1);
    await registry.run(hillevi, 'hr.undecideLeave', { refs: ['hr:leave:7781'] }, { operationId: 'op-3' });
    expect((await registry.scan(hillevi)).filter(d => d.topic.startsWith('hr:leave:'))).toHaveLength(2);
  });
  test('the follower proposes the sick report only when it does not exist yet, and the report is registered once', async () => {
    const { registry, service } = stack({ feedKey: 'feed-key' });
    const fact = { kind: 'hr:absence', attributes: { person: 'hr:emp:1005', from: '2026-11-04', extent: 100 } };
    const steps = await registry.run<{ steps: Array<{ operation: string; payload: unknown }> }>(
      hillevi,
      'hr.proposeAbsence',
      { fact },
    );
    expect(steps.steps.map(s => s.operation)).toEqual(['hr.reportAbsence']);
    expect(
      await registry.run(hillevi, 'hr.proposeAbsence', { fact: { ...fact, ref: 'hr:absence:1005:2026-11-04' } }),
    ).toEqual({ steps: [] });
    const result = await registry.run<Result>(hillevi, 'hr.reportAbsence', steps.steps[0]!.payload, {
      operationId: 'job-1',
    });
    expect(result.rows[0]).toMatchObject({ ref: 'hr:absence:1005:2026-11-04', outcome: 'done' });
    // The feed another system imports from, outside the protocol, behind its own key.
    const denied = await service.handle(new Request('http://hr/fixture/absences'));
    expect(denied.status).toBe(401);
    const feed = await service.handle(
      new Request('http://hr/fixture/absences', { headers: { 'x-fixture-key': 'feed-key' } }),
    );
    expect(((await feed.json()) as Rows).rows).toEqual([
      expect.objectContaining({ person: 'hr:emp:1005', from: '2026-11-04' }),
    ]);
    await registry.run(
      hillevi,
      'hr.withdrawAbsence',
      { refs: ['hr:absence:1005:2026-11-04'] },
      { operationId: 'job-2' },
    );
    const after = await service.handle(
      new Request('http://hr/fixture/absences', { headers: { 'x-fixture-key': 'feed-key' } }),
    );
    expect(((await after.json()) as Rows).rows).toEqual([]);
  });
  test('the fault switches: unavailable, unauthorized, conflict, and a crash after the commit that the lookup recovers', async () => {
    await expect(stack({ fault: 'unavailable' }).registry.run(hillevi, 'hr.leaveRequests', {})).rejects.toThrow(
      /svarar inte/,
    );
    await expect(stack({ fault: 'unauthorized' }).registry.run(hillevi, 'hr.leaveRequests', {})).rejects.toThrow();
    const conflict = await stack({ fault: 'conflict' }).registry.run<Result>(hillevi, 'hr.decideLeave', {
      refs: ['hr:leave:7781'],
      decision: 'approve',
    });
    expect(conflict.rows.map(r => r.outcome)).toEqual(['failed']);
    const crashing = stack({ fault: 'crash-after-commit' });
    await expect(
      crashing.registry.run(
        hillevi,
        'hr.decideLeave',
        { refs: ['hr:leave:7781'], decision: 'approve' },
        { operationId: 'op-9' },
      ),
    ).rejects.toThrow(/svarar inte/);
    const found = await crashing.registry.run<{ found: boolean; result: Result }>(hillevi, 'hr.lookup', {
      operationId: 'op-9',
    });
    expect(found.found).toBe(true);
    expect(found.result.rows[0]?.outcome).toBe('done');
    expect(() => createConnector({ fault: 'explode' })).toThrow(/FIXTURE_FAULT/);
  });
  test('hr.person says it is about a person (D97): presence for the manager, one row per key asked, anyone else no row', async () => {
    const declared = parseManifest(hrManifest, 'hr').capabilities.find(c => c.name === 'hr.person')!;
    expect([declared.kind, declared.model, declared.about, declared.scope.roles]).toEqual([
      'read',
      false,
      { entity: 'person' },
      ['manager'],
    ]);
    // A section and a lens; no value warns, so no mark on the row.
    expect(placesOf(declared)).toEqual(['lens', 'section']);
    expect(markFields(declared.view)).toEqual([]);
    const presence = declared.view?.kind === 'list' ? declared.view.fields[0]! : undefined;
    // "I tjänst" has no tone and is drawn plain; an absence is a neutral badge. Presence is the row in one value, the
    // column on "Alla"; where the whole row is drawn the section reads "I dag" and "Kommande" (D97, artboard C).
    expect(presence!.tones?.['I tjänst']).toBeUndefined();
    expect(declared.view?.kind === 'list' ? declared.view.fields.filter(f => f.compact).map(f => f.key) : []).toEqual([
      'presence',
    ]);
    expect(['Sjuk · dag 1', 'Sjuk · dag 14', 'Sjukskriven', 'VAB', 'Semester'].map(v => presence!.tones?.[v])).toEqual([
      'none',
      'none',
      'none',
      'none',
      'none',
    ]);
    const { registry, advance } = stack();
    expect(registry.tools(hillevi).map(t => t.name)).not.toContain('hr.person');
    type Row = { key: string; ref: string; presence: string; today: string; upcoming?: string };
    const person = (actor: Actor, keys: string[]) => registry.run<{ rows: Row[] }>(actor, 'hr.person', { keys });
    const keys = ['Erik', 'anna', 'johan', 'karin', 'lars.bergstrom', 'erik', 'nobody', 'lena', 'jonas'];
    expect((await person(hillevi, keys)).rows).toEqual([
      { key: 'Erik', ref: 'hr:emp:1002', presence: 'Sjuk · dag 1', today: 'Sjuk · dag 1' },
      { key: 'anna', ref: 'hr:emp:1001', presence: 'I tjänst', today: 'På plats' },
      {
        key: 'johan',
        ref: 'hr:emp:1004',
        presence: 'I tjänst',
        today: 'På plats',
        upcoming: 'Semester 22–23 dec, väntar på beslut',
      },
      { key: 'karin', ref: 'hr:emp:1013', presence: 'I tjänst', today: 'På plats' },
      { key: 'lars.bergstrom', ref: 'hr:emp:1014', presence: 'I tjänst', today: 'På plats' },
      {
        key: 'lena',
        ref: 'hr:emp:1006',
        presence: 'Sjukskriven',
        today: 'Sjukskriven · dag 10, till 18 dec',
      },
      { key: 'jonas', ref: 'hr:emp:1011', presence: 'VAB', today: 'VAB' },
    ]);
    // A manager of another unit gets no row, Hassan included, and an employee is refused by the scope.
    const omsorg: Actor = { ...stranger, unitId: 'unit-omsorg', unitLabel: 'Hemtjänst Centrum' };
    expect((await person(stranger, keys)).rows).toEqual([]);
    expect((await person(omsorg, ['hassan', 'anna'])).rows).toEqual([]);
    await expect(person(hassan, ['hassan'])).rejects.toThrow(/behörighet/);
    // The row opens the person's absence pattern by its ref.
    expect((await registry.run<{ name: string }>(hillevi, 'hr.absencePattern', { ref: 'hr:emp:1002' })).name).toBe(
      'Erik Sandström',
    );
    // A decided leave request is no longer "waiting"; on its first day it is the presence.
    await registry.run(hillevi, 'hr.decideLeave', { refs: ['hr:leave:7781'], decision: 'approve' });
    expect((await person(hillevi, ['johan'])).rows[0]!.upcoming).toBe('Semester 22–23 dec');
    advance(48);
    expect((await person(hillevi, ['johan'])).rows[0]).toMatchObject({
      presence: 'Semester',
      today: 'Semester, till 23 dec',
    });
    // A sick report registered through Clew's job is the presence from its first day.
    await registry.run(hillevi, 'hr.reportAbsence', { person: 'hr:emp:1003', from: '2026-12-22' });
    expect((await person(hillevi, ['maria'])).rows[0]!.presence).toBe('Sjuk · dag 1');
  });

  test('"Registrera frånvaro" prepares the sick report as a card for an employee of the manager\'s unit, writes nothing, and refuses anyone else', async () => {
    const { registry, state } = stack();
    const isDraft = addFormats(new Ajv({ strict: false })).compile(JSON.parse(JSON.stringify(ThreadDraftSchema)));
    const prepare = (actor: Actor, input: Record<string, unknown>) =>
      registry.run<ThreadDraft>(actor, 'hr.prepareAbsence', input);
    // The user name in any case, as hr.person takes it; the row names the employee and carries the key as asked.
    const draft = await prepare(hillevi, { person: 'Maria' });
    expect(isDraft(draft)).toBe(true);
    expect(registry.draftProblem('hr', draft)).toBeUndefined();
    expect(draft).toMatchObject({
      topic: 'hr:absence-draft:hr:emp:1003:2026-11-04',
      area: 'employees',
      title: 'Sjukanmälan att registrera',
      items: [
        {
          ref: 'hr:emp:1003',
          label: 'Maria Källström',
          detail: 'Sjuk 4 nov · 100 %',
          subject: { entity: 'person', key: 'Maria' },
        },
      ],
    });
    // The card's button is the existing write with its whole payload: today, one day, full time; the pattern beside it.
    expect(draft.actions.map(a => [a.id, a.capability, a.kind, a.role, a.input])).toEqual([
      [
        'report',
        'hr.reportAbsence',
        'execute',
        'primary',
        { person: 'hr:emp:1003', from: '2026-11-04', to: '2026-11-04', extent: 100 },
      ],
      ['pattern', 'hr.absencePattern', 'read', 'secondary', { ref: 'hr:emp:1003' }],
    ]);
    // Preparing wrote nothing.
    expect(state.get('reported-absences', {})).toEqual({});
    expect(
      (await registry.run<{ rows: Array<{ presence: string }> }>(hillevi, 'hr.person', { keys: ['maria'] })).rows[0]!
        .presence,
    ).toBe('I tjänst');
    // Another day when the menu's caller says so.
    expect((await prepare(hillevi, { person: 'maria', from: '2026-11-06' })).actions[0]!.input).toMatchObject({
      from: '2026-11-06',
      to: '2026-11-06',
    });
    // A manager of another unit, a person the HR system does not know, an employee, and a day the person is already away.
    const omsorg: Actor = { ...stranger, unitId: 'unit-omsorg', unitLabel: 'Hemtjänst Centrum' };
    await expect(prepare(stranger, { person: 'maria' })).rejects.toThrow('Medarbetaren finns inte i din enhet.');
    await expect(prepare(omsorg, { person: 'hassan' })).rejects.toThrow('Medarbetaren finns inte i din enhet.');
    await expect(prepare(hillevi, { person: 'nobody' })).rejects.toThrow('Medarbetaren finns inte i din enhet.');
    await expect(prepare(hassan, { person: 'hassan' })).rejects.toThrow(/behörighet/);
    await expect(prepare(hillevi, { person: 'erik' })).rejects.toThrow('Erik Sandström är redan frånvarande 4 nov.');
    // The decision runs the card's write as every write runs: once per operation id, then she is away and it is refused.
    const result = await registry.run<Result>(hillevi, 'hr.reportAbsence', draft.actions[0]!.input, {
      operationId: 'card-op-1',
    });
    expect(result).toMatchObject({
      rows: [{ ref: 'hr:absence:1003:2026-11-04', outcome: 'done' }],
      undoCapability: 'hr.withdrawAbsence',
    });
    expect(
      (await registry.run<{ rows: Array<{ presence: string }> }>(hillevi, 'hr.person', { keys: ['maria'] })).rows[0]!
        .presence,
    ).toBe('Sjuk · dag 1');
    await expect(prepare(hillevi, { person: 'maria' })).rejects.toThrow('redan frånvarande');
  });

  test('the id maps translate a unit and a person, and a reseed moves the records to today', async () => {
    const mapped = stack({ unitMap: { 'enhet-17': 'unit-skola' }, personMap: { karin: 'hassan' } });
    const rows = await mapped.registry.run<Rows>(stranger, 'hr.leaveRequests', {});
    expect(rows.rows).toHaveLength(2);
    const asHassan = await mapped.registry.run<{ today: { ward: string } | null }>(
      { ...stranger, role: 'employee' },
      'hr.myShift',
      {},
    );
    expect(asHassan.today?.ward).toBe('Björken');
    // The records are seeded relative to the day the store is created and stay put; `fresh` seeds them again from today.
    const { state, advance } = stack();
    advance(40);
    const stale = createConnector({
      jwks: testJwks,
      secret,
      state,
      clock: () => new Date(T0.getTime() + 40 * 86400000),
    });
    expect((stale.manifest as { id: string }).id).toBe('hr');
    expect(state.get<{ seededOn: string }>('records').seededOn).toBe('2026-11-04');
    createConnector({
      jwks: testJwks,
      secret,
      state,
      clock: () => new Date(T0.getTime() + 40 * 86400000),
      fresh: true,
    });
    expect(state.get<{ seededOn: string }>('records').seededOn).toBe('2026-12-14');
  });
});
