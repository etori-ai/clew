import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, Subject, ThreadAction, ThreadItem } from '../../packages/contracts/src/index';
import { actorOf, type Capability, type Connector, type ThreadDraft } from '../../packages/connectors/src/index';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { staffUsecases } from '../../apps/server/src/modules/people/usecases';
import { entityUsecases } from '../../apps/server/src/modules/entities/usecases';
import { memoryThreadStore } from '../../apps/server/src/threads/adapters/memory';
import { threadUsecases } from '../../apps/server/src/threads/usecases/cards';
import { SUBJECT_ERASED, subjectCards, subjectErasure } from '../../apps/server/src/threads/usecases/subjects';
import type { ThreadStore } from '../../apps/server/src/threads/model';

/**
 * "Behöver dig" on a person and "Just nu" on the list (D97 items 5 and 6) as the person meets them: a source's scan pushes
 * cards whose rows name people, through the real registry and the stream's own use cases on the memory store, and the
 * entities use cases read them back through the index from entity to cards, wired as composition wires them. Whose cards
 * show, which leave, who may be asked about at all, and erasing a person's key.
 */
const T0 = '2026-11-10T07:00:00.000Z';
type Person = { id: string; name: string; userName: string | null; enabled?: boolean; organisationId?: string };

/** The synthetic directory: Hillevi manages the school, Petra the economy unit, Hassan is an employee elsewhere. */
function directory() {
  const store = memoryProvisionStore(),
    s = store.state;
  const person = (p: Person, unitId: string, role: 'manager' | 'employee') => {
    s.users.set(p.id, {
      id: p.id,
      organisationId: p.organisationId ?? 'poc',
      externalId: 'dev:' + p.id,
      userName: p.userName,
      name: p.name,
      email: null,
      title: null,
      enabled: p.enabled ?? true,
      createdAt: T0,
      updatedAt: T0,
    });
    s.assignments.set(p.id, [...(s.assignments.get(p.id) ?? []), { unitId, role }]);
    s.grants.set(p.id, { unitId, unitLabel: s.units.get(unitId)!.label, role, capabilities: [] });
  };
  s.units.set('unit-skola', { organisationId: 'poc', label: 'Bergsåkers skola' });
  s.units.set('unit-ekonomi', { organisationId: 'poc', label: 'Ekonomiavdelningen' });
  s.units.set('unit-omsorg', { organisationId: 'poc', label: 'Hemtjänsten' });
  s.units.set('unit-annan', { organisationId: 'other', label: 'Annan kommun' });
  person({ id: 'hillevi', name: 'Hillevi Berg', userName: 'hillevi' }, 'unit-skola', 'manager');
  person({ id: 'anna', name: 'Anna Lindqvist', userName: 'anna' }, 'unit-skola', 'employee');
  person({ id: 'erik', name: 'Erik Sund', userName: 'Erik.S' }, 'unit-skola', 'employee');
  person({ id: 'maria', name: 'Maria Öst', userName: 'maria' }, 'unit-skola', 'employee');
  person({ id: 'bo', name: 'Bo Ärlig', userName: 'bo', enabled: false }, 'unit-skola', 'employee');
  person({ id: 'petra', name: 'Petra Nyström', userName: 'petra' }, 'unit-ekonomi', 'manager');
  person({ id: 'karin', name: 'Karin Åberg', userName: 'karin' }, 'unit-ekonomi', 'employee');
  person({ id: 'hassan', name: 'Hassan Ali', userName: 'hassan' }, 'unit-omsorg', 'employee');
  person(
    { id: 'stranger', name: 'Annan Person', userName: 'stranger', organisationId: 'other' },
    'unit-annan',
    'employee',
  );
  const staff = staffUsecases({ store });
  const persona = (id: string): AuthenticatedContext => {
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
      authorizationVersion: 'v1',
      sessionBinding: 'test',
      expiresAt: '2099-01-01T00:00:00.000Z',
      async authorize() {
        return { version: 'v1' };
      },
    };
  };
  return { staff, persona };
}

