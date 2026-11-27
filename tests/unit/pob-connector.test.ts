import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { createServer } from 'node:http';
import { connect, type AddressInfo } from 'node:net';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import {
  RequestsOutputSchema,
  checkContract,
  type ErrandsResult,
  type RequestsResult,
} from '../../packages/contracts/src/index';
import { SEARCH_CONNECTOR, type Actor } from '../../packages/connectors/src/index';
import { errandCapabilities } from '../../apps/server/src/modules/errands/capabilities';
import { errandUsecases } from '../../apps/server/src/modules/errands/usecases';
import { requestCapabilities } from '../../apps/server/src/modules/requests/capabilities';
import { requestUsecases } from '../../apps/server/src/modules/requests/usecases';
import { parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createConnector, createManifest } from '../../connectors/pob/connector.mjs';
import {
  SourceUnavailable,
  createFixtureCases,
  holds,
  plainText,
  relationOf,
  resolved,
  type CaseSource,
  type SourceCase,
} from '../../connectors/pob/cases.mjs';
import { readConfig } from '../../connectors/pob/config.mjs';
import { listener } from '../../connectors/pob/http.mjs';
import { verifyPersonToken } from '../../connectors/pob/identity.mjs';
import { DEFAULT_FIELDS, agreementFieldMap, createPobCases, fieldMap, instantIn } from '../../connectors/pob/pob.mjs';
import { errandRefPattern, requestRefPattern, manifest as pobManifest } from '../../connectors/pob/manifest.mjs';
import { assertionFor, signedRequest, testJwks } from '../connector-authority';

/**
 * The POB connector (D35, D89, and the plan in docs/reviews/2026-11-13-a-pob-connector-and-errands-from-two-case-systems.md):
 * POB is reached with one account that can read every errand, so the connector proves who the person is from their own
 * token and decides itself which errands are theirs. These tests are about that boundary: nothing reaches POB without
 * a token the identity provider signed for this person, and nothing of another person's errand leaves the connector,
 * whatever POB answers. A made-up POB stands in for the system.
 */
const secret = 'test-secret-test-secret';
const at = Date.parse('2026-11-09T09:00:00Z');
const now = () => at;
const day = 86_400_000;
const ago = (days: number) => new Date(at - days * day).toISOString();
const issuer = 'https://idp.test/realms/clew';

const person = (userName: string, name: string): Actor => ({
  id: 'person-' + userName,
  name,
  unitId: 'unit-skola',
  unitLabel: 'Bergsåkers skola',
  role: 'employee',
  userName,
});
const mikael = person('mikael', 'Mikael Lind');
const hillevi = person('hillevi', 'Hillevi Berg');
const hassan = person('hassan', 'Hassan Ali');
const ingrid = person('ingrid', 'Ingrid Holm');
const karin = person('karin', 'Karin Holm');
const lena = person('lena', 'Lena Ek');

/** An identity provider: a key pair, its public key set, and tokens signed with it. A second one signs with another key under the same key id. */
function provider() {
  const keys = generateKeyPair('RS256', { extractable: true });
  return {
    jwks: async () => ({
      keys: [{ ...(await exportJWK((await keys).publicKey)), kid: 'idp-1', alg: 'RS256', use: 'sig' }],
    }),
    token: async (username: string, claims: Record<string, unknown> = {}, header: Record<string, unknown> = {}) =>
      new SignJWT({ preferred_username: username, iss: issuer, aud: 'pob', exp: at / 1000 + 60, ...claims })
        .setProtectedHeader({ alg: 'RS256', kid: 'idp-1', typ: 'JWT', ...header })
        .sign((await keys).privateKey),
  };
}
const idp = provider();
const stranger = provider();
const as = (username: string, claims?: Record<string, unknown>) => ({
  delegate: async () => idp.token(username, claims),
});

type Row = Record<string, unknown>;
type Line = Record<string, unknown>;
const ref = (id: string) => `errand:pob:${id}`;
const rref = (id: string) => `request:pob:${id}`;

/** The made-up POB with every call to it recorded. */
function recorded(source: CaseSource = createFixtureCases({ now })) {
  const calls: string[] = [];
  const spy: CaseSource = {
    person: account => (calls.push('person ' + account), source.person(account)),
    list: (who, relation, types) => (calls.push('list ' + relation), source.list(who, relation, types)),
    one: id => (calls.push('one ' + id), source.one(id)),
    memo: (id, type) => (calls.push(`memo ${id} ${type}`), source.memo(id, type)),
    ...(source.create
      ? { create: (fault, operation) => (calls.push('create ' + fault.customerId), source.create!(fault, operation)) }
      : {}),
  };
  return { source: spy, calls };
}

function stack(options: Parameters<typeof createConnector>[0] = {}) {
  const lines: Line[] = [];
  const { source, calls } = recorded(options.source);
  const pob = createConnector({
    jwks: testJwks,
    secret,
    identity: { issuer, jwks: idp.jwks },
    now,
    log: line => lines.push(line),
    ...options,
    source,
  });
  const connectorFetch: FetchLike = (input, init) => pob.handle(new Request(input, init));
  const registry = new Registry();
  registry.register(
    remoteConnector(parseManifest(pob.manifest, 'pob'), {
      url: 'http://pob-connector',
      key: secret,
      assert: assertionFor('pob', secret),
      fetch: connectorFetch,
    }),
  );
  return { registry, pob, calls, lines };
}
const errands = async (registry: Registry, who: Actor, input: Record<string, unknown> = {}) =>
  (await registry.run<{ rows: Row[] }>(who, 'pob.errands', input, as(who.userName!))).rows;
const open = (registry: Registry, who: Actor, id: string) =>
  registry.run<Row>(who, 'pob.errand', { ref: ref(id) }, as(who.userName!));
/** What the person reported: the requests profile (D123). */
const requests = async (registry: Registry, who: Actor) =>
  (await registry.run<{ rows: Row[] }>(who, 'pob.requests', {}, as(who.userName!))).rows;
const openRequest = (registry: Registry, who: Actor, id: string) =>
  registry.run<Row>(who, 'pob.request', { ref: rref(id) }, as(who.userName!));

const NOT_FOUND = 'Ärendet finns inte, eller så har du inte tillgång till det.';
const REFUSED = 'IT-supporten godtar inte din inloggning just nu.';
const AMBIGUOUS = 'Dina uppgifter i IT-supporten är inte entydiga, så dina ärenden kan inte visas här.';

