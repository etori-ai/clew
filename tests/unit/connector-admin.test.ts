import { describe, expect, test } from 'bun:test';
import { SignJWT } from 'jose';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { Registry, actorOf, type Actor } from '../../packages/connectors/src/index';
import { memoryState } from '../../packages/connectors/src/memory-state';
import { raindanceConnector } from '../../packages/connectors/src/mock/raindance';
import { checkConnector } from '../../packages/connectors/src/check';
import { fetchManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import type { ConnectorManifest } from '../../packages/connectors/src/protocol';
import { createConnector } from '../../connectors/hello/connector.mjs';
import { memoryConnectorStore } from '../../apps/server/src/connectors/adapters/memory';
import { connectorUsecases, type AdminDeps } from '../../apps/server/src/connectors/usecases/admin';
import { describeBundled } from '../../apps/server/src/connectors/describe';
import { applyRow, syncBundledRows, type ReconcileDeps } from '../../apps/server/src/connectors/reconcile';

/**
 * Connector administration end to end without a server or a database (D23, D25): the real registry with a bundled mock
 * connector, the hello connector running in process behind a fetch, the memory store, a clock the test owns. What the
 * administrator does, what the store holds afterwards, what the audit log says, and what Hassan can see.
 */
const persona = (id: string, role: 'manager' | 'employee', capabilities: string[] = []): AuthenticatedContext => ({ id, name: id, unitId: id === 'mikael' ? 'unit-it' : 'unit-skola', unitLabel: 'Enheten', role,
  organisationId: 'sundsvall', principal: { id: 'person:' + id, kind: 'person' }, capabilities, authorizationVersion: 'v1', sessionBinding: 'test', expiresAt: '2099-01-01T00:00:00.000Z', async authorize() { return { version: 'v1' }; } });
const mikael = persona('mikael', 'employee', ['admin.connectors']), hassan = persona('hassan', 'employee'), hillevi = persona('hillevi', 'manager');
const SECRET = 'test-secret-test-secret';
const T0 = '2026-11-04T07:00:00.000Z';
const sign = (secret: string, aud: string) => (actor: Actor) => new SignJWT({ actor }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuer('clew').setAudience(aud).setSubject(actor.id).setIssuedAt().setExpirationTime('2m').sign(new TextEncoder().encode(secret));

function world(options: { helloUp?: boolean } = {}) {
  const registry = new Registry();
  const state = memoryState();
  registry.register(raindanceConnector(state));
  const store = memoryConnectorStore();
  let now = Date.parse(T0);
  const clock = () => new Date(now);
  const hello = createConnector({ secret: SECRET, clewUrl: 'http://clew', fetch: async () => Response.json({ output: { events: [] } }) });
  const helloFetch: FetchLike = async (input, init) => { if (options.helloUp === false) throw new Error('ECONNREFUSED'); return hello.handle(new Request(input, init)); };
  const live = { registered: [] as string[],
    register(source: { id: string; url: string; secret: string }, manifest: ConnectorManifest) { live.registered.push(source.id); registry.replace(remoteConnector(manifest, { url: source.url, assert: sign(source.secret, source.id), fetch: helloFetch })); },
    unregister(id: string) { registry.unregister(id); } };
  const deps: AdminDeps = {
    store, registry, clock, live, units: { list: async () => [{ id: 'unit-skola', label: 'Bergsåkers skola' }] },
    secrets: { seal: (v, id) => `sealed(${id}):${v}`, open: (s, id) => s.replace(`sealed(${id}):`, '') },
    transport: { fetchManifest: (url, id) => fetchManifest(url, id, helloFetch), check: ({ url, id, secret }) => checkConnector({ url, id, assert: sign(secret, id), assertForeign: sign('another-secret-another', id), fetch: helloFetch }) },
  };
  const admin = connectorUsecases(deps);
  const reconcile: ReconcileDeps = { registry, store, secrets: deps.secrets, live, bundled: ['raindance'], clock, log: () => undefined };
  return { registry, store, admin, clock, live, reconcile, advance: (ms: number) => { now += ms; } };
}
const actions = (store: ReturnType<typeof memoryConnectorStore>, id: string) => store.audit.filter(a => a.subject === 'connector:' + id).map(a => a.action);

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
    expect(connector).toMatchObject({ id: 'hello', bundled: false, state: 'draft', source: 'Hello', registered: false, health: { status: 'ok', at: T0 }, url: 'http://hello', counts: { capabilities: 5, execute: 2, tools: 3 } });
    expect(connector.capabilities.map(c => c.name)).toContain('hello.greeting');
    expect((await store.read('hello'))!.secret).toBe(`sealed(hello):${SECRET}`);
    expect(actions(store, 'hello')).toEqual(['connector.added']);
    expect(registry.connector('hello')).toBeUndefined();
    await expect(admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET })).rejects.toThrow('finns redan');
    await expect(admin.add(mikael, { id: 'raindance', url: 'http://hello', secret: SECRET })).rejects.toThrow('inbyggd');
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
    const enabled = await admin.update(mikael, 'hello', { state: 'enabled', audience: { mode: 'selected', roles: ['manager'] } });
    expect(enabled).toMatchObject({ state: 'enabled', registered: true, audience: { mode: 'selected', roles: ['manager'] } });
    expect(live.registered).toEqual(['hello']);
    expect(actions(store, 'hello')).toEqual(['connector.added', 'connector.enabled', 'connector.audience']);
    expect(registry.visible(actorOf(hillevi), 'hello')).toBe(true);
    expect(registry.visible(actorOf(hassan), 'hello')).toBe(false);
    expect(await registry.run(actorOf(hillevi), 'hello.greeting', {})).toMatchObject({ text: expect.stringContaining('hillevi') });
    await expect(registry.run(actorOf(hassan), 'hello.greeting', {})).rejects.toThrow('Okänd förmåga.');
    const preview = await admin.preview(mikael, 'hello', { role: 'manager' });
    expect(preview).toMatchObject({ visible: true, areas: [{ id: 'hello', title: 'Hello-anslutningen' }] });
    expect(preview.tools).toContain('hello.greeting');
    expect((await admin.preview(mikael, 'hello', { role: 'employee' })).visible).toBe(false);
    await admin.update(mikael, 'hello', { state: 'disabled' });
    expect(registry.visible(actorOf(hillevi), 'hello')).toBe(false);
    expect(registry.connector('hello')).toBeDefined();
    // Nothing changed: no audit row.
    const n = store.audit.length;
    await admin.update(mikael, 'hello', { state: 'disabled' });
    expect(store.audit.length).toBe(n);
  });
  test('capability switches narrow only: an unknown name is refused, a switched-off tool leaves the model\'s list, execute stays off the list', async () => {
    const { admin, registry } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    await admin.update(mikael, 'hello', { state: 'enabled' });
    await expect(admin.update(mikael, 'hello', { capabilities: { 'hello.nope': { enabled: false } } })).rejects.toThrow('Okänd förmåga: hello.nope');
    const detail = await admin.update(mikael, 'hello', { capabilities: { 'hello.greeting': { model: false }, 'hello.openItems': { enabled: false } } });
    expect(detail.capabilities.find(c => c.name === 'hello.greeting')).toMatchObject({ enabled: true, tool: false });
    expect(detail.capabilities.find(c => c.name === 'hello.openItems')).toMatchObject({ enabled: false, tool: false });
    expect(detail.capabilities.find(c => c.name === 'hello.markDone')).toMatchObject({ kind: 'execute', tool: false });
    expect(registry.tools(actorOf(hillevi)).map(t => t.name)).not.toContain('hello.greeting');
    await expect(registry.run(actorOf(hillevi), 'hello.openItems', {})).rejects.toThrow('Okänd förmåga.');
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
    expect(actions(store, 'hello')).toEqual(['connector.added', 'connector.enabled', 'connector.secret', 'connector.secret']);
  });
  test('remove closes the open cards, deletes the row, forgets the connector and audits it; a bundled connector cannot be removed', async () => {
    const { admin, store, registry } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    await admin.update(mikael, 'hello', { state: 'enabled' });
    store.threads.push({ id: 'card-1', connector: 'hello', state: 'open', handledAt: null }, { id: 'card-2', connector: 'hello', state: 'handled', handledAt: T0 });
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
    expect(rows.map(r => r.id)).toEqual(['raindance']);
    expect(rows[0]).toMatchObject({ bundled: true, url: null, secret: null, state: 'enabled', createdBy: 'system:boot' });
    expect((rows[0]!.manifest as ConnectorManifest).capabilities.map(c => c.name)).toEqual(describeBundled(registry.connector('raindance')!).capabilities.map(c => c.name));
    const list = await admin.list(mikael);
    expect(list[0]).toMatchObject({ id: 'raindance', bundled: true, kind: 'passthrough', source: 'Raindance', registered: true, secretChangedAt: null });
    await expect(admin.update(mikael, 'raindance', { url: 'http://x' })).rejects.toThrow('inbyggd');
    await expect(admin.rotateSecret(mikael, 'raindance', { secret: SECRET })).rejects.toThrow('inbyggd');
    expect((await admin.test(mikael, 'raindance')).ok).toBe(true);
  });
  test('Hassan loses Raindance when the administrator limits it to managers, and gets it back; a row changed elsewhere is applied by the watcher', async () => {
    const { store, registry, reconcile, admin } = world();
    await syncBundledRows(reconcile);
    expect(registry.visible(actorOf(hassan), 'raindance')).toBe(true);
    await admin.update(mikael, 'raindance', { audience: { mode: 'selected', roles: ['manager'] } });
    expect(registry.visible(actorOf(hassan), 'raindance')).toBe(false);
    expect(registry.visible(actorOf(hillevi), 'raindance')).toBe(true);
    expect((await admin.preview(mikael, 'raindance', { role: 'employee' })).visible).toBe(false);
    const preview = await admin.preview(mikael, 'raindance', { role: 'manager' });
    expect(preview.visible).toBe(true);
    expect(preview.areas.map(a => a.id)).toEqual(['budget']);
    // The mocks narrow by identity in code (a function scope), which a structural preview cannot satisfy: tools stay empty here, see the remote case above.
    expect(preview.tools).toEqual([]);
    // Another instance (or the CLI) changed the row: applying it brings Hassan back.
    await store.transaction(tx => tx.update('raindance', { audience: { mode: 'all' } }, 'bootstrap:connector', T0));
    applyRow(reconcile, (await store.read('raindance'))!);
    expect(registry.visible(actorOf(hassan), 'raindance')).toBe(true);
  });
});
