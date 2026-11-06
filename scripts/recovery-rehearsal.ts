/** Synthetic-only upgrade and backup/restore verification. Never restores over the application database. */
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { database, closeDatabase } from '@clew/db';

const originalUrl = process.env.DATABASE_URL;
if (!originalUrl || process.env.CLEW_POC !== 'true')
  throw new Error('Run only in the synthetic development stack (CLEW_POC=true).');
const names = ['clew_reliability_rehearsal', 'clew_reliability_restored'] as const;
const marker = 'clew-synthetic-recovery-fixture';
async function connect(name?: string) {
  await closeDatabase();
  const url = new URL(originalUrl!);
  if (name) url.pathname = '/' + name;
  process.env.DATABASE_URL = url.toString();
  return database();
}
async function markerPresent(name: string) {
  const db = await connect(name);
  const rows = await db.execute(sql`select id from auth_person where id = ${marker}`);
  return rows.length === 1;
}
const tables = [
  'auth_person',
  'thread',
  'proposal',
  'job',
  'audit',
  'followup_policy',
  'timer_intent',
  'work_occurrence',
  'person_change',
];
async function digest(name: string) {
  if (!(await markerPresent(name))) throw new Error('Not a rehearsal database: ' + name);
  const values = [];
  for (const table of tables) {
    const rows = await database().execute(
      sql.raw(`select to_jsonb(t) as value from ${table} t order by to_jsonb(t)::text`),
    );
    values.push([table, rows.map(r => r.value)]);
  }
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}
try {
  const action = process.argv[2];
  if (action === 'prepare') {
    const admin = await connect();
    const existing = await admin.execute(
      sql`select datname from pg_database where datname in (${names[0]}, ${names[1]})`,
    );
    if (existing.length) throw new Error('A rehearsal database already exists; inspect it before cleanup.');
    await admin.execute(sql.raw(`create database ${names[0]}`));
    await admin.execute(sql.raw(`create database ${names[1]}`));
    const folder = await mkdtemp(join(tmpdir(), 'clew-upgrade-'));
    try {
      const migrations = resolve('packages/db/migrations');
      const journal = JSON.parse(await readFile(join(migrations, 'meta/_journal.json'), 'utf8'));
      journal.entries = journal.entries.filter((e: { idx: number }) => e.idx <= 19);
      await mkdir(join(folder, 'meta'));
      await writeFile(join(folder, 'meta/_journal.json'), JSON.stringify(journal));
      for (const entry of journal.entries)
        await copyFile(join(migrations, entry.tag + '.sql'), join(folder, entry.tag + '.sql'));
      const db = await connect(names[0]);
      await migrate(db, { migrationsFolder: folder });
      await db.execute(
        sql`insert into auth_person (id, organisation_id, name) values (${marker}, 'test', 'Synthetic recovery fixture')`,
      );
      await db.execute(
        sql`insert into thread (id, person_id, kind, topic, title, state, connector, area, trigger, created_at, updated_at) values (${marker}, ${marker}, 'pushed', 'synthetic', 'Synthetic recovery fixture', 'handled', 'calendar', 'calendar', '{}'::jsonb, '2026-11-01', '2026-11-01')`,
      );
      await db.execute(
        sql`insert into proposal (id, thread_id, person_id, status, participant_email, participant_name, start, "end", confirmed_at, reminders) values (${marker}, ${marker}, ${marker}, 'confirmed', 'fixture@example.test', 'Synthetic invitee', '2026-11-09T09:00:00Z', '2026-11-09T10:00:00Z', '2026-11-01', 1)`,
      );
      await db.execute(
        sql`insert into job (id, kind, run_at, status, payload) values ('synthetic-due','receipt-final','2026-11-01','due',${JSON.stringify({ threadId: marker })}::jsonb), ('synthetic-running','undo-expiry','2026-11-01','running',${JSON.stringify({ threadId: marker })}::jsonb)`,
      );
      await migrate(db, { migrationsFolder: migrations });
      await migrate(db, { migrationsFolder: migrations });
      const policy = await db.execute(sql`select state, reason from followup_policy where thread_id = ${marker}`);
      const jobs = await db.execute(sql`select id, status from job order by id`);
      if (
        policy[0]?.state !== 'blocked' ||
        policy[0]?.reason !== 'legacy-unverified' ||
        jobs[0]?.status !== 'temporal' ||
        jobs[1]?.status !== 'legacy-running'
      )
        throw new Error('Conservative upgrade failed');
      console.log(
        JSON.stringify({
          upgradedFrom: '0019',
          duplicateMigrationSafe: true,
          legacyFollowup: 'blocked',
          queuedJob: 'temporal',
          oldOwner: 'legacy-running',
          digest: await digest(names[0]),
        }),
      );
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  } else if (action === 'verify') {
    const before = await digest(names[0]),
      after = await digest(names[1]);
    if (before !== after) throw new Error('Restore differs from the upgraded database');
    await migrate(database(), { migrationsFolder: resolve('packages/db/migrations') });
    if ((await digest(names[1])) !== after) throw new Error('Rerunning migrations changed restored evidence');
    console.log(JSON.stringify({ restored: true, evidencePreserved: true, migrationsIdempotent: true, digest: after }));
  } else if (action === 'cleanup') {
    // Both names must contain our marker. A failed/incomplete prepare requires operator inspection.
    for (const name of names)
      if (!(await markerPresent(name))) throw new Error('Refusing cleanup without fixture marker: ' + name);
    const admin = await connect();
    for (const name of names) await admin.execute(sql.raw(`drop database ${name}`));
    console.log('Synthetic rehearsal databases removed.');
  } else throw new Error('Usage: bun scripts/recovery-rehearsal.ts prepare|verify|cleanup');
} finally {
  await closeDatabase();
  process.env.DATABASE_URL = originalUrl;
}