describe('the POB connector', () => {
  test('declares the errand profile and the requests profile, a scan, and acts as the person', () => {
    const parsed = parseManifest(pobManifest, 'pob');
    expect(parsed.delegation).toEqual({ audience: 'pob' });
    // A request that waits for the person's answer becomes a card, read with their token when their session asks.
    expect(parsed.scan).toBe(true);
    expect(parsed.areas).toEqual([]);
    expect(parsed.capabilities.map(c => [c.name, c.kind, c.model])).toEqual([
      ['pob.errands', 'read', true],
      ['pob.errand', 'read', false],
      ['pob.requests', 'read', true],
      ['pob.request', 'read', false],
    ]);
    expect(parseManifest(createManifest({ audience: 'api://pob', source: 'Servicedesk' }), 'pob')).toMatchObject({
      delegation: { audience: 'api://pob' },
      source: 'Servicedesk',
    });
  });

  test('what the person reported is their requests: what waits on them, then what is open from the oldest, then what was closed', async () => {
    const { registry } = stack();
    const rows = await requests(registry, hillevi);
    expect(rows.map(r => [r.label, r.state, r.status])).toEqual([
      ['IT-48190 · Beställning, Behörighet', 'waiting-on-me', 'Väntar på användaren'],
      ['IT-48211 · Incident, Dator', 'active', 'Pågår'],
      ['IT-48007 · Incident, Nätverk', 'closed', 'Löst'],
    ]);
    // The row is the protocol's RequestRow and nothing besides: `since` is when she reported it.
    expect(rows[0]).toEqual({
      ref: rref('48190'),
      label: 'IT-48190 · Beställning, Behörighet',
      state: 'waiting-on-me',
      status: 'Väntar på användaren',
      since: ago(6),
    });
    expect(checkContract(RequestsOutputSchema, { rows })).toBe(true);
    for (const row of rows) expect(String(row.ref)).toMatch(new RegExp(requestRefPattern));
    // For the one who waits, everything open waits on the desk: new until someone starts, then active, parked or not.
    expect((await requests(registry, hassan)).map(r => [r.label, r.state])).toEqual([
      ['IT-48102 · Beställning, Mobiltelefon', 'active'],
      ['IT-48230 · Incident, Skrivare', 'new'],
    ]);
    // What she reported is not among the errands a person handles: the errand profile's reported view answers none.
    expect(await errands(registry, hillevi, { view: 'reported' })).toEqual([]);
  });

  test('a handler’s errands are what is assigned to them and what waits unassigned in their group', async () => {
    const { registry } = stack();
    const rows = await errands(registry, mikael);
    expect(rows.map(r => [r.label, r.state, r.waitingOn])).toEqual([
      ['IT-48211 · Incident, Dator', 'waiting-on-me', 'Dig'],
      ['IT-48230 · Incident, Skrivare', 'new', 'Din grupp'],
      ['IT-48102 · Beställning, Mobiltelefon', 'waiting-on-others', 'Parkerat till 12 nov.'],
    ]);
    expect(rows[0]).toEqual({
      ref: ref('48211'),
      label: 'IT-48211 · Incident, Dator',
      state: 'waiting-on-me',
      status: 'Pågår',
      waitingOn: 'Dig',
      since: ago(1),
      area: 'Servicedesk',
    });
    for (const row of rows) expect(String(row.ref)).toMatch(new RegExp(errandRefPattern));
    // The same list when it is asked for by name.
    expect(await errands(registry, mikael, { view: 'assigned' })).toEqual(rows);
    // An errand that waits for its reporter waits on someone else, for its handler; a closed one is not listed.
    const lenas = await errands(registry, lena);
    expect(lenas.find(r => r.ref === ref('48190'))).toMatchObject({
      state: 'waiting-on-others',
      waitingOn: 'Anmälaren',
    });
    expect(lenas.some(r => r.ref === ref('48007'))).toBe(false);
    // A handler is a reporter too, of what they reported themselves.
    expect((await requests(registry, mikael)).map(r => r.label)).toEqual(['IT-48244 · Incident, Programvara']);
    // The queue of a group the handler is not in is not theirs.
    expect(rows.some(r => r.ref === ref('48251'))).toBe(false);
  });

  test('a row carries the number and the type, never the title, the description, a name or an account', async () => {
    const { registry } = stack();
    const all = JSON.stringify([
      ...(await errands(registry, mikael)),
      ...(await requests(registry, hillevi)),
      ...(await requests(registry, hassan)),
    ]);
    for (const leaked of ['Datorn', 'Skärmen', 'diskkrasch', 'hillevi', 'mikael', 'c-hillevi', 'u-mikael'])
      expect(all).not.toContain(leaked);
  });

  test('what was closed long ago and what is of a case type outside the configuration are not listed', async () => {
    const { registry } = stack();
    const refs = (await requests(registry, hillevi)).map(r => r.ref);
    expect(refs).not.toContain(rref('00317')); // an HR errand in the same POB
    // The HR errand is hers, and still not found: which case types Clew reads is the installation's choice.
    await expect(openRequest(registry, hillevi, '00317')).rejects.toThrow(NOT_FOUND);
    // With the case type let in, it is listed.
    const wider = stack({ caseTypes: ['Incident', 'ServiceRequest', 'HRCase'] });
    expect((await requests(wider.registry, hillevi)).map(r => r.ref)).toContain(rref('00317'));
    // Closed twelve days ago it is listed as closed; closed more than thirty days ago it is not.
    expect(refs).toContain(rref('48007'));
    const fixture = createFixtureCases({ now });
    const longAgo: CaseSource = {
      ...fixture,
      list: async (who, relation, types) => {
        const answer = await fixture.list(who, relation, types);
        return {
          ...answer,
          cases: (answer.cases as SourceCase[]).map(c => (c.id === '48007' ? { ...c, since: ago(31) } : c)),
        };
      },
    };
    expect((await requests(stack({ source: longAgo }).registry, hillevi)).map(r => r.ref)).toEqual([
      rref('48190'),
      rref('48211'),
    ]);
  });

  test('a person with no record in POB has no requests and no errands, and POB is asked for none', async () => {
    const { registry, calls } = stack();
    expect(await requests(registry, ingrid)).toEqual([]);
    expect(await errands(registry, ingrid)).toEqual([]);
    expect(calls).toEqual(['person ingrid']);
    // A reporter who is no handler has nothing assigned.
    expect(await errands(registry, hillevi)).toEqual([]);
  });

  test('a request opens for the one who reported it and an errand for the one who handles it, with the reporter’s own text, and for nobody else', async () => {
    const { registry, calls } = stack();
    const reporters = await openRequest(registry, hillevi, '48211');
    expect(reporters).toEqual({
      ref: rref('48211'),
      label: 'IT-48211 · Incident, Dator',
      state: 'active',
      status: 'Pågår',
      since: ago(4),
      group: 'Servicedesk',
      title: 'Datorn startar inte efter uppdateringen',
      // Stored as HTML in POB; answered as text.
      description: 'Skärmen är svart sedan gårdagens uppdatering.\nLaddaren lyser & fläkten går.',
    });
    const handlers = await open(registry, mikael, '48211');
    expect([handlers.state, handlers.waitingOn, handlers.title]).toEqual([
      'waiting-on-me',
      'Dig',
      'Datorn startar inte efter uppdateringen',
    ]);
    // Only the reporter's own memo is ever asked for: the internal note stays in POB, also for the handler.
    expect(calls.filter(c => c.startsWith('memo'))).toEqual(['memo 48211 Problem', 'memo 48211 Problem']);
    expect(JSON.stringify([reporters, handlers])).not.toContain('diskkrasch');

    // Each opens it in their own role only, and someone with no relation to it gets the same answer as for an errand
    // that does not exist; no memo is read.
    calls.length = 0;
    await expect(open(registry, hillevi, '48211')).rejects.toThrow(NOT_FOUND);
    await expect(openRequest(registry, mikael, '48211')).rejects.toThrow(NOT_FOUND);
    await expect(open(registry, hassan, '48211')).rejects.toThrow(NOT_FOUND);
    await expect(openRequest(registry, hassan, '48211')).rejects.toThrow(NOT_FOUND);
    await expect(openRequest(registry, hassan, '99999')).rejects.toThrow(NOT_FOUND);
    expect(calls.some(c => c.startsWith('memo'))).toBe(false);
    // A closed request opens as closed.
    const closed = await openRequest(registry, hillevi, '48007');
    expect([closed.state, closed.status]).toEqual(['closed', 'Löst']);
  });

  test('whatever POB answers, only the person’s own leaves the connector', async () => {
    const fixture = createFixtureCases({ now });
    const everything = async () => {
      const all: unknown[] = [];
      for (const id of ['48211', '48190', '48230', '48102', '48007', '00317', '48244', '48251'])
        all.push(await fixture.one(id));
      return all;
    };
    // A POB that ignores the filter and returns every errand it has, for every question.
    const careless: CaseSource = { ...fixture, list: async () => ({ cases: await everything(), complete: true }) };
    const { registry } = stack({ source: careless });
    expect((await requests(registry, hassan)).map(r => r.ref)).toEqual([rref('48102'), rref('48230')]);
    expect((await requests(registry, hillevi)).map(r => r.ref)).toEqual([rref('48190'), rref('48211'), rref('48007')]);
    expect((await errands(registry, mikael)).map(r => r.ref)).toEqual([ref('48211'), ref('48230'), ref('48102')]);
    expect(await requests(registry, ingrid)).toEqual([]);
    expect(await errands(registry, hillevi)).toEqual([]);
  });

  test('two records for one account in POB are nobody: the person is told, and nothing is listed', async () => {
    const { registry, calls, lines } = stack();
    await expect(requests(registry, karin)).rejects.toThrow(AMBIGUOUS);
    // One of the two customer records reported this errand. It is not shown to either.
    await expect(openRequest(registry, karin, '48251')).rejects.toThrow(AMBIGUOUS);
    expect(calls.some(c => c.startsWith('list') || c.startsWith('memo'))).toBe(false);
    expect(lines.map(l => [l.event, l.account, l.outcome])).toEqual([
      ['requests', 'karin', 'ambiguous'],
      ['open-request', 'karin', 'ambiguous'],
    ]);
    // In the role where there is no doubt, nothing is refused: Karin is no handler, so nothing is assigned.
    expect(await errands(registry, karin)).toEqual([]);
  });

  test('says who looked, without a word of what they saw', async () => {
    const { registry, lines } = stack();
    await requests(registry, hillevi);
    await openRequest(registry, hillevi, '48211');
    await expect(openRequest(registry, hassan, '48211')).rejects.toThrow();
    await errands(registry, mikael);
    await open(registry, mikael, '48211');
    const line = (rest: Line) => ({ at: new Date(at).toISOString(), connector: 'pob', ...rest });
    expect(lines).toEqual([
      line({ event: 'requests', account: 'hillevi', outcome: 'shown', rows: 3 }),
      line({ event: 'open-request', account: 'hillevi', case: '48211', outcome: 'shown' }),
      line({ event: 'open-request', account: 'hassan', case: '48211', outcome: 'not-found' }),
      line({ event: 'list', account: 'mikael', view: 'assigned', outcome: 'shown', rows: 3 }),
      line({ event: 'open', account: 'mikael', case: '48211', outcome: 'shown' }),
    ]);
  });

  test('refuses a ref that is not this connector’s, a view it does not have and an input to the requests', async () => {
    const { registry } = stack();
    const run = (name: string, input: Record<string, unknown>) => registry.run(hillevi, name, input, as('hillevi'));
    await expect(run('pob.errand', { ref: 'errand:sm:0000:IK:1' })).rejects.toThrow();
    await expect(run('pob.errand', { ref: 'errand:pob:../48211' })).rejects.toThrow();
    // An errand's ref does not open a request, nor the other way round.
    await expect(run('pob.request', { ref: 'errand:pob:48211' })).rejects.toThrow();
    await expect(run('pob.errand', { ref: 'request:pob:48211' })).rejects.toThrow();
    await expect(run('pob.request', { ref: 'request:pob:../48211' })).rejects.toThrow();
    await expect(run('pob.errands', { view: 'everything' })).rejects.toThrow();
    await expect(run('pob.requests', { view: 'assigned' })).rejects.toThrow();
  });

  test('an outage, or an answer that was cut, is unavailable and never a short list', async () => {
    const fixture = createFixtureCases({ now });
    const down: CaseSource = {
      ...fixture,
      list: async () => {
        throw new SourceUnavailable('down');
      },
      one: async () => {
        throw new Error('socket hang up');
      },
    };
    const outage = stack({ source: down });
    await expect(requests(outage.registry, hillevi)).rejects.toThrow('IT-supporten svarar inte just nu.');
    await expect(errands(outage.registry, mikael)).rejects.toThrow('IT-supporten svarar inte just nu.');
    await expect(openRequest(outage.registry, hillevi, '48211')).rejects.toThrow('IT-supporten svarar inte just nu.');

    const cut: CaseSource = {
      ...fixture,
      list: async (who, relation, types) => ({ ...(await fixture.list(who, relation, types)), complete: false }),
    };
    await expect(requests(stack({ source: cut }).registry, hillevi)).rejects.toThrow(
      'IT-supporten svarar inte just nu.',
    );
    await expect(errands(stack({ source: cut }).registry, mikael)).rejects.toThrow('IT-supporten svarar inte just nu.');
  });

  test('the operator configures the name, the link out and what a status means; none of it decides access', async () => {
    const { registry } = stack({
      sourceLabel: 'Servicedesk IT',
      caseLink: 'https://pob.example/case/{id}?n={number}',
      statusKinds: { Registered: 'new', InProgress: 'waiting-reporter', WaitingCustomer: 'open', Solved: 'closed' },
    });
    const rows = await requests(registry, hillevi);
    expect(rows.map(r => [r.ref, r.state, r.link])).toEqual([
      [rref('48211'), 'waiting-on-me', 'https://pob.example/case/48211?n=IT-48211'],
      [rref('48190'), 'active', 'https://pob.example/case/48190?n=IT-48190'],
      [rref('48007'), 'closed', 'https://pob.example/case/48007?n=IT-48007'],
    ]);
    expect(checkContract(RequestsOutputSchema, { rows })).toBe(true);
    await expect(openRequest(registry, hassan, '48211')).rejects.toThrow(NOT_FOUND);
    // A link that is not an address is no link.
    const odd = stack({ caseLink: 'javascript:alert(1)//{id}' });
    expect((await requests(odd.registry, hillevi)).every(r => r.link === undefined)).toBe(true);
    expect((await errands(odd.registry, mikael)).every(r => r.link === undefined)).toBe(true);
  });

  test('keeps the person lookup for five minutes, per account, and nothing of an errand', async () => {
    let clock = at;
    const { registry, calls } = stack({ now: () => clock, source: createFixtureCases({ now: () => clock }) });
    await requests(registry, hillevi);
    await requests(registry, hillevi);
    await requests(registry, hassan);
    expect(calls.filter(c => c.startsWith('person'))).toEqual(['person hillevi', 'person hassan']);
    expect(calls.filter(c => c.startsWith('list'))).toHaveLength(3);
    clock += 301_000;
    // The token is from the first minute; a new one is issued for the later call.
    const later = { delegate: async () => idp.token('hillevi', { exp: clock / 1000 + 60 }) };
    await registry.run(hillevi, 'pob.requests', {}, later);
    expect(calls.filter(c => c === 'person hillevi')).toHaveLength(2);
  });
});

