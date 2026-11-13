import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, EntityCard, Subject } from '../../packages/contracts/src/index';
import {
  actorOf,
  audiencedActorOf,
  openGovernance,
  type Actor,
  type Capability,
  type Connector,
} from '../../packages/connectors/src/index';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { staffUsecases } from '../../apps/server/src/modules/people/usecases';
import { checkRows, chunk, isKey, listedKeys, managedPerson } from '../../apps/server/src/modules/entities/domain';
import { entityUsecases } from '../../apps/server/src/modules/entities/usecases';
import type { DirectoryPerson, EntityBudget } from '../../apps/server/src/modules/entities/model';

/**
 * Entities (D97) as the person meets them: the real registry with small in-test sources that declare `about`, the
 * people module's directory on its memory store, and the entities use cases wired as the composition wires them. Who
 * may be asked about, what a source is sent and what of its answer is kept, a source that fails or never answers, and
 * authority that changes while the sources answer.
 */
const T = '2026-11-10T08:00:00.000Z';
type Person = { id: string; name: string; userName: string | null; enabled?: boolean; organisationId?: string };

/** The synthetic directory: Hillevi manages the school, Petra the economy unit, Hassan and Mikael are employees. */
function directory(extra: { onSkola?: Person[] } = {}) {
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
      phoneNumbers: [],
      employments: [],
      title: null,
      enabled: p.enabled ?? true,
      createdAt: T,
      updatedAt: T,
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
  person({ id: 'nameless', name: 'Utan Namn', userName: null }, 'unit-skola', 'employee');
  for (const p of extra.onSkola ?? []) person(p, 'unit-skola', 'employee');
  person({ id: 'petra', name: 'Petra Nyström', userName: 'petra' }, 'unit-ekonomi', 'manager');
  person({ id: 'karin', name: 'Karin Åberg', userName: 'karin' }, 'unit-ekonomi', 'employee');
  person({ id: 'hassan', name: 'Hassan Ali', userName: 'hassan' }, 'unit-omsorg', 'employee');
  person(
    { id: 'stranger', name: 'Annan Person', userName: 'stranger', organisationId: 'other' },
    'unit-annan',
    'employee',
  );
  const staff = staffUsecases({ store });
  const persona = (id: string): AuthenticatedContext & { revoke(): void } => {
    const user = s.users.get(id)!,
      grant = s.grants.get(id)!;
    let revoked = false;
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
        if (revoked) throw new Error('Authorization changed.');
        return { version: 'v1' };
      },
      revoke() {
        revoked = true;
      },
    };
  };
  /** A node of the tree (D99): the unit and the `unit:` group that names its parent. */
  const node = (unitId: string, label: string, parentUnitId: string | null) => {
    s.units.set(unitId, { organisationId: 'poc', label });
    s.groups.set('group-' + unitId, {
      id: 'group-' + unitId,
      organisationId: 'poc',
      externalId: 'unit:' + unitId,
      label,
      parentUnitId,
      createdAt: T,
      updatedAt: T,
    });
  };
  return { staff, persona, state: s, place: person, node };
}

interface SourceOptions {
  entity?: 'person' | 'unit';
  /** The rows the source answers for the keys it is asked; default one row per key. */
  answer?: (keys: string[], actor: Actor) => Record<string, unknown>;
  roles?: Actor['role'][];
  maxItems?: number;
  /** Never answers; the signal it was given is kept. */
  hang?: boolean;
  fail?: boolean;
  delayMs?: number;
  /** What the source was asked, call by call, and the signals it got. */
  calls?: string[][];
  signals?: AbortSignal[];
  during?: () => void;
}
/** A read about an entity as a connector declares it (D97): `{ keys }` in, one row per key it knows out, a table view. */
function aboutRead(name: string, title: string, options: SourceOptions = {}): Capability {
  let inFlight = 0;
  return {
    name,
    kind: 'read',
    title,
    description: 'x',
    model: false,
    about: { entity: options.entity ?? 'person' },
    input: {
      type: 'object',
      properties: { keys: { type: 'array', items: { type: 'string' }, maxItems: options.maxItems ?? 200 } },
      required: ['keys'],
      additionalProperties: false,
    } as never,
    output: {
      type: 'object',
      properties: {
        rows: {
          type: 'array',
          items: {
            type: 'object',
            properties: { key: { type: 'string' }, state: { type: 'string' }, count: { type: 'number' } },
            required: ['key'],
          },
        },
        heading: { type: 'string' },
        note: { type: 'string' },
      },
      required: ['rows'],
    } as never,
    scope: options.roles ? { roles: options.roles } : {},
    view: {
      kind: 'table',
      title: 'state',
      fields: [
        { key: 'state', label: 'Status', format: 'status', tones: { Försenat: 'warn' } },
        { key: 'count', label: 'Antal', format: 'number' },
      ],
    },
    run: async (actor, input: unknown, clew) => {
      const keys = (input as { keys: string[] }).keys;
      options.calls?.push(keys);
      if (clew.signal) options.signals?.push(clew.signal);
      inFlight++;
      peak.value = Math.max(peak.value, inFlight);
      try {
        options.during?.();
        if (options.hang) await new Promise(() => {});
        if (options.delayMs) await new Promise(r => setTimeout(r, options.delayMs));
        if (options.fail) throw new Error('The source is down.');
        return options.answer
          ? options.answer(keys, actor)
          : { rows: keys.map(key => ({ key, state: 'Bokat', count: 1, secret: 'never shown' })) };
      } finally {
        inFlight--;
      }
    },
  };
}
const peak = { value: 0 };
const bookTalk: Capability = {
  name: 'hr.book',
  kind: 'propose',
  title: 'Boka samtal',
  description: 'x',
  model: false,
  about: { entity: 'person', param: 'person' },
  input: {
    type: 'object',
    properties: { person: { type: 'string' } },
    required: ['person'],
    additionalProperties: false,
  } as never,
  output: { type: 'object' } as never,
  scope: { roles: ['manager'] },
  run: async () => ({}),
};
const connector = (id: string, source: string, capabilities: Capability[]): Connector => ({
  id,
  kind: 'passthrough',
  source,
  areas: [],
  capabilities,
});

