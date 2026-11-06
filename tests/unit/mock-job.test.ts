import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { Registry, actorOf, openGovernance, type ExecuteResult } from '../../packages/connectors/src/index';
import { manifestProblems } from '../../packages/connectors/src/remote';
import { memoryState } from '../../packages/connectors/src/memory-state';
import { hrConnector, reportedAbsences } from '../../packages/connectors/src/mock/hr';
import { payrollConnector } from '../../packages/connectors/src/mock/payroll';
import { timesheetConnector } from '../../packages/connectors/src/mock/timesheet';
import { describeBundled } from '../../apps/server/src/connectors/describe';
import { executionUsecases } from '../../apps/server/src/modules/executions/usecases';
import { memoryExecutionStore } from '../../apps/server/src/modules/executions/adapters/memory';
import { ExecutionError, type ExecutionSource, type WatchSource } from '../../apps/server/src/modules/executions/model';
import { jobUsecases } from '../../apps/server/src/modules/jobs/usecases';
import { memoryFollowBindingStore } from '../../apps/server/src/modules/jobs/adapters/memory';

/**
 * The D55 scenario on the bundled mocks themselves, no fixture connectors: the HR mock declares `hr:absence` and follows it
 * with its own write, time reporting follows it with a write of its own, payroll follows it with a watch and is never
 * written. An administrator binds the three, Clew assembles, the manager approves once, the ledger runs each step as its
 * own execution or watch. This is what `scripts/job-bind.ts --mocks` and `scripts/jobs-check.ts` exercise on the real stack.
 */
const manager: AuthenticatedContext = { id: 'hillevi', name: 'Hillevi Berg', unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role: 'manager', organisationId: 'test', principal: { id: 'person:hillevi', kind: 'person' }, capabilities: [], authorizationVersion: 'v1', sessionBinding: 'test', expiresAt: '2099-01-01', authorize: async () => ({ version: 'v1' }) };
const admin: AuthenticatedContext = { ...manager, id: 'mikael', name: 'Mikael', principal: { id: 'person:mikael', kind: 'person' }, capabilities: ['admin.connectors'] };
const today = new Date().toISOString().slice(0, 10);
const fact = { kind: 'hr:absence', attributes: { person: 'hr:emp:1004', from: today, extent: 100 } };

function world() {
  const state = memoryState(), registry = new Registry();
  const connectors = [hrConnector(state), timesheetConnector(state), payrollConnector(state)];
  for (const c of connectors) registry.register(c).govern(c.id, openGovernance());
  const store = memoryExecutionStore(), bindings = memoryFollowBindingStore();
  let now = Date.parse(today + 'T08:00:00Z'), n = 0;
  const clock = () => new Date(now);
  // The same pairing as `composition/executions.ts`, over the memory store: an execute is a registry run with the approved operation id, a lookup is the capability's own read-back, a watch is a read as the person.
  const source: ExecutionSource = {
    async authorize(persona, operation, input) {
      const found = await registry.validate(actorOf(persona), operation, input);
      if (found.capability.kind !== 'execute') throw new ExecutionError('Förmågan är ingen åtgärd.');
      return { connector: found.connector.id, safety: found.capability.execution ?? { strategy: 'manual' }, needsSession: false };
    },
    current: async () => manager,
    execute: (persona, e) => registry.run<ExecuteResult>(actorOf(persona), e.operation, e.payload, { operationId: e.id }),
    async lookup(persona, e) {
      if (e.safety.strategy === 'manual') throw new Error('No safe lookup');
      const r = await registry.run<{ found: boolean; result?: ExecuteResult }>(actorOf(persona), e.safety.lookup, { operationId: e.id });
      return r.found ? r.result : undefined;
    },
  };
  const watch: WatchSource = {
    async authorize(persona, operation, input) {
      const found = await registry.validate(actorOf(persona), operation, input);
      if (found.capability.kind !== 'read') throw new ExecutionError('En bevakning måste vara en läsning.');
      return { connector: found.connector.id };
    },
    read: (persona, operation, input) => registry.run(actorOf(persona), operation, input),
  };
  const ledger = executionUsecases({ store, source, watch, clock, ids: () => 'id' + ++n, digest: input => JSON.stringify(input) });
  const jobs = jobUsecases({ bindings, followers: (a, k) => registry.followers(a, k), offered: k => registry.offered(k), ledger, clock, ids: () => 'b' + ++n });
  const call = <O,>(name: string, input?: unknown) => registry.run<O>(actorOf(manager), name, input ?? {});
  const bindAll = async (within = 'PT3M') => {
    await jobs.bind(admin, { kind: 'hr:absence', capability: 'hr.proposeAbsence', audience: { mode: 'all' } });
    await jobs.bind(admin, { kind: 'hr:absence', capability: 'timesheet.followAbsence', audience: { mode: 'all' } });
    await jobs.bind(admin, { kind: 'hr:absence', capability: 'payroll.followAbsence', audience: { mode: 'all' }, within });
  };
  return { state, registry, connectors, store, ledger, jobs, call, bindAll, clock, advance: (ms: number) => { now += ms; } };
}
const settle = async (w: ReturnType<typeof world>, jobId: string) => {
  const job = (await w.ledger.readJob(manager, jobId))!;
  for (const s of job.steps) if (s.kind === 'execute') await w.ledger.progress(s.executionId);
  return (await w.ledger.readJob(manager, jobId))!;
};

