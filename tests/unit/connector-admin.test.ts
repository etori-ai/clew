import { Registry } from '../registry';
import { describe, expect, spyOn, test } from 'bun:test';
import { SignJWT } from 'jose';
import { assertionFor, testJwks } from '../connector-authority';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { audiencedActorOf, type Actor, type Connector } from '../../packages/connectors/src/index';
import { remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import type { ConnectorManifest } from '../../packages/connectors/src/protocol';
import { createConnector } from '../../connectors/hello/connector.mjs';
import { memoryConnectorStore } from '../../apps/server/src/connectors/adapters/memory';
import { serviceTransport } from '../../apps/server/src/connectors/adapters/transport';
import {
  CHANGED_SINCE,
  CHANGED_WHILE_CHECKED,
  MOVED_WHILE_READ,
  connectorUsecases,
  type AdminDeps,
} from '../../apps/server/src/connectors/usecases/admin';
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
  /** A second administrator, whose change lands while Mikael's is under way. */
  anna = persona('anna', 'employee', ['admin.connectors']),
  hassan = persona('hassan', 'employee'),
  hillevi = persona('hillevi', 'manager');
const SECRET = 'test-secret-test-secret';
const T0 = '2026-11-04T07:00:00.000Z';
const sign = (secret: string, aud: string) => assertionFor(aud, secret);
/** The service starts serving its manifest changed by `change`, as a new deployment of it would. */
const serving = (transport: AdminDeps['transport'], change: (m: ConnectorManifest) => ConnectorManifest) => {
  const fetch = transport.fetchManifest,
    check = transport.check;
  transport.fetchManifest = async (...args) => change(await fetch(...args));
  transport.check = async input => {
    const report = await check(input);
    return report.manifest ? { ...report, manifest: change(report.manifest) } : report;
  };
};
/**
 * Another instance's administrator approved this manifest (D144): the store records it as offered, then approves that
 * offer, the only way an approved manifest changes.
 */
const approvedElsewhere = async (store: ReturnType<typeof memoryConnectorStore>, id: string, manifest: unknown) => {
  await store.recordCheck(id, { url: (await store.read(id))!.url!, served: manifest, at: T0 });
  const row = (await store.read(id))!;
  expect(
    await store.transaction(tx =>
      tx.approveOffer(id, { at: row.offeredAt!, manifest: row.offered, version: row.version }, manifest, 'test', T0),
    ),
  ).toBe(true);
};
/** An administrator reads in what the service serves and approves the offer they were shown (D144). */
const approveServed = async (admin: ReturnType<typeof connectorUsecases>, id: string) => {
  const offered = (await admin.refreshManifest(mikael, id, {})).connector.offered?.revision;
  return admin.refreshManifest(mikael, id, { apply: true, ...(offered ? { offered } : {}) });
};

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
  /**
   * Whether the hello service answers, and how: `failure` is what fetch throws when it does not (under Node, "fetch
   * failed" with the network's or the TLS library's code on its cause), `status` an error status its manifest answers
   * with, and `serve` what it serves in place of its own manifest at each read, else `manifest` at every read.
   */
  const service = {
    up: options.helloUp !== false,
    failure: () =>
      new TypeError('fetch failed', {
        cause: Object.assign(new Error('connect ECONNREFUSED 10.0.0.5:4010'), { code: 'ECONNREFUSED' }),
      }),
    status: undefined as number | undefined,
    manifest: undefined as unknown,
    serve: undefined as (() => unknown) | undefined,
  };
  const helloFetch: FetchLike = async (input, init) => {
    if (!service.up) throw service.failure();
    if (input.endsWith('/clew/manifest')) {
      if (service.status) return new Response('Service Unavailable', { status: service.status });
      const served = service.serve ? service.serve() : service.manifest;
      if (served !== undefined) return Response.json(served);
    }
    return hello.handle(new Request(input, init));
  };
  /** What the transport said through the connectors' log port (D91). */
  const logged: Array<{ message: string; details: unknown[] }> = [];
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
    // The server's own transport (CB-9), with test keys and the in-process service.
    transport: serviceTransport({
      assert: id => sign(SECRET, id),
      assertForeign: id => sign('another-secret-another', id),
      fetch: helloFetch,
      log: (message, ...details) => logged.push({ message, details }),
    }),
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
    service,
    logged,
    transport: deps.transport,
    reconcile,
    advance: (ms: number) => {
      now += ms;
    },
  };
}
const actions = (store: ReturnType<typeof memoryConnectorStore>, id: string) =>
  store.audit.filter(a => a.subject === 'connector:' + id).map(a => a.action);

