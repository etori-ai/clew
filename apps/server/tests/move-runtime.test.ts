import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { pino } from 'pino';
import { sql } from 'drizzle-orm';
import { database, closeDatabase } from '@clew/db';
import { enqueueWorkflow } from '@clew/db/durable';
import { bindActivities } from '../src/dbos/workflows';
import { logger } from '../src/logging';
import { testEngine } from './durable';

// An operator's move after a deployment (D85 item 2, as amended 2026-11-13), on PostgreSQL, the durable engine and
// production Node: `scripts/workflows-move.ts`, run as the runbook runs it, against a test engine's application. An
// instance of the older release takes two scheduled jobs' workflows from the queue and is killed in their steps; the
// same instance starts as the next release, whose engine recovers neither. An approved execution of the next release
// ends in ERROR when its step keeps failing.
test(
  'the workflows a replaced release left waiting are listed, then moved by the operator’s script under their own ids from where their records end, and one in ERROR starts again from the step that failed',
  { timeout: 120_000 },
  async t => {
    const engine = testEngine('move');
    // The engine's warnings of the failing step are this test's doing: kept out of the run's output.
    const stream = (logger as unknown as Record<symbol, { write(line: string): boolean }>)[pino.symbols.streamSym]!;
    t.mock.method(stream, 'write', () => true);
    const releases = [engine.name + ':release-1', engine.name + ':release-2'] as const,
      instance = 'move-instance',
      key = randomUUID().slice(0, 8);
    const jobs = [`move-${key}-a`, `move-${key}-b`],
      waiting = jobs.map(id => 'job:' + id),
      failing = `execution:move-${key}`;
    const ran: string[] = [];
    let fixed = false,
      progressed = 0;
    // The next release's steps: a job runs and is done; the execution fails until its cause is fixed.
    bindActivities({
      runScheduledJob: async id => {
        ran.push(id);
        return 'done';
      },
      progressExecution: async () => {
        progressed++;
        if (!fixed) throw new Error('the source refused the call');
        return 'done';
      },
    });
    const status = async (workflowID: string) =>
      [
        ...(await database().execute<{ status: string; application_version: string | null; queue_name: string | null }>(
          sql`select status, application_version, queue_name from dbos.workflow_status where workflow_uuid = ${workflowID} and application_name = ${engine.name}`,
        )),
      ][0];
    const steps = async (workflowID: string) => [
      ...(await database().execute<{ function_id: number; function_name: string; output: string | null }>(
        sql`select function_id, function_name, output from dbos.operation_outputs where workflow_uuid = ${workflowID} order by function_id`,
      )),
    ];
    const move = (...args: string[]) =>
      new Promise<{ code: number | null; out: string; err: string }>((resolve, reject) => {
        // As the runbook runs it: with Bun, inside the app container, with the server's settings.
        const script = spawn(
          'bun',
          [
            fileURLToPath(new URL('../../../scripts/workflows-move.ts', import.meta.url)),
            '--application',
            engine.name,
            ...args,
          ],
          { env: process.env, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let out = '',
          err = '';
        script.stdout!.on('data', chunk => (out += String(chunk)));
        script.stderr!.on('data', chunk => (err += String(chunk)));
        script.once('error', reject);
        script.once('exit', code => resolve({ code, out, err }));
      });
    let child: ReturnType<typeof spawn> | undefined, launched: Awaited<ReturnType<typeof engine.launch>> | undefined;
    try {
      // Two jobs' workflows, due in the past, committed before any engine runs.
      await database().transaction(async tx => {
        for (const id of jobs)
          await enqueueWorkflow(tx, engine.durable, {
            workflow: 'scheduledJob',
            id: 'job:' + id,
            input: { id, dueAt: '2001-01-01T00:00:00.000Z' },
          });
      });
      // The older release takes both from the queue and is killed in their steps, as a deployment replaces it.
      child = spawn(
        process.execPath,
        ['--import', 'tsx', fileURLToPath(new URL('./fixtures/durable-job-child.ts', import.meta.url))],
        {
          env: { ...process.env, DURABLE_APP: engine.name, DURABLE_EXECUTOR: instance, DURABLE_RELEASE: releases[0] },
          stdio: ['ignore', 'pipe', 'inherit'],
        },
      );
      await new Promise<void>((resolve, reject) => {
        let out = '';
        const timeout = setTimeout(() => reject(new Error('the older release did not take the jobs')), 30_000);
        child!.once('exit', code => reject(new Error('the older release exited during startup: ' + code)));
        child!.stdout!.on('data', chunk => {
          out += String(chunk);
          if (waiting.every(id => out.includes('took ' + id))) {
            clearTimeout(timeout);
            resolve();
          }
        });
      });
      await new Promise<void>(resolve => {
        child!.once('exit', () => resolve());
        child!.kill('SIGKILL');
      });
      // Each recorded the clock it read before its wait, its step 0, and was killed in its step, step 1.
      const before = new Map<string, Awaited<ReturnType<typeof steps>>>();
      for (const id of waiting) {
        assert.deepEqual(await status(id), {
          status: 'PENDING',
          application_version: releases[0],
          queue_name: engine.durable.queue,
        });
        before.set(id, await steps(id));
        assert.deepEqual(
          before.get(id)!.map(s => [s.function_id, s.function_name]),
          [[0, 'DBOS.now']],
        );
      }

      // The instance comes back as the next release, and its approved execution fails until it ends in ERROR.
      launched = await engine.launch({ executorID: instance, applicationVersion: releases[1] });
      await database().transaction(tx =>
        enqueueWorkflow(tx, engine.durable, { workflow: 'approvedExecution', id: failing, input: failing }),
      );

      // The operator lists what waits under the older version. Nothing moves.
      const listed = await move();
      assert.equal(listed.code, 0, listed.err);
      for (const id of waiting)
        assert.match(
          listed.out,
          new RegExp(
            `^${id} \\(scheduledJob, PENDING under ${releases[0]}\\) would continue under ${releases[1]} from step 1\\.$`,
            'm',
          ),
        );
      assert.doesNotMatch(listed.out, new RegExp(failing));
      assert.match(listed.out, /Nothing was moved\. Run again with --confirm to move\./);
      for (const id of waiting) assert.equal((await status(id))?.application_version, releases[0]);
      assert.deepEqual(ran, []);

      // Then moves them: each runs once under the next release, under its own id, and what it recorded stands.
      const moved = await move('--confirm');
      assert.equal(moved.code, 0, moved.err);
      for (const id of waiting) {
        assert.match(
          moved.out,
          new RegExp(
            `^${id} \\(scheduledJob, PENDING under ${releases[0]}\\) moved to ${releases[1]}, from step 1\\.$`,
            'm',
          ),
        );
        await until(async () => (await status(id))?.status === 'SUCCESS', `${id} did not run under the next release`);
        assert.deepEqual(await status(id), {
          status: 'SUCCESS',
          application_version: releases[1],
          queue_name: engine.durable.queue,
        });
        const after = await steps(id);
        assert.deepEqual(after[0], before.get(id)![0]);
        assert.deepEqual(
          after.map(s => [s.function_id, s.function_name]),
          [
            [0, 'DBOS.now'],
            [1, 'runScheduledJob'],
          ],
        );
      }
      assert.deepEqual([...ran].sort(), [...jobs].sort());
      // A finished workflow is refused, and nothing waits any more.
      const finished = await move('--workflow', waiting[0]!, '--confirm');
      assert.equal(finished.code, 1);
      assert.match(finished.err, new RegExp(`^${waiting[0]}: not moved, it has finished\\.$`, 'm'));
      const none = await move();
      assert.equal(none.code, 0, none.err);
      assert.match(
        none.out,
        new RegExp(`^Nothing of ${engine.name} waits under another version than ${releases[1]}\\.$`, 'm'),
      );

      // The execution ended in ERROR after its step failed five times. Once its cause is fixed, the operator names it,
      // and it starts again from the step that failed, under its own id.
      await until(async () => (await status(failing))?.status === 'ERROR', `${failing} did not end in ERROR`, 150);
      assert.equal(progressed, 5);
      fixed = true;
      const restarted = await move('--workflow', failing, '--confirm');
      assert.equal(restarted.code, 0, restarted.err);
      assert.match(
        restarted.out,
        new RegExp(
          `^${failing} \\(approvedExecution, ERROR under ${releases[1]}\\) moved to ${releases[1]}, from step 0\\.$`,
          'm',
        ),
      );
      await until(async () => (await status(failing))?.status === 'SUCCESS', `${failing} did not start again`);
      assert.equal(progressed, 6);
      assert.deepEqual([...ran].sort(), [...jobs].sort());
    } finally {
      if (child && child.exitCode === null) child.kill('SIGKILL');
      await launched?.shutdown();
      await engine.forget();
      await database().execute(sql`delete from dbos.application_versions where application_name = ${engine.name}`);
      await closeDatabase();
    }
  },
);

async function until(done: () => Promise<boolean>, failure: string, tries = 100) {
  for (let i = 0; i < tries; i++) {
    if (await done()) return;
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  throw new Error(failure);
}