function world(
  sources: Connector[],
  options: { budget?: Partial<EntityBudget>; directory?: ReturnType<typeof directory> } = {},
) {
  const people = options.directory ?? directory();
  const registry = new Registry();
  for (const c of sources) registry.register(c);
  const cardsAsked: Subject[] = [];
  const card: EntityCard = { threadId: 'thread-1', title: 'Sjukanmälan', source: 'Personalsystemet', kind: 'act' };
  const logged: unknown[][] = [];
  const entities = entityUsecases({
    directory: people.staff,
    sources: {
      reads: async (actor, kind) => registry.aboutReads(actor, kind),
      actions: async (actor, kind) => registry.aboutActions(actor, kind),
    },
    read: (persona, capability, input, signal) =>
      registry.clewFor(audiencedActorOf(persona), { signal }).call(capability, input),
    cards: async (_persona, subject) => {
      cardsAsked.push(subject);
      return subject.key === 'anna' ? [card] : [];
    },
    budget: { totalMs: 200, concurrency: 2, ...options.budget },
    log: (...line) => logged.push(line),
  });
  /** What an administrator chose for a connector (D97 items 3 and 4), as the governance carries it. */
  const choose = (id: string, capabilities: Record<string, { lens?: true; column?: string; enabled?: false }>) =>
    registry.govern(id, { ...openGovernance(), capabilities });
  return { registry, entities, people, choose, cardsAsked, logged };
}

/** Personalsystemet with a lens and a column chosen, the appraisal source with a lens, and the booking action. */
function standard(options: { hr?: SourceOptions; appraisals?: SourceOptions } = {}) {
  const w = world([
    connector('hr', 'Personalsystemet', [
      aboutRead('hr.absence', 'Frånvaro', options.hr),
      aboutRead('hr.skills', 'Kompetenser'),
      bookTalk,
    ]),
    connector('appraisals', 'Utvecklingssamtal', [aboutRead('appraisals.round', 'Samtal', options.appraisals)]),
  ]);
  w.choose('hr', { 'hr.absence': { lens: true, column: 'state' } });
  w.choose('appraisals', { 'appraisals.round': { lens: true } });
  return w;
}

describe('the pure rules: keys, calls and what is kept of an answer', () => {
  const view = {
    kind: 'table' as const,
    title: 'state',
    fields: [{ key: 'state', label: 'Status' }],
    open: { capability: 'x.one', title: 'En', params: { id: 'ref' } },
  };
  test('a row about a key not asked, a second row for a key and what the view does not draw are dropped; case is not a difference for a person', () => {
    const checked = checkRows('person', ['anna', 'Erik.S'], view, {
      rows: [
        { key: 'ANNA', state: 'Bokat', ref: 'r1', secret: 'x' },
        { key: 'anna', state: 'Klart' },
        { key: 'erik.s', state: 'Ej bokat' },
        { key: 'karin', state: 'Bokat' },
        { state: 'utan nyckel' },
      ],
      heading: 'Utvecklingssamtal 2026',
      note: 42,
    });
    expect(checked).toEqual({
      rows: [
        { key: 'anna', state: 'Bokat', ref: 'r1' },
        { key: 'Erik.S', state: 'Ej bokat' },
      ],
      heading: 'Utvecklingssamtal 2026',
    });
  });
  test("a unit's key is its id, exactly; an answer without rows where the view says is a broken source", () => {
    expect(checkRows('unit', ['unit-a'], view, { rows: [{ key: 'UNIT-A' }, { key: 'unit-a' }] })?.rows).toEqual([
      { key: 'unit-a' },
    ]);
    expect(checkRows('person', ['anna'], view, { items: [] })).toBeUndefined();
  });
  test('keys go in calls of at most what the source takes, never more than 200', () => {
    const keys = Array.from({ length: 450 }, (_, i) => 'p' + i);
    expect(chunk(keys, 200).map(c => c.length)).toEqual([200, 200, 50]);
    expect(chunk(keys, 500).map(c => c.length)).toEqual([200, 200, 50]);
    expect(chunk(keys, 100).map(c => c.length)).toEqual([100, 100, 100, 100, 50]);
    expect(chunk([], 200)).toEqual([]);
  });
  test('the list asks about each person once, by id in Clew and user name at the source, never the deactivated or someone without a user name', () => {
    const reach = {
      units: [],
      managed: [
        {
          unitId: 'a',
          unitLabel: 'A',
          people: [
            { id: '1', name: 'Anna', userName: 'anna', enabled: true },
            { id: '2', name: 'Bo', userName: 'bo', enabled: false },
            { id: '3', name: 'Cia', userName: null, enabled: true },
          ],
        },
        { unitId: 'b', unitLabel: 'B', people: [{ id: '1', name: 'Anna', userName: 'ANNA', enabled: true }] },
      ],
    };
    expect(listedKeys('person', reach)).toEqual([{ key: '1', sourceKey: 'anna' }]);
    expect(listedKeys('unit', { units: [{ unitId: 'a', unitLabel: 'A', role: 'employee' }], managed: [] })).toEqual([
      { key: 'a', sourceKey: 'a' },
    ]);
  });
  test("a person on the reader's cards is found on the first card that places them, else on the first they report to from below (D99, W1)", () => {
    const sara = { id: 'sara', name: 'Sara Ek', userName: 'sara', enabled: true };
    const fromBelow = { ...sara, below: [{ unitId: 'depa', unitLabel: 'Arkivdepån', role: 'employee' as const }] };
    const card = (unitId: string, unitLabel: string, people: DirectoryPerson[]) => ({ unitId, unitLabel, people });
    const arkivet = card('arkiv', 'Arkivet', [fromBelow]);
    // Placed on two cards and reporting from below on one before them: the first card that places the person.
    expect(
      managedPerson(
        {
          units: [],
          managed: [arkivet, card('skola', 'Bergsåkers skola', [sara]), card('omsorg', 'Hemtjänsten', [sara])],
        },
        'sara',
      ),
    ).toEqual({ person: sara, unit: { unitId: 'skola', unitLabel: 'Bergsåkers skola' }, placed: true });
    // Only from below: the first such card, which does not say where the person works.
    expect(
      managedPerson({ units: [], managed: [arkivet, card('bad', 'Badhuset', [{ ...fromBelow }])] }, 'sara'),
    ).toEqual({ person: fromBelow, unit: { unitId: 'arkiv', unitLabel: 'Arkivet' }, placed: false });
    // Not on the reader's cards, or not someone who can be asked about: nobody.
    expect(managedPerson({ units: [], managed: [arkivet] }, 'anna')).toBeUndefined();
    expect(
      managedPerson({ units: [], managed: [card('skola', 'Bergsåkers skola', [{ ...sara, userName: null }])] }, 'sara'),
    ).toBeUndefined();
  });
  test('a key with a NUL names no entity of either kind, and a person key is no longer than an id (D119)', () => {
    for (const kind of ['person', 'unit'] as const) {
      expect(isKey(kind, 'anna')).toBe(true);
      expect(isKey(kind, '')).toBe(false);
      expect(isKey(kind, 'an\u0000na')).toBe(false);
      expect(isKey(kind, '\u0000')).toBe(false);
    }
    expect(isKey('person', 'x'.repeat(80))).toBe(true);
    expect(isKey('person', 'x'.repeat(81))).toBe(false);
    expect(isKey('unit', 'x'.repeat(81))).toBe(true);
  });
});