const person = (key: string): Subject => ({ entity: 'person', key });
const row = (ref: string, label: string, subject?: Subject): ThreadItem => ({
  ref,
  label,
  detail: '',
  selectable: false,
  selected: false,
  ...(subject ? { subject } : {}),
});
const action = (capability: string, kind: ThreadAction['kind']): ThreadAction => ({
  id: kind,
  label: kind === 'execute' ? 'Godkänn' : 'Visa förslag',
  capability,
  kind,
  role: 'primary',
});
const draft = (topic: string, title: string, items: ThreadItem[], more: Partial<ThreadDraft> = {}): ThreadDraft => ({
  topic,
  area: 'personal',
  title,
  summary: title + '.',
  reason: 'Personalsystemet säger så',
  items,
  actions: [],
  ...more,
});
/** What the HR system pushes each person: a sick note to approve (a requirement), a proposal, a notice. */
const SCANS: Record<string, ThreadDraft[]> = {
  hillevi: [
    draft('sick', 'Sjukanmälan att godkänna', [row('sick:1', 'Erik Sund sjuk 10–11 nov', person('erik.s'))], {
      actions: [action('personal.approve', 'execute')],
      deadline: '2026-11-11',
    }),
    draft('book', 'Boka utvecklingssamtal', [row('book:1', 'Maria Öst saknar samtal', person('maria'))], {
      actions: [action('personal.book', 'propose')],
    }),
    draft('note', 'Anna tackade ja', [row('note:1', 'Anna Lindqvist tackade ja', person('anna'))]),
    // People the reader may or may not ask about, on one card: a colleague, someone deactivated, another organisation.
    draft(
      'others',
      'Intyg som går ut',
      [
        row('cert:1', 'Karin Åberg', person('karin')),
        row('cert:2', 'Bo Ärlig', person('bo')),
        row('cert:3', 'Annan Person', person('stranger')),
      ],
      { actions: [action('personal.approve', 'execute')], deadline: '2026-11-20' },
    ),
  ],
  petra: [
    draft('anna-petra', 'Anna i ekonomigruppen', [row('p:1', 'Anna Lindqvist', person('anna'))], {
      actions: [action('personal.approve', 'execute')],
      deadline: '2026-11-12',
    }),
  ],
};
const capability = (name: string, kind: Capability['kind']): Capability => ({
  name,
  kind,
  title: name,
  description: 'x',
  model: false,
  input: { type: 'object' } as never,
  output: { type: 'object' } as never,
  scope: {},
  run: async () => ({}),
});

function world() {
  const people = directory();
  const registry = new Registry();
  const hr: Connector = {
    id: 'personal',
    kind: 'passthrough',
    source: 'Personalsystemet',
    areas: [],
    capabilities: [capability('personal.approve', 'execute'), capability('personal.book', 'propose')],
    scan: async actor => SCANS[actor.id] ?? [],
  };
  registry.register(hr);
  // The talks module's own cards are core (D96): its action point card names the employee on the thread, not a row.
  registry.register({ id: 'talks', kind: 'core', source: 'Utvecklingssamtal', areas: [], capabilities: [] });
  const store = memoryThreadStore();
  let now = Date.parse(T0),
    n = 0;
  const clock = () => new Date(now);
  const threads = threadUsecases({
    store,
    registry,
    run: (p, name, input) => registry.run(actorOf(p), name, input),
    calendar: {
      ensureProposalThread: async () => undefined,
      replan: async (_p, id) => (await store.readThreadById(id))!,
      dismiss: async (_p, id) => (await store.readThreadById(id))!,
      todayEvents: async () => [],
    },
    clock,
    ids: () => `thread-${++n}`,
  });
  const cardsAbout = subjectCards({ store, registry, clock });
  const entities = entityUsecases({
    directory: { reach: p => people.staff.reach(p), colleague: (p, key) => people.staff.colleague(p, key) },
    sources: { reads: async () => [], actions: async () => [] },
    read: async () => ({}),
    // As composition wires them: the thread store's index from entity to cards.
    cards: async (p, subject) => (await cardsAbout.cardsNaming(p, [subject])).map(({ subjects: _, ...card }) => card),
    cardsNaming: (p, subjects) => cardsAbout.cardsNaming(p, subjects),
  });
  const erasure = subjectErasure({ store, clock });
  /** The thread a person's scan pushed on a topic. */
  const card = async (who: string, topic: string) => (await store.openThread(who, topic))!.id;
  return {
    people,
    store,
    threads,
    entities,
    erasure,
    card,
    advance: (ms: number) => void (now += ms),
    scan: async (...who: string[]) => {
      for (const id of who) await threads.ensureThreads(people.persona(id));
    },
  };
}