describe('who the person is', () => {
  const refusedWith = async (context: object, who: Actor = hillevi) => {
    const { registry, calls } = stack();
    const outcome = await registry.run(who, 'pob.requests', {}, context).then(
      () => 'answered',
      (error: Error) => error.message,
    );
    // Whatever the reason, POB was never asked.
    expect(calls).toEqual([]);
    return outcome;
  };

  test('without the person’s token nothing is asked of POB', async () => {
    expect(await refusedWith({ delegate: async () => undefined })).toBe(
      'Din inloggning kan inte styrkas mot IT-supporten i den här sessionen.',
    );
  });

  test('a token for another audience, an expired one, another issuer’s or another key’s is refused', async () => {
    for (const claims of [{ aud: 'supportmanagement' }, { exp: at / 1000 - 1 }, { iss: 'https://elsewhere.test' }])
      expect(await refusedWith(as('hillevi', claims))).toBe(REFUSED);
    // Signed by another key under the same key id.
    expect(await refusedWith({ delegate: async () => stranger.token('hillevi') })).toBe(REFUSED);
    // Unsigned, or with a header that asks for no signature at all.
    const [h, p] = (await idp.token('hillevi')).split('.');
    const none = Buffer.from(JSON.stringify({ alg: 'none', kid: 'idp-1' })).toString('base64url');
    for (const forged of [`${h}.${p}.`, `${none}.${p}.`, 'not-a-token'])
      expect(await refusedWith({ delegate: async () => forged })).toBe(REFUSED);
    // A token with several audiences is accepted when this one is among them.
    const { registry } = stack();
    expect(await registry.run(hillevi, 'pob.requests', {}, as('hillevi', { aud: ['account', 'pob'] }))).toBeDefined();
  });

  test('a token for one person is never used under another person’s session', async () => {
    expect(await refusedWith(as('hassan'), hillevi)).toBe(
      'Inloggningen mot IT-supporten hör till en annan person än den som använder Clew.',
    );
    // Without a user name in Clew there is nobody to compare the token with.
    const nameless: Actor = { ...hillevi, userName: undefined };
    expect(await refusedWith(as('hillevi'), nameless)).toBe(
      'Ditt konto i Clew saknar användarnamn, så din inloggning kan inte styrkas mot IT-supporten.',
    );
    // The comparison is without regard to case.
    const { registry } = stack();
    expect((await registry.run<{ rows: Row[] }>(hillevi, 'pob.requests', {}, as('Hillevi'))).rows).toHaveLength(3);
  });

  test('an account that could change the question to POB never reaches it', async () => {
    for (const account of ['hillevi;Id>0', "hillevi' or '1'='1", 'hillevi&limit=10000', '', 'a'.repeat(129)])
      expect(await refusedWith(as(account), { ...hillevi, userName: account })).toBe(REFUSED);
  });

  test('when the provider’s keys cannot be fetched the system is unavailable, not refusing', async () => {
    const { registry, calls } = stack({
      identity: {
        issuer,
        jwksUrl: 'https://idp.test/certs',
        fetch: (async () => new Response('', { status: 503 })) as never,
      },
    });
    await expect(requests(registry, hillevi)).rejects.toThrow('IT-supporten svarar inte just nu.');
    expect(calls).toEqual([]);
  });

  test('the keys come from the configured address only, over https, and are kept between requests', async () => {
    const fetched: string[] = [];
    const keys = await idp.jwks();
    const fetchKeys = (async (url: string) => (fetched.push(url), Response.json(keys))) as never;
    const { registry } = stack({ identity: { issuer, jwksUrl: 'https://idp.test/certs', fetch: fetchKeys } });
    await requests(registry, hillevi);
    await requests(registry, hassan);
    expect(fetched).toEqual(['https://idp.test/certs']);
    // Over plain http only for a host the operator has listed for development.
    const plain = stack({ identity: { issuer, jwksUrl: 'http://idp.test/certs', fetch: fetchKeys } });
    await expect(requests(plain.registry, hillevi)).rejects.toThrow('IT-supporten svarar inte just nu.');
    const listed = stack({
      identity: { issuer, jwksUrl: 'http://idp.test/certs', insecureHosts: ['idp.test'], fetch: fetchKeys },
    });
    expect(await requests(listed.registry, hillevi)).toHaveLength(3);
  });

  test('the token check on its own: the algorithm is chosen here, and a private key in the key set is not a key', async () => {
    const keys = (await idp.jwks()) as { keys: Array<Record<string, unknown>> };
    const token = await idp.token('hillevi');
    const check = (jwks: unknown, over: object = {}) =>
      verifyPersonToken(token, jwks, { issuer, audience: 'pob', now: at, ...over });
    expect(check(keys)?.preferred_username).toBe('hillevi');
    expect(check({ keys: [] })).toBeNull();
    expect(check({ keys: [{ ...keys.keys[0], d: 'private' }] })).toBeNull();
    expect(check({ keys: [keys.keys[0], keys.keys[0]] })).toBeNull();
    expect(check(keys, { audience: 'sm' })).toBeNull();
    expect(check(keys, { now: at + 61_000 })).toBeNull();
  });
});

describe('the rule for which errands are a person’s', () => {
  const errand = (over: Partial<SourceCase> = {}): SourceCase => ({
    id: '1',
    number: 'IT-1',
    caseType: 'Incident',
    type: 'Incident',
    status: 'InProgress',
    statusLabel: 'Pågår',
    closed: false,
    since: ago(1),
    ...over,
  });
  const handler = { handler: { id: 'u-1', groups: ['g-1'] } };
  const reporter = { customer: { id: 'c-1' } };

  test('handler, unassigned in their group, or reporter: nothing else', () => {
    expect(holds(errand({ handlerId: 'u-1' }), handler, 'assigned')).toBe(true);
    expect(holds(errand({ handlerId: 'u-2' }), handler, 'assigned')).toBe(false);
    expect(holds(errand({ groupId: 'g-1' }), handler, 'group')).toBe(true);
    // Assigned to a colleague in the same group: not the group's queue, and not this person's.
    expect(holds(errand({ groupId: 'g-1', handlerId: 'u-2' }), handler, 'group')).toBe(false);
    expect(holds(errand({ groupId: 'g-2' }), handler, 'group')).toBe(false);
    expect(holds(errand({ customerId: 'c-1' }), reporter, 'reported')).toBe(true);
    expect(holds(errand({ customerId: 'c-2' }), reporter, 'reported')).toBe(false);
    // An errand with no handler, group or reporter is nobody's, also for a person with no record at all.
    for (const relation of ['assigned', 'group', 'reported'] as const)
      expect(holds(errand(), {}, relation)).toBe(false);
    expect(relationOf(errand({ handlerId: 'u-1', customerId: 'c-1' }), { ...handler, ...reporter })).toBe('assigned');
    expect(relationOf(errand({ handlerId: 'u-2', groupId: 'g-1' }), handler)).toBeUndefined();
  });

  test('only a record that matched exactly once is the person', () => {
    expect(resolved({ handler: { status: 'ambiguous' }, customer: { status: 'one', id: 'c-1' } })).toEqual(reporter);
    expect(resolved({ handler: { status: 'one', id: 'u-1', groups: ['g-1'] }, customer: { status: 'none' } })).toEqual(
      handler,
    );
    expect(resolved({ handler: { status: 'none' }, customer: { status: 'ambiguous' } })).toEqual({});
  });

  test('a memo is answered as text, whatever markup POB stored', () => {
    expect(plainText({ extension: '.txt', text: ' Rad ett <b>som den är</b> ' })).toBe('Rad ett <b>som den är</b>');
    expect(
      plainText({
        extension: '.html',
        text: '<div>Hej<br>då</div><script>alert(1)</script><p>1 &lt; 2 &amp; 3&nbsp;&#8364;</p>',
      }),
    ).toBe('Hej\ndå\n1 < 2 & 3 €');
    expect(plainText({ extension: '.html', text: '<p></p>' })).toBeUndefined();
    expect(plainText(null)).toBeUndefined();
  });
});

describe('the configuration', () => {
  const env = {
    CLEW_CONNECTOR_SECRET: secret,
    POB_ADAPTER: 'fixture',
    POB_IDP_ISSUER: issuer,
    POB_IDP_JWKS_URL: 'https://idp.test/certs',
  };

  test('reads the made-up POB’s settings and what an operator sets', () => {
    expect(readConfig(env)).toMatchObject({
      adapter: 'fixture',
      port: 4055,
      audience: 'pob',
      accountClaim: 'preferred_username',
      caseTypes: ['Incident', 'ServiceRequest'],
      problemMemo: 'Problem',
      identity: { issuer, jwksUrl: 'https://idp.test/certs' },
    });
    expect(
      readConfig({
        ...env,
        POB_CASE_TYPES: '["Incident"]',
        POB_STATUS_KINDS: '{"Open":"open"}',
        POB_SOURCE_LABEL: 'Servicedesk',
        POB_CASE_LINK: 'https://pob.example/{id}',
      }),
    ).toMatchObject({ caseTypes: ['Incident'], statusKinds: { Open: 'open' }, sourceLabel: 'Servicedesk' });
  });

  test('a wrong setting stops the start and names its variable', () => {
    const bad = (over: Record<string, string | undefined>) => () => readConfig({ ...env, ...over });
    expect(bad({ POB_IDP_ISSUER: undefined })).toThrow('POB_IDP_ISSUER');
    expect(bad({ POB_IDP_JWKS_URL: undefined })).toThrow('POB_IDP_JWKS_URL');
    expect(bad({ POB_IDP_JWKS_URL: 'http://idp.test/certs' })).toThrow('POB_INSECURE_HTTP_HOSTS');
    expect(bad({ POB_IDP_JWKS_URL: 'http://idp.test/certs', POB_INSECURE_HTTP_HOSTS: 'idp.test' })).not.toThrow();
    expect(bad({ POB_STATUS_KINDS: '{"Open":"sometimes"}' })).toThrow('POB_STATUS_KINDS');
    expect(bad({ POB_CASE_TYPES: '[]' })).toThrow('POB_CASE_TYPES');
    expect(bad({ POB_CASE_LINK: 'https://pob.example/case' })).toThrow('POB_CASE_LINK');
    expect(bad({ POB_AUDIENCE: 'not an audience' })).toThrow('POB_AUDIENCE');
    // Writes are not built: asking for them is an error, not a silent read-only connector.
    expect(bad({ POB_WRITES: 'reply' })).toThrow('POB_WRITES');
    expect(bad({ POB_CREATE: '{"caseType":"Incident"}' })).toThrow('POB_CREATE');
    expect(bad({ POB_ADAPTER: 'soap' })).toThrow('POB_ADAPTER');
  });

  test('the adapter is always named, and the made-up POB never starts beside a POB address or credential (CS-L7)', () => {
    const bad = (over: Record<string, string | undefined>) => () => readConfig({ ...env, ...over });
    expect(bad({ POB_ADAPTER: undefined })).toThrow('POB_ADAPTER is not set');
    expect(bad({ POB_ADAPTER: ' ' })).toThrow('POB_ADAPTER is not set');
    // An address and a credential without the adapter named used to start the made-up POB.
    expect(bad({ POB_ADAPTER: undefined, POB_URL: 'https://pob.test/api', POB_USER: 'clew' })).toThrow(
      'POB_ADAPTER is not set',
    );
    expect(bad({ POB_URL: 'https://pob.test/api', POB_AUTHORIZATION: 'Bearer x' })).toThrow(
      'POB_ADAPTER is "fixture" but POB_URL and POB_AUTHORIZATION are set',
    );
    expect(bad({ POB_PASSWORD_FILE: '/run/secrets/pob' })).toThrow('but POB_PASSWORD_FILE is set');
    // What compose passes for an unset variable is the empty string.
    expect(readConfig({ ...env, POB_URL: '', POB_USER: '', POB_PASSWORD: '' })).toMatchObject({ adapter: 'fixture' });
  });

  test('the fault report is switched on by the installation, and only on the made-up POB', () => {
    expect(readConfig(env)).toMatchObject({ writes: [] });
    expect(readConfig({ ...env, POB_WRITES: 'create', POB_URGENT_NOTE: 'Ring vid akuta fel.' })).toMatchObject({
      writes: ['create'],
      create: { caseType: 'Incident', category: 'Dator', groupId: 'g-servicedesk' },
      urgentNote: 'Ring vid akuta fel.',
    });
    // The draft adapter for POB's own API only reads.
    expect(() => readConfig({ ...env, POB_ADAPTER: 'api', POB_WRITES: 'create' })).toThrow('POB_WRITES');
  });

  test('the api adapter needs an address, a credential, the two match fields and this POB’s own statuses and case types', () => {
    const api = {
      ...env,
      POB_ADAPTER: 'api',
      POB_URL: 'https://pob.test/pobg6/api',
      POB_USER: 'clew',
      POB_PASSWORD: 'made-up',
      POB_USER_MATCH: 'LoginName',
      POB_CUSTOMER_MATCH: 'LoginName',
      POB_STATUS_KINDS: '{"Open":"open","Closed":"closed"}',
      POB_CASE_TYPES: '["Incident"]',
    };
    const read = readConfig(api);
    expect(read).toMatchObject({
      adapter: 'api',
      statusKinds: { Open: 'open', Closed: 'closed' },
      caseTypes: ['Incident'],
      pob: {
        url: 'https://pob.test/pobg6/api',
        authorization: 'Basic ' + Buffer.from('clew:made-up').toString('base64'),
        userMatch: 'LoginName',
        customerMatch: 'LoginName',
        fields: DEFAULT_FIELDS,
        timeZone: 'Europe/Stockholm',
        listLimit: 500,
        startCheck: 'warn',
      },
    });
    // A POB that takes a ready key gets the header as it is; a field this POB names otherwise is set by name.
    const keyed = readConfig({
      ...api,
      POB_USER: undefined,
      POB_PASSWORD: undefined,
      POB_AUTHORIZATION: 'made-up-key',
      POB_FIELDS: '{"changed":"LastChangeDate","closed":"CloseDate"}',
      POB_START_CHECK: 'strict',
    });
    expect(keyed.pob).toMatchObject({
      authorization: 'made-up-key',
      fields: { changed: 'LastChangeDate', closed: 'CloseDate', handler: 'Responsible' },
      startCheck: 'strict',
    });

    const bad = (over: Record<string, string | undefined>) => () => readConfig({ ...api, ...over });
    expect(bad({ POB_URL: undefined })).toThrow('POB_URL');
    expect(bad({ POB_URL: 'http://pob.test/api' })).toThrow('POB_URL');
    expect(bad({ POB_PASSWORD: undefined })).toThrow('credential');
    expect(bad({ POB_USER_MATCH: undefined })).toThrow('POB_USER_MATCH');
    expect(bad({ POB_CUSTOMER_MATCH: undefined })).toThrow('POB_CUSTOMER_MATCH');
    // The made-up POB's statuses and case types are never a default for a real one.
    expect(bad({ POB_STATUS_KINDS: undefined })).toThrow('POB_STATUS_KINDS');
    expect(bad({ POB_CASE_TYPES: undefined })).toThrow('POB_CASE_TYPES');
    expect(bad({ POB_FIELDS: '{"owner":"X"}' })).toThrow('POB_FIELDS');
    expect(bad({ POB_FIELDS: '{"handler":"Responsible; drop"}' })).toThrow('POB_FIELDS');
    expect(bad({ POB_TIMEZONE: 'Mars/Olympus' })).toThrow('POB_TIMEZONE');
    expect(bad({ POB_LIST_LIMIT: '0' })).toThrow('POB_LIST_LIMIT');
    expect(bad({ POB_START_CHECK: 'maybe' })).toThrow('POB_START_CHECK');
  });
});

