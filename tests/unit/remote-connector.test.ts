import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { SignJWT } from 'jose';
import { type Actor } from '../../packages/connectors/src/index';
import { protocolSchema } from '../../packages/connectors/src/protocol';
import {
  ManifestError,
  fetchManifest,
  parseManifest,
  remoteConnector,
  type FetchLike,
} from '../../packages/connectors/src/remote';
import { createConnector, manifest as helloManifest } from '../../connectors/hello/connector.mjs';
import { loadConnectors, registerConnector } from '../../apps/server/src/connectors/remote';
import { assertionFor, testJwks, testAuthority } from '../connector-authority';
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
  test('the loader registers enabled rows, refreshes the manifest and records health', async () => {
    const { registry, connectorFetch } = stack();
    const health: Array<[string, ConnectorHealth['status'], boolean]> = [];
    const record = async (id: string, h: ConnectorHealth, manifest?: unknown) => {
      health.push([id, h.status, manifest !== undefined]);
    };
    const loaded = await loadConnectors(registry, {
      authority: await testAuthority(),
      rows: async () => [{ id: 'hello', url: 'http://hello', secret, manifest: null }],
      record,
      fetch: connectorFetch,
      attempts: 1,
      log: () => undefined,
    });
    expect(loaded).toEqual(['hello']);
    expect(health).toEqual([['hello', 'ok', true]]);
    expect(registry.connector('hello')?.source).toBe('Hello');
    expect(await registry.run(hassan, 'hello.greeting', {})).toMatchObject({ text: expect.stringContaining('Hassan') });
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
      record: async (_id, h) => {
        health.push(h);
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
      record: async (_id, h) => {
        health.push(h);
      },
      fetch: bad,
      attempts: 5,
      log: () => undefined,
    });
    expect(health.map(h => h.status)).toEqual(['manifest-invalid']);
    expect(registry.connector('hello')).toBeUndefined();
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
      label: 'Kort',
      description:
        'Kortet hello:open-items avvisades: action done names finance.approve, which is not a capability of hello',
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
    expect(report.items.find(i => i.capability === 'hello.remind')).toMatchObject({
      level: 'ok',
      description: 'Medarbetare nekas som väntat. Tar emot en person i "person". Erbjuds inte till modellen.',
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