describe('the cards about a person', () => {
  test('a card whose row names a person shows under "Behöver dig" on that person and counts under "Just nu" on the list', async () => {
    const w = world();
    await w.scan('hillevi');
    const hillevi = w.people.persona('hillevi');
    const [sick, book, note] = [
      await w.card('hillevi', 'sick'),
      await w.card('hillevi', 'book'),
      await w.card('hillevi', 'note'),
    ];
    // The key without regard to case, as the directory spells it and as the source did not.
    expect((await w.entities.detail(hillevi, 'person', 'erik.s'))?.cards).toEqual([
      { threadId: sick, title: 'Sjukanmälan att godkänna', source: 'Personalsystemet', kind: 'act' },
    ]);
    expect((await w.entities.detail(hillevi, 'person', 'maria'))?.cards).toEqual([
      { threadId: book, title: 'Boka utvecklingssamtal', source: 'Personalsystemet', kind: 'proposal' },
    ]);
    expect((await w.entities.detail(hillevi, 'person', 'anna'))?.cards).toEqual([
      { threadId: note, title: 'Anna tackade ja', source: 'Personalsystemet', kind: 'fyi' },
    ]);
    // In the list's order and spelling, each with its one card; a notice counts for nothing, so Anna is absent.
    expect((await w.entities.list(hillevi, 'person')).attention).toEqual([
      { key: 'Erik.S', act: 1, proposals: 0, threadId: sick },
      { key: 'maria', act: 0, proposals: 1, threadId: book },
    ]);
  });
  test('several cards about one person are counted, and none is named then', async () => {
    const w = world();
    await w.scan('hillevi');
    const hillevi = w.people.persona('hillevi');
    await w.store.transaction(tx =>
      tx.insertThread({
        id: 'second',
        personId: 'hillevi',
        sourceAuthorization: 'v1',
        kind: 'pushed',
        topic: 'second',
        title: 'Rapportera tid',
        state: 'open',
        week: null,
        connector: 'personal',
        area: 'personal',
        summary: '',
        items: [row('t:1', 'Erik Sund', person('ERIK.S'))],
        actions: [action('personal.approve', 'execute')],
        waitingOn: null,
        deadline: '2026-11-30',
        trigger: { reason: 'x', source: 'Personalsystemet', at: T0 },
        createdAt: T0,
        updatedAt: T0,
      }),
    );
    const sick = await w.card('hillevi', 'sick');
    expect((await w.entities.list(hillevi, 'person')).attention[0]).toEqual({ key: 'Erik.S', act: 2, proposals: 0 });
    expect((await w.entities.detail(hillevi, 'person', 'Erik.S'))?.cards.map(c => c.threadId)).toEqual([
      sick,
      'second',
    ]);
  });
  test("another reader's card about the same person never shows", async () => {
    const w = world();
    await w.scan('hillevi', 'petra');
    const petrasCard = await w.card('petra', 'anna-petra');
    const hillevi = w.people.persona('hillevi'),
      petra = w.people.persona('petra');
    expect((await w.entities.detail(hillevi, 'person', 'anna'))?.cards.map(c => c.threadId)).not.toContain(petrasCard);
    // Anna is Petra's colleague: Petra sees her own card on Anna, and none of Hillevi's.
    expect(await w.entities.detail(petra, 'person', 'anna')).toMatchObject({
      relation: 'colleague',
      cards: [{ threadId: petrasCard, kind: 'act' }],
    });
    // Anna is not on Petra's list, so "Just nu" has nothing for her there.
    expect((await w.entities.list(petra, 'person')).attention).toEqual([]);
  });
  test('a decided card leaves, and so does one set aside or waiting on someone else', async () => {
    const w = world();
    await w.scan('hillevi');
    const hillevi = w.people.persona('hillevi');
    const [sick, book] = [await w.card('hillevi', 'sick'), await w.card('hillevi', 'book')];
    await w.threads.dismissThread(hillevi, sick);
    await w.threads.snoozeThread(hillevi, book, { until: '2026-11-10T12:00:00.000Z' });
    expect((await w.entities.detail(hillevi, 'person', 'Erik.S'))?.cards).toEqual([]);
    expect((await w.entities.detail(hillevi, 'person', 'maria'))?.cards).toEqual([]);
    expect((await w.entities.list(hillevi, 'person')).attention).toEqual([]);
    // Back from Inte nu, it asks again.
    w.advance(6 * 3600_000);
    expect((await w.entities.list(hillevi, 'person')).attention).toEqual([
      { key: 'maria', act: 0, proposals: 1, threadId: book },
    ]);
    await w.store.transaction(tx => tx.updateThread(book, { waitingOn: 'Maria' }));
    expect((await w.entities.detail(hillevi, 'person', 'maria'))?.cards).toEqual([]);
  });
  test('a person the reader may not ask about is never answered for, whatever a card names', async () => {
    const w = world();
    await w.scan('hillevi');
    const hillevi = w.people.persona('hillevi');
    const others = await w.card('hillevi', 'others');
    // Deactivated, and in another organisation: as if they did not exist.
    expect(await w.entities.detail(hillevi, 'person', 'bo')).toBeUndefined();
    expect(await w.entities.detail(hillevi, 'person', 'stranger')).toBeUndefined();
    // A colleague may be opened, and the reader's own card about her shows there; she is not on the reader's list.
    expect((await w.entities.detail(hillevi, 'person', 'karin'))?.cards.map(c => c.threadId)).toEqual([others]);
    const keys = (await w.entities.list(hillevi, 'person')).attention.map(a => a.key);
    expect(keys).toEqual(['Erik.S', 'maria']);
    // An employee has no list, so nothing is counted.
    expect((await w.entities.list(w.people.persona('hassan'), 'person')).attention).toEqual([]);
  });
  test("an action point's card names the employee on the thread, never on a row, and shows on them (D96 item 6)", async () => {
    const w = world();
    const hillevi = w.people.persona('hillevi');
    await w.store.transaction(tx =>
      tx.insertThread({
        id: 'action-point',
        personId: 'hillevi',
        kind: 'pushed',
        topic: 'talks:commitment:1',
        title: 'Åtgärdspunkt från utvecklingssamtal',
        state: 'open',
        week: null,
        connector: 'talks',
        area: 'talks',
        summary: 'En åtgärdspunkt ska vara klar senast 3 november.',
        items: [],
        subjects: [person('anna')],
        actions: [
          {
            id: 'commitments',
            label: 'Visa åtgärdspunkter',
            capability: 'talks.commitments',
            kind: 'read',
            role: 'primary',
            target: 'panel',
          },
        ],
        waitingOn: null,
        deadline: '2026-11-03',
        trigger: { reason: 'Lades till efter ditt utvecklingssamtal', source: 'Utvecklingssamtal', at: T0 },
        createdAt: T0,
        updatedAt: T0,
      }),
    );
    expect((await w.entities.detail(hillevi, 'person', 'anna'))?.cards).toEqual([
      {
        threadId: 'action-point',
        title: 'Åtgärdspunkt från utvecklingssamtal',
        source: 'Utvecklingssamtal',
        kind: 'act',
      },
    ]);
    expect((await w.entities.list(hillevi, 'person')).attention).toEqual([
      { key: 'anna', act: 1, proposals: 0, threadId: 'action-point' },
    ]);
  });
});

