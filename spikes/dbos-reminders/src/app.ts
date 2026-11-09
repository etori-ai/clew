/**
 * One "BFF instance" of the spike: DBOS in-process (like Clew's in-process Temporal worker) plus a tiny HTTP
 * control surface the experiment driver talks to. Several instances run against the same database with
 * different executor ids, which is the production shape under test.
 *
 * Env: PORT, EXECUTOR_ID (DBOS `executorID`), DBOS__APPVERSION (pin the version; unset = source hash),
 * EXTRA_WORKFLOW (changes the source hash, see workflows.ts).
 */
import http from 'node:http';
import { createRequire } from 'node:module';
import { DBOS } from '@dbos-inc/dbos-sdk';
import { databaseUrl, migrate, pool, resetTables } from './db.js';
import { durableReminder, sleepReminder, workflowId, type Outcome } from './workflows.js';

/** `DBOSExecutor` is not exported by the package; the takeover experiment needs its `recoverPendingWorkflows`. */
const internal = createRequire(import.meta.url)(
  new URL('../node_modules/@dbos-inc/dbos-sdk/dist/src/dbos-executor.js', import.meta.url).pathname,
) as {
  DBOSExecutor: {
    globalInstance?: { recoverPendingWorkflows(executorIDs?: string[]): Promise<{ workflowID: string }[]> };
  };
};
const APP_NAME = 'clew-spike';
const QUEUE = 'timers';
const port = Number(process.env.PORT ?? 4101);
const executorID = process.env.EXECUTOR_ID ?? 'local';

type TimerRequest = { id: string; seconds: number; variant?: 'recv' | 'sleep'; rollback?: boolean; queue?: string };

/**
 * The write under test: intent row, cancel of the previous generation and start of the new one in ONE transaction
 * through DBOS's PL/pgSQL functions. Clew does this today with an outbox row and a separate Temporal client call.
 */
