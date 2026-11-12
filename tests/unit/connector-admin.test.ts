import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { SignJWT } from 'jose';
import { assertionFor, testJwks } from '../connector-authority';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { audiencedActorOf, type Actor, type Connector } from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { fetchManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import type { ConnectorManifest } from '../../packages/connectors/src/protocol';
import { createConnector } from '../../connectors/hello/connector.mjs';
import { memoryConnectorStore } from '../../apps/server/src/connectors/adapters/memory';
import { connectorUsecases, type AdminDeps } from '../../apps/server/src/connectors/usecases/admin';
import { describeBundled } from '../../apps/server/src/connectors/describe';
import {
  applyAllRows,
  applyRow,
  syncBundledRows,
  type ReconcileDeps,
} from '../../apps/server/src/connectors/reconcile';

/**
 * Connector administration end to end without a server or a database (D23, D25): the real registry with a bundled mock
 * connector, the hello connector running in process behind a fetch, the memory store, a clock the test owns. What the
 * administrator does, what the store holds afterwards, what the audit log says, and what Hassan can see.
 */
const persona = (id: string, role: 'manager' | 'employee', capabilities: string[] = []): AuthenticatedContext => ({
  id,
  name: id,
  unitId: id === 'mikael' ? 'unit-it' : 'unit-skola',
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
const mikael = persona('mikael', 'employee', ['admin.connectors']),
  hassan = persona('hassan', 'employee'),
  hillevi = persona('hillevi', 'manager');
const SECRET = 'test-secret-test-secret';
const T0 = '2026-11-04T07:00:00.000Z';
const sign = (secret: string, aud: string) => assertionFor(aud, secret);

/** A bundled connector of this Clew, the economy system's shape in miniature: the governance rows treat it as they treat the core. */
const bundledFinance = (): Connector => ({
  id: 'finance',
  kind: 'passthrough',
  source: 'Ekonomisystemet',
  areas: [{ id: 'budget', title: 'Budget', roles: ['manager'], standing: ['finance.invoices'], schedules: [] }],
  capabilities: [
    {
      name: 'finance.invoices',
      kind: 'read',
      title: 'Fakturor att attestera',
      description: 'Fakturor som väntar på attest.',
      model: true,
      input: { type: 'object', properties: {}, additionalProperties: false } as never,
      output: { type: 'object' } as never,
      scope: actor => actor.role === 'manager' && actor.id === 'hillevi',
      run: async () => ({ rows: [] }),
    },
  ],
});

const users = (): Connector => ({
  id: 'people',
  kind: 'core',
  source: 'Användare',
  areas: [],
  capabilities: [
    {
      name: 'people.me',
      kind: 'read',
      title: 'Vem är jag?',
      description: 'Den inloggade användaren.',
      model: true,
      input: { type: 'object' } as never,
      output: { type: 'object' } as never,
      scope: actor => !!actor.unitId,
      run: async actor => ({ id: actor.id }),
    },
  ],
});

function world(options: { helloUp?: boolean; users?: boolean } = {}) {
  const registry = new Registry();
  registry.register(bundledFinance());
  if (options.users) registry.register(users());
  const internal = options.users ? ['people'] : [];
  const store = memoryConnectorStore();
  let now = Date.parse(T0);
  const clock = () => new Date(now);
  const hello = createConnector({
    jwks: testJwks,
    secret: SECRET,
    clewUrl: 'http://clew',
    fetch: async () => Response.json({ output: { events: [] } }),
  });
  const helloFetch: FetchLike = async (input, init) => {
    if (options.helloUp === false) throw new Error('ECONNREFUSED');
    return hello.handle(new Request(input, init));
  };
  const live = {
    registered: [] as string[],
    register(source: { id: string; url: string; secret: string }, manifest: ConnectorManifest) {
      live.registered.push(source.id);
      registry.replace(
        remoteConnector(manifest, {
          url: source.url,
          key: source.secret,
          assert: sign(SECRET, source.id),
          fetch: helloFetch,
        }),
      );
    },
    unregister(id: string) {
      registry.unregister(id);
    },
  };
  const deps: AdminDeps = {
    internal,
    store,
    registry,
    clock,
    live,
    units: { list: async () => [{ id: 'unit-skola', label: 'Bergsåkers skola' }] },
    groups: { list: async () => [{ id: 'S-1-5-21-it-staff', label: 'IT staff' }] },
    secrets: { seal: (v, id) => `sealed(${id}):${v}`, open: (s, id) => s.replace(`sealed(${id}):`, '') },
    transport: {
      fetchManifest: (url, id) => fetchManifest(url, id, helloFetch),
      check: ({ url, id, secret }) =>
        checkConnector({
          url,
          id,
          key: secret,
          assert: sign(SECRET, id),
          assertForeign: sign('another-secret-another', id),
          fetch: helloFetch,
        }),
    },
  };
  const admin = connectorUsecases(deps);
  const reconcile: ReconcileDeps = {
    registry,
    store,
    secrets: deps.secrets,
    live,
    bundled: ['finance'],
    internal,
    clock,
    log: () => undefined,
  };
  return {
    registry,
    store,
    admin,
    clock,
    live,
    reconcile,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const actions = (store: ReturnType<typeof memoryConnectorStore>, id: string) =>
  store.audit.filter(a => a.subject === 'connector:' + id).map(a => a.action);

describe('who may administer', () => {
  test('without the grant capability every call is forbidden, reads included', async () => {
    const { admin } = world();
    await expect(admin.list(hillevi)).rejects.toThrow(/behörighet/);
    await expect(admin.add(hassan, { id: 'hello', url: 'http://hello', secret: SECRET })).rejects.toThrow(/behörighet/);
  });
});

describe('adding and governing a remote connector', () => {
  test('add fetches and checks the service, stores a draft with a sealed secret and one audit row, and registers nothing yet', async () => {
    const { admin, store, registry } = world();
    const { connector, report } = await admin.add(mikael, { id: 'hello', url: 'http://hello/', secret: SECRET });
    expect(report.ok).toBe(true);
    expect(connector).toMatchObject({
      id: 'hello',
      bundled: false,
      state: 'draft',
      source: 'Hello',
      registered: false,
      health: { status: 'ok', at: T0 },
      url: 'http://hello',
      counts: { capabilities: 5, execute: 2, tools: 3 },
    });
    expect(connector.capabilities.map(c => c.name)).toContain('hello.greeting');
    expect((await store.read('hello'))!.secret).toBe(`sealed(hello):${SECRET}`);
    expect(actions(store, 'hello')).toEqual(['connector.added']);
    expect(registry.connector('hello')).toBeUndefined();
    await expect(admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET })).rejects.toThrow(
      'finns redan',
    );
    await expect(admin.add(mikael, { id: 'finance', url: 'http://hello', secret: SECRET })).rejects.toThrow('inbyggd');
  });
  test('"Visa nyckeltalet" switches an area\'s figure off for the audience and on again, one audit row each (D54)', async () => {
    const { admin, store, registry } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    await admin.update(mikael, 'hello', { state: 'enabled' });
    const figureOf = async () => (await registry.areas(audiencedActorOf(hillevi))).find(a => a.id === 'hello')!.figure;
    expect(await figureOf()).toMatchObject({ label: '2 saker väntar', tone: 'warn' });
    const off = await admin.update(mikael, 'hello', { figures: { hello: false } });
    expect(off.areas.find(a => a.id === 'hello')).toMatchObject({ figure: true, figureShown: false });
    expect((await store.read('hello'))!.areas).toEqual({ hello: { figure: false } });
    expect(await figureOf()).toBeNull();
    expect(store.audit.filter(a => a.action === 'connector.figure')).toEqual([
      {
        actor: 'person:mikael',
        action: 'connector.figure',
        subject: 'connector:hello',
        at: T0,
        details: { area: 'hello', to: false, title: 'Hello-anslutningen' },
      },
    ]);
    // The same switch again changes nothing and writes nothing.
    await admin.update(mikael, 'hello', { figures: { hello: false } });
    expect(store.audit.filter(a => a.action === 'connector.figure')).toHaveLength(1);
    const on = await admin.update(mikael, 'hello', { figures: { hello: true } });
    expect(on.areas.find(a => a.id === 'hello')!.figureShown).toBe(true);
    expect((await store.read('hello'))!.areas).toEqual({});
    expect(await figureOf()).toMatchObject({ label: '2 saker väntar' });
    expect(store.audit.filter(a => a.action === 'connector.figure').map(a => a.details?.to)).toEqual([false, true]);
    await expect(admin.update(mikael, 'hello', { figures: { nope: false } })).rejects.toThrow('inget nyckeltal');
  });
  test('a service that is down still gets its draft, with health unreachable and no manifest', async () => {
    const { admin } = world({ helloUp: false });
    const { connector, report } = await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    expect(report.ok).toBe(false);
    expect(connector.health.status).toBe('unreachable');
    expect(connector.counts.capabilities).toBe(0);
    await expect(admin.update(mikael, 'hello', { state: 'enabled' })).rejects.toThrow('svarar inte');
  });
  test('enabling registers the connector live; the audience hides it from Hassan while Hillevi sees it; disabling hides it from both', async () => {
    const { admin, store, registry, live } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    const enabled = await admin.update(mikael, 'hello', {
      state: 'enabled',
      audience: { mode: 'selected', roles: ['manager'] },
    });
    expect(enabled).toMatchObject({
      state: 'enabled',
      registered: true,
      audience: { mode: 'selected', roles: ['manager'] },
    });
    expect(live.registered).toEqual(['hello']);
    expect(actions(store, 'hello')).toEqual(['connector.added', 'connector.enabled', 'connector.audience']);
    expect(registry.visible(audiencedActorOf(hillevi), 'hello')).toBe(true);
    expect(registry.visible(audiencedActorOf(hassan), 'hello')).toBe(false);
    expect(await registry.run(audiencedActorOf(hillevi), 'hello.greeting', {})).toMatchObject({
      text: expect.stringContaining('hillevi'),
    });
    await expect(registry.run(audiencedActorOf(hassan), 'hello.greeting', {})).rejects.toThrow('Okänd förmåga.');
    const preview = await admin.preview(mikael, 'hello', { role: 'manager' });
    expect(preview).toMatchObject({ visible: true, areas: [{ id: 'hello', title: 'Hello-anslutningen' }] });
    expect(preview.tools).toContain('hello.greeting');
    expect((await admin.preview(mikael, 'hello', { role: 'employee' })).visible).toBe(false);
    await admin.update(mikael, 'hello', { state: 'disabled' });
    expect(registry.visible(audiencedActorOf(hillevi), 'hello')).toBe(false);
    expect(registry.connector('hello')).toBeDefined();
    // Nothing changed: no audit row.
    const n = store.audit.length;
    await admin.update(mikael, 'hello', { state: 'disabled' });
    expect(store.audit.length).toBe(n);
  });
  test("capability switches narrow only: an unknown name is refused, a switched-off tool leaves the model's list, execute stays off the list", async () => {
    const { admin, registry } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    await admin.update(mikael, 'hello', { state: 'enabled' });
    await expect(admin.update(mikael, 'hello', { capabilities: { 'hello.nope': { enabled: false } } })).rejects.toThrow(
      'Okänd förmåga: hello.nope',
    );
    const detail = await admin.update(mikael, 'hello', {
      capabilities: { 'hello.greeting': { model: false }, 'hello.openItems': { enabled: false } },
    });
    expect(detail.capabilities.find(c => c.name === 'hello.greeting')).toMatchObject({ enabled: true, tool: false });
    expect(detail.capabilities.find(c => c.name === 'hello.openItems')).toMatchObject({ enabled: false, tool: false });
    expect(detail.capabilities.find(c => c.name === 'hello.markDone')).toMatchObject({ kind: 'execute', tool: false });
    expect(registry.tools(audiencedActorOf(hillevi)).map(t => t.name)).not.toContain('hello.greeting');
    await expect(registry.run(audiencedActorOf(hillevi), 'hello.openItems', {})).rejects.toThrow('Okänd förmåga.');
    // Clearing an override removes it from the row.
    const cleared = await admin.update(mikael, 'hello', { capabilities: { 'hello.openItems': {} } });
    expect(cleared.capabilities.find(c => c.name === 'hello.openItems')?.enabled).toBe(true);
  });
  test('a new secret is sealed, dated and signed with from then on; test records health; the manifest refresh reports a diff and applies it', async () => {
    const { admin, store, clock, advance } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    await admin.update(mikael, 'hello', { state: 'enabled' });
    advance(60_000);
    // The service keeps the old secret, so the new one must be rejected by it: a secret-rejected health after a test.
    const rotated = await admin.rotateSecret(mikael, 'hello', { secret: 'a-brand-new-secret-value' });
    expect(rotated.secretChangedAt).toBe(clock().toISOString());
    expect((await store.read('hello'))!.secret).toBe('sealed(hello):a-brand-new-secret-value');
    const report = await admin.test(mikael, 'hello');
    expect(report.ok).toBe(false);
    expect(report.health.status).toBe('secret-rejected');
    expect((await store.read('hello'))!.health.status).toBe('secret-rejected');
    await admin.rotateSecret(mikael, 'hello', { secret: SECRET });
    expect((await admin.test(mikael, 'hello')).health.status).toBe('ok');
    const { diff } = await admin.refreshManifest(mikael, 'hello', {});
    expect(diff.same).toBe(true);
    expect(actions(store, 'hello')).toEqual([
      'connector.added',
      'connector.enabled',
      'connector.secret',
      'connector.secret',
    ]);
  });
  test('remove closes the open cards, deletes the row, forgets the connector and audits it; a bundled connector cannot be removed', async () => {
    const { admin, store, registry } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    await admin.update(mikael, 'hello', { state: 'enabled' });
    store.threads.push(
      { id: 'card-1', connector: 'hello', state: 'open', handledAt: null },
      { id: 'card-2', connector: 'hello', state: 'handled', handledAt: T0 },
    );
    expect(await admin.remove(mikael, 'hello')).toEqual({ closedCards: 1 });
    expect(store.threads.map(t => t.state)).toEqual(['dismissed', 'handled']);
    expect(await store.read('hello')).toBeUndefined();
    expect(registry.connector('hello')).toBeUndefined();
    expect(store.audit.at(-1)).toMatchObject({ action: 'connector.removed', details: { closedCards: 1 } });
    await expect(admin.read(mikael, 'hello')).rejects.toThrow('finns inte');
  });
});

describe('bundled connectors are governed by the same rows', () => {
  test('boot gives every bundled connector a row once, described like a manifest, and applies the rows to the registry', async () => {
    const { store, registry, reconcile, admin } = world();
    await syncBundledRows(reconcile);
    await syncBundledRows(reconcile);
    const rows = await store.list();
    expect(rows.map(r => r.id)).toEqual(['finance']);
    expect(rows[0]).toMatchObject({
      bundled: true,
      url: null,
      secret: null,
      state: 'enabled',
      createdBy: 'system:boot',
    });
    expect((rows[0]!.manifest as ConnectorManifest).capabilities.map(c => c.name)).toEqual(
      describeBundled(registry.connector('finance')!).capabilities.map(c => c.name),
    );
    const list = await admin.list(mikael);
    expect(list[0]).toMatchObject({
      id: 'finance',
      bundled: true,
      kind: 'passthrough',
      source: 'Ekonomisystemet',
      registered: true,
      secretChangedAt: null,
    });
    await expect(admin.update(mikael, 'finance', { url: 'http://x' })).rejects.toThrow('inbyggd');
    await expect(admin.rotateSecret(mikael, 'finance', { secret: SECRET })).rejects.toThrow('inbyggd');
    expect((await admin.test(mikael, 'finance')).ok).toBe(true);
  });
  test("a bundled row takes the code's description at the next boot when the code has changed, without an audit row or a version bump", async () => {
    const { store, registry, reconcile } = world();
    await syncBundledRows(reconcile);
    const described = describeBundled(registry.connector('finance')!);
    const before = (await store.read('finance'))!;
    // An older build described the connector with one capability fewer; the row still carries that description.
    await store.recordHealth('finance', before.health, { ...described, capabilities: [] }, T0);
    expect((await store.read('finance'))!.manifest).toMatchObject({ capabilities: [] });
    await syncBundledRows(reconcile);
    const after = (await store.read('finance'))!;
    expect((after.manifest as ConnectorManifest).capabilities.map(c => c.name)).toEqual(['finance.invoices']);
    expect(after.version).toBe(before.version);
    expect(store.audit).toEqual([]);
    // The same description in another key order is not a change.
    await store.recordHealth('finance', after.health, JSON.parse(JSON.stringify(described)), T0);
    await syncBundledRows(reconcile);
    expect((await store.read('finance'))!.manifestAt).toBe(T0);
  });
  test('Hassan loses the finance connector when the administrator limits it to managers, and gets it back; a row changed elsewhere is applied by the watcher', async () => {
    const { store, registry, reconcile, admin } = world();
    await syncBundledRows(reconcile);
    expect(registry.visible(audiencedActorOf(hassan), 'finance')).toBe(true);
    await admin.update(mikael, 'finance', { audience: { mode: 'selected', roles: ['manager'] } });
    expect(registry.visible(audiencedActorOf(hassan), 'finance')).toBe(false);
    expect(registry.visible(audiencedActorOf(hillevi), 'finance')).toBe(true);
    expect((await admin.preview(mikael, 'finance', { role: 'employee' })).visible).toBe(false);
    const preview = await admin.preview(mikael, 'finance', { role: 'manager' });
    expect(preview.visible).toBe(true);
    expect(preview.areas.map(a => a.id)).toEqual(['budget']);
    // The mocks narrow by identity in code (a function scope), which a structural preview cannot satisfy: tools stay empty here, see the remote case above.
    expect(preview.tools).toEqual([]);
    // Another instance (or the CLI) changed the row: applying it brings Hassan back.
    await store.transaction(tx => tx.update('finance', { audience: { mode: 'all' } }, 'bootstrap:connector', T0));
    applyRow(reconcile, (await store.read('finance'))!);
    expect(registry.visible(audiencedActorOf(hassan), 'finance')).toBe(true);
  });
});

describe('users are core entities, not connected systems (D62)', () => {
  test('fresh startup needs no users connector row, and keeps the scoped read available', async () => {
    const { registry, store, reconcile, admin } = world({ users: true });
    // Even an older bundled list must not create the internal provider's row.
    await syncBundledRows({ ...reconcile, bundled: ['finance', 'people'] });
    await applyAllRows(reconcile);
    expect((await store.list()).map(r => r.id)).toEqual(['finance']);
    expect((await admin.list(mikael)).map(r => r.id)).toEqual(['finance']);
    expect(await registry.run(audiencedActorOf(hassan), 'people.me', {})).toEqual({ id: 'hassan' });
    expect(registry.tools(audiencedActorOf(hassan)).find(t => t.name === 'people.me')?.source).toBe('Användare');
    expect(registry.allowed({ ...audiencedActorOf(hassan), unitId: '' }, 'people.me')).toBeUndefined();
    // Removing a managed row still fails closed; only the explicit internal provider is independent.
    await store.transaction(tx => tx.remove('finance'));
    await applyAllRows(reconcile);
    expect(registry.visible(audiencedActorOf(hassan), 'finance')).toBe(false);
    expect(registry.visible(audiencedActorOf(hassan), 'people')).toBe(true);
  });

  test('a disabled legacy row cannot turn users off or re-enable assistant access', async () => {
    const { registry, store, reconcile, admin } = world({ users: true });
    await store.transaction(tx =>
      tx.insert({
        id: 'people',
        bundled: true,
        url: null,
        secret: null,
        state: 'disabled',
        manifest: { ...describeBundled(users()), source: 'Startsidan' },
        health: { status: 'ok', at: T0 },
        createdBy: 'old:boot',
        at: T0,
      }),
    );
    const before = await store.read('people');
    await applyAllRows(reconcile);
    expect(registry.governance('people').state).toBe('enabled');
    expect(await registry.run(audiencedActorOf(hassan), 'people.me', {})).toEqual({ id: 'hassan' });
    expect(registry.tools(audiencedActorOf(hassan)).some(t => t.name === 'people.me')).toBe(false);
    expect(await admin.list(mikael)).toEqual([]);
    const rejected = [
      () => admin.read(mikael, 'people'),
      () => admin.update(mikael, 'people', { state: 'disabled' }),
      () => admin.update(mikael, 'people', { audience: { mode: 'selected' } }),
      () => admin.remove(mikael, 'people'),
      () => admin.test(mikael, 'people'),
      () => admin.refreshManifest(mikael, 'people', { apply: true }),
      () => admin.rotateSecret(mikael, 'people', { secret: SECRET }),
      () => admin.preview(mikael, 'people', { role: 'employee' }),
      () => admin.add(mikael, { id: 'people', url: 'http://hello', secret: SECRET }),
    ];
    for (const call of rejected) await expect(call()).rejects.toThrow('inte ett anslutet system');
    expect(await store.read('people')).toEqual(before);
    expect(store.audit).toEqual([]);
    await applyAllRows(reconcile);
    expect(registry.governance('people').state).toBe('enabled');
  });

  test('existing read restrictions survive reload while connector administration stays unavailable', async () => {
    const { registry, store, reconcile, admin } = world({ users: true });
    await store.transaction(async tx => {
      await tx.insert({
        id: 'people',
        bundled: true,
        url: null,
        secret: null,
        state: 'enabled',
        manifest: describeBundled(users()),
        health: { status: 'ok', at: T0 },
        createdBy: 'old:boot',
        at: T0,
      });
      await tx.update(
        'people',
        {
          audience: { mode: 'selected', roles: ['manager'] },
          capabilities: { 'people.me': { model: false } },
        },
        'old:admin',
        T0,
      );
    });
    await applyAllRows(reconcile);
    expect(registry.visible(audiencedActorOf(hassan), 'people')).toBe(false);
    expect(await registry.run(audiencedActorOf(hillevi), 'people.me', {})).toEqual({ id: 'hillevi' });
    expect(registry.tools(audiencedActorOf(hillevi)).some(t => t.name === 'people.me')).toBe(false);
    expect(await admin.list(mikael)).toEqual([]);
    await store.transaction(tx =>
      tx.update(
        'people',
        {
          capabilities: { 'people.me': { enabled: false } },
        },
        'old:admin',
        T0,
      ),
    );
    applyRow(reconcile, (await store.read('people'))!);
    expect(registry.allowed(audiencedActorOf(hillevi), 'people.me')).toBeUndefined();
  });
});

describe('authoritative refresh without rebuilding unchanged connectors', () => {
  test('unchanged rows and governance changes preserve the descriptor; manifests, credentials and deletion do not', async () => {
    const w = world();
    await w.admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    await w.admin.update(mikael, 'hello', { state: 'enabled' });
    await applyAllRows(w.reconcile);
    const original = w.registry.connector('hello'),
      count = w.live.registered.length;
    for (let i = 0; i < 10; i++) await applyAllRows(w.reconcile);
    expect(w.registry.connector('hello')).toBe(original);
    expect(w.live.registered).toHaveLength(count);
    await w.store.transaction(tx => tx.update('hello', { state: 'disabled' }, 'test', T0));
    await applyAllRows(w.reconcile);
    expect(w.registry.connector('hello')).toBe(original);
    expect(w.registry.visible(hillevi, 'hello')).toBe(false);
    const row = (await w.store.read('hello'))!;
    const manifest = structuredClone(row.manifest) as ConnectorManifest;
    manifest.source = 'Changed source';
    await w.store.recordHealth('hello', row.health, manifest, T0);
    expect((await w.store.read('hello'))!.version).toBe(row.version);
    await applyAllRows(w.reconcile);
    expect(w.registry.connector('hello')).not.toBe(original);
    expect(w.registry.connector('hello')!.source).toBe('Changed source');
    const changed = w.registry.connector('hello');
    await w.store.transaction(tx =>
      tx.update(
        'hello',
        { url: 'http://changed', secret: w.reconcile.secrets.seal('changed-secret', 'hello') },
        'test',
        T0,
      ),
    );
    await applyAllRows(w.reconcile);
    expect(w.registry.connector('hello')).not.toBe(changed);
    await w.store.transaction(tx => tx.remove('hello'));
    await applyAllRows(w.reconcile);
    expect(w.registry.connector('hello')).toBeUndefined();
  });
  test('concurrent callers coalesce, but a check arriving during an older read waits for a fresh snapshot', async () => {
    const w = world();
    await w.admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    await w.admin.update(mikael, 'hello', { state: 'enabled' });
    const list = w.store.list.bind(w.store);
    let calls = 0,
      release!: () => void,
      entered!: () => void;
    const gate = new Promise<void>(resolve => {
      release = resolve;
    });
    const started = new Promise<void>(resolve => {
      entered = resolve;
    });
    w.store.list = async () => {
      calls++;
      const rows = await list();
      if (calls === 1) {
        entered();
        await gate;
      }
      return rows;
    };
    const early = Array.from({ length: 8 }, () => applyAllRows(w.reconcile));
    await started;
    expect(calls).toBe(1);
    await w.store.transaction(tx => tx.update('hello', { state: 'disabled' }, 'test', T0));
    const late = Array.from({ length: 8 }, () => applyAllRows(w.reconcile));
    release();
    await Promise.all([...early, ...late]);
    expect(calls).toBe(2);
    expect(w.registry.visible(hillevi, 'hello')).toBe(false);
    w.store.list = async () => {
      throw new Error('store unavailable');
    };
    await expect(applyAllRows(w.reconcile)).rejects.toThrow('store unavailable');
    w.store.list = list;
    await applyAllRows(w.reconcile);
    expect(w.registry.visible(hillevi, 'hello')).toBe(false);
  });
});

/** A connector that can give the shared header (D88): one read without input, named by the manifest's `header`. */
const headerConnector = (id: string, name: string): Connector => ({
  id,
  kind: 'passthrough',
  source: name,
  areas: [],
  header: `${id}.header`,
  capabilities: [
    {
      name: `${id}.header`,
      kind: 'read',
      title: 'Sidhuvudets platser',
      description: 'Platserna i sidhuvudet.',
      input: { type: 'object', properties: {}, additionalProperties: false } as never,
      output: { type: 'object' } as never,
      model: false,
      scope: {},
      run: async () => ({ site: { name, href: '/' }, items: [{ id: 'start', label: 'Start', href: '/' }] }),
    },
  ],
  uses: [],
});
describe('the shared header is given by one chosen connector (D88)', () => {
  test('an administrator chooses the holder on its page; choosing another takes it over with an audit row on both, and a connector without the capability is refused', async () => {
    const { admin, registry, store, reconcile } = world();
    await syncBundledRows(reconcile);
    for (const [id, name] of [
      ['intranet', 'Intranätet'],
      ['sharepoint', 'SharePoint'],
    ] as const) {
      registry.register(headerConnector(id, name));
      registry.govern(id, { ...registry.governance('finance'), state: 'enabled', audience: { mode: 'all' } });
      await store.transaction(tx =>
        tx.insert({
          id,
          bundled: true,
          url: null,
          secret: null,
          state: 'enabled',
          manifest: null,
          health: { status: 'ok', at: T0 },
          createdBy: 'system:boot',
          at: T0,
        }),
      );
    }
    // A candidate gives nothing until it is chosen.
    expect((await admin.read(mikael, 'intranet')).headerCapability).toBe('intranet.header');
    expect((await admin.read(mikael, 'intranet')).header).toBe(false);
    expect(
      await registry.header({
        id: 'hassan',
        name: 'Hassan',
        unitId: 'unit-skola',
        unitLabel: 'Skolan',
        role: 'employee',
      }),
    ).toBeNull();
    const chosen = await admin.update(mikael, 'intranet', { header: true });
    expect(chosen.header).toBe(true);
    expect(registry.governance('intranet').header).toBe(true);
    expect(actions(store, 'intranet')).toEqual(['connector.header']);
    expect(
      (
        await registry.header({
          id: 'hassan',
          name: 'Hassan',
          unitId: 'unit-skola',
          unitLabel: 'Skolan',
          role: 'employee',
        })
      )?.connector.id,
    ).toBe('intranet');
    // Choosing another takes it over in the same transaction, with the audit saying who took it.
    const taken = await admin.update(mikael, 'sharepoint', { header: true });
    expect(taken.header).toBe(true);
    expect((await admin.read(mikael, 'intranet')).header).toBe(false);
    expect(registry.governance('intranet').header).toBeUndefined();
    expect(registry.governance('sharepoint').header).toBe(true);
    expect(store.audit.filter(a => a.action === 'connector.header').map(a => [a.subject, a.details])).toEqual([
      ['connector:intranet', { to: true }],
      ['connector:sharepoint', { to: true, from: 'intranet' }],
      ['connector:intranet', { to: false, takenBy: 'sharepoint' }],
    ]);
    expect((await admin.list(mikael)).filter(c => c.header).map(c => c.id)).toEqual(['sharepoint']);
    // Giving it up leaves Clew's default; a connector whose manifest names no header capability cannot take it.
    await admin.update(mikael, 'sharepoint', { header: false });
    expect((await admin.list(mikael)).filter(c => c.header)).toEqual([]);
    await expect(admin.update(mikael, 'finance', { header: true })).rejects.toThrow('kan inte ge sidhuvudet');
    expect(actions(store, 'finance')).toEqual([]);
  });
});
