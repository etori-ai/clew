/**
 * The experiment driver. Spawns app instances as child processes (one per executor id), drives them over HTTP,
 * kills them with SIGKILL and reads the tables back. Run inside the devcontainer:
 *   node_modules/.bin/tsx src/experiment.ts [scenario ...]
 * Scenarios: basic atomic recovery version timing. Logs per instance in .logs/.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync, openSync } from 'node:fs';

const NODE_ARGS = ['--import', 'tsx', 'src/app.ts'];
mkdirSync('.logs', { recursive: true });

type Instance = { name: string; port: number; child: ChildProcess; executorID: string };
const instances = new Map<string, Instance>();
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
const t0 = Date.now();
/** Workflow ids are unique for the life of the system database, so every run gets its own id prefix. */
const RUN = t0.toString(36);
const tid = (name: string) => `${RUN}-${name}`;
const log = (...parts: unknown[]) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)}s]`, ...parts);

async function start(
  name: string,
  port: number,
  executorID: string,
  env: Record<string, string> = {},
): Promise<Instance> {
  const out = openSync(`.logs/${name}-${Date.now()}.log`, 'a');
  const child = spawn(process.execPath, NODE_ARGS, {
    env: { ...process.env, PORT: String(port), EXECUTOR_ID: executorID, ...env },
    stdio: ['ignore', out, out],
  });
  const instance = { name, port, child, executorID };
  instances.set(name, instance);
  for (let attempt = 0; attempt < 100; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) {
        const health = (await response.json()) as { pid: number };
        if (health.pid !== child.pid)
          throw new Error(`${name}: port ${port} is answered by pid ${health.pid}, not our child ${child.pid}`);
        log(`started ${name} (executor ${executorID}, pid ${child.pid}) in ${attempt * 200} ms`);
        return instance;
      }
    } catch {
      /* not up yet */
    }
    if (child.exitCode !== null) throw new Error(`${name} exited with ${child.exitCode}; see .logs`);
    await sleep(200);
  }
  throw new Error(`${name} did not come up`);
}

async function kill(name: string) {
  const instance = instances.get(name);
  if (!instance) return;
  instance.child.kill('SIGKILL');
  instances.delete(name);
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      await fetch(`http://127.0.0.1:${instance.port}/health`);
    } catch {
      log(`SIGKILL ${name} (pid ${instance.child.pid}); port ${instance.port} is dead`);
      return;
    }
    await sleep(100);
  }
  throw new Error(`${name} still answers after SIGKILL`);
}

async function call<T>(instance: Instance, method: string, path: string, body?: unknown): Promise<T> {
  const response = await fetch(`http://127.0.0.1:${instance.port}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${method} ${path} -> ${response.status} ${text}`);
  return JSON.parse(text) as T;
}

type Timer = {
  id: string;
  generation: number;
  state: string;
  due_at: string;
  fired_at: string | null;
  fired_by: string | null;
  variant: string;
};
type Attempt = { id: string; generation: number; executor: string; outcome: string; at: string };
type Workflow = {
  id: string;
  status: string;
  name: string;
  executor_id: string;
  application_version: string | null;
  output: string | null;
  updated_at: string;
};
type State = { executorID: string; timers: Timer[]; attempts: Attempt[]; workflows: Workflow[] };

function show(state: State, title: string) {
  log(`--- ${title}`);
  for (const timer of state.timers) {
    const skew = timer.fired_at
      ? `${((Date.parse(timer.fired_at) - Date.parse(timer.due_at)) / 1000).toFixed(2)} s after due`
      : '-';
    log(
      `  timer ${timer.id} gen ${timer.generation} ${timer.state} ${timer.variant} fired_by=${timer.fired_by ?? '-'} ${skew}`,
    );
  }
  for (const workflow of state.workflows)
    log(
      `  wf ${workflow.id} ${workflow.status} executor=${workflow.executor_id} version=${workflow.application_version?.slice(0, 8) ?? 'null'} output=${workflow.output ?? '-'}`,
    );
  for (const attempt of state.attempts)
    log(`  attempt ${attempt.id} gen ${attempt.generation} by ${attempt.executor}: ${attempt.outcome}`);
}

const fired = (state: State, id: string) => state.attempts.filter(a => a.id === id && a.outcome === 'fired').length;

