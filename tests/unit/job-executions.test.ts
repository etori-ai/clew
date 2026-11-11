import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import {
  Registry,
  openGovernance,
  type Capability,
  type Connector,
  type ExecuteResult,
} from '../../packages/connectors/src/index';
import { FactEnvelopeSchema, FollowResponseSchema, type FactEnvelope } from '../../packages/connectors/src/protocol';
import { executionUsecases } from '../../apps/server/src/modules/executions/usecases';
import { memoryExecutionStore } from '../../apps/server/src/modules/executions/adapters/memory';
import type { ExecutionSource, WatchSource } from '../../apps/server/src/modules/executions/model';
import { jobUsecases } from '../../apps/server/src/modules/jobs/usecases';
import { memoryFollowBindingStore } from '../../apps/server/src/modules/jobs/adapters/memory';
import { durationMs, watchSchedule } from '../../apps/server/src/modules/jobs/domain';
import type { JobProposal } from '../../apps/server/src/modules/jobs/contracts';

/**
 * The stress-test scenario (D55, canvas J): an employee is sick today. The HR system writes the sick report, time reporting
 * marks the shift, payroll reads the HR system itself and is only watched. Nothing here is flow code: the three systems are
 * connectors that declare facts and follows, an administrator binds them, Clew assembles, the manager approves once.
 */
const any = { type: 'object', additionalProperties: true } as unknown as Capability['input'];
const manager: AuthenticatedContext = {
  id: 'hillevi',
  name: 'Hillevi',
  unitId: 'unit-skola',
  unitLabel: 'Skolan',
  role: 'manager',
  organisationId: 'test',
  principal: { id: 'person:hillevi', kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01',
  authorize: async () => ({ version: 'v1' }),
};
const admin: AuthenticatedContext = {
  ...manager,
  id: 'mikael',
  name: 'Mikael',
  principal: { id: 'person:mikael', kind: 'person' },
  capabilities: ['admin.connectors'],
};
const fact = { kind: 'hr:absence', attributes: { person: 'hr:emp:1004', from: '2026-11-05', extent: 100 } };
const follower = (
  name: string,
  follows: string[],
  steps: (fact: FactEnvelope['fact']) => unknown[],
  extra: Record<string, unknown> = {},
) => ({
  name,
  kind: 'propose' as const,
  title: 'Följ',
  description: 'Följer en händelse.',
  input: FactEnvelopeSchema,
  output: FollowResponseSchema,
  model: false,
  scope: {},
  follows,
  ...extra,
  run: async (_: unknown, input: FactEnvelope) => ({ steps: steps(input.fact) }),
});
const execute = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  kind: 'execute' as const,
  title: 'Gör',
  description: '',
  input: any,
  output: any,
  model: false,
  scope: {},
  run: async () => ({}),
  ...extra,
});
const read = (name: string) => ({
  name,
  kind: 'read' as const,
  title: 'Läs',
  description: '',
  input: any,
  output: any,
  model: false,
  scope: {},
  run: async () => ({}),
});
function hrConnector(kind = 'hr:absence'): Connector {
  return {
    id: 'hr',
    kind: 'passthrough',
    source: 'Personalsystemet',
    areas: [],
    facts: [{ kind, title: 'Sjukfrånvaro', attributes: { type: 'object' } }],
    capabilities: [
      // When the fact already exists in the HR system (the employee reported it) there is nothing for HR to write; otherwise the job creates it.
      follower(
        'hr.proposeAbsence',
        [kind],
        f =>
          f.ref
            ? []
            : [
                {
                  kind: 'execute',
                  operation: 'hr.reportAbsence',
                  payload: { person: f.attributes.person, from: f.attributes.from, extent: f.attributes.extent },
                  title: 'Sjukanmälan registreras',
                },
              ],
        { creates: kind },
      ),
      execute('hr.reportAbsence', {
        execution: { strategy: 'deduplicated', retentionSeconds: 86400, lookup: 'hr.lookup' },
      }),
      execute('hr.undo'),
      read('hr.lookup'),
    ],
  };
}
const timesheetConnector: Connector = {
  id: 'timesheet',
  kind: 'passthrough',
  source: 'Tidrapporteringen',
  areas: [],
  capabilities: [
    follower('timesheet.followAbsence', ['hr:absence'], f => [
      {
        kind: 'execute',
        operation: 'timesheet.markAbsence',
        payload: { person: f.attributes.person, date: f.attributes.from },
        title: 'Passet markeras frånvaro',
      },
    ]),
    execute('timesheet.markAbsence', {
      execution: { strategy: 'deduplicated', retentionSeconds: 86400, lookup: 'timesheet.lookup' },
    }),
    execute('timesheet.undo'),
    read('timesheet.lookup'),
  ],
};
const payrollConnector: Connector = {
  id: 'payroll',
  kind: 'passthrough',
  source: 'Lönesystemet',
  areas: [],
  capabilities: [
    follower('payroll.followAbsence', ['hr:absence'], f => [
      {
        kind: 'watch',
        operation: 'payroll.absenceStatus',
        input: { person: f.attributes.person, date: f.attributes.from },
        expect: { path: ['status'], equals: 'registered' },
        within: 'P1D',
        title: 'Bevakas i lönesystemet',
      },
    ]),
    read('payroll.absenceStatus'),
  ],
};
const pollsConnector: Connector = {
  id: 'polls',
  kind: 'passthrough',
  source: 'Enkätsystemet',
  areas: [],
  capabilities: [read('polls.surveys')],
};

