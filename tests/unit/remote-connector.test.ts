import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { SignJWT } from 'jose';
import { type Actor, type CapabilityError } from '../../packages/connectors/src/index';
import { MAX_ANSWER_BYTES, MAX_MANIFEST_BYTES, protocolSchema } from '../../packages/connectors/src/protocol';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  ManifestError,
  fetchManifest,
  parseManifest,
  remoteConnector,
  type FetchLike,
} from '../../packages/connectors/src/remote';
import { createConnector, manifest as helloManifest } from '../../connectors/hello/connector.mjs';
import { createVerifier } from '../../connectors/hello/verification.mjs';
import { loadConnectors, registerConnector } from '../../apps/server/src/connectors/remote';
import { assertionFor, signedRequest, testJwks, testAuthority } from '../connector-authority';
import { decodeJwt } from 'jose';
import { checkConnector } from '../../packages/connectors/src/check';
import type { ConnectorHealth } from '../../packages/db/src/schema';

const secret = 'test-secret-test-secret';
const hillevi: Actor = {
  id: 'hillevi',
  name: 'Hillevi Berg',
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: 'manager',
};
const hassan: Actor = {
  id: 'hassan',
  name: 'Hassan Ali',
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: 'employee',
};

/** The hello service in-process, plus a fake Clew for its callback: calendar.today answers with two meetings. */
function stack() {
  const clewCalls: unknown[] = [];
  const clewFetch: FetchLike = async (input, init) => {
    clewCalls.push({
      url: String(input),
      auth: new Headers(init?.headers).get('authorization')?.slice(0, 7),
      body: JSON.parse(String(init?.body)),
    });
    return Response.json({
      output: { date: '2026-11-04', events: [{ allDay: false }, { allDay: true }, { allDay: false }], gaps: [] },
    });
  };
  const hello = createConnector({ jwks: testJwks, secret, clewUrl: 'http://clew', fetch: clewFetch });
  const connectorFetch: FetchLike = (input, init) => hello.handle(new Request(input, init));
  const registry = new Registry();
  return {
    registry,
    connectorFetch,
    clewCalls,
    load: async () =>
      registry.register(
        remoteConnector(await fetchManifest('http://hello', 'hello', connectorFetch), {
          url: 'http://hello',
          key: secret,
          assert: assertionFor('hello', secret),
          fetch: connectorFetch,
        }),
      ),
  };
}

describe('connector protocol', () => {
  test('the committed JSON Schema is the one the code generates', async () => {
    const committed = await Bun.file(
      new URL('../../docs/protocol/connector-protocol.schema.json', import.meta.url),
    ).json();
    expect(committed).toEqual(JSON.parse(JSON.stringify(protocolSchema())));
  });
  test('the example manifest is valid and the rules of the registry apply to manifests', () => {
    expect(parseManifest(helloManifest, 'hello').id).toBe('hello');
    expect(() => parseManifest({ ...(helloManifest as object), id: 'other' }, 'hello')).toThrow(ManifestError);
    expect(() =>
      parseManifest({
        ...(helloManifest as object),
        capabilities: [
          {
            name: 'hello.x',
            kind: 'execute',
            title: 'x',
            description: 'x',
            input: {},
            output: {},
            model: true,
            scope: {},
          },
        ],
      }),
    ).toThrow(/D8/);
    expect(() => parseManifest({ protocol: 2 })).toThrow(/Invalid connector manifest/);
  });
  test("an area may name one of Clew's icons, and only one of them (D41)", async () => {
    const withIcon = (icon: string) => ({
      ...(helloManifest as { areas: object[] }),
      areas: (helloManifest as { areas: object[] }).areas.map(a => ({ ...a, icon })),
    });
    expect(parseManifest(withIcon('calendar'), 'hello').areas[0]!.icon).toBe('calendar');
    expect(() => parseManifest(withIcon('rocket'), 'hello')).toThrow(/Invalid connector manifest/);
    // The loaded connector hands it to the registry, which hands it to the person's areas.
    const registry = new Registry();
    registry.register(
      remoteConnector(parseManifest(withIcon('bell'), 'hello'), {
        url: 'http://hello',
        key: secret,
        assert: async () => 'x',
        fetch: async () => Response.json({ figure: null }),
      }),
    );
    expect(
      (
        await registry.areas({ id: 'p1', name: 'Testa Testsson', unitId: 'u1', unitLabel: 'Enhet', role: 'manager' })
      ).map(a => a.icon),
    ).toEqual(['bell']);
  });
});