describe('who may administer', () => {
  test('a refused manifest preview or update never looks up the connector or calls its service', async () => {
    const { admin, store, transport } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    const read = spyOn(store, 'read');
    const fetchManifest = spyOn(transport, 'fetchManifest');
    for (const id of ['hello', 'missing']) {
      for (const apply of [false, true])
        await expect(admin.refreshManifest(hassan, id, { apply })).rejects.toThrow(/behörighet/);
    }
    const stale = {
      ...mikael,
      authorize: async () => {
        throw new Error('Session expired');
      },
    };
    await expect(admin.refreshManifest(stale, 'hello', { apply: true })).rejects.toThrow('Session expired');
    expect(read).not.toHaveBeenCalled();
    expect(fetchManifest).not.toHaveBeenCalled();
    expect(actions(store, 'hello')).toEqual(['connector.added']);
  });
  test('a session ending between the review and the approval prevents the update and its audit row', async () => {
    const { admin, store, transport } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    serving(transport, m => ({ ...m, source: 'Hello 2' }));
    const offered = (await admin.refreshManifest(mikael, 'hello', {})).connector.offered!.revision;
    const before = await store.read('hello');
    const session = {
      ...mikael,
      authorize: async () => {
        throw new Error('Session expired');
      },
    };
    await expect(admin.refreshManifest(session, 'hello', { apply: true, offered })).rejects.toThrow('Session expired');
    expect(await store.read('hello')).toEqual(before);
    expect(actions(store, 'hello')).toEqual(['connector.added']);
  });
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
      counts: { capabilities: 6, execute: 2, tools: 3 },
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
    // Enabling approves no manifest (D144): a draft with none is read in and approved first.
    await expect(admin.update(mikael, 'hello', { state: 'enabled' })).rejects.toThrow('ingen godkänd beskrivning');
  });
  test('testing a service that stopped answering records unreachable, and one serving a manifest Clew does not load records manifest-invalid (CB-9)', async () => {
    const { admin, store, service } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    service.up = false;
    const down = await admin.test(mikael, 'hello');
    expect(down.ok).toBe(false);
    expect(down.health).toEqual({ status: 'unreachable', at: T0, detail: 'manifest: fetch failed (ECONNREFUSED)' });
    expect((await store.read('hello'))!.health.status).toBe('unreachable');
    service.up = true;
    service.manifest = { protocol: 1, id: 'hello' };
    const invalid = await admin.test(mikael, 'hello');
    expect(invalid.ok).toBe(false);
    expect(invalid.health).toMatchObject({
      status: 'manifest-invalid',
      detail: expect.stringContaining('Invalid connector manifest'),
    });
    expect((await store.read('hello'))!.health.status).toBe('manifest-invalid');
    // The approved manifest stays as it was, and so does the connector's state.
    expect((await store.read('hello'))!.manifest).toMatchObject({ id: 'hello', source: 'Hello' });
    service.manifest = undefined;
    expect((await admin.test(mikael, 'hello')).health.status).toBe('ok');
  });
  test("a failure to connect tells the administrator its cause's code and never what the other end said; the log says the rest (CB-9)", async () => {
    const { admin, store, service, logged } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    expect(logged).toEqual([]);
    service.up = false;
    // Under Node a certificate that does not hold, a name that does not resolve and a refused connection are all
    // "fetch failed"; the cause's code tells them apart, and its message is the other end's business.
    for (const [code, said] of [
      ['CERT_HAS_EXPIRED', 'certificate has expired; hello.kommunen.se says: call the help desk'],
      ['ENOTFOUND', 'getaddrinfo ENOTFOUND hello.kommunen.se'],
    ] as const) {
      service.failure = () => new TypeError('fetch failed', { cause: Object.assign(new Error(said), { code }) });
      const report = await admin.test(mikael, 'hello');
      const detail = `fetch failed (${code})`;
      expect(report.health).toEqual({ status: 'unreachable', at: T0, detail: 'manifest: ' + detail });
      expect(report.items).toEqual([
        {
          level: 'fail',
          group: 'connection',
          label: 'Systemets beskrivning kunde inte hämtas',
          description: 'Adressen svarade inte, eller inte med en beskrivning i protokollets form.',
          // What the runtime said stays apart from the Swedish words, for the page to show as a technical cause (WA-L12).
          cause: detail,
        },
      ]);
      expect(JSON.stringify([report, await store.read('hello')])).not.toContain('kommunen.se');
      // The people who run Clew read what the error and its cause say, through the connectors' log port (D91).
      expect(logged.at(-1)).toEqual({
        message: 'A connector check could not read the manifest',
        details: [
          {
            connector: 'hello',
            url: 'http://hello',
            health: 'unreachable',
            failure: { name: 'TypeError', code, message: 'fetch failed', cause: said },
          },
        ],
      });
    }
  });
  test('a manifest that answers an error status is unreachable, and says the status (CB-9)', async () => {
    const { admin, store, service } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    service.status = 503;
    const report = await admin.test(mikael, 'hello');
    expect(report.health).toEqual({
      status: 'unreachable',
      at: T0,
      detail: 'manifest: GET http://hello/clew/manifest answered 503.',
    });
    expect((await store.read('hello'))!.health.status).toBe('unreachable');
  });
  test("a manifest Clew does not load at the check's own read, after the first read found one it loads, is manifest-invalid (CB-9)", async () => {
    const { admin, store, service, logged } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    // The service is redeployed between the transport's read and the check's.
    let reads = 0;
    service.serve = () => (++reads === 2 ? { protocol: 1, id: 'hello' } : undefined);
    const report = await admin.test(mikael, 'hello');
    expect(reads).toBe(2);
    expect(report.health).toMatchObject({
      status: 'manifest-invalid',
      detail: expect.stringContaining('Invalid connector manifest'),
    });
    expect((await store.read('hello'))!.health.status).toBe('manifest-invalid');
    expect(logged.at(-1)).toMatchObject({
      details: [
        {
          connector: 'hello',
          health: 'manifest-invalid',
          finding: expect.stringContaining('Invalid connector manifest'),
        },
      ],
    });
  });
  test('adding a service that serves a manifest Clew does not load stores its draft, recorded as manifest-invalid (CB-9)', async () => {
    const { admin, store, service } = world();
    service.manifest = { protocol: 1, id: 'hello' };
    const { connector, report } = await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    expect(report.ok).toBe(false);
    expect(connector).toMatchObject({ state: 'draft', health: { status: 'manifest-invalid' } });
    expect(store.audit).toEqual([
      expect.objectContaining({
        action: 'connector.added',
        details: expect.objectContaining({ capabilities: 0, health: 'manifest-invalid' }),
      }),
    ]);
  });
  test('each switch, the address and a step back to draft is its own audit row with what changed (CB-10)', async () => {
    const { admin, store, registry } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    await admin.update(mikael, 'hello', { state: 'enabled' });
    const n = store.audit.length;
    await admin.update(mikael, 'hello', {
      scanEnabled: false,
      toolsEnabled: false,
      capabilities: { 'hello.greeting': { model: false } },
    });
    await admin.update(mikael, 'hello', { url: 'http://hello-2/' });
    const back = await admin.update(mikael, 'hello', { state: 'draft' });
    expect(back).toMatchObject({ state: 'draft', registered: false, url: 'http://hello-2' });
    expect(registry.connector('hello')).toBeUndefined();
    const row = (action: string, details: Record<string, unknown>) => ({
      actor: 'person:mikael',
      action,
      subject: 'connector:hello',
      at: T0,
      details,
    });
    expect(store.audit.slice(n)).toEqual([
      row('connector.scan', { to: false }),
      row('connector.tools', { to: false }),
      row('connector.capability', { to: { 'hello.greeting': { model: false } } }),
      row('connector.url', { from: 'http://hello', to: 'http://hello-2' }),
      row('connector.draft', { from: 'enabled' }),
    ]);
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
    // Reading the manifest in is no check: the health the check recorded stays.
    expect((await admin.refreshManifest(mikael, 'hello', {})).connector.health.status).toBe('secret-rejected');
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
    // Nothing of it was in the competence register, so no row says anything went from there.
    expect(store.audit.filter(a => a.action === 'competence.source_forgotten')).toEqual([]);
    await expect(admin.read(mikael, 'hello')).rejects.toThrow('finns inte');
  });
  test('removing a connector the competence register copied from audits what went with it, as forgetting the source does (DE-L4)', async () => {
    const { admin, store } = world();
    await admin.add(mikael, { id: 'lms', url: 'http://lms', secret: SECRET });
    store.copied.push(
      { connector: 'lms', kind: 'source' },
      { connector: 'lms', kind: 'holding' },
      { connector: 'lms', kind: 'holding' },
      { connector: 'lms', kind: 'holding' },
      { connector: 'lms', kind: 'mapping' },
    );
    expect(await admin.remove(mikael, 'lms')).toEqual({ closedCards: 0 });
    expect(store.copied).toEqual([]);
    expect(store.audit.slice(-2)).toMatchObject([
      { actor: 'person:mikael', action: 'connector.removed', subject: 'connector:lms', details: { closedCards: 0 } },
      {
        actor: 'person:mikael',
        action: 'competence.source_forgotten',
        subject: 'connector:lms',
        details: { holdings: 3, mappings: 1 },
      },
    ]);
  });
  test('a stored manifest the loader refuses, on a number this Clew does not load (D129), is never put live by a change to its row', async () => {
    const { admin, store, registry, live } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    await admin.update(mikael, 'hello', { state: 'enabled' });
    expect(registry.governance('hello').state).toBe('enabled');
    // A row written under another protocol number: the service has moved on, the stored copy has not.
    const stored = (await store.read('hello'))!.manifest as ConnectorManifest;
    await approvedElsewhere(store, 'hello', { ...stored, protocol: 2 });
    const before = live.registered.length;
    await admin.update(mikael, 'hello', { figures: { hello: false } });
    expect(live.registered.length).toBe(before);
    expect(registry.governance('hello')).toMatchObject({ state: 'disabled', toolsEnabled: false, scanEnabled: false });
    // Its own refresh brings the service's manifest; approved, it goes live and governed again.
    await approveServed(admin, 'hello');
    expect(live.registered.length).toBe(before + 1);
    expect(registry.governance('hello').state).toBe('enabled');
  });
});