function system() {
  const committed = new Map<string, ExecuteResult>();
  let writes = 0,
    loseReply = false,
    down = false;
  return {
    writes: () => writes,
    loseReply: () => {
      loseReply = true;
    },
    outage: (v: boolean) => {
      down = v;
    },
    async execute(id: string, connector: string, compensates: string | null) {
      if (down) throw new Error('down');
      if (!committed.has(id)) {
        writes++;
        committed.set(id, {
          headline: 'Klart',
          rows: [{ ref: connector + ':row:1', label: 'Rad', outcome: 'done', detail: 'Läst tillbaka' }],
          ...(compensates ? {} : { undoCapability: connector + '.undo', undoMinutes: 10 }),
        });
      }
      if (loseReply) throw new Error('reply lost');
      return committed.get(id)!;
    },
    async lookup(id: string) {
      if (down) throw new Error('down');
      return committed.get(id);
    },
  };
}
function world(
  options: { budget?: { perSourceMs: number; totalMs: number }; watch?: boolean; connectors?: Connector[] } = {},
) {
  const registry = new Registry();
  for (const c of options.connectors ?? [hrConnector(), timesheetConnector, payrollConnector, pollsConnector])
    registry.register(c).govern(c.id, openGovernance());
  const store = memoryExecutionStore(),
    bindingStore = memoryFollowBindingStore();
  const systems = { hr: system(), timesheet: system() };
  let now = Date.parse('2026-11-05T08:02:00Z'),
    id = 0,
    revoked = false,
    payrollStatus = 'pending',
    payrollReads = 0,
    payrollDown = false,
    payrollExecutes = 0;
  const clock = () => new Date(now);
  const source: ExecutionSource = {
    async authorize(_, operation) {
      const c = operation.split('.')[0]!;
      if (!(c in systems)) throw new Error('Förmågan är ingen åtgärd.');
      return {
        connector: c,
        safety: { strategy: 'deduplicated', retentionSeconds: 86400, lookup: c + '.lookup' },
        needsSession: false,
      };
    },
    current: async () => (revoked ? undefined : manager),
    execute: (_, e) => {
      if (e.connector === 'payroll') {
        payrollExecutes++;
        throw new Error('never');
      }
      return systems[e.connector as keyof typeof systems].execute(e.id, e.connector, e.compensates);
    },
    lookup: (_, e) => systems[e.connector as keyof typeof systems].lookup(e.id),
  };
  const watch: WatchSource = {
    async authorize(_, operation) {
      if (operation !== 'payroll.absenceStatus') throw new Error('not a read');
      return { connector: 'payroll' };
    },
    async read() {
      payrollReads++;
      if (payrollDown) throw new Error('down');
      return { status: payrollStatus };
    },
  };
  const ledger = executionUsecases({
    store,
    source,
    ...(options.watch === false ? {} : { watch }),
    clock,
    ids: () => 'id' + ++id,
    digest: input => JSON.stringify(input),
  });
  const jobs = jobUsecases({
    bindings: bindingStore,
    followers: (a, k) => registry.followers(a, k),
    offered: k => registry.offered(k),
    refresh: () => registry.refreshGovernance(),
    digest: JSON.stringify,
    ledger,
    clock,
    ids: () => 'b' + ++id,
    ...(options.budget ? { budget: options.budget } : {}),
  });
  const call = registry.clewFor(manager).call;
  const bindAll = async () => {
    for (const capability of ['hr.proposeAbsence', 'timesheet.followAbsence', 'payroll.followAbsence'])
      await jobs.bind(admin, { kind: 'hr:absence', capability, audience: { mode: 'all' } });
  };
  const approve = (proposal: JobProposal, decisionId = 'job:absence:1004:2026-11-05') =>
    jobs.approve(manager, { decisionId, proposal }) as ReturnType<typeof ledger.approveJob>;
  return {
    registry,
    store,
    bindingStore,
    systems,
    source,
    watch,
    ledger,
    jobs,
    call,
    bindAll,
    approve,
    clock,
    advance: (ms: number) => {
      now += ms;
    },
    revoke: () => {
      revoked = true;
    },
    payroll: {
      set: (s: string) => {
        payrollStatus = s;
      },
      reads: () => payrollReads,
      outage: (v: boolean) => {
        payrollDown = v;
      },
      executes: () => payrollExecutes,
    },
  };
}
const H = 3600_000;