describe('the list of people or units', () => {
  test("a manager gets one group per unit they manage, with the administrator's columns and lenses and the actions", async () => {
    const { entities, people } = standard();
    const list = await entities.list(people.persona('hillevi'), 'person');
    expect(list.groups).toEqual([
      {
        id: 'unit-skola',
        label: 'Bergsåkers skola',
        entities: [
          // Clew's key is the id (D119); the source's key is the user name, in the directory's spelling.
          {
            kind: 'person',
            key: 'anna',
            sourceKey: 'anna',
            name: 'Anna Lindqvist',
            detail: 'Bergsåkers skola',
            id: 'anna',
          },
          {
            kind: 'person',
            key: 'erik',
            sourceKey: 'Erik.S',
            name: 'Erik Sund',
            detail: 'Bergsåkers skola',
            id: 'erik',
          },
          {
            kind: 'person',
            key: 'maria',
            sourceKey: 'maria',
            name: 'Maria Öst',
            detail: 'Bergsåkers skola',
            id: 'maria',
          },
        ],
      },
    ]);
    expect(list.columns).toEqual([
      {
        capability: 'hr.absence',
        source: 'Personalsystemet',
        title: 'Frånvaro',
        field: { key: 'state', label: 'Status', format: 'status', tones: { Försenat: 'warn' } },
      },
    ]);
    // By the source's name in Swedish order (no source here is Clew's own), whatever was registered first.
    expect(list.lenses.map(l => [l.connector, l.capability, l.source])).toEqual([
      ['hr', 'hr.absence', 'Personalsystemet'],
      ['appraisals', 'appraisals.round', 'Utvecklingssamtal'],
    ]);
    expect(list.actions).toEqual([
      {
        capability: 'hr.book',
        connector: 'hr',
        source: 'Personalsystemet',
        title: 'Boka samtal',
        kind: 'propose',
        param: 'person',
        // It asks nothing and says nothing beforehand (D112): the dialog draws only its description.
        path: { asks: [], effect: false, description: 'x' },
      },
    ]);
  });
  test('an employee is not refused: no groups, and only what their scope reaches', async () => {
    const { entities, people } = standard();
    const list = await entities.list(people.persona('hassan'), 'person');
    expect(list.groups).toEqual([]);
    expect(list.lenses.map(l => l.capability)).toEqual(['hr.absence', 'appraisals.round']);
    expect(list.actions).toEqual([]);
  });
  test("another unit's manager sees their own people and none of the colleague's", async () => {
    const { entities, people } = standard();
    const list = await entities.list(people.persona('petra'), 'person');
    expect(list.groups.map(g => [g.id, g.entities.map(e => e.key)])).toEqual([['unit-ekonomi', ['karin']]]);
  });
  test('units: one group with the units the reader manages or belongs to', async () => {
    const { entities, people } = standard();
    expect((await entities.list(people.persona('hassan'), 'unit')).groups).toEqual([
      {
        id: 'units',
        label: 'Mina enheter',
        entities: [
          { kind: 'unit', key: 'unit-omsorg', sourceKey: 'unit-omsorg', name: 'Hemtjänsten', id: 'unit-omsorg' },
        ],
      },
    ]);
  });
  test('a source that is switched off, or an action outside the scope, is not offered', async () => {
    const { entities, people, choose } = standard();
    choose('hr', { 'hr.absence': { lens: true, column: 'state', enabled: false } });
    const list = await entities.list(people.persona('hillevi'), 'person');
    expect(list.columns).toEqual([]);
    expect(list.lenses.map(l => l.capability)).toEqual(['appraisals.round']);
  });
});

