import { describe, expect, test } from 'bun:test';
import { SUBJECT_CHANGED, type AuthenticatedContext } from '../../packages/contracts/src/index';
import {
  audiencedActorOf,
  CapabilityError,
  openGovernance,
  Registry,
  type Capability,
  type Connector,
} from '../../packages/connectors/src/index';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { personErasureUsecases, staffUsecases } from '../../apps/server/src/modules/people/usecases';
import { entityUsecases } from '../../apps/server/src/modules/entities/usecases';
import { entityActionUsecases } from '../../apps/server/src/modules/entities/actions';
import { relationUsecases } from '../../apps/server/src/modules/entities/relations';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { startedCards } from '../../apps/server/src/threads/usecases/started';
import { cardDecisions } from '../../apps/server/src/threads/usecases/decisions';
import { subjectErasure } from '../../apps/server/src/threads/usecases/subjects';
import { threadAccess } from '../../apps/server/src/threads/access';
import { entityRoutes, type EntityRouteDeps } from '../../apps/server/src/routes/entities';
import { InputError } from '../../apps/server/src/context';
import { fixtureConnectors } from '../fixture-connectors';
import { memoryPersonKeys } from '../person-keys';
import { startedDecision, startedTopic, takesStarted } from '../../apps/server/src/threads/domain';

/**
 * An action about a person, started from the person's menu without the model (D97, D8): the real registry with small
 * in-test sources, the people module's directory on its memory store, the entities use cases, and the stream's started
 * card on the memory thread store, wired as the composition wires them. A propose's draft becomes the card; an execute
 * becomes a card whose button is the human decision and reaches nothing before it; whatever the reader may not reach
 * answers undefined (the route's 404) and writes nothing. A person is started on by their id and the source is asked by
 * their user name (D122); in the in-test world the two differ, as they do in an installation.
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
  return { staff: staffUsecases({ store }), persona, state: s, store };
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
  const asked = {
    prepare: [] as unknown[],
    report: [] as unknown[],
    flag: [] as unknown[],
    order: [] as unknown[],
    orderEffect: [] as unknown[],
  };
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
  /** An order for a person in a service desk (D112, D123): asks what and an optional message, and says beforehand what it does. */
  const orderInput = {
    type: 'object',
    properties: {
      person: { type: 'string' },
      what: { type: 'string', enum: ['laptop', 'phone'] },
      note: { type: 'string', maxLength: 40 },
    },
    required: ['person', 'what'],
    additionalProperties: false,
  } as never;
  const order: Capability = {
    name: 'it.order',
    kind: 'execute',
    title: 'Beställ',
    description: 'Lägger en beställning i IT-servicedesken.',
    model: false,
    about: { entity: 'person', param: 'person' },
    input: orderInput,
    output: anything,
    scope: { roles: ['manager'] },
    asks: [
      {
        kind: 'choice',
        property: 'what',
        label: 'Vad',
        required: true,
        options: [
          { value: 'laptop', label: 'Bärbar dator' },
          { value: 'phone', label: 'Mobiltelefon' },
        ],
      },
      { kind: 'text', property: 'note', label: 'Meddelande', required: false },
    ],
    effect: 'it.orderEffect',
    run: async (_actor, input) => {
      asked.order.push(input);
      return { headline: 'Beställt.', rows: [] };
    },
  };
  const orderEffect: Capability = {
    name: 'it.orderEffect',
    kind: 'read',
    title: 'Det här händer när beställningen läggs',
    description: 'Vad beställningen gör, utan att något skrivs.',
    model: false,
    input: orderInput,
    output: anything,
    scope: { roles: ['manager'] },
    run: async (_actor, raw) => {
      const input = raw as { person: string; what: string };
      asked.orderEffect.push(input);
      return { rows: [{ label: `En beställning läggs för ${input.person}`, detail: input.what }] };
    },
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
  const desk: Connector = {
    id: 'it',
    kind: 'passthrough',
    source: 'IT-servicedesken',
    areas: [],
    capabilities: [order, orderEffect],
  };
  return { asked, connectors, desk };
}

