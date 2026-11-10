import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import type { Actor, Capability, Connector } from '../../packages/connectors/src/index';
import { memoryConnectorStore } from '../../apps/server/src/connectors/adapters/memory';
import { connectorUsecases, type AdminDeps } from '../../apps/server/src/connectors/usecases/admin';
import type { ConnectorStore } from '../../apps/server/src/connectors/model';

/**
 * The administrator's places for a read about an entity (D97 items 3 and 4), chosen on "Anslutna system" as a view in
 * the menu is (D40): a lens under Visa, and one field as a column on "Alla", at most three columns for one entity kind
 * across every connector. Each change is an audit row in the transaction that stores it; the registry sees it at once.
 */
const T = '2026-11-10T09:00:00.000Z';
const persona = (id: string, capabilities: string[] = []): AuthenticatedContext => ({
  id,
  name: id,
  unitId: 'unit-it',
  unitLabel: 'IT',
  role: 'employee',
  organisationId: 'poc',
  principal: { id: 'person:' + id, kind: 'person' },
  capabilities,
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v1' }),
});
const mikael = persona('mikael', ['admin.connectors']),
  hassan = persona('hassan');
const reader: Actor = { id: 'hillevi', name: 'Hillevi', unitId: 'unit-skola', unitLabel: 'Skola', role: 'manager' };

const view = {
  kind: 'table' as const,
  title: 'state',
  fields: [
    { key: 'state', label: 'Status', format: 'status' as const },
    { key: 'count', label: 'Antal', format: 'number' as const },
  ],
};
const about = (name: string, title: string, entity: 'person' | 'unit' = 'person'): Capability => ({
  name,
  kind: 'read',
  title,
  description: 'x',
  model: false,
  about: { entity },
  input: {
    type: 'object',
    properties: { keys: { type: 'array', items: { type: 'string' }, maxItems: 200 } },
    required: ['keys'],
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
    },
  } as never,
  scope: {},
  view,
  run: async () => ({ rows: [] }),
});
const plainList: Capability = {
  ...about('hr.directory', 'Katalog'),
  about: undefined,
  input: { type: 'object', properties: {} } as never,
};
const book: Capability = {
  name: 'hr.book',
  kind: 'propose',
  title: 'Boka',
  description: 'x',
  model: false,
  about: { entity: 'person', param: 'person' },
  input: { type: 'object', properties: { person: { type: 'string' } }, required: ['person'] } as never,
  output: { type: 'object' } as never,
  scope: {},
  run: async () => ({}),
};
const connectors = (): Connector[] => [
  {
    id: 'hr',
    kind: 'passthrough',
    source: 'Personalsystemet',
    areas: [],
    capabilities: [
      about('hr.absence', 'Frånvaro'),
      about('hr.skills', 'Kompetenser'),
      about('hr.staffing', 'Bemanning', 'unit'),
      plainList,
      book,
    ],
  },
  {
    id: 'appraisals',
    kind: 'passthrough',
    source: 'Utvecklingssamtal',
    areas: [],
    capabilities: [about('appraisals.round', 'Samtal'), about('appraisals.plan', 'Plan')],
  },
];

async function world(options: { store?: (store: ConnectorStore) => ConnectorStore } = {}) {
  const registry = new Registry();
  for (const c of connectors()) registry.register(c);
  const store = memoryConnectorStore();
  for (const id of ['hr', 'appraisals'])
    await store.transaction(tx =>
      tx.insert({
        id,
        bundled: true,
        url: null,
        secret: null,
        state: 'enabled',
        manifest: null,
        health: { status: 'ok', at: T },
        createdBy: 'system',
        at: T,
      }),
    );
  const deps: AdminDeps = {
    store: options.store ? options.store(store) : store,
    registry,
    clock: () => new Date(T),
    live: { register() {}, unregister() {} },
    units: { list: async () => [] },
    groups: { list: async () => [] },
    secrets: { seal: v => v, open: v => v },
    transport: {
      fetchManifest: async () => {
        throw new Error('not used');
      },
      check: async () => {
        throw new Error('not used');
      },
    },
  };
  return { registry, store, admin: connectorUsecases(deps) };
}
const audited = (store: ReturnType<typeof memoryConnectorStore>, action: string) =>
  store.audit.filter(a => a.action === action).map(a => ({ subject: a.subject, actor: a.actor, details: a.details }));
