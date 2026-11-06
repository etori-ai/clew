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

test('a fixture connector keeps its writes in SQLite across a restart and boots as a service', async t => {
  const { generateKeyPair, exportPKCS8 } = await import('jose');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const { spawn } = await import('node:child_process');
  const { connectorAuthority } = await import('../src/connectors/authority');
  const { createConnector } = await import('../../../connectors/hr/connector.mjs');
  const { sqliteState } = await import('../../../connectors/hr/state.mjs');
  const directory = await mkdtemp(join(tmpdir(), 'clew-hr-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const keys = await generateKeyPair('RS256', { extractable: true });
  const authority = await connectorAuthority(await exportPKCS8(keys.privateKey), 'runtime-test');
  const secret = 'runtime-test-transport-key';
  const hillevi = {
    id: 'hillevi',
    name: 'Hillevi Berg',
    unitId: 'unit-skola',
    unitLabel: 'Skolan',
    role: 'manager' as const,
  };
  const path = join(directory, 'hr.sqlite');
  const clock = () => new Date('2026-11-04T08:00:00+01:00');
  const call = async (
    connector: { handle(request: Request): Promise<Response> },
    route: string,
    body: unknown,
    operationId?: string,
  ) =>
    connector.handle(
      new Request('http://hr' + route, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: 'Bearer ' + (await authority.assert('hr', hillevi)),
          'x-clew-connector-key': secret,
          ...(operationId ? { 'x-clew-operation-id': operationId } : {}),
        },
        body: JSON.stringify(body),
      }),
    );
  const first = createConnector({ jwks: authority.jwks, secret, state: await sqliteState(path), clock });
  const before = (await (await call(first, '/clew/scan', { actor: hillevi })).json()) as {
    drafts: Array<{ topic: string }>;
  };
  assert.equal(before.drafts.filter(d => d.topic.startsWith('hr:leave:')).length, 2);
  const decided = await call(
    first,
    '/clew/capabilities/hr.decideLeave',
    { actor: hillevi, input: { refs: ['hr:leave:7781'], decision: 'approve' } },
    'node-op-1',
  );
  assert.equal(decided.status, 200);
  first.close();
  // The same file after a restart: the decision is there, the lookup finds the operation, the card is gone.
  const second = createConnector({ jwks: authority.jwks, secret, state: await sqliteState(path), clock });
  const found = (await (
    await call(second, '/clew/capabilities/hr.lookup', { actor: hillevi, input: { operationId: 'node-op-1' } })
  ).json()) as { output: { found: boolean } };
  assert.equal(found.output.found, true);
  const after = (await (await call(second, '/clew/scan', { actor: hillevi })).json()) as {
    drafts: Array<{ topic: string }>;
  };
  assert.equal(after.drafts.filter(d => d.topic.startsWith('hr:leave:')).length, 1);
  second.close();
  // server.mjs boots on node:sqlite and serves the manifest.
  const child = spawn(process.execPath, ['connectors/hr/server.mjs'], {
    cwd: join(import.meta.dirname, '../../..'),
    env: {
      ...process.env,
      PORT: '0',
      CLEW_CONNECTOR_SECRET: secret,
      CLEW_URL: 'http://127.0.0.1:9',
      FIXTURE_DB: join(directory, 'service.sqlite'),
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(() => child.kill('SIGTERM'));
  const port = await new Promise<string>((resolve, reject) => {
    let out = '';
    child.stdout.on('data', chunk => {
      out += String(chunk);
      const match = out.match(/listening on :(\d+)/);
      if (match) resolve(match[1]!);
    });
    child.stderr.on('data', chunk => reject(new Error(String(chunk))));
    child.on('exit', code => reject(new Error('hr server exited with ' + code)));
  });
  const manifest = (await (await fetch(`http://127.0.0.1:${port}/clew/manifest`)).json()) as { id: string };
  assert.equal(manifest.id, 'hr');
});
