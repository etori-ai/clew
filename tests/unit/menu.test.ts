import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { SignJWT } from 'jose';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import {
  audiencedActorOf,
  menuEligible,
  menuProblem,
  menuRowOf,
  type Actor,
  type Capability,
  type Connector,
} from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import {
  ManifestError,
  fetchManifest,
  parseManifest,
  remoteConnector,
  type FetchLike,
} from '../../packages/connectors/src/remote';
import type { ConnectorManifest } from '../../packages/connectors/src/protocol';
import { createConnector as createHello } from '../../connectors/hello/connector.mjs';
import {
  createConnector as createTelefonbok,
  manifest as phonebookManifest,
} from '../../connectors/phonebook/connector.mjs';
import { memoryConnectorStore } from '../../apps/server/src/connectors/adapters/memory';
import { connectorUsecases, type AdminDeps } from '../../apps/server/src/connectors/usecases/admin';
import { applyRow, type ReconcileDeps } from '../../apps/server/src/connectors/reconcile';
import { describeBundled } from '../../apps/server/src/connectors/describe';

/**
 * Views as tools in the menu (D40): which views can be one, what a connector may say about its row, who gets a row, and
 * the administrator's choice, view by view, with its audit row. The phone book runs in process behind a fetch, on the
 * memory store.
 */
const persona = (
  id: string,
  role: 'manager' | 'employee',
  unitId: string,
  capabilities: string[] = [],
): AuthenticatedContext => ({
  id,
  name: id,
  unitId,
  unitLabel: 'Enheten',
  role,
  organisationId: 'sundsvall',
  principal: { id: 'person:' + id, kind: 'person' },
  capabilities,
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  async authorize() {
    return { version: 'v1' };
  },
});
const mikael = persona('mikael', 'employee', 'unit-it', ['admin.connectors']),
  hassan = persona('hassan', 'employee', 'unit-skola');
const SECRET = 'test-secret-test-secret';
const T0 = '2026-11-05T12:00:00.000Z';
const sign = (secret: string, aud: string) => (actor: Actor) =>
  new SignJWT({ actor })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuer('clew')
    .setAudience(aud)
    .setSubject(actor.id)
    .setIssuedAt()
    .setExpirationTime('2m')
    .sign(new TextEncoder().encode(secret));
const search = {
  connector: 'phonebook',
  source: 'Telefonboken',
  capability: 'phonebook.directory',
  title: 'Sök i telefonboken',
  label: 'Telefonbok',
  icon: 'phone',
};
const team = {
  connector: 'phonebook',
  source: 'Telefonboken',
  capability: 'phonebook.team',
  title: 'Mitt teams kontaktlista',
  label: 'Mitt team',
  icon: 'people',
};
const base = phonebookManifest as unknown as ConnectorManifest;
/** The phone book's manifest with one capability changed. */
const withCapability = (name: string, change: (c: ConnectorManifest['capabilities'][number]) => unknown) => ({
  ...base,
  capabilities: base.capabilities.map(c => (c.name === name ? change(c) : c)),
});
const withoutHints = { ...base, capabilities: base.capabilities.map(({ menu: _menu, ...c }) => c) };