describe('a change is made on the connector as the administrator saw it (DE-M5)', () => {
  test('a change sent with a version saved over since is refused and writes nothing; sent with the current one it goes through', async () => {
    const { admin, store } = world();
    const { connector } = await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    expect(connector.version).toBe(1);
    // Another administrator enables it after this page was read.
    expect((await admin.update(mikael, 'hello', { state: 'enabled', version: 1 })).version).toBe(2);
    const before = await store.read('hello'),
      audited = store.audit.length;
    await expect(admin.update(mikael, 'hello', { scanEnabled: false, version: 1 })).rejects.toThrow(CHANGED_SINCE);
    expect(await store.read('hello')).toEqual(before);
    expect(store.audit).toHaveLength(audited);
    expect(await admin.update(mikael, 'hello', { scanEnabled: false, version: 2 })).toMatchObject({
      state: 'enabled',
      scanEnabled: false,
      version: 3,
    });
  });
  test('a change saved between the read and the write is refused, not merged with it', async () => {
    const { admin, store } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    // Another administrator's change lands after this one has read the row and before its transaction begins.
    const transaction = store.transaction;
    let raced = false;
    store.transaction = (async fn => {
      if (!raced) {
        raced = true;
        await transaction(tx => tx.update('hello', { toolsEnabled: false }, 'person:other', T0));
      }
      return transaction(fn);
    }) as typeof store.transaction;
    await expect(admin.update(mikael, 'hello', { scanEnabled: false })).rejects.toThrow(CHANGED_SINCE);
    expect(await store.read('hello')).toMatchObject({ toolsEnabled: false, scanEnabled: true, version: 2 });
    expect(actions(store, 'hello')).toEqual(['connector.added']);
  });
  test('a check of a connector another administrator moves while the service answers records nothing, and is asked for again', async () => {
    const { admin, store, transport, advance } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    const before = (await store.read('hello'))!;
    advance(60_000);
    // The old address serves another manifest; Anna moves the connector while it answers Mikael's check.
    serving(transport, m => ({ ...m, source: 'Hello på den gamla adressen' }));
    const check = transport.check;
    transport.check = async input => {
      const report = await check(input);
      await admin.update(anna, 'hello', { url: 'http://hello-2' });
      return report;
    };
    await expect(admin.test(mikael, 'hello')).rejects.toThrow(CHANGED_WHILE_CHECKED);
    // Neither the old address's health nor its manifest is on the row: nothing of it can be approved at the new one.
    expect(await store.read('hello')).toMatchObject({
      url: 'http://hello-2',
      health: before.health,
      offered: null,
      offeredAt: null,
      manifest: before.manifest,
    });
    expect((await admin.read(mikael, 'hello')).offered).toBeNull();
    expect(actions(store, 'hello')).toEqual(['connector.added', 'connector.url']);
  });
  test('a check of a connector another administrator rekeys while the service answers records nothing either', async () => {
    const { admin, store, transport, advance } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    const before = (await store.read('hello'))!;
    advance(60_000);
    const check = transport.check;
    transport.check = async input => {
      const report = await check(input);
      await admin.rotateSecret(anna, 'hello', { secret: 'a-brand-new-secret-value' });
      return report;
    };
    await expect(admin.test(mikael, 'hello')).rejects.toThrow(CHANGED_WHILE_CHECKED);
    expect((await store.read('hello'))!.health).toEqual(before.health);
  });
  test('"Läs in igen" of a connector moved while the service answers offers nothing of what the old address served', async () => {
    const { admin, store, transport } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    const fetchManifest = transport.fetchManifest;
    transport.fetchManifest = async (url, id) => {
      const served = await fetchManifest(url, id);
      await admin.update(anna, 'hello', { url: 'http://hello-2' });
      return { ...served, source: 'Hello på den gamla adressen' };
    };
    await expect(admin.refreshManifest(mikael, 'hello', {})).rejects.toThrow(MOVED_WHILE_READ);
    expect(await store.read('hello')).toMatchObject({ url: 'http://hello-2', offered: null, offeredAt: null });
  });
  test('a new address drops an offer a check recorded after the move was read, which the row read did not hold', async () => {
    const { admin, store } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    const approved = (await store.read('hello'))!.manifest as ConnectorManifest;
    // A check of the old address records an offer between the move's read and its write; it raises no version.
    const transaction = store.transaction;
    store.transaction = (async (fn: Parameters<typeof transaction>[0]) => {
      store.transaction = transaction;
      expect(
        await store.recordCheck('hello', {
          url: 'http://hello',
          served: { ...approved, source: 'Hello på den gamla adressen' },
          at: T0,
        }),
      ).toBe(true);
      return transaction(fn);
    }) as typeof transaction;
    await admin.update(mikael, 'hello', { url: 'http://hello-2' });
    expect(await store.read('hello')).toMatchObject({ url: 'http://hello-2', offered: null, offeredAt: null });
  });
});

