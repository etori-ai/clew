/**
 * The assistant's flows as a matrix: every scenario in `tests/assistant-scenarios.ts` down the side, every lane across
 * the top, judged on what the turn did. The lanes that need no model (D8) always run: the router alone, and the router
 * standing in for a model that fails; they are the same ones `bun run check` gates on. A model lane is added for every
 * entry in `evals/models.json` (see `evals/models.example.json`): the same scenarios, each run several times, answered
 * through the real OpenAI-compatible wire by a model on an endpoint the file names. Beside the models runs the control,
 * a loopback endpoint that speaks the protocol and answers every turn with the same sentence and no tool call: a flow it
 * holds is held by Clew, not by a model, and is marked so. Models on different endpoints run side by side; the runs
 * against one endpoint go one at a time, as an installation's turns would not.
 *
 *   docker exec -w /workspace clew-app-1 bun scripts/model-matrix.ts [--repeat 3] [--only <scenario>] [--models <file>] [--publish]
 *   docker exec -w /workspace clew-app-1 bun scripts/model-matrix.ts --control
 *   docker exec -w /workspace clew-app-1 bun scripts/model-matrix.ts --rejudge [--publish]
 *
 * `--control` runs the model lane with the control alone when no model is named: it proves the lane end to end without a
 * model, and is expected to fail most scenarios. Every run is kept as it happened in `evals/results/runs.json`; `--rejudge` asks no model and judges the kept runs
 * again, after an expectation has changed. `--publish` records the models in `docs/reference/model-results.json`, which
 * the page `docs/reference/models.md` is drawn from (`bun run docs:generate`). The exit code is that of the no-model
 * lanes; a model's pass rate is reported, never a failure of the run.
 *
 * The runner is Clew's own and has no dependency of its own: the world, the scenarios and the judging are the unit
 * suite's, the wire is the server's. Nothing leaves the machine but the turns sent to the endpoints the models file names.
 */
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { createGenerator } from '../apps/server/src/assistant/model';
import {
  DIMENSIONS,
  LANES,
  WHO,
  runScenario,
  scenarios as all,
  type Scenario,
  type Trajectory,
} from '../tests/assistant-scenarios';
import { printMatrix, tally, type Cell, type Kept, type KeptColumn, type KeptMatrix } from './model-matrix-report';
import type { ModelResults, PublishedModel } from './model-results';

const root = resolve(import.meta.dirname, '..');
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
const flag = (name: string) => process.argv.includes(name);

/** A model to play the model lane: one model id on one OpenAI-compatible endpoint, as an administrator would add it (D24). */
interface ModelEntry {
  /** A note beside the model's id in the report, such as the server or the quantisation it runs at. Optional. */
  label?: string;
  baseUrl: string;
  model: string;
  /** Whether the model takes tools; true unless said otherwise. */
  tools?: boolean;
  reasoning?: 'provider-default' | 'none';
  /** The name of the environment variable that holds the endpoint's key, when it needs one. The key is never in the file. */
  keyEnv?: string;
}
const keptFile = resolve(root, 'evals/results/runs.json');
const only = arg('--only');
const scenarios = only ? all.filter(s => s.id === only) : all;
if (!scenarios.length) throw new Error(`no scenario is called ${only}`);

/** A column while it runs: what is kept of it, the endpoint whose turn it waits for, and how a scenario is run in it. */
interface Column extends KeptColumn {
  endpoint: string;
  times: number;
  run: (scenario: Scenario) => Promise<Trajectory>;
}
async function run(name: KeptMatrix['name'], title: string, columns: Column[]): Promise<KeptMatrix> {
  const runs: KeptMatrix['runs'] = [];
  const total = scenarios.length * columns.reduce((n, c) => n + c.times, 0);
  const queues = new Map<string, Column[]>();
  for (const c of columns) queues.set(c.endpoint, [...(queues.get(c.endpoint) ?? []), c]);
  await Promise.all(
    [...queues.values()].map(async own => {
      for (const column of own)
        for (const scenario of scenarios)
          for (let i = 0; i < column.times; i++) {
            const started = performance.now();
            let outcome: { trajectory: Trajectory } | { error: string };
            try {
              outcome = { trajectory: await column.run(scenario) };
            } catch (e) {
              outcome = { error: e instanceof Error ? e.message : String(e) };
            }
            runs.push({
              column: column.id,
              scenario: scenario.id,
              ms: Math.round(performance.now() - started),
              ...outcome,
            });
            if (process.stderr.isTTY) process.stderr.write(`\r  ${runs.length} of ${total} runs`);
          }
    }),
  );
  if (process.stderr.isTTY) process.stderr.write('\r\x1b[K');
  // In the order of the columns and the scenarios, whatever order the endpoints answered in.
  const order = (id: string, of: readonly { id: string }[]) => of.findIndex(o => o.id === id);
  runs.sort(
    (a, b) => order(a.column, columns) - order(b.column, columns) || order(a.scenario, all) - order(b.scenario, all),
  );
  return {
    name,
    title,
    columns: columns.map(({ endpoint: _endpoint, times: _times, run: _run, ...kept }) => kept),
    runs,
  };
}

