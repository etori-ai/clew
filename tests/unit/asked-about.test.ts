import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { decodeJwt } from 'jose';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import {
  CapabilityError,
  Registry,
  RelationsUnavailableError,
  Resolution,
  actorOf,
  namedInputs,
  openGovernance,
  type AboutClaim,
  type Actor,
  type Capability,
  type Connector,
  type RelationResolver,
} from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { manifestProblems } from '../../packages/connectors/src/remote';
import { parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { healthOf } from '../../packages/connectors/src/protocol';
import { connectorProblems } from '../../packages/connectors/src/validation';
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { staffUsecases } from '../../apps/server/src/modules/people/usecases';
import { entityUsecases } from '../../apps/server/src/modules/entities/usecases';
import { relationUsecases } from '../../apps/server/src/modules/entities/relations';
import { entityRoutes } from '../../apps/server/src/routes/entities';
import { executionUsecases } from '../../apps/server/src/modules/executions/usecases';
import { memoryExecutionStore } from '../../apps/server/src/modules/executions/adapters/memory';
import type { AuthorizeOptions, ExecutionSource } from '../../apps/server/src/modules/executions/model';
import { createVerifier } from '../../connectors/hello/verification.mjs';
import { callbackRefusal } from '../../apps/server/src/connectors/callback-errors';
import { testAuthority, testJwks } from '../connector-authority';

/**
 * Who may be asked about, in the core and on every path (D97 item 8, D117). The registry resolves how the caller stands
 * to every person or unit an input names, from the people directory on its memory store (D99's reporting line), before
 * any connector runs: a key outside what the capability admits never reaches the source, a single key outside it (or
 * not a string) is refused as an unknown capability is, and the source is told each key's relation, in a body the
 * assertion binds when it is remote. Every path into `Registry.run` is taken here as the server takes it: `/api/cap`
 * (`runCapability`), a card's validation, an in-process `clew.call`, the callback route's `clewFor(...).call`, the
 * entity routes, a document's bytes and a remote connector's request.
 */
const T = '2026-11-12T08:00:00.000Z';
const ORG = 'poc';
type Placement = { unitId: string; role: 'manager' | 'employee' };

/**
 * The directory, as the provisioner pushes it (D99). Förvaltningen is led by the Director and by Boss. Below it
 * Bergsåkers skola is led by Hillevi and by Cohead; the Director also holds a manager's role on the school, Boss is
 * placed there as an employee, and so is Petra, who leads Ekonomi beside the school. On the school: Anna, Erik (`Erik.S`),
 * Maria, Bo (deactivated) and one without a user name. Olle leads Fritids directly below the school, with Sven. Hassan
 * works in Hemtjänsten, outside the tree; a stranger is in another organisation.
 */
function directory() {
  const store = memoryProvisionStore(),
    s = store.state;
  const unit = (id: string, label: string, parent: string | null, organisationId = ORG) => {
    s.units.set(id, { organisationId, label });
    s.groups.set('g-' + id, {
      id: 'g-' + id,
      organisationId,
      externalId: 'unit:' + id,
      label,
      parentUnitId: parent,
      createdAt: T,
      updatedAt: T,
    });
  };
  const person = (
    id: string,
    userName: string | null,
    placements: Placement[],
    options: { enabled?: boolean; organisationId?: string } = {},
  ) => {
    s.users.set(id, {
      id,
      organisationId: options.organisationId ?? ORG,
      externalId: 'dev:' + id,
      userName,
      name: id,
      email: null,
      phoneNumbers: [],
      employments: [],
      title: null,
      enabled: options.enabled ?? true,
      createdAt: T,
      updatedAt: T,
    });
    s.assignments.set(id, placements);
    const first = placements[0]!;
    s.grants.set(id, {
      unitId: first.unitId,
      unitLabel: s.units.get(first.unitId)!.label,
      role: first.role,
      capabilities: [],
    });
  };
  const m = (unitId: string): Placement => ({ unitId, role: 'manager' });
  const e = (unitId: string): Placement => ({ unitId, role: 'employee' });
  unit('unit-top', 'Förvaltningen', null);
  unit('unit-skola', 'Bergsåkers skola', 'unit-top');
  unit('unit-fritids', 'Fritids', 'unit-skola');
  unit('unit-ekonomi', 'Ekonomi', 'unit-top');
  unit('unit-omsorg', 'Hemtjänsten', null);
  unit('unit-annan', 'Annan kommun', null, 'other');
  person('director', 'director', [m('unit-top'), m('unit-skola')]);
  person('boss', 'boss', [m('unit-top'), e('unit-skola')]);
  person('hillevi', 'hillevi', [m('unit-skola')]);
  person('cohead', 'cohead', [m('unit-skola')]);
  person('anna', 'anna', [e('unit-skola')]);
  person('erik', 'Erik.S', [e('unit-skola')]);
  person('maria', 'maria', [e('unit-skola')]);
  person('bo', 'bo', [e('unit-skola')], { enabled: false });
  person('nameless', null, [e('unit-skola')]);
  person('olle', 'olle', [m('unit-fritids')]);
  person('sven', 'sven', [e('unit-fritids')]);
  person('petra', 'petra', [m('unit-ekonomi'), e('unit-skola')]);
  person('karin', 'karin', [e('unit-ekonomi')]);
  person('hassan', 'hassan', [e('unit-omsorg')]);
  person('stranger', 'stranger', [e('unit-annan')], { organisationId: 'other' });
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
      authorize: async () => ({ version: 'v1' }),
    };
  };
  // The production binding (`composition/relations.ts`) on the memory directory: the people module's staff use cases
  // as the directory, and the person behind a call read from their current grant, nobody for an unknown or deactivated id.
  const staff = staffUsecases({ store });
  const relations = relationUsecases({
    directory: staff,
    reader: async actor => (s.users.get(actor.id)?.enabled ? persona(actor.id) : undefined),
  });
  return { persona, staff, relations, state: s };
}

const keysInput = {
  type: 'object',
  properties: { keys: { type: 'array', items: { type: 'string' }, maxItems: 200 } },
  required: ['keys'],
  additionalProperties: false,
} as never;
const rowsOutput = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      items: { type: 'object', properties: { key: { type: 'string' }, state: { type: 'string' } }, required: ['key'] },
    },
  },
  required: ['rows'],
} as never;
const personInput = (required = false) =>
  ({
    type: 'object',
    properties: { person: { type: 'string' } },
    ...(required ? { required: ['person'] } : {}),
    additionalProperties: false,
  }) as never;
const anything = { type: 'object' } as never;
const list = (open?: string) => ({
  kind: 'list' as const,
  title: 'state',
  fields: [{ key: 'state', label: 'Läge' }],
  ...(open ? { open: { capability: open, title: 'Mer', params: { person: 'key' } } } : {}),
});
const BYTES = new TextEncoder().encode('%PDF-1');
const SHA = createHash('sha256').update(BYTES).digest('hex');

