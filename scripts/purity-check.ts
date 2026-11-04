import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

/**
 * Purity guard (D25), part of `bun run check`. Domain files and ported use cases never read the clock, draw a random
 * id or read configuration themselves: those come in through `deps`, so a unit test decides what time it is and what
 * an id looks like. `dependency-cruiser` checks imports; this checks the three ambient reads an import rule cannot see.
 */
const root = join(import.meta.dirname, '..');
const roots = ['apps/server/src', 'packages', 'connectors'];
/** Pure by rule: every domain file, and every use case folder that has been ported to ports (D25). Grows as files are ported. */
const covered = (path: string) => /(^|\/)domain(\.ts$|\/)/.test(path) || (/^apps\/server\/src\/(threads|modules\/[^/]+|scheduler|assistant|connectors\/usecases)\//.test(path) && !/\/adapters\/|\/connector\.ts$/.test(path)) || path === 'packages/calendar/src/proposals.ts';
const banned: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bDate\.now\(/, why: 'reads the clock; take `clock()` from deps' },
  { pattern: /\bnew Date\(\)/, why: 'reads the clock; take `clock()` from deps' },
  { pattern: /\bprocess\.env\b/, why: 'reads configuration; the composition root passes it in' },
  { pattern: /\brandomUUID\(/, why: 'draws an id; take `ids()` from deps' },
  { pattern: /\bMath\.random\(/, why: 'is nondeterministic; take it from deps' },
  { pattern: /\btoday\(\)|\bisPast\(/, why: 'reads the clock through @clew/calendar/dates; derive the date from `clock()`' },
];
function* files(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist') continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) yield* files(full);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield full;
  }
}
const findings: string[] = [];
for (const r of roots) for (const file of files(join(root, r))) {
  const path = relative(root, file);
  if (!covered(path)) continue;
  readFileSync(file, 'utf8').split('\n').forEach((line, index) => {
    const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
    for (const b of banned) if (b.pattern.test(code)) findings.push(`${path}:${index + 1} ${code.trim().slice(0, 80)}\n    ${b.why}`);
  });
}
if (findings.length) {
  console.error(`purity: ${findings.length} ambient read(s) in pure files (D25):\n` + findings.map(f => '  ' + f).join('\n'));
  process.exit(1);
}
console.log('purity: domain and ported use cases read no clock, id source or configuration');
