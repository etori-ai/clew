import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { pino } from 'pino';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { database, closeDatabase } from '@clew/db';
import { enqueueWorkflow } from '@clew/db/durable';
import { bindLiveActivities } from '../src/dbos/activities';
import { logger } from '../src/logging';
import { testEngine } from './durable';

// A live step whose statement fails (D91), on PostgreSQL, the durable engine and production Node, under its own
// application name: the activities are bound as main.ts binds them, and the engine's warning passes through no
// serializer of Clew's.
test(
  'a live step whose statement fails is retried by the engine, whose warning names the statement and its SQLSTATE and no value it was given',
  { timeout: 60_000 },
  async t => {
    const workflowID = 'job:failed-step-runtime-' + randomUUID(),
      name = 'Anna Lindqvist',
      engine = testEngine('failed-step');
    // What the server's logger writes, line by line, in place of stdout: the engine's own lines among them.
    const lines: Array<Record<string, unknown>> = [];
    const stream = (logger as unknown as Record<symbol, { write(line: string): boolean }>)[pino.symbols.streamSym]!;
    t.mock.method(stream, 'write', (line: string) => {
      lines.push(JSON.parse(line));
      return true;
    });
    const warnings = () => lines.filter(l => l.scope === 'dbos' && l.level === 'warn');
    // The live activities, bound as main.ts binds them before the launch. The job id this workflow is given ends in a
    // NUL character, which PostgreSQL refuses (22021) in the live step's first statement, the claim of the job's row;
    // drizzle's error names the id among the statement's values, and every attempt fails the same way.
    bindLiveActivities();
    let launched = false,
      retried: Array<Record<string, unknown>> = [];
    try {
      await database().transaction(tx =>
        enqueueWorkflow(tx, engine.durable, {
          workflow: 'scheduledJob',
          id: workflowID,
          input: { id: name + '\u0000', dueAt: '2026-01-01T00:00:00.000Z' },
        }),
      );
      await engine.launch();
      launched = true;
      for (let n = 0; n < 400 && !warnings().length; n++) await new Promise(resolve => setTimeout(resolve, 50));
      retried = warnings();
    } finally {
      // The retries end with the workflow, which the shutdown lets finish before the engine lets go of the database.
      if (launched) {
        await DBOS.cancelWorkflow(workflowID);
        await DBOS.shutdown({ workflowCompletionTimeoutMS: 15_000 });
      }
      await engine.forget();
      await closeDatabase();
    }
    assert.ok(retried.length > 0, 'the engine retries the failed step');
    for (const warning of retried)
      assert.match(
        String(warning.message),
        /^Error in step being automatically retried\. Attempt \d+ of 10\. DrizzleQueryError: Failed query \(SQLSTATE 22021\): select .+ from "job" where "job"\."id" = \$1 for update\n {4}at /,
      );
    const written = JSON.stringify(lines);
    assert.deepEqual(
      [name, 'params:'].filter(value => written.includes(value)),
      [],
    );
  },
);