/**
 * The draft adapter for POB's own API, against answers in the shape it assumes (connectors/pob/README.md, "The API
 * adapter's assumptions"). These tests cannot say that POB answers this way. They say what the adapter does when it
 * does, and that when it does not, the adapter fails as an outage and never as a wrong or a short list.
 */
describe('the draft adapter for POB’s API', () => {
  const pobRef = (type: string, id: string, name?: string) => ({
    Type: type,
    Data: { Id: id, ...(name ? { Description: name } : {}) },
  });
  const pobCase = (id: number, data: Record<string, unknown> = {}) => ({
    Type: 'Case',
    Links: [],
    Data: {
      Id: id,
      Description: 'Datorn startar inte',
      CaseStatus: 'InProgress',
      CaseType: pobRef('CaseType', 'Incident', 'Incident'),
      CaseCategory: pobRef('CaseCategory', 'PC', 'Dator'),
      ResponsibleGroup: pobRef('UserGroup', 'g-1', 'Servicedesk'),
      Modified: '2026-11-08T10:00:00',
      Created: '2026-11-07T08:30:00',
      ...data,
    },
  });
  const user = (id: string, account: string, groups: string[] = []) => ({
    Type: 'User',
    Data: { Id: id, LoginName: account, UserGroups: groups.map(g => pobRef('UserGroup', g)) },
  });
  const customer = (id: string, account: string) => ({ Type: 'Customer', Data: { Id: id, LoginName: account } });

  type Call = { key: string; method: string; headers: Record<string, string> };
  function pobApi(answers: Record<string, unknown>, options: Parameters<typeof createPobCases>[0] = {}) {
    const calls: Call[] = [];
    const fetchPob = (async (address: string, init?: RequestInit) => {
      const url = new URL(address);
      const query = decodeURIComponent(url.searchParams.toString());
      const key = url.pathname.replace('/pobg6/api', '') + (query ? '?' + query : '');
      calls.push({
        key,
        method: init?.method ?? 'GET',
        headers: Object.fromEntries(new Headers(init?.headers).entries()),
      });
      const answer = answers[key];
      if (answer === undefined) return new Response('', { status: 404 });
      if (typeof answer === 'number') return new Response('POB says: SQL error near Customer', { status: answer });
      return Response.json(answer);
    }) as never;
    const source = createPobCases({
      url: 'https://pob.test/pobg6/api',
      authorization: 'Basic bWFkZS11cA==',
      userMatch: 'LoginName',
      customerMatch: 'LoginName',
      fields: fieldMap({ userGroups: 'UserGroups' }),
      fetch: fetchPob,
      now,
      ...options,
    });
    return { source, calls };
  }
  const who = (account: string) => ({
    [`/user?Filter=LoginName=${account}&limit=5`]: [] as unknown[],
    [`/customer?Filter=LoginName=${account}&limit=5`]: [] as unknown[],
  });

  test('finds a person by their account, exactly once, and compares the record again itself', async () => {
    const { source, calls } = pobApi({
      '/user?Filter=LoginName=mikael&limit=5': [user('u-1', 'Mikael', ['g-1', 'g-2'])],
      '/customer?Filter=LoginName=mikael&limit=5': [customer('c-9', 'mikael')],
      ...who('ingrid'),
      // Two customer records for one account.
      '/user?Filter=LoginName=karin&limit=5': [],
      '/customer?Filter=LoginName=karin&limit=5': [customer('c-1', 'karin'), customer('c-2', 'KARIN')],
      // A POB that matches loosely, or ignores the filter: the records that are not this account are not this person.
      '/user?Filter=LoginName=hill&limit=5': [user('u-7', 'hillevi'), user('u-8', 'hillary')],
      '/customer?Filter=LoginName=hill&limit=5': [customer('c-7', 'hillevi')],
    });
    expect(await source.person('mikael')).toEqual({
      handler: { status: 'one', id: 'u-1', groups: ['g-1', 'g-2'] },
      customer: { status: 'one', id: 'c-9' },
    });
    expect(await source.person('ingrid')).toEqual({ handler: { status: 'none' }, customer: { status: 'none' } });
    expect((await source.person('karin')).customer).toEqual({ status: 'ambiguous' });
    expect(await source.person('hill')).toEqual({ handler: { status: 'none' }, customer: { status: 'none' } });
    // Every call is a GET with the credential, and nothing else is ever sent.
    for (const call of calls)
      expect([call.method, call.headers.authorization, call.headers.accept]).toEqual([
        'GET',
        'Basic bWFkZS11cA==',
        'application/json',
      ]);
  });

  test('a record that cannot be compared, and an account that cannot stand in a filter, are an outage', async () => {
    const { source, calls } = pobApi({
      '/user?Filter=LoginName=hassan&limit=5': [{ Type: 'User', Data: { Id: 'u-3' } }],
      '/customer?Filter=LoginName=hassan&limit=5': [],
    });
    await expect(source.person('hassan')).rejects.toBeInstanceOf(SourceUnavailable);
    calls.length = 0;
    await expect(source.person('hassan;Id>0')).rejects.toBeInstanceOf(SourceUnavailable);
    expect(calls).toEqual([]);
  });

  test('asks one condition per question and reads an errand from POB’s envelope', async () => {
    const { source, calls } = pobApi({
      '/case?Filter=Contact.Customer=c-9&limit=501': [
        pobCase(48211, { 'Contact.Customer': pobRef('Customer', 'c-9'), Responsible: pobRef('User', 'u-1') }),
      ],
      '/case?Filter=Responsible=u-1&limit=501': [pobCase(48102, { Responsible: pobRef('User', 'u-1') })],
      '/case?Filter=ResponsibleGroup=g-1&limit=501': [pobCase(48230)],
      '/case?Filter=ResponsibleGroup=g-2&limit=501': [],
    });
    const me = { handler: { id: 'u-1', groups: ['g-1', 'g-2'] }, customer: { id: 'c-9' } };
    const reported = await source.list(me, 'reported', ['Incident']);
    expect(reported).toEqual({
      complete: true,
      cases: [
        {
          id: '48211',
          number: '48211',
          caseType: 'Incident',
          type: 'Incident',
          category: 'Dator',
          status: 'InProgress',
          statusLabel: 'InProgress',
          closed: false,
          handlerId: 'u-1',
          groupId: 'g-1',
          group: 'Servicedesk',
          customerId: 'c-9',
          title: 'Datorn startar inte',
          // Written without a zone; read in the installation's, Swedish winter time here.
          since: '2026-11-08T09:00:00.000Z',
          created: '2026-11-07T07:30:00.000Z',
        },
      ],
    });
    expect((await source.list(me, 'assigned', ['Incident'])).cases.map(c => (c as SourceCase).id)).toEqual(['48102']);
    expect((await source.list(me, 'group', ['Incident'])).cases.map(c => (c as SourceCase).id)).toEqual(['48230']);
    expect(calls.map(c => c.key)).toEqual([
      '/case?Filter=Contact.Customer=c-9&limit=501',
      '/case?Filter=Responsible=u-1&limit=501',
      '/case?Filter=ResponsibleGroup=g-1&limit=501',
      '/case?Filter=ResponsibleGroup=g-2&limit=501',
    ]);
    // A person with no record in a role is not asked about: there is no question to put.
    calls.length = 0;
    expect(await source.list({}, 'reported', ['Incident'])).toEqual({ cases: [], complete: true });
    expect(calls).toEqual([]);
  });

  test('an answer that was cut says so, and one that cannot be read is an outage, never a shorter list', async () => {
    const me = { customer: { id: 'c-9' } };
    const three = [1, 2, 3].map(n => pobCase(n, { 'Contact.Customer': pobRef('Customer', 'c-9') }));
    const cut = pobApi({ '/case?Filter=Contact.Customer=c-9&limit=3': three }, { listLimit: 2 });
    expect((await cut.source.list(me, 'reported', [])).complete).toBe(false);

    const key = '/case?Filter=Contact.Customer=c-9&limit=501';
    for (const answer of [
      { rows: three }, // not a list
      [pobCase(1, { Modified: undefined })], // an errand without a time
      [pobCase(1, { Created: undefined })], // without the time it was reported, where a field for it is configured
      [pobCase(1, { CaseStatus: undefined })], // without a status
      [{ Type: 'Case' }], // without anything
      500,
    ])
      await expect(pobApi({ [key]: answer }).source.list(me, 'reported', [])).rejects.toBeInstanceOf(SourceUnavailable);
    // POB's own error text goes no further than the adapter.
    const failure = await pobApi({ [key]: 500 })
      .source.list(me, 'reported', [])
      .catch((e: Error) => e.message);
    expect(failure).not.toContain('SQL');
  });

  test('one errand by its id, its memo of one type, and an errand that does not exist', async () => {
    const { source, calls } = pobApi({
      '/case/48211': pobCase(48211, { CaseStatus: pobRef('CaseStatus', 'Solved', 'Löst') }),
      '/case/48211/memo?type=Problem&scope=all': {
        Type: 'Case',
        Memo: { Problem: { Memo: '<p>Skärmen är svart.</p>', Extension: '.html', Style: 2 } },
      },
    });
    expect(await source.one('48211')).toMatchObject({ id: '48211', status: 'Solved', statusLabel: 'Löst' });
    expect(await source.one('99999')).toBeNull();
    expect(await source.memo('48211', 'Problem')).toEqual({ text: '<p>Skärmen är svart.</p>', extension: '.html' });
    expect(await source.memo('48211', 'CaseInternalNotesCustom')).toBeNull();
    expect(calls.every(c => c.method === 'GET')).toBe(true);
  });

  test('a credential POB refuses is not tried again at once', async () => {
    let clock = at;
    const { source, calls } = pobApi({ '/case/1': 401, '/case/2': pobCase(2) }, { now: () => clock });
    await expect(source.one('1')).rejects.toBeInstanceOf(SourceUnavailable);
    // Within the wait nothing is sent, also for an errand POB would have answered.
    await expect(source.one('2')).rejects.toBeInstanceOf(SourceUnavailable);
    expect(calls.map(c => c.key)).toEqual(['/case/1']);
    clock += 31_000;
    expect(await source.one('2')).toMatchObject({ id: '2' });
  });

  test('asks POB which fields it has, and names the configured ones it does not find', async () => {
    // The shape of POB's description is not known, so any key or string in it counts as a field it names.
    const described = {
      Name: 'Case',
      Fields: [
        { Name: 'Id' },
        { Name: 'Description' },
        { Name: 'CaseStatus' },
        { Name: 'CaseType' },
        { Name: 'CaseCategory' },
        { Name: 'Responsible' },
        { Name: 'ResponsibleGroup' },
        { Name: 'Contact.Customer' },
        { Name: 'LastChangeDate' },
      ],
    };
    expect(await pobApi({ '/entity/case': described }).source.check()).toEqual({
      described: true,
      missing: ['changed (Modified)', 'created (Created)'],
    });
    // A POB with no field for when an errand was reported: the installation says so, and it is not looked for.
    const renamed = pobApi(
      { '/entity/case': described },
      { fields: fieldMap({ changed: 'LastChangeDate', created: '' }) },
    );
    expect(await renamed.source.check()).toEqual({ described: true, missing: [] });
    expect(await pobApi({}).source.check()).toEqual({ described: false, missing: [] });
  });

  test('the field names are a table an installation may change, and nothing more', () => {
    expect(fieldMap()).toEqual(DEFAULT_FIELDS);
    expect(fieldMap({ handler: 'ResponsibleUserId', closed: 'CloseDate' })).toMatchObject({
      handler: 'ResponsibleUserId',
      closed: 'CloseDate',
      customer: 'Contact.Customer',
    });
    expect(fieldMap({ userGroups: '' }).userGroups).toBe('');
    expect(fieldMap({ created: '' }).created).toBe('');
    expect(() => fieldMap({ owner: 'Responsible' })).toThrow('owner');
    expect(() => fieldMap({ handler: '' })).toThrow('handler');
    expect(() => fieldMap({ handler: 'Responsible eq 1' })).toThrow('handler');
  });

  test('a time without a zone is read in the installation’s zone, summer and winter', () => {
    expect(instantIn('2026-11-08T10:00:00', 'Europe/Stockholm')).toBe('2026-11-08T09:00:00.000Z');
    expect(instantIn('2026-07-01 10:00', 'Europe/Stockholm')).toBe('2026-07-01T08:00:00.000Z');
    expect(instantIn('2026-11-08T10:00:00Z', 'Europe/Stockholm')).toBe('2026-11-08T10:00:00.000Z');
    expect(instantIn('2026-11-08T10:00:00+02:00', 'Europe/Stockholm')).toBe('2026-11-08T08:00:00.000Z');
    expect(instantIn('i går', 'Europe/Stockholm')).toBeUndefined();
    expect(instantIn(undefined, 'Europe/Stockholm')).toBeUndefined();
  });

  test('behind the connector: a POB that ignores every filter still gives each person only their own errands', async () => {
    const everything = [
      pobCase(1, { 'Contact.Customer': pobRef('Customer', 'c-hillevi'), Responsible: pobRef('User', 'u-1') }),
      pobCase(2, { 'Contact.Customer': pobRef('Customer', 'c-hassan') }),
      pobCase(3, { 'Contact.Customer': pobRef('Customer', 'c-hillevi'), CaseStatus: 'Closed' }),
      pobCase(4, {
        'Contact.Customer': pobRef('Customer', 'c-hillevi'),
        CaseType: pobRef('CaseType', 'HRCase', 'HR-ärende'),
      }),
    ];
    const { source } = pobApi({
      '/user?Filter=LoginName=hillevi&limit=5': [],
      '/customer?Filter=LoginName=hillevi&limit=5': [customer('c-hillevi', 'hillevi'), customer('c-hassan', 'hassan')],
      '/case?Filter=Contact.Customer=c-hillevi&limit=501': everything,
      '/case/2': everything[1],
    });
    const { registry } = stack({
      source,
      statusKinds: { InProgress: 'open', Closed: 'closed' },
      caseTypes: ['Incident'],
    });
    const rows = await requests(registry, hillevi);
    expect(rows.map(r => [r.label, r.state, r.status, r.since])).toEqual([
      ['1 · Incident, Dator', 'active', 'InProgress', '2026-11-07T07:30:00.000Z'],
      // Closed the day before: listed as closed.
      ['3 · Incident, Dator', 'closed', 'Closed', '2026-11-07T07:30:00.000Z'],
    ]);
    expect(checkContract(RequestsOutputSchema, { rows })).toBe(true);
    await expect(openRequest(registry, hillevi, '2')).rejects.toThrow(NOT_FOUND);
    // She is no handler in this POB, so no errand is hers to handle.
    expect(await errands(registry, hillevi)).toEqual([]);
  });
});

