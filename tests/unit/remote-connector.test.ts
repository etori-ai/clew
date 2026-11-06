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
