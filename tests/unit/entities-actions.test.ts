import { describe, expect, test } from 'bun:test';
import { SUBJECT_CHANGED, type AuthenticatedContext } from '../../packages/contracts/src/index';
import {
  actorOf,
  CapabilityError,
  openGovernance,
  Registry,
  type Capability,
  type Connector,
} from '../../packages/connectors/src/index';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { staffUsecases } from '../../apps/server/src/modules/people/usecases';
import { entityUsecases } from '../../apps/server/src/modules/entities/usecases';
import { entityActionUsecases } from '../../apps/server/src/modules/entities/actions';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { startedCards } from '../../apps/server/src/threads/usecases/started';
import { cardDecisions } from '../../apps/server/src/threads/usecases/decisions';
import { threadAccess } from '../../apps/server/src/threads/access';
import { entityRoutes, type EntityRouteDeps } from '../../apps/server/src/routes/entities';
import { InputError } from '../../apps/server/src/context';
import { fixtureConnectors } from '../fixture-connectors';
import { memoryPersonKeys } from '../person-keys';

/**
 * An action about a person, started from the person's menu without the model (D97, D8): the real registry with small
 * in-test sources, the people module's directory on its memory store, the entities use cases, and the stream's started
 * card on the memory thread store, wired as the composition wires them. A propose's draft becomes the card; an execute
 * becomes a card whose button is the human decision and reaches nothing before it; whatever the reader may not reach
 * answers undefined (the route's 404) and writes nothing. A person is started on by their id and the source is asked by
 * their user name (D116); in the in-test world the two differ, as they do in an installation.
 */
const T = '2026-11-10T08:00:00.000Z';

function directory(userNames: Record<string, string> = {}) {
  const store = memoryProvisionStore(),
    s = store.state;
  const person = (id: string, name: string, userName: string, unitId: string, role: 'manager' | 'employee') => {
    s.users.set(id, {
      id,
      organisationId: unitId === 'unit-annan' ? 'other' : 'poc',
      externalId: 'dev:' + id,
      userName: userNames[id] ?? userName,
      name,
      email: null,
      phoneNumbers: [],
      employments: [],
      title: null,
      enabled: id !== 'bo',
      createdAt: T,
      updatedAt: T,
    });
    s.assignments.set(id, [{ unitId, role }]);
    s.grants.set(id, { unitId, unitLabel: s.units.get(unitId)!.label, role, capabilities: [] });
  };
  s.units.set('unit-skola', { organisationId: 'poc', label: 'Bergsåkers skola' });
  s.units.set('unit-ekonomi', { organisationId: 'poc', label: 'Ekonomiavdelningen' });
  s.units.set('unit-annan', { organisationId: 'other', label: 'Annan kommun' });
  person('hillevi', 'Hillevi Berg', 'hillevi', 'unit-skola', 'manager');
  person('anna', 'Anna Lindqvist', 'anna', 'unit-skola', 'employee');
  person('maria', 'Maria Öst', 'maria', 'unit-skola', 'employee');
  person('erik', 'Erik Sandström', 'erik', 'unit-skola', 'employee');
  person('bo', 'Bo Ärlig', 'bo', 'unit-skola', 'employee');
  person('karin', 'Karin Åberg', 'karin', 'unit-ekonomi', 'employee');
  person('stranger', 'Annan Person', 'stranger', 'unit-annan', 'employee');
  const persona = (id: string, version = 'v1'): AuthenticatedContext => {
    const user = s.users.get(id)!,
      grant = s.grants.get(id)!;
    return {
      id,
      name: user.name,
      unitId: grant.unitId,
      unitLabel: grant.unitLabel,
      role: grant.role,
      ...(user.userName ? { userName: user.userName } : {}),
      organisationId: user.organisationId,
      principal: { id: 'person:' + id, kind: 'person' },
      capabilities: [],
      authorizationVersion: version,
      sessionBinding: 'test',
      expiresAt: '2099-01-01T00:00:00.000Z',
      authorize: async () => ({ version }),
    };
  };
  return { staff: staffUsecases({ store }), persona, state: s };
}

const personInput = (extra: Record<string, unknown> = {}) =>
  ({
    type: 'object',
    properties: { person: { type: 'string' }, ...extra },
    required: ['person'],
    additionalProperties: false,
  }) as never;
const anything = { type: 'object' } as never;