describe('the bundled mocks declare a fact, its followers and a watch (D55)', () => {
  test('the HR mock creates hr:absence, time reporting and payroll follow it, and every described manifest is on the protocol', () => {
    const w = world();
    for (const c of w.connectors) expect(manifestProblems(describeBundled(c), c.id)).toEqual([]);
    const hr = describeBundled(w.registry.connector('hr')!);
    expect(hr.facts).toEqual([{ kind: 'hr:absence', title: 'Sjukfrånvaro', attributes: {} }]);
    expect(hr.capabilities.find(c => c.name === 'hr.proposeAbsence')).toMatchObject({ kind: 'propose', follows: ['hr:absence'], creates: 'hr:absence' });
    expect(describeBundled(w.registry.connector('payroll')!).capabilities.map(c => c.kind)).not.toContain('execute');
    expect(w.registry.offered('hr:absence')).toBe(true);
    expect(w.registry.followers(actorOf(manager), 'hr:absence').map(f => [f.name, f.source, f.available])).toEqual([['hr.proposeAbsence', 'Personalsystemet', true], ['timesheet.followAbsence', 'Tidrapporteringen', true], ['payroll.followAbsence', 'Lönesystemet', true]]);
  });
  test('a sick report assembles into one proposal with a step per system, from the mocks alone, and nothing is written', async () => {
    const w = world(); await w.bindAll();
    const p = await w.jobs.assemble(actorOf(manager), fact, w.call);
    expect(p.partial).toBe(false); expect(p.sources.map(s => [s.source, s.status])).toEqual([['Personalsystemet', 'ok'], ['Tidrapporteringen', 'ok'], ['Lönesystemet', 'ok']]);
    expect(p.steps.map(s => [s.id, s.draft.kind, s.draft.operation, s.draft.title])).toEqual([
      ['hr-1', 'execute', 'hr.reportAbsence', 'Sjukanmälan registreras'],
      ['timesheet-1', 'execute', 'timesheet.markAbsence', 'Passet markeras frånvaro'],
      ['payroll-1', 'watch', 'payroll.absenceStatus', 'Bevakas i lönesystemet'],
    ]);
    expect(p.steps[2]!.draft).toMatchObject({ input: { person: 'hr:emp:1004', date: today }, expect: { path: ['status'], equals: 'registered' }, within: 'P1D' });
    expect(await reportedAbsences(w.state)).toEqual({});
    // The employee reported it themselves: the HR system has nothing to write, the other two still follow.
    const existing = await w.jobs.assemble(actorOf(manager), { ...fact, ref: 'hr:absence:1004:' + today }, w.call);
    expect(existing.steps.map(s => s.connector)).toEqual(['timesheet', 'payroll']);
  });
  test('one approval registers the report and marks the day, each written once and read back by its operation id; payroll is only read', async () => {
    const w = world(); await w.bindAll();
    const p = await w.jobs.assemble(actorOf(manager), fact, w.call);
    const approved = await w.jobs.approve(manager, { decisionId: 'job:absence:1004:' + today, proposal: p }) as Awaited<ReturnType<typeof w.ledger.approveJob>>;
    const job = await settle(w, approved.id);
    expect(job.steps.map(s => [s.id, s.state])).toEqual([['hr-1', 'succeeded'], ['timesheet-1', 'succeeded'], ['payroll-1', 'waiting']]);
    const hr = job.steps[0]!, ts = job.steps[1]!;
    expect(hr.kind === 'execute' && hr.result?.headline).toBe('Sjukanmälan är registrerad i personalsystemet.');
    expect(ts.kind === 'execute' && ts.result?.rows[0]?.detail).toBe(`${new Intl.DateTimeFormat('sv-SE', { day: 'numeric', month: 'short' }).format(new Date(today + 'T12:00:00'))}, markerad i tidrapporteringen`);
    // The write's identity is Clew's execution id: the mock keyed the record by it, so a retried write finds it instead of writing twice.
    const reported = await reportedAbsences(w.state);
    expect(Object.keys(reported)).toEqual([hr.kind === 'execute' ? hr.executionId : '']);
    expect(await w.call('hr.absenceLookup', { operationId: Object.keys(reported)[0] })).toMatchObject({ found: true });
    expect((await w.call<{ rows: unknown[] }>('timesheet.today')).rows.length).toBeGreaterThanOrEqual(0);
    // Payroll reads the HR system once a night: today's report is pending, so the first check (45 s into the 3-minute window) leaves the watch waiting.
    w.advance(50_000);
    expect(await w.ledger.observe(job.id, 'payroll-1', 0)).toBe('waiting');
    expect((await w.ledger.readJob(manager, job.id))!.steps[2]).toMatchObject({ state: 'waiting', observations: 1 });
    expect(await w.call('payroll.absenceStatus', { person: 'hr:emp:1004', date: today })).toMatchObject({ status: 'pending' });
    // The night passes in the HR system (the report is older than today): the next check sees it and the watch ends.
    for (const row of Object.values(reported)) row.at = '2000-01-01T00:00:00.000Z';
    await w.state.set('hr', 'reported-absences', reported);
    w.advance(50_000);
    expect(await w.ledger.observe(job.id, 'payroll-1', 1)).toBe('seen');
    expect((await w.call<{ rows: Array<{ ref: string }> }>('payroll.absences')).rows.map(r => r.ref)).toEqual(['hr:absence:1004:' + today]);
    expect(w.store.cards()).toEqual([]);
  });
  test('when payroll never shows the report inside the binding\'s window, the watch expires and the person gets one card naming the system', async () => {
    const w = world(); await w.bindAll('PT3M');
    const p = await w.jobs.assemble(actorOf(manager), { ...fact, attributes: { ...fact.attributes, person: 'hr:emp:1008' } }, w.call);
    const approved = await w.jobs.approve(manager, { decisionId: 'job:absence:1008:' + today, proposal: p }) as Awaited<ReturnType<typeof w.ledger.approveJob>>;
    const watch = (await settle(w, approved.id)).steps[2]!;
    expect(watch.kind === 'watch' && watch.checks.length).toBe(3);
    expect(watch.kind === 'watch' && Date.parse(watch.expiresAt) - w.clock().getTime()).toBe(3 * 60_000);
    for (let i = 0; i < 3; i++) { w.advance(45_000); expect(await w.ledger.observe(approved.id, 'payroll-1', i)).toBe('waiting'); }
    w.advance(45_000);
    expect(await w.ledger.observe(approved.id, 'payroll-1', 3)).toBe('expired');
    expect(w.store.cards().map(c => [c.connector, c.title, c.at])).toEqual([['payroll', 'Lönesystemet har inte visat det som bevakades', w.clock().toISOString()]]);
    expect(w.store.cards()[0]!.summary).toContain('Bevakas i lönesystemet: 3 kontroller fram till');
  });
  test('undo all withdraws the report and the mark through the mocks\' own undo capabilities; payroll has nothing to undo', async () => {
    const w = world(); await w.bindAll();
    const p = await w.jobs.assemble(actorOf(manager), fact, w.call);
    const approved = await w.jobs.approve(manager, { decisionId: 'job:absence:1004:' + today, proposal: p }) as Awaited<ReturnType<typeof w.ledger.approveJob>>;
    await settle(w, approved.id);
    const undo = await w.ledger.undoJob(manager, approved.id);
    expect(undo.compensations.map(c => c.stepId)).toEqual(['hr-1', 'timesheet-1']); expect(undo.skipped).toEqual([]);
    for (const c of undo.compensations) expect(await w.ledger.progress(c.compensationId)).toBe('done');
    expect(await reportedAbsences(w.state)).toEqual({});
    expect((await w.call<{ rows: Array<{ absent: boolean }> }>('timesheet.today')).rows.every(r => !r.absent)).toBe(true);
  });
});
