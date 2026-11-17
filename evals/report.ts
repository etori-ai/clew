import { styleText } from 'node:util';

/**
 * The matrix as a person reads it in a terminal: one row per scenario, one column per lane, each cell the runs that
 * held out of the runs made; then every cell that did not hold with what went wrong, by what it was judged on; then
 * each lane on its own. A model lane is named by the model's id as its endpoint lists it, with where it runs and how it
 * was called, since that is what the person who sets an installation up chooses between. Colour is the terminal's own
 * and is left out when the output is not one.
 */
export interface Cell {
  runs: number;
  passed: number;
  ms: number;
  tokens: number;
  /** The runs that held, by what they were judged on. */
  dimensions: Map<string, number>;
  /** What went wrong, keyed by dimension and message, with the number of runs it went wrong in. */
  failures: Map<string, { dimension: string; message: string; runs: number }>;
}
export interface Lane {
  /** What the column is called: a model's id, or the name of a lane without one. */
  name: string;
  /** Where the model runs and how it was called; absent for a lane without a model. */
  detail?: string;
}
export interface Row {
  id: string;
  flow: string;
  /** Who asks. */
  who: string;
  /** What they type, a turn at a time. */
  says: string[];
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

export function printMatrix(
  title: string,
  lanes: Lane[],
  rows: Row[],
  dimensions: readonly string[],
  reportPath: string,
) {
  const nameWidth = Math.max(8, ...rows.map(r => r.id.length));
  const heads = lanes.map(l => short(l.name, 24));
  const widths = heads.map(h => Math.max(h.length, 5) + 3);
  const line = '─'.repeat(nameWidth + 4 + widths.reduce((a, b) => a + b, 0));
  const holds = (r: Row) => r.cells.every(c => c && c.passed === c.runs);

  console.log('\n' + paint('bold', title) + '\n');
  console.log(
    '  ' + paint('dim', 'Scenario'.padEnd(nameWidth + 2) + heads.map((h, i) => h.padEnd(widths[i]!)).join('')),
  );
  console.log('  ' + paint('dim', line));
  for (const r of rows) {
    const mark = holds(r) ? paint('green', '✔') : paint('red', '✘');
    const cells = r.cells
      .map((c, i) => paint(tone(c), (c ? `${c.passed}/${c.runs}` : '–').padEnd(widths[i]!)))
      .join('');
    console.log(`${mark} ${r.id.padEnd(nameWidth + 2)}${cells}${r.rulesOnly ? paint('dim', 'rules only') : ''}`);
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
      console.log(paint('dim', '  Holds when ') + r.holdsWhen + '.');
      r.cells.forEach((c, i) => {
        if (c && c.passed === c.runs) return;
        console.log(
          `    ${lanes[i]!.name}` + paint('dim', c ? ` · ${c.runs - c.passed} of ${c.runs} runs` : ' · did not run'),
        );
        for (const f of c?.failures.values() ?? [])
          console.log(
            `      ${paint('yellow', f.dimension.padEnd(9))}${f.message}` +
              (c && f.runs < c.runs - c.passed ? paint('dim', `  (${f.runs} runs)`) : ''),
          );
      });
    });
  }

  console.log('\n' + paint('bold', lanes.some(l => l.detail) ? 'By model' : 'By lane') + '\n');
  lanes.forEach((lane, i) => {
    const own = rows.flatMap(r => (r.cells[i] ? [{ id: r.id, cell: r.cells[i]! }] : []));
    const runs = own.reduce((n, o) => n + o.cell.runs, 0);
    const passed = own.reduce((n, o) => n + o.cell.passed, 0);
    const steady = own.filter(o => o.cell.passed === o.cell.runs);
    const unsteady = own.filter(o => o.cell.passed > 0 && o.cell.passed < o.cell.runs);
    const never = own.filter(o => o.cell.passed === 0);
    const tokens = own.reduce((n, o) => n + o.cell.tokens, 0);
    const ms = own.reduce((n, o) => n + o.cell.ms, 0) / Math.max(runs, 1);
    if (i) console.log('');
    console.log(paint('bold', lane.name) + (lane.detail ? paint('dim', '  ' + lane.detail) : ''));
    console.log(
      '  ' +
        paint(rate(steady.length, rows.length), `${steady.length} of ${rows.length} flows hold every time`) +
        paint(
          'dim',
          ` · ${passed}/${runs} runs · ${time(ms)} a run` +
            (tokens ? ` · ${Math.round(tokens / Math.max(runs, 1))} tokens a run` : ''),
        ),
    );
    // What it was judged on, across every run: where a model falls short shows here before it shows in a flow.
    console.log(
      '  ' +
        dimensions
          .map(d => {
            const held = own.reduce((n, o) => n + (o.cell.dimensions.get(d) ?? 0), 0);
            return paint('dim', d + ' ') + paint(rate(held, runs), `${held}/${runs}`);
          })
          .join(paint('dim', ' · ')),
    );
    const list = (label: string, style: Style, items: string[]) => {
      if (items.length) console.log('  ' + paint(style, label.padEnd(10)) + items.join(', '));
    };
    if (steady.length < rows.length) {
      list(
        'Holds',
        'green',
        steady.map(o => o.id),
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
  if (rows.some(r => r.rulesOnly))
    console.log(
      paint(
        'dim',
        '\n  rules only: the scenario does not yet say what a model has to manage, so only the rules every turn keeps are judged.',
      ),
    );
  console.log(paint('dim', `\n  Report: ${reportPath}`));
  return failing.length;
}