describe('a remote connector in the registry', () => {
  test('is listed, scoped and run like a bundled one', async () => {
    const { registry, load } = stack();
    await load();
    expect(registry.tools(hassan).map(t => t.name)).toEqual(['hello.greeting', 'hello.dayWithMeetings']);
    expect(registry.tools(hillevi).map(t => t.name)).toContain('hello.openItems');
    await expect(registry.run(hassan, 'hello.openItems', {})).rejects.toThrow(/behörighet/);
    expect(await registry.run(hassan, 'hello.greeting', {})).toEqual({
      text: 'Hej Hassan Ali! Hälsningar från hello-anslutningen till Skönsmons skola.',
    });
    const areas = await registry.areas(hillevi);
    expect(areas[0]).toMatchObject({
      id: 'hello',
      connector: 'hello',
      source: 'Hello',
      figure: { label: '2 saker väntar', tone: 'warn' },
    });
  });
  test('scans, executes with a receipt and undoes', async () => {
    const { registry, load } = stack();
    await load();
    expect(await registry.scan(hassan)).toEqual([]);
    const [draft] = await registry.scan(hillevi);
    expect(draft).toMatchObject({ connector: 'hello', topic: 'hello:open-items', area: 'hello' });
    const result = await registry.run<{ rows: { outcome: string }[]; undoCapability: string }>(
      hillevi,
      'hello.markDone',
      { refs: ['hello:item:1', 'hello:item:9'] },
    );
    expect(result.rows.map(r => r.outcome)).toEqual(['done', 'failed']);
    expect(result.undoCapability).toBe('hello.undo');
    expect((await registry.areas(hillevi))[0]?.figure).toEqual({ label: '1 saker väntar', tone: 'warn' });
    await registry.run(hillevi, 'hello.undo', { refs: ['hello:item:1'] });
    expect((await registry.scan(hillevi))[0]?.items).toHaveLength(2);
  });
  test('calls back into Clew with the assertion it was given, as the same person', async () => {
    const { registry, load, clewCalls } = stack();
    await load();
    expect(await registry.run(hassan, 'hello.dayWithMeetings', {})).toEqual({
      meetings: 2,
      text: 'Hassan Ali har 2 möten i dag och 2 saker kvar i hello-anslutningen.',
    });
    expect(clewCalls).toEqual([
      { url: 'http://clew/api/connectors/call', auth: 'Bearer ', body: { name: 'calendar.today', input: {} } },
    ]);
  });
  test("a capability that fails answers a fixed sentence, never what was thrown: a callback's refusal or a network error (CS-L6)", async () => {
    let fail: () => Promise<Response> = async () =>
      Response.json({ error: { code: 'denied', message: 'Kalendern: intern detalj 0x2f' } }, { status: 403 });
    const hello = createConnector({ jwks: testJwks, secret, clewUrl: 'http://clew', fetch: () => fail() });
    const call = async () =>
      hello.handle(
        await signedRequest('http://hello/clew/capabilities/hello.dayWithMeetings', {
          id: 'hello',
          actor: hassan,
          key: secret,
          body: { actor: hassan, input: {} },
        }),
      );
    const refused = await call();
    expect([refused.status, await refused.json()]).toEqual([
      503,
      { error: { code: 'unavailable', message: 'Hello-anslutningen kunde inte svara.' } },
    ]);
    fail = async () => {
      throw new TypeError('fetch failed: connect ECONNREFUSED 10.0.0.7:3000');
    };
    const unreachable = await call();
    expect([unreachable.status, await unreachable.json()]).toEqual([
      503,
      { error: { code: 'unavailable', message: 'Hello-anslutningen kunde inte svara.' } },
    ]);
  });
  test("keeps a capability's about from the manifest (D97), and signs the person's user name into the actor the service reads", async () => {
    const hello = helloManifest as { capabilities: object[] };
    const withAbout = {
      ...hello,
      capabilities: [
        ...hello.capabilities,
        {
          name: 'hello.person',
          kind: 'read',
          title: 'Saker per person',
          description: 'Öppna saker per person.',
          input: {
            type: 'object',
            properties: { keys: { type: 'array', items: { type: 'string' }, maxItems: 200 } },
            required: ['keys'],
          },
          output: {
            type: 'object',
            properties: {
              rows: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { key: { type: 'string' }, open: { type: 'string' } },
                  required: ['key'],
                },
              },
            },
          },
          model: false,
          scope: {},
          about: { entity: 'person' },
          view: {
            kind: 'list',
            title: 'open',
            fields: [{ key: 'open', label: 'Öppna', format: 'status', tones: { '*': 'warn' } }],
          },
        },
        {
          name: 'hello.remind',
          kind: 'propose',
          title: 'Påminn',
          description: 'Föreslår en påminnelse.',
          input: { type: 'object', properties: { person: { type: 'string' } }, required: ['person'] },
          output: {},
          model: false,
          scope: { roles: ['manager'] },
          about: { entity: 'person', param: 'person' },
        },
      ],
    };
    const loaded = remoteConnector(parseManifest(withAbout, 'hello'), {
      url: 'http://hello',
      key: secret,
      assert: async () => 'x',
    });
    const about = (name: string) => loaded.capabilities.find(c => c.name === name)!.about;
    expect(about('hello.person')).toEqual({ entity: 'person' });
    expect(about('hello.remind')).toEqual({ entity: 'person', param: 'person' });
    expect(about('hello.greeting')).toBeUndefined();

    const service = createConnector({ jwks: testJwks, secret });
    const seen: Array<{ claim: unknown; body: unknown }> = [];
    const fetch: FetchLike = (input, init) => {
      if (init?.body)
        seen.push({
          claim: decodeJwt(new Headers(init.headers).get('authorization')!.slice('Bearer '.length)).actor,
          body: JSON.parse(String(init.body)).actor,
        });
      return service.handle(new Request(input, init));
    };
    const registry = new Registry().register(
      remoteConnector(parseManifest(helloManifest, 'hello'), {
        url: 'http://hello',
        key: secret,
        assert: assertionFor('hello', secret),
        fetch,
      }),
    );
    const named: Actor = { ...hassan, userName: 'hassan.ali' };
    expect(await registry.run(named, 'hello.greeting', {})).toMatchObject({ text: expect.stringContaining('Hassan') });
    expect(seen.at(-1)).toEqual({ claim: named, body: named });
    // A person provisioned without a user name is signed as before, and an existing service reads them the same way.
    await registry.run(hassan, 'hello.greeting', {});
    expect(seen.at(-1)).toEqual({ claim: hassan, body: hassan });
  });
  test('refuses a call signed with another secret, on the connector side', async () => {
    const { registry, connectorFetch } = stack();
    registry.register(
      remoteConnector(parseManifest(helloManifest), {
        url: 'http://hello',
        key: secret,
        assert: assertionFor('hello', 'another-secret-another'),
        fetch: connectorFetch,
      }),
    );
    await expect(registry.run(hassan, 'hello.greeting', {})).rejects.toThrow(/Ogiltigt behörighetsbevis/);
  });
  test("an error keeps the connector's code as far as its status bears it out: denied only with a 403, never with a 401", async () => {
    // A 401 is the connector rejecting Clew's key or assertion, about Clew and not the person: a failure, `unavailable`.
    const outcome = async (status: number, code: string) => {
      const registry = new Registry().register(
        remoteConnector(parseManifest(helloManifest), {
          url: 'http://hello',
          key: secret,
          assert: assertionFor('hello', secret),
          fetch: async () => Response.json({ error: { code, message: 'Nej.' } }, { status }),
        }),
      );
      return registry.run(hassan, 'hello.greeting', {}).then(
        () => undefined,
        (error: CapabilityError) => [error.message, error.code],
      );
    };
    expect(await outcome(403, 'denied')).toEqual(['Nej.', 'denied']);
    expect(await outcome(401, 'denied')).toEqual(['Nej.', 'unavailable']);
    expect(await outcome(401, 'invalid')).toEqual(['Nej.', 'unavailable']);
    expect(await outcome(400, 'denied')).toEqual(['Nej.', 'unavailable']);
    expect(await outcome(400, 'invalid')).toEqual(['Nej.', 'invalid']);
    expect(await outcome(404, 'not-found')).toEqual(['Nej.', 'not-found']);
    expect(await outcome(503, 'unavailable')).toEqual(['Hello svarar inte just nu.', 'unavailable']);
  });
  test('a connector that is down degrades to a Swedish unavailable error and a warning figure', async () => {
    const down: FetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    const registry = new Registry().register(
      remoteConnector(parseManifest(helloManifest), {
        url: 'http://hello',
        key: secret,
        assert: assertionFor('hello', secret),
        fetch: down,
      }),
    );
    await expect(registry.run(hassan, 'hello.greeting', {})).rejects.toThrow('Hello svarar inte just nu.');
    expect((await registry.areas(hillevi))[0]?.figure).toEqual({
      label: 'Hello svarar inte.',
      tone: 'warn',
      unavailable: true,
    });
  });
});

