import { expect, test } from 'bun:test';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
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

test('`bun run deps` cruises every app, package, connector, script and test that a rule is written for', () => {
  // A rule written for `apps/` judges only the folders the script names: until 2026-11-24 it named the server's source
  // alone, and a test in apps/web imported a connector unseen (BL-13 of the review of 2026-11-23).
  const root = new URL('../..', import.meta.url).pathname;
  const script = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> })
    .scripts.deps!;
  const cruised = script.split(/\s+/).slice(3);
  const apps = readdirSync(join(root, 'apps'), { withFileTypes: true })
    .filter(e => e.isDirectory())
    .flatMap(e => ['src', 'tests'].map(folder => `apps/${e.name}/${folder}`))
    .filter(folder => existsSync(join(root, folder)));
  expect(apps).toContain('apps/web/tests');
  expect(cruised).toEqual(expect.arrayContaining([...apps, 'packages', 'connectors', 'scripts', 'tests']));
});