describe('one source over the whole list', () => {
  test('the rows are about the people asked, each once, in the spelling Clew asked with; heading and note pass', async () => {
    const { entities, people } = standard({
      hr: {
        answer: () => ({
          rows: [
            { key: 'ANNA', state: 'Bokat', count: 2, secret: 'utelämnas' },
            { key: 'anna', state: 'Försenat' },
            { key: 'erik.s', state: 'Försenat', count: 1 },
            { key: 'karin', state: 'Bokat' },
            { key: 'hillevi', state: 'Bokat' },
          ],
          heading: 'Utvecklingssamtal 2026',
          note: 'Senast lör 28 nov',
        }),
      },
    });
    expect(await entities.rows(people.persona('hillevi'), 'person', 'hr.absence')).toEqual({
      capability: 'hr.absence',
      status: 'ok',
      rows: [
        { key: 'anna', state: 'Bokat', count: 2 },
        { key: 'Erik.S', state: 'Försenat', count: 1 },
      ],
      heading: 'Utvecklingssamtal 2026',
      note: 'Senast lör 28 nov',
    });
  });
  test('the source is sent only the keys the rule allows, never the deactivated, the nameless or the reader', async () => {
    const calls: string[][] = [];
    const { entities, people } = standard({ hr: { calls } });
    await entities.rows(people.persona('hillevi'), 'person', 'hr.absence');
    expect(calls).toEqual([['anna', 'Erik.S', 'maria']]);
  });
  test('a source that fails gives its status and no rows, and another source still answers', async () => {
    const { entities, people, logged } = standard({ hr: { fail: true } });
    const persona = people.persona('hillevi');
    expect(await entities.rows(persona, 'person', 'hr.absence')).toEqual({
      capability: 'hr.absence',
      status: 'unavailable',
      rows: [],
    });
    expect((await entities.rows(persona, 'person', 'appraisals.round'))?.rows).toHaveLength(3);
    // The operator learns which source and how, never whom it was asked about.
    expect(logged).toEqual([
      ['a source about an entity gave no rows', { capability: 'hr.absence', status: 'unavailable' }],
    ]);
  });
  test('an answer out of shape is a source that failed, not an empty list', async () => {
    const { entities, people } = standard({ hr: { answer: () => ({ rows: 'nothing' }) } });
    expect((await entities.rows(people.persona('hillevi'), 'person', 'hr.absence'))?.status).toBe('unavailable');
  });
  test('a source that never answers times out within the budget and is cancelled', async () => {
    const signals: AbortSignal[] = [];
    const { entities, people } = standard({ hr: { hang: true, signals } });
    const started = performance.now();
    expect(await entities.rows(people.persona('hillevi'), 'person', 'hr.absence')).toEqual({
      capability: 'hr.absence',
      status: 'timeout',
      rows: [],
    });
    expect(performance.now() - started).toBeLessThan(1_000);
    expect(signals).toHaveLength(1);
    expect(signals[0]!.aborted).toBe(true);
  });
  test('a source switched off while it answers releases nothing: the read is gone for the person', async () => {
    let w: ReturnType<typeof standard>;
    w = standard({
      hr: { during: () => w.choose('hr', { 'hr.absence': { lens: true, column: 'state', enabled: false } }) },
    });
    expect(await w.entities.rows(w.people.persona('hillevi'), 'person', 'hr.absence')).toBeUndefined();
  });
  test('a choice taken back while the source answers releases nothing either', async () => {
    let w: ReturnType<typeof standard>;
    w = standard({ hr: { during: () => w.choose('hr', {}) } });
    expect(await w.entities.rows(w.people.persona('hillevi'), 'person', 'hr.absence')).toBeUndefined();
  });
  test("the person's own authority is checked again after the batch", async () => {
    let persona: ReturnType<ReturnType<typeof directory>['persona']>;
    const w = standard({ hr: { during: () => persona.revoke() } });
    persona = w.people.persona('hillevi');
    await expect(w.entities.rows(persona, 'person', 'hr.absence')).rejects.toThrow('Authorization changed.');
  });
  test('a source nobody placed, one the person may not call, another kind or no such source: none is called', async () => {
    const calls: string[][] = [];
    const w = world([
      connector('hr', 'Personalsystemet', [
        aboutRead('hr.skills', 'Kompetenser', { calls }),
        aboutRead('hr.salary', 'Lön', { calls, roles: ['manager'] }),
        aboutRead('hr.staffing', 'Bemanning', { calls, entity: 'unit' }),
        bookTalk,
      ]),
    ]);
    w.choose('hr', { 'hr.salary': { lens: true }, 'hr.staffing': { lens: true } });
    const hillevi = w.people.persona('hillevi'),
      hassan = w.people.persona('hassan');
    expect(await w.entities.rows(hillevi, 'person', 'hr.skills')).toBeUndefined();
    expect(await w.entities.rows(hassan, 'person', 'hr.salary')).toBeUndefined();
    expect(await w.entities.rows(hillevi, 'person', 'hr.staffing')).toBeUndefined();
    expect(await w.entities.rows(hillevi, 'person', 'hr.book')).toBeUndefined();
    expect(await w.entities.rows(hillevi, 'person', 'hr.nothing')).toBeUndefined();
    expect(calls).toEqual([]);
    // The placed ones answer.
    expect((await w.entities.rows(hillevi, 'person', 'hr.salary'))?.status).toBe('ok');
    expect(await w.entities.rows(hillevi, 'unit', 'hr.staffing')).toMatchObject({
      status: 'ok',
      rows: [{ key: 'unit-skola' }],
    });
  });
  test('an employee with nobody to ask about calls no source and gets no rows', async () => {
    const calls: string[][] = [];
    const { entities, people } = standard({ hr: { calls } });
    expect(await entities.rows(people.persona('hassan'), 'person', 'hr.absence')).toEqual({
      capability: 'hr.absence',
      status: 'ok',
      rows: [],
    });
    expect(calls).toEqual([]);
  });
  test('more than 200 people are asked in calls of 200 (or fewer, if the source takes fewer), a few at a time, and every row comes back', async () => {
    const many = Array.from({ length: 450 }, (_, i) => ({
      id: 'p' + i,
      name: 'Person ' + String(i).padStart(3, '0'),
      userName: 'p' + i,
    }));
    const calls: string[][] = [],
      small: string[][] = [];
    const w = world(
      [
        connector('hr', 'Personalsystemet', [
          aboutRead('hr.absence', 'Frånvaro', { calls, delayMs: 5 }),
          aboutRead('hr.small', 'Liten', { calls: small, maxItems: 50, delayMs: 1 }),
        ]),
      ],
      { directory: directory({ onSkola: many }), budget: { concurrency: 2, totalMs: 2_000 } },
    );
    w.choose('hr', { 'hr.absence': { lens: true }, 'hr.small': { lens: true } });
    peak.value = 0;
    const answer = await w.entities.rows(w.people.persona('hillevi'), 'person', 'hr.absence');
    expect(calls.map(c => c.length)).toEqual([200, 200, 53]);
    expect(new Set(calls.flat()).size).toBe(453);
    expect(answer?.rows).toHaveLength(453);
    expect(peak.value).toBe(2);
    await w.entities.rows(w.people.persona('hillevi'), 'person', 'hr.small');
    expect(small).toHaveLength(10);
    expect(Math.max(...small.map(c => c.length))).toBe(50);
  });
  test('one call of several that fails stops the rest and gives no rows at all', async () => {
    const many = Array.from({ length: 450 }, (_, i) => ({ id: 'p' + i, name: 'P' + i, userName: 'p' + i }));
    const calls: string[][] = [];
    const w = world(
      [
        connector('hr', 'Personalsystemet', [
          aboutRead('hr.absence', 'Frånvaro', {
            calls,
            answer: keys => {
              if (calls.length === 1) throw new Error('down');
              return { rows: keys.map(key => ({ key })) };
            },
          }),
        ]),
      ],
      { directory: directory({ onSkola: many }), budget: { concurrency: 1 } },
    );
    w.choose('hr', { 'hr.absence': { lens: true } });
    expect(await w.entities.rows(w.people.persona('hillevi'), 'person', 'hr.absence')).toEqual({
      capability: 'hr.absence',
      status: 'unavailable',
      rows: [],
    });
    expect(calls).toHaveLength(1);
  });
});