describe('a job across systems is assembled from what connectors follow', () => {
  test('the registry refuses a follow on a read, a creates without the fact, and a fact outside the connector', () => {
    expect(() =>
      new Registry().register({
        ...pollsConnector,
        capabilities: [{ ...read('polls.surveys'), follows: ['hr:absence'] }],
      }),
    ).toThrow('only a propose');
    expect(() =>
      new Registry().register({
        ...pollsConnector,
        capabilities: [{ ...execute('polls.send'), creates: 'polls:answer' }],
      }),
    ).toThrow('does not declare');
    expect(() =>
      new Registry().register({ ...pollsConnector, facts: [{ kind: 'hr:answer', title: 'Svar', attributes: {} }] }),
    ).toThrow('prefixed with polls:');
  });
  test('three bound followers give one proposal with a step per system; a system that follows nothing is not asked', async () => {
    const w = world();
    await w.bindAll();
    const p = await w.jobs.assemble(manager, fact, w.call);
    expect(p.steps.map(s => [s.connector, s.draft.kind, s.draft.operation])).toEqual([
      ['hr', 'execute', 'hr.reportAbsence'],
      ['timesheet', 'execute', 'timesheet.markAbsence'],
      ['payroll', 'watch', 'payroll.absenceStatus'],
    ]);
    expect(p.sources.map(s => s.status)).toEqual(['ok', 'ok', 'ok']);
    expect(p.partial).toBe(false);
    expect(p.sources.some(s => s.connector === 'polls')).toBe(false);
    expect(w.systems.hr.writes() + w.systems.timesheet.writes()).toBe(0);
  });
  test('a fact that already exists in its source gives no step for that system: the employee reported it themselves', async () => {
    const w = world();
    await w.bindAll();
    const p = await w.jobs.assemble(manager, { ...fact, ref: 'hr:absence:88213' }, w.call);
    expect(p.steps.map(s => s.connector)).toEqual(['timesheet', 'payroll']);
    expect(p.sources.find(s => s.connector === 'hr')?.status).toBe('ok');
  });
  test('an unbound offer runs nothing; a switched-off or out-of-audience binding is named as disabled, never silently missing', async () => {
    const w = world();
    await w.jobs.bind(admin, { kind: 'hr:absence', capability: 'hr.proposeAbsence', audience: { mode: 'all' } });
    const ts = await w.jobs.bind(admin, {
      kind: 'hr:absence',
      capability: 'timesheet.followAbsence',
      audience: { mode: 'all' },
      enabled: false,
    });
    await w.jobs.bind(admin, {
      kind: 'hr:absence',
      capability: 'payroll.followAbsence',
      audience: { mode: 'selected', units: ['unit-omsorg'] },
    });
    const p = await w.jobs.assemble(manager, fact, w.call);
    expect(p.steps.map(s => s.connector)).toEqual(['hr']);
    expect(p.sources.filter(s => s.status === 'disabled').map(s => [s.connector, s.reason])).toEqual([
      ['timesheet', 'switched-off'],
      ['payroll', 'audience'],
    ]);
    expect(p.partial).toBe(false);
    await w.jobs.bind(admin, {
      id: ts.id,
      kind: ts.kind,
      capability: ts.capability,
      audience: ts.audience,
      enabled: true,
    });
    expect((await w.jobs.assemble(manager, fact, w.call)).steps.map(s => s.connector)).toEqual(['hr', 'timesheet']);
  });
  test('when the HR system renames the fact kind, every binding on the old kind is degraded and the proposal says so', async () => {
    const w = world();
    await w.bindAll();
    w.registry.replace(hrConnector('hr:absence2')).govern('hr', openGovernance());
    const p = await w.jobs.assemble(manager, fact, w.call);
    expect(p.steps).toEqual([]);
    expect(p.partial).toBe(true);
    expect(p.sources.map(s => [s.connector, s.status, s.reason])).toEqual([
      ['hr', 'degraded', 'kind-not-offered'],
      ['timesheet', 'degraded', 'kind-not-offered'],
      ['payroll', 'degraded', 'kind-not-offered'],
    ]);
  });
  test('a follower that stopped following, or that the person may no longer call, is degraded with the reason', async () => {
    const w = world();
    await w.bindAll();
    w.registry
      .replace({
        ...timesheetConnector,
        capabilities: timesheetConnector.capabilities.filter(c => c.name !== 'timesheet.followAbsence'),
      })
      .govern('timesheet', openGovernance());
    w.registry.govern('payroll', { ...openGovernance(), state: 'disabled' });
    const p = await w.jobs.assemble(manager, fact, w.call);
    expect(p.steps.map(s => s.connector)).toEqual(['hr']);
    expect(p.partial).toBe(true);
    expect(p.sources.filter(s => s.status === 'degraded').map(s => [s.connector, s.reason])).toEqual([
      ['timesheet', 'not-a-follower'],
      ['payroll', 'capability-unavailable'],
    ]);
  });
  test('a follower that names another system, or answers off contract, is unavailable and its steps are dropped', async () => {
    const rogue: Connector = {
      id: 'polls',
      kind: 'passthrough',
      source: 'Enkätsystemet',
      areas: [],
      capabilities: [
        follower('polls.followAbsence', ['hr:absence'], () => [
          { kind: 'execute', operation: 'hr.reportAbsence', payload: {}, title: 'Smyg' },
        ]),
      ],
    };
    const broken: Connector = {
      id: 'timesheet',
      kind: 'passthrough',
      source: 'Tidrapporteringen',
      areas: [],
      capabilities: [
        { ...follower('timesheet.followAbsence', ['hr:absence'], () => []), run: async () => ({ rows: [] }) } as never,
      ],
    };
    const w = world({ connectors: [hrConnector(), broken, payrollConnector, rogue] });
    await w.bindAll();
    await w.jobs.bind(admin, { kind: 'hr:absence', capability: 'polls.followAbsence', audience: { mode: 'all' } });
    const p = await w.jobs.assemble(manager, fact, w.call);
    expect(p.steps.map(s => s.connector)).toEqual(['hr', 'payroll']);
    expect(p.partial).toBe(true);
    expect(p.sources.find(s => s.connector === 'polls')).toMatchObject({
      status: 'unavailable',
      reason: expect.stringContaining('not a capability of polls'),
    });
    expect(p.sources.find(s => s.connector === 'timesheet')?.status).toBe('unavailable');
  });
  test('a follower that does not answer within the budget is a timeout; the others still count', async () => {
    const slow: Connector = {
      ...payrollConnector,
      capabilities: [
        { ...follower('payroll.followAbsence', ['hr:absence'], () => []), run: () => new Promise(() => {}) } as never,
        read('payroll.absenceStatus'),
      ],
    };
    const w = world({
      connectors: [hrConnector(), timesheetConnector, slow, pollsConnector],
      budget: { perSourceMs: 30, totalMs: 60 },
    });
    await w.bindAll();
    const p = await w.jobs.assemble(manager, fact, w.call);
    expect(p.steps.map(s => s.connector)).toEqual(['hr', 'timesheet']);
    expect(p.sources.find(s => s.connector === 'payroll')?.status).toBe('timeout');
    expect(p.partial).toBe(true);
  });
  test("binding is an administrator's decision with its audit row in one transaction", async () => {
    const w = world();
    await expect(
      w.jobs.bind(manager, { kind: 'hr:absence', capability: 'timesheet.followAbsence', audience: { mode: 'all' } }),
    ).rejects.toThrow('behörighet');
    expect(await w.bindingStore.list()).toEqual([]);
    const original = w.bindingStore.transaction;
    w.bindingStore.transaction = fn =>
      original(async tx => {
        await fn(tx);
        throw new Error('crash');
      });
    await expect(
      w.jobs.bind(admin, { kind: 'hr:absence', capability: 'timesheet.followAbsence', audience: { mode: 'all' } }),
    ).rejects.toThrow('crash');
    expect(await w.bindingStore.list()).toEqual([]);
    expect(w.bindingStore.audit()).toEqual([]);
    w.bindingStore.transaction = original;
    const b = await w.jobs.bind(admin, {
      kind: 'hr:absence',
      capability: 'timesheet.followAbsence',
      audience: { mode: 'all' },
      within: 'PT4H',
    });
    expect(w.bindingStore.audit().map(a => a.action)).toEqual(['job.binding_added']);
    await w.jobs.unbind(admin, b.id);
    expect(await w.bindingStore.list()).toEqual([]);
    expect(w.bindingStore.audit().map(a => a.action)).toEqual(['job.binding_added', 'job.binding_removed']);
  });
  test("a watch window becomes three committed checks inside it and an end; the binding's window caps the follower's", () => {
    expect(durationMs('P1D')).toBe(24 * H);
    expect(durationMs('PT4H')).toBe(4 * H);
    expect(durationMs('P1DT30M')).toBe(24 * H + 30 * 60_000);
    expect(durationMs('P')).toBeUndefined();
    expect(durationMs('1 day')).toBeUndefined();
    const s = watchSchedule(Date.parse('2026-11-05T08:02:00Z'), 24 * H);
    expect(s.checks).toEqual(['2026-11-05T14:02:00.000Z', '2026-11-05T20:02:00.000Z', '2026-11-06T02:02:00.000Z']);
    expect(s.expiresAt).toBe('2026-11-06T08:02:00.000Z');
  });
});

