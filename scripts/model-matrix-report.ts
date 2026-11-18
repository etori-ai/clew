import { styleText } from 'node:util';
import { DIMENSIONS, judge, type Scenario, type Trajectory } from '../tests/assistant-scenarios';

/**
 * What `scripts/model-matrix.ts` keeps of a run and how it is read: every run's trajectory as it happened
 * (`evals/results/runs.json`), the cells worked out from them by today's `judge`, and the matrix as a person reads it in
 * a terminal. A cell is never stored: it is tallied from the kept runs each time, so a changed expectation re-scores an
 * earlier run without a model being asked again (`--rejudge`).
 */
export interface KeptRun {
  column: string;
  scenario: string;
  ms: number;
  /** What the turns did; absent when the run threw before it had a trajectory, and then `error` says why. */
  trajectory?: Trajectory;
  error?: string;
}
export interface KeptColumn {
  id: string;
  /** What the column is called: a model's id as its endpoint lists it, or the name of a lane without one. */
  label: string;
  /** Where the model runs and how it was called; absent for a lane without a model. */
  detail?: string;
  /** The control: an endpoint that speaks the protocol and is no model. A flow it holds says nothing about a model. */
  control?: true;
  /** The model the column ran, as it is published. Where it runs is an installation's own and is not kept. */
  model?: { model: string; note?: string; tools: boolean; reasoning: 'provider-default' | 'none' };
}
export interface KeptMatrix {
  name: 'no-model' | 'models';
  title: string;
  columns: KeptColumn[];
  runs: KeptRun[];
}
export interface Kept {
  version: 1;
  ranOn: string;
  /** The commit of Clew the run was made on, when it is known. */
  commit?: string;
  /** How many times each flow was run against a model. */
  repeat: number;
  /** The one scenario the run was narrowed to; such a run is never published. */
  only?: string;
  matrices: KeptMatrix[];
}

export interface Cell {
  runs: number;
  passed: number;
  /** The runs in which the model ran out of the time a turn gives it: the server's speed, not what the model can do. */
  slow: number;
  ms: number;
  tokens: number;
  /** The runs that held, by what they were judged on. */
  dimensions: Map<string, number>;
  /** What went wrong, keyed by dimension and message, with the number of runs it went wrong in. */
  failures: Map<string, { dimension: string; message: string; runs: number }>;
}
const ranOutOfTime = (t: Trajectory) => t.turns.some(turn => /tim(e|ed) ?out/i.test(turn.audit?.fallbackReason ?? ''));

/** The cells of a matrix, keyed `scenario|column`, judged now. A run of a scenario that is no longer there is left out. */
export function tally(runs: readonly KeptRun[], scenarios: readonly Scenario[]): Map<string, Cell> {
  const byId = new Map(scenarios.map(s => [s.id, s]));
  const cells = new Map<string, Cell>();
  for (const run of runs) {
    const scenario = byId.get(run.scenario);
    if (!scenario) continue;
    const key = `${run.scenario}|${run.column}`;
    const cell = cells.get(key) ?? {
      runs: 0,
      passed: 0,
      slow: 0,
      ms: 0,
      tokens: 0,
      dimensions: new Map(),
      failures: new Map(),
    };
    const findings: Array<{ dimension: string; turn: number; message: string }> = run.trajectory
      ? judge(scenario, run.trajectory)
      : [{ dimension: 'run', turn: 0, message: run.error ?? 'failed without a reason' }];
    cell.runs++;
    cell.ms += run.ms;
    for (const turn of run.trajectory?.turns ?? [])
      cell.tokens += (turn.modelCall?.inputTokens ?? 0) + (turn.modelCall?.outputTokens ?? 0);
    if (run.trajectory && ranOutOfTime(run.trajectory)) cell.slow++;
    if (!findings.length) cell.passed++;
    if (run.trajectory)
      for (const d of DIMENSIONS)
        if (!findings.some(f => f.dimension === d)) cell.dimensions.set(d, (cell.dimensions.get(d) ?? 0) + 1);
    for (const f of findings) {
      const message = (f.turn ? `turn ${f.turn}: ` : '') + f.message;
      const id = `${f.dimension}|${message}`;
      cell.failures.set(id, { dimension: f.dimension, message, runs: (cell.failures.get(id)?.runs ?? 0) + 1 });
    }
    cells.set(key, cell);
  }
  return cells;
}

