import { describe, expect, test } from 'bun:test';
import { SignJWT } from 'jose';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { Registry, actorOf, menuProblem, type Actor, type Connector } from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { ManifestError, fetchManifest, parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import type { ConnectorManifest } from '../../packages/connectors/src/protocol';
import { createConnector as createHello } from '../../connectors/hello/connector.mjs';
import { createConnector as createTelefonbok, manifest as telefonbokManifest } from '../../connectors/telefonbok/connector.mjs';
import { memoryConnectorStore } from '../../apps/server/src/connectors/adapters/memory';
import { connectorUsecases, governanceOf, type AdminDeps } from '../../apps/server/src/connectors/usecases/admin';
import { describeBundled } from '../../apps/server/src/connectors/describe';

/**
 * A connector's row in the menu (D40): the rules a declaration keeps, who gets the row, and the administrator's switch
 * with its audit row. The phone book runs in process behind a fetch, on the memory store.
 */
const persona = (id: string, role: 'manager' | 'employee', unitId: string, capabilities: string[] = []): AuthenticatedContext => ({ id, name: id, unitId, unitLabel: 'Enheten', role,
  organisationId: 'sundsvall', principal: { id: 'person:' + id, kind: 'person' }, capabilities, authorizationVersion: 'v1', sessionBinding: 'test', expiresAt: '2099-01-01T00:00:00.000Z', async authorize() { return { version: 'v1' }; } });
const mikael = persona('mikael', 'employee', 'unit-it', ['admin.connectors']), hassan = persona('hassan', 'employee', 'unit-skola');
const SECRET = 'test-secret-test-secret';
const T0 = '2026-11-05T12:00:00.000Z';
const sign = (secret: string, aud: string) => (actor: Actor) => new SignJWT({ actor }).setProtectedHeader({ alg: 'HS256', typ: 'JWT' }).setIssuer('clew').setAudience(aud).setSubject(actor.id).setIssuedAt().setExpirationTime('2m').sign(new TextEncoder().encode(secret));
const declared = { capability: 'telefonbok.directory', label: 'Telefonbok', icon: 'phone' };
const row = { connector: 'telefonbok', source: 'Telefonboken', capability: 'telefonbok.directory', title: 'Sök i telefonboken', label: 'Telefonbok', icon: 'phone' };
const base = telefonbokManifest as unknown as ConnectorManifest;
const withMenu = (menu: unknown) => ({ ...base, menu });

function world() {
  const registry = new Registry();
  const store = memoryConnectorStore();
  const telefonbok = createTelefonbok({ secret: SECRET });
  const hello = createHello({ secret: SECRET, clewUrl: 'http://clew', fetch: async () => Response.json({ output: { events: [] } }) });
  // What the phone book serves as its manifest, so a test can take the menu row away and put it back.
  const served: { menu: unknown } = { menu: declared };
  const fetchLike: FetchLike = async (input, init) => {
    if (input.startsWith('http://hello')) return hello.handle(new Request(input, init));
    if (input.endsWith('/clew/manifest')) { const { menu: _menu, ...rest } = base; return Response.json(served.menu ? { ...rest, menu: served.menu } : rest); }
    return telefonbok.handle(new Request(input, init));
  };
  const live = {
    register(source: { id: string; url: string; secret: string }, manifest: ConnectorManifest) { registry.replace(remoteConnector(manifest, { url: source.url, assert: sign(source.secret, source.id), fetch: fetchLike })); },
    unregister(id: string) { registry.unregister(id); } };
  const deps: AdminDeps = {
    store, registry, clock: () => new Date(T0), live, units: { list: async () => [] },
    secrets: { seal: (v, id) => `sealed(${id}):${v}`, open: (s, id) => s.replace(`sealed(${id}):`, '') },
    transport: { fetchManifest: (url, id) => fetchManifest(url, id, fetchLike), check: ({ url, id, secret }) => checkConnector({ url, id, assert: sign(secret, id), assertForeign: sign('another-secret-another', id), fetch: fetchLike }) },
  };
  return { registry, store, admin: connectorUsecases(deps), served };
}
const menuAudit = (store: ReturnType<typeof memoryConnectorStore>) => store.audit.filter(a => a.action === 'connector.menu');

describe('the rules of a menu row', () => {
  const view = { kind: 'text', body: 'text' };
  const caps = [
    { name: 'x.list', kind: 'read', input: { type: 'object', properties: { query: {} } }, output: {}, view },
    { name: 'x.card', kind: 'read', input: { type: 'object', properties: { ref: {} }, required: ['ref'] }, output: {}, view },
    { name: 'x.plain', kind: 'read', input: {}, output: {} },
    { name: 'x.do', kind: 'execute', input: {}, output: {} },
  ] as never[];
  const menu = (capability: string) => ({ capability, label: 'Lista', icon: 'book' as const });
  test('it opens a read of the same connector that declares a view and needs no input', () => {
    expect(menuProblem('x', undefined, caps)).toBeUndefined();
    expect(menuProblem('x', menu('x.list'), caps)).toBeUndefined();
    expect(menuProblem('x', menu('x.do'), caps)).toMatch(/not a read of x/);
    expect(menuProblem('x', menu('x.missing'), caps)).toMatch(/not a read of x/);
    expect(menuProblem('y', menu('x.list'), caps)).toMatch(/not a read of y/);
    expect(menuProblem('x', menu('x.plain'), caps)).toMatch(/declares no view/);
    expect(menuProblem('x', menu('x.card'), caps)).toMatch(/needs input/);
  });
  test('the manifest loader refuses a row that breaks a rule, a label that does not fit and an icon that is not one of Clew\'s', () => {
    expect(parseManifest(telefonbokManifest, 'telefonbok').menu).toEqual(declared as never);
    expect(() => parseManifest(withMenu({ ...declared, capability: 'telefonbok.person' }))).toThrow(ManifestError);
    expect(() => parseManifest(withMenu({ ...declared, capability: 'telefonbok.person' }))).toThrow(/needs input.*D40/);
    expect(() => parseManifest(withMenu({ ...declared, capability: 'telefonbok.fetch' }))).toThrow(/needs input|declares no view/);
    expect(() => parseManifest(withMenu({ ...declared, label: 'Organisationens hela telefonbok' }))).toThrow(/Invalid connector manifest/);
    expect(() => parseManifest(withMenu({ ...declared, icon: '<svg/>' }))).toThrow(/Invalid connector manifest/);
    expect(() => parseManifest(withMenu({ ...declared, href: 'https://example.com' }))).toThrow(/Invalid connector manifest/);
  });
  test('a bundled connector is held to the same rule when it registers, and its description carries the row', () => {
    const run = async () => ({ text: '' });
    const connector = (menu: Connector['menu']): Connector => ({ id: 'x', kind: 'derived', source: 'X', areas: [], menu,
      capabilities: [{ name: 'x.list', kind: 'read', title: 'Lista', description: 'En lista.', input: {} as never, output: {} as never, model: false, scope: {}, view: { kind: 'text', body: 'text' }, run }] });
    expect(() => new Registry().register(connector({ capability: 'x.gone', label: 'Lista', icon: 'book' }))).toThrow(/D40/);
    const ok = connector({ capability: 'x.list', label: 'Lista', icon: 'book' });
    expect(new Registry().register(ok).connector('x')!.menu).toEqual({ capability: 'x.list', label: 'Lista', icon: 'book' });
    expect(describeBundled(ok).menu).toEqual({ capability: 'x.list', label: 'Lista', icon: 'book' });
  });
});

describe('who gets the row', () => {
  const registry = () => new Registry().register(remoteConnector(parseManifest(telefonbokManifest, 'telefonbok'), { url: 'http://telefonbok', assert: sign(SECRET, 'telefonbok'), fetch: async () => Response.json({}) }));
  const on = { state: 'enabled' as const, audience: { mode: 'all' as const }, scanEnabled: true, toolsEnabled: true, menuEnabled: true, capabilities: {} };
  test('nobody until an administrator switches it on: declaring a row does not take a place in the menu', () => {
    const r = registry();
    expect(r.menu(actorOf(hassan))).toEqual([]);
    r.govern('telefonbok', { ...on, menuEnabled: false });
    expect(r.menu(actorOf(hassan))).toEqual([]);
    r.govern('telefonbok', on);
    expect(r.menu(actorOf(hassan))).toEqual([row as never]);
  });
  test('only a person in the audience, only while the connector is on and the read it opens is on', () => {
    const r = registry();
    r.govern('telefonbok', { ...on, audience: { mode: 'selected', units: ['unit-it'] } });
    expect(r.menu(actorOf(hassan))).toEqual([]);
    expect(r.menu(actorOf(mikael))).toHaveLength(1);
    r.govern('telefonbok', { ...on, state: 'disabled' });
    expect(r.menu(actorOf(mikael))).toEqual([]);
    r.govern('telefonbok', { ...on, capabilities: { 'telefonbok.directory': { enabled: false } } });
    expect(r.menu(actorOf(mikael))).toEqual([]);
  });
  test('the rows come in alphabetical order, whatever order the connectors were registered in', () => {
    const run = async () => ({ text: '' });
    const tool = (id: string, label: string): Connector => ({ id, kind: 'derived', source: id, areas: [], menu: { capability: id + '.open', label, icon: 'book' },
      capabilities: [{ name: id + '.open', kind: 'read', title: label, description: label, input: {} as never, output: {} as never, model: false, scope: {}, view: { kind: 'text', body: 'text' }, run }] });
    const r = new Registry();
    for (const [id, label] of [['c', 'Ärenden'], ['a', 'Östra arkivet'], ['b', 'Avtal']] as const) { r.register(tool(id, label)); r.govern(id, on); }
    expect(r.menu(actorOf(hassan)).map(e => e.label)).toEqual(['Avtal', 'Ärenden', 'Östra arkivet']);
  });
});

describe('the administrator\'s switch', () => {
  test('a new connector shows what it declares and is off; switching it on is one audit row and the row is there for the audience at once', async () => {
    const { admin, store, registry } = world();
    const { connector, report } = await admin.add(mikael, { id: 'telefonbok', url: 'http://telefonbok', secret: SECRET });
    expect(report.findings.map(f => f.text)).toContain('menu: "Telefonbok" opens telefonbok.directory (shown when an administrator switches it on)');
    expect(connector).toMatchObject({ menu: declared, menuEnabled: false });
    await admin.update(mikael, 'telefonbok', { state: 'enabled' });
    expect(registry.menu(actorOf(hassan))).toEqual([]);
    expect((await admin.preview(mikael, 'telefonbok', { role: 'employee' })).menu).toBeNull();

    const updated = await admin.update(mikael, 'telefonbok', { menuEnabled: true });
    expect(updated.menuEnabled).toBe(true);
    expect((await store.read('telefonbok'))!.menuEnabled).toBe(true);
    expect(menuAudit(store)).toEqual([{ actor: 'person:mikael', action: 'connector.menu', subject: 'connector:telefonbok', at: T0, details: { to: true, label: 'Telefonbok', capability: 'telefonbok.directory' } }]);
    expect(registry.menu(actorOf(hassan))).toEqual([row as never]);
    expect((await admin.preview(mikael, 'telefonbok', { role: 'employee' })).menu).toBe('Telefonbok');
    // The same value again changes nothing and writes nothing.
    await admin.update(mikael, 'telefonbok', { menuEnabled: true });
    expect(menuAudit(store)).toHaveLength(1);

    await admin.update(mikael, 'telefonbok', { menuEnabled: false });
    expect(registry.menu(actorOf(hassan))).toEqual([]);
    expect(menuAudit(store).map(a => a.details)).toEqual([{ to: true, label: 'Telefonbok', capability: 'telefonbok.directory' }, { to: false, label: 'Telefonbok', capability: 'telefonbok.directory' }]);
  });
  test('only an administrator may, and a connector that declares no row has nothing to switch on', async () => {
    const { admin, store } = world();
    await admin.add(mikael, { id: 'telefonbok', url: 'http://telefonbok', secret: SECRET });
    await expect(admin.update(hassan, 'telefonbok', { menuEnabled: true })).rejects.toThrow(/behörighet/);
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    await expect(admin.update(mikael, 'hello', { menuEnabled: true })).rejects.toThrow('Anslutningen har ingen rad för menyn.');
    expect(menuAudit(store)).toEqual([]);
    expect((await store.read('hello'))!.menuEnabled).toBe(false);
  });
  test('a refetched manifest says what happened to the row, and a row the service no longer declares is gone though the switch is on', async () => {
    const { admin, store, registry, served } = world();
    served.menu = null;
    const { connector } = await admin.add(mikael, { id: 'telefonbok', url: 'http://telefonbok', secret: SECRET });
    expect(connector.menu).toBeNull();
    await admin.update(mikael, 'telefonbok', { state: 'enabled' });
    served.menu = declared;
    expect((await admin.refreshManifest(mikael, 'telefonbok', {})).diff).toMatchObject({ menu: 'added', same: false, added: [], changed: [] });
    const applied = await admin.refreshManifest(mikael, 'telefonbok', { apply: true });
    expect(applied.connector.menu).toEqual(declared as never);
    expect(store.audit.find(a => a.action === 'connector.manifest')!.details).toMatchObject({ menu: 'added' });
    // Added by the service, still off: the administrator decides.
    expect(registry.menu(actorOf(hassan))).toEqual([]);
    await admin.update(mikael, 'telefonbok', { menuEnabled: true });
    expect(registry.menu(actorOf(hassan))).toHaveLength(1);

    served.menu = { ...declared, label: 'Kontakter' };
    expect((await admin.refreshManifest(mikael, 'telefonbok', {})).diff.menu).toBe('changed');
    served.menu = null;
    expect((await admin.refreshManifest(mikael, 'telefonbok', { apply: true })).diff.menu).toBe('removed');
    expect(registry.menu(actorOf(hassan))).toEqual([]);
  });
  test('the switch is part of what is applied to the registry from a row, so it survives a restart', () => {
    expect(governanceOf({ state: 'enabled', audience: { mode: 'all' }, scanEnabled: true, toolsEnabled: true, menuEnabled: true, capabilities: {} }).menuEnabled).toBe(true);
  });
});
