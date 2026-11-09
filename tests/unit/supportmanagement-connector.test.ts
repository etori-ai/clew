import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { type Actor } from '../../packages/connectors/src/index';
import { parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createConnector, createManifest, type ErrandSource } from '../../connectors/supportmanagement/connector.mjs';
import {
  SourceDenied,
  SourceNotFound,
  SourceUnavailable,
  createFixtureErrands,
  toSourceErrand,
} from '../../connectors/supportmanagement/errands.mjs';
import { createSupportManagementErrands } from '../../connectors/supportmanagement/supportmanagement.mjs';
import { errandRefPattern, manifest as smManifest } from '../../connectors/supportmanagement/manifest.mjs';
import { assertionFor, testJwks } from '../connector-authority';

/**
 * The SupportManagement connector (D35, D89): the person's errands as rows in the shared errand model, read with the
 * person's own token. The source decides who sees what; the connector holds no group, namespace or access rule. The
 * fixture stands in for SupportManagement with access rules of its own, and the API adapter runs against recorded
 * answers in the shape the connector asks SupportManagement for.
 */
const secret = 'test-secret-test-secret';
const at = Date.parse('2026-11-09T09:00:00Z');
const now = () => at;
const day = 86_400_000;
const ago = (days: number) => new Date(at - days * day).toISOString();

const actor = (id: string, name: string): Actor => ({
  id,
  name,
  unitId: 'unit-skola',
  unitLabel: 'Bergsåkers skola',
  role: 'employee',
});
const mikael = actor('mikael', 'Mikael Lind');
const hillevi = actor('hillevi', 'Hillevi Berg');
const hassan = actor('hassan', 'Hassan Ali');
const karin = actor('karin', 'Karin Holm');

/** A token as the identity provider would issue it for SupportManagement. The fixture reads it unverified. */
const tokenFor = (username: string, claims: Record<string, unknown> = {}) =>
  'h.' +
  Buffer.from(
    JSON.stringify({ preferred_username: username, aud: 'supportmanagement', exp: at / 1000 + 60, ...claims }),
  ).toString('base64url') +
  '.s';
const as = (username: string, claims?: Record<string, unknown>) => ({
  delegate: async () => tokenFor(username, claims),
});

type Row = Record<string, unknown>;
const ref = (namespace: string, id: string, municipalityId = '0000') =>
  `errand:sm:${municipalityId}:${namespace}:${id}`;
const ik = (n: number) => ref('IK', `a1f0c3d2-000${n}-4000-8000-00000000000${n}`);

function stack(options: Parameters<typeof createConnector>[0] = {}) {
  const sm = createConnector({
    jwks: testJwks,
    secret,
    source: createFixtureErrands({ now }),
    now,
    ...options,
  });
  const connectorFetch: FetchLike = (input, init) => sm.handle(new Request(input, init));
  const registry = new Registry();
  registry.register(
    remoteConnector(parseManifest(sm.manifest, 'sm'), {
      url: 'http://sm-connector',
      key: secret,
      assert: assertionFor('sm', secret),
      fetch: connectorFetch,
    }),
  );
  return { registry, sm };
}
const errands = async (registry: Registry, person: Actor, input: Record<string, unknown> = {}) =>
  (await registry.run<{ rows: Row[] }>(person, 'sm.errands', input, as(person.id))).rows;