/** The sources: what they were asked, call by call. */
function sources() {
  const asked = { prepare: [] as unknown[], report: [] as unknown[], flag: [] as unknown[] };
  /** The HR system knows two people on the school, by user name. */
  const employees: Record<string, string> = { 'maria.o': 'hr:emp:1', 'anna.l': 'hr:emp:2' };
  const prepare: Capability = {
    name: 'hr.prepare',
    kind: 'propose',
    title: 'Registrera frånvaro',
    description: 'Förbereder en sjukanmälan.',
    model: false,
    about: { entity: 'person', param: 'person' },
    input: personInput({ from: { type: 'string' } }),
    output: anything,
    scope: { roles: ['manager'] },
    run: async (_actor, raw) => {
      const input = raw as { person: string };
      asked.prepare.push(input);
      const ref = employees[input.person];
      if (!ref) throw new CapabilityError('Medarbetaren finns inte i din enhet.');
      return {
        topic: `hr:absence-draft:${ref}:2026-11-10`,
        area: 'employees',
        title: 'Sjukanmälan att registrera',
        summary: 'Sjukfrånvaro i dag, heltid.',
        reason: 'Källans egen förklaring',
        items: [
          {
            ref,
            label: 'Maria Öst',
            detail: '10 nov · 100 %',
            selectable: false,
            selected: true,
            subject: { entity: 'person', key: input.person },
          },
        ],
        actions: [
          {
            id: 'report',
            label: 'Registrera sjukanmälan',
            capability: 'hr.report',
            kind: 'execute',
            role: 'primary',
            input: { person: ref, from: '2026-11-10' },
          },
        ],
      };
    },
  };
  const report: Capability = {
    name: 'hr.report',
    kind: 'execute',
    title: 'Registrera sjukanmälan',
    description: 'Registrerar en sjukanmälan.',
    model: false,
    input: anything,
    output: anything,
    scope: { roles: ['manager'] },
    run: async (_actor, input) => {
      asked.report.push(input);
      return { headline: 'Klart.', rows: [] };
    },
  };
  const flag: Capability = {
    name: 'hr.flag',
    kind: 'execute',
    title: 'Markera för uppföljning',
    description: 'Markerar medarbetaren för uppföljning i personalsystemet.',
    model: false,
    about: { entity: 'person', param: 'person' },
    input: personInput(),
    output: anything,
    scope: { roles: ['manager'] },
    run: async (_actor, input) => {
      asked.flag.push(input);
      return { headline: 'Klart.', rows: [] };
    },
  };
  /** A propose whose card would carry another system's write: never a card (D35). */
  const foreign: Capability = {
    ...prepare,
    name: 'hr.foreign',
    title: 'Främmande',
    run: async () => ({
      topic: 'hr:foreign',
      area: 'employees',
      title: 'x',
      summary: 'x',
      reason: 'x',
      actions: [{ id: 'pay', label: 'Betala', capability: 'finance.pay', kind: 'execute', role: 'primary' }],
    }),
  };
  const plan: Capability = {
    name: 'units.plan',
    kind: 'propose',
    title: 'Planera bemanning',
    description: 'x',
    model: false,
    about: { entity: 'unit', param: 'unit' },
    input: {
      type: 'object',
      properties: { unit: { type: 'string' } },
      required: ['unit'],
      additionalProperties: false,
    } as never,
    output: anything,
    scope: {},
    run: async () => ({}),
  };
  const area = { id: 'employees', title: 'Medarbetare', roles: ['manager' as const], standing: [], schedules: [] };
  const connectors: Connector[] = [
    {
      id: 'hr',
      kind: 'passthrough',
      source: 'Personalsystemet',
      areas: [area],
      capabilities: [prepare, report, flag, foreign],
    },
    { id: 'units', kind: 'passthrough', source: 'Bemanningen', areas: [], capabilities: [plan] },
  ];
  return { asked, connectors };
}

