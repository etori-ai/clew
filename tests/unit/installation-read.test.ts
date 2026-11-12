import { describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SignJWT, decodeJwt, exportJWK, generateKeyPair } from 'jose';
import { HOLDINGS_ROWS_MAX, HoldingsOutputSchema, checkContract } from '../../packages/contracts/src/index';
import {
  InstallationReadError,
  Registry,
  UNKNOWN,
  openGovernance,
  type Actor,
  type Connector,
} from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { previewManifest } from '../../packages/connectors/src/preview';
import {
  INSTALLATION_CALLER,
  INSTALLATION_SUBJECT,
  protocolSchema,
  protocolTerms,
} from '../../packages/connectors/src/protocol';
import { manifestProblems, parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createVerifier, verifyAssertion, verifyInstallationAssertion } from '../../connectors/hello/verification.mjs';
// @ts-expect-error A frozen JavaScript fixture without declarations: the template before D119.
import * as previous from '../fixtures/verification-protocol-3.mjs';
import { assertionFor, installationAssertionFor, testAuthority, testJwks } from '../connector-authority';

/**
 * A read Clew makes as the installation itself (D119): the holdings profile, `<id>.holdings`, read with no person behind
 * the call. It is not a capability: the registry keeps it apart, so no person's path (a page, a card, a tool, a job,
 * another connector's callback) can name it, whoever the person is; only `holdingsSources` and `readHoldings` reach it.
 * Remote, it goes to `/clew/installation/{name}` with the installation's own assertion: no actor, subject
 * `clew:installation`, `caller: "installation"`, bound to the body and the name. The verifier every connector in the
 * repository carries tells it from a person's, both ways.
 */
const secret = 'test-secret-test-secret';
const manager: Actor = {
  id: 'p-1',
  name: 'Chef',
  unitId: 'u-1',
  unitLabel: 'Enheten',
  role: 'manager',
  userName: 'chef',
};
const employee: Actor = { ...manager, id: 'p-2', name: 'Medarbetare', role: 'employee', userName: 'medarbetare' };
/** An administrator is a person too: with the administrator's groups, still no path to the installation's reads. */
const administrator = { ...manager, id: 'p-3', userName: 'admin', groups: ['capability:admin.connectors'] };
const people = [manager, employee, administrator];

const day = (d: number) => `2026-11-${String(d).padStart(2, '0')}`;
/** The source's accounts: three pages of two. */
const ACCOUNTS = ['anna', 'erik', 'maria', 'johan', 'karin'];
const holdingsOutput = {
  type: 'object',
  properties: {
    rows: {
      type: 'array',
      maxItems: 2,
      items: {
        type: 'object',
        properties: {
          key: { type: 'string' },
          holdings: {
            type: 'array',
            maxItems: 10,
            items: {
              type: 'object',
              properties: {
                id: { type: 'string' },
                type: { type: 'string' },
                label: { type: 'string' },
                kind: { enum: ['course'] },
                issuedOn: { type: 'string' },
                expiresOn: { type: 'string' },
              },
              required: ['id', 'type', 'label', 'kind', 'issuedOn'],
            },
          },
          partial: { const: true },
        },
        required: ['key', 'holdings'],
        additionalProperties: false,
      },
    },
    next: { type: 'string' },
    withdrawalsReported: { type: 'boolean' },
  },
  required: ['rows', 'withdrawalsReported'],
  additionalProperties: false,
};
const manifest = (id = 'lms', protocol = 3) => ({
  protocol,
  id,
  kind: 'passthrough',
  source: 'Lärplattformen',
  scan: false,
  areas: [],
  capabilities: [
    {
      name: `${id}.courses`,
      kind: 'read',
      title: 'Kurser',
      description: 'Kurser.',
      input: { type: 'object', properties: {}, additionalProperties: false },
      output: { type: 'object' },
      model: true,
      scope: {},
    },
  ],
  installation: [
    {
      name: `${id}.holdings`,
      title: 'Genomförda kurser',
      description: 'Alla konton och deras kurser.',
      input: { type: 'object', properties: { cursor: { type: 'string' } }, additionalProperties: false },
      output: holdingsOutput,
    },
  ],
});

type Seen = { route: string; body: unknown; token: string };
/**
 * A connector service built as a third party builds one, with the verifier every connector in the repository carries:
 * a person's read on its capability route, and the holdings profile on the installation's route, answered to the
 * installation's own assertion only. `answer` lets a test make the source misbehave.
 */