/**
 * Reporting a fault (the plan's phase 3, on the made-up POB): the assistant prepares, the person sends. The propose
 * writes nothing and answers a work item with one button; the execute behind that button creates the errand, with the
 * reporter taken from the token and from nowhere else.
 */
describe('reporting a fault', () => {
  const fault = { problem: 'Skärmen är svart sedan i morse. Laddaren lyser.', place: 'Sal 12', computer: 'SK-48213' };
  let op = 0;
  const send = (registry: Registry, who: Actor, input: Record<string, unknown>, context: object = {}) =>
    registry.run<{ headline: string; rows: Row[] }>(who, 'pob.createCase', input, {
      operationId: 'op-' + ++op,
      ...as(who.userName!),
      ...context,
    });

  test('is declared only when the installation has switched it on: a propose the model may call, an execute it may not', () => {
    const off = parseManifest(createManifest(), 'pob');
    expect(off.capabilities.map(c => c.name)).toEqual(['pob.errands', 'pob.errand', 'pob.requests', 'pob.request']);
    const on = parseManifest(createManifest({ writes: ['create'] }), 'pob');
    expect(on.capabilities.map(c => [c.name, c.kind, c.model])).toEqual([
      ['pob.errands', 'read', true],
      ['pob.errand', 'read', false],
      ['pob.requests', 'read', true],
      ['pob.request', 'read', false],
      ['pob.reportFault', 'propose', true],
      ['pob.createCase', 'execute', false],
      ['pob.createEffect', 'read', false],
    ]);
    const create = on.capabilities.find(c => c.name === 'pob.createCase')!;
    expect(create.execution).toEqual({ strategy: 'manual' });
    expect(create.effect).toBe('pob.createEffect');
    expect(create.asks!.map(a => [a.property, a.kind, a.required])).toEqual([
      ['problem', 'long-text', true],
      ['place', 'text', true],
      ['computer', 'text', true],
      ['about', 'choice', false],
      ['otherName', 'text', false],
    ]);
    // Without it the connector answers neither of them.
    expect(stack().pob.manifest).toEqual(createManifest());
  });

  test('the propose writes nothing and answers a work item whose one button is the send', async () => {
    const { registry, calls } = stack({ writes: ['create'], urgentNote: 'Vid akuta fel: ring supporten.' });
    const draft = await registry.run<Record<string, unknown>>(hillevi, 'pob.reportFault', fault, as('hillevi'));
    expect(draft).toEqual({
      topic: 'pob:fault',
      // Filed under Clew's own area for what a person reported (D123).
      area: 'requests',
      title: 'Felanmäl dator',
      summary:
        'Ett utkast till en felanmälan hos IT-supporten. Inget är skickat: fyll i det som saknas och skicka. Vid akuta fel: ring supporten.',
      reason: 'Du bad om att göra en felanmälan',
      items: [],
      // No input on the button: what the person or the assistant fills in are answers to its asks, open to change.
      actions: [
        { id: 'send', label: 'Skicka felanmälan', capability: 'pob.createCase', kind: 'execute', role: 'primary' },
      ],
    });
    expect(registry.draftProblem('pob', draft as never)).toBeUndefined();
    // POB was asked who the person is, and nothing else.
    expect(calls).toEqual(['person hillevi']);
  });

  test('says what will be created, for exactly that input, without creating it', async () => {
    const { registry, calls } = stack({ writes: ['create'] });
    expect(await registry.run(hillevi, 'pob.createEffect', fault, as('hillevi'))).toEqual({
      rows: [
        {
          label: 'Ett ärende skapas hos IT-supporten',
          detail: 'Skärmen är svart sedan i morse. Du står som anmälare. Typ: Incident, Dator.',
        },
      ],
    });
    expect(calls).toEqual(['person hillevi']);
  });

  test('sends the report with the person as reporter, and the new errand is in their list', async () => {
    const { registry, lines } = stack({ writes: ['create'] });
    const result = await send(registry, hillevi, { ...fault, about: 'me' });
    expect(result).toEqual({
      headline: 'Felanmälan är skickad',
      rows: [
        {
          ref: rref('48300'),
          label: 'IT-48300 · Incident, Dator',
          outcome: 'done',
          detail: 'Ärendet IT-48300 är skapat hos IT-supporten med dig som anmälare.',
        },
      ],
    });
    // The new errand is among her requests, as new, reported now.
    expect((await requests(registry, hillevi)).find(r => r.ref === rref('48300'))).toMatchObject({
      state: 'new',
      since: new Date(at).toISOString(),
    });
    expect(await openRequest(registry, hillevi, '48300')).toMatchObject({
      title: 'Skärmen är svart sedan i morse.',
      description: 'Skärmen är svart sedan i morse. Laddaren lyser.\n\nPlats: Sal 12\nDatornamn: SK-48213',
      state: 'new',
    });
    // It is hers alone.
    await expect(openRequest(registry, hassan, '48300')).rejects.toThrow(NOT_FOUND);
    expect(lines.find(l => l.event === 'create')).toMatchObject({
      account: 'hillevi',
      case: '48300',
      outcome: 'created',
    });
    // The log says who created what, and nothing of what was written.
    expect(JSON.stringify(lines)).not.toContain('Skärmen');
  });

  test('a fault reported for someone else says so in the errand, and the reporter is still the person', async () => {
    const { registry } = stack({ writes: ['create'] });
    await expect(send(registry, hassan, { ...fault, about: 'other' })).rejects.toThrow('Ange vem felet gäller.');
    await send(registry, hassan, { ...fault, about: 'other', otherName: 'Karin Holm' });
    const mine = await requests(registry, hassan);
    const made = mine.find(r => r.label === 'IT-48300 · Incident, Dator')!;
    expect((await registry.run<Row>(hassan, 'pob.request', { ref: made.ref }, as('hassan'))).description).toBe(
      'Skärmen är svart sedan i morse. Laddaren lyser.\n\nPlats: Sal 12\nDatornamn: SK-48213\nGäller: Karin Holm (anmält av en annan person)',
    );
  });

  test('a name is never dropped unsaid: it makes the fault someone else’s, or contradicts "my computer"', async () => {
    const { registry } = stack({ writes: ['create'] });
    // The name was filled in and the choice left empty: the errand still says whose computer it is.
    await send(registry, hassan, { ...fault, otherName: 'Karin Holm' });
    const made = (await requests(registry, hassan)).find(r => r.label === 'IT-48300 · Incident, Dator')!;
    expect((await registry.run<Row>(hassan, 'pob.request', { ref: made.ref }, as('hassan'))).description).toContain(
      'Gäller: Karin Holm (anmält av en annan person)',
    );
    // A name with "my computer" chosen is asked about, and nothing is created.
    await expect(send(registry, hassan, { ...fault, about: 'me', otherName: 'Karin Holm' })).rejects.toThrow(
      'Du har valt din egen dator men angett ett namn. Ta bort namnet eller välj någon annans dator.',
    );
    expect((await requests(registry, hassan)).filter(r => String(r.label).startsWith('IT-483'))).toHaveLength(1);
  });

  test('the reporter comes from the token and from nowhere else', async () => {
    const { registry, calls } = stack({ writes: ['create'] });
    // A reporter slipped into the input is not an input at all.
    await expect(send(registry, hassan, { ...fault, customerId: 'c-hillevi' })).rejects.toThrow();
    // A person who is no customer in POB, or who is two, cannot report from here, and nothing is created.
    await expect(send(registry, ingrid, fault)).rejects.toThrow(
      'Du finns inte som anmälare i IT-supporten, så en felanmälan kan inte skickas härifrån.',
    );
    await expect(send(registry, karin, fault)).rejects.toThrow(AMBIGUOUS);
    await expect(registry.run(ingrid, 'pob.reportFault', {}, as('ingrid'))).rejects.toThrow('anmälare');
    // Without the person's token nothing is prepared and nothing is sent.
    await expect(send(registry, hassan, fault, { delegate: async () => undefined })).rejects.toThrow(
      'Din inloggning kan inte styrkas mot IT-supporten i den här sessionen.',
    );
    expect(calls.some(c => c.startsWith('create'))).toBe(false);
  });

  test('what is missing is said in the person’s own language, and the same operation sent twice is one errand', async () => {
    const { registry } = stack({ writes: ['create'] });
    for (const [input, message] of [
      [{ ...fault, problem: '  ' }, 'Beskriv vad som är fel.'],
      [{ ...fault, place: ' ' }, 'Ange var datorn finns.'],
      [{ ...fault, computer: ' ' }, 'Ange datornamnet.'],
    ] as const)
      await expect(send(registry, hillevi, input)).rejects.toThrow(message);
    const first = await send(registry, hillevi, fault, { operationId: 'same' });
    const again = await send(registry, hillevi, fault, { operationId: 'same' });
    expect(again).toEqual(first);
    expect((await requests(registry, hillevi)).filter(r => String(r.label).startsWith('IT-483'))).toHaveLength(1);
  });

  test('a source that cannot create is an outage, never a report that looks sent', async () => {
    const fixture = createFixtureCases({ now });
    const readOnly: CaseSource = { person: fixture.person, list: fixture.list, one: fixture.one, memo: fixture.memo };
    const { registry } = stack({ writes: ['create'], source: readOnly });
    await expect(send(registry, hillevi, fault)).rejects.toThrow('IT-supporten svarar inte just nu.');
  });
});