/**
 * The control: an endpoint that speaks the protocol and is no model. It streams one fixed sentence and calls no tool.
 * Beside models it is the column they are read against; alone it is a lane like any other.
 */
async function control(beside: boolean): Promise<Column> {
  const server = createServer(async (req, res) => {
    for await (const _ of req) void _;
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'not found' } }));
    }
    const chunk = (delta: object, finish: string | null) =>
      `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'control', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(chunk({ role: 'assistant', content: 'Det vet jag inte.' }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n');
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  server.unref();
  const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  const generate = createGenerator({ baseUrl }, 'control');
  return {
    id: 'control',
    label: 'No model (control)',
    ...(beside ? { control: true as const } : { detail: 'protocol only' }),
    endpoint: baseUrl,
    // It answers the same way every time, so once is enough.
    times: 1,
    run: scenario => runScenario(scenario, 'model', { generate, tools: true }),
  };
}

async function runAll(): Promise<Kept> {
  const modelsFile = resolve(root, arg('--models') ?? 'evals/models.json');
  const models: ModelEntry[] = existsSync(modelsFile) ? JSON.parse(readFileSync(modelsFile, 'utf8')) : [];
  const repeat = Number(arg('--repeat') ?? 3);
  const LABEL = { router: 'No model (router)', unavailable: 'Model fails (router stands in)' };
  const matrices = [
    await run(
      'no-model',
      "The assistant's flows without a model",
      LANES.map(lane => ({
        id: 'clew:' + lane,
        label: LABEL[lane],
        endpoint: 'none',
        times: 1,
        run: scenario => runScenario(scenario, lane),
      })),
    ),
  ];
  if (models.length || flag('--control')) {
    const columns = models.map((m, i): Column => {
      const key = m.keyEnv ? process.env[m.keyEnv] : undefined;
      if (m.keyEnv && !key) throw new Error(`${m.model}: the environment variable ${m.keyEnv} is not set`);
      const tools = m.tools ?? true;
      const reasoning = m.reasoning ?? 'provider-default';
      const generate = createGenerator(
        { baseUrl: m.baseUrl, ...(key ? { apiKey: key } : {}) },
        m.model,
        undefined,
        reasoning,
      );
      return {
        id: `model:${i}:${m.model}`,
        label: m.model,
        detail: [
          m.label,
          new URL(m.baseUrl).host,
          tools ? 'tools on' : 'tools off',
          reasoning === 'none' ? 'reasoning off' : '',
        ]
          .filter(Boolean)
          .join(' · '),
        model: { model: m.model, ...(m.label ? { note: m.label } : {}), tools, reasoning },
        endpoint: new URL(m.baseUrl).host,
        times: repeat,
        run: scenario => runScenario(scenario, 'model', { generate, tools }),
      };
    });
    matrices.push(
      await run(
        'models',
        columns.length
          ? `The assistant's flows by model · ${repeat} ${repeat === 1 ? 'run' : 'runs'} each`
          : "The assistant's flows through the model lane · the control alone",
        [await control(columns.length > 0), ...columns],
      ),
    );
  }
  let commit: string | undefined;
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
  } catch {
    commit = undefined;
  }
  return {
    version: 1,
    ranOn: new Date().toISOString().slice(0, 10),
    ...(commit ? { commit } : {}),
    repeat,
    ...(only ? { only } : {}),
    matrices,
  };
}

/**
 * What the page `docs/reference/models.md` is drawn from: each model just run replaces its earlier entry in
 * `docs/reference/model-results.json`, the other models stay; the page lists the flows as the scenarios define them
 * when it is drawn. Where the model runs is not written, since an endpoint's address is an installation's own; the note
 * in the models file is. The control is no model and is published only as the flows it held, beside each model it ran
 * with. A run narrowed with `--only` is never published.
 */