async function basic() {
  log('=== basic: fire once, cancel, replace, both variants');
  const a = await start('A', 4101, 'a');
  await call(a, 'POST', '/reset');
  await call(a, 'POST', '/timers', { id: tid('basic-fire'), seconds: 4 });
  await call(a, 'POST', '/timers', { id: tid('basic-cancel'), seconds: 20 });
  await call(a, 'POST', '/timers', { id: tid('basic-replace'), seconds: 20 });
  await call(a, 'POST', '/timers', { id: tid('basic-sleep-fire'), seconds: 4, variant: 'sleep' });
  await call(a, 'POST', '/timers', { id: tid('basic-sleep-cancel'), seconds: 20, variant: 'sleep' });
  await call(a, 'POST', '/timers', { id: tid('basic-past'), seconds: -5 });
  await sleep(2000);
  const cancelledAt = Date.now();
  await call(a, 'POST', `/timers/${tid('basic-cancel')}/cancel`);
  await call(a, 'POST', `/timers/${tid('basic-sleep-cancel')}/cancel`);
  await call(a, 'POST', '/timers', { id: tid('basic-replace'), seconds: 5 });
  await sleep(8000);
  const state = await call<State>(a, 'GET', `/state?prefix=${tid('basic-')}`);
  show(state, 'basic after 10 s');
  const ended = (id: string) => state.workflows.find(w => w.id.startsWith(`${id}:`));
  log(
    `  cancel ended wf after ${((Date.parse(ended(tid('basic-cancel'))!.updated_at) - cancelledAt) / 1000).toFixed(1)} s (recv) / ` +
      `${((Date.parse(ended(tid('basic-sleep-cancel'))!.updated_at) - cancelledAt) / 1000).toFixed(1)} s (sleep+cancelWorkflow)`,
  );
  const checks = {
    'fire once': fired(state, tid('basic-fire')) === 1,
    'sleep variant fires once': fired(state, tid('basic-sleep-fire')) === 1,
    'past due fires at once': fired(state, tid('basic-past')) === 1,
    'cancel never fires': fired(state, tid('basic-cancel')) === 0,
    'sleep cancel never fires': fired(state, tid('basic-sleep-cancel')) === 0,
    'replace: only gen 2 fires':
      fired(state, tid('basic-replace')) === 1 &&
      state.attempts.every(x => x.id !== tid('basic-replace') || x.generation === 2),
  };
  for (const [name, ok] of Object.entries(checks)) log(`  ${ok ? 'PASS' : 'FAIL'} ${name}`);
  await kill('A');
}

async function atomic() {
  log('=== atomic: enqueue inside the transaction, rollback leaves nothing; latency of 20 commits');
  const a = await start('A', 4101, 'a');
  await call(a, 'POST', '/reset');
  await call(a, 'POST', '/timers', { id: tid('atomic-rollback'), seconds: 3, rollback: true });
  const latencies: number[] = [];
  for (let i = 0; i < 20; i++) {
    const result = await call<{ ms: number }>(a, 'POST', '/timers', {
      id: tid(`atomic-${String(i).padStart(2, '0')}`),
      seconds: 3,
    });
    latencies.push(result.ms);
  }
  await sleep(6500);
  const state = await call<State>(a, 'GET', `/state?prefix=${tid('atomic-')}`);
  const sorted = [...latencies].sort((x, y) => x - y);
  log(
    `  commit latency (intent row + enqueue, ms): median ${sorted[10]!.toFixed(1)} p95 ${sorted[18]!.toFixed(1)} max ${sorted[19]!.toFixed(1)}`,
  );
  const skews = state.timers
    .filter(t => t.fired_at)
    .map(t => (Date.parse(t.fired_at!) - Date.parse(t.due_at)) / 1000)
    .sort((x, y) => x - y);
  log(
    `  fire skew (s after due): min ${skews[0]?.toFixed(2)} median ${skews[Math.floor(skews.length / 2)]?.toFixed(2)} max ${skews.at(-1)?.toFixed(2)}`,
  );
  const checks = {
    'rollback left no intent row': !state.timers.some(t => t.id === tid('atomic-rollback')),
    'rollback left no workflow row': !state.workflows.some(w => w.id.startsWith(tid('atomic-rollback'))),
    'all 20 fired exactly once':
      state.timers.filter(t => t.id !== tid('atomic-rollback')).every(t => fired(state, t.id) === 1) &&
      state.attempts.length === 20,
  };
  for (const [name, ok] of Object.entries(checks)) log(`  ${ok ? 'PASS' : 'FAIL'} ${name}`);
  await kill('A');
}