describe('the SupportManagement connector', () => {
  test('declares the errand reads, acts as the person and pushes nothing', () => {
    const parsed = parseManifest(smManifest, 'sm');
    expect(parsed.delegation).toEqual({ audience: 'supportmanagement' });
    expect(parsed.scan).toBe(false);
    expect(parsed.capabilities.map(c => [c.name, c.kind, c.model])).toEqual([
      ['sm.errands', 'read', true],
      ['sm.errand', 'read', false],
    ]);
    // The audience is the installation's: the identity provider and the gateway agree on it.
    expect(parseManifest(createManifest({ audience: 'api://sm' }), 'sm').delegation).toEqual({
      audience: 'api://sm',
    });
  });

  test('lists what is assigned to the person or their group, what waits on them first, then the oldest', async () => {
    const { registry } = stack();
    const rows = await errands(registry, mikael);
    expect(rows.map(r => [r.label, r.state, r.status])).toEqual([
      ['IK-26110007 · Behörighet, Beställning', 'waiting-on-me', 'Pågående'],
      ['IK-26110011 · Behörighet, Återställning', 'new', 'Inkommet'],
      ['IK-26100031 · Behörighet, Beställning', 'waiting-on-others', 'Parkerat'],
      ['IK-26110004 · Utrustning, Felanmälan', 'waiting-on-others', 'Komplettering'],
    ]);
    expect(rows[0]).toEqual({
      ref: ik(1),
      label: 'IK-26110007 · Behörighet, Beställning',
      state: 'waiting-on-me',
      status: 'Pågående',
      waitingOn: 'Dig',
      since: ago(1),
      area: 'Intern kundtjänst',
    });
    expect(rows[1]!.waitingOn).toBe('Din grupp');
    expect(String(rows[2]!.waitingOn)).toMatch(/^Parkerat till 12 nov/);
    expect(rows[3]!.waitingOn).toBe('Anmälaren');
    for (const row of rows) expect(String(row.ref)).toMatch(new RegExp(errandRefPattern));
  });

  test('a row carries the number and the type, never the title, the description or an account', async () => {
    const { registry } = stack();
    const all = JSON.stringify([
      ...(await errands(registry, mikael)),
      ...(await errands(registry, hillevi, { view: 'reported' })),
    ]);
    for (const leaked of ['elevregistret', 'Projektorn', 'Lampan', 'hillevi', 'mikael', 'sg-intern'])
      expect(all).not.toContain(leaked);
  });

  test('lists what the person reported, and an errand asking the reporter for more waits on them', async () => {
    const { registry } = stack();
    expect(await errands(registry, hillevi)).toEqual([]);
    const reported = await errands(registry, hillevi, { view: 'reported' });
    expect(reported.map(r => [r.label, r.state, r.waitingOn])).toEqual([
      ['IK-26110004 · Utrustning, Felanmälan', 'waiting-on-me', 'Dig'],
      ['IK-26110007 · Behörighet, Beställning', 'waiting-on-others', 'Handläggare'],
    ]);
    // Two systems' worth of namespaces in one answer: the source decides which, the area is only a label.
    expect((await errands(registry, hassan, { view: 'reported' })).map(r => [r.label, r.area])).toEqual([
      ['LOP-26110002 · Lön, Fråga', 'Lön och pension'],
      ['IK-26110011 · Behörighet, Återställning', 'Intern kundtjänst'],
    ]);
  });

  test('the source decides access: nobody sees a namespace they do not handle, and the connector asks nothing else', async () => {
    const { registry } = stack();
    expect((await errands(registry, karin)).map(r => r.label)).toEqual(['KC-26110042 · Faktura, Fråga']);
    const kc = ref('KC', 'c3d2e5f4-0001-4000-8000-000000000001');
    expect((await errands(registry, mikael)).some(r => r.ref === kc)).toBe(false);
    await expect(registry.run(mikael, 'sm.errand', { ref: kc }, as('mikael'))).rejects.toThrow(
      'Ärendet finns inte, eller så har du inte tillgång till det.',
    );
    // The Clew actor is not what the source goes by: the token is. Mikael's session with Karin's token is Karin.
    expect((await registry.run<{ rows: Row[] }>(mikael, 'sm.errands', {}, as('karin'))).rows.map(r => r.ref)).toEqual([
      kc,
    ]);
  });

  test('opens one errand with its free text for the handler and for the reporter, and for nobody else', async () => {
    const { registry } = stack();
    expect(await registry.run<Row>(mikael, 'sm.errand', { ref: ik(1) }, as('mikael'))).toEqual({
      ref: ik(1),
      label: 'IK-26110007 · Behörighet, Beställning',
      state: 'waiting-on-me',
      status: 'Pågående',
      waitingOn: 'Dig',
      since: ago(1),
      area: 'Intern kundtjänst',
      title: 'Ny medarbetare behöver konto i elevregistret',
      description: 'Vikarien börjar på måndag och saknar inloggning. Beställningen gäller läsbehörighet.',
    });
    const reporters = await registry.run<Row>(hillevi, 'sm.errand', { ref: ik(1) }, as('hillevi'));
    expect([reporters.state, reporters.waitingOn]).toEqual(['waiting-on-others', 'Handläggare']);
    await expect(registry.run(hassan, 'sm.errand', { ref: ik(1) }, as('hassan'))).rejects.toThrow(
      'Ärendet finns inte, eller så har du inte tillgång till det.',
    );
    // A closed errand is not listed, and opens as closed without anybody to wait on.
    const closed = await registry.run<Row>(mikael, 'sm.errand', { ref: ik(5) }, as('mikael'));
    expect([closed.state, closed.status, closed.waitingOn]).toEqual(['closed', 'Löst', undefined]);
  });

  test('refuses a ref of another installation and a ref that is not an errand of this connector', async () => {
    const { registry } = stack();
    const elsewhere = ref('IK', 'a1f0c3d2-0001-4000-8000-000000000001', '9999');
    await expect(registry.run(mikael, 'sm.errand', { ref: elsewhere }, as('mikael'))).rejects.toThrow(
      'Ärendet finns inte, eller så har du inte tillgång till det.',
    );
    await expect(
      registry.run(mikael, 'sm.errand', { ref: 'errand:casedata:0000:IK:1' }, as('mikael')),
    ).rejects.toThrow();
    await expect(registry.run(mikael, 'sm.errands', { view: 'everything' }, as('mikael'))).rejects.toThrow();
  });

  test("without the person's token it answers denied, and a token the source refuses is denied too", async () => {
    const { registry } = stack();
    await expect(registry.run(mikael, 'sm.errands', {}, { delegate: async () => undefined })).rejects.toThrow(
      'Din inloggning kan inte styrkas mot ärendesystemet i den här sessionen.',
    );
    for (const claims of [{ aud: 'eneo' }, { exp: at / 1000 - 1 }, { preferred_username: '' }])
      await expect(registry.run(mikael, 'sm.errands', {}, as('mikael', claims))).rejects.toThrow(
        'Ärendesystemet godkänner inte din inloggning.',
      );
  });

  test('an outage is unavailable, not an empty list', async () => {
    const down: ErrandSource = {
      mine: async () => {
        throw new SourceUnavailable('down');
      },
      errand: async () => {
        throw new SourceUnavailable('down');
      },
    };
    const { registry } = stack({ source: down });
    await expect(registry.run(mikael, 'sm.errands', {}, as('mikael'))).rejects.toThrow(
      'Ärendesystemet svarar inte just nu.',
    );
    await expect(registry.run(mikael, 'sm.errand', { ref: ik(1) }, as('mikael'))).rejects.toThrow(
      'Ärendesystemet svarar inte just nu.',
    );
  });

  test('the operator configures links out and what a status means; neither decides access', async () => {
    const { registry } = stack({
      links: { IK: 'https://arenden.example/arende/{errandNumber}', LOP: 'javascript:alert(1)//{errandNumber}' },
      statusKinds: { PENDING: 'waiting-other' },
    });
    const rows = await errands(registry, hillevi, { view: 'reported' });
    expect(rows.map(r => [r.label, r.state, r.link])).toEqual([
      ['IK-26110004 · Utrustning, Felanmälan', 'waiting-on-others', 'https://arenden.example/arende/IK-26110004'],
      ['IK-26110007 · Behörighet, Beställning', 'waiting-on-others', 'https://arenden.example/arende/IK-26110007'],
    ]);
    expect(
      (await errands(registry, hassan, { view: 'reported' })).every(
        r => r.link === undefined || /^https:/.test(String(r.link)),
      ),
    ).toBe(true);
  });

  test('the transport key and the assertion are checked before anything is read', async () => {
    const { sm } = stack();
    const manifest = await sm.handle(new Request('http://sm-connector/clew/manifest'));
    expect(manifest.status).toBe(200);
    const call = (headers: Record<string, string>) =>
      sm.handle(
        new Request('http://sm-connector/clew/capabilities/sm.errands', {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-clew-delegated-token': tokenFor('mikael'), ...headers },
          body: JSON.stringify({ input: {} }),
        }),
      );
    expect((await call({})).status).toBe(401);
    expect(
      (await call({ 'x-clew-connector-key': 'wrong-secret-wrong-secret', authorization: 'Bearer x.y.z' })).status,
    ).toBe(401);
    expect((await call({ 'x-clew-connector-key': secret, authorization: 'Bearer x.y.z' })).status).toBe(401);
  });
});

