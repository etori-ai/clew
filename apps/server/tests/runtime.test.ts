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