/** What every source was asked, call by call: the input as it arrived and the relations it was told. */
type Seen = { name: string; input: Record<string, unknown>; about?: AboutClaim };
function sources(seen: Seen[]) {
  const record =
    (name: string, answer: (input: Record<string, unknown>) => unknown) =>
    async (_actor: Actor, input: unknown, clew: { about?: AboutClaim }) => {
      const given = input as Record<string, unknown>;
      seen.push({ name, input: given, ...(clew.about ? { about: clew.about } : {}) });
      return answer(given);
    };
  const rows = (input: Record<string, unknown>) => ({
    rows: (input.keys as string[]).map(key => ({ key, state: 'Bokat' })),
  });
  const aboutRead = (name: string, admits?: Array<'self' | 'managed' | 'colleague'>, open?: string): Capability => ({
    name,
    kind: 'read',
    title: name,
    description: 'x',
    model: false,
    scope: {},
    about: { entity: 'person' },
    ...(admits ? { person: { admits } } : {}),
    input: keysInput,
    output: rowsOutput,
    view: list(open),
    run: record(name, rows),
  });
  const unitRead = (name: string, admits?: Array<'manages' | 'member'>): Capability => ({
    name,
    kind: 'read',
    title: name,
    description: 'x',
    model: false,
    scope: {},
    about: { entity: 'unit' },
    ...(admits ? { unit: { admits } } : {}),
    input: keysInput,
    output: rowsOutput,
    view: list(),
    run: record(name, rows),
  });
  const personRead = (name: string, person?: Capability['person']): Capability => ({
    name,
    kind: 'read',
    title: name,
    description: 'x',
    model: false,
    scope: {},
    ...(person ? { person } : {}),
    input: personInput(),
    output: anything,
    run: record(name, input => ({ person: input.person ?? null })),
  });
  const src: Connector = {
    id: 'src',
    kind: 'passthrough',
    source: 'Källan',
    areas: [],
    capabilities: [
      // Undeclared: the strictest holds, and so for the read its row opens with the row's key.
      aboutRead('src.person', undefined, 'src.detail'),
      personRead('src.detail'),
      aboutRead('src.team', ['managed']),
      aboutRead('src.directory', ['self', 'managed', 'colleague']),
      personRead('src.notes', { param: 'person', admits: ['self', 'managed'] }),
      // The talks profile's read names a person by its shape (D96 item 8), declared or not.
      personRead('src.commitments'),
      {
        name: 'src.flag',
        kind: 'execute',
        title: 'Markera',
        description: 'x',
        model: false,
        scope: {},
        about: { entity: 'person', param: 'person' },
        person: { admits: ['managed'] },
        input: personInput(true),
        output: anything,
        effect: 'src.flagEffect',
        run: record('src.flag', input => ({
          headline: 'Klart.',
          rows: [{ ref: 'flag:' + input.person, label: 'Markerad', outcome: 'done', detail: 'Bekräftad' }],
        })),
      },
      // The execute's effect read declares nothing: it takes the execute's input and admits what the execute admits.
      { ...personRead('src.flagEffect'), input: personInput(true) },
      unitRead('src.unit'),
      unitRead('src.units', ['manages', 'member']),
    ],
  };
  // Clew's own domains: a composite that asks the source as the same person through `clew.call`, a read that takes a
  // person without a user name by Clew's id (as the talks domain does), and a document read whose bytes name a person.
  const core: Connector = {
    id: 'core',
    kind: 'core',
    source: 'Clew',
    areas: [],
    capabilities: [
      {
        name: 'core.ask',
        kind: 'read',
        title: 'Fråga',
        description: 'x',
        model: false,
        scope: {},
        input: { type: 'object', properties: { who: { type: 'string' } }, required: ['who'] } as never,
        output: anything,
        run: (_actor, input, clew) => clew.call('src.notes', { person: (input as { who: string }).who }),
      },
      personRead('core.points', { param: 'person', admits: ['managed'], ids: true }),
      {
        name: 'core.file',
        kind: 'read',
        title: 'Underlag',
        description: 'x',
        model: false,
        scope: {},
        person: { param: 'person', admits: ['managed'] },
        input: {
          type: 'object',
          properties: { person: { type: 'string' } },
          required: ['person'],
          additionalProperties: false,
        } as never,
        output: { type: 'object', properties: { document: { type: 'object' } } } as never,
        view: { kind: 'document', body: 'document' },
        run: record('core.file', input => ({
          document: {
            ref: 'file:' + input.person,
            revision: 'r1',
            title: 'Underlag',
            documents: [
              {
                id: 'd1',
                revision: 'r1',
                title: 'Underlag',
                filename: 'underlag.pdf',
                mediaType: 'application/pdf',
                size: BYTES.length,
                sha256: SHA,
                required: true,
              },
            ],
          },
        })),
      },
    ],
    documents: async (_actor, request, clew) => {
      seen.push({ name: 'core.file:bytes', input: request.input, ...(clew.about ? { about: clew.about } : {}) });
      return { bytes: BYTES, mediaType: 'application/pdf', revision: 'r1' };
    },
  };
  return [src, core];
}

/** The world as composition wires it: the registry with the rule installed, every connector switched on. */
function world() {
  const people = directory();
  const seen: Seen[] = [];
  const registry = new Registry({ relations: people.relations.relate });
  for (const c of sources(seen)) registry.register({ uses: ['*'], ...c }).govern(c.id, openGovernance());
  /** `/api/cap` and every other caller of `runCapability`: the registry's call path as the person. */
  const cap = (who: string, name: string, input: unknown) => registry.run(actorOf(people.persona(who)), name, input);
  const asked = (name: string) => seen.filter(s => s.name === name);
  return { people, registry, seen, cap, asked };
}