describe('one approval runs each step as its own execution or watch', () => {
  async function approved(w: ReturnType<typeof world>) {
    await w.bindAll();
    const p = await w.jobs.assemble(manager, fact, w.call);
    return { p, job: await w.approve(p) };
  }
  const stepOf = (job: Awaited<ReturnType<typeof approved>>['job'], connector: string) =>
    job.steps.find(s => s.connector === connector)!;
  test('concurrent identical approvals save one job, one execution per system, their audit and workflow starts, and write nothing', async () => {
    const w = world();
    await w.bindAll();
    const p = await w.jobs.assemble(manager, fact, w.call);
    const [a, b] = await Promise.all([w.approve(p), w.approve(p)]);
    expect(a.id).toBe(b.id);
    expect(w.store.jobs()).toHaveLength(1);
    expect(w.store.dump()).toHaveLength(2);
    expect(w.store.enqueued().filter(s => s.workflow === 'approvedExecution')).toHaveLength(2);
    expect(w.store.audit().map(e => e.action)).toEqual(['execution.approved', 'execution.approved', 'job.approved']);
    expect(w.store.dump().map(e => [e.connector, e.decisionId])).toEqual([
      ['hr', 'job:absence:1004:2026-11-05:b1-1'],
      ['timesheet', 'job:absence:1004:2026-11-05:b2-1'],
    ]);
    expect(a.steps.map(s => [s.connector, s.kind, s.state])).toEqual([
      ['hr', 'execute', 'pending'],
      ['timesheet', 'execute', 'pending'],
      ['payroll', 'watch', 'waiting'],
    ]);
    expect(stepOf(a, 'payroll')).toMatchObject({
      checks: ['2026-11-05T14:02:00.000Z', '2026-11-05T20:02:00.000Z', '2026-11-06T02:02:00.000Z'],
      expiresAt: '2026-11-06T08:02:00.000Z',
    });
    expect(w.systems.hr.writes() + w.systems.timesheet.writes()).toBe(0);
  });
  test('the same decision with a changed step is refused and nothing more is saved', async () => {
    const w = world();
    const { p } = await approved(w);
    const changed = {
      ...p,
      steps: p.steps.map(s =>
        s.connector === 'timesheet' && s.draft.kind === 'execute'
          ? { ...s, draft: { ...s.draft, payload: { person: 'hr:emp:1004', date: '2026-11-06' } } }
          : s,
      ),
    };
    await expect(w.approve(changed)).rejects.toThrow('annat innehåll');
    expect(w.store.jobs()).toHaveLength(1);
    expect(w.store.dump()).toHaveLength(2);
    expect(w.store.audit()).toHaveLength(3);
  });
  test('an unbound step is refused before any job intent is committed', async () => {
    const w = world();
    await w.bindAll();
    const p = await w.jobs.assemble(manager, fact, w.call);
    const rogue = {
      ...p,
      steps: [
        ...p.steps,
        {
          id: 'finance-1',
          binding: 'missing',
          connector: 'finance',
          source: 'Ekonomisystemet',
          draft: { kind: 'execute' as const, operation: 'finance.pay', payload: {}, title: 'Betala' },
        },
      ],
    };
    await expect(w.approve(rogue)).rejects.toThrow('Förslaget har ändrats');
    expect(w.store.jobs()).toEqual([]);
    expect(w.store.dump()).toEqual([]);
    expect(w.store.audit()).toEqual([]);
  });
  test('each execute step dispatches to its own system once; a lost reply on one leaves the other untouched and is read back, never rewritten', async () => {
    const w = world();
    const { job } = await approved(w);
    const hr = stepOf(job, 'hr'),
      ts = stepOf(job, 'timesheet');
    w.systems.timesheet.loseReply();
    expect(await w.ledger.progress(hr.executionId!)).toBe('done');
    expect(await w.ledger.progress(ts.executionId!)).toBe('reconcile');
    expect((await w.store.read(hr.executionId!))?.state).toBe('succeeded');
    expect((await w.store.read(ts.executionId!))?.state).toBe('unknown');
    await w.ledger.progress(ts.executionId!);
    expect((await w.store.read(ts.executionId!))?.state).toBe('succeeded');
    expect(w.systems.hr.writes()).toBe(1);
    expect(w.systems.timesheet.writes()).toBe(1);
    const view = await w.ledger.readJob(manager, job.id);
    expect(view?.steps.map(s => s.state)).toEqual(['succeeded', 'succeeded', 'waiting']);
  });
  test('revoked authority blocks every step before dispatch and nothing reaches any system', async () => {
    const w = world();
    const { job } = await approved(w);
    w.revoke();
    for (const s of job.steps) if (s.kind === 'execute') await w.ledger.progress(s.executionId!);
    expect(w.store.dump().map(e => [e.state, e.reason, e.dispatchedAt])).toEqual([
      ['pending', 'authority-revoked', null],
      ['pending', 'authority-revoked', null],
    ]);
    expect(w.systems.hr.writes() + w.systems.timesheet.writes()).toBe(0);
    expect(await w.ledger.observe(job.id, 'b3-1', 0)).toBe('waiting');
    w.advance(6 * H);
    expect(await w.ledger.observe(job.id, 'b3-1', 0)).toBe('blocked');
    expect(w.payroll.reads()).toBe(0);
  });
  test('a watch reads at its committed times only, settles when the fact is seen, and never executes', async () => {
    const w = world();
    const { job } = await approved(w);
    expect(await w.ledger.observe(job.id, 'b3-1', 1)).toBe('waiting');
    expect(w.payroll.reads()).toBe(0);
    w.advance(6 * H);
    expect(await w.ledger.observe(job.id, 'b3-1', 0)).toBe('waiting');
    expect(w.payroll.reads()).toBe(1);
    expect(await w.ledger.observe(job.id, 'b3-1', 0)).toBe('waiting');
    expect(w.payroll.reads()).toBe(1);
    w.advance(6 * H);
    w.payroll.outage(true);
    expect(await w.ledger.observe(job.id, 'b3-1', 1)).toBe('waiting');
    w.payroll.outage(false);
    w.payroll.set('registered');
    w.advance(6 * H);
    expect(await w.ledger.observe(job.id, 'b3-1', 2)).toBe('seen');
    expect(w.payroll.reads()).toBe(3);
    expect(await w.ledger.observe(job.id, 'b3-1', 2)).toBe('seen');
    expect(w.payroll.reads()).toBe(3);
    expect(
      w.store
        .audit()
        .filter(e => e.action === 'job.watch_observed')
        .map(e => [e.details?.check, e.details?.seen, e.details?.error ?? null]),
    ).toEqual([
      [0, false, null],
      [1, false, 'source-unavailable'],
      [2, true, null],
    ]);
    expect(w.payroll.executes()).toBe(0);
    expect((await w.ledger.readJob(manager, job.id))?.steps[2]).toMatchObject({ state: 'seen', observations: 3 });
  });
  test('the approval commits one timer intent per watch step with the job and starts its workflow in the same commit; a replay or a crash adds none', async () => {
    const w = world();
    await w.bindAll();
    const p = await w.jobs.assemble(manager, fact, w.call);
    const [a] = await Promise.all([w.approve(p), w.approve(p)]);
    const checks = ['2026-11-05T14:02:00.000Z', '2026-11-05T20:02:00.000Z', '2026-11-06T02:02:00.000Z'];
    expect(w.store.watches()).toEqual([
      {
        id: `watch:${a.id}:b3-1`,
        jobId: a.id,
        stepId: 'b3-1',
        personId: 'hillevi',
        generation: 1,
        checks,
        expiresAt: '2026-11-06T08:02:00.000Z',
        attempt: 0,
        leaseUntil: null,
        nextAt: '2026-11-05T08:02:00.000Z',
        deliveredAt: '2026-11-05T08:02:00.000Z',
        lastError: null,
      },
    ]);
    expect(w.store.audit().find(e => e.action === 'job.approved')?.details?.steps).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: 'b3-1', kind: 'watch', checks })]),
    );
    // The engine receives the committed schedule (D86): one `jobWatch` start per watch step, beside one `approvedExecution` per execute step.
    expect(w.store.enqueued().filter(s => s.workflow === 'jobWatch')).toEqual([
      {
        workflow: 'jobWatch',
        id: `watch:${a.id}:b3-1:1`,
        input: { jobId: a.id, stepId: 'b3-1', generation: 1, checks, expiresAt: '2026-11-06T08:02:00.000Z' },
      },
    ]);
    const crashed = world();
    await crashed.bindAll();
    const q = await crashed.jobs.assemble(manager, fact, crashed.call);
    const original = crashed.store.transaction;
    crashed.store.transaction = fn =>
      original(async tx => {
        await fn(tx);
        throw new Error('crash before commit');
      });
    await expect(crashed.approve(q)).rejects.toThrow('crash');
    expect(crashed.store.watches()).toEqual([]);
    expect(crashed.store.enqueued()).toEqual([]);
  });
  test('a watch past its window expires without a read and leaves one card for the person, named after the system and the step', async () => {
    const w = world();
    const { job } = await approved(w);
    w.advance(6 * H);
    await w.ledger.observe(job.id, 'b3-1', 0);
    w.advance(6 * H);
    w.payroll.outage(true);
    await w.ledger.observe(job.id, 'b3-1', 1);
    w.payroll.outage(false);
    w.advance(13 * H);
    expect(await w.ledger.observe(job.id, 'b3-1', 2)).toBe('expired');
    expect(w.payroll.reads()).toBe(2); // the window's end reads nothing more
    expect(w.store.audit().filter(e => e.action === 'job.watch_expired')).toHaveLength(1);
    expect(w.store.cards()).toEqual([
      {
        id: `watch:${job.id}:b3-1`,
        sourceAuthorization: manager.authorizationVersion,
        personId: 'hillevi',
        jobId: job.id,
        stepId: 'b3-1',
        connector: 'payroll',
        topic: `watch-expired:${job.id}:b3-1`,
        title: 'Lönesystemet har inte visat det som bevakades',
        summary:
          'Bevakas i lönesystemet: En kontroll fram till 09:02 visade inget och en kontroll nådde inte systemet. Titta i Lönesystemet eller fråga om jobbet.',
        reason: 'Bevakningen gick ut 10:02 utan att det förväntade syntes',
        at: '2026-11-06T09:02:00.000Z',
      },
    ]);
    expect(await w.ledger.observe(job.id, 'b3-1', 2)).toBe('expired');
    expect(w.store.cards()).toHaveLength(1);
    expect((await w.ledger.readJob(manager, job.id))?.steps[2]).toMatchObject({
      state: 'expired',
      title: 'Bevakas i lönesystemet',
      source: 'Lönesystemet',
    });
  });
  test('a watch past its window expires without a read, and a job with a watch needs a watch source', async () => {
    const w = world();
    const { job } = await approved(w);
    w.advance(25 * H);
    expect(await w.ledger.observe(job.id, 'b3-1', 0)).toBe('expired');
    expect(w.payroll.reads()).toBe(0);
    expect(w.store.audit().filter(e => e.action === 'job.watch_expired')).toHaveLength(1);
    expect(w.store.cards()).toHaveLength(1);
    expect(w.store.cards()[0]?.summary).toBe(
      'Bevakas i lönesystemet: Ingen kontroll kunde läsa systemet. Titta i Lönesystemet eller fråga om jobbet.',
    );
    const without = world({ watch: false });
    await without.bindAll();
    await expect(without.approve(await without.jobs.assemble(manager, fact, without.call))).rejects.toThrow(
      'Bevakning är inte tillgänglig',
    );
    expect(without.store.jobs()).toEqual([]);
    expect(without.store.dump()).toEqual([]);
  });
  test("undo all approves one linked compensation per confirmed step; an uncertain undo keeps that step's receipt; replay adds nothing", async () => {
    const w = world();
    const { job } = await approved(w);
    for (const s of job.steps) if (s.kind === 'execute') await w.ledger.progress(s.executionId!);
    w.systems.timesheet.loseReply();
    const undo = await w.ledger.undoJob(manager, job.id);
    expect(undo.compensations.map(c => c.stepId)).toEqual(['b1-1', 'b2-1']);
    expect(undo.skipped).toEqual([]);
    expect(w.store.dump()).toHaveLength(4);
    expect(w.store.enqueued().filter(s => s.workflow === 'approvedExecution')).toHaveLength(4);
    expect(w.store.audit().filter(e => e.action === 'execution.approved')).toHaveLength(4);
    expect(w.store.audit().filter(e => e.action === 'job.undo_approved')).toHaveLength(1);
    const hrId = stepOf(job, 'hr').executionId!,
      tsId = stepOf(job, 'timesheet').executionId!;
    expect(
      w.store
        .dump()
        .slice(2)
        .map(e => [e.connector, e.decisionId, e.compensates]),
    ).toEqual([
      ['hr', 'undo:' + hrId, hrId],
      ['timesheet', 'undo:' + tsId, tsId],
    ]);
    for (const c of undo.compensations) await w.ledger.progress(c.compensationId);
    expect((await w.store.read(undo.compensations[0]!.compensationId))?.state).toBe('succeeded');
    expect((await w.store.read(undo.compensations[1]!.compensationId))?.state).toBe('unknown');
    const original = await w.store.read(stepOf(job, 'timesheet').executionId!);
    expect(original?.state).toBe('succeeded');
    expect(original?.result?.rows[0]?.outcome).toBe('done');
    const again = await w.ledger.undoJob(manager, job.id);
    expect(again.compensations).toEqual(undo.compensations);
    expect(w.store.audit().filter(e => e.action === 'job.undo_approved')).toHaveLength(1);
    expect(w.store.dump()).toHaveLength(4);
  });
  test('undo all after the window has nothing to undo, and a step not yet done is skipped by name', async () => {
    const w = world();
    const { job } = await approved(w);
    await w.ledger.progress(stepOf(job, 'hr').executionId!);
    const partial = await w.ledger.undoJob(manager, job.id);
    expect(partial.compensations.map(c => c.stepId)).toEqual(['b1-1']);
    expect(partial.skipped).toEqual([{ stepId: 'b2-1', reason: 'not-done' }]);
    const late = world();
    const second = await approved(late);
    for (const s of second.job.steps) if (s.kind === 'execute') await late.ledger.progress(s.executionId!);
    late.advance(11 * 60_000);
    await expect(late.ledger.undoJob(manager, second.job.id)).rejects.toThrow('Inget att ångra');
  });
  test('a transaction crash leaves no job, execution, audit row or workflow start', async () => {
    const w = world();
    await w.bindAll();
    const p = await w.jobs.assemble(manager, fact, w.call);
    const original = w.store.transaction;
    w.store.transaction = fn =>
      original(async tx => {
        await fn(tx);
        throw new Error('crash before commit');
      });
    await expect(w.approve(p)).rejects.toThrow('crash');
    expect(w.store.jobs()).toEqual([]);
    expect(w.store.dump()).toEqual([]);
    expect(w.store.audit()).toEqual([]);
    expect(w.store.enqueued()).toEqual([]);
  });
});