describe('what a connector answers is read at its registered address and no further than the limit (CB-4, CB-5)', () => {
  /** Two local services: the registered one answers with a redirect to the other, which counts what reaches it. */
  async function redirecting() {
    const reached: string[] = [];
    const other = createServer((req, res) => {
      reached.push(`${req.method} ${req.url} key=${req.headers['x-clew-connector-key'] ? 'sent' : 'absent'}`);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { code: 'invalid', message: 'text from the other host' } }));
    });
    await new Promise<void>(resolve => other.listen(0, '127.0.0.1', resolve));
    const otherPort = (other.address() as AddressInfo).port;
    const registered = createServer((req, res) => {
      res.writeHead(req.method === 'GET' ? 302 : 307, { location: `http://127.0.0.1:${otherPort}/internal` });
      res.end();
    });
    await new Promise<void>(resolve => registered.listen(0, '127.0.0.1', resolve));
    const url = `http://127.0.0.1:${(registered.address() as AddressInfo).port}`;
    const close = () =>
      Promise.all([other, registered].map(s => new Promise(resolve => s.close(resolve)))).then(() => undefined);
    return { url, reached, close };
  }
  test('a redirect is the connector failing: nothing reaches the other host, and none of its words reach the person', async () => {
    const { url, reached, close } = await redirecting();
    try {
      // Said as what it is, once, so the administrator registers the address the service answers on (CB-4).
      const refused = await fetchManifest(url, 'hello').catch(error => error);
      expect(refused).toBeInstanceOf(ManifestError);
      expect(refused.message).toContain('answered with a redirect (302), which Clew does not follow');
      const registry = new Registry().register(
        remoteConnector(parseManifest(helloManifest), { url, key: secret, assert: assertionFor('hello', secret) }),
      );
      await expect(registry.run(hassan, 'hello.greeting', {})).rejects.toThrow('Hello svarar inte just nu.');
      expect((await registry.areas(hillevi))[0]?.figure).toMatchObject({ unavailable: true });
      expect(reached).toEqual([]);
    } finally {
      await close();
    }
  });
  test('every request the transport sends refuses a redirect', async () => {
    const { connectorFetch } = stack();
    const seen: Array<[string, RequestRedirect | undefined]> = [];
    const recording: FetchLike = (input, init) => {
      seen.push([new URL(input).pathname, init?.redirect]);
      return connectorFetch(input, init);
    };
    const registry = new Registry().register(
      remoteConnector(await fetchManifest('http://hello', 'hello', recording), {
        url: 'http://hello',
        key: secret,
        assert: assertionFor('hello', secret),
        fetch: recording,
      }),
    );
    await registry.run(hassan, 'hello.greeting', {});
    await registry.areas(hillevi);
    await registry.scan(hillevi);
    expect(seen.map(([path]) => path)).toEqual(
      expect.arrayContaining(['/clew/manifest', '/clew/capabilities/hello.greeting', '/clew/figure', '/clew/scan']),
    );
    // The manifest's redirect is read as one, to be said by name; every other request fails on one.
    expect(seen.filter(([path, redirect]) => redirect !== (path === '/clew/manifest' ? 'manual' : 'error'))).toEqual(
      [],
    );
  });
  /** An answer that never ends, counting how many pieces were asked of it. */
  const endless = (headers: Record<string, string> = {}, status = 200) => {
    const counted = { pieces: 0, cancelled: false };
    const piece = new TextEncoder().encode('[' + '0,'.repeat(32 * 1024));
    const response = new Response(
      new ReadableStream<Uint8Array>({
        pull(controller) {
          counted.pieces++;
          controller.enqueue(piece);
        },
        cancel() {
          counted.cancelled = true;
        },
      }),
      { status, headers: { 'content-type': 'application/json', ...headers } },
    );
    return { counted, response };
  };
  test('an answer over the limit is the connector failing, and is not read past the limit', async () => {
    const { counted, response } = endless();
    const registry = new Registry().register(
      remoteConnector(parseManifest(helloManifest), {
        url: 'http://hello',
        key: secret,
        assert: assertionFor('hello', secret),
        fetch: async () => response,
      }),
    );
    await expect(registry.run(hassan, 'hello.greeting', {})).rejects.toThrow('Hello svarar inte just nu.');
    expect(counted.cancelled).toBe(true);
    // 64 kB a piece: the limit and one piece more, never the whole of an endless answer.
    expect(counted.pieces).toBeLessThanOrEqual(Math.ceil(MAX_ANSWER_BYTES / (64 * 1024)) + 2);
  });
  test('an answer that declares a length over the limit is refused before it is read', async () => {
    const { counted, response } = endless({ 'content-length': String(MAX_ANSWER_BYTES + 1) });
    const registry = new Registry().register(
      remoteConnector(parseManifest(helloManifest), {
        url: 'http://hello',
        key: secret,
        assert: assertionFor('hello', secret),
        fetch: async () => response,
      }),
    );
    await expect(registry.run(hassan, 'hello.greeting', {})).rejects.toThrow('Hello svarar inte just nu.');
    expect(counted.cancelled).toBe(true);
    expect(counted.pieces).toBeLessThanOrEqual(1);
  });
  /** JSON text padded with spaces to exactly `bytes` bytes, which JSON reads as nothing. */
  const padded = (text: string, bytes: number) => text + ' '.repeat(bytes - new TextEncoder().encode(text).byteLength);
  test('a manifest over its limit is refused by name; one at the limit is read, and one byte more is not', async () => {
    const { response } = endless();
    await expect(fetchManifest('http://hello', 'hello', async () => response)).rejects.toThrow(
      `answered more than ${MAX_MANIFEST_BYTES} bytes`,
    );
    const text = JSON.stringify(helloManifest);
    const answering = (body: string) => async () => new Response(body);
    expect((await fetchManifest('http://hello', 'hello', answering(padded(text, MAX_MANIFEST_BYTES)))).id).toBe(
      'hello',
    );
    await expect(
      fetchManifest('http://hello', 'hello', answering(padded(text, MAX_MANIFEST_BYTES + 1))),
    ).rejects.toThrow(`answered more than ${MAX_MANIFEST_BYTES} bytes`);
  });
  test("a capability's answer at the limit is read, and one byte more is the connector failing", async () => {
    const { connectorFetch } = stack();
    const answering = (bytes: number) => {
      const fetch: FetchLike = (input, init) =>
        new URL(input).pathname.startsWith('/clew/capabilities/')
          ? connectorFetch(input, init).then(
              async real =>
                new Response(padded(await real.text(), bytes), {
                  status: real.status,
                  headers: { 'content-type': 'application/json' },
                }),
            )
          : connectorFetch(input, init);
      return new Registry().register(
        remoteConnector(parseManifest(helloManifest), {
          url: 'http://hello',
          key: secret,
          assert: assertionFor('hello', secret),
          fetch,
        }),
      );
    };
    expect(await answering(MAX_ANSWER_BYTES).run(hillevi, 'hello.openItems', {})).toBeDefined();
    await expect(answering(MAX_ANSWER_BYTES + 1).run(hillevi, 'hello.openItems', {})).rejects.toThrow(
      'Hello svarar inte just nu.',
    );
  });
  test('a refusal of a question whose body never ends is the connector failing, read no further than the limit', async () => {
    const { connectorFetch } = stack();
    const { counted, response } = endless({}, 403);
    const refusing: FetchLike = (input, init) =>
      new URL(input).pathname === '/clew/ask' ? Promise.resolve(response) : connectorFetch(input, init);
    const registry = new Registry().register(
      remoteConnector(parseManifest(helloManifest), {
        url: 'http://hello',
        key: secret,
        assert: assertionFor('hello', secret),
        fetch: refusing,
      }),
    );
    const asking = async () => {
      for await (const _ of registry.ask(hillevi, 'hello:guide', { question: 'Hej' })) void _;
    };
    await expect(asking()).rejects.toThrow('Hello svarar inte just nu.');
    expect(counted.cancelled).toBe(true);
    expect(counted.pieces).toBeLessThanOrEqual(Math.ceil(MAX_ANSWER_BYTES / (64 * 1024)) + 2);
  });
  test("the conformance check's own probes refuse a redirect, give up after the transport's limit, and leave the answer unread", async () => {
    const { connectorFetch } = stack();
    const sent: Array<{ path: string; redirect?: RequestRedirect; signal: boolean }> = [];
    const refusals: Array<ReturnType<typeof endless>['counted']> = [];
    const recording: FetchLike = async (input, init) => {
      sent.push({ path: new URL(input).pathname, redirect: init?.redirect, signal: !!init?.signal });
      const real = await connectorFetch(input, init);
      if (real.status !== 401) return real;
      // A refusal whose body never ends: the probe reads its status and nothing more.
      const { counted, response } = endless({}, 401);
      refusals.push(counted);
      return response;
    };
    const report = await checkConnector({
      key: secret,
      url: 'http://hello',
      id: 'hello',
      assert: assertionFor('hello', secret),
      assertForeign: assertionFor('hello', 'another-secret-another'),
      fetch: recording,
    });
    expect(report.findings.map(f => f.text)).toContain('a call signed with another secret is refused (401)');
    expect(sent.filter(r => r.path !== '/clew/manifest' && (r.redirect !== 'error' || !r.signal))).toEqual([]);
    expect(refusals.length).toBeGreaterThan(0);
    for (const counted of refusals) expect([counted.cancelled, counted.pieces <= 1]).toEqual([true, true]);
  });
});

