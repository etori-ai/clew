/**
 * The assistant's flows as a matrix: every scenario in `tests/assistant-scenarios.ts` down the side, every lane across
 * the top, judged on what the turn did. The lanes that need no model (D8) always run: the router alone, and the router
 * standing in for a model that fails. A model lane is added for every entry in `models.json` (see
 * `models.example.json`): the same scenarios, each run several times, answered through the real OpenAI-compatible wire
 * by a model on an endpoint the file names. promptfoo runs the matrix, keeps the results and draws the report; the
 * world, the scenarios and the judging are Clew's own, and the no-model lanes are the same ones `bun run check` gates on.
 *
 *   docker exec -w /workspace/evals clew-app-1 node --import tsx run.ts [--repeat 3] [--stand-in] [--only <scenario>] [--publish]
 *
 * `--stand-in` adds a model lane played by a loopback endpoint that speaks the protocol and answers every turn with the
 * same sentence and no tool call: it proves the model lane end to end without a model, and is expected to fail most
 * scenarios. `--publish` records the models just run in `docs/reference/model-results.json`, which the page
 * `docs/reference/models.md` is drawn from (`bun run docs:generate`). The exit code is that of the no-model lanes; a model's pass rate is reported, never a failure of the run.
 *
 * Nothing leaves the machine but the turns sent to the endpoints `models.json` names: promptfoo's telemetry, update
 * check, sharing and hosted features are switched off before it is loaded, its database stays in this folder, and every
 * other connection off the loopback is refused.
 */
import net from 'node:net';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import type { ModelResults, PublishedModel } from '../scripts/model-results';
import { resolve } from 'node:path';

const here = import.meta.dirname;
const arg = (name: string) => {
  const i = process.argv.indexOf(name);
  return i > 0 ? process.argv[i + 1] : undefined;
};
Object.assign(process.env, {
  PROMPTFOO_DISABLE_TELEMETRY: '1',
  PROMPTFOO_DISABLE_UPDATE: '1',
  PROMPTFOO_DISABLE_SHARING: '1',
  PROMPTFOO_DISABLE_REMOTE_GENERATION: 'true',
  PROMPTFOO_SELF_HOSTED: '1',
  PROMPTFOO_CONFIG_DIR: resolve(here, '.promptfoo'),
});

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
const modelsFile = resolve(here, 'models.json');
const models: ModelEntry[] = existsSync(modelsFile) ? JSON.parse(readFileSync(modelsFile, 'utf8')) : [];

/**
 * Nothing but the loopback and the model endpoints is reachable from this process: a connection anywhere else is
 * refused before a name is looked up, and listed at the end. promptfoo 0.125.1 posts one "telemetry disabled" event to
 * its own host even with telemetry switched off; this is what stops it.
 */
const allowed = new Set(models.map(m => new URL(m.baseUrl).hostname));
const refused: string[] = [];
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (this: net.Socket, ...args: unknown[]) {
  const first = args[0] as { host?: string; path?: string } | number | string | undefined;
  const host =
    typeof first === 'object' && first ? (first.path ?? first.host ?? 'localhost') : String(args[1] ?? 'localhost');
  if (/^(localhost$|127\.|::1$|\/)/.test(host) || allowed.has(host))
    return (connect as (...a: unknown[]) => net.Socket).apply(this, args);
  refused.push(host);
  process.nextTick(() => this.destroy(new Error(`evals: a connection to ${host} was refused`)));
  return this;
} as typeof connect;

/** The stand-in: an endpoint that speaks the protocol and is no model. It streams one fixed sentence and calls no tool. */
async function standIn(): Promise<ModelEntry> {
  const server = createServer(async (req, res) => {
    for await (const _ of req) void _;
    if (req.method !== 'POST' || req.url !== '/v1/chat/completions') {
      res.writeHead(404, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ error: { message: 'not found' } }));
    }
    const chunk = (delta: object, finish: string | null) =>
      `data: ${JSON.stringify({ id: 'x', object: 'chat.completion.chunk', created: 1, model: 'stand-in', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`;
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.end(chunk({ role: 'assistant', content: 'Det vet jag inte.' }, null) + chunk({}, 'stop') + 'data: [DONE]\n\n');
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  server.unref();
  return {
    label: 'no model, protocol only',
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    model: 'stand-in',
  };
}
if (process.argv.includes('--stand-in')) models.push(await standIn());

const { DIMENSIONS, LANES, WHO, judge, runScenario, scenarios: all } = await import('../tests/assistant-scenarios');
const { createGenerator } = await import('../apps/server/src/assistant/model');
type Scenario = (typeof all)[number];
type Trajectory = Awaited<ReturnType<typeof runScenario>>;
const { evaluate } = await import('promptfoo');
const { printMatrix } = await import('./report');
type Cell = import('./report').Cell;