function service(id = 'lms', answer?: (input: Record<string, unknown>) => Response | undefined) {
  const verify = createVerifier({ secret, jwks: testJwks }, id);
  const seen: Seen[] = [];
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const handle = async (request: Request) => {
    const url = new URL(request.url);
    if (request.method === 'GET') return json(manifest(id));
    const token = (request.headers.get('authorization') ?? '').replace(/^Bearer /, '');
    const key = request.headers.get('x-clew-connector-key');
    const text = await request.clone().text();
    seen.push({ route: url.pathname, body: JSON.parse(text), token });
    if (url.pathname.startsWith('/clew/installation/')) {
      if (!(await verify.installation(token, key, request)))
        return json({ error: { code: 'denied', message: 'Ogiltigt behörighetsbevis.' } }, 401);
      if (url.pathname !== `/clew/installation/${id}.holdings`)
        return json({ error: { code: 'not-found', message: 'Okänd förmåga.' } }, 404);
      const input = (JSON.parse(text) as { input: Record<string, unknown> }).input;
      const instead = answer?.(input);
      if (instead) return instead;
      const at = input.cursor === undefined ? 0 : Number(input.cursor);
      if (!Number.isInteger(at)) return json({ error: { code: 'invalid', message: 'Okänd markör.' } }, 400);
      const rows = ACCOUNTS.slice(at, at + 2).map((key, i) => ({
        key,
        holdings: [
          { id: `c:${at + i}`, type: 'brandskydd', label: 'Brandskydd', kind: 'course', issuedOn: day(at + i + 1) },
        ],
      }));
      return json({
        output: { rows, ...(at + 2 < ACCOUNTS.length ? { next: String(at + 2) } : {}), withdrawalsReported: false },
      });
    }
    if (!(await verify(token, key, request)))
      return json({ error: { code: 'denied', message: 'Ogiltigt behörighetsbevis.' } }, 401);
    return json({ output: { courses: [] } });
  };
  const fetch: FetchLike = (input, init) => handle(new Request(input, init));
  return { seen, handle, fetch };
}
function world(options: { answer?: (input: Record<string, unknown>) => Response | undefined } = {}) {
  const lms = service('lms', options.answer);
  const registry = new Registry();
  registry
    .register(
      remoteConnector(parseManifest(manifest('lms'), 'lms'), {
        url: 'http://lms',
        key: secret,
        assert: assertionFor('lms', secret),
        installation: installationAssertionFor('lms', secret),
        fetch: lms.fetch,
      }),
    )
    .govern('lms', openGovernance());
  return { registry, lms };
}
/** Every page to the end. */
async function sweep(registry: Registry, id: string) {
  const pages = [];
  let cursor: string | undefined;
  do {
    const page = await registry.readHoldings(id, cursor);
    pages.push(page);
    cursor = page.next;
  } while (cursor);
  return pages;
}

