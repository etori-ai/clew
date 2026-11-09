import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { generateKeyPair, exportPKCS8 } from 'jose';
import { and, eq, inArray } from 'drizzle-orm';
import { database, schema, closeDatabase } from '@clew/db';
import { Registry, openGovernance, type ExecuteResult } from '@clew/connectors';
import { fetchManifest, remoteConnector } from '@clew/connectors/remote';
import type { AuthenticatedContext } from '@clew/contracts';
import { connectorAuthority } from '../src/connectors/authority';
import { sealSecret, openSecret } from '../src/auth-crypto';
import { postgresExecutionStore } from '../src/modules/executions/adapters/postgres';
import { executionUsecases } from '../src/modules/executions/usecases';
import { executionDispatcher } from '../src/modules/executions/dispatch';
import type { ExecutionSource } from '../src/modules/executions/model';
import { bindActivities } from '../src/dbos/workflows';
import { startExecutionWorkflow } from '../src/dbos/executions';
import { durableResult } from '../src/dbos/start';
import { launchTestEngine } from './durable';

// The durable engine under its own application name, a synthetic person and source. No existing connector or business data is changed.
test(
  'Postgres + the durable engine + independent durable source recover a lost reply and reject duplicate intent',
  { timeout: 60_000 },
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'clew-durability-'));
    const id = 'durability-' + randomUUID(),
      key = randomBytes(24).toString('hex');
    process.env.MASTER_KEY ??= randomBytes(32).toString('base64');
    const pair = await generateKeyPair('RS256', { extractable: true });
    const authority = await connectorAuthority(await exportPKCS8(pair.privateKey), id);
    await writeFile(join(directory, 'jwks.json'), JSON.stringify(authority.jwks));
    const fixture = fileURLToPath(new URL('../../../connectors/reference/server.mjs', import.meta.url));
    let child: ChildProcess | undefined, engine: Awaited<ReturnType<typeof launchTestEngine>> | undefined;
    let sourceErrors = '';
    const startSource = async (fault: string, port = 0) => {
      child = spawn(process.execPath, [fixture], {
        env: {
          ...process.env,
          PORT: String(port),
          REFERENCE_DB: join(directory, 'source.sqlite'),
          REFERENCE_TEST_JWKS: join(directory, 'jwks.json'),
          REFERENCE_TEST_FAULT: fault,
          CLEW_CONNECTOR_SECRET: key,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      child.stderr!.on('data', chunk => {
        sourceErrors += String(chunk);
      });
      return new Promise<number>((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error('Source did not start')), 5000);
        child!.once('error', reject);
        child!.once('exit', code => {
          clearTimeout(timeout);
          reject(new Error('Source exited during startup: ' + code));
        });
        child!.stdout!.on('data', chunk => {
          const match = String(chunk).match(/ready:(\d+)/);
          if (match) {
            clearTimeout(timeout);
            resolve(Number(match[1]));
          }
        });
      });
    };
    try {
      const port = await startSource('drop-after-commit'),
        url = 'http://127.0.0.1:' + port;
      const registry = new Registry()
        .register(
          remoteConnector(await fetchManifest(url), {
            url,
            key,
            assert: actor => authority.assert('reference', actor),
          }),
        )
        .govern('reference', openGovernance());
      const persona: AuthenticatedContext = {
        id,
        name: 'Synthetic durability test',
        unitId: 'test',
        unitLabel: 'Test',
        role: 'manager',
        organisationId: 'test',
        principal: { id: 'person:' + id, kind: 'person' },
        capabilities: [],
        authorizationVersion: 'v1',
        sessionBinding: 'test',
        expiresAt: '2099-01-01',
        authorize: async () => ({ version: 'v1' }),
      };
      await database().insert(schema.people).values({ id, organisationId: 'test', name: 'Synthetic durability test' });
      await registry.run(persona, 'reference.items', {});
      let now = Date.parse('2098-11-05T10:00:00Z'); // Production's dispatcher cannot claim test outbox rows.
      const clock = () => new Date(now);
      const source: ExecutionSource = {
        async authorize(actor, operation, input) {
          const found = await registry.validate(actor, operation, input);
          return { connector: 'reference', safety: found.capability.execution!, needsSession: false };
        },
        current: async () => persona,
        execute: (actor, e) => registry.run(actor, e.operation, e.payload, { operationId: e.id }),
        lookup: async (actor, e) => {
          const value = await registry.run<{ found: boolean; result?: ExecuteResult }>(actor, 'reference.lookup', {
            operationId: e.id,
          });
          return value.found ? value.result : undefined;
        },
      };
      const build = () => {
        const store = postgresExecutionStore({ seal: sealSecret, open: openSecret });
        return {
          store,
          uc: executionUsecases({
            store,
            source,
            clock,
            ids: randomUUID,
            digest: value => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
          }),
        };
      };
      const first = build(),
        second = build();
      const approval = {
        decisionId: id,
        operation: 'reference.complete',
        payload: { ref: 'reference:item:1', revision: 1 },
      };
      const [a, b] = await Promise.all([first.uc.approve(persona, approval), second.uc.approve(persona, approval)]);
      assert.equal(a.id, b.id);
      await assert.rejects(
        second.uc.approve(persona, { ...approval, payload: { ref: 'reference:item:1', revision: 999 } }),
      );
      bindActivities({ progressExecution: second.uc.progress });
      engine = await launchTestEngine('execution');
      const workflowId = 'execution:' + a.id;
      const dispatch = executionDispatcher({ store: first.store, start: startExecutionWorkflow, clock });
      await Promise.all([
        dispatch(),
        executionDispatcher({ store: second.store, start: startExecutionWorkflow, clock })(),
      ]);
      await durableResult(workflowId);
      const observed = await second.uc.read(persona, a.id);
      assert.equal(
        observed?.state,
        'succeeded',
        'Execution reason: ' + observed?.reason + '; fixture: ' + sourceErrors,
      );
      const items = await registry.run<{ rows: Array<{ revision: number }> }>(persona, 'reference.items', {});
      assert.equal(items.rows[0]?.revision, 2, 'exactly one source transition despite lost reply');
      assert.equal(
        (
          await database()
            .select()
            .from(schema.audit)
            .where(and(eq(schema.audit.subject, 'execution:' + a.id), eq(schema.audit.action, 'execution.approved')))
        ).length,
        1,
      );
      // Restart the independent source with the same SQLite file, then lose the outbox acknowledgement.
      await new Promise<void>(resolve => {
        child!.once('exit', () => resolve());
        child!.kill('SIGTERM');
      });
      await startSource('', port);
      assert.equal((await source.lookup(persona, (await first.store.read(a.id))!))?.rows[0]?.outcome, 'done');
      await database()
        .update(schema.dispatchOutbox)
        .set({ deliveredAt: null, leaseUntil: null })
        .where(eq(schema.dispatchOutbox.id, workflowId));
      now += 31_000;
      await dispatch();
      assert.equal(
        (await registry.run<{ rows: Array<{ revision: number }> }>(persona, 'reference.items', {})).rows[0]?.revision,
        2,
      );
    } finally {
      await engine?.shutdown();
      if (child?.exitCode === null)
        await new Promise<void>(resolve => {
          child!.once('exit', () => resolve());
          child!.kill('SIGTERM');
        });
      const rows = await database().select().from(schema.executions).where(eq(schema.executions.personId, id));
      const ids = rows.map(row => row.id);
      if (ids.length) {
        await database().delete(schema.dispatchOutbox).where(inArray(schema.dispatchOutbox.executionId, ids));
        await database()
          .delete(schema.audit)
          .where(
            inArray(
              schema.audit.subject,
              ids.map(id => 'execution:' + id),
            ),
          );
        await database().delete(schema.executions).where(inArray(schema.executions.id, ids));
      }
      await database().delete(schema.people).where(eq(schema.people.id, id));
      await closeDatabase();
      await rm(directory, { recursive: true, force: true });
    }
  },
);
