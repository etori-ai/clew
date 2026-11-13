import { expect, test } from 'bun:test';

/**
 * `scripts/models-check.ts` adds a provider, a model and a person to the installation it runs in (review 2026-11-12,
 * R4). It is for the development stack: without `CLEW_POC=true` or `--confirm` it refuses before it opens the database.
 * What a run does to the database is in `tests/db/models-check.test.ts`.
 */
test('models-check refuses outside the development stack unless told to run here', () => {
  const run = Bun.spawnSync(['bun', 'scripts/models-check.ts'], {
    cwd: new URL('../..', import.meta.url).pathname,
    env: { ...process.env, CLEW_POC: 'false', DATABASE_URL: 'postgres://nobody@127.0.0.1:9/none' },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  expect(run.exitCode).toBe(2);
  expect(run.stderr.toString().trim()).toBe(
    'models-check is for the development stack (CLEW_POC=true): it adds a provider, a model and a person to this installation and removes them afterwards. Run again with --confirm to run it here.',
  );
  expect(run.stdout.toString()).toBe('');
});