function world() {
  const registry = new Registry();
  const store = memoryConnectorStore();
  const phonebook = createTelefonbok({ secret: SECRET });
  const hello = createHello({
    secret: SECRET,
    clewUrl: 'http://clew',
    fetch: async () => Response.json({ output: { events: [] } }),
  });
  // What the phone book serves as its manifest, so a test can change it between two fetches.
  const served: { manifest: unknown } = { manifest: base };
  const fetchLike: FetchLike = async (input, init) => {
    if (input.startsWith('http://hello')) return hello.handle(new Request(input, init));
    if (input.endsWith('/clew/manifest')) return Response.json(served.manifest);
    return phonebook.handle(new Request(input, init));
  };
  const live = {
    register(source: { id: string; url: string; secret: string }, manifest: ConnectorManifest) {
      registry.replace(
        remoteConnector(manifest, { url: source.url, assert: sign(source.secret, source.id), fetch: fetchLike }),
      );
    },
    unregister(id: string) {
      registry.unregister(id);
    },
  };
  const deps: AdminDeps = {
    store,
    registry,
    clock: () => new Date(T0),
    live,
    units: { list: async () => [] },
    groups: { list: async () => [] },
    secrets: { seal: (v, id) => `sealed(${id}):${v}`, open: (s, id) => s.replace(`sealed(${id}):`, '') },
    transport: {
      fetchManifest: (url, id) => fetchManifest(url, id, fetchLike),
      check: ({ url, id, secret }) =>
        checkConnector({
          url,
          id,
          assert: sign(secret, id),
          assertForeign: sign('another-secret-another', id),
          fetch: fetchLike,
        }),
    },
  };
  const reconcile = (target: Registry): ReconcileDeps => ({
    registry: target,
    store,
    secrets: deps.secrets,
    bundled: [],
    clock: deps.clock,
    log: () => undefined,
    live: {
      register(source, manifest) {
        target.replace(
          remoteConnector(manifest, { url: source.url, assert: sign(source.secret, source.id), fetch: fetchLike }),
        );
      },
      unregister(id) {
        target.unregister(id);
      },
    },
  });
  return { registry, store, admin: connectorUsecases(deps), served, reconcile };
}
const menuAudit = (store: ReturnType<typeof memoryConnectorStore>) =>
  store.audit.filter(a => a.action === 'connector.menu');
const labels = (registry: Registry, who: AuthenticatedContext) =>
  registry.menu(audiencedActorOf(who)).map(e => e.label);

describe('which views can be tools, and what a connector may say about its row', () => {
  const view = { kind: 'text' as const, body: 'text' };
  const list = {
    name: 'x.list',
    kind: 'read',
    title: 'Visa listan',
    input: { type: 'object', properties: { query: {} } },
    output: {},
    view,
  };
  const card = {
    name: 'x.card',
    kind: 'read',
    title: 'Kort',
    input: { type: 'object', properties: { ref: {} }, required: ['ref'] },
    output: {},
    view,
  };
  const plain = { name: 'x.plain', kind: 'read', title: 'Utan vy', input: {}, output: {} };
  const act = { name: 'x.do', kind: 'execute', title: 'Gör', input: {}, output: {}, view };
  const hint = { label: 'Lista', icon: 'book' as const };
  test('a tool is a read with a declared view that opens without input; a row is one click and no question', () => {
    expect([list, card, plain, act].map(c => menuEligible(c))).toEqual([true, false, false, false]);
  });
  test("the row takes the connector's name and icon for it, and without them the capability's title and a plain icon", () => {
    expect(menuRowOf({ ...list, menu: hint })).toEqual({ label: 'Lista', icon: 'book' });
    expect(menuRowOf(list)).toEqual({ label: 'Visa listan', icon: 'document' });
    expect(menuRowOf(card)).toBeUndefined();
  });
  test('a connector may name a row only on a view that can be a tool', () => {
    expect(menuProblem({ ...list, menu: hint })).toBeUndefined();
    expect(menuProblem(list)).toBeUndefined();
    expect(menuProblem({ ...card, menu: hint })).toMatch(/needs input/);
    expect(menuProblem({ ...plain, menu: hint })).toMatch(/declares none/);
    expect(menuProblem({ ...act, menu: hint })).toMatch(/only a read/);
  });
  test("the manifest loader holds a remote connector to it: several views may be named, a label must fit, an icon is one of Clew's, and nothing else rides along", () => {
    const manifest = parseManifest(phonebookManifest, 'phonebook');
    expect(manifest.capabilities.filter(c => c.menu).map(c => [c.name, c.menu])).toEqual([
      ['phonebook.directory', { label: 'Telefonbok', icon: 'phone' }],
      ['phonebook.team', { label: 'Mitt team', icon: 'people' }],
    ]);
    expect(() =>
      parseManifest(withCapability('phonebook.person', c => ({ ...c, menu: { label: 'Kort', icon: 'people' } }))),
    ).toThrow(ManifestError);
    expect(() =>
      parseManifest(withCapability('phonebook.person', c => ({ ...c, menu: { label: 'Kort', icon: 'people' } }))),
    ).toThrow(/needs input.*D40/);
    expect(() =>
      parseManifest(withCapability('phonebook.fetch', c => ({ ...c, menu: { label: 'Hämta', icon: 'link' } }))),
    ).toThrow(/D40/);
    expect(() =>
      parseManifest(
        withCapability('phonebook.team', c => ({
          ...c,
          menu: { label: 'Hela mitt teams kontaktlista', icon: 'people' },
        })),
      ),
    ).toThrow(/Invalid connector manifest/);
    expect(() =>
      parseManifest(withCapability('phonebook.team', c => ({ ...c, menu: { label: 'Mitt team', icon: '<svg/>' } }))),
    ).toThrow(/Invalid connector manifest/);
    expect(() =>
      parseManifest(
        withCapability('phonebook.team', c => ({
          ...c,
          menu: { label: 'Mitt team', icon: 'people', href: 'https://example.com' },
        })),
      ),
    ).toThrow(/Invalid connector manifest/);
    // The connector-wide row of the first build is not a thing a manifest can carry.
    expect(() =>
      parseManifest({ ...base, menu: { capability: 'phonebook.directory', label: 'Telefonbok', icon: 'phone' } }),
    ).toThrow(/Invalid connector manifest/);
  });
  test('a bundled connector is held to the same rule when it registers, and its description carries the name', () => {
    const run = async () => ({ text: '' });
    const capability = (over: Partial<Capability>): Capability => ({
      name: 'x.list',
      kind: 'read',
      title: 'Visa listan',
      description: 'En lista.',
      input: {} as never,
      output: {} as never,
      model: false,
      scope: {},
      view,
      run,
      ...over,
    });
    const connector = (c: Capability): Connector => ({
      id: 'x',
      kind: 'derived',
      source: 'X',
      areas: [],
      capabilities: [c],
    });
    expect(() => new Registry().register(connector(capability({ view: undefined, menu: hint })))).toThrow(/D40/);
    const ok = connector(capability({ menu: hint }));
    expect(new Registry().register(ok).find('x.list')!.capability.menu).toEqual(hint);
    expect(describeBundled(ok).capabilities[0]!.menu).toEqual(hint);
  });
});