describe("a remote connector's figure (D54)", () => {
  const answering =
    (figure: unknown): FetchLike =>
    async input =>
      String(input).endsWith('/clew/figure')
        ? Response.json({ figure })
        : Response.json({ error: 'nej' }, { status: 404 });
  const withFigure = (figure: unknown) =>
    new Registry().register(
      remoteConnector(parseManifest(helloManifest), {
        url: 'http://hello',
        key: secret,
        assert: assertionFor('hello', secret),
        fetch: answering(figure),
      }),
    );
  test('the richer figure from a manifest comes through; opens naming a read without a view is dropped', async () => {
    const figure = {
      label: 'Öppna saker',
      value: '2',
      comparison: 'mål 0 · +1 sedan i går',
      progress: { value: 2, max: 5 },
      tone: 'warn' as const,
    };
    expect((await withFigure(figure).areas(hillevi))[0]?.figure).toEqual(figure);
    // hello.openItems is a read with no declared view: the tile cannot open it, so the figure comes without it.
    expect((await withFigure({ ...figure, opens: 'hello.openItems' }).areas(hillevi))[0]?.figure).toEqual(figure);
    expect((await withFigure({ ...figure, opens: 'finance.budget' }).areas(hillevi))[0]?.figure).toEqual(figure);
  });
  test('a null figure is no figure, and an answer outside the protocol shape is the warning figure', async () => {
    expect((await withFigure(null).areas(hillevi))[0]?.figure).toBeNull();
    expect((await withFigure({ label: 'Två', tone: 'warn', value: 2 }).areas(hillevi))[0]?.figure).toEqual({
      label: 'Hello svarar inte.',
      tone: 'warn',
      unavailable: true,
    });
  });
});