describe("erasing a person's key from the cards", () => {
  test('every row and thread loses the subject, the text stays, and one audit row counts what was touched without the key', async () => {
    const w = world();
    await w.scan('hillevi', 'petra');
    const hillevi = w.people.persona('hillevi');
    const sick = await w.card('hillevi', 'sick');
    const before = (await w.store.readThread('hillevi', sick))!;
    expect(await w.erasure.eraseSubject('operator:cli', person('ERIK.S'), 'person:erik')).toEqual({
      cards: 1,
      rows: 1,
      cardSubjects: 0,
    });
    const after = (await w.store.readThread('hillevi', sick))!;
    expect(after.items).toEqual([row('sick:1', 'Erik Sund sjuk 10–11 nov')]);
    expect(after.updatedAt).toBe(before.updatedAt);
    expect((await w.entities.detail(hillevi, 'person', 'Erik.S'))?.cards).toEqual([]);
    expect((await w.entities.list(hillevi, 'person')).attention.map(a => a.key)).toEqual(['maria']);
    const audit = w.store.audit.filter(e => e.action === SUBJECT_ERASED);
    expect(audit).toEqual([
      {
        actor: 'operator:cli',
        action: SUBJECT_ERASED,
        subject: 'person:erik',
        at: T0,
        details: { entity: 'person', cards: 1, rows: 1, cardSubjects: 0 },
      },
    ]);
    expect(JSON.stringify(audit).toLowerCase()).not.toContain('erik.s');
  });
  test('a failure after the audit row leaves every subject and no audit row behind', async () => {
    const w = world();
    await w.scan('hillevi', 'petra');
    const failing: Pick<ThreadStore, 'transaction'> = {
      transaction: fn =>
        w.store.transaction(async tx => {
          await fn(tx);
          throw new Error('after the audit row');
        }),
    };
    const erasure = subjectErasure({ store: failing, clock: () => new Date(T0) });
    await expect(erasure.eraseSubject('operator:cli', person('anna'), 'person:anna')).rejects.toThrow(
      'after the audit row',
    );
    expect(w.store.audit.filter(e => e.action === SUBJECT_ERASED)).toEqual([]);
    expect(
      (await w.store.threadsNaming('petra', [person('anna')])).map(n => n.thread.items.map(i => i.subject)),
    ).toEqual([[person('anna')]]);
    expect((await w.entities.detail(w.people.persona('hillevi'), 'person', 'anna'))?.cards).toHaveLength(1);
  });
});
