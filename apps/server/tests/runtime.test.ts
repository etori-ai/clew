import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHmac, randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import { calculatePKCECodeChallenge, randomPKCECodeVerifier } from 'openid-client';
import { decryptTokens, encryptTokens } from '../src/auth-crypto';
import { localInstant } from '../../../packages/calendar/src/dates';
import type { AuthenticatedContext } from '@clew/contracts';
import { fixtureConnectors } from '../../../tests/fixture-connectors';
import { Registry } from '../../../tests/registry';
import { documentReviews } from '../src/connectors/usecases/documents';

test('sealed authentication tokens can only be opened by their own session', t => {
  const previousKey = process.env.MASTER_KEY;
  process.env.MASTER_KEY = randomBytes(32).toString('base64');
  t.after(() => {
    if (previousKey === undefined) delete process.env.MASTER_KEY;
    else process.env.MASTER_KEY = previousKey;
  });
  const tokens = { access_token: 'access-fixture', refresh_token: 'refresh-fixture', id_token: 'identity-fixture' };
  const encrypted = encryptTokens(tokens, 'session-fixture');
  assert.deepEqual(decryptTokens(encrypted, 'session-fixture'), tokens);
  assert.throws(() => decryptTokens(encrypted, 'another-session'));
});

test('OIDC libraries sign and verify tokens and produce a PKCE challenge', async () => {
  const secret = randomBytes(32);
  const token = await new SignJWT({ sub: 'fixture-person' }).setProtectedHeader({ alg: 'HS256' }).sign(secret);
  assert.equal((await jwtVerify(token, secret)).payload.sub, 'fixture-person');
  assert.match(await calculatePKCECodeChallenge(randomPKCECodeVerifier()), /^[A-Za-z0-9_-]{43}$/);
});

test('Hono serves a Web Request through the Node runtime', async () => {
  const app = new Hono().get('/health', c => c.json({ ok: true }));
  const response = await app.request(new Request('http://fixture.test/health'));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
});

test('an unknown address under a mounted /scim/v2 answers the SCIM error resource, not the parent 404', async () => {
  // Hono does not carry a sub-app's `notFound` through `app.route()`; the sub-app answers with a handler of its own.
  const { memoryProvisionStore } = await import('../src/modules/people/adapters/memory');
  const { scimUsecases } = await import('../src/modules/people/usecases');
  const { scimRoutes } = await import('../src/routes/scim');
  const store = memoryProvisionStore();
  store.state.provisioners.set('digest:t', { id: 'mk', organisationId: 'sundsvall', label: 'Metakatalogen' });
  const scim = scimUsecases({ store, clock: () => new Date(), ids: () => 'x', digest: token => 'digest:' + token });
  const parent = new Hono()
    .route('/scim/v2', scimRoutes(scim, console.error))
    .notFound(c => c.json({ error: 'Okänd adress.' }, 404));
  const headers = { Authorization: 'Bearer t' };
  const unknown = await parent.request('http://clew.test/scim/v2/Nothing', { headers });
  assert.equal(unknown.status, 404);
  assert.equal(unknown.headers.get('content-type'), 'application/scim+json; charset=utf-8');
  assert.deepEqual(await unknown.json(), {
    schemas: ['urn:ietf:params:scim:api:messages:2.0:Error'],
    status: '404',
    detail: 'No such SCIM resource.',
  });
  assert.equal((await parent.request('http://clew.test/scim/v2/Me', { headers })).status, 501);
  assert.equal((await parent.request('http://clew.test/elsewhere')).status, 404);
  assert.deepEqual(await (await parent.request('http://clew.test/elsewhere')).json(), { error: 'Okänd adress.' });
});

test('the live API and its composition load in Node without external services', async () => {
  const { api } = await import('../src/routes/api');
  assert.equal(typeof api.fetch, 'function');
});