describe('who gets a row', () => {
  const registry = () =>
    new Registry().register(
      remoteConnector(parseManifest(phonebookManifest, 'phonebook'), {
        url: 'http://phonebook',
        assert: sign(SECRET, 'phonebook'),
        fetch: async () => Response.json({}),
      }),
    );
  const governed = (
    capabilities: Record<string, { enabled?: false; model?: false; menu?: true }>,
    over: object = {},
  ) => ({
    state: 'enabled' as const,
    audience: { mode: 'all' as const },
    scanEnabled: true,
    toolsEnabled: true,
    capabilities,
    ...over,
  });
  test('nobody until an administrator chooses the view: naming a row does not take a place in the menu', () => {
    const r = registry();
    expect(r.menu(audiencedActorOf(hassan))).toEqual([]);
    r.govern('phonebook', governed({}));
    expect(r.menu(audiencedActorOf(hassan))).toEqual([]);
    r.govern('phonebook', governed({ 'phonebook.directory': { menu: true } }));
    expect(r.menu(audiencedActorOf(hassan))).toEqual([search as never]);
  });
  test('each view is chosen by itself, and several of one connector come in alphabetical order', () => {
    const r = registry();
    r.govern('phonebook', governed({ 'phonebook.team': { menu: true } }));
    expect(r.menu(audiencedActorOf(hassan))).toEqual([team as never]);
    r.govern('phonebook', governed({ 'phonebook.directory': { menu: true }, 'phonebook.team': { menu: true } }));
    expect(r.menu(audiencedActorOf(hassan))).toEqual([team, search] as never[]);
  });
  test('only a person in the audience, only while the connector and the read are on, and never a view that cannot be a tool', () => {
    const r = registry();
    const both = { 'phonebook.directory': { menu: true as const }, 'phonebook.team': { menu: true as const } };
    r.govern('phonebook', governed(both, { audience: { mode: 'selected', units: ['unit-it'] } }));
    expect(labels(r, hassan)).toEqual([]);
    expect(labels(r, mikael)).toEqual(['Mitt team', 'Telefonbok']);
    r.govern('phonebook', governed(both, { state: 'disabled' }));
    expect(labels(r, mikael)).toEqual([]);
    r.govern('phonebook', governed({ ...both, 'phonebook.directory': { enabled: false, menu: true } }));
    expect(labels(r, mikael)).toEqual(['Mitt team']);
    // The contact card needs a reference: a stored choice for it is never a row.
    r.govern('phonebook', governed({ 'phonebook.person': { menu: true } }));
    expect(labels(r, mikael)).toEqual([]);
  });
  test('an audience of one provisioned group gives its members the row and nobody else (D68)', () => {
    const r = registry();
    const both = { 'phonebook.directory': { menu: true as const }, 'phonebook.team': { menu: true as const } };
    r.govern('phonebook', governed(both, { audience: { mode: 'selected', groups: ['S-1-5-21-vaxeln'] } }));
    expect(labels(r, { ...hassan, groups: ['S-1-5-21-vaxeln'] })).toEqual(['Mitt team', 'Telefonbok']);
    expect(labels(r, { ...hassan, groups: ['S-1-5-21-annan'] })).toEqual([]);
    expect(labels(r, mikael)).toEqual([]);
  });
  test('tools of several connectors come in one alphabetical order, whatever order they were registered in', () => {
    const run = async () => ({ text: '' });
    const tool = (id: string, label: string): Connector => ({
      id,
      kind: 'derived',
      source: id,
      areas: [],
      capabilities: [
        {
          name: id + '.open',
          kind: 'read',
          title: label,
          description: label,
          input: {} as never,
          output: {} as never,
          model: false,
          scope: {},
          view: { kind: 'text', body: 'text' },
          run,
        },
      ],
    });
    const r = new Registry();
    for (const [id, label] of [
      ['c', 'Ärenden'],
      ['a', 'Östra arkivet'],
      ['b', 'Avtal'],
    ] as const) {
      r.register(tool(id, label));
      r.govern(id, governed({ [id + '.open']: { menu: true } }));
    }
    expect(labels(r, hassan)).toEqual(['Avtal', 'Ärenden', 'Östra arkivet']);
  });
});