/**
 * The matrix in a terminal: one row per scenario, one column per lane, each cell the runs that held out of the runs
 * made; then every cell that did not hold with what went wrong, by what it was judged on; then each lane on its own. A
 * model lane is named by the model's id as its endpoint lists it, with where it runs and how it was called, since that
 * is what the person who sets an installation up chooses between. The control is drawn beside the models and never
 * counted: it is there to show which flows hold with no model at all. Colour is the terminal's own and is left out when
 * the output is not one.
 */
export interface Lane {
  name: string;
  detail?: string;
  control?: boolean;
}
export interface Row {
  id: string;
  flow: string;
  /** Who asks. */
  who: string;
  /** What they type, a turn at a time. */
  says: string[];
  /** The text that is in a source before they ask, and where: the scenario holds only when the turn does not obey it. */
  planted?: { where: string; text: string };
  /** What has to be true for the scenario to hold, in words. */
  holdsWhen: string;
  /** Judged on the rules every turn keeps and nothing else: the scenario says nothing of what this lane has to manage. */
  rulesOnly: boolean;
  cells: Array<Cell | undefined>;
}
type Style = Parameters<typeof styleText>[0];
const paint = (style: Style, text: string) => styleText(style, text);
const short = (text: string, max: number) => (text.length > max ? text.slice(0, max - 1) + '…' : text);
const rate = (passed: number, runs: number): Style => (passed === 0 ? 'red' : passed === runs ? 'green' : 'yellow');
const tone = (c: Cell | undefined): Style => (c ? rate(c.passed, c.runs) : 'red');
const time = (ms: number) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`);
const steady = (c: Cell | undefined) => !!c && c.passed === c.runs;

/** Prints the matrix and answers how many scenarios did not hold in every lane that counts. */
export function printMatrix(title: string, lanes: Lane[], rows: Row[], keptPath: string): number {
  const nameWidth = Math.max(8, ...rows.map(r => r.id.length));
  const heads = lanes.map(l => short(l.name, 24));
  const widths = heads.map(h => Math.max(h.length, 5) + 3);
  const line = '─'.repeat(nameWidth + 4 + widths.reduce((a, b) => a + b, 0));
  const control = lanes.findIndex(l => l.control);
  const counted = lanes.flatMap((l, i) => (l.control ? [] : [i]));
  const holds = (r: Row) => counted.every(i => steady(r.cells[i]));
  const withoutModel = (r: Row) => control >= 0 && steady(r.cells[control]);
  const note = (r: Row) => (r.rulesOnly ? 'rules only' : withoutModel(r) ? 'holds without a model' : '');

  console.log('\n' + paint('bold', title) + '\n');
  console.log(
    '  ' + paint('dim', 'Scenario'.padEnd(nameWidth + 2) + heads.map((h, i) => h.padEnd(widths[i]!)).join('')),
  );
  console.log('  ' + paint('dim', line));
  for (const r of rows) {
    const mark = holds(r) ? paint('green', '✔') : paint('red', '✘');
    const cells = r.cells
      .map((c, i) => paint(i === control ? 'dim' : tone(c), (c ? `${c.passed}/${c.runs}` : '–').padEnd(widths[i]!)))
      .join('');
    console.log(`${mark} ${r.id.padEnd(nameWidth + 2)}${cells}${paint('dim', note(r))}`);
    console.log('  ' + paint('dim', r.flow));
  }

  const failing = rows.filter(r => !holds(r));
  if (failing.length) {
    console.log('\n' + paint('bold', 'Did not hold') + '\n');
    failing.forEach((r, n) => {
      if (n) console.log('');
      console.log(`${paint('red', '✘')} ${paint('bold', r.id)}`);
      console.log(`  ${r.flow}.`);
      console.log(paint('dim', `  ${r.who}, types: `) + r.says.map(say => `"${say}"`).join(paint('dim', ', then ')));
      if (r.planted) console.log(paint('dim', `  Planted in ${r.planted.where}: `) + `"${r.planted.text}"`);
      console.log(paint('dim', '  Holds when ') + r.holdsWhen + '.');
      for (const i of counted) {
        const c = r.cells[i];
        if (steady(c)) continue;
        console.log(
          `    ${lanes[i]!.name}` +
            paint('dim', c ? ` · ${c.runs - c.passed} of ${c.runs} runs` : ' · did not run') +
            (c?.slow ? paint('dim', ` · ${c.slow} ran out of time`) : ''),
        );
        for (const f of c?.failures.values() ?? [])
          console.log(
            `      ${paint('yellow', f.dimension.padEnd(9))}${f.message}` +
              (c && f.runs < c.runs - c.passed ? paint('dim', `  (${f.runs} runs)`) : ''),
          );
      }
    });
  }

  console.log('\n' + paint('bold', lanes.some(l => l.detail) ? 'By model' : 'By lane') + '\n');
  counted.forEach((i, n) => {
    const lane = lanes[i]!;
    const own = rows.flatMap(r => (r.cells[i] ? [{ id: r.id, cell: r.cells[i]!, free: withoutModel(r) }] : []));
    const runs = own.reduce((sum, o) => sum + o.cell.runs, 0);
    const passed = own.reduce((sum, o) => sum + o.cell.passed, 0);
    const slow = own.reduce((sum, o) => sum + o.cell.slow, 0);
    const always = own.filter(o => o.cell.passed === o.cell.runs);
    const unsteady = own.filter(o => o.cell.passed > 0 && o.cell.passed < o.cell.runs);
    const never = own.filter(o => o.cell.passed === 0);
    const tokens = own.reduce((sum, o) => sum + o.cell.tokens, 0);
    const ms = own.reduce((sum, o) => sum + o.cell.ms, 0) / Math.max(runs, 1);
    const free = always.filter(o => o.free).length;
    if (n) console.log('');
    console.log(paint('bold', lane.name) + (lane.detail ? paint('dim', '  ' + lane.detail) : ''));
    console.log(
      '  ' +
        paint(rate(always.length, rows.length), `${always.length} of ${rows.length} flows hold every time`) +
        paint(
          'dim',
          (free ? `, ${free} of them without a model too` : '') +
            ` · ${passed}/${runs} runs · ${time(ms)} a run` +
            (tokens ? ` · ${Math.round(tokens / Math.max(runs, 1))} tokens a run` : ''),
        ),
    );
    if (slow)
      console.log(
        '  ' +
          paint('yellow', `${slow} of ${runs} runs ran out of time`) +
          paint('dim', ': the limit a turn has in the product, so the server was too slow, whatever the model can do'),
      );
    // What it was judged on, across every run: where a model falls short shows here before it shows in a flow.
    console.log(
      '  ' +
        DIMENSIONS.map(d => {
          const held = own.reduce((sum, o) => sum + (o.cell.dimensions.get(d) ?? 0), 0);
          return paint('dim', d + ' ') + paint(rate(held, runs), `${held}/${runs}`);
        }).join(paint('dim', ' · ')),
    );
    const list = (label: string, style: Style, items: string[]) => {
      if (items.length) console.log('  ' + paint(style, label.padEnd(10)) + items.join(', '));
    };
    if (always.length < rows.length) {
      list(
        'Holds',
        'green',
        always.map(o => o.id),
      );
      list(
        'Unsteady',
        'yellow',
        unsteady.map(o => `${o.id} ${o.cell.passed}/${o.cell.runs}`),
      );
      list(
        'Fails',
        'red',
        never.map(o => o.id),
      );
    }
  });
  const legend: string[] = [];
  if (rows.some(r => r.rulesOnly))
    legend.push(
      'rules only: the scenario does not yet say what a model has to manage, so only the rules every turn keeps are judged.',
    );
  if (rows.some(r => !r.rulesOnly && withoutModel(r)))
    legend.push(
      `holds without a model: ${lanes[control]!.name}, an endpoint that answers one fixed sentence and calls no tool, holds the flow too, so it says nothing about a model.`,
    );
  if (legend.length) console.log('\n' + legend.map(l => paint('dim', '  ' + l)).join('\n'));
  console.log(paint('dim', `\n  Every run as it happened: ${keptPath}`));
  return failing.length;
}
