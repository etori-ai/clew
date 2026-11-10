import { describe, expect, test } from 'bun:test';
import {
  CommitmentsResultSchema,
  TalksResultSchema,
  checkContract,
  type AuthenticatedContext,
  type CommitmentsResult,
  type StaffOverview,
  type StaffPerson,
  type TalksResult,
} from '../../packages/contracts/src/index';
import { SEARCH_CONNECTOR, actorOf, type Actor } from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { fetchManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import type { ConnectorManifest } from '../../packages/connectors/src/protocol';
import { createConnector } from '../../connectors/appraisals/connector.mjs';
import { memoryCalendar } from '../../packages/calendar/src/memory';
import { localInstant } from '../../packages/calendar/src/dates';
import { memoryConnectorStore } from '../../apps/server/src/connectors/adapters/memory';
import { connectorUsecases, type AdminDeps } from '../../apps/server/src/connectors/usecases/admin';
import { syncBundledRows, type ReconcileDeps } from '../../apps/server/src/connectors/reconcile';
import { memoryTalkStore } from '../../apps/server/src/modules/talks/adapters/memory';
import { talkUsecases } from '../../apps/server/src/modules/talks/usecases';
import { talksConnector } from '../../apps/server/src/modules/talks/capabilities';
import { talkSeamCapabilities } from '../../apps/server/src/modules/talk-seam/capabilities';
import { talkSeamUsecases } from '../../apps/server/src/modules/talk-seam/usecases';
import type { Directory } from '../../apps/server/src/modules/talk-seam/model';
import { memoryObligations, memoryProposalStore } from '../../apps/server/src/modules/calendar/adapters/memory';
import type { UnitMember } from '../../apps/server/src/modules/calendar/model';
import { calendarUsecases } from '../../apps/server/src/modules/calendar/usecases/samtal';
import { assertionFor, testJwks } from '../connector-authority';
import { Registry } from '../registry';

/**
 * The talks wiring as `apps/server/src/connectors/registry.ts` assembles it (D96 items 7 to 9), on memory adapters: the
 * built-in talks module is a bundled connector with an administrable row, the talks seam's two reads are part of Clew's
 * core connector, and the seam asks whichever system answers the profile now. The built-in round asks a real planner
 * (over a calendar in memory) who is booked, with a round reader that fails if it is ever asked: the round and the
 * bookings do not call each other. The appraisals fixture runs in process behind a fetch, as its own test runs it.
 */
const ORG = 'org-test';
const SECRET = 'test-secret-test-secret';
const T0 = '2026-11-10T09:00:00.000Z';
const persona = (
  id: string,
  name: string,
  role: 'manager' | 'employee',
  capabilities: string[] = [],
): AuthenticatedContext => ({
  id,
  name,
  unitId: 'unit-skola',
  unitLabel: 'Bergsåkers skola',
  role,
  organisationId: ORG,
  principal: { id: 'person:' + id, kind: 'person' },
  capabilities,
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v1' }),
});
// The fixture knows each person by the user name Clew signs into the assertion (D97).
const hillevi = { ...persona('hillevi', 'Hillevi Berg', 'manager'), userName: 'hillevi' };
const anna = { ...persona('p-anna', 'Anna Lindqvist', 'employee'), userName: 'anna' };
const mikael = persona('mikael', 'Mikael Lund', 'employee', ['admin.connectors']);
const staffPerson = (id: string, name: string, userName: string): StaffPerson => ({
  id,
  name,
  userName,
  email: userName + '@clew.test',
  role: 'employee',
  enabled: true,
});
// The user names of the development directory (`scripts/provisioner/directory.ts`), which the appraisals fixture uses.
const STAFF = [
  staffPerson('p-anna', 'Anna Lindqvist', 'anna'),
  staffPerson('p-erik', 'Erik Sandström', 'erik'),
  staffPerson('p-maria', 'Maria Källström', 'maria'),
  staffPerson('p-johan', 'Johan Byström', 'johan'),
  staffPerson('p-karin', 'Karin Lindqvist', 'karin'),
];
const overviews = new Map<string, StaffOverview>([
  ['hillevi', { units: [{ unitId: 'unit-skola', unitLabel: 'Bergsåkers skola', people: STAFF }] }],
]);
const personas = new Map([hillevi, anna, mikael].map(p => [p.id, p]));
const userNames = new Map<string, string>([['hillevi', 'hillevi'], ...STAFF.map(p => [p.id, p.userName!] as const)]);

function world() {
  let now = Date.parse(T0);
  const clock = () => new Date(now);
  let n = 0;
  const ids = () => 'id-' + ++n;
  // The planner, over a calendar in memory where Erik's talk is booked; its round reader must never be asked here.
  const account = { ref: 'memory:account:hillevi', email: 'hillevi@clew.test', name: 'Hillevi Berg' };
  const calendar = memoryCalendar(account);
  const team = async (p: AuthenticatedContext): Promise<UnitMember[]> =>
    (overviews.get(p.id)?.units ?? []).flatMap(u =>
      u.people.map(m => ({ personId: m.id, ref: 'memory:account:' + m.id, email: m.email!, name: m.name })),
    );
  const roundReads: string[] = [];
  const planner = calendarUsecases({
    store: memoryProposalStore(),
    bind: () => ({ provider: calendar }),
    team,
    round: async p => {
      roundReads.push(p.id);
      throw new Error('the bookings read the round');
    },
    clock,
    ids,
    people: { personaFor: async () => undefined },
    notify: async () => undefined,
    obligations: memoryObligations(),
  });
  const store = memoryTalkStore({
    persons: STAFF.map(p => ({ id: p.id, organisationId: ORG, name: p.name, userName: p.userName })),
  });
  const talks = talkUsecases({
    store,
    staff: async p => overviews.get(p.id) ?? { units: [] },
    bookings: (p, round) => planner.samtalBookings(p, round),
    clock,
    ids,
  });
  const registry = new Registry();
  // As composition/talks.ts builds the directory: the reader's user name and the people they manage now.
  const directory: Directory = async actor => ({
    self: { id: actor.id, userName: userNames.get(actor.id) ?? null },
    staff: (overviews.get(actor.id)?.units ?? []).flatMap(u => u.people.map(p => ({ id: p.id, userName: p.userName }))),
  });
  // As connectors/registry.ts assembles them: the seam's reads joined into Clew's core connector, the built-in bundled.
  const seam = talkSeamUsecases({ source: actor => registry.talkSource(actor), directory });
  registry.register({
    id: SEARCH_CONNECTOR,
    kind: 'core',
    source: 'Startsidan',
    areas: [],
    ...talkSeamCapabilities(seam, actor => !!registry.talkSource(actor)),
  });
  registry.register(
    talksConnector(talks, async actor => {
      const p = personas.get(actor.id);
      if (!p) throw new Error('unknown person');
      return p;
    }),
  );
  // The appraisal system as a remote connector an administrator adds; its records are dated from the test's today.
  const service = createConnector({ jwks: testJwks, secret: SECRET, today: () => '2026-11-10' });
  const serviceFetch: FetchLike = (input, init) => service.handle(new Request(input, init));
  const live = {
    register(source: { id: string; url: string; secret: string }, manifest: ConnectorManifest) {
      registry.replace(
        remoteConnector(manifest, {
          url: source.url,
          key: source.secret,
          assert: assertionFor(source.id, SECRET),
          fetch: serviceFetch,
        }),
      );
    },
    unregister: (id: string) => void registry.unregister(id),
  };
  const connectors = memoryConnectorStore();
  const secrets = {
    seal: (v: string, id: string) => `sealed(${id}):${v}`,
    open: (s: string, id: string) => s.replace(`sealed(${id}):`, ''),
  };
  const deps: AdminDeps = {
    internal: [],
    store: connectors,
    registry,
    clock,
    live,
    units: { list: async () => [] },
    groups: { list: async () => [] },
    secrets,
    transport: {
      fetchManifest: (url, id) => fetchManifest(url, id, serviceFetch),
      check: ({ url, id, secret }) =>
        checkConnector({
          url,
          id,
          key: secret,
          assert: assertionFor(id, SECRET),
          assertForeign: assertionFor(id, 'another-secret-another'),
          fetch: serviceFetch,
        }),
    },
  };
  const reconcile: ReconcileDeps = {
    registry,
    store: connectors,
    secrets,
    live,
    bundled: [SEARCH_CONNECTOR, 'talks'],
    internal: [],
    clock,
    log: () => undefined,
  };
  return {
    registry,
    talks,
    store,
    calendar,
    connectors,
    admin: connectorUsecases(deps),
    reconcile,
    roundReads,
    advance: (ms: number) => void (now += ms),
  };
}
const read = <T>(registry: Registry, p: AuthenticatedContext, name: string, input: unknown = {}) =>
  registry.run<T>(actorOf(p), name, input);
const PROFILE = ['clew.talks', 'clew.commitments', 'talks.talks', 'talks.commitments'];
const noProfileTool = (registry: Registry, actor: Actor) =>
  expect(registry.tools(actor).filter(t => PROFILE.includes(t.name) || t.name.startsWith('appraisals.'))).toEqual([]);

describe('the talks wiring (D96 items 7 to 9)', () => {
  test('with the built-in module: clew.talks is writable, booked comes from the planner, and the talks area has the figure', async () => {
    const w = world();
    await syncBundledRows(w.reconcile);
    // A bundled row, enabled for everyone until an administrator says otherwise.
    expect((await w.connectors.read('talks'))!).toMatchObject({ bundled: true, state: 'enabled' });
    await w.talks.openRound('operator:cli', {
      organisationId: ORG,
      label: 'Utvecklingssamtal 2026',
      opensOn: '2026-09-01',
      dueOn: '2026-11-28',
    });
    await w.calendar.create('samtal-erik', {
      title: 'Utvecklingssamtal · Erik Sandström',
      start: localInstant('2026-11-20T09:00'),
      end: localInstant('2026-11-20T10:00'),
      participants: ['erik@clew.test'],
    });
    await w.talks.markHeld(hillevi, 'p-anna', { heldOn: '2026-11-03' });
    const pointId = await w.talks.addCommitment(hillevi, 'p-anna', {
      owner: 'employee',
      text: 'Gå kursen i arbetsrätt',
      dueOn: '2026-12-15',
    });

    expect(w.registry.talkSource(actorOf(hillevi))).toMatchObject({ builtIn: true, connectorId: 'talks' });
    const round = await read<TalksResult>(w.registry, hillevi, 'clew.talks');
    expect(checkContract(TalksResultSchema, round)).toBe(true);
    expect(round).toMatchObject({
      round: { label: 'Utvecklingssamtal 2026', opensOn: '2026-09-01', dueOn: '2026-11-28' },
      writable: true,
      source: 'Utvecklingssamtal',
    });
    const state = Object.fromEntries(round.rows.map(r => [r.personId, r.state]));
    expect(state).toEqual({
      'p-anna': 'held',
      'p-erik': 'booked',
      'p-maria': 'missing',
      'p-johan': 'missing',
      'p-karin': 'missing',
    });
    // The round asked the calendar who is booked; the calendar did not ask for the round.
    expect(round.bookedUnknown).toBeUndefined();
    expect(w.roundReads).toEqual([]);

    const own = await read<CommitmentsResult>(w.registry, anna, 'clew.commitments');
    expect(checkContract(CommitmentsResultSchema, own)).toBe(true);
    expect(own).toMatchObject({ writable: true, source: 'Utvecklingssamtal' });
    expect(own.rows.map(r => [r.id, r.personId, r.owner, r.mine])).toEqual([[pointId, 'p-anna', 'employee', true]]);

    const area = (await w.registry.areas(actorOf(hillevi))).find(a => a.id === 'talks')!;
    expect(area.title).toBe('Utvecklingssamtal');
    expect(area.figure).toMatchObject({ label: 'Utvecklingssamtal hållna', value: '1 av 5' });
    noProfileTool(w.registry, actorOf(hillevi));
    noProfileTool(w.registry, actorOf(anna));
  });

  test('switched off by an administrator, the enabled appraisal system answers read-only with its links; with neither, the composites are not offered', async () => {
    const w = world();
    await syncBundledRows(w.reconcile);
    await w.admin.add(mikael, { id: 'appraisals', url: 'http://appraisals', secret: SECRET });
    await w.admin.update(mikael, 'appraisals', { state: 'enabled' });
    // Both answer the profile: the built-in module does, while it is enabled.
    expect(w.registry.talkSource(actorOf(hillevi))).toMatchObject({ builtIn: true, connectorId: 'talks' });

    w.advance(60_000);
    await w.admin.update(mikael, 'talks', { state: 'disabled' });
    expect(w.connectors.audit.filter(a => a.subject === 'connector:talks')).toEqual([
      {
        actor: 'person:mikael',
        action: 'connector.disabled',
        subject: 'connector:talks',
        at: '2026-11-10T09:01:00.000Z',
        details: { from: 'enabled' },
      },
    ]);
    expect(w.registry.talkSource(actorOf(hillevi))).toMatchObject({ builtIn: false, connectorId: 'appraisals' });
    const round = await read<TalksResult>(w.registry, hillevi, 'clew.talks');
    expect(checkContract(TalksResultSchema, round)).toBe(true);
    expect(round).toMatchObject({ writable: false, source: 'Samtalssystemet' });
    expect(round.rows.map(r => [r.personId, r.state])).toEqual([
      ['p-maria', 'missing'],
      ['p-erik', 'booked'],
      ['p-johan', 'booked'],
      ['p-anna', 'held'],
      ['p-karin', 'held'],
    ]);
    expect(round.rows.every(r => r.link?.startsWith('https://appraisals.example/'))).toBe(true);
    const hers = await read<CommitmentsResult>(w.registry, anna, 'clew.commitments');
    expect(checkContract(CommitmentsResultSchema, hers)).toBe(true);
    expect(hers.writable).toBe(false);
    expect(hers.rows.length).toBeGreaterThan(0);
    // Read-only: no row carries the built-in module's id, which only its write routes take.
    expect(hers.rows.every(r => r.id === undefined && r.personId === 'p-anna' && !!r.link)).toBe(true);
    // The built-in module's area is gone with it.
    expect((await w.registry.areas(actorOf(hillevi))).find(a => a.id === 'talks')).toBeUndefined();
    noProfileTool(w.registry, actorOf(hillevi));

    await w.admin.update(mikael, 'appraisals', { state: 'disabled' });
    expect(w.registry.talkSource(actorOf(hillevi))).toBeUndefined();
    for (const p of [hillevi, anna]) {
      expect(w.registry.allowed(actorOf(p), 'clew.talks')).toBeUndefined();
      expect(w.registry.allowed(actorOf(p), 'clew.commitments')).toBeUndefined();
      await expect(read(w.registry, p, 'clew.talks')).rejects.toThrow();
    }
    noProfileTool(w.registry, actorOf(hillevi));
  });

  test('the planner’s bookings never read the round, so the round read through clew.talks cannot loop back into the planner', async () => {
    const w = world();
    expect((await w.talks.round(hillevi)).round).toBeNull();
    await w.talks.openRound('operator:cli', {
      organisationId: ORG,
      label: 'R',
      opensOn: '2026-09-01',
      dueOn: '2026-11-28',
    });
    expect((await w.talks.round(hillevi)).rows).toHaveLength(5);
    expect(w.roundReads).toEqual([]);
  });
});