describe('the rule, resolved from the directory', () => {
  test("a manager's reports are D99's: the employees of the unit and the manager directly below; nobody else", async () => {
    const { people } = world();
    const hillevi = actorOf(people.persona('hillevi'));
    const all = ['hillevi', 'ANNA', 'erik.s', 'maria', 'olle', 'petra', 'sven', 'karin', 'bo', 'nameless', 'stranger'];
    expect(await people.relations.relate(hillevi, 'person', all, ['self', 'managed', 'colleague'])).toEqual([
      { asked: 'hillevi', key: 'hillevi', relation: 'self' },
      { asked: 'ANNA', key: 'anna', relation: 'managed' },
      { asked: 'erik.s', key: 'Erik.S', relation: 'managed' },
      { asked: 'maria', key: 'maria', relation: 'managed' },
      { asked: 'olle', key: 'olle', relation: 'managed' },
      // Placed on the school as an employee, though she leads Ekonomi beside it.
      { asked: 'petra', key: 'petra', relation: 'managed' },
      { asked: 'sven', key: 'sven', relation: 'colleague' },
      { asked: 'karin', key: 'karin', relation: 'colleague' },
    ]);
    // Only what is admitted is answered; a colleague is not even looked up when none is admitted.
    expect((await people.relations.relate(hillevi, 'person', all, ['managed'])).map(r => [r.key, r.relation])).toEqual([
      ['anna', 'managed'],
      ['Erik.S', 'managed'],
      ['maria', 'managed'],
      ['olle', 'managed'],
      ['petra', 'managed'],
    ]);
  });
  test('a co-manager of the unit and anyone who manages the reader are colleagues, never reports, though Personal lists them', async () => {
    const { people } = world();
    const hillevi = actorOf(people.persona('hillevi'));
    // Cohead leads the school with her; the Director leads Förvaltningen above it and also holds a manager's role on
    // the school; Boss leads Förvaltningen and is placed on the school as an employee. None of them reports to her.
    expect(
      await people.relations.relate(
        hillevi,
        'person',
        ['cohead', 'director', 'boss'],
        ['self', 'managed', 'colleague'],
      ),
    ).toEqual([
      { asked: 'cohead', key: 'cohead', relation: 'colleague' },
      { asked: 'director', key: 'director', relation: 'colleague' },
      { asked: 'boss', key: 'boss', relation: 'colleague' },
    ]);
    expect(await people.relations.relate(hillevi, 'person', ['cohead', 'director', 'boss'], ['managed'])).toEqual([]);
    // Personal is unchanged: it lists everyone placed on the unit she manages.
    const entities = entityUsecases({
      directory: people.staff,
      sources: { reads: async () => [], actions: async () => [] },
      read: async () => ({}),
      cards: async () => [],
    });
    const listed = (await entities.list(people.persona('hillevi'), 'person')).groups.flatMap(g =>
      g.entities.map(e => e.key),
    );
    expect(listed).toEqual(expect.arrayContaining(['cohead', 'director', 'boss', 'anna', 'olle']));
    // And the opened page says how she stands to each, by the same rule.
    expect((await entities.detail(people.persona('hillevi'), 'person', 'cohead'))?.relation).toBe('colleague');
    expect((await entities.detail(people.persona('hillevi'), 'person', 'director'))?.relation).toBe('colleague');
    expect((await entities.detail(people.persona('hillevi'), 'person', 'olle'))?.relation).toBe('managed');
  });
  test('a co-manager whose line runs to the caller is a report: the Director over the heads of the school, not the reverse', async () => {
    const { people } = world();
    // The Director leads Förvaltningen and also holds a manager's role on the school. By D99 item 4 the school's heads
    // report to the managers of the nearest led unit above it, Förvaltningen, so they report to him; Boss, who leads
    // Förvaltningen with him, does not, though placed on the school as an employee.
    const director = actorOf(people.persona('director'));
    expect(
      (
        await people.relations.relate(
          director,
          'person',
          ['hillevi', 'cohead', 'anna', 'olle', 'boss', 'petra'],
          ['self', 'managed', 'colleague'],
        )
      ).map(r => [r.key, r.relation]),
    ).toEqual([
      ['hillevi', 'managed'],
      ['cohead', 'managed'],
      ['anna', 'managed'],
      ['olle', 'managed'],
      ['boss', 'colleague'],
      ['petra', 'managed'],
    ]);
    // The reverse stays: the heads of the school do not manage the Director, they report to him.
    const hillevi = actorOf(people.persona('hillevi'));
    expect(await people.relations.relate(hillevi, 'person', ['director'], ['self', 'managed', 'colleague'])).toEqual([
      { asked: 'director', key: 'director', relation: 'colleague' },
    ]);
    expect(await people.relations.relate(hillevi, 'person', ['director'], ['managed'])).toEqual([]);
  });
  test('a unit is managed or a placement: two relations, and an unknown caller stands to nothing', async () => {
    const { people } = world();
    const petra = actorOf(people.persona('petra'));
    expect(
      await people.relations.relate(
        petra,
        'unit',
        ['unit-ekonomi', 'unit-skola', 'unit-fritids', 'UNIT-EKONOMI'],
        ['manages', 'member'],
      ),
    ).toEqual([
      { asked: 'unit-ekonomi', key: 'unit-ekonomi', relation: 'manages' },
      { asked: 'unit-skola', key: 'unit-skola', relation: 'member' },
    ]);
    expect(await people.relations.relate(petra, 'unit', ['unit-ekonomi', 'unit-skola'], ['manages'])).toEqual([
      { asked: 'unit-ekonomi', key: 'unit-ekonomi', relation: 'manages' },
    ]);
    const ghost: Actor = { id: 'ghost', name: 'x', unitId: 'unit-skola', unitLabel: 'x', role: 'manager' };
    expect(await people.relations.relate(ghost, 'person', ['anna'], ['self', 'managed', 'colleague'])).toEqual([]);
  });
  test('a unit led by a manager who reports to the caller is below: one level down, never upward, and only where admitted', async () => {
    const { people } = world();
    // Olle leads Fritids directly below the school Hillevi leads, so he reports to her (D99) and Fritids is below her.
    const hillevi = actorOf(people.persona('hillevi'));
    expect(
      await people.relations.relate(
        hillevi,
        'unit',
        ['unit-skola', 'unit-fritids', 'unit-top', 'unit-ekonomi'],
        ['manages', 'member', 'below'],
      ),
    ).toEqual([
      { asked: 'unit-skola', key: 'unit-skola', relation: 'manages' },
      { asked: 'unit-fritids', key: 'unit-fritids', relation: 'below' },
    ]);
    // A read that does not admit `below` (the default admits `manages` alone) is not asked about it.
    expect(await people.relations.relate(hillevi, 'unit', ['unit-fritids'], ['manages'])).toEqual([]);
    // Nothing upward: the school is not below the manager of Fritids.
    const olle = actorOf(people.persona('olle'));
    expect(await people.relations.relate(olle, 'unit', ['unit-skola'], ['manages', 'member', 'below'])).toEqual([]);
  });
  test('a person without a user name is named by id only where a core capability takes ids, and only as a report', async () => {
    const { people } = world();
    const hillevi = actorOf(people.persona('hillevi'));
    const admits = ['self', 'managed', 'colleague'] as const;
    expect(await people.relations.relate(hillevi, 'person', ['nameless', 'erik'], admits)).toEqual([]);
    // By id only the report without a user name; Erik has one, so his id names nobody.
    expect(await people.relations.relate(hillevi, 'person', ['nameless', 'erik'], admits, { ids: true })).toEqual([
      { asked: 'nameless', key: 'nameless', relation: 'managed' },
    ]);
    // Not someone else's report by id either.
    const olle = actorOf(people.persona('olle'));
    expect(await people.relations.relate(olle, 'person', ['nameless'], admits, { ids: true })).toEqual([]);
  });
  test('a directory that cannot be read is an error, never an empty answer', async () => {
    const { people } = world();
    const broken = relationUsecases({
      directory: people.staff,
      reader: async () => {
        throw new Error('connection reset');
      },
    });
    await expect(broken.relate(actorOf(people.persona('anna')), 'person', ['anna'], ['self'])).rejects.toThrow(
      'connection reset',
    );
  });
  test('the declaration says which inputs name an entity and what each admits; undeclared is the strictest', () => {
    const [src, core] = sources([]);
    const named = (c: Connector) =>
      Object.fromEntries([...namedInputs(c)].map(([name, n]) => [name, [n.entity, n.keys, n.params, n.admits, n.ids]]));
    expect(named(src!)).toEqual({
      'src.person': ['person', true, [], ['self', 'managed'], false],
      'src.detail': ['person', false, ['person'], ['self', 'managed'], false],
      'src.team': ['person', true, [], ['managed'], false],
      'src.directory': ['person', true, [], ['self', 'managed', 'colleague'], false],
      'src.notes': ['person', false, ['person'], ['self', 'managed'], false],
      'src.commitments': ['person', false, ['person'], ['self', 'managed'], false],
      'src.flag': ['person', false, ['person'], ['managed'], false],
      // The effect read inherits the execute's admits, not the strict default of its own.
      'src.flagEffect': ['person', false, ['person'], ['managed'], false],
      'src.unit': ['unit', true, [], ['manages'], false],
      'src.units': ['unit', true, [], ['manages', 'member'], false],
    });
    expect(named(core!)).toEqual({
      'core.points': ['person', false, ['person'], ['managed'], true],
      'core.file': ['person', false, ['person'], ['managed'], false],
    });
  });
});