describe('the registry reads as the installation', () => {
  test('holdingsSources names the enabled connectors that declare the profile; readHoldings pages through one to the end', async () => {
    const { registry, lms } = world();
    expect(await registry.holdingsSources()).toEqual([{ connectorId: 'lms', source: 'Lärplattformen' }]);
    const pages = await sweep(registry, 'lms');
    expect(pages.map(p => p.rows.map(r => r.key))).toEqual([['anna', 'erik'], ['maria', 'johan'], ['karin']]);
    expect(pages.map(p => p.next)).toEqual(['2', '4', undefined]);
    for (const page of pages) expect(checkContract(HoldingsOutputSchema, page)).toBe(true);
    // Each page went to the installation's route with the input alone: no actor, no `about`.
    expect(lms.seen.map(s => [s.route, s.body])).toEqual([
      ['/clew/installation/lms.holdings', { input: {} }],
      ['/clew/installation/lms.holdings', { input: { cursor: '2' } }],
      ['/clew/installation/lms.holdings', { input: { cursor: '4' } }],
    ]);
    // The assertion is the installation's own: no actor, no callback, bound to the body and the name.
    const claims = decodeJwt(lms.seen[1]!.token);
    expect(claims).toMatchObject({
      iss: 'clew',
      aud: 'lms',
      sub: INSTALLATION_SUBJECT,
      caller: INSTALLATION_CALLER,
      capability: 'lms.holdings',
      body: createHash('sha256')
        .update(JSON.stringify({ input: { cursor: '2' } }))
        .digest('base64url'),
    });
    expect(claims.actor).toBeUndefined();
    expect(claims.callback).toBeUndefined();
    expect(claims.exp! - claims.iat!).toBeLessThanOrEqual(120);
  });

  test('no person reaches it on any path, an administrator included: refused exactly as a name nobody declared', async () => {
    const { registry, lms } = world();
    const unknown = async (call: () => Promise<unknown>) => (await call().catch(e => e)) as Error;
    for (const actor of people) {
      for (const name of ['lms.holdings', 'lms.nothing']) {
        // `/api/cap`, a card's action, an assistant's tool, a job's follower: `runCapability` and `Registry.run`.
        expect((await unknown(() => registry.run(actor, name, {}))).message).toBe(UNKNOWN);
        // A card's or a job's approval.
        expect((await unknown(() => registry.validate(actor, name, {}))).message).toBe(UNKNOWN);
        // An in-process `clew.call`, and another connector's callback (`/api/connectors/call`), even one that may use anything.
        expect((await unknown(() => registry.clewFor(actor).call(name, {}))).message).toBe(UNKNOWN);
        expect((await unknown(() => registry.clewFor(actor, {}, 'lms').call(name, {}))).message).toBe(UNKNOWN);
        // A document's bytes.
        const request = { capability: name, input: {}, ref: 'r', revision: '1', document: 'd', documentRevision: '1' };
        expect((await unknown(() => registry.document(actor, request))).message).toBe(UNKNOWN);
      }
      // Nothing a person is offered lists it: the routes' lookup, the tools, the views, the menu, the entity reads.
      expect(registry.find('lms.holdings')).toBeUndefined();
      expect(registry.allowed(actor, 'lms.holdings')).toBeUndefined();
      const offered = [
        ...registry.capabilitiesFor(actor).map(c => c.capability.name),
        ...registry.tools(actor).map(t => t.name),
        ...registry.views(actor).map(v => v.capability),
        ...registry.menu(actor).map(m => m.capability),
        ...registry.aboutReads(actor, 'person').map(r => r.name),
        ...registry.followers(actor, 'lms:x').map(f => f.name),
      ];
      expect(offered).not.toContain('lms.holdings');
      expect(offered).toContain('lms.courses');
    }
    // None of it reached the installation's route.
    expect(lms.seen.filter(s => s.route.startsWith('/clew/installation/'))).toEqual([]);
  });

  test('the routes, the assistant and the stream never name the entry points', () => {
    // Static: only composition hands the port to the competence register's copy. The routes (`/api/cap`, the callback,
    // the entity routes), the assistant's tools and the stream's cards and jobs have no way to it, and none mentions it.
    const roots = ['routes', 'assistant', 'threads'].map(r => join(import.meta.dir, '../../apps/server/src', r));
    const files = (dir: string): string[] =>
      readdirSync(dir).flatMap(f => (statSync(join(dir, f)).isDirectory() ? files(join(dir, f)) : [join(dir, f)]));
    for (const file of roots.flatMap(files))
      expect({ file, text: readFileSync(file, 'utf8') }).not.toMatchObject({
        text: expect.stringMatching(
          /readHoldings|holdingsSources|holdingsReader|installationAssertionFor|asInstallation/,
        ),
      });
  });

  test('a read nobody declared for the installation is refused; so is a connector switched off, or the read switched off', async () => {
    const { registry } = world();
    // A connector that declares no installation read, and a person's capability that happens to be named holdings.
    registry
      .register({
        id: 'other',
        kind: 'passthrough',
        source: 'Annat system',
        areas: [],
        capabilities: [
          {
            name: 'other.holdings',
            kind: 'read',
            title: 'Innehav',
            description: 'Ett vanligt anrop.',
            input: { type: 'object' } as never,
            output: { type: 'object' } as never,
            model: false,
            scope: {},
            run: async () => ({ rows: [], withdrawalsReported: true }),
          },
        ],
      })
      .govern('other', openGovernance());
    expect((await registry.holdingsSources()).map(s => s.connectorId)).toEqual(['lms']);
    await expect(registry.readHoldings('other')).rejects.toMatchObject({ code: 'not-found', message: UNKNOWN });
    await expect(registry.readHoldings('nobody')).rejects.toMatchObject({ code: 'not-found' });
    // A person's capability named holdings is just that: a person may call it, and it is never the profile.
    expect(await registry.run(manager, 'other.holdings', {})).toEqual({ rows: [], withdrawalsReported: true });
    // Switched off by an administrator: neither listed nor read.
    registry.govern('lms', { ...openGovernance(), capabilities: { 'lms.holdings': { enabled: false } } });
    expect(await registry.holdingsSources()).toEqual([]);
    await expect(registry.readHoldings('lms')).rejects.toMatchObject({ code: 'not-found' });
    registry.govern('lms', { ...openGovernance(), state: 'disabled' });
    await expect(registry.readHoldings('lms')).rejects.toMatchObject({ code: 'not-found' });
    // An audience says who may see a connector; nobody is looking here, so it does not narrow the installation's read.
    registry.govern('lms', { ...openGovernance(), audience: { mode: 'restricted', roles: [] } as never });
    expect((await registry.readHoldings('lms')).rows).toHaveLength(2);
  });

  test('a connector switched off while it answers releases nothing', async () => {
    let registry!: Registry;
    ({ registry } = world({
      answer: () => {
        registry.govern('lms', { ...openGovernance(), state: 'disabled' });
        return undefined;
      },
    }));
    await expect(registry.readHoldings('lms')).rejects.toMatchObject({ code: 'not-found' });
  });

  test("the source's refusals keep the protocol's kind; an answer outside the profile is unknown", async () => {
    const json = (body: unknown, status: number) =>
      new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    const failing = (response: Response | (() => never)) =>
      world({ answer: () => (typeof response === 'function' ? response() : response.clone()) }).registry;
    // The kind is the source's, the words Clew's: a source's own message never travels into a log or a check (D91).
    await expect(
      failing(json({ error: { code: 'invalid', message: 'Okänd markör för anna.berg.' } }, 400)).readHoldings(
        'lms',
        'x',
      ),
    ).rejects.toMatchObject({ code: 'invalid', message: 'Lärplattformen godtog inte förfrågan.' });
    await expect(
      failing(json({ error: { code: 'denied', message: 'Källan nekar.' } }, 401)).readHoldings('lms'),
    ).rejects.toMatchObject({ code: 'denied', message: 'Lärplattformen godtar inte Clews intyg.' });
    await expect(
      failing(json({ error: { code: 'unknown', message: 'Något om anna.berg.' } }, 500)).readHoldings('lms'),
    ).rejects.toMatchObject({ code: 'unknown', message: 'Källans svar kunde inte verifieras.' });
    await expect(failing(new Response('no', { status: 401 })).readHoldings('lms')).rejects.toMatchObject({
      code: 'denied',
    });
    await expect(
      failing(json({ error: { code: 'unavailable', message: 'Nere.' } }, 503)).readHoldings('lms'),
    ).rejects.toMatchObject({ code: 'unavailable', message: 'Lärplattformen svarar inte just nu.' });
    await expect(
      failing(() => {
        throw new TypeError('fetch failed');
      }).readHoldings('lms'),
    ).rejects.toMatchObject({ code: 'unavailable' });
    // The declaration lets a holding carry a name; the profile does not: refused, not released.
    const named = json(
      {
        output: {
          rows: [
            {
              key: 'anna',
              holdings: [{ id: 'c', type: 't', label: 'l', kind: 'course', issuedOn: day(1), name: 'Anna Berg' }],
            },
          ],
          withdrawalsReported: false,
        },
      },
      200,
    );
    const error = await failing(named)
      .readHoldings('lms')
      .catch(e => e);
    expect(error).toBeInstanceOf(InstallationReadError);
    expect(error).toMatchObject({ code: 'unknown', message: 'Källans svar kunde inte verifieras.' });
    // Clew refuses input that is not the profile's before it asks the source.
    const { registry, lms } = world();
    await expect(registry.readHoldings('lms', '')).rejects.toMatchObject({ code: 'invalid' });
    expect(lms.seen).toEqual([]);
  });

  test('the loader: installation reads came with protocol 3, are the profiles Clew knows, and fit the profile', () => {
    expect(manifestProblems(manifest(), 'lms')).toEqual([]);
    expect(protocolTerms(2).installation).toBe(false);
    expect(manifestProblems(manifest('lms', 2), 'lms')).toEqual([
      'Installation reads were added under protocol 3 (D119); a manifest on protocol 2 cannot declare installation.',
    ]);
    const changed = (change: (m: any) => void) => {
      const m = JSON.parse(JSON.stringify(manifest()));
      change(m);
      return manifestProblems(m, 'lms');
    };
    expect(changed(m => (m.installation[0].name = 'lms.everything'))[0]).toContain('only its profiles');
    expect(changed(m => (m.installation[0].name = 'other.holdings'))[0]).toContain('lms.holdings');
    expect(changed(m => (m.capabilities[0].name = 'lms.holdings'))).toContain(
      'Capability lms.holdings is already registered.',
    );
    expect(changed(m => (m.installation[0].input.properties.keys = { type: 'array' }))[0]).toContain('{ cursor? }');
    expect(changed(m => (m.installation[0].input.required = ['cursor']))[0]).toContain('{ cursor? }');
    expect(changed(m => delete m.installation[0].output.properties.withdrawalsReported)[0]).toContain('HoldingsOutput');
    expect(
      changed(
        m =>
          (m.installation[0].output.properties.rows.items.properties.holdings.items.properties.kind = {
            enum: ['diploma'],
          }),
      )[0],
    ).toContain('HoldingsOutput');
    expect(changed(m => (m.installation[0].output.properties.rows.maxItems = HOLDINGS_ROWS_MAX + 1))[0]).toContain(
      'bounded',
    );
    expect(changed(m => delete m.installation[0].output.properties.rows.maxItems)[0]).toContain('bounded');
    // A field the schema does not know, and more than one per profile.
    expect(changed(m => (m.installation[0].model = false))[0]).toContain('/installation/0');
    expect(changed(m => m.installation.push(m.installation[0])).join(' ')).toContain('/installation');
    // In process too: the registry refuses the same.
    const inProcess: Connector = {
      id: 'core-lms',
      kind: 'core',
      source: 'x',
      areas: [],
      capabilities: [],
      installation: [
        {
          name: 'core-lms.everything',
          title: 'x',
          description: 'x',
          input: { type: 'object' } as never,
          output: { type: 'object' } as never,
          run: async () => ({}),
        },
      ],
    };
    expect(() => new Registry().register(inProcess)).toThrow('only its profiles');
  });

  test('additive to protocol 3: a manifest without `installation` and every request shape a connector already serves are unchanged', () => {
    // The closed manifest gained one optional property; nothing it had changed, and no request shape a connector
    // without installation reads receives was touched. Its own request shape is a new definition.
    const defs = protocolSchema().$defs as Record<string, any>;
    expect(Object.keys(defs.ConnectorManifest.properties)).toContain('installation');
    expect(defs.ConnectorManifest.required).not.toContain('installation');
    expect(Object.keys(defs.CallRequest.properties)).toEqual(['actor', 'input', 'about']);
    expect(defs.CallRequest.required).toEqual(['actor', 'input']);
    expect(Object.keys(defs.InstallationCallRequest.properties)).toEqual(['input']);
    const { installation: _installation, ...without } = manifest();
    expect(manifestProblems(without, 'lms')).toEqual([]);
    // The dry run says what Clew would read as the installation, apart from what a person can call.
    const preview = previewManifest(manifest(), { id: 'lms' });
    expect(preview.manifest!.capabilities.map(c => c.name)).toEqual(['lms.courses']);
    expect(preview.manifest!.installation!.map(r => [r.name, r.title])).toEqual([
      ['lms.holdings', 'Genomförda kurser'],
    ]);
    expect(previewManifest(without, { id: 'lms' }).manifest!.installation).toBeUndefined();
  });
});