describe('the mapping from a SupportManagement errand', () => {
  const metadata = {
    statuses: [{ name: 'ONGOING', displayName: 'Pågående' }],
    categories: [
      { name: 'ACCESS', displayName: 'Behörighet', types: [{ name: 'ACCESS.ORDER', displayName: 'Beställning' }] },
    ],
  };
  const raw = {
    id: 'a1f0c3d2-0001-4000-8000-000000000001',
    errandNumber: 'IK-26110007',
    namespace: 'IK',
    status: 'ONGOING',
    classification: { category: 'ACCESS', type: 'ACCESS.ORDER' },
    title: 'En rubrik',
    created: ago(3),
    modified: ago(2),
    touched: ago(1),
  };

  test('takes display names from the metadata and falls back to the source names', () => {
    expect(toSourceErrand(raw, { metadata, relation: 'assigned' })).toEqual({
      namespace: 'IK',
      area: 'IK',
      id: raw.id,
      errandNumber: 'IK-26110007',
      type: 'Behörighet, Beställning',
      status: 'ONGOING',
      statusLabel: 'Pågående',
      since: ago(1),
      relation: 'assigned',
      title: 'En rubrik',
    });
    const bare = toSourceErrand({ ...raw, namespaceDisplayName: 'Intern kundtjänst' }, {})!;
    expect([bare.area, bare.type, bare.statusLabel, bare.relation]).toEqual([
      'Intern kundtjänst',
      'ACCESS, ACCESS.ORDER',
      'ONGOING',
      undefined,
    ]);
  });

  test('drops what it cannot identify rather than guessing', () => {
    for (const broken of [
      null,
      { ...raw, id: undefined },
      { ...raw, errandNumber: '' },
      { ...raw, status: undefined },
      { ...raw, namespace: '../admin' },
      { ...raw, created: undefined, modified: undefined, touched: 'yesterday' },
    ])
      expect(toSourceErrand(broken, { metadata })).toBeNull();
  });
});

