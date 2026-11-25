/** Synthetic backup/restore verification from the current schema. Never restores over the application database. */
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { database, closeDatabase, schema } from '@clew/db';

const originalUrl = process.env.DATABASE_URL;
if (!originalUrl || process.env.CLEW_POC !== 'true')
  throw new Error('Run only in the synthetic development stack (CLEW_POC=true).');
const migrationsFolder = resolve('packages/db/migrations');
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
  'handover_turn',
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
    const db = await connect(names[0]);
    await migrate(db, { migrationsFolder });
    const at = new Date('2026-11-01T09:00:00Z');
    const due = new Date('2026-11-09T09:00:00Z');
    await db.transaction(async tx => {
      await tx.insert(schema.people).values({ id: marker, organisationId: 'test', name: 'Synthetic recovery fixture' });
      await tx.insert(schema.threads).values({
        id: marker,
        personId: marker,
        kind: 'pushed',
        topic: 'synthetic',
        title: 'Synthetic recovery fixture',
        state: 'handled',
        trigger: { reason: 'recovery', source: 'calendar', at: at.toISOString() },
      });
      await tx.insert(schema.proposals).values({
        id: marker,
        threadId: marker,
        personId: marker,
        participantId: marker,
        status: 'confirmed',
        participantEmail: 'fixture@example.test',
        participantName: 'Synthetic invitee',
        start: due,
        end: new Date('2026-11-09T10:00:00Z'),
        confirmedAt: at,
        reminders: 1,
      });
      await tx
        .insert(schema.jobs)
        .values({ id: marker, kind: 'receipt-final', runAt: due, payload: { threadId: marker } });
      await tx.insert(schema.audit).values({ actor: marker, action: 'recovery.fixture', subject: marker });
      await tx.insert(schema.followupPolicies).values({
        threadId: marker,
        personId: marker,
        unitId: 'test',
        authorizationVersion: 'fixture',
        executionId: marker,
        proposalIds: [marker],
        maxReminders: 2,
        afterWorkdays: 3,
        expiresAt: due,
        state: 'active',
      });
      await tx.insert(schema.timerIntents).values({
        id: marker,
        threadId: marker,
        personId: marker,
        kind: 'reminder',
        generation: 1,
        unitId: 'test',
        authorizationVersion: 'fixture',
        dueAt: due,
        requestedAt: at,
        state: 'active',
        nextAt: due,
      });
      await tx.insert(schema.workOccurrences).values({
        id: marker,
        personId: marker,
        connector: 'calendar',
        assignment: 'test',
        sourceKey: marker,
        period: '2026-11',
        revision: '1',
        observedAt: at,
        sourceState: 'open',
        disposition: 'open',
        threadId: marker,
        legacy: false,
      });
      await tx.insert(schema.handoverTurns).values({ turn: marker, personId: marker });
    });
    const before = await digest(names[0]);
    await migrate(database(), { migrationsFolder });
    if ((await digest(names[0])) !== before) throw new Error('Rerunning migrations changed the synthetic evidence');
    console.log(JSON.stringify({ initialized: true, migrationsIdempotent: true, digest: before }));
  } else if (action === 'verify') {
    const before = await digest(names[0]),
      after = await digest(names[1]);
    if (before !== after) throw new Error('Restore differs from the populated database');
    await migrate(database(), { migrationsFolder });
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