describe('a user-delegated connector (D26)', () => {
  const delegating = { ...(helloManifest as object), delegation: { audience: 'eneo' } };
  /** Hello in-process, with every request's headers recorded; a variant that refuses a call without the person's token. */
  function delegated(options: { requireToken?: boolean } = {}) {
    const hello = createConnector({
      jwks: testJwks,
      secret,
      clewUrl: 'http://clew',
      fetch: async () => Response.json({ output: { date: '2026-11-04', events: [], gaps: [] } }),
    });
    const headers: Record<string, string | null>[] = [];
    const connectorFetch: FetchLike = (input, init) => {
      const h = new Headers(init?.headers);
      headers.push({
        auth: h.get('authorization')?.slice(0, 7) ?? null,
        delegated: h.get('x-clew-delegated-token'),
        body: String(init?.body),
      });
      if (options.requireToken && !h.get('x-clew-delegated-token') && !String(input).endsWith('/clew/manifest'))
        return Promise.resolve(
          Response.json(
            { error: { code: 'denied', message: 'Din inloggning kan inte styrkas mot Eneo i den här sessionen.' } },
            { status: 403 },
          ),
        );
      return hello.handle(new Request(input, init));
    };
    const registry = new Registry();
    registry.register(
      remoteConnector(parseManifest(delegating, 'hello'), {
        url: 'http://hello',
        key: secret,
        assert: assertionFor('hello', secret),
        fetch: connectorFetch,
      }),
    );
    return { registry, headers };
  }
  test('the token travels beside the assertion, only when the manifest asks and the session has one; the body is unchanged', async () => {
    const { registry, headers } = delegated();
    const asked: string[] = [];
    expect(
      await registry.run(
        hassan,
        'hello.greeting',
        {},
        {
          delegate: async audience => {
            asked.push(audience);
            return 'tok-' + audience;
          },
        },
      ),
    ).toMatchObject({ text: expect.stringContaining('Hassan') });
    expect(asked).toEqual(['eneo']);
    expect(headers.at(-1)).toMatchObject({ auth: 'Bearer ', delegated: 'tok-eneo' });
    expect(JSON.parse(headers.at(-1)!.body!)).toEqual({ actor: hassan, input: {} });
    await registry.run(hassan, 'hello.greeting', {});
    expect(headers.at(-1)!.delegated).toBeNull();
    await registry.run(hassan, 'hello.greeting', {}, { delegate: async () => undefined });
    expect(headers.at(-1)!.delegated).toBeNull();
    // The plain manifest in the same registry never invokes the delegate.
    const plain = new Registry().register(
      remoteConnector(parseManifest(helloManifest, 'hello'), {
        url: 'http://hello',
        key: secret,
        assert: assertionFor('hello', secret),
        fetch: (i, init) => createConnector({ jwks: testJwks, secret }).handle(new Request(i, init)),
      }),
    );
    let invoked = false;
    await plain.run(
      hassan,
      'hello.greeting',
      {},
      {
        delegate: async () => {
          invoked = true;
          return 'x';
        },
      },
    );
    expect(invoked).toBe(false);
  });
  test("the connector refuses a call without the person's token in its own words; an exchange that fails is one Swedish line", async () => {
    const { registry } = delegated({ requireToken: true });
    await expect(registry.run(hassan, 'hello.greeting', {}, { delegate: async () => undefined })).rejects.toThrow(
      'Din inloggning kan inte styrkas mot Eneo i den här sessionen.',
    );
    await expect(
      registry.run(
        hassan,
        'hello.greeting',
        {},
        {
          delegate: async () => {
            throw new Error('keycloak down');
          },
        },
      ),
    ).rejects.toThrow('Hello kunde inte få din behörighet just nu.');
    expect(await registry.run(hassan, 'hello.greeting', {}, { delegate: async () => 'tok' })).toMatchObject({
      text: expect.stringContaining('Hassan'),
    });
  });
  test('a nested clew.call carries the same delegate; a session-less run carries none', async () => {
    const { registry, headers } = delegated();
    registry.register({
      id: 'comp',
      kind: 'derived',
      source: 'S',
      areas: [],
      capabilities: [
        {
          name: 'comp.hi',
          kind: 'read',
          title: 'x',
          description: 'x',
          input: {} as never,
          output: {} as never,
          model: false,
          scope: {},
          run: (_a, _i, clew) => clew.call('hello.greeting'),
        },
      ],
    });
    await registry.run(hassan, 'comp.hi', {}, { delegate: async () => 'nested-token' });
    expect(headers.at(-1)!.delegated).toBe('nested-token');
    await registry.run(hassan, 'comp.hi', {});
    expect(headers.at(-1)!.delegated).toBeNull();
  });
  test('the manifest field is optional, closed and validated', () => {
    expect(parseManifest(delegating, 'hello').delegation).toEqual({ audience: 'eneo' });
    expect(() => parseManifest({ ...delegating, delegation: { audience: '' } })).toThrow(ManifestError);
    expect(() => parseManifest({ ...delegating, delegation: { audience: 'eneo', extra: 1 } })).toThrow(ManifestError);
  });
  test("the check takes a call refused without the person's token from its code: a 403 denied in any words, never a 401", async () => {
    // A delegating service as the fixtures are, with nothing but its capabilities for the check to ask: Clew's key and
    // assertion first, a 401 when they do not hold, and then the person's token, which the check has none of.
    const manifest = { ...delegating, scan: false, areas: [] };
    const verify = createVerifier({ secret, jwks: testJwks }, 'hello');
    const service =
      (status: number, message: string): FetchLike =>
      async (input, init) => {
        if (String(input).endsWith('/clew/manifest')) return Response.json(manifest);
        const h = new Headers(init?.headers);
        return (await verify((h.get('authorization') ?? '').slice('Bearer '.length), h.get('x-clew-connector-key')))
          ? Response.json({ error: { code: 'denied', message } }, { status })
          : Response.json({ error: { code: 'denied', message: 'Ogiltigt behörighetsbevis.' } }, { status: 401 });
      };
    const check = (fetch: FetchLike) =>
      checkConnector({
        key: secret,
        url: 'http://hello',
        id: 'hello',
        assert: assertionFor('hello', secret),
        assertForeign: assertionFor('hello', 'another-secret-another'),
        fetch,
      });
    const failures = (report: Awaited<ReturnType<typeof check>>) =>
      report.findings.filter(f => f.level === 'fail').map(f => f.text);
    // Refused with a 403 for want of the person's token: the expected answer, in whatever words the connector has.
    for (const message of [
      'Din inloggning kan inte styrkas mot Eneo i den här sessionen.',
      'Eneo vet inte vem du är.',
    ]) {
      const report = await check(service(403, message));
      expect([message, failures(report)]).toEqual([message, []]);
      expect(report.findings.map(f => f.text)).toContain(
        `hello.greeting as employee: refused without the person's token, as a delegating connector should (${message})`,
      );
    }
    // Every one of Clew's calls rejected with a 401, as by a service that does not hold Clew's key set: a failure, though
    // its body says denied and its words say "behörighet".
    const rejected = await check(service(401, 'Ogiltigt behörighetsbevis.'));
    expect(rejected.ok).toBe(false);
    expect(failures(rejected)).toEqual([
      'hello.greeting as manager: Ogiltigt behörighetsbevis.',
      'hello.greeting as employee: Ogiltigt behörighetsbevis.',
      'hello.openItems as manager: Ogiltigt behörighetsbevis.',
      'hello.dayWithMeetings as manager: Ogiltigt behörighetsbevis.',
      'hello.dayWithMeetings as employee: Ogiltigt behörighetsbevis.',
      'hello.assistants as manager: Ogiltigt behörighetsbevis.',
      'hello.assistants as employee: Ogiltigt behörighetsbevis.',
    ]);
    expect(rejected.items.find(i => i.capability === 'hello.greeting')).toMatchObject({
      level: 'fail',
      description: 'Fel för chef: Ogiltigt behörighetsbevis. Fel för medarbetare: Ogiltigt behörighetsbevis.',
    });
  });
});

