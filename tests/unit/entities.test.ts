import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, EntityCard, Subject } from '../../packages/contracts/src/index';
import {
  actorOf,
  openGovernance,
  type Actor,
  type Capability,
  type Connector,
} from '../../packages/connectors/src/index';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { staffUsecases } from '../../apps/server/src/modules/people/usecases';
import { checkRows, chunk, listedKeys } from '../../apps/server/src/modules/entities/domain';
import { entityUsecases } from '../../apps/server/src/modules/entities/usecases';
import type { EntityBudget } from '../../apps/server/src/modules/entities/model';

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
  return { staff, persona, state: s };
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
    directory: { reach: p => people.staff.reach(p), colleague: (p, key) => people.staff.colleague(p, key) },
    sources: {
      reads: async (actor, kind) => registry.aboutReads(actor, kind),
      actions: async (actor, kind) => registry.aboutActions(actor, kind),
    },
    read: (persona, capability, input, signal) =>
      registry.clewFor(actorOf(persona), { signal }).call(capability, input),
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
  test('the list asks about each person once, never the deactivated or someone without a user name', () => {
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
    expect(listedKeys('person', reach)).toEqual(['anna']);
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
          { kind: 'person', key: 'anna', name: 'Anna Lindqvist', detail: 'Bergsåkers skola', id: 'anna' },
          { kind: 'person', key: 'Erik.S', name: 'Erik Sund', detail: 'Bergsåkers skola', id: 'erik' },
          { kind: 'person', key: 'maria', name: 'Maria Öst', detail: 'Bergsåkers skola', id: 'maria' },
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
        entities: [{ kind: 'unit', key: 'unit-omsorg', name: 'Hemtjänsten', id: 'unit-omsorg' }],
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
    const detail = await entities.detail(people.persona('hillevi'), 'person', 'ANNA');
    expect(detail).toEqual({
      entity: {
        kind: 'person',
        key: 'anna',
        name: 'Anna Lindqvist',
        detail: 'Bergsåkers skola',
        id: 'anna',
        unit: { id: 'unit-skola', label: 'Bergsåkers skola' },
      },
      relation: 'managed',
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
  test('the reader themself, and another active person of the directory as a colleague', async () => {
    const { entities, people } = standard();
    const self = await entities.detail(people.persona('hassan'), 'person', 'Hassan');
    expect(self).toMatchObject({
      relation: 'self',
      entity: { key: 'hassan', id: 'hassan', name: 'Hassan Ali', unit: { id: 'unit-omsorg', label: 'Hemtjänsten' } },
      actions: [],
    });
    const colleague = await entities.detail(people.persona('hassan'), 'person', 'erik.s');
    expect(colleague).toMatchObject({
      relation: 'colleague',
      entity: { key: 'Erik.S', name: 'Erik Sund', detail: 'Bergsåkers skola', unit: { id: 'unit-skola' } },
    });
    expect(colleague?.sections.map(s => s.capability)).toEqual(['hr.absence', 'hr.skills', 'appraisals.round']);
  });
  test('an unknown key, a deactivated person, someone without a user name and another organisation are all not there', async () => {
    const { entities, people } = standard();
    const hillevi = people.persona('hillevi');
    for (const key of ['nobody', 'bo', 'nameless', 'stranger', '', 'x'.repeat(257)])
      expect(await entities.detail(hillevi, 'person', key)).toBeUndefined();
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
    expect(await w.entities.section(hillevi, 'person', 'Anna', 'hr.skills')).toEqual({
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