describe('a manifest goes live only when an administrator approves it (D144)', () => {
  /** A new deployment of hello: it reads the economy system back as the person, is handed the person's token and is renamed. */
  const widened = (m: ConnectorManifest): ConnectorManifest => ({
    ...m,
    source: 'Hello 2',
    uses: [...(m.uses ?? []), 'finance.invoices'],
    delegation: { audience: 'hr-api' },
  });
  test('Testa anslutning, a boot and the watcher record the change as offered and put nothing of it live, with no audit row', async () => {
    const { admin, store, registry, transport, reconcile, live } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    await admin.update(mikael, 'hello', { state: 'enabled' });
    await applyAllRows(reconcile);
    const approved = (await store.read('hello'))!;
    const registered = live.registered.length;
    serving(transport, widened);
    // The check says a change waits, so the page can say so where the administrator is.
    expect((await admin.test(mikael, 'hello')).offered).toBe(true);
    await applyAllRows(reconcile);
    const row = (await store.read('hello'))!;
    expect(row.manifest).toEqual(approved.manifest);
    expect(row.version).toBe(approved.version);
    expect((row.offered as ConnectorManifest).source).toBe('Hello 2');
    expect(row.offeredAt).toBe(T0);
    expect(registry.connector('hello')!.source).toBe('Hello');
    expect(live.registered.length).toBe(registered);
    expect(actions(store, 'hello')).toEqual(['connector.added', 'connector.enabled']);
    // The page names the waiting change, and the approved manifest's reads and token are on it today.
    const detail = await admin.read(mikael, 'hello');
    expect(detail).toMatchObject({ uses: ['calendar.today'], delegation: null });
    expect(detail.offered).toEqual({
      at: T0,
      revision: expect.stringMatching(/^[a-f0-9]{64}$/),
      diff: {
        added: [],
        removed: [],
        changed: [],
        areasAdded: [],
        areasRemoved: [],
        areasChanged: [],
        usesAdded: ['finance.invoices'],
        usesRemoved: [],
        delegation: { from: null, to: 'hr-api' },
        fields: ['source'],
        same: false,
      },
    });
  });
  test('approving puts the offer shown live with one audit row naming what it reads and whose token it gets', async () => {
    const { admin, store, registry, transport, advance } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    await admin.update(mikael, 'hello', { state: 'enabled' });
    serving(transport, widened);
    const review = await admin.refreshManifest(mikael, 'hello', {});
    expect(review.diff).toMatchObject({ usesAdded: ['finance.invoices'], delegation: { from: null, to: 'hr-api' } });
    advance(60_000);
    const applied = await admin.refreshManifest(mikael, 'hello', {
      apply: true,
      offered: review.connector.offered!.revision,
    });
    expect(applied.connector).toMatchObject({
      uses: ['calendar.today', 'finance.invoices'],
      delegation: 'hr-api',
      offered: null,
      source: 'Hello 2',
    });
    expect(registry.connector('hello')!.source).toBe('Hello 2');
    expect(actions(store, 'hello')).toEqual(['connector.added', 'connector.enabled', 'connector.manifest']);
    expect(store.audit.at(-1)).toMatchObject({
      actor: 'person:mikael',
      details: {
        offeredAt: T0,
        usesAdded: ['finance.invoices'],
        delegation: { from: null, to: 'hr-api' },
        fields: ['source'],
      },
    });
  });
  test('a wizard retry approves only its original draft; an enabled connector keeps its offer for review', async () => {
    const { admin, store, transport } = world();
    const { connector: draft } = await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    serving(transport, widened);
    const first = (await admin.refreshManifest(mikael, 'hello', {})).connector.offered!;
    const { connector: reviewed } = await admin.refreshManifest(mikael, 'hello', {
      apply: true,
      offered: first.revision,
      draftVersion: draft.version,
    });
    expect(reviewed.state).toBe('draft');
    const active = await admin.update(mikael, 'hello', { state: 'enabled' });
    serving(transport, m => ({ ...m, source: 'Next' }));
    const next = (await admin.refreshManifest(mikael, 'hello', {})).connector.offered!;
    for (const draftVersion of [reviewed.version, active.version]) {
      await expect(
        admin.refreshManifest(mikael, 'hello', { apply: true, offered: next.revision, draftVersion }),
      ).rejects.toThrow(CHANGED_SINCE);
    }
    expect((await admin.read(mikael, 'hello')).offered?.revision).toBe(next.revision);
    expect(actions(store, 'hello')).toEqual(['connector.added', 'connector.manifest', 'connector.enabled']);
  });
  test.each([0, 60_000])('a replacement offer is refused even when the clock advances by %i ms', async delay => {
    const { admin, store, transport, advance } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    await expect(admin.refreshManifest(mikael, 'hello', { apply: true, offered: T0 })).rejects.toThrow(
      'ingen ändring att godkänna',
    );
    serving(transport, widened);
    const shown = (await admin.refreshManifest(mikael, 'hello', {})).connector.offered!.revision;
    // Two different offers can be observed in the same millisecond.
    advance(delay);
    serving(transport, m => ({ ...m, uses: [...(m.uses ?? []), 'clew.work'] }));
    await admin.test(mikael, 'hello');
    const before = await store.read('hello');
    await expect(admin.refreshManifest(mikael, 'hello', { apply: true, offered: shown })).rejects.toThrow(
      'ändrats igen',
    );
    expect(await store.read('hello')).toEqual(before);
    expect(actions(store, 'hello')).toEqual(['connector.added']);
  });
  test('a change inside a capability or an area is named with its fields, in the review and the audit row', async () => {
    const { admin, store, transport } = world();
    // What was approved: the area for managers only, without a figure, and the greeting for managers.
    const { fetchManifest, check } = transport;
    serving(transport, m => ({
      ...m,
      areas: m.areas.map(({ figure: _figure, ...a }) => ({ ...a, roles: ['manager'] })),
      capabilities: m.capabilities.map(c =>
        c.name === 'hello.greeting' ? { ...c, scope: { roles: ['manager'] } } : c,
      ),
    }));
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    // The service now shows the area to everyone with a figure, and greets everyone.
    Object.assign(transport, { fetchManifest, check });
    expect((await admin.test(mikael, 'hello')).offered).toBe(true);
    const offer = (await admin.read(mikael, 'hello')).offered!;
    expect(offer.diff).toMatchObject({
      added: [],
      removed: [],
      changed: [{ name: 'hello.greeting', fields: ['scope'] }],
      areasAdded: [],
      areasRemoved: [],
      areasChanged: [{ id: 'hello', fields: ['figure', 'roles'] }],
      fields: [],
      same: false,
    });
    await admin.refreshManifest(mikael, 'hello', { apply: true, offered: offer.revision });
    expect(store.audit.at(-1)).toMatchObject({
      action: 'connector.manifest',
      details: {
        changed: [{ name: 'hello.greeting', fields: ['scope'] }],
        areasChanged: [{ id: 'hello', fields: ['figure', 'roles'] }],
      },
    });
  });
  test('`uses` in another order is no change; capabilities in another order are, and the review says so', async () => {
    const { admin, transport } = world();
    const { fetchManifest, check } = transport;
    serving(transport, m => ({ ...m, uses: ['calendar.today', 'hr.whoIsOn'] }));
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    Object.assign(transport, { fetchManifest, check });
    serving(transport, m => ({ ...m, uses: ['hr.whoIsOn', 'calendar.today'] }));
    expect((await admin.test(mikael, 'hello')).offered).toBe(false);
    expect((await admin.read(mikael, 'hello')).offered).toBeNull();
    serving(transport, m => ({ ...m, capabilities: [...m.capabilities].reverse() }));
    expect((await admin.test(mikael, 'hello')).offered).toBe(true);
    expect((await admin.read(mikael, 'hello')).offered!.diff).toMatchObject({
      added: [],
      removed: [],
      changed: [],
      usesAdded: [],
      usesRemoved: [],
      fields: ['capabilities'],
      same: false,
    });
  });
  test('a second add of the same id at once writes no row saying it was added', async () => {
    const { admin, store } = world();
    const transaction = store.transaction;
    // The other administrator's add lands between this one's check that the id is free and its insert.
    store.transaction = async run =>
      transaction(async tx => {
        tx.insert = async () => false;
        return run(tx);
      });
    await expect(admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET })).rejects.toThrow(
      'Anslutningen finns redan.',
    );
    expect(actions(store, 'hello')).toEqual([]);
  });
  test('a new address drops the offer the old one served, so what is approved is what the new one serves', async () => {
    const { admin, store, transport } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    serving(transport, widened);
    expect((await admin.test(mikael, 'hello')).offered).toBe(true);
    await admin.update(mikael, 'hello', { url: 'http://hello-2' });
    expect(await store.read('hello')).toMatchObject({ url: 'http://hello-2', offered: null, offeredAt: null });
    expect((await admin.read(mikael, 'hello')).offered).toBeNull();
  });
  test('a check that records another offer while the approval is written leaves the approved manifest as it was', async () => {
    const { admin, store, transport, advance } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    serving(transport, widened);
    const shown = (await admin.refreshManifest(mikael, 'hello', {})).connector.offered!.revision;
    const approved = (await store.read('hello'))!.manifest as ConnectorManifest;
    // Between the approval's read and its write, a check stores a newer offer.
    advance(60_000);
    const transaction = store.transaction;
    store.transaction = (async (fn: Parameters<typeof transaction>[0]) => {
      store.transaction = transaction;
      await store.recordCheck('hello', {
        url: 'http://hello',
        served: { ...approved, source: 'Hello 3' },
        at: '2026-11-04T07:02:00.000Z',
      });
      return transaction(fn);
    }) as typeof transaction;
    await expect(admin.refreshManifest(mikael, 'hello', { apply: true, offered: shown })).rejects.toThrow(
      'ändrats igen',
    );
    const row = (await store.read('hello'))!;
    expect(row.manifest).toEqual(approved);
    expect((row.offered as ConnectorManifest).source).toBe('Hello 3');
    expect(actions(store, 'hello')).toEqual(['connector.added']);
  });
  test('the service serving the approved manifest again takes the offer away', async () => {
    const { admin, store, transport } = world();
    await admin.add(mikael, { id: 'hello', url: 'http://hello', secret: SECRET });
    const { fetchManifest, check } = transport;
    serving(transport, widened);
    await admin.test(mikael, 'hello');
    expect((await store.read('hello'))!.offered).not.toBeNull();
    Object.assign(transport, { fetchManifest, check });
    expect((await admin.refreshManifest(mikael, 'hello', {})).diff.same).toBe(true);
    expect(await store.read('hello')).toMatchObject({ offered: null, offeredAt: null });
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
    await store.recordDescription('finance', { ...described, capabilities: [] }, T0);
    expect((await store.read('finance'))!.manifest).toMatchObject({ capabilities: [] });
    await syncBundledRows(reconcile);
    const after = (await store.read('finance'))!;
    expect((after.manifest as ConnectorManifest).capabilities.map(c => c.name)).toEqual(['finance.invoices']);
    expect(after.version).toBe(before.version);
    expect(store.audit).toEqual([]);
    // The same description in another key order is not a change.
    await store.recordDescription('finance', JSON.parse(JSON.stringify(described)), T0);
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
        manifest: { ...describeBundled(users()), source: 'Clew' },
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
    await approvedElsewhere(w.store, 'hello', manifest);
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
/** A world with two connectors that can give the shared header, neither chosen yet. */
async function headerWorld() {
  const w = world();
  await syncBundledRows(w.reconcile);
  for (const [id, name] of [
    ['intranet', 'Intranätet'],
    ['sharepoint', 'SharePoint'],
  ] as const) {
    w.registry.register(headerConnector(id, name));
    w.registry.govern(id, { ...w.registry.governance('finance'), state: 'enabled', audience: { mode: 'all' } });
    await w.store.transaction(tx =>
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
  return w;
}
describe('the shared header is given by one chosen connector (D88)', () => {
  test('two administrators choosing different holders at once leave one holder, and the audit says who took it from whom (DE-M5)', async () => {
    const { admin, registry, store } = await headerWorld();
    // Both are saved: the one decided second takes the header from the one decided first.
    await Promise.all([
      admin.update(mikael, 'intranet', { header: true }),
      admin.update(mikael, 'sharepoint', { header: true }),
    ]);
    const holders = (await admin.list(mikael)).filter(c => c.header).map(c => c.id);
    expect(holders).toHaveLength(1);
    const won = holders[0]!,
      lost = won === 'intranet' ? 'sharepoint' : 'intranet';
    expect(store.audit.filter(a => a.action === 'connector.header').map(a => [a.subject, a.details])).toEqual([
      ['connector:' + lost, { to: true }],
      ['connector:' + won, { to: true, from: lost }],
      ['connector:' + lost, { to: false, takenBy: won }],
    ]);
    expect(registry.governance(won).header).toBe(true);
    expect(registry.governance(lost).header).toBeUndefined();
  });
  test('an administrator chooses the holder on its page; choosing another takes it over with an audit row on both, and a connector without the capability is refused', async () => {
    const { admin, registry, store } = await headerWorld();
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
    ).toEqual({ status: 'refused' });
    const chosen = await admin.update(mikael, 'intranet', { header: true });
    expect(chosen.header).toBe(true);
    expect(registry.governance('intranet').header).toBe(true);
    expect(actions(store, 'intranet')).toEqual(['connector.header']);
    expect(
      await registry.header({
        id: 'hassan',
        name: 'Hassan',
        unitId: 'unit-skola',
        unitLabel: 'Skolan',
        role: 'employee',
      }),
    ).toMatchObject({ status: 'answered', connector: { id: 'intranet' } });
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