/** The world as the composition wires it; with `fixture`, the HR system is the development stack's own (D61). */
function world(options: { fixture?: boolean } = {}) {
  // The development stack's HR system knows the seed's user names; the in-test one knows its own.
  const people = directory(options.fixture ? {} : { maria: 'maria.o', anna: 'anna.l' });
  const keys = memoryPersonKeys(people.state);
  const { asked, connectors: inTest } = sources();
  const fixtures = fixtureConnectors({ only: ['hr'], clock: () => new Date(T) });
  const connectors = options.fixture ? fixtures.connectors : inTest;
  const registry = new Registry();
  for (const c of connectors) registry.register(c).govern(c.id, openGovernance());
  const store = memoryThreadStore();
  let n = 0;
  // The server's `runCapability`: the registry's call path as the person, a source's refusal as a Swedish input error.
  const run = async (persona: AuthenticatedContext, name: string, input: unknown) => {
    try {
      return await registry.run(actorOf(persona), name, input);
    } catch (error) {
      throw error instanceof CapabilityError ? new InputError(error.message) : error;
    }
  };
  const started = startedCards({
    store,
    registry,
    run,
    digest: value => JSON.stringify(value),
    clock: () => new Date(T),
    ids: () => `card-${++n}`,
    people: keys,
  });
  const entities = entityUsecases({
    directory: people.staff,
    sources: {
      reads: async (actor, kind) => registry.aboutReads(actor, kind),
      actions: async (actor, kind) => registry.aboutActions(actor, kind),
    },
    read: (persona, capability, input, signal) =>
      registry.clewFor(actorOf(persona), { signal }).call(capability, input),
    cards: async () => [],
  });
  const access = threadAccess(store, registry);
  const approvals: unknown[] = [];
  const decisions = cardDecisions({
    read: (p, id) => access.read(p, id),
    registry,
    run,
    approve: async (_p, input) => {
      approvals.push(input);
    },
    clock: () => new Date(T),
    people: keys,
  });
  const actions = entityActionUsecases({
    open: entities.detail,
    start: started.startCard,
    effect: decisions.effectFor,
    clock: () => new Date(T),
  });
  const nothingWritten = () => {
    expect(store.dump()).toEqual([]);
    expect(store.audit).toEqual([]);
    expect(asked.report).toEqual([]);
    expect(asked.flag).toEqual([]);
  };
  return { people, registry, store, entities, actions, access, decisions, approvals, asked, fixtures, nothingWritten };
}