describe('assertions and configuration', () => {
  test('only a Clew-signed callback grant is accepted; a request assertion or shared-secret forgery cannot call back', async () => {
    const authority = await testAuthority();
    const token = await authority.assert('hello', hillevi, ['calendar.today']);
    const callback = decodeJwt(token).callback as string;
    expect(await authority.verify(callback)).toMatchObject({
      connectorId: 'hello',
      actor: hillevi,
      uses: ['calendar.today'],
    });
    await expect(authority.verify(token)).rejects.toThrow(/Invalid callback/);
    await expect((await testAuthority('other')).verify(callback)).rejects.toThrow(/Invalid callback/);
    const forged = await new SignJWT({ actor: hillevi, connectorId: 'hello', uses: ['calendar.today'], chain: [] })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('clew')
      .setAudience('clew:connector-callback')
      .setSubject('hillevi')
      .setExpirationTime('2m')
      .sign(new TextEncoder().encode(secret));
    await expect(authority.verify(forged)).rejects.toThrow(/Invalid callback/);
    await expect(authority.verify('nonsense')).rejects.toThrow(/Invalid callback/);
  });
  test('the loader registers the approved manifest, and one the service changed waits as offered, never live (D144)', async () => {
    const { registry, connectorFetch } = stack();
    const records: Array<[string, ConnectorHealth['status'], unknown]> = [];
    const record = async (id: string, seen: { url: string; health: ConnectorHealth; served?: unknown }) => {
      records.push([id, seen.health.status, seen.served]);
      return seen.url === 'http://hello';
    };
    // What an administrator approved before the service began to read the calendar back as the person.
    const approved = { ...(helloManifest as object), source: 'Hello förr', uses: [] };
    const loaded = await loadConnectors(registry, {
      authority: await testAuthority(),
      rows: async () => [{ id: 'hello', url: 'http://hello', secret, manifest: approved }],
      record,
      fetch: connectorFetch,
      attempts: 1,
      log: () => undefined,
    });
    expect(loaded).toEqual(['hello']);
    expect(records).toEqual([['hello', 'ok', expect.objectContaining({ source: 'Hello', uses: ['calendar.today'] })]]);
    expect(registry.connector('hello')?.source).toBe('Hello förr');
    expect(await registry.run(hassan, 'hello.greeting', {})).toMatchObject({ text: expect.stringContaining('Hassan') });
  });
  test('the loader hands the store what the service serves, which decides whether it is an offer; a row with none approved is never registered', async () => {
    const { registry, connectorFetch } = stack();
    const records: Array<[string, unknown]> = [];
    await loadConnectors(registry, {
      authority: await testAuthority(),
      rows: async () => [
        // A jsonb round trip reorders keys: still the same manifest.
        { id: 'hello', url: 'http://hello', secret, manifest: JSON.parse(JSON.stringify(helloManifest)) },
      ],
      record: async (id, seen) => {
        records.push([id, seen.served]);
        return true;
      },
      fetch: connectorFetch,
      attempts: 1,
      log: () => undefined,
    });
    // The store compares it with the approved one in the same write (the store contract): here it is the same.
    expect(records).toEqual([['hello', expect.objectContaining({ id: 'hello', source: 'Hello' })]]);
    expect(registry.connector('hello')?.source).toBe('Hello');
    const empty = new Registry();
    const offers: unknown[] = [];
    await loadConnectors(empty, {
      authority: await testAuthority(),
      rows: async () => [{ id: 'hello', url: 'http://hello', secret, manifest: null }],
      record: async (_id, seen) => {
        offers.push(seen.served);
        return true;
      },
      fetch: connectorFetch,
      attempts: 1,
      log: () => undefined,
    });
    expect(offers).toEqual([expect.objectContaining({ id: 'hello' })]);
    expect(empty.connector('hello')).toBeUndefined();
  });
  test('a row with a stored manifest is served while its service is down, and the health says so', async () => {
    const registry = new Registry();
    const health: ConnectorHealth[] = [];
    const down: FetchLike = async () => {
      throw new Error('ECONNREFUSED');
    };
    const loaded = await loadConnectors(registry, {
      authority: await testAuthority(),
      rows: async () => [{ id: 'hello', url: 'http://hello', secret, manifest: helloManifest }],
      record: async (_id, seen) => {
        health.push(seen.health);
        return true;
      },
      fetch: down,
      attempts: 2,
      delayMs: 1,
      log: () => undefined,
    });
    expect(loaded).toEqual([]);
    expect(health.map(h => h.status)).toEqual(['unreachable']);
    expect((await registry.areas(hillevi))[0]?.figure).toEqual({
      label: 'Hello svarar inte.',
      tone: 'warn',
      unavailable: true,
    });
    await expect(registry.run(hassan, 'hello.greeting', {})).rejects.toThrow('Hello svarar inte just nu.');
  });
  test('an invalid manifest is recorded once and the row is skipped', async () => {
    const registry = new Registry();
    const health: ConnectorHealth[] = [];
    const bad: FetchLike = async () => Response.json({ protocol: 2 });
    await loadConnectors(registry, {
      authority: await testAuthority(),
      rows: async () => [{ id: 'hello', url: 'http://hello', secret, manifest: null }],
      record: async (_id, seen) => {
        health.push(seen.health);
        return true;
      },
      fetch: bad,
      attempts: 5,
      log: () => undefined,
    });
    expect(health.map(h => h.status)).toEqual(['manifest-invalid']);
    expect(registry.connector('hello')).toBeUndefined();
  });
  test('a row moved while its old address answered records nothing of that answer, and the loader says so instead of loading it', async () => {
    const { registry, connectorFetch } = stack();
    const seen: string[] = [],
      lines: string[] = [];
    const loaded = await loadConnectors(registry, {
      authority: await testAuthority(),
      rows: async () => [{ id: 'hello', url: 'http://hello', secret, manifest: helloManifest }],
      // The store writes only on the row still at the address read: an administrator moved it meanwhile.
      record: async (_id, check) => {
        seen.push(check.url);
        return false;
      },
      fetch: connectorFetch,
      attempts: 1,
      log: line => lines.push(line),
    });
    expect(seen).toEqual(['http://hello']);
    expect(loaded).toEqual([]);
    expect(lines).toEqual([
      'Connector "hello" moved from http://hello while it was read there; nothing of that answer was recorded.',
    ]);
  });
});