const capability = (detail: { capabilities: Array<{ name: string }> }, name: string) =>
  detail.capabilities.find(c => c.name === name)!;

describe('a lens under Visa', () => {
  test('an administrator offers a read about a person as a lens and takes it back, one audit row each; the registry sees it at once', async () => {
    const { admin, store, registry } = await world();
    const on = await admin.update(mikael, 'hr', { lens: { 'hr.absence': true } });
    expect(capability(on, 'hr.absence')).toMatchObject({ about: 'person', lens: { on: true } });
    expect((await store.read('hr'))!.capabilities).toEqual({ 'hr.absence': { lens: true } });
    expect(registry.aboutReads(reader, 'person').find(r => r.name === 'hr.absence')?.lens).toBe(true);
    // The same choice again changes nothing and writes nothing.
    await admin.update(mikael, 'hr', { lens: { 'hr.absence': true } });
    const off = await admin.update(mikael, 'hr', { lens: { 'hr.absence': false } });
    expect(capability(off, 'hr.absence')).toMatchObject({ lens: { on: false } });
    expect((await store.read('hr'))!.capabilities).toEqual({});
    expect(registry.aboutReads(reader, 'person').find(r => r.name === 'hr.absence')?.lens).toBe(false);
    expect(audited(store, 'connector.lens')).toEqual([
      {
        subject: 'connector:hr',
        actor: 'person:mikael',
        details: { capability: 'hr.absence', to: true, title: 'Frånvaro' },
      },
      {
        subject: 'connector:hr',
        actor: 'person:mikael',
        details: { capability: 'hr.absence', to: false, title: 'Frånvaro' },
      },
    ]);
  });
  test('only a read about an entity with a table or list can be a lens; the page is told which can', async () => {
    const { admin, store } = await world();
    const detail = await admin.read(mikael, 'hr');
    expect(capability(detail, 'hr.directory')).not.toHaveProperty('lens');
    expect(capability(detail, 'hr.directory')).not.toHaveProperty('about');
    expect(capability(detail, 'hr.book')).toMatchObject({ about: 'person' });
    expect(capability(detail, 'hr.book')).not.toHaveProperty('lens');
    expect(capability(detail, 'hr.staffing')).toMatchObject({ about: 'unit', lens: { on: false } });
    await expect(admin.update(mikael, 'hr', { lens: { 'hr.directory': true } })).rejects.toThrow(
      'Förmågan kan inte erbjudas under Visa',
    );
    await expect(admin.update(mikael, 'hr', { lens: { 'hr.book': true } })).rejects.toThrow(
      'Förmågan kan inte erbjudas under Visa',
    );
    await expect(admin.update(mikael, 'hr', { lens: { 'hr.nothing': true } })).rejects.toThrow(
      'Okänd förmåga: hr.nothing',
    );
    await expect(admin.update(hassan, 'hr', { lens: { 'hr.absence': true } })).rejects.toThrow();
    expect(store.audit).toEqual([]);
  });
});

