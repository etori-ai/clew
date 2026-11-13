import { describe, expect, test } from 'bun:test';
import { Registry } from '../registry';
import { checkContract, type AuthenticatedContext, type DocumentRequest } from '../../packages/contracts/src/index';
import { actorOf, audiencedActorOf, type Actor, type Clew, type Connector } from '../../packages/connectors/src/index';
import {
  ActorSchema,
  CallRequestSchema,
  DocumentReadRequestSchema,
  FigureRequestSchema,
  ScanRequestSchema,
} from '../../packages/connectors/src/protocol';
import { fetchManifest, parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { asInProduction, checkConnector } from '../../packages/connectors/src/check';
import { createConnector as createHello } from '../../connectors/hello/connector.mjs';
import { manifest as financeManifest } from '../../connectors/finance/connector.mjs';
import { assertionFor, testJwks } from '../connector-authority';

/**
 * Who a connector is for, by provisioned group (D23, D68), and what leaves the process (review 2026-11-12, A1 and A2).
 * Inside Clew a person is checked with their groups on every path; a remote connector is posted the published actor and
 * nothing more. The connector here is strict: like one built from the published schema, it refuses any body that is not
 * exactly the protocol's request.
 */
const secret = 'test-secret-test-secret';
const GROUP = 'S-1-5-21-skolledning';
/** A person as the server holds them: the whole authenticated context, provisioned groups included. */
const context = (id: string, groups: string[]): AuthenticatedContext => ({
  id,
  name: 'Hillevi Berg',
  unitId: 'unit-skola',
  unitLabel: 'Skönsmons skola',
  role: 'manager',
  userName: id,
  organisationId: 'sundsvall',
  principal: { id: 'person:' + id, kind: 'person' },
  capabilities: ['admin.connectors'],
  groups,
  authorizationVersion: 'v7',
  sessionBinding: 'session:abc',
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v7' }),
});
const member = context('hillevi', ['S-1-5-21-annan', GROUP]),
  outsider = context('hillevi', ['S-1-5-21-annan']);
const groupOnly = {
  state: 'enabled' as const,
  audience: { mode: 'selected' as const, groups: [GROUP] },
  scanEnabled: true,
  toolsEnabled: true,
  capabilities: {},
};

/** The protocol's request for each path Clew posts to. */
const REQUESTS = [
  ['/clew/capabilities/', CallRequestSchema],
  ['/clew/documents', DocumentReadRequestSchema],
  ['/clew/figure', FigureRequestSchema],
  ['/clew/scan', ScanRequestSchema],
] as const;
/** A transport in front of a connector that checks every body against the protocol, as a strict connector does. */
function strict(inner: FetchLike) {
  const posted: Array<{ path: string; body: Record<string, unknown>; valid: boolean }> = [];
  const fetch: FetchLike = async (input, init) => {
    if (init?.method !== 'POST') return inner(input, init);
    const path = new URL(input).pathname;
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    const schema = REQUESTS.find(([prefix]) => path.startsWith(prefix))?.[1];
    const valid = !!schema && checkContract(schema, body);
    posted.push({ path, body, valid });
    if (!valid) return Response.json({ error: { code: 'invalid', message: 'Ogiltig förfrågan.' } }, { status: 400 });
    return inner(input, init);
  };
  return { fetch, posted };
}
function hello() {
  const service = createHello({
    jwks: testJwks,
    secret,
    clewUrl: 'http://clew',
    fetch: async () => Response.json({ output: { date: '2026-11-04', events: [], gaps: [] } }),
  });
  return strict((input, init) => service.handle(new Request(input, init)));
}

describe('what leaves the process is the published actor (A1)', () => {
  test('inside, the actor keeps the groups and nothing else of the session; outside, it is the protocol actor', () => {
    expect(audiencedActorOf(member)).toEqual({
      id: 'hillevi',
      name: 'Hillevi Berg',
      unitId: 'unit-skola',
      unitLabel: 'Skönsmons skola',
      role: 'manager',
      userName: 'hillevi',
      groups: ['S-1-5-21-annan', GROUP],
    });
    expect(checkContract(ActorSchema, actorOf(member))).toBe(true);
    expect(actorOf(audiencedActorOf(member))).toEqual(actorOf(member));
    expect(checkContract(ActorSchema, audiencedActorOf(member))).toBe(false);
  });

  test('a read, a scan and a figure are posted the protocol request, whatever context the registry is handed', async () => {
    const { fetch, posted } = hello();
    const registry = new Registry().register(
      remoteConnector(await fetchManifest('http://hello', 'hello', fetch), {
        url: 'http://hello',
        key: secret,
        assert: assertionFor('hello', secret),
        fetch,
      }),
    );
    expect(await registry.run(member, 'hello.greeting', {})).toMatchObject({ text: expect.any(String) });
    expect(await registry.run(audiencedActorOf(member), 'hello.greeting', {})).toMatchObject({
      text: expect.any(String),
    });
    expect((await registry.scan(member)).length).toBeGreaterThan(0);
    expect((await registry.areas(member)).find(a => a.id === 'hello')?.figure).toMatchObject({ tone: 'warn' });
    expect(posted.map(p => p.path)).toEqual([
      '/clew/capabilities/hello.greeting',
      '/clew/capabilities/hello.greeting',
      '/clew/scan',
      '/clew/figure',
    ]);
    for (const p of posted) {
      expect(p.valid).toBe(true);
      expect(p.body.actor).toEqual(actorOf(member));
    }
  });

  test('a document read is posted the protocol request too', async () => {
    const { fetch, posted } = strict(
      async () =>
        new Response(new Uint8Array([37, 80, 68, 70]), {
          headers: { 'content-type': 'application/pdf', 'x-clew-document-revision': 'r1' },
        }),
    );
    const finance = remoteConnector(parseManifest(financeManifest, 'finance'), {
      url: 'http://finance',
      assert: async () => 'assertion',
      fetch,
    });
    const request: DocumentRequest = {
      capability: 'finance.documents',
      input: { ref: 'finance:inv:1' },
      ref: 'finance:inv:1',
      revision: 'r1',
      document: 'invoice',
      documentRevision: 'r1',
    };
    const clew: Clew = { chain: [], call: async () => ({}) as never };
    expect((await finance.documents!(member, request, clew)).bytes).toHaveLength(4);
    expect(posted).toEqual([{ path: '/clew/documents', body: { actor: actorOf(member), request }, valid: true }]);
  });

  test('the conformance check reaches the connector with people shaped as in production, and a strict connector passes it', async () => {
    const { fetch, posted } = hello();
    const signed: Actor[] = [];
    const report = await checkConnector({
      key: secret,
      url: 'http://hello',
      id: 'hello',
      assert: actor => {
        signed.push(actor);
        return assertionFor('hello', secret)(actor);
      },
      assertForeign: assertionFor('hello', 'another-secret-another'),
      fetch,
    });
    expect(report.findings.filter(f => f.level === 'fail')).toEqual([]);
    expect(posted.length).toBeGreaterThan(0);
    expect(posted.every(p => p.valid)).toBe(true);
    // Every person the check signs for is handed to the registry with the whole context, as the refresh and a connector's
    // callback hand one: groups and session included.
    expect(signed.length).toBeGreaterThan(0);
    for (const actor of signed) {
      expect(actor).toMatchObject({ organisationId: 'check', groups: ['check-group'] });
      expect(actor).toMatchObject({ principal: { id: 'person:' + actor.id, kind: 'person' } });
    }
    expect(asInProduction(actorOf(member))).toMatchObject({ groups: ['check-group'] });
  });
});

describe('an audience of one provisioned group, on the paths the server takes (A2)', () => {
  const crm: Connector = {
    id: 'crm',
    kind: 'passthrough',
    source: 'Kundregistret',
    areas: [],
    capabilities: [
      {
        name: 'crm.cases',
        kind: 'read',
        title: 'Ärenden',
        description: 'x',
        input: { type: 'object', properties: {}, additionalProperties: false } as never,
        output: { type: 'object' } as never,
        model: true,
        scope: {},
        view: { kind: 'table', title: 'label', fields: [{ key: 'label', label: 'Ärende' }] },
        run: async () => ({ rows: [{ label: 'Ett ärende' }] }),
      },
      {
        name: 'crm.close',
        kind: 'execute',
        title: 'Stäng',
        description: 'x',
        input: {
          type: 'object',
          properties: { ref: { type: 'string' } },
          required: ['ref'],
          additionalProperties: false,
        } as never,
        output: { type: 'object' } as never,
        model: false,
        scope: {},
        execution: { strategy: 'manual' },
        run: async () => ({ headline: 'Stängt', rows: [] }),
      },
    ],
  };
  const world = () => {
    const registry = new Registry().register(crm);
    registry.govern('crm', groupOnly);
    return registry;
  };

  test('/api/connectors, a direct read, a view and the tools follow the group', async () => {
    const registry = world();
    const inside = audiencedActorOf(member),
      outside = audiencedActorOf(outsider);
    expect(registry.listFor(inside).map(c => c.id)).toContain('crm');
    expect(registry.systems(inside).map(s => s.connector)).toContain('crm');
    expect(registry.listFor(outside).map(c => c.id)).not.toContain('crm');
    expect(registry.systems(outside).map(s => s.connector)).not.toContain('crm');
    expect(await registry.run(inside, 'crm.cases', {})).toEqual({ rows: [{ label: 'Ett ärende' }] });
    await expect(registry.run(outside, 'crm.cases', {})).rejects.toThrow('Okänd förmåga.');
    expect(registry.viewFor(inside, 'crm.cases')).toBeDefined();
    expect(registry.viewFor(outside, 'crm.cases')).toBeUndefined();
    expect(registry.tools(inside).map(t => t.name)).toContain('crm.cases');
    expect(registry.tools(outside).map(t => t.name)).not.toContain('crm.cases');
  });

  test("the pre-check of /api/executions and the decision's own check agree on the group", async () => {
    const registry = world();
    // The route checks the whole context; the ledger's source validates the actor the server builds from it.
    expect(registry.allowed(member, 'crm.close')?.capability.kind).toBe('execute');
    expect((await registry.validate(audiencedActorOf(member), 'crm.close', { ref: 'crm:1' })).capability.name).toBe(
      'crm.close',
    );
    expect(registry.allowed(outsider, 'crm.close')).toBeUndefined();
    await expect(registry.validate(audiencedActorOf(outsider), 'crm.close', { ref: 'crm:1' })).rejects.toThrow(
      'Okänd förmåga.',
    );
  });

  test('no server file hands the registry the published actor: inside the process the groups come along', async () => {
    const root = new URL('../../apps/server/src/', import.meta.url).pathname;
    const cut = /import\s*\{[^}]*\bactorOf\b[^}]*\}\s*from\s*'(@clew\/connectors|[./]+(connectors\/)?registry)'/;
    const offenders: string[] = [];
    for await (const file of new Bun.Glob('**/*.ts').scan({ cwd: root }))
      if (cut.test(await Bun.file(root + file).text())) offenders.push(file);
    expect(offenders).toEqual([]);
  });
});