describe('the opened person or unit', () => {
  test('someone on a unit the reader manages: their unit, the actions, a section per source and the cards about them', async () => {
    const { entities, people, cardsAsked } = standard();
    const detail = await entities.detail(people.persona('hillevi'), 'person', 'anna');
    expect(detail).toEqual({
      entity: {
        kind: 'person',
        key: 'anna',
        sourceKey: 'anna',
        name: 'Anna Lindqvist',
        detail: 'Bergsåkers skola',
        id: 'anna',
        // The reader manages it, so its page opens for them.
        unit: { id: 'unit-skola', label: 'Bergsåkers skola', opens: true },
      },
      relation: 'managed',
      profile: { email: null, phoneNumbers: [], title: null, employments: [] },
      actions: [expect.objectContaining({ capability: 'hr.book', param: 'person' })],
      sections: [
        expect.objectContaining({ capability: 'hr.absence', source: 'Personalsystemet' }),
        expect.objectContaining({ capability: 'hr.skills', source: 'Personalsystemet', title: 'Kompetenser' }),
        expect.objectContaining({ capability: 'appraisals.round', source: 'Utvecklingssamtal' }),
      ],
      cards: [{ threadId: 'thread-1', title: 'Sjukanmälan', source: 'Personalsystemet', kind: 'act' }],
    });
    expect(cardsAsked).toEqual([{ entity: 'person', key: 'anna' }]);
  });
  test('an authorised profile shows the work address, every number and each employment on its named unit', async () => {
    const { people, entities } = standard();
    people.state.groups.set('school', {
      id: 'school',
      organisationId: 'poc',
      externalId: 'unit:unit-skola',
      label: 'Skolans nya namn',
      parentUnitId: null,
      createdAt: T,
      updatedAt: T,
    });
    const row = people.state.users.get('anna')!;
    row.email = 'anna@example.test';
    row.phoneNumbers = [
      { type: 'work', value: '010-1' },
      { type: 'work', value: '010-2' },
    ];
    row.employments = [
      {
        unitId: 'unit-skola',
        title: 'Lärare',
        employmentType: 'Tillsvidare',
        startDate: '2019-02-01',
        employmentPercentage: 60,
      },
      { unitId: 'unit-skola', title: 'Samordnare' },
    ];
    for (const reader of ['hillevi', 'anna', 'hassan']) {
      const profile = (await entities.detail(people.persona(reader), 'person', 'anna'))?.profile;
      expect(profile).toEqual({
        email: row.email,
        title: null,
        phoneNumbers: row.phoneNumbers,
        employments: row.employments.map(job => ({ ...job, unitLabel: 'Skolans nya namn' })),
      });
    }
    row.enabled = false;
    expect(await entities.detail(people.persona('hassan'), 'person', 'anna')).toBeUndefined();
  });
  test('the reader themself, and another active person of the directory as a colleague', async () => {
    const { entities, people } = standard();
    const self = await entities.detail(people.persona('hassan'), 'person', 'hassan');
    expect(self).toMatchObject({
      relation: 'self',
      entity: {
        key: 'hassan',
        id: 'hassan',
        name: 'Hassan Ali',
        unit: { id: 'unit-omsorg', label: 'Hemtjänsten', opens: true },
      },
      actions: [],
    });
    const colleague = await entities.detail(people.persona('hassan'), 'person', 'erik');
    expect(colleague).toMatchObject({
      relation: 'colleague',
      entity: {
        key: 'erik',
        sourceKey: 'Erik.S',
        name: 'Erik Sund',
        detail: 'Bergsåkers skola',
        unit: { id: 'unit-skola' },
      },
    });
    // Hassan neither manages nor belongs to the school, so its page is named and does not open for him.
    expect(colleague?.entity.unit).toEqual({ id: 'unit-skola', label: 'Bergsåkers skola' });
    expect(colleague?.sections.map(s => s.capability)).toEqual(['hr.absence', 'hr.skills', 'appraisals.round']);
    // A colleague on the reader's own unit: its page opens, as the unit's address answers it.
    expect((await entities.detail(people.persona('anna'), 'person', 'erik'))?.entity.unit).toEqual({
      id: 'unit-skola',
      label: 'Bergsåkers skola',
      opens: true,
    });
  });
  test('someone who reports to the reader from below is shown on their own unit, which opens as its page does: for a reader who manages, belongs to or follows it up (D99, D117, W1)', async () => {
    const people = directory();
    // Fritidshemmet stands under the school and Lena leads it, so she reports to Hillevi from below and Hillevi follows
    // the unit up (D117). Köket stands under the school too and nobody leads it, so Kim, placed there, reports to
    // Hillevi from below, but Köket is not a unit Hillevi follows up.
    people.node('unit-skola', 'Bergsåkers skola', null);
    people.node('unit-fritids', 'Fritidshemmet', 'unit-skola');
    people.node('unit-kok', 'Köket', 'unit-skola');
    people.place({ id: 'lena', name: 'Lena Berg', userName: 'lena' }, 'unit-fritids', 'manager');
    people.place({ id: 'kim', name: 'Kim Ek', userName: 'kim' }, 'unit-kok', 'employee');
    const w = world([connector('hr', 'Personalsystemet', [aboutRead('hr.absence', 'Frånvaro')])], {
      directory: people,
    });
    const hillevi = people.persona('hillevi');
    const lena = await w.entities.detail(hillevi, 'person', 'lena');
    expect(lena).toMatchObject({ relation: 'managed', entity: { key: 'lena', detail: 'Fritidshemmet' } });
    expect(lena?.entity.unit).toEqual({ id: 'unit-fritids', label: 'Fritidshemmet', opens: true });
    expect((await w.entities.detail(hillevi, 'unit', 'unit-fritids'))?.relation).toBe('below');
    // A colleague who opens Lena reads the same unit, which is not theirs to open.
    expect((await w.entities.detail(people.persona('hassan'), 'person', 'lena'))?.entity.unit).toEqual({
      id: 'unit-fritids',
      label: 'Fritidshemmet',
    });
    // Kim's unit is not one Hillevi may open, and the link is not drawn.
    const kim = await w.entities.detail(hillevi, 'person', 'kim');
    expect(kim).toMatchObject({ relation: 'managed', entity: { key: 'kim', detail: 'Köket' } });
    expect(kim?.entity.unit).toEqual({ id: 'unit-kok', label: 'Köket' });
    expect(await w.entities.detail(hillevi, 'unit', 'unit-kok')).toBeUndefined();
    // Placed on Köket as well, Hillevi belongs to it, and its page opens for her.
    people.state.assignments.set('hillevi', [
      ...people.state.assignments.get('hillevi')!,
      { unitId: 'unit-kok', role: 'employee' },
    ]);
    expect((await w.entities.detail(hillevi, 'person', 'kim'))?.entity.unit).toEqual({
      id: 'unit-kok',
      label: 'Köket',
      opens: true,
    });
  });
  test('someone placed on a unit the reader manages is shown on it, whatever unit they act in, also when they report from below on a card that comes first (D99, W1)', async () => {
    const people = directory();
    // Hillevi also leads Arkivet, whose card comes before the school's. Sara is placed on the school and leads
    // Arkivdepån under Arkivet, the unit she acts in (her grant), so the first card, her own unit and the card she is
    // placed on are three different units.
    people.node('unit-skola', 'Bergsåkers skola', null);
    people.node('unit-arkiv', 'Arkivet', null);
    people.node('unit-depa', 'Arkivdepån', 'unit-arkiv');
    people.state.assignments.set('hillevi', [
      ...people.state.assignments.get('hillevi')!,
      { unitId: 'unit-arkiv', role: 'manager' },
    ]);
    people.place({ id: 'sara', name: 'Sara Ek', userName: 'sara' }, 'unit-skola', 'employee');
    people.place({ id: 'sara', name: 'Sara Ek', userName: 'sara' }, 'unit-depa', 'manager');
    const w = world([connector('hr', 'Personalsystemet', [aboutRead('hr.absence', 'Frånvaro')])], {
      directory: people,
    });
    const hillevi = people.persona('hillevi');
    const reach = await people.staff.reach(hillevi);
    expect(reach.managed.map(u => [u.unitLabel, u.people.find(p => p.id === 'sara')?.below?.length ?? 0])).toEqual([
      ['Arkivet', 1],
      ['Bergsåkers skola', 0],
    ]);
    expect((await people.staff.person(hillevi, 'sara', false))?.unit).toEqual({
      unitId: 'unit-depa',
      unitLabel: 'Arkivdepån',
    });
    const sara = await w.entities.detail(hillevi, 'person', 'sara');
    expect(sara).toMatchObject({ relation: 'managed', entity: { key: 'sara', detail: 'Bergsåkers skola' } });
    expect(sara?.entity.unit).toEqual({ id: 'unit-skola', label: 'Bergsåkers skola', opens: true });
    // A colleague who opens her reads the unit she acts in, which is not theirs to open.
    expect((await w.entities.detail(people.persona('hassan'), 'person', 'sara'))?.entity.unit).toEqual({
      id: 'unit-depa',
      label: 'Arkivdepån',
    });
  });
  test('a person is opened by their id only: a user name, in any spelling, names nobody (D119)', async () => {
    const { entities, people, cardsAsked } = standard();
    const hillevi = people.persona('hillevi');
    for (const key of ['Erik.S', 'erik.s', 'ANNA', 'Hassan'])
      expect(await entities.detail(hillevi, 'person', key)).toBeUndefined();
    expect(await entities.section(hillevi, 'person', 'Erik.S', 'hr.skills')).toBeUndefined();
    expect(cardsAsked).toEqual([]);
  });
  test('a renamed person keeps their address and the cards about them; a reused user name opens its new holder alone (D119)', async () => {
    const w = world([connector('hr', 'Personalsystemet', [aboutRead('hr.absence', 'Frånvaro'), bookTalk])], {
      directory: directory({ onSkola: [{ id: 'anna-2', name: 'Anna Nygren', userName: 'anna' }] }),
    });
    // Anna Lindqvist is renamed, and her old user name is given to someone else: the directory holds one of each.
    w.people.state.users.get('anna')!.userName = 'anna.lindqvist';
    const hillevi = w.people.persona('hillevi');
    expect(await w.entities.detail(hillevi, 'person', 'anna')).toMatchObject({
      entity: { key: 'anna', sourceKey: 'anna.lindqvist', name: 'Anna Lindqvist' },
      cards: [{ threadId: 'thread-1' }],
    });
    expect(await w.entities.detail(hillevi, 'person', 'anna-2')).toMatchObject({
      entity: { key: 'anna-2', sourceKey: 'anna', name: 'Anna Nygren' },
      cards: [],
    });
    expect(w.cardsAsked).toEqual([
      { entity: 'person', key: 'anna' },
      { entity: 'person', key: 'anna-2' },
    ]);
    // The source is asked with the user name each holds now.
    expect((await w.entities.section(hillevi, 'person', 'anna', 'hr.absence'))?.row).toMatchObject({
      key: 'anna.lindqvist',
    });
    expect((await w.entities.section(hillevi, 'person', 'anna-2', 'hr.absence'))?.row).toMatchObject({ key: 'anna' });
  });
  test('an unknown key, a deactivated person, someone without a user name and another organisation are all not there', async () => {
    const { entities, people } = standard();
    const hillevi = people.persona('hillevi');
    for (const key of ['nobody', 'bo', 'nameless', 'stranger', '', 'x'.repeat(257), 'x'.repeat(81)])
      expect(await entities.detail(hillevi, 'person', key)).toBeUndefined();
  });
  test('a key with a NUL names nobody, and no source and no card is read for it (K3)', async () => {
    const calls: string[][] = [];
    const { entities, people, cardsAsked } = standard({ hr: { calls } });
    const hillevi = people.persona('hillevi');
    for (const key of ['anna\u0000', '\u0000anna', '\u0000']) {
      expect(await entities.detail(hillevi, 'person', key)).toBeUndefined();
      expect(await entities.section(hillevi, 'person', key, 'hr.absence')).toBeUndefined();
      expect(await entities.detail(hillevi, 'unit', 'unit-skola' + key)).toBeUndefined();
      expect(await entities.section(hillevi, 'unit', key, 'hr.absence')).toBeUndefined();
    }
    expect(calls).toEqual([]);
    expect(cardsAsked).toEqual([]);
  });
  test('a unit the reader manages or belongs to, and no other', async () => {
    const { entities, people } = standard();
    expect(await entities.detail(people.persona('hillevi'), 'unit', 'unit-skola')).toMatchObject({
      relation: 'member',
      entity: { kind: 'unit', key: 'unit-skola', name: 'Bergsåkers skola' },
      sections: [],
    });
    expect(await entities.detail(people.persona('hillevi'), 'unit', 'unit-omsorg')).toBeUndefined();
    expect(await entities.detail(people.persona('hillevi'), 'unit', 'UNIT-SKOLA')).toBeUndefined();
  });
});