describe('job approval and receipt boundaries', () => {
  const proposalFor = async (w: ReturnType<typeof world>) => {
    await w.bindAll();
    return w.jobs.assemble(manager, fact, w.call);
  };

  test('a later retry keeps the first committed watch schedule and rejects changed intent', async () => {
    const w = world(),
      proposal = await proposalFor(w);
    const first = await w.approve(proposal);
    const saved = w.store.jobs()[0]!,
      watches = w.store.watches();
    w.advance(5000);
    expect(await w.approve(proposal)).toEqual(first);
    expect(w.store.jobs()).toEqual([saved]);
    expect(w.store.watches()).toEqual(watches);
    expect(w.store.audit().filter(e => e.action === 'job.approved')).toHaveLength(1);
    const changed = structuredClone(proposal);
    const watch = changed.steps.find(s => s.draft.kind === 'watch')!;
    if (watch.draft.kind === 'watch') watch.draft.within = 'PT2H';
    await expect(w.approve(changed)).rejects.toThrow('annat innehåll');
    expect(w.store.watches()).toEqual(watches);
    expect(w.store.dump()).toHaveLength(2);
  });

  test('concurrent approvals prepared at different times return the first committed schedule', async () => {
    const w = world(),
      proposal = await proposalFor(w);
    let entered!: () => void,
      release!: () => void,
      pause = true;
    const waiting = new Promise<void>(resolve => {
      entered = resolve;
    });
    const resume = new Promise<void>(resolve => {
      release = resolve;
    });
    const authorize = w.source.authorize;
    w.source.authorize = async (...args) => {
      if (pause) {
        pause = false;
        entered();
        await resume;
      }
      return authorize(...args);
    };
    const earlier = w.approve(proposal);
    await waiting;
    w.advance(2000);
    let later: Awaited<ReturnType<typeof w.approve>>;
    try {
      later = await w.approve(proposal);
    } finally {
      release();
    }
    expect(await earlier).toEqual(later!);
    expect(w.store.jobs()).toHaveLength(1);
    expect(w.store.watches()).toHaveLength(1);
    expect(w.store.enqueued().filter(s => s.workflow === 'approvedExecution')).toHaveLength(2);
    expect(w.store.audit().map(e => e.action)).toEqual(['execution.approved', 'execution.approved', 'job.approved']);
  });

  for (const change of ['disable', 'remove', 'audience', 'window', 'follower', 'add'] as const) {
    test('approval refuses a stale proposal after a binding change: ' + change, async () => {
      const w = world(),
        proposal = await proposalFor(w);
      const binding = (await w.jobs.bindings()).find(b => b.capability === 'payroll.followAbsence')!;
      if (change === 'remove') await w.jobs.unbind(admin, binding.id);
      else if (change === 'add')
        await w.jobs.bind(admin, { kind: fact.kind, capability: 'hr.proposeAbsence', audience: { mode: 'all' } });
      else
        await w.jobs.bind(admin, {
          ...binding,
          ...(change === 'disable' ? { enabled: false } : {}),
          ...(change === 'audience' ? { audience: { mode: 'selected' as const, units: ['other-unit'] } } : {}),
          ...(change === 'window' ? { within: 'PT1H' } : {}),
          ...(change === 'follower' ? { capability: 'payroll.otherFollow' } : {}),
        });
      await expect(w.approve(proposal)).rejects.toThrow('Förslaget har ändrats');
      expect(w.store.jobs()).toEqual([]);
      expect(w.store.dump()).toEqual([]);
      expect(w.store.audit()).toEqual([]);
      expect(w.store.watches()).toEqual([]);
    });
  }

  test('bindings are checked again after step authorisation and before committing approval', async () => {
    const w = world(),
      proposal = await proposalFor(w);
    const binding = (await w.jobs.bindings()).find(b => b.capability === 'timesheet.followAbsence')!;
    const authorize = w.source.authorize;
    let changed = false;
    w.source.authorize = async (...args) => {
      if (!changed) {
        changed = true;
        await w.jobs.bind(admin, { ...binding, enabled: false });
      }
      return authorize(...args);
    };
    await expect(w.approve(proposal)).rejects.toThrow('Förslaget har ändrats');
    expect(w.store.jobs()).toEqual([]);
    expect(w.store.audit()).toEqual([]);
    expect(w.store.enqueued()).toEqual([]);
  });

  test('steps must belong to their named bound follower and retain source authorisation', async () => {
    const w = world(),
      proposal = await proposalFor(w);
    const forged = structuredClone(proposal);
    forged.steps[0]!.binding = proposal.steps[1]!.binding;
    await expect(w.approve(forged)).rejects.toThrow('Förslaget har ändrats');
    const authorize = w.source.authorize;
    w.source.authorize = async (...args) => {
      if (args[1].startsWith('timesheet.')) throw new Error('source denied');
      return authorize(...args);
    };
    await expect(w.approve(proposal)).rejects.toThrow('source denied');
    expect(w.store.jobs()).toEqual([]);
    expect(w.store.audit()).toEqual([]);
  });

  test('two followers of one connector have distinct steps and their own watch caps', async () => {
    const extra = follower('payroll.followSecond', ['hr:absence'], f => [
      {
        kind: 'watch',
        operation: 'payroll.absenceStatus',
        input: { person: f.attributes.person },
        expect: { path: ['status'], equals: 'registered' },
        within: 'P1D',
        title: 'Andra bevakningen',
      },
    ]);
    const w = world({
      connectors: [
        hrConnector(),
        timesheetConnector,
        { ...payrollConnector, capabilities: [...payrollConnector.capabilities, extra] },
      ],
    });
    await w.bindAll();
    const binding = await w.jobs.bind(admin, {
      kind: fact.kind,
      capability: extra.name,
      audience: { mode: 'all' },
      within: 'PT1H',
    });
    const proposal = await w.jobs.assemble(manager, fact, w.call);
    expect(new Set(proposal.steps.map(s => s.id)).size).toBe(4);
    expect(proposal.steps.find(s => s.binding === binding.id)?.id).toBe(binding.id + '-1');
    const job = await w.approve(proposal);
    const watches = job.steps.filter(s => s.kind === 'watch');
    expect(watches.map(s => s.expiresAt)).toEqual(['2026-11-06T08:02:00.000Z', '2026-11-05T09:02:00.000Z']);
    expect(w.store.watches()).toHaveLength(2);
  });

  test('job, execution, replay and undo cannot expose a receipt under changed producing authority', async () => {
    const w = world(),
      proposal = await proposalFor(w),
      job = await w.approve(proposal);
    for (const step of job.steps) if (step.kind === 'execute') await w.ledger.progress(step.executionId);
    const original = await w.ledger.readJob(manager, job.id);
    expect(original?.steps[0]).toMatchObject({ state: 'succeeded', result: { headline: 'Klart' } });
    const audit = w.store.audit();
    const execution = job.steps.find(s => s.kind === 'execute')!;
    for (const changed of [
      { ...manager, unitId: 'other-unit' },
      { ...manager, authorizationVersion: 'v2' },
      { ...manager, id: 'other-person' },
    ]) {
      expect(await w.ledger.readJob(changed, job.id)).toBeUndefined();
      expect(await w.ledger.read(changed, execution.executionId)).toBeUndefined();
      await expect(w.ledger.undoJob(changed, job.id)).rejects.toThrow('Jobbet finns inte');
      if (changed.id === manager.id)
        await expect(w.jobs.approve(changed, { decisionId: job.decisionId, proposal })).rejects.toThrow('finns inte');
    }
    expect(w.store.audit()).toEqual(audit);
    expect(await w.ledger.readJob(manager, job.id)).toEqual(original);
  });

  test('job reads recheck both execute and watch access without discarding stored receipts', async () => {
    const w = world(),
      proposal = await proposalFor(w),
      job = await w.approve(proposal);
    for (const step of job.steps) if (step.kind === 'execute') await w.ledger.progress(step.executionId);
    const original = await w.ledger.readJob(manager, job.id);
    const sourceAuthorize = w.source.authorize,
      watchAuthorize = w.watch.authorize;
    w.source.authorize = async () => {
      throw new Error('connector disabled');
    };
    expect(await w.ledger.readJob(manager, job.id)).toBeUndefined();
    w.source.authorize = sourceAuthorize;
    w.watch.authorize = async () => {
      throw new Error('watch permission removed');
    };
    expect(await w.ledger.readJob(manager, job.id)).toBeUndefined();
    w.watch.authorize = watchAuthorize;
    expect(await w.ledger.readJob(manager, job.id)).toEqual(original);
  });

  test('revocation during a job read is checked before returning its receipts', async () => {
    const w = world(),
      proposal = await proposalFor(w),
      job = await w.approve(proposal);
    let revoked = false;
    const actor = {
      ...manager,
      authorize: async () => {
        if (revoked) throw new Error('revoked');
        return { version: 'v1' };
      },
    };
    const authorize = w.watch.authorize;
    w.watch.authorize = async (...args) => {
      revoked = true;
      return authorize(...args);
    };
    await expect(w.ledger.readJob(actor, job.id)).rejects.toThrow('revoked');
  });
});
