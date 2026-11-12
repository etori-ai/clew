import assert from 'node:assert/strict';
import { test, type TestContext } from 'node:test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateKeyPair, exportPKCS8 } from 'jose';
import { connectorAuthority } from '../src/connectors/authority';

const manager = {
  id: 'hillevi',
  name: 'Hillevi Berg',
  unitId: 'unit-skola',
  unitLabel: 'Skolan',
  role: 'manager' as const,
};
const outside = { ...manager, id: 'outside', unitId: 'other-unit' };
const secret = 'runtime-fixture-transport';
const feedKey = 'runtime-fixture-feed';

async function listen(server: Server) {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  return 'http://127.0.0.1:' + address.port;
}
async function stop(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = once(child, 'exit');
  child.kill('SIGKILL');
  await exited;
}
async function harness(t: TestContext) {
  const directory = await mkdtemp(join(tmpdir(), 'clew-fixture-http-'));
  const children: ChildProcess[] = [];
  const servers: Server[] = [];
  t.after(async () => {
    await Promise.all(children.map(stop));
    await Promise.all(
      servers.map(
        server =>
          new Promise<void>((resolve, reject) => {
            server.close(error => (error ? reject(error) : resolve()));
            server.closeAllConnections();
          }),
      ),
    );
    await rm(directory, { recursive: true, force: true });
  });
  const keys = await generateKeyPair('RS256', { extractable: true });
  const authority = await connectorAuthority(await exportPKCS8(keys.privateKey), 'fixture-http-test');
  const jwks = createServer((_req, res) => {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify(authority.jwks));
  });
  servers.push(jwks);
  const clewUrl = await listen(jwks);
  async function start(id: string, env: Record<string, string> = {}) {
    const child = spawn(process.execPath, ['connectors/' + id + '/server.mjs'], {
      cwd: join(import.meta.dirname, '../../..'),
      env: {
        ...process.env,
        PORT: '0',
        CLEW_CONNECTOR_SECRET: secret,
        CLEW_URL: clewUrl,
        FIXTURE_DB: join(directory, id + '.sqlite'),
        FIXTURE_TODAY: '2026-11-04',
        FIXTURE_FAULT: '',
        FIXTURE_RESEED: 'false',
        FIXTURE_UNIT_MAP: '{}',
        FIXTURE_PERSON_MAP: '{}',
        FIXTURE_FEED_KEY: feedKey,
        ...env,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(child);
    const url = await new Promise<string>((resolve, reject) => {
      let output = '',
        errors = '';
      const timer = setTimeout(() => reject(new Error(id + ' did not start: ' + errors)), 5000);
      child.stderr!.on('data', chunk => {
        errors += String(chunk);
      });
      child.stdout!.on('data', chunk => {
        output += String(chunk);
        const match = output.match(/listening on :(\d+)/);
        if (match) {
          clearTimeout(timer);
          resolve('http://127.0.0.1:' + match[1]);
        }
      });
      child.once('error', error => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('exit', code => {
        clearTimeout(timer);
        reject(new Error(id + ' exited ' + code + ': ' + errors));
      });
    });
    return { child, url };
  }
  async function call(
    url: string,
    id: string,
    route: string,
    input: unknown = {},
    operationId?: string,
    actor = manager,
  ) {
    // Bound to the exact body and, on a capability's route, to the capability, as Clew signs it (D117).
    const body = JSON.stringify({ actor, input });
    const capability = route.startsWith('/clew/capabilities/') ? route.slice('/clew/capabilities/'.length) : undefined;
    return fetch(url + route, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization:
          'Bearer ' + (await authority.assert(id, actor, [], [], { body, ...(capability ? { capability } : {}) })),
        'x-clew-connector-key': secret,
        ...(operationId ? { 'x-clew-operation-id': operationId } : {}),
      },
      body,
      signal: AbortSignal.timeout(5000),
    });
  }
  return { start, call, servers };
}

test(
  'HTTP response lost after commit survives process death: lookup, no duplicate, scan and undo',
  { timeout: 20000 },
  async t => {
    const { start, call, servers } = await harness(t);
    const first = await start('hr');
    const countLeave = async (url: string) => {
      const response = await call(url, 'hr', '/clew/scan');
      assert.equal(response.status, 200);
      const body = (await response.json()) as { drafts: Array<{ topic: string }> };
      return body.drafts.filter(d => d.topic.startsWith('hr:leave:')).length;
    };
    assert.equal(await countLeave(first.url), 2);
    let committed: unknown;
    // Drop the TCP response only after the real service has committed and returned its receipt.
    const drop = createServer(async (req, res) => {
      try {
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const response = await fetch(first.url + req.url, {
          method: 'POST',
          headers: Object.fromEntries(
            Object.entries(req.headers).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
          ),
          body: Buffer.concat(chunks),
          signal: AbortSignal.timeout(5000),
        });
        assert.equal(response.status, 200);
        committed = ((await response.json()) as { output: unknown }).output;
        res.destroy();
      } catch (error) {
        res.destroy(error as Error);
      }
    });
    servers.push(drop);
    const droppedUrl = await listen(drop);
    const input = { refs: ['hr:leave:7781'], decision: 'approve' };
    await assert.rejects(call(droppedUrl, 'hr', '/clew/capabilities/hr.decideLeave', input, 'lost-response-1'));
    assert.ok(committed, 'source returned a successful receipt before the connection was dropped');
    await stop(first.child);
    const restarted = await start('hr');
    const lookup = await call(restarted.url, 'hr', '/clew/capabilities/hr.lookup', { operationId: 'lost-response-1' });
    assert.equal(lookup.status, 200);
    assert.deepEqual(await lookup.json(), { output: { found: true, result: committed } });
    const replay = await call(restarted.url, 'hr', '/clew/capabilities/hr.decideLeave', input, 'lost-response-1');
    assert.equal(replay.status, 200);
    assert.deepEqual(await replay.json(), { output: committed });
    const changed = await call(
      restarted.url,
      'hr',
      '/clew/capabilities/hr.decideLeave',
      { ...input, decision: 'reject' },
      'lost-response-1',
    );
    assert.equal(changed.status, 409);
    assert.equal(await countLeave(restarted.url), 1);
    const undo = await call(restarted.url, 'hr', '/clew/capabilities/hr.undecideLeave', { refs: input.refs }, 'undo-1');
    assert.equal(undo.status, 200);
    assert.equal(await countLeave(restarted.url), 2);
  },
);

test(
  'payroll imports the real HTTP feed next day, enforces unit access and reports source failure',
  { timeout: 20000 },
  async t => {
    const { start, call } = await harness(t);
    const hr = await start('hr');
    const payload = { person: 'hr:emp:1005', from: '2026-11-04', extent: 100 };
    const written = await call(hr.url, 'hr', '/clew/capabilities/hr.reportAbsence', payload, 'absence-1');
    assert.equal(written.status, 200);
    assert.equal((await fetch(hr.url + '/fixture/absences')).status, 401);
    const feed = await fetch(hr.url + '/fixture/absences', { headers: { 'x-fixture-key': feedKey } });
    assert.equal(((await feed.json()) as { rows: unknown[] }).rows.length, 1);
    const statusInput = { person: payload.person, date: payload.from };
    const payrollEnv = { HR_FEED_URL: hr.url + '/fixture/absences' };
    const today = await start('payroll', payrollEnv);
    const pending = await call(today.url, 'payroll', '/clew/capabilities/payroll.absenceStatus', statusInput);
    assert.equal(pending.status, 200);
    assert.equal(((await pending.json()) as { output: { status: string } }).output.status, 'pending');
    await stop(today.child);
    const tomorrow = await start('payroll', { ...payrollEnv, FIXTURE_TODAY: '2026-11-05' });
    const arrived = await call(tomorrow.url, 'payroll', '/clew/capabilities/payroll.absenceStatus', statusInput);
    assert.equal(arrived.status, 200);
    assert.equal(((await arrived.json()) as { output: { status: string } }).output.status, 'registered');
    const denied = await call(
      tomorrow.url,
      'payroll',
      '/clew/capabilities/payroll.absenceStatus',
      statusInput,
      undefined,
      outside,
    );
    assert.equal(denied.status, 403);
    const empty = await call(tomorrow.url, 'payroll', '/clew/capabilities/payroll.absences', {}, undefined, outside);
    assert.deepEqual(await empty.json(), { output: { rows: [] } });
    await stop(hr.child);
    const unavailable = await call(tomorrow.url, 'payroll', '/clew/capabilities/payroll.absences');
    assert.equal(unavailable.status, 503);
  },
);
