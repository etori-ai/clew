import { afterAll, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';

/**
 * `bun scripts/models-check.ts` against this database with its stand-in endpoint (review 2026-11-12, R4): the model it
 * adds is switched on for its own unit only, and its clean-up removes what it wrote and nothing an administrator wrote
 * about an earlier model of the same name. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const db = database();
const earlier = 'person:earlier-admin-' + randomUUID().slice(0, 8);

afterAll(async () => {
  await db.delete(schema.audit).where(eq(schema.audit.actor, earlier));
  await closeDatabase();
});

test('a run switches its model on for its own unit only and removes only the rows it wrote', async () => {
  // What an administrator wrote about an earlier model with the id the run's model gets.
  await db
    .insert(schema.audit)
    .values({ actor: earlier, action: 'model.added', subject: 'model:stand-in-model', details: { title: 'Förr' } });
  const child = Bun.spawn(['bun', 'scripts/models-check.ts'], {
    cwd: new URL('../..', import.meta.url).pathname,
    env: { ...process.env, CLEW_POC: 'true', MASTER_KEY: randomBytes(32).toString('base64') },
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [exitCode, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({ exitCode, stderr: exitCode ? stderr : '' }).toEqual({ exitCode: 0, stderr: '' });
  expect(stdout).toContain("added and switched on for the check's own unit only");
  expect(stdout).toContain('checks passed.');
  const about = await db.select().from(schema.audit).where(eq(schema.audit.subject, 'model:stand-in-model'));
  expect(about.map(r => [r.actor, r.action])).toEqual([[earlier, 'model.added']]);
  expect(await db.select().from(schema.audit).where(like(schema.audit.actor, 'person:check-%-person'))).toEqual([]);
  expect(await db.select().from(schema.audit).where(like(schema.audit.subject, 'provider:check-%'))).toEqual([]);
  expect(await db.select().from(schema.models).where(eq(schema.models.id, 'stand-in-model'))).toEqual([]);
  expect(await db.select().from(schema.modelProviders).where(like(schema.modelProviders.id, 'check-%'))).toEqual([]);
  expect(await db.select().from(schema.people).where(like(schema.people.id, 'check-%-person'))).toEqual([]);
}, 120_000);