describe('the verifier tells the installation from a person', () => {
  const url = 'http://lms/clew/installation/lms.holdings';
  const text = JSON.stringify({ input: {} });
  const binding = {
    body: createHash('sha256').update(text).digest('base64url'),
    capability: 'lms.holdings',
    route: 'installation' as const,
  };
  const request = (token: string, at = url, body = text) =>
    new Request(at, {
      method: 'POST',
      headers: { authorization: 'Bearer ' + token, 'x-clew-connector-key': secret },
      body,
    });
  const verify = createVerifier({ secret, jwks: testJwks }, 'lms');

  test("the installation's assertion verifies as the installation for exactly its request, and never as a person", async () => {
    const authority = await testAuthority(secret);
    const token = await authority.installation('lms', { body: text, capability: 'lms.holdings' });
    expect(await verify.installation(token, secret, request(token))).toBe(true);
    // Never a person, on any route.
    expect(await verify(token, secret, request(token))).toBeNull();
    expect(verifyAssertion(token, await testJwks(), 'lms', Date.now(), binding)).toBeNull();
    // Replayed with another body, on another name, to another connector, without the transport key, or unbound.
    expect(
      await verify.installation(token, secret, request(token, url, JSON.stringify({ input: { cursor: '2' } }))),
    ).toBe(false);
    expect(await verify.installation(token, secret, request(token, 'http://lms/clew/installation/lms.other'))).toBe(
      false,
    );
    expect(await createVerifier({ secret, jwks: testJwks }, 'other').installation(token, secret, request(token))).toBe(
      false,
    );
    expect(await verify.installation(token, 'wrong-secret-wrong-secret', request(token))).toBe(false);
    expect(await verify.installation(token, secret)).toBe(false);
    expect(verifyInstallationAssertion(token, await testJwks(), 'lms')).toBe(false);
    expect(verifyInstallationAssertion(token, await testJwks(), 'lms', Date.now(), binding)).toBe(true);
    // Clew signs it bound to its request or not at all.
    await expect(authority.installation('lms', { body: text } as never)).rejects.toThrow('bound');
  });

  test("a person's assertion, however valid and bound to the same request, is never the installation's", async () => {
    const authority = await testAuthority(secret);
    for (const actor of people) {
      const token = await authority.assert('lms', actor, [], [], { body: text, capability: 'lms.holdings' });
      expect(await verify.installation(token, secret, request(token))).toBe(false);
      // Nor is it a person's on the installation's route: a person's call goes to the capability's route alone.
      expect(await verify(token, secret, request(token))).toBeNull();
      expect(await verify(token, secret, request(token, 'http://lms/clew/capabilities/lms.holdings'))).toMatchObject({
        id: actor.id,
      });
    }
  });

  test('the route is bound exactly: its kind, its place at the start of the path, and nothing after the name', async () => {
    const authority = await testAuthority(secret);
    const installation = await authority.installation('lms', { body: text, capability: 'lms.holdings' });
    const person = await authority.assert('lms', manager, [], [], { body: text, capability: 'lms.holdings' });
    const capabilityRoute = 'http://lms/clew/capabilities/lms.holdings';
    // The installation's assertion on a person's route, or the name reached through another route, is refused.
    for (const at of [
      capabilityRoute,
      'http://lms/clew/installation/x/clew/capabilities/lms.holdings',
      'http://lms/clew/capabilities/x/clew/installation/lms.holdings',
      'http://lms/prefix/clew/installation/lms.holdings',
      'http://lms/clew/installation/lms.holdings/more',
    ])
      expect(await verify.installation(installation, secret, request(installation, at))).toBe(false);
    expect(await verify.installation(installation, secret, request(installation))).toBe(true);
    // A person's assertion likewise only on its own route, exactly.
    for (const at of [
      url,
      'http://lms/clew/installation/x/clew/capabilities/lms.holdings',
      'http://lms/prefix/clew/capabilities/lms.holdings',
      'http://lms/clew/capabilities/lms.holdings/more',
    ])
      expect(await verify(person, secret, request(person, at))).toBeNull();
    expect(await verify(person, secret, request(person, capabilityRoute))).toMatchObject({ id: manager.id });
    // A call that names no capability (a scan, a figure) keeps verifying on its own route.
    const scanText = JSON.stringify({ actor: manager });
    const scan = await authority.assert('lms', manager, [], [], { body: scanText });
    expect(await verify(scan, secret, request(scan, 'http://lms/clew/scan', scanText))).toMatchObject({
      id: manager.id,
    });
  });

  test("a connector on the previous protocol-3 template still takes Clew's person calls and refuses the installation's (D60)", async () => {
    const authority = await testAuthority(secret);
    const jwks = await testJwks();
    const capabilityRoute = 'http://lms/clew/capabilities/lms.holdings';
    const person = await authority.assert('lms', manager, [], [], { body: text, capability: 'lms.holdings' });
    const installation = await authority.installation('lms', { body: text, capability: 'lms.holdings' });
    const bound = async (token: string, at: string) =>
      previous.verifyAssertion(token, jwks, 'lms', Date.now(), await previous.bindingOf(request(token, at)));
    expect(await bound(person, capabilityRoute)).toMatchObject({ id: manager.id });
    // It knows no installation's assertion, and as a person's it has no actor.
    expect(await bound(installation, url)).toBeNull();
    expect(await bound(installation, capabilityRoute)).toBeNull();
  });

  test('forged claims are refused both ways: an actor beside the caller, another subject, a callback, no binding', async () => {
    const { privateKey, publicKey } = await generateKeyPair('RS256', { extractable: true });
    const jwks = { keys: [{ ...(await exportJWK(publicKey)), kid: 'k', alg: 'RS256', use: 'sig' }] };
    const sign = (claims: Record<string, unknown>, subject = INSTALLATION_SUBJECT) =>
      new SignJWT(claims)
        .setProtectedHeader({ alg: 'RS256', typ: 'JWT', kid: 'k' })
        .setIssuer('clew')
        .setAudience('lms')
        .setSubject(subject)
        .setJti('j')
        .setIssuedAt()
        .setExpirationTime('2m')
        .sign(privateKey);
    const installation = { caller: INSTALLATION_CALLER, ...binding };
    const check = async (token: string) => verifyInstallationAssertion(token, jwks, 'lms', Date.now(), binding);
    expect(await check(await sign(installation))).toBe(true);
    expect(await check(await sign({ ...installation, actor: manager }))).toBe(false);
    expect(await check(await sign(installation, 'p-1'))).toBe(false);
    expect(await check(await sign({ ...installation, callback: 'x' }))).toBe(false);
    expect(await check(await sign({ ...installation, caller: 'person' }))).toBe(false);
    expect(await check(await sign({ caller: INSTALLATION_CALLER, capability: 'lms.holdings' }))).toBe(false);
    expect(await check(await sign({ caller: INSTALLATION_CALLER, body: binding.body }))).toBe(false);
    // And a person's assertion that also says it is the installation's is no person's.
    const both = await sign({ actor: manager, caller: INSTALLATION_CALLER, ...binding }, manager.id);
    expect(verifyAssertion(both, jwks, 'lms', Date.now(), binding)).toBeNull();
  });

  test("the conformance check reads the installation's first pages and fails a connector that answers a person there", async () => {
    const { fetch } = service();
    const options = {
      url: 'http://lms',
      id: 'lms',
      key: secret,
      assert: assertionFor('lms', secret),
      assertForeign: assertionFor('lms', 'another-secret-entirely'),
      assertInstallation: installationAssertionFor('lms', secret),
      fetch,
    };
    const good = await checkConnector(options);
    expect(good.findings.filter(f => f.text.startsWith('lms.holdings')).map(f => f.level)).toEqual(['ok', 'ok']);
    expect(good.findings.find(f => f.text.startsWith('lms.holdings'))!.text).toContain('2 pages, 4 rows');
    // A connector that answers whoever asks on the installation's route.
    const careless: FetchLike = async (input, init) => {
      const request = new Request(input, init);
      if (new URL(request.url).pathname.startsWith('/clew/installation/'))
        return new Response(JSON.stringify({ output: { rows: [], withdrawalsReported: false } }), { status: 200 });
      return fetch(input, init);
    };
    const bad = await checkConnector({ ...options, fetch: careless });
    expect(bad.ok).toBe(false);
    expect(bad.findings.filter(f => f.level === 'fail').map(f => f.text)).toEqual([
      "lms.holdings as the installation: a person's assertion on its route answered 200, expected 401",
    ]);
    // A source's own error text is not shown to the administrator or written to the check's findings (D91).
    const talkative: FetchLike = async (input, init) => {
      const request = new Request(input, init);
      const path = new URL(request.url).pathname;
      if (path.startsWith('/clew/installation/') && request.headers.get('authorization')?.includes('.'))
        return new Response(
          JSON.stringify({ error: { code: 'unknown', message: 'Kontot anna.berg@kommun.se saknas.' } }),
          {
            status: 500,
            headers: { 'content-type': 'application/json' },
          },
        );
      return fetch(input, init);
    };
    const said = await checkConnector({ ...options, fetch: talkative });
    const text = JSON.stringify(said);
    expect(text).not.toContain('anna.berg');
    expect(said.findings.map(f => f.text)).toContain('lms.holdings as the installation: the read failed (unknown)');
  });
});