describe('the loader holds every input that names someone to a plain string', () => {
  const loose = (capabilities: object[]) => ({
    id: 'src',
    kind: 'passthrough',
    source: 'Källan',
    areas: [],
    capabilities,
  });
  const person = {
    name: 'src.person',
    kind: 'read',
    title: 'p',
    description: 'x',
    model: false,
    scope: {},
    about: { entity: 'person' },
    input: keysInput,
    output: rowsOutput,
    view: list('src.detail'),
  };
  const read = (name: string, input: object, extra: object = {}) => ({
    name,
    kind: 'read',
    title: name,
    description: 'x',
    model: false,
    scope: {},
    input,
    output: anything,
    ...extra,
  });
  test('an untyped, union, array, object-only or allOf schema for a named input is refused', () => {
    for (const [what, capabilities] of [
      ['an opened read with no properties', [person, read('src.detail', { type: 'object' })]],
      [
        'an opened read whose person may be an array',
        [
          person,
          read('src.detail', {
            type: 'object',
            properties: { person: { anyOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }] } },
          }),
        ],
      ],
      [
        'a commitments read with an untyped person',
        [read('src.commitments', { type: 'object', properties: { person: {} } })],
      ],
      [
        'a commitments read whose person comes through allOf',
        [read('src.commitments', { type: 'object', allOf: [{ properties: { person: { type: 'string' } } }] })],
      ],
      ['a commitments read that names no person at all', [read('src.commitments', { type: 'object' })]],
      [
        'a declared param that is an array',
        [read('src.notes', { type: 'object', properties: { who: { type: 'array' } } }, { person: { param: 'who' } })],
      ],
    ] as const) {
      const problems = connectorProblems(loose(capabilities as unknown as object[]) as never);
      expect({ what, problems }).toEqual({
        what,
        problems: expect.arrayContaining([expect.stringContaining('must be a plain string property of the input')]),
      });
      expect(() => new Registry().register(loose(capabilities as unknown as object[]) as never)).toThrow(
        'must be a plain string property',
      );
    }
  });
  test('a manifest is refused the same way, and a unit capability declares unit, never person', () => {
    const manifest = (capabilities: object[]) => ({
      protocol: 3,
      id: 'src',
      kind: 'passthrough',
      source: 'Källan',
      areas: [],
      scan: false,
      capabilities,
    });
    expect(manifestProblems(manifest([person, read('src.detail', { type: 'object' })]), 'src')).toEqual([
      expect.stringContaining('src.detail: person names a person, so it must be a plain string property'),
    ]);
    const unit = { ...person, name: 'src.unit', about: { entity: 'unit' }, view: list() };
    expect(manifestProblems(manifest([{ ...unit, unit: { admits: ['member'] } }]), 'src')).toEqual([]);
    expect(manifestProblems(manifest([{ ...unit, person: { admits: ['managed'] } }]), 'src')).toEqual([
      expect.stringContaining('person is about people'),
    ]);
    expect(manifestProblems(manifest([{ ...person, view: list(), unit: { admits: ['manages'] } }]), 'src')).toEqual([
      expect.stringContaining('unit belongs to a capability about a unit'),
    ]);
    // Clew's id is never sent to a connector: a manifest cannot take a person by id.
    expect(
      manifestProblems(
        manifest([read('src.notes', personInput(), { person: { param: 'person', ids: true } })]),
        'src',
      ).join(),
    ).toContain('/capabilities/0/person');
  });
});

describe('/api/cap: a read asked with keys the browser chose', () => {
  test('an employee asking about a colleague on a strict read gets no row, and the source never hears the key', async () => {
    const w = world();
    expect(await w.cap('hassan', 'src.person', { keys: ['karin', 'petra'] })).toEqual({ rows: [] });
    expect(w.asked('src.person')).toEqual([
      { name: 'src.person', input: { keys: [] }, about: { entity: 'person', relations: {} } },
    ]);
  });
  test('a manager gets their reports and nobody else, each in the directory’s spelling and told as managed', async () => {
    const w = world();
    const keys = ['anna', 'ERIK.S', 'maria', 'olle', 'sven', 'karin', 'hillevi', 'cohead', 'director', 'boss', 'bo'];
    expect(await w.cap('hillevi', 'src.team', { keys })).toEqual({
      rows: ['anna', 'Erik.S', 'maria', 'olle'].map(key => ({ key, state: 'Bokat' })),
    });
    expect(w.asked('src.team')[0]).toEqual({
      name: 'src.team',
      input: { keys: ['anna', 'Erik.S', 'maria', 'olle'] },
      about: {
        entity: 'person',
        relations: { anna: 'managed', 'Erik.S': 'managed', maria: 'managed', olle: 'managed' },
      },
    });
    // Olle leads the unit below, so his own people are not Hillevi's (D99), and she is not his.
    expect(await w.cap('olle', 'src.team', { keys: ['sven', 'anna', 'hillevi'] })).toEqual({
      rows: [{ key: 'sven', state: 'Bokat' }],
    });
  });
  test('the person themself always may, by any spelling of their user name', async () => {
    const w = world();
    expect(await w.cap('anna', 'src.person', { keys: ['ANNA'] })).toEqual({ rows: [{ key: 'anna', state: 'Bokat' }] });
    expect(await w.cap('anna', 'src.notes', { person: 'Anna' })).toEqual({ person: 'anna' });
    expect(w.seen.map(s => s.about)).toEqual([
      { entity: 'person', relations: { anna: 'self' } },
      { entity: 'person', relations: { anna: 'self' } },
    ]);
  });
  test('a read that admits colleagues still answers for one, and never for someone of another organisation', async () => {
    const w = world();
    expect(await w.cap('hassan', 'src.directory', { keys: ['karin', 'petra', 'stranger', 'bo', 'hassan'] })).toEqual({
      rows: ['karin', 'petra', 'hassan'].map(key => ({ key, state: 'Bokat' })),
    });
    expect(w.asked('src.directory')[0]!.about).toEqual({
      entity: 'person',
      relations: { karin: 'colleague', petra: 'colleague', hassan: 'self' },
    });
  });
  test('an undeclared read is strict: the section read, the read its row opens and a commitments read', async () => {
    const w = world();
    expect(await w.cap('hillevi', 'src.person', { keys: ['sven', 'anna'] })).toEqual({
      rows: [{ key: 'anna', state: 'Bokat' }],
    });
    await expect(w.cap('hassan', 'src.detail', { person: 'karin' })).rejects.toThrow('Okänd förmåga.');
    await expect(w.cap('hassan', 'src.commitments', { person: 'karin' })).rejects.toThrow('Okänd förmåga.');
    expect(await w.cap('hillevi', 'src.detail', { person: 'maria' })).toEqual({ person: 'maria' });
    expect(await w.cap('hassan', 'src.commitments', { person: 'hassan' })).toEqual({ person: 'hassan' });
    // Without the key the read is the caller's own, and nothing is resolved.
    expect(await w.cap('hassan', 'src.commitments', {})).toEqual({ person: null });
    expect(w.seen.map(s => [s.name, s.input])).toEqual([
      ['src.person', { keys: ['anna'] }],
      ['src.detail', { person: 'maria' }],
      ['src.commitments', { person: 'hassan' }],
      ['src.commitments', {}],
    ]);
  });
  test('a crafted input cannot widen the reach: case, duplicates, keys beyond it, someone else, anything but a string', async () => {
    const w = world();
    const crafted = ['ANNA', 'anna', 'Anna', 'karin', ' anna', 'anna ', 'x'.repeat(300), '', 'olle', 'OLLE', 'cohead'];
    expect(await w.cap('hillevi', 'src.team', { keys: crafted })).toEqual({
      rows: [
        { key: 'anna', state: 'Bokat' },
        { key: 'olle', state: 'Bokat' },
      ],
    });
    expect(w.asked('src.team')[0]!.input).toEqual({ keys: ['anna', 'olle'] });
    // The single key must be one the caller may ask about, whatever else the input says.
    for (const person of ['karin', 'KARIN', 'stranger', 'bo', 'ghost', ''])
      await expect(w.cap('anna', 'src.notes', { person })).rejects.toThrow('Okänd förmåga.');
    // Anything but a string where a person is named is refused, declared or not, and reaches nobody.
    for (const [name, input] of [
      ['src.notes', { person: ['anna'] }],
      ['src.notes', { person: { userName: 'anna' } }],
      ['src.detail', { person: ['karin'] }],
      ['src.commitments', { person: { userName: 'karin' } }],
      ['src.team', { keys: [{ key: 'karin' }] }],
    ] as const)
      await expect(w.cap('anna', name, input)).rejects.toThrow(CapabilityError);
    expect(w.asked('src.notes')).toEqual([]);
    expect(w.asked('src.detail')).toEqual([]);
    expect(w.asked('src.commitments')).toEqual([]);
    // A caller cannot hand the registry relations of their own: what the source is told is resolved, never passed in.
    const forged = { about: { entity: 'person', relations: { karin: 'managed' } } };
    await w.registry.run(
      actorOf(w.people.persona('hillevi')),
      'src.team',
      { keys: ['karin', 'anna'] },
      forged as never,
    );
    expect(w.asked('src.team')[1]).toEqual({
      name: 'src.team',
      input: { keys: ['anna'] },
      about: { entity: 'person', relations: { anna: 'managed' } },
    });
  });
  test('a unit read is asked about the units the caller manages unless it admits placements too', async () => {
    const w = world();
    const keys = ['unit-ekonomi', 'unit-skola', 'unit-omsorg', 'unit-annan'];
    // Petra passes a manager's scope and is placed on the school, but she does not manage it.
    expect(await w.cap('petra', 'src.unit', { keys })).toEqual({ rows: [{ key: 'unit-ekonomi', state: 'Bokat' }] });
    expect(await w.cap('petra', 'src.units', { keys })).toEqual({
      rows: [
        { key: 'unit-ekonomi', state: 'Bokat' },
        { key: 'unit-skola', state: 'Bokat' },
      ],
    });
    expect(w.seen.map(s => s.about)).toEqual([
      { entity: 'unit', relations: { 'unit-ekonomi': 'manages' } },
      { entity: 'unit', relations: { 'unit-ekonomi': 'manages', 'unit-skola': 'member' } },
    ]);
  });
  test('a core capability that takes ids answers a report without a user name; nothing else is reached by id', async () => {
    const w = world();
    expect(await w.cap('hillevi', 'core.points', { person: 'nameless' })).toEqual({ person: 'nameless' });
    await expect(w.cap('hillevi', 'src.notes', { person: 'nameless' })).rejects.toThrow('Okänd förmåga.');
    await expect(w.cap('hillevi', 'core.points', { person: 'erik' })).rejects.toThrow('Okänd förmåga.');
    await expect(w.cap('olle', 'core.points', { person: 'nameless' })).rejects.toThrow('Okänd förmåga.');
    expect(w.asked('core.points')).toEqual([
      {
        name: 'core.points',
        input: { person: 'nameless' },
        about: { entity: 'person', relations: { nameless: 'managed' } },
      },
    ]);
  });
  test('a registry built without the rule fails closed: no key is sent and a single key is refused', async () => {
    const people = directory();
    const seen: Seen[] = [];
    const bare = new Registry();
    for (const c of sources(seen)) bare.register({ uses: ['*'], ...c }).govern(c.id, openGovernance());
    const anna = actorOf(people.persona('anna'));
    expect(await bare.run(anna, 'src.person', { keys: ['anna'] })).toEqual({ rows: [] });
    await expect(bare.run(anna, 'src.notes', { person: 'anna' })).rejects.toThrow(CapabilityError);
    expect(seen.map(s => s.input)).toEqual([{ keys: [] }]);
  });
  test('a directory that cannot be read refuses the call as unavailable, and the source hears nothing', async () => {
    const seen: Seen[] = [];
    const down = new Registry({
      relations: async () => {
        throw new Error('connection reset');
      },
    });
    for (const c of sources(seen)) down.register({ uses: ['*'], ...c }).govern(c.id, openGovernance());
    const anna = actorOf(directory().persona('anna'));
    await expect(down.run(anna, 'src.person', { keys: ['anna'] })).rejects.toThrow(RelationsUnavailableError);
    await expect(down.run(anna, 'src.notes', { person: 'anna' })).rejects.toThrow('Katalogen svarar inte just nu.');
    expect(seen).toEqual([]);
  });
});