async function setTimer(request: TimerRequest) {
  const variant = request.variant ?? 'recv';
  const client = await pool.connect();
  const started = performance.now();
  try {
    await client.query('begin');
    const previous = await client.query<{ generation: number; variant: string }>(
      'select generation, variant from timer_intent where id = $1 for update',
      [request.id],
    );
    const generation = (previous.rows[0]?.generation ?? 0) + 1;
    const dueAt = new Date(Date.now() + request.seconds * 1000).toISOString();
    await client.query(
      `insert into timer_intent (id, generation, due_at, state, variant) values ($1, $2, $3, 'active', $4)
         on conflict (id) do update set generation = $2, due_at = $3, state = 'active', variant = $4,
           fired_at = null, fired_by = null, updated_at = now()`,
      [request.id, generation, dueAt, variant],
    );
    if (previous.rows[0] && previous.rows[0].variant === 'recv') {
      await client.query(`select dbos.send_message($1, '"replaced"'::json, 'cancel')`, [
        workflowId(request.id, previous.rows[0].generation),
      ]);
    }
    const input = JSON.stringify({ id: request.id, generation, dueAt });
    await client.query(
      `select dbos.enqueue_workflow(workflow_name => $1, queue_name => $2, positional_args => array[$3::json],
         workflow_id => $4, application_name => $5)`,
      [
        variant === 'recv' ? 'durableReminder' : 'sleepReminder',
        request.queue ?? QUEUE,
        input,
        workflowId(request.id, generation),
        APP_NAME,
      ],
    );
    if (request.rollback) {
      await client.query('rollback');
      return { id: request.id, generation, dueAt, rolledBack: true, ms: performance.now() - started };
    }
    await client.query('commit');
    // The sleep variant has no in-transaction cancel: the previous generation is cancelled after commit, like a
    // Temporal signal would be, and the generation fence covers the gap.
    if (previous.rows[0] && previous.rows[0].variant === 'sleep') {
      await DBOS.cancelWorkflow(workflowId(request.id, previous.rows[0].generation)).catch(() => undefined);
    }
    return {
      id: request.id,
      generation,
      dueAt,
      workflowId: workflowId(request.id, generation),
      ms: performance.now() - started,
    };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function cancelTimer(id: string) {
  const client = await pool.connect();
  try {
    await client.query('begin');
    const row = await client.query<{ generation: number; variant: string }>(
      `update timer_intent set state = 'cancelled', updated_at = now() where id = $1 and state = 'active' returning generation, variant`,
      [id],
    );
    const current = row.rows[0];
    if (current?.variant === 'recv') {
      await client.query(`select dbos.send_message($1, '"cancel"'::json, 'cancel')`, [
        workflowId(id, current.generation),
      ]);
    }
    await client.query('commit');
    if (current?.variant === 'sleep')
      await DBOS.cancelWorkflow(workflowId(id, current.generation)).catch(() => undefined);
    return { id, generation: current?.generation ?? null, cancelledAt: new Date().toISOString() };
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

async function state(prefix: string) {
  const timers = await pool.query('select * from timer_intent where id like $1 order by id', [`${prefix}%`]);
  const attempts = await pool.query('select * from timer_attempt where id like $1 order by seq', [`${prefix}%`]);
  const workflows = await pool.query(
    `select workflow_uuid as id, status, name, executor_id, application_version, queue_name, output, error,
            to_timestamp(created_at / 1000.0) as created_at, to_timestamp(updated_at / 1000.0) as updated_at
       from dbos.workflow_status where workflow_uuid like $1 order by workflow_uuid`,
    [`${prefix}%`],
  );
  return { executorID: DBOS.executorID, timers: timers.rows, attempts: attempts.rows, workflows: workflows.rows };
}

function json(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}
async function body<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return chunks.length ? (JSON.parse(Buffer.concat(chunks).toString()) as T) : ({} as T);
}

async function main() {
  await migrate();
  DBOS.setConfig({
    name: APP_NAME,
    systemDatabaseUrl: databaseUrl(),
    executorID,
    logLevel: process.env.DBOS_LOG_LEVEL ?? 'info',
    systemDatabasePoolSize: 5,
  });
  const launchedAt = performance.now();
  await DBOS.launch();
  // Only executors on the application's latest registered version dequeue (blue/green rule). A version is "latest" by
  // registration time, so a rollback, or a pinned version registered after a hashed one, stops dequeuing until promoted.
  const latest = await DBOS.getLatestApplicationVersion().catch(() => undefined);
  if (latest?.versionName !== DBOS.applicationVersion) {
    await DBOS.setLatestApplicationVersion(DBOS.applicationVersion);
    console.log(`[app] promoted version ${DBOS.applicationVersion} to latest (was ${latest?.versionName ?? 'none'})`);
  }
  // No concurrency limit on the reminder queue: a sleeping reminder holds a slot for as long as it sleeps.
  await DBOS.registerQueue(QUEUE);
  await DBOS.registerQueue('timers-limited', { workerConcurrency: 2, globalConcurrency: 2 });
  console.log(
    `[app] launched in ${Math.round(performance.now() - launchedAt)} ms, executor ${DBOS.executorID}, port ${port}`,
  );
  void durableReminder;
  void sleepReminder;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    (async () => {
      if (req.method === 'GET' && url.pathname === '/health')
        return json(res, 200, { ok: true, executorID: DBOS.executorID, pid: process.pid });
      if (req.method === 'POST' && url.pathname === '/timers')
        return json(res, 200, await setTimer(await body<TimerRequest>(req)));
      if (req.method === 'POST' && url.pathname.endsWith('/cancel'))
        return json(res, 200, await cancelTimer(decodeURIComponent(url.pathname.split('/')[2]!)));
      if (req.method === 'GET' && url.pathname === '/state')
        return json(res, 200, await state(url.searchParams.get('prefix') ?? ''));
      if (req.method === 'POST' && url.pathname === '/reset') {
        await resetTables();
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && url.pathname === '/recover') {
        // Open-source takeover: a live instance adopts a dead executor's PENDING workflows. Internal API in 5.4.0.
        const { executorIds } = await body<{ executorIds: string[] }>(req);
        const handles = await internal.DBOSExecutor.globalInstance!.recoverPendingWorkflows(executorIds);
        return json(res, 200, { recovered: handles.map(h => h.workflowID) });
      }
      if (req.method === 'POST' && url.pathname === '/fork') {
        const { workflowIds } = await body<{ workflowIds: string[] }>(req);
        const results: Record<string, string> = {};
        for (const id of workflowIds) {
          try {
            const handle = await DBOS.forkWorkflow<Outcome>(id, 0, {
              applicationVersion: DBOS.applicationVersion,
              newWorkflowID: `${id}:fork`,
            });
            results[id] = `forked as ${handle.workflowID}`;
          } catch (error) {
            results[id] = `error: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        return json(res, 200, results);
      }
      if (req.method === 'POST' && url.pathname === '/resume') {
        const { workflowIds } = await body<{ workflowIds: string[] }>(req);
        const results: Record<string, string> = {};
        for (const id of workflowIds) {
          try {
            await DBOS.resumeWorkflow<Outcome>(id);
            results[id] = 'resumed';
          } catch (error) {
            results[id] = `error: ${error instanceof Error ? error.message : String(error)}`;
          }
        }
        return json(res, 200, results);
      }
      json(res, 404, { error: 'not found' });
    })().catch(error => {
      console.error('[app] request failed', error);
      json(res, 500, { error: error instanceof Error ? error.message : String(error) });
    });
  });
  server.listen(port, '127.0.0.1', () => console.log(`[app] listening on ${port}`));
  const stop = async () => {
    server.close();
    await DBOS.shutdown();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}

main().catch(error => {
  console.error('[app] failed to start', error);
  process.exit(1);
});