describe('connector-check holds a scan to the card-action rule (D35)', () => {
  test("a draft whose button names another connector's capability fails the check, and the untouched service passes it", async () => {
    const hello = createConnector({
      jwks: testJwks,
      secret,
      clewUrl: 'http://clew',
      fetch: async () => Response.json({ output: { date: '2026-11-04', events: [], gaps: [] } }),
    });
    const honest: FetchLike = (input, init) => hello.handle(new Request(input, init));
    const tampered: FetchLike = async (input, init) => {
      const answer = await honest(input, init);
      if (!String(input).endsWith('/clew/scan')) return answer;
      const body = (await answer.json()) as { drafts: Array<{ actions: Array<{ capability: string }> }> };
      return Response.json({
        drafts: body.drafts.map(d => ({
          ...d,
          actions: d.actions.map(a => ({ ...a, capability: 'finance.approve' })),
        })),
      });
    };
    const check = (fetch: FetchLike) =>
      checkConnector({
        key: secret,
        url: 'http://hello',
        id: 'hello',
        assert: assertionFor('hello', secret),
        assertForeign: assertionFor('hello', 'another-secret-another'),
        fetch,
      });
    const failures = (report: Awaited<ReturnType<typeof check>>) =>
      report.findings.filter(f => f.level === 'fail').map(f => f.text);
    expect(failures(await check(honest))).toEqual([]);
    const report = await check(tampered);
    expect(report.ok).toBe(false);
    expect(failures(report)).toContain(
      'draft hello:open-items refused: action done names finance.approve, which is not a capability of hello',
    );
    expect(report.items.filter(i => i.level === 'fail')).toContainEqual({
      level: 'fail',
      group: 'surfaces',
      label: 'Ärenden',
      description:
        'Ärendet hello:open-items avvisades: action done names finance.approve, which is not a capability of hello',
    });
  });
});