describe('an action about a person, started from the menu', () => {
  test('a propose becomes one card for the reader: its draft, the person by id, the audit row', async () => {
    const w = world();
    const hillevi = w.people.persona('hillevi');
    const { threadId } = (await w.actions.start(hillevi, 'person', 'maria', 'hr.prepare'))!;
    // The source was asked with its own key alone, the user name as the directory spells it; nothing was written anywhere.
    expect(w.asked.prepare).toEqual([{ person: 'maria.o' }]);
    expect(w.asked.report).toEqual([]);
    const card = (await w.access.read(hillevi, threadId))!;
    expect(card).toMatchObject({
      kind: 'pushed',
      state: 'open',
      connector: 'hr',
      area: 'employees',
      title: 'Sjukanmälan att registrera',
      summary: 'Sjukfrånvaro i dag, heltid.',
      sourceAuthorization: 'v1',
      waitingOn: null,
      // The person's choice is the reason, whatever the source wrote.
      trigger: { reason: 'Du valde Registrera frånvaro för Maria Öst', source: 'Personalsystemet', at: T },
      items: [
        {
          ref: 'hr:emp:1',
          label: 'Maria Öst',
          detail: '10 nov · 100 %',
          selectable: false,
          selected: true,
          subject: { entity: 'person', key: 'maria' },
        },
      ],
      actions: [{ id: 'report', capability: 'hr.report', kind: 'execute', input: { person: 'hr:emp:1' } }],
    });
    expect(card.messages.map(m => [m.role, m.body])).toEqual([['assistant', 'Sjukfrånvaro i dag, heltid.']]);
    // Only the reader's.
    expect(w.store.dump().map(r => r.personId)).toEqual(['hillevi']);
    expect(w.store.audit).toEqual([
      {
        actor: 'person:hillevi',
        action: 'thread.started',
        subject: 'thread:' + threadId,
        at: T,
        details: {
          connector: 'hr',
          capability: 'hr.prepare',
          kind: 'propose',
          topic: card.topic,
          owner: 'hillevi',
          about: { entity: 'person', id: 'maria' },
        },
      },
    ]);
    expect(card.topic).toStartWith('started:hr.prepare:');
  });

  test('an execute becomes a card whose button is the decision, and nothing reaches the source before it', async () => {
    const w = world();
    const hillevi = w.people.persona('hillevi');
    const { threadId } = (await w.actions.start(hillevi, 'person', 'anna', 'hr.flag'))!;
    expect(w.asked.flag).toEqual([]);
    const card = (await w.access.read(hillevi, threadId))!;
    // The card keeps the person by id (D116): a rename before the decision leaves it as it is.
    expect(card).toMatchObject({
      connector: 'hr',
      area: 'employees',
      title: 'Markera för uppföljning',
      summary: 'Markerar medarbetaren för uppföljning i personalsystemet.',
      trigger: { reason: 'Du valde Markera för uppföljning för Anna Lindqvist', source: 'Personalsystemet' },
      // Who it acts on, as Clew knows them; Clew's own id is the row's ref, and the subject puts the card on the person.
      items: [
        {
          ref: 'person:anna',
          label: 'Anna Lindqvist',
          detail: 'Bergsåkers skola',
          selectable: false,
          subject: { entity: 'person', key: 'anna' },
        },
      ],
      actions: [
        {
          id: 'decide',
          label: 'Markera för uppföljning',
          capability: 'hr.flag',
          kind: 'execute',
          role: 'primary',
          input: { person: 'anna' },
        },
      ],
    });
    expect(w.store.audit.map(a => [a.action, a.details?.kind, a.details?.about])).toEqual([
      ['thread.started', 'execute', { entity: 'person', id: 'anna' }],
    ]);
    // The button is the human decision: it hands the approved intent to the ledger (D45), still without the source. The
    // payload names Anna by the user name she has as the decision is made, and the person it is about goes with it, so
    // that dispatch can check the name is still hers (D116).
    w.people.state.users.get('anna')!.userName = 'anna.lindqvist';
    expect(await w.decisions.act(hillevi, threadId, 'decide')).toMatchObject({ kind: 'execute' });
    expect(w.approvals).toEqual([
      expect.objectContaining({
        operation: 'hr.flag',
        payload: { person: 'anna.lindqvist' },
        presentation: expect.objectContaining({ threadId, actionId: 'decide' }),
        subject: { param: 'person', personId: 'anna' },
      }),
    ]);
    expect(w.asked.flag).toEqual([]);
  });

  test('a decision whose dispatch was refused because the user name moved is decided again, on the name the person has now (D116)', async () => {
    const w = world();
    const hillevi = w.people.persona('hillevi');
    const { threadId } = (await w.actions.start(hillevi, 'person', 'anna', 'hr.flag'))!;
    await w.decisions.act(hillevi, threadId, 'decide');
    const first = w.approvals[0] as { decisionId: string };
    // Dispatch found 'anna.l' no longer Anna's and failed the execution without sending it (D116); the card shows that.
    w.people.state.users.get('anna')!.userName = 'anna.lindqvist';
    // The ledger's projection writes the settled execution onto the card (composition/execution-projection.ts).
    const settled = (reason: string, at: string) =>
      w.store.transaction(tx =>
        tx.updateThread(threadId, {
          execution: {
            id: 'e1',
            decisionId: first.decisionId,
            operation: 'hr.flag',
            state: 'failed',
            reason,
            compensates: null,
          },
          updatedAt: at,
        } as never),
      );
    await settled(SUBJECT_CHANGED, '2026-11-12T08:05:00.000Z');
    await w.decisions.act(hillevi, threadId, 'decide');
    const again = w.approvals[1] as { decisionId: string };
    expect(again).toMatchObject({
      payload: { person: 'anna.lindqvist' },
      subject: { param: 'person', personId: 'anna' },
    });
    // A new decision, not a replay of the refused one: the ledger keeps what the first was approved with.
    expect(again.decisionId).not.toBe(first.decisionId);
    // Any other failure is the same decision asked again, which the ledger answers with the execution it already has.
    await settled('approval-expired', '2026-11-12T08:10:00.000Z');
    await w.decisions.act(hillevi, threadId, 'decide');
    expect((w.approvals[2] as { decisionId: string }).decisionId).toBe(first.decisionId);
    expect(w.asked.flag).toEqual([]);
  });

  test('an execute about someone no longer in the directory cannot be decided, and nothing is approved (D116)', async () => {
    const w = world();
    const hillevi = w.people.persona('hillevi');
    const { threadId } = (await w.actions.start(hillevi, 'person', 'anna', 'hr.flag'))!;
    w.people.state.users.get('anna')!.userName = null;
    await expect(w.decisions.act(hillevi, threadId, 'decide')).rejects.toThrow(
      'Personen finns inte längre i katalogen. Inget har skickats.',
    );
    w.people.state.users.delete('anna');
    await expect(w.decisions.act(hillevi, threadId, 'decide')).rejects.toThrow(
      'Personen finns inte längre i katalogen. Inget har skickats.',
    );
    expect(w.approvals).toEqual([]);
    expect(w.asked.flag).toEqual([]);
  });

  test('an action not about that kind, a key outside the rule and an action the reader may not call answer undefined and write nothing', async () => {
    const w = world();
    const hillevi = w.people.persona('hillevi');
    // About a unit, not a person; and a person's action asked on a unit.
    expect(await w.actions.start(hillevi, 'person', 'anna', 'units.plan')).toBeUndefined();
    expect(await w.actions.start(hillevi, 'unit', 'unit-skola', 'hr.prepare')).toBeUndefined();
    // Another organisation, a deactivated person, nobody at all, and a user name, which is the source's key and not Clew's.
    for (const key of ['stranger', 'bo', 'nobody', 'maria.o', 'MARIA'])
      expect([key, await w.actions.start(hillevi, 'person', key, 'hr.prepare')]).toEqual([key, undefined]);
    // A capability that does not exist, and a write that is not about anyone.
    for (const capability of ['hr.nothing', 'hr.report'])
      expect(await w.actions.start(hillevi, 'person', 'anna', capability)).toBeUndefined();
    // An employee may not call the manager's action, not even about themselves.
    expect(await w.actions.start(w.people.persona('anna'), 'person', 'anna', 'hr.prepare')).toBeUndefined();
    // An action the administrator switched off is not offered.
    w.registry.govern('hr', { ...openGovernance(), capabilities: { 'hr.flag': { enabled: false } } });
    expect(await w.actions.start(hillevi, 'person', 'anna', 'hr.flag')).toBeUndefined();
    expect(w.asked.prepare).toEqual([]);
    w.nothingWritten();
  });

  test('the same request while the card is open gives the same card; once it is handled, or the authority changed, a new one', async () => {
    const w = world();
    const hillevi = w.people.persona('hillevi');
    const first = (await w.actions.start(hillevi, 'person', 'maria', 'hr.prepare'))!;
    expect(await w.actions.start(hillevi, 'person', 'maria', 'hr.prepare')).toEqual(first);
    const flagged = (await w.actions.start(hillevi, 'person', 'anna', 'hr.flag'))!;
    expect(await w.actions.start(hillevi, 'person', 'anna', 'hr.flag')).toEqual(flagged);
    // A rename leaves the request as it was: the card names Anna by id (D116), so it is the same card.
    w.people.state.users.get('anna')!.userName = 'anna.lindqvist';
    expect(await w.actions.start(hillevi, 'person', 'anna', 'hr.flag')).toEqual(flagged);
    expect(w.store.dump()).toHaveLength(2);
    expect(w.store.audit).toHaveLength(2);
    // Handled: the next request is new work.
    await w.store.transaction(tx => tx.updateThread(first.threadId, { state: 'handled', handledAt: T, updatedAt: T }));
    const again = (await w.actions.start(hillevi, 'person', 'maria', 'hr.prepare'))!;
    expect(again.threadId).not.toBe(first.threadId);
    // A changed grant cannot see the old card, so it gets its own.
    const later = (await w.actions.start(w.people.persona('hillevi', 'v2'), 'person', 'anna', 'hr.flag'))!;
    expect(later.threadId).not.toBe(flagged.threadId);
    expect(w.store.audit.map(a => a.action)).toEqual(Array(4).fill('thread.started'));
    expect(w.asked.report).toEqual([]);
    expect(w.asked.flag).toEqual([]);
  });

  test('a source that refuses the person, or answers something that is not its own card, writes nothing', async () => {
    const w = world();
    const hillevi = w.people.persona('hillevi');
    // Karin is a colleague the reader may ask about, but not one of the HR system's for this manager: it says so in Swedish.
    await expect(w.actions.start(hillevi, 'person', 'karin', 'hr.prepare')).rejects.toThrow(
      'Medarbetaren finns inte i din enhet.',
    );
    await expect(w.actions.start(hillevi, 'person', 'maria', 'hr.foreign')).rejects.toThrow(
      'Förslaget från Personalsystemet kunde inte läsas.',
    );
    w.nothingWritten();
  });

  test('the HR system\'s "Registrera frånvaro": the menu offers it, the card names Maria, and its button is the existing sick report', async () => {
    const w = world({ fixture: true });
    const hillevi = w.people.persona('hillevi');
    expect((await w.entities.list(hillevi, 'person')).actions).toEqual([
      {
        capability: 'hr.prepareAbsence',
        connector: 'hr',
        source: 'Personalsystemet',
        title: 'Registrera frånvaro',
        kind: 'propose',
        param: 'person',
        path: {
          asks: [],
          effect: false,
          description:
            'Förbereder en sjukanmälan för en medarbetare i chefens enhet, från i dag och en dag, som chefen läser och beslutar om på ett kort.',
        },
      },
    ]);
    const { threadId } = (await w.actions.start(hillevi, 'person', 'maria', 'hr.prepareAbsence'))!;
    const card = (await w.access.read(hillevi, threadId))!;
    expect(card).toMatchObject({
      connector: 'hr',
      area: 'employees',
      title: 'Sjukanmälan att registrera',
      trigger: { reason: 'Du valde Registrera frånvaro för Maria Öst', source: 'Personalsystemet' },
      items: [{ ref: 'hr:emp:1003', label: 'Maria Källström', subject: { entity: 'person', key: 'maria' } }],
    });
    // The decision hands the HR system's own write, with the payload the card showed, to the ledger; nothing is registered yet.
    await w.decisions.act(hillevi, threadId, 'report');
    expect(w.approvals).toEqual([
      expect.objectContaining({
        operation: 'hr.reportAbsence',
        payload: { person: 'hr:emp:1003', from: '2026-11-10', to: '2026-11-10', extent: 100 },
      }),
    ]);
    expect(w.fixtures.states.hr!.get('reported-absences', {})).toEqual({});
    // Erik reported sick this morning: the HR system says so in its own words, and there is no card.
    await expect(w.actions.start(hillevi, 'person', 'erik', 'hr.prepareAbsence')).rejects.toThrow(
      'Erik Sandström är redan frånvarande 10 nov.',
    );
    expect(w.store.dump()).toHaveLength(1);
  });
});