async function recovery() {
  log('=== recovery: two instances, SIGKILL the owner, restart with same id / new id / takeover');
  const a = await start('A', 4101, 'a');
  const b = await start('B', 4102, 'b');
  await call(a, 'POST', '/reset');
  for (let i = 0; i < 6; i++) await call(i % 2 ? a : b, 'POST', '/timers', { id: tid(`rec-${i}`), seconds: 15 });
  await sleep(3000);
  let state = await call<State>(b, 'GET', `/state?prefix=${tid('rec-')}`);
  const owner = Object.fromEntries(state.workflows.map(w => [w.id.split(':')[0], w.executor_id]));
  log(`  owners after dequeue: ${JSON.stringify(owner)}`);
  const byA = Object.keys(owner).filter(id => owner[id] === 'a');
  const byB = Object.keys(owner).filter(id => owner[id] === 'b');
  const [victim, survivor, victimIds, survivorIds] = byA.length >= byB.length ? ['A', b, byA, byB] : ['B', a, byB, byA];
  const victimExecutor = victim === 'A' ? 'a' : 'b';
  const victimPort = victim === 'A' ? 4101 : 4102;
  await kill(victim);
  await sleep(20000);
  state = await call<State>(survivor, 'GET', `/state?prefix=${tid('rec-')}`);
  show(state, `after due time with ${victim} dead (${victimIds.length} of its timers), survivor alive`);
  log(
    `  ${survivorIds.every(id => fired(state, id) === 1) ? 'PASS' : 'FAIL'} survivor's own timers fired (${survivorIds.length})`,
  );
  log(
    `  ${victimIds.every(id => fired(state, id) === 0) ? 'OBSERVED' : 'UNEXPECTED'} dead executor's timers did not fire while it is dead (${victimIds.length} stranded)`,
  );

  log(`  restart ${victim} with the SAME executor id ${victimExecutor}`);
  await start(`${victim}2`, victimPort, victimExecutor);
  await sleep(6000);
  state = await call<State>(survivor, 'GET', `/state?prefix=${tid('rec-')}`);
  show(state, `after ${victim} restarted as executor ${victimExecutor}`);
  log(
    `  ${victimIds.every(id => fired(state, id) === 1) ? 'PASS' : 'FAIL'} dead executor's timers recovered and fired exactly once`,
  );
  await kill(`${victim}2`);

  log(
    '  second round: fresh pair, kill an owner, replace it with a NEW executor id z (a replaced pod), then take over',
  );
  await kill(survivor.name);
  const a3 = await start('A3', 4101, 'a');
  const b3 = await start('B3', 4102, 'b');
  for (let i = 0; i < 6; i++) await call(i % 2 ? a3 : b3, 'POST', '/timers', { id: tid(`rec2-${i}`), seconds: 12 });
  await sleep(3000);
  state = await call<State>(a3, 'GET', `/state?prefix=${tid('rec2-')}`);
  const owner2 = Object.fromEntries(state.workflows.map(w => [w.id.split(':')[0], w.executor_id]));
  log(`  owners: ${JSON.stringify(owner2)}`);
  const byA3 = Object.keys(owner2).filter(id => owner2[id] === 'a');
  const byB3 = Object.keys(owner2).filter(id => owner2[id] === 'b');
  const [victim2, other, victim2Ids] = byA3.length >= byB3.length ? [a3, b3, byA3] : [b3, a3, byB3];
  await kill(victim2.name);
  const z = await start('Z', victim2.port, 'z');
  await sleep(14000);
  state = await call<State>(z, 'GET', `/state?prefix=${tid('rec2-')}`);
  show(state, `after due time with executor ${victim2.executorID} dead and Z (new id) up`);
  log(
    `  ${victim2Ids.every(id => fired(state, id) === 0) ? 'OBSERVED' : 'UNEXPECTED'} dead executor's timers stranded under a new executor id (${victim2Ids.length})`,
  );
  log(`  takeover: Z adopts executor ${victim2.executorID} through recoverPendingWorkflows`);
  const recovered = await call<{ recovered: string[] }>(z, 'POST', '/recover', { executorIds: [victim2.executorID] });
  log(`  recovered: ${recovered.recovered.length} workflows`);
  await sleep(5000);
  state = await call<State>(z, 'GET', `/state?prefix=${tid('rec2-')}`);
  show(state, 'after takeover');
  log(
    `  ${victim2Ids.every(id => fired(state, id) === 1) ? 'PASS' : 'FAIL'} dead executor's timers fired exactly once after takeover`,
  );
  await kill(other.name);
  await kill('Z');
}