const only = arg('--only');
const scenarios = only ? all.filter(s => s.id === only) : all;
if (!scenarios.length) throw new Error(`no scenario is called ${only}`);
const byId = new Map(scenarios.map(s => [s.id, s]));
const repeat = Number(arg('--repeat') ?? 3);
const out = resolve(here, 'results');
mkdirSync(out, { recursive: true });

interface Column {
  id: string;
  /** A model's id as its endpoint lists it, or the name of a lane without a model: what the column is called everywhere. */
  label: string;
  /** Where the model runs and how it was called. */
  detail?: string;
  run: (scenario: Scenario) => Promise<Trajectory>;
}
const tests = scenarios.map(scenario => ({
  description: `${scenario.id}: ${scenario.flow}`,
  // The scenario's name runs it; the rest is there to be read beside the result in promptfoo's own report.
  vars: {
    scenario: scenario.id,
    who: WHO[scenario.persona],
    types: scenario.turns.map(t => t.say).join(' / '),
    holdsWhen: scenario.holdsWhen,
  },
  assert: DIMENSIONS.map(dimension => ({
    type: 'javascript' as const,
    metric: dimension,
    value: (output: unknown) => {
      const trajectory = (typeof output === 'string' ? JSON.parse(output) : output) as Trajectory;
      const findings = judge(scenario, trajectory).filter(f => f.dimension === dimension);
      return {
        pass: findings.length === 0,
        score: findings.length ? 0 : 1,
        reason: findings.map(f => (f.turn ? `turn ${f.turn}: ` : '') + f.message).join('\n') || 'holds',
      };
    },
  })),
}));
/** One promptfoo evaluation: the scenarios against these columns, each cell run `times` times, one at a time. */
async function matrix(name: string, description: string, columns: Column[], times: number) {
  const record = await evaluate(
    {
      description,
      prompts: ['{{scenario}}'],
      providers: columns.map(column => ({
        id: () => column.id,
        label: column.label,
        callApi: async (_prompt: string, context?: { vars?: Record<string, unknown> }) => {
          const started = performance.now();
          const trajectory = await column.run(byId.get(String(context?.vars?.scenario))!);
          const sum = (pick: (c: NonNullable<Trajectory['turns'][number]['modelCall']>) => number | undefined) =>
            trajectory.turns.reduce((n, t) => n + ((t.modelCall && pick(t.modelCall)) || 0), 0);
          const prompt = sum(c => c.inputTokens),
            completion = sum(c => c.outputTokens);
          return {
            output: trajectory,
            latencyMs: Math.round(performance.now() - started),
            tokenUsage: { prompt, completion, total: prompt + completion },
          };
        },
      })),
      tests,
      outputPath: [resolve(out, `${name}.json`), resolve(out, `${name}.html`)],
      writeLatestResults: true,
    },
    { cache: false, maxConcurrency: 1, repeat: times, showProgressBar: false },
  );
  const summary = await record.toEvaluateSummary();
  const cells = new Map<string, Cell>();
  for (const r of summary.results) {
    const key = `${r.vars?.scenario}|${r.provider.id}`;
    const cell = cells.get(key) ?? { runs: 0, passed: 0, ms: 0, tokens: 0, dimensions: new Map(), failures: new Map() };
    cell.runs++;
    cell.ms += r.latencyMs ?? 0;
    cell.tokens += r.response?.tokenUsage?.total ?? 0;
    for (const c of r.gradingResult?.componentResults ?? [])
      if (c.pass && c.assertion?.metric)
        cell.dimensions.set(c.assertion.metric, (cell.dimensions.get(c.assertion.metric) ?? 0) + 1);
    if (r.success) cell.passed++;
    else {
      const components = (r.gradingResult?.componentResults ?? []).filter(c => !c.pass);
      const found = components.length
        ? components.flatMap(c =>
            c.reason.split('\n').map(message => ({ dimension: c.assertion?.metric ?? 'judge', message })),
          )
        : [{ dimension: 'run', message: r.error ?? 'failed without a reason' }];
      for (const f of found) {
        const id = `${f.dimension}|${f.message}`;
        cell.failures.set(id, { ...f, runs: (cell.failures.get(id)?.runs ?? 0) + 1 });
      }
    }
    cells.set(key, cell);
  }
  const failed = printMatrix(
    description,
    columns.map(c => ({ name: c.label, ...(c.detail ? { detail: c.detail } : {}) })),
    scenarios.map(s => ({
      id: s.id,
      flow: s.flow,
      who: WHO[s.persona],
      says: s.turns.map(t => t.say),
      holdsWhen: s.holdsWhen,
      // A scenario that says nothing of what a model has to manage is judged on the rules every turn keeps, and marked.
      rulesOnly: name === 'models' && !s.turns.some(t => t.model),
      cells: columns.map(c => cells.get(`${s.id}|${c.id}`)),
    })),
    DIMENSIONS,
    resolve(out, name + '.html'),
  );
  return { failed, cells };
}