describe('every read a person may open is a view with a page of its own (D116)', () => {
  const registry = () =>
    new Registry().register(
      remoteConnector(parseManifest(phonebookManifest, 'phonebook'), {
        url: 'http://phonebook',
        assert: sign(SECRET, 'phonebook'),
        fetch: async () => Response.json({}),
      }),
    );
  const on = (over: object = {}) => ({
    state: 'enabled' as const,
    audience: { mode: 'all' as const },
    scanEnabled: true,
    toolsEnabled: true,
    capabilities: {},
    ...over,
  });
  test('each read with its title and the kind of view it declares, placed in the menu or not', () => {
    const r = registry();
    r.govern('phonebook', on());
    expect(r.views(audiencedActorOf(hassan))).toEqual([
      { capability: 'phonebook.directory', title: 'Sök i telefonboken', kind: 'table' },
      { capability: 'phonebook.team', title: 'Mitt teams kontaktlista', kind: 'list' },
      { capability: 'phonebook.person', title: 'Kontaktkort', kind: 'detail' },
      { capability: 'phonebook.search', title: 'Sök person', kind: 'list' },
      // A read that declares no view is listed without a kind: it opens beside the page, and a page if it has rows.
      { capability: 'phonebook.fetch', title: 'Hämta person' },
    ]);
  });
  test('a read the person may not call is missing, exactly as one that does not exist', () => {
    const r = registry();
    r.govern('phonebook', on({ audience: { mode: 'selected', units: ['unit-it'] } }));
    expect(r.views(audiencedActorOf(hassan))).toEqual([]);
    expect(r.views(audiencedActorOf(mikael)).map(v => v.capability)).toContain('phonebook.directory');
    r.govern('phonebook', on({ capabilities: { 'phonebook.directory': { enabled: false } } }));
    expect(r.views(audiencedActorOf(hassan)).map(v => v.capability)).not.toContain('phonebook.directory');
    r.govern('phonebook', on({ state: 'disabled' }));
    expect(r.views(audiencedActorOf(hassan))).toEqual([]);
  });
});