describe('the route', () => {
  function stack() {
    const w = world();
    const routes = entityRoutes({
      // The reads are `entities-routes.test.ts`'s; this stack only starts actions.
      entities: {} as EntityRouteDeps['entities'],
      actions: w.actions,
      guard: async (c, next) => {
        c.set('session', { context: w.people.persona('hillevi') } as never);
        await next();
      },
    });
    const post = (path: string, body: string) =>
      routes.request('http://clew.test' + path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body,
      });
    return { ...w, post };
  }
  test('starts an action and answers the card to open; what the reader may not start is the one 404', async () => {
    const w = stack();
    const ok = await w.post('/person/maria/actions', JSON.stringify({ capability: 'hr.prepare' }));
    expect(ok.status).toBe(200);
    const { threadId } = (await ok.json()) as { threadId: string };
    expect(w.store.dump().map(r => r.thread.id)).toEqual([threadId]);
    for (const [path, capability] of [
      ['/person/nobody/actions', 'hr.prepare'],
      ['/person/maria/actions', 'units.plan'],
      ['/room/maria/actions', 'hr.prepare'],
    ]) {
      const answer = await w.post(path!, JSON.stringify({ capability }));
      expect([path, capability, answer.status]).toEqual([path, capability, 404]);
      expect(await answer.json()).toEqual({ error: 'Okänd adress.' });
    }
    expect(w.store.dump()).toHaveLength(1);
  });
  test('a body that is not { capability } is a bad request, and a refusal from the source is its own Swedish words', async () => {
    const w = stack();
    for (const body of ['', 'nej', '[]', '{}', '{"capability":"Hr x"}', '{"capability":"hr.prepare","person":"anna"}'])
      expect([body, (await w.post('/person/maria/actions', body)).status]).toEqual([body, 400]);
    const refused = await w.post('/person/karin/actions', JSON.stringify({ capability: 'hr.prepare' }));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'Medarbetaren finns inte i din enhet.' });
    w.nothingWritten();
  });
});