describe('the SupportManagement API adapter', () => {
  const metadata = {
    statuses: [
      { name: 'ONGOING', displayName: 'Pågående' },
      { name: 'NEW', displayName: 'Inkommet' },
    ],
    categories: [
      { name: 'ACCESS', displayName: 'Behörighet', types: [{ name: 'ACCESS.ORDER', displayName: 'Beställning' }] },
    ],
  };
  const errand = (n: number, extra: Record<string, unknown> = {}) => ({
    id: `a1f0c3d2-000${n}-4000-8000-00000000000${n}`,
    errandNumber: `IK-2611000${n}`,
    namespace: 'IK',
    status: 'ONGOING',
    classification: { category: 'ACCESS', type: 'ACCESS.ORDER' },
    title: 'Fritext som inte ska in i en rad',
    created: ago(3),
    modified: ago(2),
    touched: ago(n),
    ...extra,
  });

  function api(answers: Record<string, unknown | number>) {
    const calls: Array<{ key: string; headers: Record<string, string> }> = [];
    const fetch: FetchLike = async (input, init) => {
      const url = new URL(String(input));
      const key = `${init?.method ?? 'GET'} ${url.pathname}${url.search}`;
      calls.push({ key, headers: Object.fromEntries(new Headers(init?.headers).entries()) });
      const hit = answers[key];
      if (typeof hit === 'number') return new Response('', { status: hit });
      return hit === undefined ? new Response('', { status: 404 }) : Response.json(hit);
    };
    const source = createSupportManagementErrands({
      url: 'https://api.example/supportmanagement/',
      municipalityId: '2281',
      fetch,
      now,
    });
    return { source, calls };
  }
  const mine = (relation: string, page = 0) =>
    `GET /supportmanagement/2281/errands/mine?relation=${relation}&page=${page}&size=100`;

  test("asks for the person's errands with their token as the only credential, and names them from the metadata", async () => {
    const { source, calls } = api({
      [mine('assigned')]: { content: [errand(1), errand(2, { namespace: undefined })], last: true },
      'GET /supportmanagement/2281/IK/metadata': metadata,
    });
    const found = await source.mine('the-person-token', 'assigned');
    expect(found.map(e => [e.errandNumber, e.type, e.statusLabel, e.relation, e.area])).toEqual([
      ['IK-26110001', 'Behörighet, Beställning', 'Pågående', 'assigned', 'IK'],
    ]);
    expect(calls.map(c => c.key)).toEqual([mine('assigned'), 'GET /supportmanagement/2281/IK/metadata']);
    for (const call of calls)
      expect(call.headers).toEqual({ authorization: 'Bearer the-person-token', accept: 'application/json' });
  });

  test('reads every page up to a bound, and keeps the metadata between reads', async () => {
    const { source, calls } = api({
      [mine('group')]: { content: [errand(1)], last: false },
      [mine('group', 1)]: { content: [errand(2)], last: true },
      'GET /supportmanagement/2281/IK/metadata': metadata,
    });
    expect((await source.mine('t', 'group')).map(e => e.errandNumber)).toEqual(['IK-26110001', 'IK-26110002']);
    await source.mine('t', 'group');
    expect(calls.filter(c => c.key.endsWith('/metadata'))).toHaveLength(1);
  });

  test('a refused token is denied, a failure is unavailable, and a missing errand is not found', async () => {
    await expect(api({ [mine('assigned')]: 401 }).source.mine('t', 'assigned')).rejects.toBeInstanceOf(SourceDenied);
    await expect(api({ [mine('assigned')]: 403 }).source.mine('t', 'assigned')).rejects.toBeInstanceOf(SourceDenied);
    await expect(api({ [mine('assigned')]: 500 }).source.mine('t', 'assigned')).rejects.toBeInstanceOf(
      SourceUnavailable,
    );
    await expect(api({}).source.errand('t', 'IK', 'a1f0c3d2-0001-4000-8000-000000000001')).rejects.toBeInstanceOf(
      SourceNotFound,
    );
  });

  test('a reporter who may not read the namespace metadata still gets the errand, with the source names', async () => {
    const { source } = api({
      [mine('reported')]: { content: [errand(1)], last: true },
      'GET /supportmanagement/2281/IK/metadata': 403,
    });
    expect((await source.mine('t', 'reported')).map(e => [e.type, e.statusLabel])).toEqual([
      ['ACCESS, ACCESS.ORDER', 'ONGOING'],
    ]);
  });

  test('opens one errand in its namespace, with the free text', async () => {
    const { source, calls } = api({
      'GET /supportmanagement/2281/IK/errands/a1f0c3d2-0001-4000-8000-000000000001': {
        ...errand(1, { namespace: undefined, description: 'En beskrivning' }),
      },
      'GET /supportmanagement/2281/IK/metadata': metadata,
    });
    const found = await source.errand('t', 'IK', 'a1f0c3d2-0001-4000-8000-000000000001');
    expect([found.namespace, found.title, found.description]).toEqual([
      'IK',
      'Fritext som inte ska in i en rad',
      'En beskrivning',
    ]);
    expect(calls.map(c => c.key).sort()).toEqual([
      'GET /supportmanagement/2281/IK/errands/a1f0c3d2-0001-4000-8000-000000000001',
      'GET /supportmanagement/2281/IK/metadata',
    ]);
  });

  test('needs an address, a municipality id and https', () => {
    expect(() => createSupportManagementErrands({ municipalityId: '2281' })).toThrow('SM_URL');
    expect(() => createSupportManagementErrands({ url: 'https://api.example' })).toThrow('SM_MUNICIPALITY_ID');
    expect(() => createSupportManagementErrands({ url: 'http://api.example', municipalityId: '2281' })).toThrow(
      'https',
    );
  });

  test('behind the connector the rows carry the installation in their refs', async () => {
    const { source } = api({
      [mine('assigned')]: { content: [errand(1)], last: true },
      [mine('group')]: { content: [errand(2, { status: 'NEW' })], last: true },
      'GET /supportmanagement/2281/IK/metadata': metadata,
    });
    const { registry } = stack({ source, municipalityId: '2281' });
    expect((await errands(registry, mikael)).map(r => [r.ref, r.state])).toEqual([
      [ref('IK', 'a1f0c3d2-0001-4000-8000-000000000001', '2281'), 'waiting-on-me'],
      [ref('IK', 'a1f0c3d2-0002-4000-8000-000000000002', '2281'), 'new'],
    ]);
  });
});