/**
 * POB in Clew's two combined lists (D89, D123): the same connector is a case system for the one who handles an errand
 * and a service desk for the one who reported it. Each list asks only its own profile, with the person's own token.
 */
describe('POB in Clew’s combined lists', () => {
  function clew() {
    const { registry } = stack();
    const requestList = requestUsecases({
      sources: a => registry.requestSources(a),
      budget: { perSourceMs: 2000, totalMs: 3000 },
    });
    const errandList = errandUsecases({
      sources: a => registry.errandSources(a),
      budget: { perSourceMs: 2000, totalMs: 3000 },
    });
    const errandPart = errandCapabilities(errandList, a => registry.errandSources(a).length > 0);
    const requestPart = requestCapabilities(requestList, a => registry.requestSources(a).length > 0);
    registry.register({
      id: SEARCH_CONNECTOR,
      kind: 'core',
      source: 'Clew',
      areas: [...errandPart.areas, ...requestPart.areas],
      capabilities: [...errandPart.capabilities, ...requestPart.capabilities],
      uses: ['*'],
    });
    return registry;
  }

  test('what a person reported is listed under "Mina beställningar", each row opening as a request in POB', async () => {
    const result = await clew().run<RequestsResult>(hillevi, 'clew.requests', {}, as('hillevi'));
    expect(result.rows.map(r => [r.label, r.state, r.status, r.system, r.view?.capability])).toEqual([
      ['IT-48190 · Beställning, Behörighet', 'Väntar på dig', 'Väntar på användaren', 'IT-supporten', 'pob.request'],
      ['IT-48211 · Incident, Dator', 'Pågår', 'Pågår', 'IT-supporten', 'pob.request'],
      ['IT-48007 · Incident, Nätverk', 'Stängd', 'Löst', 'IT-supporten', 'pob.request'],
    ]);
    expect(result.rows[0]!.view).toMatchObject({ input: { ref: rref('48190') } });
    expect(result.unanswered).toEqual([]);
  });

  test('what a person handles is listed under "Mina ärenden", and neither list holds the other’s rows', async () => {
    const registry = clew();
    const handled = await registry.run<ErrandsResult>(mikael, 'clew.errands', {}, as('mikael'));
    expect(handled.rows.map(r => [r.label, r.view?.capability])).toEqual([
      ['IT-48211 · Incident, Dator', 'pob.errand'],
      ['IT-48230 · Incident, Skrivare', 'pob.errand'],
      ['IT-48102 · Beställning, Mobiltelefon', 'pob.errand'],
    ]);
    // He reported one errand himself: it is his request, and not among what he handles.
    const reported = await registry.run<RequestsResult>(mikael, 'clew.requests', {}, as('mikael'));
    expect(reported.rows.map(r => r.label)).toEqual(['IT-48244 · Incident, Programvara']);
    // A reporter who handles nothing has an empty errand list, which is an answer.
    expect((await registry.run<ErrandsResult>(hillevi, 'clew.errands', {}, as('hillevi'))).rows).toEqual([]);
    // The model is offered the two combined lists, never POB's own reads beside them.
    const tools = registry.tools(hillevi).map(t => t.name);
    expect(tools).toEqual(expect.arrayContaining(['clew.requests', 'clew.errands']));
    expect(tools.some(name => name.startsWith('pob.'))).toBe(false);
  });
});

/**
 * Cards: a request that waits for the person's own answer. The scan is a read like the list, with the person's token
 * and the same check of every errand, so a card can never be about what someone else reported.
 */
describe('a card for a request that waits on the person', () => {
  const scan = (registry: Registry, who: Actor, context: object = as(who.userName!)) =>
    registry.scanOne(who, 'pob', context);

  test('one card per request that waits for the person’s answer, with the row’s words and nothing of the errand’s text', async () => {
    const { registry, lines } = stack();
    const seen = await scan(registry, hillevi);
    expect(seen.observation).toMatchObject({ completeness: 'complete', exhausted: true });
    expect(seen.drafts).toEqual([
      {
        topic: 'pob:request:48190',
        // Filed under Clew's own area for what a person reported (D123).
        area: 'requests',
        title: 'IT-supporten väntar på ditt svar',
        summary: 'IT-48190 · Beställning, Behörighet väntar på dig. Status: Väntar på användaren.',
        reason: 'Din felanmälan eller beställning väntar på ditt svar hos IT-supporten',
        items: [
          {
            ref: rref('48190'),
            label: 'IT-48190 · Beställning, Behörighet',
            detail: 'Väntar på användaren',
            selectable: false,
            selected: false,
          },
        ],
        actions: [
          {
            id: 'show',
            label: 'Visa',
            capability: 'pob.request',
            kind: 'read',
            role: 'primary',
            target: 'panel',
            input: { ref: rref('48190') },
          },
        ],
        // The same work for as long as it waits; when the errand changes, the same work changed.
        occurrences: [{ key: rref('48190'), revision: ago(2), period: 'waiting-on-me' }],
      },
    ]);
    // Her other request waits on the desk, and one is closed: they are in her list and get no card.
    expect(JSON.stringify(seen.drafts)).not.toContain('48211');
    expect(JSON.stringify(seen.drafts)).not.toContain('48007');
    expect(JSON.stringify(seen.drafts)).not.toContain('ekonomisystemet');
    expect(lines.at(-1)).toMatchObject({ event: 'scan', account: 'hillevi', rows: 1 });
  });

  test('a handler’s assigned errands are their work in POB and get no cards; a person with no errand gets none', async () => {
    const { registry } = stack();
    for (const who of [mikael, hassan, ingrid]) {
      const seen = await scan(registry, who);
      expect([who.userName, seen.drafts, seen.observation?.completeness]).toEqual([who.userName, [], 'complete']);
    }
  });

  test('without the person’s token, or with two records for them, the cards Clew has are left as they are', async () => {
    const { registry, calls } = stack();
    const without = await scan(registry, hillevi, { delegate: async () => undefined });
    expect([without.drafts, without.observation?.completeness]).toEqual([[], 'authorization-required']);
    expect(calls).toEqual([]);
    expect((await scan(registry, karin)).observation).toMatchObject({ completeness: 'unavailable', exhausted: false });
    const fixture = createFixtureCases({ now });
    const down: CaseSource = {
      ...fixture,
      list: async () => {
        throw new SourceUnavailable('down');
      },
    };
    expect((await scan(stack({ source: down }).registry, hillevi)).observation).toMatchObject({
      completeness: 'unavailable',
    });
  });

  test('whatever POB answers, a card is only ever about the person’s own request', async () => {
    const fixture = createFixtureCases({ now });
    const everything = async () => {
      const all: unknown[] = [];
      for (const id of ['48211', '48190', '48230', '48102', '48007', '00317', '48244', '48251'])
        all.push(await fixture.one(id));
      return all;
    };
    const careless: CaseSource = { ...fixture, list: async () => ({ cases: await everything(), complete: true }) };
    const { registry } = stack({ source: careless });
    expect((await scan(registry, hillevi)).drafts.map(d => d.topic)).toEqual(['pob:request:48190']);
    expect((await scan(registry, hassan)).drafts).toEqual([]);
  });
});

/**
 * The HTTP listener is reached by anyone who reaches the port, before Clew's signature is checked. Whatever a request
 * holds, the connector answers it and goes on.
 */