describe('the administrator chooses, view by view', () => {
  test('a new connector lists the views that can be tools, all off; choosing one is one audit row and the row is there for the audience at once', async () => {
    const { admin, store, registry } = world();
    const { connector, report } = await admin.add(mikael, {
      id: 'phonebook',
      url: 'http://phonebook',
      secret: SECRET,
    });
    expect(report.items.find(i => i.label === 'Verktyg i menyn')?.description).toBe(
      'Telefonbok, Mitt team kan väljas till menyn av en administratör.',
    );
    expect(connector.capabilities.map(c => [c.name, c.menu])).toEqual([
      ['phonebook.directory', { label: 'Telefonbok', icon: 'phone', on: false }],
      ['phonebook.team', { label: 'Mitt team', icon: 'people', on: false }],
      ['phonebook.person', null],
      ['phonebook.search', null],
      ['phonebook.fetch', null],
    ]);
    await admin.update(mikael, 'phonebook', { state: 'enabled' });
    expect(registry.menu(audiencedActorOf(hassan))).toEqual([]);
    expect((await admin.preview(mikael, 'phonebook', { role: 'employee' })).menu).toEqual([]);

    const updated = await admin.update(mikael, 'phonebook', { menu: { 'phonebook.directory': true } });
    expect(updated.capabilities.filter(c => c.menu?.on).map(c => c.name)).toEqual(['phonebook.directory']);
    expect((await store.read('phonebook'))!.capabilities).toEqual({ 'phonebook.directory': { menu: true } });
    expect(menuAudit(store)).toEqual([
      {
        actor: 'person:mikael',
        action: 'connector.menu',
        subject: 'connector:phonebook',
        at: T0,
        details: { capability: 'phonebook.directory', to: true, label: 'Telefonbok' },
      },
    ]);
    expect(registry.menu(audiencedActorOf(hassan))).toEqual([search as never]);
    // The same choice again changes nothing and writes nothing.
    await admin.update(mikael, 'phonebook', { menu: { 'phonebook.directory': true } });
    expect(menuAudit(store)).toHaveLength(1);

    // A second view of the same connector, and the first one out, in one go: one audit row each.
    await admin.update(mikael, 'phonebook', { menu: { 'phonebook.team': true, 'phonebook.directory': false } });
    expect(registry.menu(audiencedActorOf(hassan))).toEqual([team as never]);
    expect((await store.read('phonebook'))!.capabilities).toEqual({ 'phonebook.team': { menu: true } });
    expect(menuAudit(store).map(a => a.details)).toEqual([
      { capability: 'phonebook.directory', to: true, label: 'Telefonbok' },
      { capability: 'phonebook.team', to: true, label: 'Mitt team' },
      { capability: 'phonebook.directory', to: false, label: 'Telefonbok' },
    ]);
    expect((await admin.preview(mikael, 'phonebook', { role: 'employee' })).menu).toEqual(['Mitt team']);
  });
  test("the choice and the capability's own switches do not disturb each other", async () => {
    const { admin, store, registry } = world();
    await admin.add(mikael, { id: 'phonebook', url: 'http://phonebook', secret: SECRET });
    await admin.update(mikael, 'phonebook', {
      state: 'enabled',
      menu: { 'phonebook.directory': true },
      capabilities: { 'phonebook.directory': { model: false } },
    });
    expect((await store.read('phonebook'))!.capabilities).toEqual({
      'phonebook.directory': { model: false, menu: true },
    });
    // Switched off, the view is out of the menu; switched on again, it is back without being chosen again.
    await admin.update(mikael, 'phonebook', { capabilities: { 'phonebook.directory': { enabled: false } } });
    expect((await store.read('phonebook'))!.capabilities).toEqual({
      'phonebook.directory': { enabled: false, menu: true },
    });
    expect(registry.menu(audiencedActorOf(hassan))).toEqual([]);
    await admin.update(mikael, 'phonebook', { capabilities: { 'phonebook.directory': {} } });
    expect(registry.menu(audiencedActorOf(hassan))).toEqual([search as never]);
    await admin.update(mikael, 'phonebook', { menu: { 'phonebook.directory': false } });
    expect((await store.read('phonebook'))!.capabilities).toEqual({});
  });
  test('only an administrator may, and a view that cannot be a tool, or does not exist, is refused in Swedish with nothing written', async () => {
    const { admin, store } = world();
    await admin.add(mikael, { id: 'phonebook', url: 'http://phonebook', secret: SECRET });
    await expect(admin.update(hassan, 'phonebook', { menu: { 'phonebook.directory': true } })).rejects.toThrow(
      /behörighet/,
    );
    await expect(admin.update(mikael, 'phonebook', { menu: { 'phonebook.person': true } })).rejects.toThrow(
      'Förmågan kan inte ligga i menyn',
    );
    await expect(admin.update(mikael, 'phonebook', { menu: { 'phonebook.nothing': true } })).rejects.toThrow(
      'Okänd förmåga',
    );
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    const hello = await admin.read(mikael, 'hello');
    expect(hello.capabilities.every(c => c.menu === null)).toBe(true);
    await expect(admin.update(mikael, 'hello', { menu: { 'hello.greeting': true } })).rejects.toThrow(
      'Förmågan kan inte ligga i menyn',
    );
    expect(menuAudit(store)).toEqual([]);
    expect((await store.read('phonebook'))!.capabilities).toEqual({});
  });
  test("a connector that names no row still has its views to choose from, under the capability's title", async () => {
    const { admin, registry, served } = world();
    served.manifest = withoutHints;
    const { connector } = await admin.add(mikael, { id: 'phonebook', url: 'http://phonebook', secret: SECRET });
    expect(connector.capabilities.find(c => c.name === 'phonebook.team')!.menu).toEqual({
      label: 'Mitt teams kontaktlista',
      icon: 'document',
      on: false,
    });
    await admin.update(mikael, 'phonebook', { state: 'enabled', menu: { 'phonebook.team': true } });
    expect(registry.menu(audiencedActorOf(hassan))).toEqual([
      { ...team, label: 'Mitt teams kontaktlista', icon: 'document' } as never,
    ]);
    // The service starts naming its rows: the refetched manifest lists the capabilities as changed, and the chosen view takes the name.
    served.manifest = base;
    expect((await admin.refreshManifest(mikael, 'phonebook', {})).diff).toMatchObject({
      same: false,
      changed: ['phonebook.directory', 'phonebook.team'],
    });
    await admin.refreshManifest(mikael, 'phonebook', { apply: true });
    expect(registry.menu(audiencedActorOf(hassan))).toEqual([team as never]);
  });
  test('a view that stops being a tool in a new manifest drops out of the menu, though it was chosen', async () => {
    const { admin, registry, served } = world();
    await admin.add(mikael, { id: 'phonebook', url: 'http://phonebook', secret: SECRET });
    await admin.update(mikael, 'phonebook', {
      state: 'enabled',
      menu: { 'phonebook.team': true, 'phonebook.directory': true },
    });
    served.manifest = withCapability('phonebook.team', ({ view: _view, menu: _menu, ...c }) => c);
    const applied = await admin.refreshManifest(mikael, 'phonebook', { apply: true });
    expect(applied.connector.capabilities.find(c => c.name === 'phonebook.team')!.menu).toBeNull();
    expect(labels(registry, hassan)).toEqual(['Telefonbok']);
  });
  test('the choice is in the row, so a server that starts again draws the same menu', async () => {
    const { admin, store, reconcile } = world();
    await admin.add(mikael, { id: 'phonebook', url: 'http://phonebook', secret: SECRET });
    await admin.update(mikael, 'phonebook', { state: 'enabled', menu: { 'phonebook.team': true } });
    const restarted = new Registry();
    await applyRow(reconcile(restarted), (await store.read('phonebook'))!);
    expect(restarted.menu(audiencedActorOf(hassan))).toEqual([team as never]);
  });
});