test('Node accepts a freshly issued document review and distinguishes invalid evidence from actual expiry', async () => {
  let now = Date.parse('2026-11-08T20:00:00.000Z');
  const clock = () => new Date(now);
  const registry = new Registry();
  fixtureConnectors({ only: ['finance'], clock }).connectors.forEach(connector => registry.register(connector));
  const persona: AuthenticatedContext = {
    id: 'hillevi',
    name: 'Hillevi',
    unitId: 'unit-skola',
    unitLabel: 'Skola',
    role: 'manager',
    organisationId: 'fixture',
    principal: { id: 'person:hillevi', kind: 'person' },
    capabilities: [],
    authorizationVersion: 'v1',
    sessionBinding: 'fixture',
    expiresAt: '2026-11-09T00:00:00.000Z',
    authorize: async () => ({ version: 'v1' }),
  };
  const reviews = documentReviews({
    registry,
    clock,
    run: (person, capability, input) => registry.run(person, capability, input),
    sign: input => createHmac('sha256', 'node-review-fixture').update(JSON.stringify(input)).digest('hex'),
  });
  const { evidence } = await reviews.preview(persona, 'finance.record', 'finance:inv:55120');
  const payload = { refs: [evidence.ref], reviews: [evidence] };
  assert.equal(evidence.expiresAt, '2026-11-08T22:00:00.000Z');
  await assert.doesNotReject(reviews.validate(persona, 'finance.approve', payload));
  await assert.rejects(
    reviews.validate(persona, 'finance.approve', { ...payload, reviews: [{ ...evidence, expiresAt: 'not-a-date' }] }),
    /kunde inte verifieras/,
  );
  await assert.rejects(
    reviews.validate(persona, 'finance.approve', { ...payload, reviews: [{ ...evidence, proof: '0'.repeat(64) }] }),
    /ändrats/,
  );
  now += 2 * 3600_000 - 1;
  await assert.doesNotReject(reviews.validate(persona, 'finance.approve', payload));
  now += 1;
  await assert.rejects(reviews.validate(persona, 'finance.approve', payload), /gått ut/);
});

test('Stockholm meetings keep their instant and reject skipped or repeated local times', () => {
  assert.equal(Date.parse(localInstant('2026-11-09T09:00')), Date.UTC(2026, 10, 9, 8));
  assert.equal(Date.parse(localInstant('2026-07-01T09:00')), Date.UTC(2026, 6, 1, 7));
  assert.throws(() => localInstant('2026-03-29T02:30'));
  assert.throws(() => localInstant('2026-10-25T02:30'));
});