const LABEL = { router: 'No model (router)', unavailable: 'Model fails (router stands in)' };
const { failed } = await matrix(
  'no-model',
  "The assistant's flows without a model",
  LANES.map(lane => ({ id: 'clew:' + lane, label: LABEL[lane], run: scenario => runScenario(scenario, lane) })),
  1,
);
if (models.length) {
  const columns = models.map((m, i) => {
    const key = m.keyEnv ? process.env[m.keyEnv] : undefined;
    if (m.keyEnv && !key) throw new Error(`${m.model}: the environment variable ${m.keyEnv} is not set`);
    const generate = createGenerator(
      { baseUrl: m.baseUrl, ...(key ? { apiKey: key } : {}) },
      m.model,
      undefined,
      m.reasoning ?? 'provider-default',
    );
    return {
      id: `model:${i}:${m.model}`,
      label: m.model,
      detail: [
        m.label,
        new URL(m.baseUrl).host,
        (m.tools ?? true) ? 'tools on' : 'tools off',
        m.reasoning === 'none' ? 'reasoning off' : '',
      ]
        .filter(Boolean)
        .join(' · '),
      run: (scenario: Scenario) => runScenario(scenario, 'model', { generate, tools: m.tools ?? true }),
    };
  });
  const { cells } = await matrix(
    'models',
    `The assistant's flows by model · ${repeat} ${repeat === 1 ? 'run' : 'runs'} each`,
    columns,
    repeat,
  );
  if (process.argv.includes('--publish')) publish(columns, cells);
} else
  console.log(
    '\nNo model lane: evals/models.json names no model (see models.example.json), and --stand-in was not given.',
  );

/**
 * What the page `docs/reference/models.md` is drawn from: each model just run replaces its earlier entry in
 * `docs/reference/model-results.json`, the other models stay; the page lists the flows as the scenarios define them when it is drawn. Where the
 * model runs is not written, since an endpoint's address is an installation's own; the note in `models.json` is.
 * The stand-in is no model and is never published, and neither is a run narrowed with `--only`.
 */
function publish(columns: Column[], cells: Map<string, Cell>) {
  if (only) return console.log('\n  Not published: the run was narrowed with --only.');
  const file = resolve(here, '../docs/reference/model-results.json');
  const earlier: ModelResults = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { version: 1, models: [] };
  let commit: string | undefined;
  try {
    commit = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: here, encoding: 'utf8' }).trim();
  } catch {
    commit = undefined;
  }
  const ran: PublishedModel[] = models.flatMap((m, i) => {
    if (m.model === 'stand-in') return [];
    const own = scenarios.flatMap(s => {
      const cell = cells.get(`${s.id}|${columns[i]!.id}`);
      return cell ? [{ id: s.id, cell }] : [];
    });
    const runs = own.reduce((n, o) => n + o.cell.runs, 0);
    const tokens = own.reduce((n, o) => n + o.cell.tokens, 0);
    return [
      {
        model: m.model,
        ...(m.label ? { note: m.label } : {}),
        tools: m.tools ?? true,
        reasoning: m.reasoning ?? 'provider-default',
        ranOn: new Date().toISOString().slice(0, 10),
        ...(commit ? { commit } : {}),
        repeat,
        msPerRun: Math.round(own.reduce((n, o) => n + o.cell.ms, 0) / Math.max(runs, 1)),
        ...(tokens ? { tokensPerRun: Math.round(tokens / Math.max(runs, 1)) } : {}),
        dimensions: Object.fromEntries(
          DIMENSIONS.map(d => [d, [own.reduce((n, o) => n + (o.cell.dimensions.get(d) ?? 0), 0), runs]]),
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
  if (!ran.length) return console.log('\n  Not published: no model was run, only the stand-in.');
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

console.log(
  refused.length
    ? `\n  Refused ${refused.length} connection(s) off the machine: ${[...new Set(refused)].join(', ')}.`
    : '\n  Nothing tried to connect off the machine.',
);
process.exit(failed ? 1 : 0);