describe('every other path into the registry', () => {
  test('a write about a person is refused before it is approved, and again when it runs; its effect admits the same', async () => {
    const w = world();
    const hillevi = actorOf(w.people.persona('hillevi'));
    // A card's validation (`startedCards`, the executions' approval) and its dispatch (`executions`).
    await expect(w.registry.validate(hillevi, 'src.flag', { person: 'karin' })).rejects.toThrow('Okänd förmåga.');
    await expect(w.registry.run(hillevi, 'src.flag', { person: 'karin' })).rejects.toThrow('Okänd förmåga.');
    expect((await w.registry.validate(hillevi, 'src.flag', { person: 'MARIA' })).capability.name).toBe('src.flag');
    await w.registry.run(hillevi, 'src.flag', { person: 'MARIA' });
    expect(w.asked('src.flag')).toEqual([
      { name: 'src.flag', input: { person: 'maria' }, about: { entity: 'person', relations: { maria: 'managed' } } },
    ]);
    // Reading a decision already made does not resolve whom it names (D117): the subject may have moved since.
    expect(
      (await w.registry.validate(hillevi, 'src.flag', { person: 'karin' }, [], { subjects: false })).capability.name,
    ).toBe('src.flag');
    // "Det här händer": the effect read is asked as the execute is, so the caller's own key is not let through.
    await expect(w.cap('hillevi', 'src.flagEffect', { person: 'hillevi' })).rejects.toThrow('Okänd förmåga.');
    expect(await w.cap('hillevi', 'src.flagEffect', { person: 'anna' })).toEqual({ person: 'anna' });
  });
  test('a resolution handed to a run is used once, for the same call only; anything else is resolved again', async () => {
    const w = world();
    const hillevi = actorOf(w.people.persona('hillevi'));
    const { resolution } = (await w.registry.validate(hillevi, 'src.flag', { person: 'maria' })) as {
      resolution: Resolution;
    };
    // Handed with another input it is not used: Karin is resolved, and refused.
    await expect(w.registry.run(hillevi, 'src.flag', { person: 'karin' }, { resolution })).rejects.toThrow(
      'Okänd förmåga.',
    );
    // Spent by that attempt, it is not used again either; one the registry never issued is ignored.
    await w.registry.run(hillevi, 'src.flag', { person: 'maria' }, { resolution });
    await expect(
      w.registry.run(hillevi, 'src.flag', { person: 'karin' }, { resolution: Resolution.issue() }),
    ).rejects.toThrow('Okänd förmåga.');
    expect(w.asked('src.flag').map(s => s.input)).toEqual([{ person: 'maria' }]);
  });
  test('an in-process connector’s clew.call is checked for the same person as the outer call', async () => {
    const w = world();
    expect(await w.cap('hillevi', 'core.ask', { who: 'anna' })).toEqual({ person: 'anna' });
    await expect(w.cap('hassan', 'core.ask', { who: 'karin' })).rejects.toThrow('Okänd förmåga.');
    expect(w.asked('src.notes').map(s => s.input)).toEqual([{ person: 'anna' }]);
  });
  test('a document’s bytes are asked for with the narrowed input and told the same relation', async () => {
    const w = world();
    const hillevi = actorOf(w.people.persona('hillevi'));
    const request = (person: string) => ({
      capability: 'core.file',
      input: { person },
      ref: 'file:anna',
      revision: 'r1',
      document: 'd1',
      documentRevision: 'r1',
    });
    const content = await w.registry.document(hillevi, request('ANNA'));
    expect(content.filename).toBe('underlag.pdf');
    expect(w.asked('core.file:bytes')).toEqual([
      {
        name: 'core.file:bytes',
        input: { person: 'anna' },
        about: { entity: 'person', relations: { anna: 'managed' } },
      },
    ]);
    await expect(w.registry.document(hillevi, request('karin'))).rejects.toThrow('Okänd förmåga.');
    expect(w.asked('core.file:bytes')).toHaveLength(1);
  });
  test('the entity routes ask a source only about whom it admits; a colleague’s section is no row and no call', async () => {
    const w = world();
    const entities = entityUsecases({
      directory: w.people.staff,
      sources: {
        reads: async (actor, kind) => w.registry.aboutReads(actor, kind),
        actions: async (actor, kind) => w.registry.aboutActions(actor, kind),
      },
      read: (persona, capability, input, signal) =>
        w.registry.clewFor(actorOf(persona), { signal }).call(capability, input),
      cards: async () => [],
    });
    let who = 'hassan';
    const routes = entityRoutes({
      entities,
      guard: async (c, next) => {
        c.set('session', { context: w.people.persona(who) } as never);
        await next();
      },
    });
    const section = async (key: string, capability: string) =>
      (await routes.request(`http://clew.test/person/${key}/section?capability=${capability}`)).json();
    expect(await section('karin', 'src.person')).toEqual({ capability: 'src.person', status: 'ok' });
    expect(await section('karin', 'src.directory')).toEqual({
      capability: 'src.directory',
      status: 'ok',
      row: { key: 'karin', state: 'Bokat' },
    });
    who = 'hillevi';
    expect(await section('ERIK.S', 'src.team')).toEqual({
      capability: 'src.team',
      status: 'ok',
      row: { key: 'Erik.S', state: 'Bokat' },
    });
    // Hillevi opens herself, and her co-manager: a read that admits only her reports is not asked about either.
    expect(await section('hillevi', 'src.team')).toEqual({ capability: 'src.team', status: 'ok' });
    expect(await section('cohead', 'src.team')).toEqual({ capability: 'src.team', status: 'ok' });
    // An action is offered only where the reader stands to the person as it admits: on a report, not on a colleague.
    const actions = async (key: string) =>
      (
        (await (await routes.request(`http://clew.test/person/${key}`)).json()) as {
          actions: Array<{ capability: string }>;
        }
      ).actions.map(a => a.capability);
    expect([await actions('anna'), await actions('karin'), await actions('cohead'), await actions('hillevi')]).toEqual([
      ['src.flag'],
      [],
      [],
      [],
    ]);
    // The list's lens over Personal: the co-managers and the director are listed, but the source hears only reports.
    await entities.rows(w.people.persona('hillevi'), 'person', 'src.team').catch(() => undefined);
    expect(w.seen.map(s => [s.name, s.input])).toEqual([
      ['src.directory', { keys: ['karin'] }],
      ['src.team', { keys: ['Erik.S'] }],
    ]);
  });
});

