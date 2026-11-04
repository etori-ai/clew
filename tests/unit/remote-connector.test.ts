import { describe, expect, test } from 'bun:test';
import { SignJWT } from 'jose';
import { Registry, type Actor } from '../../packages/connectors/src/index';
import { protocolSchema } from '../../packages/connectors/src/protocol';
import { ManifestError, fetchManifest, parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createConnector, manifest as helloManifest } from '../../connectors/hello/connector.mjs';
import { assertionFor, loadConnectors, verifyAssertion } from '../../apps/server/src/connectors/remote';
import type { ConnectorHealth } from '../../packages/db/src/connectors';

const secret = 'test-secret-test-secret';
const hillevi: Actor = { id: 'hillevi', name: 'Hillevi Berg', unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role: 'manager' };
const hassan: Actor = { id: 'hassan', name: 'Hassan Ali', unitId: 'unit-skola', unitLabel: 'Skönsmons skola', role: 'employee' };

/** The hello service in-process, plus a fake Clew for its callback: calendar.today answers with two meetings. */
function stack() {
  const clewCalls: unknown[] = [];
  const clewFetch: FetchLike = async (input, init) => {
    clewCalls.push({ url: String(input), auth: new Headers(init?.headers).get('authorization')?.slice(0, 7), body: JSON.parse(String(init?.body)) });
    return Response.json({ output: { date: '2026-11-04', events: [{ allDay: false }, { allDay: true }, { allDay: false }], gaps: [] } });
  };
  const hello = createConnector({ secret, clewUrl: 'http://clew', fetch: clewFetch });
  const connectorFetch: FetchLike = (input, init) => hello.handle(new Request(input, init));
  const registry = new Registry();
  return { registry, connectorFetch, clewCalls, load: async () => registry.register(remoteConnector(await fetchManifest('http://hello', 'hello', connectorFetch), { url: 'http://hello', assert: assertionFor('hello', secret), fetch: connectorFetch })) };
}

describe('connector protocol', () => {
  test('the committed JSON Schema is the one the code generates', async () => {
    const committed = await Bun.file(new URL('../../docs/protocol/connector-protocol.schema.json', import.meta.url)).json();
    expect(committed).toEqual(JSON.parse(JSON.stringify(protocolSchema())));
  });
  test('the example manifest is valid and the rules of the registry apply to manifests', () => {
    expect(parseManifest(helloManifest, 'hello').id).toBe('hello');
    expect(() => parseManifest({ ...(helloManifest as object), id: 'other' }, 'hello')).toThrow(ManifestError);
    expect(() => parseManifest({ ...(helloManifest as object), capabilities: [{ name: 'hello.x', kind: 'execute', title: 'x', description: 'x', input: {}, output: {}, model: true, scope: {} }] })).toThrow(/D8/);
    expect(() => parseManifest({ protocol: 2 })).toThrow(/Invalid connector manifest/);
  });
});

describe('a remote connector in the registry', () => {
  test('is listed, scoped and run like a bundled one', async () => {
    const { registry, load } = stack(); await load();
    expect(registry.tools(hassan).map(t => t.name)).toEqual(['hello.greeting', 'hello.dayWithMeetings']);
    expect(registry.tools(hillevi).map(t => t.name)).toContain('hello.openItems');
    await expect(registry.run(hassan, 'hello.openItems', {})).rejects.toThrow(/behörighet/);
    expect(await registry.run(hassan, 'hello.greeting', {})).toEqual({ text: 'Hej Hassan Ali! Hälsningar från hello-anslutningen till Skönsmons skola.' });
    const areas = await registry.areas(hillevi);
    expect(areas[0]).toMatchObject({ id: 'hello', connector: 'hello', source: 'Hello', figure: { label: '2 saker väntar', tone: 'warn' } });
  });
  test('scans, executes with a receipt and undoes', async () => {
    const { registry, load } = stack(); await load();
    expect(await registry.scan(hassan)).toEqual([]);
    const [draft] = await registry.scan(hillevi);
    expect(draft).toMatchObject({ connector: 'hello', topic: 'hello:open-items', area: 'hello' });
    const result = await registry.run<{ rows: { outcome: string }[]; undoCapability: string }>(hillevi, 'hello.markDone', { refs: ['hello:item:1', 'hello:item:9'] });
    expect(result.rows.map(r => r.outcome)).toEqual(['done', 'failed']);
    expect(result.undoCapability).toBe('hello.undo');
    expect((await registry.areas(hillevi))[0]?.figure).toEqual({ label: '1 saker väntar', tone: 'warn' });
    await registry.run(hillevi, 'hello.undo', { refs: ['hello:item:1'] });
    expect((await registry.scan(hillevi))[0]?.items).toHaveLength(2);
  });
  test('calls back into Clew with the assertion it was given, as the same person', async () => {
    const { registry, load, clewCalls } = stack(); await load();
    expect(await registry.run(hassan, 'hello.dayWithMeetings', {})).toEqual({ meetings: 2, text: 'Hassan Ali har 2 möten i dag och 2 saker kvar i hello-anslutningen.' });
    expect(clewCalls).toEqual([{ url: 'http://clew/api/connectors/call', auth: 'Bearer ', body: { name: 'calendar.today', input: {} } }]);
  });
  test('refuses a call signed with another secret, on the connector side', async () => {
    const { registry, connectorFetch } = stack();
    registry.register(remoteConnector(parseManifest(helloManifest), { url: 'http://hello', assert: assertionFor('hello', 'another-secret-another'), fetch: connectorFetch }));
    await expect(registry.run(hassan, 'hello.greeting', {})).rejects.toThrow(/Ogiltigt behörighetsbevis/);
  });
  test('a connector that is down degrades to a Swedish unavailable error and a warning figure', async () => {
    const down: FetchLike = async () => { throw new Error('ECONNREFUSED'); };
    const registry = new Registry().register(remoteConnector(parseManifest(helloManifest), { url: 'http://hello', assert: assertionFor('hello', secret), fetch: down }));
    await expect(registry.run(hassan, 'hello.greeting', {})).rejects.toThrow('Hello svarar inte just nu.');
    expect((await registry.areas(hillevi))[0]?.figure).toEqual({ label: 'Hello svarar inte', tone: 'warn' });
  });
});

