import { expect, test } from 'bun:test';
import { allExtensions } from 'dependency-cruiser';

/**
 * The backend structure rules (D20, `bun run deps`) only judge what dependency-cruiser can parse, and a file it cannot
 * parse is skipped without a word. TypeScript 7 gives it no compiler, so it reads TypeScript through `@swc/core`;
 * when that package left the lockfile with another dependency on 2026-11-09, the rules passed over 80 JavaScript
 * modules and none of the TypeScript. These fail instead.
 */
test('the dependency rules can read TypeScript', () => {
  const readable = allExtensions.filter(e => e.available).map(e => e.extension);
  expect(readable).toContain('.ts');
  expect(readable).toContain('.tsx');
});

test('the rules as configured follow imports between TypeScript files', () => {
  // The real configuration over one small folder: a use case there imports its neighbours, so a run that reads
  // TypeScript finds TypeScript modules with dependencies resolved to other TypeScript modules.
  const run = Bun.spawnSync(
    [
      'node_modules/.bin/depcruise',
      '--config',
      '.dependency-cruiser.cjs',
      '--output-type',
      'json',
      'apps/server/src/modules/entities',
    ],
    { cwd: new URL('../..', import.meta.url).pathname, stdout: 'pipe', stderr: 'pipe' },
  );
  expect(run.exitCode).toBe(0);
  const { modules } = JSON.parse(run.stdout.toString()) as {
    modules: Array<{ source: string; dependencies: Array<{ resolved: string }> }>;
  };
  const followed = modules.filter(
    m =>
      m.source.endsWith('.ts') &&
      m.dependencies.some(d => d.resolved.endsWith('.ts') && !d.resolved.includes('node_modules')),
  );
  expect(followed.length).toBeGreaterThan(0);
});