test('the talks routes (D96): thin writes over the use cases, Swedish refusals, and a 403 on every write while the built-in module does not answer', async () => {
  const { memoryTalkStore } = await import('../src/modules/talks/adapters/memory');
  const { talkUsecases } = await import('../src/modules/talks/usecases');
  const { NOT_WRITABLE, talkRoutes } = await import('../src/routes/talks');
  const personaOf = (id: string, role: 'manager' | 'employee'): AuthenticatedContext => ({
    id,
    name: id,
    unitId: 'u1',
    unitLabel: 'Enheten',
    role,
    organisationId: 'org',
    principal: { id: 'person:' + id, kind: 'person' },
    capabilities: [],
    authorizationVersion: 'v1',
    sessionBinding: 'test',
    expiresAt: '2099-01-01T00:00:00.000Z',
    authorize: async () => ({ version: 'v1' }),
  });
  const personas = new Map([personaOf('boss', 'manager'), personaOf('anna', 'employee')].map(p => [p.id, p]));
  const anna = { id: 'anna', name: 'Anna', userName: 'anna.a', email: null, role: 'employee' as const, enabled: true };
  let n = 0;
  const talks = talkUsecases({
    store: memoryTalkStore({ persons: [{ id: 'anna', organisationId: 'org', name: 'Anna', userName: 'anna.a' }] }),
    staff: async p =>
      p.id === 'boss' ? { units: [{ unitId: 'u1', unitLabel: 'Enheten', people: [anna] }] } : { units: [] },
    bookings: async () => new Map(),
    clock: () => new Date('2026-11-10T09:00:00.000Z'),
    ids: () => 'id-' + ++n,
  });
  await talks.openRound('operator:cli', {
    organisationId: 'org',
    label: 'Omgång',
    opensOn: '2026-09-01',
    dueOn: '2026-11-28',
  });
  let writable = true;
  const app = new Hono().route(
    '/api/talks',
    talkRoutes({
      talks,
      writable: async () => writable,
      // The session guard's part: who is signed in. The real guard also checks the cookie and the CSRF token.
      guard: async (c, next) => {
        c.set('session', { context: personas.get(c.req.header('x-test-person') ?? '')! } as never);
        await next();
      },
    }),
  );
  const call = (as: string, method: string, path: string, body?: unknown) =>
    app.request('http://clew.test/api/talks' + path, {
      method,
      headers: { 'x-test-person': as, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });

  const added = await call('boss', 'POST', '/anna/commitments', {
    owner: 'employee',
    text: 'Läsa boken',
    dueOn: '2026-12-15',
  });
  assert.equal(added.status, 201);
  const { id } = (await added.json()) as { id: string };
  assert.equal(typeof id, 'string');
  const held = await call('boss', 'POST', '/anna/held', { heldOn: '2026-11-03' });
  assert.equal(held.status, 200);
  assert.deepEqual(await held.json(), { id: 'id-4', heldOn: '2026-11-03' });
  assert.equal((await call('boss', 'DELETE', '/anna/held')).status, 204);
  assert.equal((await call('anna', 'POST', `/commitments/${id}/done`)).status, 204);
  assert.equal((await call('boss', 'DELETE', `/commitments/${id}/done`)).status, 204);

  const refused = await call('anna', 'POST', '/anna/held', {});
  assert.equal(refused.status, 403);
  assert.deepEqual(await refused.json(), {
    error: 'Utvecklingssamtalen är för den som är chef för en enhet.',
    code: 'denied',
  });
  for (const bad of [
    { owner: 'employee', dueOn: '2026-12-15' },
    { owner: 'nobody', text: 'x', dueOn: '2026-12-15' },
    'not json',
  ]) {
    const response = await call('boss', 'POST', '/anna/commitments', bad);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Ogiltig förfrågan.' });
  }
  const blank = await call('boss', 'POST', '/anna/commitments', {
    owner: 'employee',
    text: '   ',
    dueOn: '2026-12-15',
  });
  assert.equal(blank.status, 400);
  assert.match(((await blank.json()) as { error: string }).error, /högst 280 tecken/);

  writable = false;
  for (const [method, path, body] of [
    ['POST', '/anna/held', {}],
    ['DELETE', '/anna/held', undefined],
    ['POST', '/anna/commitments', { owner: 'employee', text: 'Läsa boken', dueOn: '2026-12-15' }],
    ['POST', `/commitments/${id}/done`, undefined],
    ['DELETE', `/commitments/${id}/done`, undefined],
  ] as const) {
    const response = await call('boss', method, path, body);
    assert.equal(response.status, 403, `${method} ${path}`);
    assert.deepEqual(await response.json(), { error: NOT_WRITABLE, code: 'denied' });
  }
  assert.equal(n, 4, 'no write reached the use cases while the built-in module did not answer');
});

test('the dialogue routes (D118): one unit read and its writes over the use cases, Swedish refusals, and a 403 on all while the module is off', async () => {
  const { memoryDialogueStore } = await import('../src/modules/dialogue/adapters/memory');
  const { dialogueUsecases } = await import('../src/modules/dialogue/usecases');
  const { NOT_WRITABLE, dialogueRoutes } = await import('../src/routes/dialogue');
  const personaOf = (id: string, role: 'manager' | 'employee'): AuthenticatedContext => ({
    id,
    name: id,
    unitId: 'u1',
    unitLabel: 'Enheten',
    role,
    organisationId: 'org',
    principal: { id: 'person:' + id, kind: 'person' },
    capabilities: [],
    authorizationVersion: 'v1',
    sessionBinding: 'test',
    expiresAt: '2099-01-01T00:00:00.000Z',
    authorize: async () => ({ version: 'v1' }),
  });
  const personas = new Map([personaOf('boss', 'manager'), personaOf('anna', 'employee')].map(p => [p.id, p]));
  let n = 0;
  const dialogue = dialogueUsecases({
    store: memoryDialogueStore({ persons: { boss: 'Chefen' } }),
    followed: async p =>
      p.id === 'boss' ? [{ unitId: 'u1', label: 'Enheten', relation: 'own', managerId: 'boss' }] : [],
    clock: () => new Date('2026-11-13T09:00:00.000Z'),
    ids: () => 'id-' + ++n,
  });
  await dialogue.replaceConfig('operator:cli', 'org', {
    areas: [{ key: 'digital', title: 'Digital transformation', kind: 'assessed' }],
  });
  let writable = true;
  const app = new Hono().route(
    '/api/dialogue',
    dialogueRoutes({
      dialogue,
      writable: async () => writable,
      guard: async (c, next) => {
        c.set('session', { context: personas.get(c.req.header('x-test-person') ?? '')! } as never);
        await next();
      },
    }),
  );
  const call = (as: string, method: string, path: string, body?: unknown) =>
    app.request('http://clew.test/api/dialogue' + path, {
      method,
      headers: { 'x-test-person': as, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: typeof body === 'string' ? body : JSON.stringify(body) }),
    });

  assert.equal((await call('boss', 'POST', '/units/u1/assessments', { area: 'digital', tone: 'warn' })).status, 201);
  const added = await call('boss', 'POST', '/units/u1/activities', { area: 'digital', text: 'Pröva verktyget' });
  assert.equal(added.status, 201);
  const { id } = (await added.json()) as { id: string };
  assert.equal(
    (await call('boss', 'PATCH', `/activities/${id}`, { text: 'Pröva det', dueOn: '2026-12-01' })).status,
    204,
  );
  assert.equal((await call('boss', 'POST', `/activities/${id}/done`, { note: 'Gick bra' })).status, 204);
  const read = await call('boss', 'GET', '/units/u1');
  assert.equal(read.status, 200);
  assert.equal(read.headers.get('cache-control'), 'no-store, private');
  const unit = (await read.json()) as { writable: boolean; areas: Array<{ tone: string; activities: unknown[] }> };
  assert.equal(unit.writable, true);
  assert.equal(unit.areas[0]!.tone, 'warn');
  assert.deepEqual(unit.areas[0]!.activities, [
    {
      id,
      text: 'Pröva det',
      dueOn: '2026-12-01',
      owner: 'Chefen',
      mine: true,
      doneAt: '2026-11-13T09:00:00.000Z',
      doneNote: 'Gick bra',
      createdAt: '2026-11-13T09:00:00.000Z',
    },
  ]);
  assert.equal((await call('boss', 'DELETE', `/activities/${id}/done`)).status, 204);
  const open = await call('boss', 'DELETE', `/activities/${id}`);
  assert.equal(open.status, 400);
  assert.deepEqual(await open.json(), { error: 'Markera aktiviteten som klar innan du tar bort den.' });

  const refused = await call('anna', 'GET', '/units/u1');
  assert.equal(refused.status, 403);
  assert.deepEqual(await refused.json(), {
    error: 'Dialogstödet är för den som är chef för en enhet.',
    code: 'denied',
  });
  for (const bad of [{ area: 'digital' }, { area: 'digital', tone: 'red' }, 'not json'])
    assert.equal((await call('boss', 'POST', '/units/u1/assessments', bad)).status, 400);

  writable = false;
  for (const [method, path] of [
    ['GET', '/units/u1'],
    ['POST', '/units/u1/activities'],
    ['DELETE', `/activities/${id}`],
  ] as const) {
    const off = await call('boss', method, path, method === 'GET' ? undefined : {});
    assert.equal(off.status, 403);
    assert.deepEqual(await off.json(), { error: NOT_WRITABLE, code: 'denied' });
  }
});