/**
 * The world as the composition wires it; with `fixture`, the HR system is the development stack's own (D61); with
 * `desk`, a service desk whose order asks and says what it does; with `auditDown`, a store whose audit cannot be written.
 */
function world(options: { fixture?: boolean; desk?: boolean; auditDown?: boolean } = {}) {
  // The development stack's HR system knows the seed's user names; the in-test one knows its own.
  const people = directory(options.fixture ? {} : { maria: 'maria.o', anna: 'anna.l' });
  const keys = memoryPersonKeys(people.state);
  const { asked, connectors: inTest, desk } = sources();
  const fixtures = fixtureConnectors({ only: ['hr'], clock: () => new Date(T) });
  const connectors = options.fixture ? fixtures.connectors : options.desk ? [...inTest, desk] : inTest;
  // Who may be asked about (D117) as the composition installs it: the entities module's rule over the same directory.
  const relations = relationUsecases({
    directory: people.staff,
    reader: async actor => people.persona(actor.id),
    holders: keys.holders,
  });
  const registry = new Registry({ relations: relations.relate });
  for (const c of connectors) registry.register(c).govern(c.id, openGovernance());
  const store = memoryThreadStore();
  // The same store, whose transactions fail at the audit row: what was written before it in the transaction is undone.
  const writes: typeof store = options.auditDown
    ? Object.assign(Object.create(store) as typeof store, {
        transaction: (fn =>
          store.transaction(tx =>
            fn({
              ...tx,
              writeAudit: async () => {
                throw new Error('audit unavailable');
              },
            }),
          )) as typeof store.transaction,
      })
    : store;
  let n = 0;
  // The server's `runCapability`: the registry's call path as the person, a source's refusal as a Swedish input error.
  const run = async (persona: AuthenticatedContext, name: string, input: unknown) => {
    try {
      return await registry.run(audiencedActorOf(persona), name, input);
    } catch (error) {
      throw error instanceof CapabilityError ? new InputError(error.message) : error;
    }
  };
  const started = startedCards({
    store: writes,
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
      registry.clewFor(audiencedActorOf(persona), { signal }).call(capability, input),
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
    // As the composition wires it: the card's one button, the human decision (D45).
    decide: (p, threadId, answers) => decisions.act(p, threadId, 'decide', undefined, undefined, answers),
    effect: decisions.effectFor,
    clock: () => new Date(T),
  });
  const nothingWritten = () => {
    expect(store.dump()).toEqual([]);
    expect(store.audit).toEqual([]);
    expect(approvals).toEqual([]);
    expect(asked.report).toEqual([]);
    expect(asked.flag).toEqual([]);
    expect(asked.order).toEqual([]);
  };
  return {
    people,
    registry,
    store,
    entities,
    actions,
    started,
    access,
    decisions,
    approvals,
    asked,
    fixtures,
    nothingWritten,
  };
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
    // The card keeps the person by id (D122): a rename before the decision leaves it as it is.
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
    // that dispatch can check the name is still hers (D122).
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

  test('a decision whose dispatch was refused because the user name moved is decided again, on the name the person has now (D122)', async () => {
    const w = world();
    const hillevi = w.people.persona('hillevi');
    const { threadId } = (await w.actions.start(hillevi, 'person', 'anna', 'hr.flag'))!;
    await w.decisions.act(hillevi, threadId, 'decide');
    const first = w.approvals[0] as { decisionId: string };
    // Dispatch found 'anna.l' no longer Anna's and failed the execution without sending it (D122); the card shows that.
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
    // Any other failure is decided again the same way (DE-M1): asked under the first id, the ledger would answer with
    // the execution it already has, and nothing would reach the source.
    await settled('approval-expired', '2026-11-12T08:10:00.000Z');
    await w.decisions.act(hillevi, threadId, 'decide');
    const third = (w.approvals[2] as { decisionId: string }).decisionId;
    expect([first.decisionId, again.decisionId]).not.toContain(third);
    expect(w.asked.flag).toEqual([]);
  });

  test('an execute about someone no longer in the directory cannot be decided, and nothing is approved (D122)', async () => {
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

  test('an execute about someone an operator has since erased cannot be decided, and nothing is approved (D122, D123)', async () => {
    const w = world();
    const hillevi = w.people.persona('hillevi');
    const { threadId } = (await w.actions.start(hillevi, 'person', 'anna', 'hr.flag'))!;
    // The source deactivates Anna; the runbook erases her from every card first and her record last. The card's rows
    // and subjects no longer name her, but its action keeps her id, so the card itself can still be decided.
    w.people.state.users.get('anna')!.enabled = false;
    const clock = () => new Date(T),
      operator = 'operator:cli';
    const cards = subjectErasure({ store: w.store, clock, people: memoryPersonKeys(w.people.state) });
    expect(await cards.eraseSubject(operator, { entity: 'person', key: 'anna' })).toMatchObject({ cards: 1, rows: 1 });
    const record = personErasureUsecases({ store: w.people.store, clock });
    expect(await record.erasePerson(operator, 'anna')).toMatchObject({ erased: { fields: 3 } });
    // Her record holds no user name: neither her id nor the name she had resolves to anyone, so no name can be sent.
    const keys = memoryPersonKeys(w.people.state);
    expect(await keys.userName('anna')).toBeNull();
    expect(await keys.holders('hillevi', ['anna', 'anna.l'])).toEqual(new Map());
    const audited = structuredClone(w.store.audit),
      gone = 'Personen finns inte längre i katalogen. Inget har skickats.';
    await expect(w.decisions.act(hillevi, threadId, 'decide')).rejects.toThrow(gone);
    await expect(w.decisions.effect(hillevi, threadId, 'decide')).rejects.toThrow(gone);
    // Nothing reached the ledger, so there is no execution and no approval row, and the source was asked nothing.
    expect(w.approvals).toEqual([]);
    expect(w.store.audit).toEqual(audited);
    expect(w.asked.flag).toEqual([]);
  });

  test('an execute whose capability no longer takes the person where the card keeps them cannot be decided, and nothing is approved (D122)', async () => {
    const w = world();
    const hillevi = w.people.persona('hillevi');
    const { threadId } = (await w.actions.start(hillevi, 'person', 'anna', 'hr.flag'))!;
    // The card says which property of its input keeps the person: the capability's declaration as the card was made.
    const card = (await w.access.read(hillevi, threadId))!;
    expect(card.topic).toMatch(/^started:hr\.flag:.+:person:person$/);
    const declared = w.registry.connector('hr')!;
    const redeclare = (change: (flag: Capability) => Capability) =>
      w.registry.replace({
        ...declared,
        capabilities: declared.capabilities.map(c => (c.name === 'hr.flag' ? change(c) : c)),
      });
    const changed = 'Åtgärden har ändrats sedan ärendet skapades. Inget har skickats.';
    // No longer about a person: the card's id would reach the source as if it were a user name.
    redeclare(({ about: _, ...flag }) => flag);
    await expect(w.decisions.act(hillevi, threadId, 'decide')).rejects.toThrow(changed);
    // What it would do is not asked either: the same input would be the wrong one.
    await expect(w.decisions.effect(hillevi, threadId, 'decide')).rejects.toThrow(changed);
    // About a person, in another property of its input.
    redeclare(flag => ({
      ...flag,
      about: { entity: 'person', param: 'employee' },
      input: {
        type: 'object',
        properties: { employee: { type: 'string' } },
        required: ['employee'],
        additionalProperties: false,
      } as never,
    }));
    await expect(w.decisions.act(hillevi, threadId, 'decide')).rejects.toThrow(changed);
    // About a unit, in the same property: the card's person id would be sent as a unit's.
    redeclare(flag => ({ ...flag, about: { entity: 'unit', param: 'person' } }));
    await expect(w.decisions.act(hillevi, threadId, 'decide')).rejects.toThrow(changed);
    expect(w.approvals).toEqual([]);
    expect(w.asked.flag).toEqual([]);
    // Declared as the card was made, the decision goes through on the user name Anna has.
    w.registry.replace(declared);
    await w.decisions.act(hillevi, threadId, 'decide');
    expect(w.approvals).toEqual([
      expect.objectContaining({ payload: { person: 'anna.l' }, subject: { param: 'person', personId: 'anna' } }),
    ]);
  });

  test("a started card's topic says where its person is, and only a started execute's decision reads it (D122)", () => {
    const decide = { id: 'decide', kind: 'execute' as const, capability: 'hr.flag', input: { person: 'anna' } };
    const topic = startedTopic('hr.flag', 'abc', 'person');
    expect(topic).toBe('started:hr.flag:abc:person:person');
    expect(startedDecision(topic, decide)).toEqual({ person: { param: 'person', personId: 'anna' } });
    // An id the card does not hold in that property is no id: the directory finds nobody, and nothing is sent.
    expect(startedDecision(topic, { ...decide, input: {} })).toEqual({ person: { param: 'person', personId: '' } });
    // About a unit, or about nobody: the topic names no property, and there is nobody to resolve.
    expect(startedDecision(startedTopic('units.close', 'abc'), { ...decide, capability: 'units.close' })).toEqual({});
    // Another card, another action on a started card, another capability's topic and a propose are not started decisions.
    expect(startedDecision('hr:absence-draft:1', decide)).toBeUndefined();
    expect(startedDecision(topic, { ...decide, id: 'report' })).toBeUndefined();
    expect(startedDecision(startedTopic('hr.flagged', 'abc', 'person'), decide)).toBeUndefined();
    expect(startedDecision(topic, { ...decide, kind: 'propose' })).toBeUndefined();
    // The capability as declared now must take the person where the card keeps them, and a card about no person
    // must stay about none.
    const person = { person: { param: 'person' } };
    expect(takesStarted(person, { entity: 'person', param: 'person' })).toBe(true);
    expect(takesStarted(person, { entity: 'person', param: 'employee' })).toBe(false);
    expect(takesStarted(person, { entity: 'unit', param: 'person' })).toBe(false);
    expect(takesStarted(person, undefined)).toBe(false);
    expect(takesStarted({}, { entity: 'unit', param: 'unit' })).toBe(true);
    expect(takesStarted({}, undefined)).toBe(true);
    expect(takesStarted({}, { entity: 'person', param: 'person' })).toBe(false);
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
    // A rename leaves the request as it was: the card names Anna by id (D122), so it is the same card.
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
    // Erik reports to the reader, but the HR system does not know him: it says so in Swedish.
    await expect(w.actions.start(hillevi, 'person', 'erik', 'hr.prepare')).rejects.toThrow(
      'Medarbetaren finns inte i din enhet.',
    );
    // Karin is a colleague the reader may open, but the action admits only the reader and their reports (D117): her
    // page does not offer it, starting it anyway is what the reader may not reach, and the source never hears her name.
    expect((await w.entities.detail(hillevi, 'person', 'karin'))?.actions).toEqual([]);
    expect(await w.actions.start(hillevi, 'person', 'karin', 'hr.prepare')).toBeUndefined();
    // Past the menu, the registry refuses the write itself before it is a card (D117).
    await expect(w.started.startCard(hillevi, 'hr.prepare', { person: 'karin' }, { reason: 'x' })).rejects.toThrow(
      'Okänd förmåga.',
    );
    expect(w.asked.prepare).toEqual([{ person: 'erik' }]);
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

describe('an execute sent from its dialog: nothing exists before the last button (D126 item 7)', () => {
  test('the dialog reads what would happen, and cancelling it leaves no work item, no audit row and nothing approved', async () => {
    const w = world({ desk: true });
    const hillevi = w.people.persona('hillevi');
    // "Det här händer" for exactly the answers on the step: the source's effect read, asked by the user name.
    expect(await w.actions.effect(hillevi, 'person', 'anna', 'it.order', { what: 'laptop' })).toEqual({
      rows: [{ label: 'En beställning läggs för anna.l', detail: 'laptop' }],
      source: 'IT-servicedesken',
    });
    expect(w.asked.orderEffect).toEqual([{ person: 'anna.l', what: 'laptop' }]);
    // The person presses Avbryt: the dialog sent nothing else, so nothing is left behind.
    w.nothingWritten();
  });

  test('the last button makes the work item and decides it with the answers, the card and its audit row in one transaction', async () => {
    const w = world({ desk: true });
    const hillevi = w.people.persona('hillevi');
    const { threadId } = (await w.actions.decide(hillevi, 'person', 'anna', 'it.order', {
      what: 'laptop',
      note: ' Före måndag ',
    }))!;
    const card = (await w.access.read(hillevi, threadId))!;
    // The card keeps the person by id and nothing of the answers (D122, D45: approved input is sealed, the card is not).
    expect(card).toMatchObject({
      connector: 'it',
      title: 'Beställ',
      trigger: { reason: 'Du valde Beställ för Anna Lindqvist', source: 'IT-servicedesken' },
      actions: [{ id: 'decide', capability: 'it.order', kind: 'execute', input: { person: 'anna' } }],
    });
    // (Its topic tells it from another order by a digest of them; this world's digest is the JSON itself.)
    const { topic: _topic, ...kept } = card;
    expect(JSON.stringify(kept)).not.toContain('Före måndag');
    expect(w.store.audit.map(a => [a.action, a.subject, a.details?.kind, a.details?.about, a.details?.asked])).toEqual([
      ['thread.started', 'thread:' + threadId, 'execute', { entity: 'person', id: 'anna' }, undefined],
    ]);
    // The decision hands the approved intent with the answers to the ledger (D45), still without reaching the source.
    expect(w.approvals).toEqual([
      expect.objectContaining({
        operation: 'it.order',
        payload: { person: 'anna.l', what: 'laptop', note: 'Före måndag' },
        asked: { what: 'laptop', note: 'Före måndag' },
        presentation: expect.objectContaining({ threadId, actionId: 'decide' }),
        subject: { param: 'person', personId: 'anna' },
      }),
    ]);
    expect(w.asked.order).toEqual([]);
    // The same order sent twice is the one card and the one decision; another order is another card.
    const again = (await w.actions.decide(hillevi, 'person', 'anna', 'it.order', {
      what: 'laptop',
      note: 'Före måndag',
    }))!;
    expect(again.threadId).toBe(threadId);
    const ids = (w.approvals as Array<{ decisionId: string }>).map(a => a.decisionId);
    expect(new Set(ids).size).toBe(1);
    const other = (await w.actions.decide(hillevi, 'person', 'anna', 'it.order', { what: 'phone' }))!;
    expect(other.threadId).not.toBe(threadId);
    expect(w.store.dump()).toHaveLength(2);
  });

  test('the card and its audit row are one transaction: an audit that cannot be written leaves no card and decides nothing', async () => {
    const w = world({ desk: true, auditDown: true });
    await expect(
      w.actions.decide(w.people.persona('hillevi'), 'person', 'anna', 'it.order', { what: 'laptop' }),
    ).rejects.toThrow('audit unavailable');
    w.nothingWritten();
  });

  test('an answer that does not fit is refused before anything is made; a propose and what is not offered are not decided here', async () => {
    const w = world({ desk: true });
    const hillevi = w.people.persona('hillevi');
    for (const [values, problem] of [
      [{}, 'Vad behöver fyllas i.'],
      [{ what: 'tablet' }, 'Vad: välj ett av alternativen.'],
      [{ what: 'laptop', colour: 'svart' }, 'Åtgärden frågar inte efter det värdet.'],
      // Checked with the input against the capability's schema before the card is made.
      [{ what: 'laptop', note: 'x'.repeat(41) }, undefined],
    ] as const) {
      const refused = w.actions.decide(hillevi, 'person', 'anna', 'it.order', values);
      await expect(refused).rejects.toBeInstanceOf(InputError);
      if (problem) await expect(refused).rejects.toThrow(problem);
    }
    await expect(w.actions.decide(hillevi, 'person', 'maria', 'hr.prepare')).rejects.toThrow(
      'Åtgärden kan inte beslutas härifrån.',
    );
    // A colleague the order does not admit, an unknown key and an action not about that kind: undefined, the route's 404.
    expect(await w.actions.decide(hillevi, 'person', 'karin', 'it.order', { what: 'laptop' })).toBeUndefined();
    expect(await w.actions.decide(hillevi, 'person', 'nobody', 'it.order', { what: 'laptop' })).toBeUndefined();
    expect(await w.actions.decide(hillevi, 'unit', 'unit-skola', 'it.order', { what: 'laptop' })).toBeUndefined();
    w.nothingWritten();
  });
});

describe('the route', () => {
  function stack(options: Parameters<typeof world>[0] = {}) {
    const w = world(options);
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
  test('an execute is sent from its dialog to /decide: the card and its decision, or the one 404, or the answer refused', async () => {
    const w = stack({ desk: true });
    const effect = await w.post(
      '/person/anna/effect',
      JSON.stringify({ capability: 'it.order', values: { what: 'phone' } }),
    );
    expect(effect.status).toBe(200);
    expect(w.store.dump()).toEqual([]);
    const sent = await w.post(
      '/person/anna/decide',
      JSON.stringify({ capability: 'it.order', values: { what: 'phone' } }),
    );
    expect(sent.status).toBe(200);
    const { threadId } = (await sent.json()) as { threadId: string };
    expect(w.store.dump().map(r => r.thread.id)).toEqual([threadId]);
    expect(w.approvals).toHaveLength(1);
    const missing = await w.post('/person/karin/decide', JSON.stringify({ capability: 'it.order', values: {} }));
    expect([missing.status, await missing.json()]).toEqual([404, { error: 'Okänd adress.' }]);
    const refused = await w.post('/person/anna/decide', JSON.stringify({ capability: 'it.order', values: {} }));
    expect([refused.status, await refused.json()]).toEqual([400, { error: 'Vad behöver fyllas i.' }]);
    const propose = await w.post('/person/maria/decide', JSON.stringify({ capability: 'hr.prepare' }));
    expect([propose.status, await propose.json()]).toEqual([400, { error: 'Åtgärden kan inte beslutas härifrån.' }]);
    expect(w.store.dump()).toHaveLength(1);
    expect(w.asked.order).toEqual([]);
  });
  test('a body that is not { capability } is a bad request, and a refusal from the source is its own Swedish words', async () => {
    const w = stack();
    for (const body of ['', 'nej', '[]', '{}', '{"capability":"Hr x"}', '{"capability":"hr.prepare","person":"anna"}'])
      expect([body, (await w.post('/person/maria/actions', body)).status]).toEqual([body, 400]);
    const refused = await w.post('/person/erik/actions', JSON.stringify({ capability: 'hr.prepare' }));
    expect(refused.status).toBe(400);
    expect(await refused.json()).toEqual({ error: 'Medarbetaren finns inte i din enhet.' });
    // A colleague outside what the action admits (D117): not offered on her, so the same 404 as anything not offered.
    const colleague = await w.post('/person/karin/actions', JSON.stringify({ capability: 'hr.prepare' }));
    expect(colleague.status).toBe(404);
    w.nothingWritten();
  });
});