async function concurrency() {
  log('=== concurrency: a queue with workerConcurrency 2 holds sleeping reminders in its slots');
  const a = await start('A', 4101, 'a');
  await call(a, 'POST', '/reset');
  for (let i = 0; i < 4; i++)
    await call(a, 'POST', '/timers', { id: tid(`conc-${i}`), seconds: 4, queue: 'timers-limited' });
  await sleep(3000);
  let state = await call<State>(a, 'GET', `/state?prefix=${tid('conc-')}`);
  const pending = state.workflows.filter(w => w.status === 'PENDING').length;
  const enqueued = state.workflows.filter(w => w.status === 'ENQUEUED').length;
  log(`  at 3 s: ${pending} PENDING (sleeping, holding a slot), ${enqueued} still ENQUEUED`);
  await sleep(8000);
  state = await call<State>(a, 'GET', `/state?prefix=${tid('conc-')}`);
  show(state, 'after all fired');
  const skews = state.timers.map(t => (Date.parse(t.fired_at!) - Date.parse(t.due_at)) / 1000);
  log(
    `  ${enqueued === 2 && skews.some(x => x > 3) ? 'OBSERVED' : 'UNEXPECTED'} two timers waited for a slot and fired late (skews ${skews.map(x => x.toFixed(1)).join(', ')} s)`,
  );
  await kill('A');
}

async function version() {
  log('=== version: hash-versioned pending workflow across a code change, then pinned version');
  const a = await start('A', 4101, 'a');
  await call(a, 'POST', '/reset');
  await call(a, 'POST', '/timers', { id: tid('ver-hash'), seconds: 12 });
  await sleep(2000);
  await kill('A');
  log('  restart with changed workflow source (EXTRA_WORKFLOW=1), same executor id');
  const a2 = await start('A2', 4101, 'a', { EXTRA_WORKFLOW: '1' });
  await sleep(13000);
  let state = await call<State>(a2, 'GET', `/state?prefix=${tid('ver-')}`);
  show(state, 'after due time on new code');
  log(
    `  ${fired(state, tid('ver-hash')) === 0 ? 'OBSERVED' : 'UNEXPECTED'} workflow from the old hash version was not recovered by the new code`,
  );
  log('  try DBOS.resumeWorkflow from the new version');
  const resumed = await call<Record<string, string>>(a2, 'POST', '/resume', {
    workflowIds: [`${tid('ver-hash')}:v2:1`],
  });
  log(`  resume: ${JSON.stringify(resumed)}`);
  await sleep(4000);
  state = await call<State>(a2, 'GET', `/state?prefix=${tid('ver-')}`);
  show(state, 'after resume');
  log(
    `  ${fired(state, tid('ver-hash')) === 1 ? 'PASS' : 'OBSERVED'} resume ${fired(state, tid('ver-hash')) === 1 ? 'ran' : 'did not run'} the old-version workflow on the new code`,
  );
  log('  try DBOS.forkWorkflow(id, 0, { applicationVersion: current }) from the new version');
  const forked = await call<Record<string, string>>(a2, 'POST', '/fork', { workflowIds: [`${tid('ver-hash')}:v2:1`] });
  log(`  fork: ${JSON.stringify(forked)}`);
  await sleep(4000);
  state = await call<State>(a2, 'GET', `/state?prefix=${tid('ver-')}`);
  show(state, 'after fork');
  log(
    `  ${fired(state, tid('ver-hash')) === 1 ? 'PASS' : 'FAIL'} fork onto the current version fired the reminder exactly once`,
  );
  await kill('A2');

  log('  pinned version: DBOS__APPVERSION=1, code change between runs');
  const p1 = await start('P1', 4101, 'a', { DBOS__APPVERSION: '1' });
  await call(p1, 'POST', '/timers', { id: tid('ver-pinned'), seconds: 10 });
  await sleep(2000);
  await kill('P1');
  const p2 = await start('P2', 4101, 'a', { DBOS__APPVERSION: '1', EXTRA_WORKFLOW: '1' });
  await sleep(11000);
  state = await call<State>(p2, 'GET', `/state?prefix=${tid('ver-')}`);
  show(state, 'pinned, after due time');
  log(`  ${fired(state, tid('ver-pinned')) === 1 ? 'PASS' : 'FAIL'} pinned version recovered across the code change`);
  await kill('P2');
}

const scenarios: Record<string, () => Promise<void>> = { basic, atomic, concurrency, recovery, version };
const requested = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(scenarios);
(async () => {
  for (const name of requested) {
    const scenario = scenarios[name];
    if (!scenario) throw new Error(`unknown scenario ${name}`);
    await scenario();
  }
})()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    return Promise.all([...instances.keys()].map(name => kill(name)));
  });