describe("one source's section on the opened entity", () => {
  test('any read about the kind the reader may call answers for the one key, whatever was placed', async () => {
    const calls: string[][] = [];
    const w = world([
      connector('hr', 'Personalsystemet', [
        aboutRead('hr.skills', 'Kompetenser', {
          calls,
          answer: keys => ({ rows: [{ key: keys[0]!.toUpperCase(), state: 'Bokat', count: 3, secret: 'x' }] }),
        }),
      ]),
    ]);
    const hillevi = w.people.persona('hillevi');
    expect(await w.entities.section(hillevi, 'person', 'anna', 'hr.skills')).toEqual({
      capability: 'hr.skills',
      status: 'ok',
      row: { key: 'anna', state: 'Bokat', count: 3 },
    });
    expect(await w.entities.section(hillevi, 'person', 'hillevi', 'hr.skills')).toMatchObject({ status: 'ok' });
    expect(await w.entities.section(w.people.persona('hassan'), 'person', 'karin', 'hr.skills')).toMatchObject({
      status: 'ok',
      row: { key: 'karin' },
    });
    expect(calls).toEqual([['anna'], ['hillevi'], ['karin']]);
  });
  test('no row is an answer; a key outside the rule or a source not about the kind calls nothing', async () => {
    const calls: string[][] = [];
    const w = world([
      connector('hr', 'Personalsystemet', [
        aboutRead('hr.skills', 'Kompetenser', { calls, answer: () => ({ rows: [] }) }),
        aboutRead('hr.staffing', 'Bemanning', { calls, entity: 'unit' }),
        bookTalk,
      ]),
    ]);
    const hillevi = w.people.persona('hillevi');
    expect(await w.entities.section(hillevi, 'person', 'anna', 'hr.skills')).toEqual({
      capability: 'hr.skills',
      status: 'ok',
    });
    calls.length = 0;
    expect(await w.entities.section(hillevi, 'person', 'nobody', 'hr.skills')).toBeUndefined();
    expect(await w.entities.section(hillevi, 'person', 'anna', 'hr.staffing')).toBeUndefined();
    expect(await w.entities.section(hillevi, 'person', 'anna', 'hr.book')).toBeUndefined();
    expect(await w.entities.section(hillevi, 'unit', 'unit-omsorg', 'hr.staffing')).toBeUndefined();
    expect(calls).toEqual([]);
    expect(await w.entities.section(hillevi, 'unit', 'unit-skola', 'hr.staffing')).toMatchObject({
      status: 'ok',
      row: { key: 'unit-skola' },
    });
  });
  test('a section that fails or never answers says so; one switched off meanwhile is gone', async () => {
    const failing = standard({ hr: { fail: true } });
    expect(await failing.entities.section(failing.people.persona('hillevi'), 'person', 'anna', 'hr.absence')).toEqual({
      capability: 'hr.absence',
      status: 'unavailable',
    });
    const hanging = standard({ hr: { hang: true } });
    expect(await hanging.entities.section(hanging.people.persona('hillevi'), 'person', 'anna', 'hr.absence')).toEqual({
      capability: 'hr.absence',
      status: 'timeout',
    });
    let w: ReturnType<typeof standard>;
    w = standard({ hr: { during: () => w.choose('hr', { 'hr.absence': { enabled: false } }) } });
    expect(await w.entities.section(w.people.persona('hillevi'), 'person', 'anna', 'hr.absence')).toBeUndefined();
  });
});