describe('a remote connector is told the relation, bound to the request', () => {
  const manifest = {
    protocol: 3,
    id: 'remote',
    kind: 'passthrough',
    source: 'Fjärrsystemet',
    areas: [],
    scan: false,
    uses: ['src.notes'],
    capabilities: [
      {
        name: 'remote.person',
        kind: 'read',
        title: 'Läget',
        description: 'x',
        model: false,
        scope: {},
        about: { entity: 'person' },
        person: { admits: ['self', 'managed'] },
        input: {
          type: 'object',
          properties: { keys: { type: 'array', items: { type: 'string' }, maxItems: 200 } },
          required: ['keys'],
        },
        output: rowsOutput,
        view: list('remote.notes'),
      },
      {
        name: 'remote.notes',
        kind: 'read',
        title: 'Anteckningar',
        description: 'x',
        model: false,
        scope: {},
        input: personInput(),
        output: anything,
      },
    ],
  };
  const secret = 'remote-transport-key-remote';
  /** The service verifies Clew's assertion with the verifier every connector in the repository carries, bound to the request. */
  async function remote(vouch?: RelationResolver) {
    const authority = await testAuthority();
    const verify = createVerifier({ secret, jwks: testJwks }, 'remote');
    const told: Array<{
      input: Record<string, unknown>;
      about: unknown;
      claims: Record<string, unknown>;
      bearer: number;
    }> = [];
    const requests: Request[] = [];
    const handle = async (request: Request) => {
      const token = (request.headers.get('authorization') ?? '').slice('Bearer '.length);
      const actor = await verify(token, request.headers.get('x-clew-connector-key'), request);
      if (!actor)
        return Response.json({ error: { code: 'denied', message: 'Ogiltigt behörighetsbevis.' } }, { status: 401 });
      const body = (await request.json()) as { input: Record<string, unknown>; about?: unknown };
      told.push({ input: body.input, about: body.about, claims: decodeJwt(token), bearer: token.length });
      const output = request.url.endsWith('/remote.person')
        ? { rows: (body.input.keys as string[]).map(key => ({ key, state: 'Bokat' })) }
        : { person: body.input.person ?? null };
      return Response.json({ output });
    };
    const fetch: FetchLike = async (url, init) => {
      const request = new Request(url, init);
      requests.push(request.clone());
      return handle(request);
    };
    const w = world();
    const registry = vouch ? new Registry({ relations: vouch }) : w.registry;
    registry
      .register(
        remoteConnector(parseManifest(manifest, 'remote'), {
          url: 'http://remote',
          key: secret,
          assert: (actor, chain, binding) => authority.assert('remote', actor, ['src.notes'], chain, binding),
          fetch,
        }),
      )
      .govern('remote', openGovernance());
    return {
      ...w,
      registry,
      cap: (who: string, name: string, input: unknown) => registry.run(actorOf(w.people.persona(who)), name, input),
      told,
      requests,
      handle,
    };
  }
  test('each key sent carries its relation in the body, which the assertion binds; the callback grant carries none', async () => {
    const w = await remote();
    expect(await w.cap('hillevi', 'remote.person', { keys: ['anna', 'sven', 'HILLEVI', 'olle', 'cohead'] })).toEqual({
      rows: ['anna', 'hillevi', 'olle'].map(key => ({ key, state: 'Bokat' })),
    });
    const [call] = w.told;
    expect(call!.input).toEqual({ keys: ['anna', 'hillevi', 'olle'] });
    expect(call!.about).toEqual({ entity: 'person', relations: { anna: 'managed', hillevi: 'self', olle: 'managed' } });
    expect(call!.claims.capability).toBe('remote.person');
    expect(call!.claims.body).toBe(
      createHash('sha256')
        .update(await w.requests[0]!.clone().text())
        .digest('base64url'),
    );
    expect(call!.claims.about).toBeUndefined();
    expect(decodeJwt(call!.claims.callback as string).about).toBeUndefined();
  });
  test('the assertion cannot be replayed with another body or on another capability', async () => {
    const w = await remote();
    await w.cap('hillevi', 'remote.person', { keys: ['anna'] });
    const original = w.requests[0]!;
    const headers = Object.fromEntries(original.headers.entries());
    const replay = (url: string, body: unknown) =>
      w.handle(new Request(url, { method: 'POST', headers, body: JSON.stringify(body) }));
    const sent = JSON.parse(await original.clone().text());
    // The same bytes pass; a widened input, a forged relation or another capability does not.
    expect(
      (await w.handle(new Request(original.url, { method: 'POST', headers, body: await original.clone().text() })))
        .status,
    ).toBe(200);
    expect((await replay(original.url, { ...sent, input: { keys: ['anna', 'karin'] } })).status).toBe(401);
    expect(
      (await replay(original.url, { ...sent, about: { entity: 'person', relations: { anna: 'self' } } })).status,
    ).toBe(401);
    expect((await replay('http://remote/clew/capabilities/remote.notes', sent)).status).toBe(401);
  });
  test('the bearer stays the same size however many long keys a call names', async () => {
    // A resolver that vouches for every key as a report: two hundred e-mail-shaped keys travel with their relations.
    const w = await remote(async (_actor, _entity, keys) =>
      keys.map(asked => ({ asked, key: asked, relation: 'managed' })),
    );
    const many = Array.from(
      { length: 200 },
      (_, i) => 'firstname.lastname' + String(i).padStart(3, '0') + '@kommun.example.se',
    );
    await w.cap('hillevi', 'remote.person', { keys: many.slice(0, 1) });
    await w.cap('hillevi', 'remote.person', { keys: many });
    const [one, all] = w.told;
    expect(Object.keys((all!.about as AboutClaim).relations)).toHaveLength(200);
    expect(all!.bearer).toBe(one!.bearer);
    // The assertion with its callback grant inside: a fixed size, well under a proxy's 8 KB header limit.
    expect(one!.bearer).toBeLessThan(4096);
  });
  test('the read a row opens names a person without declaring it, so its key is checked and told too', async () => {
    const w = await remote();
    expect(await w.cap('hillevi', 'remote.notes', { person: 'Maria' })).toEqual({ person: 'maria' });
    await expect(w.cap('hillevi', 'remote.notes', { person: 'karin' })).rejects.toThrow('Okänd förmåga.');
    expect(await w.cap('hillevi', 'remote.notes', {})).toEqual({ person: null });
    expect(w.told.map(t => [t.input, t.about])).toEqual([
      [{ person: 'maria' }, { entity: 'person', relations: { maria: 'managed' } }],
      [{}, undefined],
    ]);
  });
  test('a connector’s callback (`/api/connectors/call`) is checked as the person the connector serves', async () => {
    const w = await remote();
    // What the callback route does once the grant is verified: the person's current grant, the origin, its chain.
    const callback = (who: string, name: string, input: unknown) =>
      w.registry.clewFor(w.people.persona(who), { chain: ['remote.person'] }, 'remote').call(name, input);
    await expect(callback('hassan', 'src.notes', { person: 'karin' })).rejects.toThrow('Okänd förmåga.');
    expect(await callback('hassan', 'src.notes', { person: 'HASSAN' })).toEqual({ person: 'hassan' });
    // Only what `uses` names is reached, as before.
    await expect(callback('hassan', 'src.person', { keys: ['hassan'] })).rejects.toThrow('Okänd förmåga.');
    expect(w.asked('src.notes')).toEqual([
      { name: 'src.notes', input: { person: 'hassan' }, about: { entity: 'person', relations: { hassan: 'self' } } },
    ]);
    // What the route answers: a refused person, an unknown one and a capability not in `uses` read the same, `not-found`,
    // never the logged 503 a failure gets.
    const answer = async (name: string, input: unknown) =>
      callbackRefusal(await callback('hassan', name, input).catch(e => e));
    const unknown = { code: 'not-found', message: 'Okänd förmåga.', status: 404 } as const;
    expect(await answer('src.notes', { person: 'karin' })).toEqual(unknown);
    expect(await answer('src.notes', { person: 'nobody-at-all' })).toEqual(unknown);
    expect(await answer('src.person', { keys: ['hassan'] })).toEqual(unknown);
    expect(callbackRefusal(new RelationsUnavailableError())).toBeUndefined();
  });
  test('a connector on protocol 2 still loads for its window: no `about` in its bodies, its looser rules, and a warning', async () => {
    // Protocol 3 is a break (D60, D117): `about` in closed request objects, the binding the verifier requires, and the
    // plain-string rule. A manifest on 2, with a commitments read whose `person` is untyped, is loaded and held to 2.
    const old = {
      ...manifest,
      protocol: 2,
      capabilities: [
        ...manifest.capabilities,
        {
          name: 'remote.commitments',
          kind: 'read',
          title: 'Åtgärdspunkter',
          description: 'x',
          model: false,
          scope: {},
          input: { type: 'object', properties: { person: {} } },
          output: anything,
        },
      ],
    };
    expect(manifestProblems(old, 'remote')).toEqual([]);
    expect(manifestProblems({ ...old, protocol: 3 }, 'remote')).toEqual([
      expect.stringContaining('remote.commitments: person names a person, so it must be a plain string property'),
    ]);
    expect(manifestProblems({ ...old, protocol: 1 }, 'remote')).toEqual([expect.stringContaining('not accepted')]);
    expect(healthOf(old as never, T)).toEqual({
      status: 'protocol-outdated',
      at: T,
      detail: expect.stringContaining('declare protocol 3'),
    });
    expect(healthOf(manifest as never, T)).toEqual({ status: 'ok', at: T });
    const bodies: Array<Record<string, unknown>> = [];
    const w = world();
    w.registry
      .register(
        remoteConnector(parseManifest(old, 'remote'), {
          url: 'http://remote',
          assert: async () => 'x',
          fetch: async (url, init) => {
            const body = JSON.parse(String(init!.body)) as { input: Record<string, unknown> };
            bodies.push(body);
            return Response.json({
              output: String(url).endsWith('/remote.person')
                ? { rows: (body.input.keys as string[]).map(key => ({ key, state: 'Bokat' })) }
                : { rows: [] },
            });
          },
        }),
      )
      .govern('remote', openGovernance());
    const run = (name: string, input: unknown) => w.registry.run(actorOf(w.people.persona('hillevi')), name, input);
    // The rule still holds for it; it is only not told the relation, which its closed `CallRequest` would refuse.
    expect(await run('remote.person', { keys: ['anna', 'karin'] })).toEqual({
      rows: [{ key: 'anna', state: 'Bokat' }],
    });
    expect(bodies.map(b => Object.keys(b))).toEqual([['actor', 'input']]);
    // Its loose `person` is still resolved, and anything but a string refused, at the call.
    await expect(run('remote.commitments', { person: 'karin' })).rejects.toThrow('Okänd förmåga.');
    await expect(run('remote.commitments', { person: ['anna'] })).rejects.toThrow('Okänd förmåga.');
    expect(await run('remote.commitments', { person: 'anna' })).toEqual({ rows: [] });
    expect(bodies.at(-1)).toEqual({ actor: expect.anything(), input: { person: 'anna' } });
    // The conformance check says what administration says.
    const report = await checkConnector({
      url: 'http://remote',
      id: 'remote',
      assert: async () => 'x',
      assertForeign: async () => 'x',
      fetch: async url =>
        String(url).endsWith('/clew/manifest') ? Response.json(old) : Response.json({ output: { rows: [] } }),
    });
    expect(report.findings).toContainEqual({ level: 'warn', text: expect.stringMatching(/^protocol 2: deprecated/) });
    expect(report.items).toContainEqual(
      expect.objectContaining({ level: 'warn', label: 'Följer ett äldre protokoll' }),
    );
  });
  test('the conformance check vouches for no real key unless an operator names a person to sign as', async () => {
    const w = await remote();
    const fetch: FetchLike = async (url, init) =>
      url.endsWith('/clew/manifest') ? Response.json(manifest) : w.handle(new Request(url, init));
    const check = (about: Parameters<typeof checkConnector>[0]['about']) =>
      checkConnector({
        url: 'http://remote',
        id: 'remote',
        key: secret,
        assert: async (actor, chain, binding) => (await testAuthority()).assert('remote', actor, [], chain, binding),
        assertForeign: async () => 'x.y.z',
        fetch,
        ...(about ? { about } : {}),
      });
    const batch = () => w.told.filter(t => Array.isArray(t.input.keys) && t.about !== undefined);
    await check({ keys: ['anna', 'erik'] });
    // Without `--as`: the batch reaches the service with no key and no relation Clew would never give.
    expect(batch().map(t => [t.input, t.about])).toEqual([[{ keys: [] }, { entity: 'person', relations: {} }]]);
    w.told.length = 0;
    // With `--as`, the installation's own rule: what Clew itself would send that person, and nobody else.
    await check({
      keys: ['anna', 'ERIK.S', 'cohead', 'karin'],
      as: actorOf(w.people.persona('hillevi')),
      relations: w.people.relations.relate,
    });
    expect(batch().map(t => [t.input, t.about])).toEqual([
      [{ keys: ['anna', 'Erik.S'] }, { entity: 'person', relations: { anna: 'managed', 'Erik.S': 'managed' } }],
    ]);
  });
});

