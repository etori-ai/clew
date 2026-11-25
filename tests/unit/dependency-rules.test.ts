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

test('`bun run deps` cruises every folder a rule is written for whole, and leaves out only build output', () => {
  // A rule written for `apps/` judges only the folders the script names: until 2026-11-24 it named the server's source
  // alone, and a test in apps/web imported a connector unseen (BL-13 of the review of 2026-11-23). Named folder by
  // folder, a configuration beside an app's source (apps/web/vite.config.ts) or a new folder under an app escaped, so
  // the script names the top-level folders.
  const root = new URL('../..', import.meta.url).pathname;
  const script = (JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> })
    .scripts.deps!;
  const exclude = /--exclude "([^"]+)"/.exec(script)?.[1];
  const cruised = script
    .replace(/--exclude "[^"]+"/, '')
    .split(/\s+/)
    .filter(word => word && !word.startsWith('-') && !['depcruise', '.dependency-cruiser.cjs'].includes(word));
  // Every top-level folder a rule names, as `^apps/`, `^(apps|packages)/` or `^tests/unit/`, and the scripts.
  const { forbidden } = require(join(root, '.dependency-cruiser.cjs')) as {
    forbidden: Array<{ from: { path?: string }; to: { path?: string } }>;
  };
  const named = new Set(['scripts']);
  for (const rule of forbidden)
    for (const path of [rule.from.path, rule.to.path])
      for (const [, folders] of (path ?? '').matchAll(/\^\(?([a-z|]+)\)?\//g))
        for (const f of folders!.split('|')) if (f) named.add(f);
  expect([...named].sort()).toEqual(['apps', 'connectors', 'packages', 'scripts', 'tests']);
  expect(cruised.sort()).toEqual([...named].sort());
  for (const folder of cruised) expect(existsSync(join(root, folder))).toBe(true);
  // node_modules is never gathered (doNotFollow); the exclusion leaves out an app's or a package's build output only, and
  // never a dependency, whose rules (a runtime library in domain code, the store in a route) would then pass unseen.
  const excluded = new RegExp(exclude!);
  for (const output of ['apps/web/dist/assets/index.js', 'packages/site-header/dist/site-header.js'])
    expect({ output, excluded: excluded.test(output) }).toEqual({ output, excluded: true });
  for (const source of [
    'apps/web/vite.config.ts',
    'apps/server/src/main.ts',
    'packages/notices/src/viewer.ts',
    'node_modules/.bun/hono@4.13.18/node_modules/hono/dist/index.js',
    'node_modules/.bun/drizzle-orm@0.45.4/node_modules/drizzle-orm/index.js',
  ])
    expect({ source, excluded: excluded.test(source) }).toEqual({ source, excluded: false });
  expect(readdirSync(join(root, 'apps'))).toContain('web');
});