describe('the registry names the sources about an entity', () => {
  test("a read's view keeps a row's open only when the person may call it, and the batch is the read's own maximum", () => {
    const registry = new Registry();
    const read = aboutRead('hr.absence', 'Frånvaro', { maxItems: 25 });
    registry.register(
      connector('hr', 'Personalsystemet', [
        {
          ...read,
          view: {
            kind: 'table',
            title: 'state',
            fields: [{ key: 'state', label: 'Status' }],
            open: { capability: 'hr.case', title: 'Ärende', params: { ref: 'state' } },
          },
        },
        {
          name: 'hr.case',
          kind: 'read',
          title: 'Ärende',
          description: 'x',
          model: false,
          input: {} as never,
          output: {} as never,
          scope: { roles: ['manager'] },
          run: async () => ({}),
        },
      ]),
    );
    const manager: Actor = { id: 'm', name: 'M', unitId: 'u', unitLabel: 'U', role: 'manager' },
      employee: Actor = { ...manager, id: 'e', role: 'employee' };
    expect(registry.aboutReads(manager, 'person')[0]).toMatchObject({ batch: 25, lens: false, view: { open: {} } });
    expect(registry.aboutReads(employee, 'person')[0]!.view).not.toHaveProperty('open');
    expect(registry.aboutReads(manager, 'unit')).toEqual([]);
    // A column names a field of the view; a stored one the view no longer has is no column.
    registry.govern('hr', { ...openGovernance(), capabilities: { 'hr.absence': { column: 'gone' } } });
    expect(registry.aboutReads(manager, 'person')[0]).not.toHaveProperty('column');
  });
  test("Clew's core connector is never asked: a core scope may ask the registry", () => {
    const registry = new Registry();
    let asked = 0;
    registry.register({
      id: 'clew',
      kind: 'core',
      source: 'Startsidan',
      areas: [],
      capabilities: [
        {
          ...aboutRead('clew.people', 'Alla'),
          scope: () => {
            asked++;
            return true;
          },
        },
      ],
    });
    const actor: Actor = { id: 'm', name: 'M', unitId: 'u', unitLabel: 'U', role: 'manager' };
    expect(registry.aboutReads(actor, 'person')).toEqual([]);
    expect(asked).toBe(0);
  });
});

describe("Clew's own domain among the sources", () => {
  /** The standard sources and a core connector of Clew's (as the talks module is), with a read and an action about a person. */
  function withOwn() {
    const w = world([
      connector('hr', 'Personalsystemet', [aboutRead('hr.absence', 'Frånvaro'), bookTalk]),
      connector('appraisals', 'Utvecklingssamtal', [aboutRead('appraisals.round', 'Samtal')]),
      {
        id: 'talks',
        kind: 'core',
        source: 'Utvecklingssamtal',
        areas: [],
        capabilities: [aboutRead('talks.person', 'Utvecklingssamtal'), { ...bookTalk, name: 'talks.book' }],
      },
    ]);
    w.choose('hr', { 'hr.absence': { lens: true, column: 'state' } });
    w.choose('appraisals', { 'appraisals.round': { lens: true } });
    w.choose('talks', { 'talks.person': { lens: true, column: 'state' } });
    return w;
  }
  test('a source of a core connector is marked own, as its column and its action are, and comes first', async () => {
    const { entities, people } = withOwn();
    const hillevi = people.persona('hillevi');
    const list = await entities.list(hillevi, 'person');
    expect(list.lenses.map(l => [l.capability, l.own ?? false])).toEqual([
      ['talks.person', true],
      ['hr.absence', false],
      ['appraisals.round', false],
    ]);
    // The columns keep the connectors' order: an administrator's columns read left to right as chosen.
    expect(list.columns.map(c => [c.capability, c.source, c.own ?? false])).toEqual([
      ['hr.absence', 'Personalsystemet', false],
      ['talks.person', 'Utvecklingssamtal', true],
    ]);
    expect(list.actions.map(a => [a.capability, a.own ?? false])).toEqual([
      ['hr.book', false],
      ['talks.book', true],
    ]);
    // The source keeps its own name: the web captions an own section "Clew" and keeps the name for the column and menu.
    expect(list.lenses[0]).toMatchObject({ source: 'Utvecklingssamtal', connector: 'talks', own: true });
    const detail = await entities.detail(hillevi, 'person', 'anna');
    expect(detail?.sections.map(s => [s.capability, s.own ?? false])).toEqual([
      ['talks.person', true],
      ['hr.absence', false],
      ['appraisals.round', false],
    ]);
    expect(detail?.sections[1]).not.toHaveProperty('own');
  });
});