describe('assertions and configuration', () => {
  test('an assertion is accepted only by Clew for the connector it was issued to', async () => {
    const token = await assertionFor('hello', secret)(hillevi);
    expect(await verifyAssertion(token, id => (id === 'hello' ? secret : undefined))).toEqual({ connectorId: 'hello', actor: hillevi });
    await expect(verifyAssertion(token, () => 'wrong-secret-wrong-secret')).rejects.toThrow(/Invalid assertion/);
    await expect(verifyAssertion(token, () => undefined)).rejects.toThrow(/Unknown connector/);
    const foreign = await new SignJWT({ actor: hillevi }).setProtectedHeader({ alg: 'HS256' }).setIssuer('someone').setAudience('hello').setSubject('hillevi').setExpirationTime('2m').sign(new TextEncoder().encode(secret));
    await expect(verifyAssertion(foreign, () => secret)).rejects.toThrow(/Invalid assertion/);
    await expect(verifyAssertion('nonsense', () => secret)).rejects.toThrow(/Malformed/);
  });
  test('the loader registers enabled rows, refreshes the manifest and records health', async () => {
    const { registry, connectorFetch } = stack();
    const health: Array<[string, ConnectorHealth['status'], boolean]> = [];
    const record = async (id: string, h: ConnectorHealth, manifest?: unknown) => { health.push([id, h.status, manifest !== undefined]); };
    const loaded = await loadConnectors(registry, { rows: async () => [{ id: 'hello', url: 'http://hello', secret, manifest: null }], record, fetch: connectorFetch, attempts: 1, log: () => undefined });
    expect(loaded).toEqual(['hello']);
    expect(health).toEqual([['hello', 'ok', true]]);
    expect(registry.connector('hello')?.source).toBe('Hello');
    expect(await registry.run(hassan, 'hello.greeting', {})).toMatchObject({ text: expect.stringContaining('Hassan') });
  });
  test('a row with a stored manifest is served while its service is down, and the health says so', async () => {
    const registry = new Registry();
    const health: ConnectorHealth[] = [];
    const down: FetchLike = async () => { throw new Error('ECONNREFUSED'); };
    const loaded = await loadConnectors(registry, { rows: async () => [{ id: 'hello', url: 'http://hello', secret, manifest: helloManifest }], record: async (_id, h) => { health.push(h); }, fetch: down, attempts: 2, delayMs: 1, log: () => undefined });
    expect(loaded).toEqual([]);
    expect(health.map(h => h.status)).toEqual(['unreachable']);
    expect((await registry.areas(hillevi))[0]?.figure).toEqual({ label: 'Hello svarar inte', tone: 'warn' });
    await expect(registry.run(hassan, 'hello.greeting', {})).rejects.toThrow('Hello svarar inte just nu.');
  });
  test('an invalid manifest is recorded once and the row is skipped', async () => {
    const registry = new Registry();
    const health: ConnectorHealth[] = [];
    const bad: FetchLike = async () => Response.json({ protocol: 2 });
    await loadConnectors(registry, { rows: async () => [{ id: 'hello', url: 'http://hello', secret, manifest: null }], record: async (_id, h) => { health.push(h); }, fetch: bad, attempts: 5, log: () => undefined });
    expect(health.map(h => h.status)).toEqual(['manifest-invalid']);
    expect(registry.connector('hello')).toBeUndefined();
  });
});