describe('connector-check asks a read about an entity as Clew does (D97)', () => {
  const people = ['anna', 'erik'];
  const aboutManifest = (model = false) => {
    const hello = helloManifest as { capabilities: object[] };
    return {
      ...hello,
      capabilities: [
        ...hello.capabilities,
        {
          name: 'hello.person',
          kind: 'read',
          title: 'Saker per person',
          description: 'Öppna saker per person.',
          input: {
            type: 'object',
            properties: { keys: { type: 'array', items: { type: 'string' }, maxItems: 200 } },
            required: ['keys'],
          },
          output: {
            type: 'object',
            properties: {
              rows: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: { key: { type: 'string' }, open: { type: 'string' } },
                  required: ['key'],
                },
              },
            },
          },
          model: false,
          scope: { roles: ['manager'] },
          about: { entity: 'person' },
          person: { admits: ['managed'] },
          view: {
            kind: 'list',
            title: 'open',
            fields: [{ key: 'open', label: 'Öppna', format: 'status', tones: { '*': 'warn' } }],
          },
        },
        {
          name: 'hello.remind',
          kind: 'propose',
          title: 'Påminn',
          description: 'Föreslår en påminnelse.',
          input: { type: 'object', properties: { person: { type: 'string' } }, required: ['person'] },
          output: {},
          model,
          scope: { roles: ['manager'] },
          about: { entity: 'person', param: 'person' },
        },
      ],
    };
  };
  type Fault = 'none' | 'stranger' | 'twice' | 'refuse' | 'leak' | 'slow';
  /** The hello service with a read about a person in front: its people are on unit-skola, and a fault to show. */
  const service = (fault: Fault, model = false) => {
    const hello = createConnector({ jwks: testJwks, secret });
    const fetch: FetchLike = async (input, init) => {
      const url = String(input);
      if (url.endsWith('/clew/manifest')) return Response.json(aboutManifest(model));
      if (!url.endsWith('/clew/capabilities/hello.person')) return hello.handle(new Request(input, init));
      const { actor, input: asked } = JSON.parse(String(init!.body)) as {
        actor: Actor;
        input: { keys: string[] };
      };
      if (fault === 'refuse' && asked.keys.some(k => !people.includes(k)))
        return Response.json({ error: { code: 'invalid', message: 'Okänd person.' } }, { status: 400 });
      // Slow for the batch alone, so the test stays inside its own time limit.
      if (fault === 'slow' && actor.unitId === 'unit-skola' && asked.keys.includes('anna'))
        await new Promise(resolve => setTimeout(resolve, 1600));
      const mine = fault === 'leak' || actor.unitId === 'unit-skola';
      const rows = asked.keys
        .filter(k => mine && (people.includes(k) || fault === 'leak'))
        .map(k => ({ key: k, open: '1 öppen' }));
      if (fault === 'stranger') rows.push({ key: 'zed', open: '1 öppen' });
      if (fault === 'twice' && rows[0]) rows.push(rows[0]);
      return Response.json({ output: { rows } });
    };
    return checkConnector({
      key: secret,
      url: 'http://hello',
      id: 'hello',
      assert: assertionFor('hello', secret),
      assertForeign: assertionFor('hello', 'another-secret-another'),
      fetch,
      about: { keys: ['anna', 'erik', 'nils'], as: { ...hillevi, userName: 'hillevi' } },
    });
  };
  const about = (report: Awaited<ReturnType<typeof service>>) =>
    report.findings
      .filter(f => f.text.startsWith('hello.') && f.text.includes(' about person'))
      .map(f => `${f.level} ${f.text}`.replace(/, \d+ ms \(/, ', n ms ('));

  test('an honest source passes: the batch, the key, one row per key, an unknown key and another unit', async () => {
    const report = await service('none');
    expect(report.findings.filter(f => f.level === 'fail')).toEqual([]);
    expect(about(report)).toEqual([
      'ok hello.person about person, batch: 3 keys asked, 2 rows, n ms (budget 1500 ms)',
      'ok hello.person about person, key: every row carries a key it was asked with',
      'ok hello.person about person, one row per key',
      'ok hello.person about person, unknown key: no row, no error',
      "ok hello.person about person, out of scope: the 3 keys asked by the check's manager on unit-check: no row, no error",
      'ok hello.remind about person, propose, input: takes person',
      'ok hello.remind about person, propose, model tool: not offered to the model',
    ]);
    // What each admits (D117): the read declares its reports; the action declares nothing, so the strictest holds.
    expect(report.findings).toContainEqual({
      level: 'ok',
      text: 'hello.person names a person in keys: Clew sends only managed (person.admits)',
    });
    expect(report.findings).toContainEqual({
      level: 'warn',
      text: 'hello.remind names a person in person and declares no person.admits, so Clew sends only self and managed; declare what it admits',
    });
    expect(report.items.find(i => i.capability === 'hello.remind')).toMatchObject({
      level: 'warn',
      description:
        'Medarbetare nekas som väntat. Tar emot en person i "person". Erbjuds inte till modellen. Anger inte vilka personer den gäller, så Clew frågar bara om den inloggade själv och den inloggades medarbetare.',
    });
  });

  test('a row with a key not asked, a key answered twice, a refused unknown key and a leak to another unit fail', async () => {
    const failures = async (fault: Fault) =>
      (await service(fault)).findings.filter(f => f.level === 'fail').map(f => f.text);
    // The stray row comes back to every question, so the unknown key and the other unit are answered with it too.
    expect(await failures('stranger')).toEqual([
      'hello.person about person, key: 1 rows carry a key that was not asked ("zed")',
      'hello.person about person, unknown key: answered 1 rows',
      "hello.person about person, out of scope: the check's manager on unit-check was answered 1 rows",
    ]);
    expect(await failures('twice')).toEqual([
      'hello.person about person, one row per key: 1 keys answered more than once',
    ]);
    expect(await failures('refuse')).toEqual([
      'hello.person about person, batch as hillevi: Okänd person.',
      'hello.person about person, unknown key: refused (Okänd person.); answer an unknown key as no row',
      "hello.person about person, out of scope: refused for the check's manager on unit-check (Okänd person.); answer a key out of scope as no row",
    ]);
    const leak = await service('leak');
    expect(leak.ok).toBe(false);
    expect(leak.findings.filter(f => f.level === 'fail').map(f => f.text)).toEqual([
      'hello.person about person, unknown key: answered 1 rows',
      "hello.person about person, out of scope: the check's manager on unit-check was answered 3 rows",
    ]);
    expect(leak.items.find(i => i.capability === 'hello.person')).toMatchObject({
      level: 'fail',
      description: expect.stringContaining('En person utanför behörigheten besvaras med en rad.'),
    });
  });

  test('a slow answer is over the budget; an action offered to the model is a warning', async () => {
    const slow = await service('slow');
    expect(slow.findings.filter(f => f.level === 'warn').map(f => f.text.replace(/\d+ ms,/, 'n ms,'))).toContain(
      'hello.person about person, budget: answered in n ms, over 1500 ms; Clew shows the section as not answering',
    );
    const offered = about(await service('none', true));
    expect(offered).toContain(
      "warn hello.remind about person, propose, model tool: offered to the model; an action in an entity's menu is a person's decision",
    );
  });
});

test('remote registration cannot replace core user capabilities', () => {
  const registry = new Registry();
  const core = { id: 'people', kind: 'core' as const, source: 'Användare', areas: [], capabilities: [] };
  registry.register(core);
  const manifest = { ...parseManifest(helloManifest, 'hello'), id: 'people' };
  expect(() =>
    registerConnector(
      registry,
      {
        id: 'people',
        url: 'http://external',
        secret,
        manifest,
      },
      manifest,
    ),
  ).toThrow('cannot replace Clew core');
  expect(registry.connector('people')?.source).toBe('Användare');
});