describe('an approved write about a person (executions, D45 and D117)', () => {
  /**
   * The ledger over the registry as composition wires it: an approval and a dispatch resolve whom the payload names;
   * reading a decision does not. The directory can be made to fail for a while, and Maria can move away.
   */
  function ledger() {
    const people = directory();
    const seen: Seen[] = [];
    let down = false,
      failAfterAuthorize = false,
      reads = 0;
    const registry = new Registry({
      relations: async (...args) => {
        reads++;
        if (down) throw new Error('connection reset');
        return people.relations.relate(...args);
      },
    });
    for (const c of sources(seen)) registry.register({ uses: ['*'], ...c }).govern(c.id, openGovernance());
    // As `composition/executions.ts` wires it: the resolution `authorize` made is handed to the dispatching run.
    const source: ExecutionSource = {
      async authorize(persona, operation, input, options?: AuthorizeOptions) {
        const found = await registry.validate(actorOf(persona), operation, input, [], { subjects: !options?.reading });
        // The directory fails right after the check, between the dispatch being recorded and the send.
        if (failAfterAuthorize && !options?.reading) down = true;
        return {
          connector: found.connector.id,
          safety: { strategy: 'manual' },
          needsSession: false,
          ...('resolution' in found ? { resolution: found.resolution } : {}),
        };
      },
      current: async id => people.persona(id),
      execute: async (persona, e, resolution) =>
        registry.run(actorOf(persona), e.operation, e.payload, {
          operationId: e.id,
          ...(resolution instanceof Resolution ? { resolution } : {}),
        }) as never,
      lookup: async () => undefined,
    };
    let n = 0;
    const store = memoryExecutionStore();
    const uc = executionUsecases({
      store,
      source,
      clock: () => new Date('2026-11-12T09:00:00Z'),
      ids: () => 'e' + ++n,
      digest: input => JSON.stringify(input),
    });
    const hillevi = people.persona('hillevi');
    const move = (id: string) => {
      people.state.assignments.set(id, [{ unitId: 'unit-omsorg', role: 'employee' }]);
      people.state.grants.set(id, {
        unitId: 'unit-omsorg',
        unitLabel: 'Hemtjänsten',
        role: 'employee',
        capabilities: [],
      });
    };
    return {
      uc,
      store,
      seen,
      hillevi,
      move,
      outage: (value: boolean) => {
        down = value;
      },
      failAfterAuthorize: () => {
        failAfterAuthorize = true;
      },
      reads: () => reads,
    };
  }
  test('the directory read once before the dispatch is recorded is the one the send uses: a later failure cannot strand it', async () => {
    const w = ledger();
    const e = await w.uc.approve(w.hillevi, { decisionId: 'd1', operation: 'src.flag', payload: { person: 'maria' } });
    const before = w.reads();
    w.failAfterAuthorize();
    await w.uc.progress(e.id);
    // Had the send resolved again, it would have failed after `execution.dispatched` and been settled unknown.
    expect(await w.store.read(e.id)).toMatchObject({ state: 'succeeded', reason: null });
    expect(w.reads() - before).toBe(1);
    expect(w.seen).toEqual([
      { name: 'src.flag', input: { person: 'maria' }, about: { entity: 'person', relations: { maria: 'managed' } } },
    ]);
  });
  test('a directory that cannot be read at dispatch leaves the write unsent as unavailable, not revoked', async () => {
    const w = ledger();
    const e = await w.uc.approve(w.hillevi, { decisionId: 'd1', operation: 'src.flag', payload: { person: 'maria' } });
    w.outage(true);
    await w.uc.progress(e.id);
    expect(await w.store.read(e.id)).toMatchObject({
      state: 'pending',
      reason: 'source-unavailable',
      dispatchedAt: null,
    });
    expect(w.seen).toEqual([]);
    // When the directory answers again the same approval goes out, once.
    w.outage(false);
    await w.uc.progress(e.id);
    expect(await w.store.read(e.id)).toMatchObject({ state: 'succeeded' });
    expect(w.seen.map(s => [s.name, s.input])).toEqual([['src.flag', { person: 'maria' }]]);
  });
  test('a subject who has moved away revokes a write not yet sent; only a resolved answer does', async () => {
    const w = ledger();
    const e = await w.uc.approve(w.hillevi, { decisionId: 'd1', operation: 'src.flag', payload: { person: 'maria' } });
    w.move('maria');
    await w.uc.progress(e.id);
    expect(await w.store.read(e.id)).toMatchObject({
      state: 'pending',
      reason: 'authority-revoked',
      dispatchedAt: null,
    });
    expect(w.seen).toEqual([]);
  });
  test('what was decided stays readable, and its job too, after the subject has moved away', async () => {
    const w = ledger();
    const e = await w.uc.approve(w.hillevi, { decisionId: 'd1', operation: 'src.flag', payload: { person: 'maria' } });
    await w.uc.progress(e.id);
    const job = await w.uc.approveJob(w.hillevi, {
      decisionId: 'd2',
      steps: [{ id: 's1', kind: 'execute', operation: 'src.flag', payload: { person: 'anna' } }],
    });
    await w.uc.progress(job.steps[0]!.kind === 'execute' ? job.steps[0]!.executionId : '');
    w.move('maria');
    w.move('anna');
    // The decision, the job and what is left to undo are read as they were decided (D117): not resolved again.
    expect(await w.uc.read(w.hillevi, e.id)).toMatchObject({ state: 'succeeded' });
    expect((await w.uc.readJob(w.hillevi, job.id))?.steps[0]).toMatchObject({ state: 'succeeded' });
    // Undo reaches its own answer (this write has no inverse), not "Jobbet finns inte.".
    await expect(w.uc.undoJob(w.hillevi, job.id)).rejects.toThrow('Inget att ångra.');
    // A new write about either of them is refused.
    await expect(
      w.uc.approve(w.hillevi, { decisionId: 'd3', operation: 'src.flag', payload: { person: 'anna' } }),
    ).rejects.toThrow('Okänd förmåga.');
  });
});