describe('the HTTP listener', () => {
  const serve = async (handle: (request: Request) => Promise<Response>, limit?: number) => {
    const unexpected: unknown[] = [];
    const server = createServer(listener(handle, { ...(limit ? { limit } : {}), log: name => unexpected.push(name) }));
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    /** One request written by hand, so that it can be one a well-behaved client would not send. */
    const raw = (text: string) =>
      new Promise<string>((resolve, reject) => {
        const socket = connect(port, '127.0.0.1', () => socket.write(text));
        let answer = '';
        socket.on('data', chunk => (answer += chunk));
        socket.on('end', () => resolve(answer));
        socket.on('error', reject);
      });
    return { raw, unexpected, close: () => new Promise(resolve => server.close(resolve)) };
  };
  const ok = async () => new Response('{"ok":true}', { status: 200, headers: { 'content-type': 'application/json' } });

  test('a request that cannot be read is answered, and the next one is served', async () => {
    const seen: string[] = [];
    const { raw, close } = await serve(async request => {
      seen.push(`${request.method} ${new URL(request.url).pathname} ${await request.text()}`);
      return ok();
    });
    try {
      // A GET with a body: the body is not read, and the request is served.
      expect(
        await raw('GET /clew/manifest HTTP/1.1\r\nHost: connector\r\nContent-Length: 1\r\nConnection: close\r\n\r\nx'),
      ).toStartWith('HTTP/1.1 200');
      // A Host that is no host does not matter: only the path is read.
      expect(await raw('POST /clew/scan HTTP/1.1\r\nHost: a b\r\nConnection: close\r\n\r\n')).toStartWith(
        'HTTP/1.1 200',
      );
      // And the connector still answers.
      expect(
        await raw('POST /clew/scan HTTP/1.1\r\nHost: connector\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{}'),
      ).toStartWith('HTTP/1.1 200');
      expect(seen).toEqual(['GET /clew/manifest ', 'POST /clew/scan ', 'POST /clew/scan {}']);
    } finally {
      await close();
    }
  });

  test('a body over the limit is refused without being kept, and a handler that throws is an answer, not an exit', async () => {
    let calls = 0;
    const { raw, unexpected, close } = await serve(async () => {
      if (++calls === 1) throw new TypeError('with a person’s text in it');
      return ok();
    }, 8);
    try {
      const big = await raw(
        'POST /clew/scan HTTP/1.1\r\nHost: connector\r\nContent-Length: 9\r\nConnection: close\r\n\r\n123456789',
      );
      expect(big).toStartWith('HTTP/1.1 413');
      expect(calls).toBe(0);
      const thrown = await raw('POST /clew/scan HTTP/1.1\r\nHost: connector\r\nConnection: close\r\n\r\n');
      expect(thrown).toStartWith('HTTP/1.1 500');
      expect(thrown).toContain('Tjänsten svarar inte just nu.');
      // Only the error's name is logged.
      expect(unexpected).toEqual(['TypeError']);
      expect(await raw('POST /clew/scan HTTP/1.1\r\nHost: connector\r\nConnection: close\r\n\r\n')).toStartWith(
        'HTTP/1.1 200',
      );
    } finally {
      await close();
    }
  });

  test('a capability name that cannot be decoded matches no assertion, and one that is no capability is not found', async () => {
    const { pob } = stack();
    const url = (name: string) => 'http://connector/clew/capabilities/' + name;
    // The assertion is bound to the capability in the route (D117): a name that cannot be read is bound to nothing,
    // so no assertion matches it and the call is refused before anything is looked up.
    const unreadable = await pob.handle(
      new Request(url('%E0%A4%A'), {
        method: 'POST',
        headers: {
          authorization: 'Bearer ' + (await assertionFor('pob', secret)(hillevi)),
          'x-clew-connector-key': secret,
        },
        body: '{}',
      }),
    );
    expect(unreadable.status).toBe(401);
    const unknown = await pob.handle(
      await signedRequest(url('constructor'), {
        id: 'pob',
        actor: hillevi,
        body: { input: {} },
        key: secret,
        label: secret,
      }),
    );
    expect(unknown.status).toBe(404);
  });
});