describe('a column on "Alla"', () => {
  test('one field of the view as a column, changed and taken out, each with an audit row naming the field', async () => {
    const { admin, store, registry } = await world();
    const set = await admin.update(mikael, 'hr', { column: { 'hr.absence': 'state' } });
    expect(capability(set, 'hr.absence')).toMatchObject({
      column: {
        fields: [
          { key: 'state', label: 'Status' },
          { key: 'count', label: 'Antal' },
        ],
        on: 'state',
      },
    });
    expect(registry.aboutReads(reader, 'person').find(r => r.name === 'hr.absence')?.column).toBe('state');
    await admin.update(mikael, 'hr', { column: { 'hr.absence': 'count' } });
    await admin.update(mikael, 'hr', { column: { 'hr.absence': null } });
    expect((await store.read('hr'))!.capabilities).toEqual({});
    expect(audited(store, 'connector.column').map(a => a.details)).toEqual([
      { capability: 'hr.absence', to: 'state', from: null, label: 'Status' },
      { capability: 'hr.absence', to: 'count', from: 'state', label: 'Antal' },
      { capability: 'hr.absence', to: null, from: 'count' },
    ]);
  });
  test('a column only from a read about an entity, and only a field its view has', async () => {
    const { admin, store } = await world();
    await expect(admin.update(mikael, 'hr', { column: { 'hr.directory': 'state' } })).rejects.toThrow(
      'Förmågan kan inte ge en kolumn under Alla',
    );
    await expect(admin.update(mikael, 'hr', { column: { 'hr.book': 'person' } })).rejects.toThrow(
      'Förmågan kan inte ge en kolumn under Alla',
    );
    await expect(admin.update(mikael, 'hr', { column: { 'hr.absence': 'secret' } })).rejects.toThrow(
      'Fältet finns inte i förmågans vy: secret',
    );
    expect(store.audit).toEqual([]);
  });
  test('at most three columns for people across every connector; units count apart; a freed place can be taken', async () => {
    const { admin, store } = await world();
    await admin.update(mikael, 'hr', { column: { 'hr.absence': 'state', 'hr.skills': 'count' } });
    await admin.update(mikael, 'appraisals', { column: { 'appraisals.round': 'state' } });
    const before = await store.read('appraisals');
    await expect(admin.update(mikael, 'appraisals', { column: { 'appraisals.plan': 'state' } })).rejects.toThrow(
      'Högst 3 kolumner kan visas under Alla för personer. Ta bort en annan kolumn först.',
    );
    expect(await store.read('appraisals')).toEqual(before);
    expect(audited(store, 'connector.column')).toHaveLength(3);
    // Another field of a read that already gives a column, and a column about units, are no new column for people.
    await admin.update(mikael, 'hr', { column: { 'hr.absence': 'count', 'hr.staffing': 'state' } });
    // A freed place can be taken, by a new column and a changed one in one change; a fourth is refused again.
    await admin.update(mikael, 'hr', { column: { 'hr.skills': null } });
    await expect(
      admin.update(mikael, 'appraisals', { column: { 'appraisals.plan': 'state', 'appraisals.round': 'count' } }),
    ).resolves.toBeDefined();
    await expect(admin.update(mikael, 'hr', { column: { 'hr.skills': 'state' } })).rejects.toThrow('Högst 3');
    const detail = await admin.read(mikael, 'appraisals');
    expect(capability(detail, 'appraisals.plan')).toMatchObject({ column: { on: 'state' } });
  });
});

describe('the choices and the rest of the row', () => {
  test("switching a capability off and on keeps where an administrator placed it, as the menu's place is kept", async () => {
    const { admin, store } = await world();
    await admin.update(mikael, 'hr', { lens: { 'hr.absence': true }, column: { 'hr.absence': 'state' } });
    await admin.update(mikael, 'hr', { capabilities: { 'hr.absence': { enabled: false } } });
    expect((await store.read('hr'))!.capabilities).toEqual({
      'hr.absence': { enabled: false, lens: true, column: 'state' },
    });
    await admin.update(mikael, 'hr', { capabilities: { 'hr.absence': {} } });
    expect((await store.read('hr'))!.capabilities).toEqual({ 'hr.absence': { lens: true, column: 'state' } });
  });
  test('a write that fails after the first audit row leaves nothing behind', async () => {
    let writes = 0;
    const { admin, store, registry } = await world({
      store: inner => ({
        ...inner,
        transaction: fn =>
          inner.transaction(tx =>
            fn({
              ...tx,
              writeAudit: async entry => {
                if (++writes === 2) throw new Error('The disk is full.');
                await tx.writeAudit(entry);
              },
            }),
          ),
      }),
    });
    await expect(
      admin.update(mikael, 'hr', { lens: { 'hr.absence': true }, column: { 'hr.absence': 'state' } }),
    ).rejects.toThrow('The disk is full.');
    expect((await store.read('hr'))!.capabilities).toEqual({});
    expect((await store.read('hr'))!.version).toBe(1);
    expect(store.audit).toEqual([]);
    expect(registry.aboutReads(reader, 'person').find(r => r.name === 'hr.absence')).toMatchObject({ lens: false });
  });
});
