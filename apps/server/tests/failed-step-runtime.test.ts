import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { pino } from 'pino';
import { database, schema, closeDatabase } from '@clew/db';
import { enqueueWorkflow } from '@clew/db/durable';
import { bindActivities } from '../src/dbos/workflows';
import { durableResult } from '../src/dbos/start';
import { logger, valuelessFailures } from '../src/logging';
import { testEngine } from './durable';

// A step whose statement fails (D91), on PostgreSQL, the durable engine and production Node, under its own application
// name and a synthetic person: the engine's warning and retry pass through no serializer of Clew's.
test(
  'a step whose statement fails is retried by the engine, whose warning names the statement and its SQLSTATE and no value',
  { timeout: 60_000 },
  async t => {
    const id = 'failed-step-runtime-' + randomUUID(),
      workflowID = 'job:' + id,
      name = 'Anna Lindqvist',
      engine = testEngine('failed-step');
    // What the server's logger writes, line by line, in place of stdout: the engine's own lines among them.
    const lines: Array<Record<string, unknown>> = [];
    const stream = (logger as unknown as Record<symbol, { write(line: string): boolean }>)[pino.symbols.streamSym]!;
    t.mock.method(stream, 'write', (line: string) => {
      lines.push(JSON.parse(line));
      return true;
    });
    // Bound as the live activities are: the first attempt writes a person whose id is taken, which PostgreSQL refuses
    // and drizzle's error names with every value; the retry succeeds.
    let attempts = 0;
    bindActivities(
      valuelessFailures({
        runScheduledJob: async () => {
          attempts++;
          if (attempts === 1) await database().insert(schema.people).values({ id, name, organisationId: 'test' });
          return 'done' as const;
        },
      }),
    );
    let launched: Awaited<ReturnType<typeof engine.launch>> | undefined;
    try {
      await database().insert(schema.people).values({ id, name: 'Synthetic step test', organisationId: 'test' });
      await database().transaction(tx =>
        enqueueWorkflow(tx, engine.durable, {
          workflow: 'scheduledJob',
          id: workflowID,
          input: { id, dueAt: '2026-01-01T00:00:00.000Z' },
        }),
      );
      launched = await engine.launch();
      await durableResult(workflowID);
      assert.equal((await engine.row(workflowID))?.status, 'SUCCESS');
      assert.equal(attempts, 2);
      const warnings = lines.filter(l => l.scope === 'dbos' && l.level === 'warn');
      assert.equal(warnings.length, 1);
      assert.match(
        String(warnings[0]!.message),
        /^Error in step being automatically retried\. Attempt 1 of 10\. DrizzleQueryError: Failed query \(SQLSTATE 23505\): insert into "auth_person" \(.*\) values \(\$1, /,
      );
      const written = JSON.stringify(lines);
      assert.deepEqual(
        [name, 'params:', 'Synthetic step test'].filter(v => written.includes(v)),
        [],
      );
    } finally {
      await launched?.shutdown();
      await database().delete(schema.people).where(eq(schema.people.id, id));
      await engine.forget();
      await closeDatabase();
    }
  },
);