test('a source for one provisioned group only is asked for its members and is not there for anyone else (D68)', async () => {
  const calls: string[][] = [];
  const w = world([connector('hr', 'Personalsystemet', [aboutRead('hr.skills', 'Kompetenser', { calls }), bookTalk])]);
  w.registry.govern('hr', {
    ...openGovernance(),
    audience: { mode: 'selected', groups: ['S-1-5-21-hr'] },
    capabilities: { 'hr.skills': { lens: true } },
  });
  // Hillevi in the group and Hillevi outside it: the reads, the sections and the actions follow the group.
  const member = { ...w.people.persona('hillevi'), groups: ['S-1-5-21-hr'] },
    outsider = { ...w.people.persona('hillevi'), groups: ['S-1-5-21-annan'] };
  expect((await w.entities.rows(member, 'person', 'hr.skills'))?.status).toBe('ok');
  expect(await w.entities.section(member, 'person', 'anna', 'hr.skills')).toMatchObject({ status: 'ok' });
  const detail = await w.entities.detail(member, 'person', 'anna');
  expect(detail?.sections.map(s => s.connector)).toEqual(['hr']);
  expect(detail?.actions.map(a => a.capability)).toEqual(['hr.book']);
  const asked = calls.length;
  expect(await w.entities.rows(outsider, 'person', 'hr.skills')).toBeUndefined();
  expect(await w.entities.section(outsider, 'person', 'anna', 'hr.skills')).toBeUndefined();
  expect(await w.entities.detail(outsider, 'person', 'anna')).toMatchObject({ sections: [], actions: [] });
  expect(calls).toHaveLength(asked);
});

/**
 * The units below the reader (D117): Ingrid leads Grundskola, the unit above the school Hillevi leads (D99's tree), so
 * Hillevi reports to her and the school is a unit Ingrid follows up. Ingrid opens it and sees it listed under her own;
 * nobody opens a unit above them, and a source is asked about the units below like any other.
 */
describe('the units below the reader (D117)', () => {
  function withIngrid(w: ReturnType<typeof standard>) {
    const s = w.people.state;
    const group = (id: string, unitId: string, label: string, parentUnitId: string | null) =>
      s.groups.set(id, {
        id,
        organisationId: 'poc',
        externalId: 'unit:' + unitId,
        label,
        parentUnitId,
        createdAt: T,
        updatedAt: T,
      });
    s.units.set('unit-grundskola', { organisationId: 'poc', label: 'Grundskola' });
    group('g-grundskola', 'unit-grundskola', 'Grundskola', null);
    group('g-skola', 'unit-skola', 'Bergsåkers skola', 'unit-grundskola');
    s.users.set('ingrid', {
      id: 'ingrid',
      organisationId: 'poc',
      externalId: 'dev:ingrid',
      userName: 'ingrid',
      name: 'Ingrid Holm',
      email: null,
      phoneNumbers: [],
      employments: [],
      title: null,
      enabled: true,
      createdAt: T,
      updatedAt: T,
    });
    s.assignments.set('ingrid', [{ unitId: 'unit-grundskola', role: 'manager' }]);
    s.grants.set('ingrid', { unitId: 'unit-grundskola', unitLabel: 'Grundskola', role: 'manager', capabilities: [] });
    return w.people.persona('ingrid');
  }
  test('Ingrid opens her own unit with the school under it, and the school as a unit whose manager reports to her', async () => {
    const w = standard();
    const ingrid = withIngrid(w);
    expect(await w.entities.detail(ingrid, 'unit', 'unit-grundskola')).toMatchObject({
      relation: 'member',
      below: [{ key: 'unit-skola', name: 'Bergsåkers skola' }],
    });
    const school = await w.entities.detail(ingrid, 'unit', 'unit-skola');
    expect(school).toMatchObject({
      relation: 'below',
      entity: { kind: 'unit', key: 'unit-skola' },
      above: { key: 'unit-grundskola', name: 'Grundskola' },
    });
    expect(school?.below).toBeUndefined();
    // Nothing further than the reporting line, and nothing upward.
    expect(await w.entities.detail(ingrid, 'unit', 'unit-omsorg')).toBeUndefined();
    expect(await w.entities.detail(w.people.persona('hillevi'), 'unit', 'unit-grundskola')).toBeUndefined();
    expect((await w.entities.detail(w.people.persona('hillevi'), 'unit', 'unit-skola'))?.relation).toBe('member');
  });
  test('the list of units has her own and the ones below, and a source is asked about the unit below', async () => {
    const calls: string[][] = [];
    const w = world([
      connector('hr', 'Personalsystemet', [aboutRead('hr.staffing', 'Bemanning', { calls, entity: 'unit' })]),
    ]);
    const ingrid = withIngrid(w as ReturnType<typeof standard>);
    expect((await w.entities.list(ingrid, 'unit')).groups).toEqual([
      {
        id: 'units',
        label: 'Mina enheter',
        entities: [
          {
            kind: 'unit',
            key: 'unit-grundskola',
            sourceKey: 'unit-grundskola',
            name: 'Grundskola',
            id: 'unit-grundskola',
          },
        ],
      },
      {
        id: 'below',
        label: 'Enheter under dig',
        entities: [
          { kind: 'unit', key: 'unit-skola', sourceKey: 'unit-skola', name: 'Bergsåkers skola', id: 'unit-skola' },
        ],
      },
    ]);
    expect(await w.entities.section(ingrid, 'unit', 'unit-skola', 'hr.staffing')).toMatchObject({
      status: 'ok',
      row: { key: 'unit-skola' },
    });
    expect(calls).toContainEqual(['unit-skola']);
  });
  test('the units a person follows up travel with the actor when a call has them, and not otherwise', () => {
    const base = {
      id: 'ingrid',
      name: 'Ingrid Holm',
      unitId: 'unit-grundskola',
      unitLabel: 'Grundskola',
      role: 'manager' as const,
    };
    expect(actorOf(base)).toEqual(base);
    const units = [
      { unitId: 'unit-grundskola', unitLabel: 'Grundskola' },
      { unitId: 'unit-skola', unitLabel: 'Bergsåkers skola' },
    ];
    expect(actorOf({ ...base, units }).units).toEqual(units);
  });
});