describe('what a unit’s agreements cost (D148)', () => {
  const chef: Actor = { ...hillevi, role: 'manager' };
  const ansvar = (value: string) => ({ type: 'ansvar', value });
  type Told = { relation: 'manages' | 'member' | 'below'; identifiers?: Array<{ type: string; value: string }> };
  /**
   * Clew over a directory that says how the person stands to each unit and what the units are known by, and the
   * connector with the cost read switched on. `asked` is every question put to the made-up POB.
   */
  function costs(units: Record<string, Told>, options: Parameters<typeof createConnector>[0] = {}) {
    const lines: Line[] = [],
      asked: string[] = [];
    const base = options.source ?? createFixtureCases({ now });
    const source: CaseSource = {
      ...base,
      person: account => (asked.push('person ' + account), base.person(account)),
      agreements: code => (asked.push('agreements ' + code), base.agreements!(code)),
    };
    const pob = createConnector({
      jwks: testJwks,
      secret,
      identity: { issuer, jwks: idp.jwks },
      now,
      log: line => lines.push(line),
      costs: { identifier: 'ansvar', amountLabel: 'Avtalskostnad' },
      ...options,
      source,
    });
    const registry = new Registry({
      relations: async (_actor, entity, keys, admits) =>
        entity !== 'unit'
          ? []
          : keys.flatMap(key => {
              const unit = units[key];
              return unit && admits.includes(unit.relation)
                ? [
                    {
                      asked: key,
                      key,
                      relation: unit.relation,
                      ...(unit.identifiers ? { identifiers: unit.identifiers } : {}),
                    },
                  ]
                : [];
            }),
    });
    registry.register(
      remoteConnector(parseManifest(pob.manifest, 'pob'), {
        url: 'http://pob-connector',
        key: secret,
        assert: assertionFor('pob', secret),
        fetch: (input, init) => pob.handle(new Request(input, init)),
      }),
    );
    const read = async (who: Actor, keys: string[]) =>
      (await registry.run<{ rows: Row[] }>(who, 'pob.unitCosts', { keys }, as(who.userName!))).rows;
    return { pob, registry, read, asked, lines };
  }
  /** Straight to the connector, past Clew's own narrowing: what the connector does with a body it did not expect. */
  const direct = async (pob: ReturnType<typeof createConnector>, body: unknown, token = true) =>
    pob.handle(
      await signedRequest('http://pob-connector/clew/capabilities/pob.unitCosts', {
        id: 'pob',
        actor: chef,
        body,
        key: secret,
        label: secret,
        ...(token ? { headers: { 'x-clew-delegated-token': await idp.token('hillevi') } } : {}),
      }),
    );

  test('is declared only when the installation names the identifier: a read about a unit, for the one who leads it', () => {
    const names = (manifest: unknown) => parseManifest(manifest, 'pob').capabilities.map(c => c.name);
    expect(names(createManifest())).not.toContain('pob.unitCosts');
    const parsed = parseManifest(
      createManifest({ costs: { identifier: 'ansvar', amountLabel: 'Avtalskostnad' } }),
      'pob',
    );
    const read = parsed.capabilities.find(c => c.name === 'pob.unitCosts')!;
    expect(read).toMatchObject({
      kind: 'read',
      model: false,
      scope: { roles: ['manager'] },
      about: { entity: 'unit' },
      unit: { admits: ['manages'], identifiers: ['ansvar'] },
      view: { kind: 'list', title: 'amount' },
    });
    // Without a field that holds an amount there is no sum to show: the row is a count.
    const counted = parseManifest(createManifest({ costs: { identifier: 'kostnadsställe' } }), 'pob').capabilities.find(
      c => c.name === 'pob.unitCosts',
    )!;
    expect(counted.unit).toEqual({ admits: ['manages'], identifiers: ['kostnadsställe'] });
    expect((counted.view as { title: string; fields: Array<{ key: string }> }).title).toBe('agreements');
    expect((counted.view as { fields: Array<{ key: string }> }).fields.map(f => f.key)).toEqual(['agreements', 'note']);
  });

  test('answers the count and the sum for a unit the person leads, by the code the directory sent, and asks POB for nothing of the person', async () => {
    const { read, asked, lines } = costs({
      'unit-skola': { relation: 'manages', identifiers: [ansvar('11000000'), { type: 'qlik', value: 'ORG-1' }] },
    });
    expect(await read(chef, ['unit-skola'])).toEqual([{ key: 'unit-skola', agreements: 3, amount: 18540.5 }]);
    expect(asked).toEqual(['agreements 11000000']);
    expect(lines).toEqual([
      expect.objectContaining({ event: 'unit-costs', account: 'hillevi', outcome: 'shown', asked: 1, rows: 1 }),
    ]);
    // Nothing of an agreement leaves the connector but the count and the sum: no id, no account.
    expect(JSON.stringify(lines)).not.toContain('sla-');
  });

  test('a unit with two codes is the sum of both, each agreement once, and says so when an agreement has no amount', async () => {
    const { read, asked } = costs({
      'unit-skola': { relation: 'manages', identifiers: [ansvar('11000000'), ansvar('11000100'), ansvar('11000000')] },
    });
    expect(await read(chef, ['unit-skola'])).toEqual([
      {
        key: 'unit-skola',
        agreements: 5,
        amount: 25740.5,
        note: '1 av avtalen saknar belopp och är inte med i summan.',
      },
    ]);
    expect(asked).toEqual(['agreements 11000000', 'agreements 11000100']);
  });

  test('a unit without a code, with another type only, with a code that is none, or with no agreements: no question that could name another unit', async () => {
    const { read, asked } = costs({
      'unit-utan': { relation: 'manages' },
      'unit-annan-typ': { relation: 'manages', identifiers: [{ type: 'qlik', value: '11000000' }] },
      // Too short to be a code: as a prefix it would read as nearly every account.
      'unit-kort': { relation: 'manages', identifiers: [ansvar('11')] },
      'unit-tecken': { relation: 'manages', identifiers: [ansvar('1100%0000'), ansvar('11000000.5750')] },
      'unit-tom': { relation: 'manages', identifiers: [ansvar('55550000')] },
    });
    expect(await read(chef, ['unit-utan', 'unit-annan-typ', 'unit-kort', 'unit-tecken', 'unit-tom'])).toEqual([
      { key: 'unit-tom', agreements: 0 },
    ]);
    expect(asked).toEqual(['agreements 55550000']);
  });

  test('a unit the person only belongs to, one they follow from above and one Clew does not know are never asked about', async () => {
    const { read, asked } = costs({
      'unit-skola': { relation: 'member', identifiers: [ansvar('11000000')] },
      'unit-under': { relation: 'below', identifiers: [ansvar('11000100')] },
    });
    expect(await read(chef, ['unit-skola', 'unit-under', 'unit-okand'])).toEqual([]);
    expect(asked).toEqual([]);
    // And nobody without a manager's role reaches the read at all.
    await expect(read(hillevi, ['unit-skola'])).rejects.toThrow();
  });

  test('the connector does not rest on Clew sending only what it admits: a body that says another relation, none, or nothing about units is answered with no row', async () => {
    const { pob, asked } = costs({});
    const identifiers = { 'unit-skola': [ansvar('11000000')] };
    const bodies = [
      {
        input: { keys: ['unit-skola'] },
        about: { entity: 'unit', relations: { 'unit-skola': 'member' }, identifiers },
      },
      { input: { keys: ['unit-skola'] }, about: { entity: 'unit', relations: { 'unit-skola': 'below' }, identifiers } },
      { input: { keys: ['unit-skola'] }, about: { entity: 'unit', relations: {}, identifiers } },
      {
        input: { keys: ['unit-skola'] },
        about: { entity: 'person', relations: { 'unit-skola': 'manages' }, identifiers },
      },
      { input: { keys: ['unit-skola'] }, about: { entity: 'unit', identifiers } },
      { input: { keys: ['unit-skola'] } },
      // The relation of another unit, and a key that is a property of every object.
      {
        input: { keys: ['unit-skola', 'constructor'] },
        about: { entity: 'unit', relations: { 'unit-b': 'manages' }, identifiers },
      },
      { input: { keys: 'unit-skola' }, about: { entity: 'unit', relations: { 'unit-skola': 'manages' }, identifiers } },
    ];
    for (const body of bodies) {
      const answer = await direct(pob, body);
      expect(answer.status).toBe(200);
      expect(await answer.json()).toEqual({ output: { rows: [] } });
    }
    expect(asked).toEqual([]);
    // The body Clew sends for a unit the person leads is answered, so the refusals above are about the body.
    const led = await direct(pob, {
      input: { keys: ['unit-skola'] },
      about: { entity: 'unit', relations: { 'unit-skola': 'manages' }, identifiers },
    });
    expect(await led.json()).toEqual({ output: { rows: [{ key: 'unit-skola', agreements: 3, amount: 18540.5 }] } });
  });

  test('needs the person’s own token like every read, and answers a person POB does not know or knows twice', async () => {
    const { pob, asked } = costs({});
    const body = {
      input: { keys: ['unit-skola'] },
      about: {
        entity: 'unit',
        relations: { 'unit-skola': 'manages' },
        identifiers: { 'unit-skola': [ansvar('11000000')] },
      },
    };
    const refused = await direct(pob, body, false);
    expect(refused.status).toBe(403);
    expect(asked).toEqual([]);
    // Karin has two customer records in the made-up POB, which refuses her own errands; her unit's costs are not hers.
    const twice = costs({ 'unit-skola': { relation: 'manages', identifiers: [ansvar('11000000')] } });
    expect(await twice.read({ ...karin, role: 'manager' }, ['unit-skola'])).toHaveLength(1);
    expect(twice.asked).toEqual(['agreements 11000000']);
  });

  test('an agreement POB answers for another account is not counted, and an answer that was cut is no answer', async () => {
    const loose = (complete: boolean): CaseSource => ({
      ...createFixtureCases({ now }),
      agreements: async () => ({
        agreements: [
          { id: 'sla-1', account: '11000000.1', amount: 100 },
          { id: 'sla-2', account: '22000000.1', amount: 900 },
          { id: 'sla-3', account: ' 11000000.9', amount: 5 },
          { id: 'sla-4', amount: 7 },
          { account: '11000000.2', amount: 7 },
          null,
        ],
        complete,
      }),
    });
    const units = { 'unit-skola': { relation: 'manages' as const, identifiers: [ansvar('11000000')] } };
    expect(await costs(units, { source: loose(true) }).read(chef, ['unit-skola'])).toEqual([
      { key: 'unit-skola', agreements: 2, amount: 105 },
    ]);
    await expect(costs(units, { source: loose(false) }).read(chef, ['unit-skola'])).rejects.toThrow('svarar inte');
    // A POB that does not answer is an outage, never an empty sum.
    const down: CaseSource = {
      ...createFixtureCases({ now }),
      agreements: async () => {
        throw new SourceUnavailable('POB did not answer.');
      },
    };
    await expect(costs(units, { source: down }).read(chef, ['unit-skola'])).rejects.toThrow('svarar inte');
  });

  test('without a field that holds an amount the row is a count, and the installation’s own pattern says what a code is', async () => {
    const units = {
      'unit-skola': { relation: 'manages' as const, identifiers: [ansvar('11000000')] },
      'unit-kort': { relation: 'manages' as const, identifiers: [ansvar('1100')] },
    };
    expect(await costs(units, { costs: { identifier: 'ansvar' } }).read(chef, ['unit-skola'])).toEqual([
      { key: 'unit-skola', agreements: 3 },
    ]);
    const strict = costs(units, { costs: { identifier: 'ansvar', codePattern: '^[0-9]{8}$' } });
    expect(await strict.read(chef, ['unit-skola', 'unit-kort'])).toEqual([{ key: 'unit-skola', agreements: 3 }]);
    expect(strict.asked).toEqual(['agreements 11000000']);
    // The default takes four characters, which is a short code above the lowest level: every account that begins so.
    const loose = costs(units, { costs: { identifier: 'ansvar' } });
    expect(await loose.read(chef, ['unit-kort'])).toEqual([{ key: 'unit-kort', agreements: 5 }]);
  });

  test('the configuration switches the read on by naming the identifier, and holds what stands beside it', () => {
    const env = {
      CLEW_CONNECTOR_SECRET: secret,
      POB_ADAPTER: 'fixture',
      POB_IDP_ISSUER: issuer,
      POB_IDP_JWKS_URL: 'https://idp.test/certs',
    };
    expect(readConfig(env).costs).toBeUndefined();
    // A compose file passes every variable, set or not: an empty one is no value.
    expect(readConfig({ ...env, POB_COST_IDENTIFIER: '', POB_COST_CODE_PATTERN: '' }).costs).toBeUndefined();
    expect(readConfig({ ...env, POB_COST_IDENTIFIER: 'ansvar' }).costs).toEqual({
      identifier: 'ansvar',
      amountLabel: 'Avtalskostnad',
    });
    expect(
      readConfig({
        ...env,
        POB_COST_IDENTIFIER: 'kostnadsställe',
        POB_COST_AMOUNT_LABEL: 'Kostnad per månad',
        POB_COST_CODE_PATTERN: '^[0-9]{8}$',
      }).costs,
    ).toEqual({ identifier: 'kostnadsställe', amountLabel: 'Kostnad per månad', codePattern: '^[0-9]{8}$' });
    for (const wrong of [' ansvar', 'ansvar ', 'a'.repeat(65), 'an\tsvar'])
      expect(() => readConfig({ ...env, POB_COST_IDENTIFIER: wrong })).toThrow('POB_COST_IDENTIFIER');
    expect(() => readConfig({ ...env, POB_COST_CODE_PATTERN: '^[0-9]{8}$' })).toThrow('without POB_COST_IDENTIFIER');
    for (const pattern of ['[0-9]{8}', '^.*$', '^[0-9]{8}', '^[0-9]{8}$|^x$', '^(a+)+$'])
      expect(() => readConfig({ ...env, POB_COST_IDENTIFIER: 'ansvar', POB_COST_CODE_PATTERN: pattern })).toThrow(
        'POB_COST_CODE_PATTERN',
      );
    expect(() => readConfig({ ...env, POB_COST_IDENTIFIER: 'ansvar', POB_AGREEMENT_PATH: '/sla' })).toThrow(
      'api adapter only',
    );
    // With POB's own API there is a sum only where the installation has named the field that holds an amount.
    const api = {
      ...env,
      POB_ADAPTER: 'api',
      POB_URL: 'https://pob.test/pobg6/api',
      POB_AUTHORIZATION: 'Basic bWFkZS11cA==',
      POB_USER_MATCH: 'LoginName',
      POB_CUSTOMER_MATCH: 'LoginName',
      POB_STATUS_KINDS: '{"Open":"open"}',
      POB_CASE_TYPES: '["Incident"]',
      POB_COST_IDENTIFIER: 'ansvar',
    };
    const counted = readConfig(api);
    expect(counted.costs).toEqual({ identifier: 'ansvar' });
    expect(counted.pob).toMatchObject({
      agreementFields: { id: 'Id', account: 'Account.Id', amount: '' },
      agreementPath: '/sla',
    });
    const summed = readConfig({
      ...api,
      POB_AGREEMENT_FIELDS: '{"amount":"MonthlyPrice"}',
      POB_AGREEMENT_PATH: '/agreement',
    });
    expect(summed.costs).toEqual({ identifier: 'ansvar', amountLabel: 'Avtalskostnad' });
    expect(summed.pob).toMatchObject({ agreementFields: { amount: 'MonthlyPrice' }, agreementPath: '/agreement' });
    expect(() => readConfig({ ...api, POB_COST_AMOUNT_LABEL: 'Kostnad' })).toThrow('names no amount');
    expect(() => readConfig({ ...api, POB_AGREEMENT_FIELDS: '{"price":"X"}' })).toThrow('is not one of');
    expect(() => readConfig({ ...api, POB_AGREEMENT_PATH: 'sla' })).toThrow('POB_AGREEMENT_PATH');
    const { POB_COST_IDENTIFIER: _, ...off } = api;
    expect(readConfig(off).pob).not.toHaveProperty('agreementFields');
  });

  test('the draft adapter asks POB for the accounts that begin with the code, compares each again, and reads an amount only where it is a number', async () => {
    const calls: string[] = [];
    const source = (answers: Record<string, unknown>, options: Parameters<typeof createPobCases>[0] = {}) =>
      createPobCases({
        url: 'https://pob.test/pobg6/api',
        authorization: 'Basic bWFkZS11cA==',
        userMatch: 'LoginName',
        customerMatch: 'LoginName',
        agreementFields: agreementFieldMap({ amount: 'Price' }),
        now,
        fetch: (async (address: string) => {
          const url = new URL(address);
          const key = url.pathname.replace('/pobg6/api', '') + '?' + decodeURIComponent(url.searchParams.toString());
          calls.push(key);
          const answer = answers[key];
          if (answer === undefined) return new Response('', { status: 404 });
          return typeof answer === 'number' ? new Response('x', { status: answer }) : Response.json(answer);
        }) as never,
        ...options,
      });
    const sla = (data: Record<string, unknown>) => ({ Type: 'Sla', Data: data });
    const asked = '/sla?Filter=Account.Id=11000000%&limit=501';
    const pob = source({
      [asked]: [
        // The account as a key written with its dot, as a referenced record, and with the amount as text.
        sla({ Id: 1, 'Account.Id': '11000000.5750.100', Price: 1200 }),
        sla({ Id: 2, Account: { Type: 'Account', Data: { Id: '11000000.6211' } }, Price: '349,50' }),
        sla({ Id: 3, Account: { Id: '11000000.1' }, Price: null }),
        sla({ Id: 4, 'Account.Id': '11000000.2', Price: 'enligt offert' }),
        // A POB that matched loosely, or ignored the filter: another unit's agreement is not this unit's.
        sla({ Id: 5, 'Account.Id': '22000000.5750', Price: 99999 }),
      ],
    });
    expect(await pob.agreements!('11000000')).toEqual({
      agreements: [
        { id: '1', account: '11000000.5750.100', amount: 1200 },
        { id: '2', account: '11000000.6211', amount: 349.5 },
        { id: '3', account: '11000000.1' },
        { id: '4', account: '11000000.2' },
      ],
      complete: true,
    });
    expect(calls).toEqual([asked]);
    // Without a field for an amount none is read, whatever the agreement carries.
    const counted = source(
      { [asked]: [sla({ Id: 1, 'Account.Id': '11000000.1', Price: 5 })] },
      { agreementFields: agreementFieldMap() },
    );
    expect((await counted.agreements!('11000000')).agreements).toEqual([{ id: '1', account: '11000000.1' }]);
    // A full answer says there is more; an agreement that cannot be compared, and an answer that is no list, are an outage.
    const full = source(
      { [asked.replace('501', '3')]: [1, 2, 3].map(n => sla({ Id: n, 'Account.Id': '11000000.' + n })) },
      { listLimit: 2 },
    );
    expect((await full.agreements!('11000000')).complete).toBe(false);
    for (const answer of [[sla({ Id: 1 })], [sla({ 'Account.Id': '11000000.1' })], { Data: [] }, 500])
      await expect(source({ [asked]: answer }).agreements!('11000000')).rejects.toThrow(SourceUnavailable);
    // A code that could not stand in a filter is never sent, and the path is the installation's.
    calls.length = 0;
    for (const code of ['1100%', '11000000&x=1', '', '1100 0000'])
      await expect(pob.agreements!(code)).rejects.toThrow(SourceUnavailable);
    expect(calls).toEqual([]);
    const elsewhere = source(
      { '/agreement?Filter=Konto=11000000%&limit=501': [] },
      {
        agreementPath: '/agreement',
        agreementFields: agreementFieldMap({ account: 'Konto' }),
      },
    );
    expect(await elsewhere.agreements!('11000000')).toEqual({ agreements: [], complete: true });
    expect(() => source({}, { agreementPath: 'https://elsewhere.test/sla' })).toThrow('POB_AGREEMENT_PATH');
    expect(() => agreementFieldMap({ account: 'Account Id' })).toThrow('must be a field name');
  });
});
