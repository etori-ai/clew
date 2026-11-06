import assert from 'node:assert/strict';
import { test } from 'node:test';
import { randomBytes } from 'node:crypto';
import { Hono } from 'hono';
import { SignJWT, jwtVerify } from 'jose';
import { calculatePKCECodeChallenge, randomPKCECodeVerifier } from 'openid-client';
import { decryptTokens, encryptTokens } from '../src/auth-crypto';
import { localInstant } from '../../../packages/calendar/src/dates';

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

test('Stockholm meetings keep their instant and reject skipped or repeated local times', () => {
  assert.equal(Date.parse(localInstant('2026-11-09T09:00')), Date.UTC(2026, 10, 9, 8));
  assert.equal(Date.parse(localInstant('2026-07-01T09:00')), Date.UTC(2026, 6, 1, 7));
  assert.throws(() => localInstant('2026-03-29T02:30'));
  assert.throws(() => localInstant('2026-10-25T02:30'));
});