function publish(kept: Kept, matrix: KeptMatrix, cells: Map<string, Cell>) {
  if (only || kept.only) return console.log('\n  Not published: the run was narrowed with --only.');
  const held = (column: KeptColumn) =>
    scenarios.filter(s => {
      const cell = cells.get(`${s.id}|${column.id}`);
      return !!cell && cell.passed === cell.runs;
    });
  const controlColumn = matrix.columns.find(c => c.control);
  const heldWithoutModel = controlColumn ? held(controlColumn).map(s => s.id) : [];
  const ran: PublishedModel[] = matrix.columns.flatMap(column => {
    if (!column.model) return [];
    const own = scenarios.flatMap(s => {
      const cell = cells.get(`${s.id}|${column.id}`);
      return cell ? [{ id: s.id, cell }] : [];
    });
    const runs = own.reduce((n, o) => n + o.cell.runs, 0);
    const tokens = own.reduce((n, o) => n + o.cell.tokens, 0);
    const slow = own.reduce((n, o) => n + o.cell.slow, 0);
    return [
      {
        ...column.model,
        ranOn: kept.ranOn,
        ...(kept.commit ? { commit: kept.commit } : {}),
        repeat: kept.repeat,
        msPerRun: Math.round(own.reduce((n, o) => n + o.cell.ms, 0) / Math.max(runs, 1)),
        ...(tokens ? { tokensPerRun: Math.round(tokens / Math.max(runs, 1)) } : {}),
        ...(slow ? { slowRuns: slow } : {}),
        heldWithoutModel,
        dimensions: Object.fromEntries(
          DIMENSIONS.map(d => [
            d,
            [own.reduce((n, o) => n + (o.cell.dimensions.get(d) ?? 0), 0), runs] as [number, number],
          ]),
        ),
        flows: Object.fromEntries(
          own.map(o => [
            o.id,
            {
              passed: o.cell.passed,
              runs: o.cell.runs,
              failures: [...o.cell.failures.values()].map(f => ({ ...f, message: f.message.slice(0, 240) })),
            },
          ]),
        ),
      },
    ];
  });
  if (!ran.length) return console.log('\n  Not published: no model was run.');
  const file = resolve(root, 'docs/reference/model-results.json');
  const earlier: ModelResults = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, models: [] };
  const key = (m: PublishedModel) => `${m.model}|${m.note ?? ''}`;
  const results: ModelResults = {
    version: 1,
    models: [...earlier.models.filter(m => !ran.some(r => key(r) === key(m))), ...ran].sort((a, b) =>
      key(a).localeCompare(key(b)),
    ),
  };
  writeFileSync(file, JSON.stringify(results, null, 2) + '\n');
  console.log(
    `\n  Published ${ran.map(m => m.model).join(', ')} to docs/reference/model-results.json. Run bun run docs:generate to redraw docs/reference/models.md.`,
  );
}

let kept: Kept;
if (flag('--rejudge')) {
  if (!existsSync(keptFile)) throw new Error(`there is no kept run to judge again (${relative(root, keptFile)})`);
  kept = JSON.parse(readFileSync(keptFile, 'utf8')) as Kept;
  console.log(
    `\nJudging the run of ${kept.ranOn}${kept.commit ? ` at ${kept.commit}` : ''} again; no model is asked.` +
      (kept.only ? ` It was narrowed to ${kept.only}.` : ''),
  );
} else {
  kept = await runAll();
  mkdirSync(dirname(keptFile), { recursive: true });
  writeFileSync(keptFile, JSON.stringify(kept, null, 2) + '\n');
}

let failed = 0;
for (const matrix of kept.matrices) {
  const cells = tally(matrix.runs, scenarios);
  const ran = scenarios.filter(s => matrix.columns.some(c => cells.has(`${s.id}|${c.id}`)));
  const unheld = printMatrix(
    matrix.title,
    matrix.columns.map(c => ({
      name: c.label,
      ...(c.detail ? { detail: c.detail } : {}),
      ...(c.control ? { control: true } : {}),
    })),
    ran.map(s => ({
      id: s.id,
      flow: s.flow,
      who: WHO[s.persona],
      says: s.turns.map(t => t.say),
      holdsWhen: s.holdsWhen,
      // A scenario that says nothing of what a model has to manage is judged on the rules every turn keeps, and marked.
      rulesOnly: matrix.name === 'models' && !s.turns.some(t => t.model),
      cells: matrix.columns.map(c => cells.get(`${s.id}|${c.id}`)),
    })),
    relative(root, keptFile),
  );
  if (matrix.name === 'no-model') failed = unheld;
  else if (flag('--publish')) publish(kept, matrix, cells);
}
if (kept.matrices.length < 2)
  console.log(
    '\nNo model lane: evals/models.json names no model (see evals/models.example.json), and --control was not given.',
  );
process.exit(failed ? 1 : 0);
