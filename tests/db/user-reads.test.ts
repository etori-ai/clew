import { afterAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { inArray, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { database, schema } from '../../packages/db/src/index';
import { postgresProvisionStore, postgresUserReads } from '../../apps/server/src/modules/people/adapters/postgres';
import { directoryUsecases } from '../../apps/server/src/modules/people/usecases';
import {
  USER_READ_ORGANISATION,
  userReadActors,
  userReadColleague,
  userReadNames,
  userReadOthers,
  userReadsContract,
} from '../user-reads-contract';

/**
 * The user reads on PostgreSQL: the contract on the suite's database, and who holds a user name on a database created
 * with the C locale, where plain lower() folds only A to Z and the unique index lets Å and å in as two people (L13). Run
 * with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');

const prefix = 'test-users-' + randomUUID();
const actors = userReadActors(prefix),
  colleague = userReadColleague(actors),
  others = userReadOthers(prefix);
const ids = [...actors.map(a => a.id), colleague.id, ...others.map(o => o.id)];
afterAll(async () => {
  await database().delete(schema.assignments).where(inArray(schema.assignments.personId, ids));
  await database().delete(schema.accessGrants).where(inArray(schema.accessGrants.personId, ids));
  await database().delete(schema.people).where(inArray(schema.people.id, ids));
  await database()
    .delete(schema.units)
    .where(
      inArray(
        schema.units.id,
        actors.map(a => a.unitId),
      ),
    );
});
const reads = () => ({ ...postgresUserReads(), ...directoryUsecases({ store: postgresProvisionStore() }) });
let prepared = false;
userReadsContract('postgres', async () => {
  // The contract has several cases; the rows are written once.
  if (prepared) return { actors, others, reads: reads() };
  prepared = true;
  await database().transaction(async tx => {
    await tx.insert(schema.people).values([
      ...actors.map(a => ({
        id: a.id,
        name: a.name,
        organisationId: USER_READ_ORGANISATION,
        userName: userReadNames(actors)[a.id],
      })),
      { id: colleague.id, name: colleague.name, organisationId: USER_READ_ORGANISATION },
      ...others,
    ]);
    await tx
      .insert(schema.units)
      .values(actors.map(a => ({ id: a.unitId, organisationId: USER_READ_ORGANISATION, label: a.unitLabel })));
    await tx
      .insert(schema.assignments)
      .values([
        ...actors.map(a => ({ personId: a.id, unitId: a.unitId, role: a.role })),
        ...colleague.placed.map(p => ({ personId: colleague.id, ...p })),
      ]);
    // The colleague's grant names the unit they lead, as the derivation writes it.
    await tx.insert(schema.accessGrants).values([
      ...actors.map(a => ({
        personId: a.id,
        unitId: a.unitId,
        unitLabel: a.unitLabel,
        role: a.role,
        capabilities: a.role === 'manager' ? ['test.read'] : [],
      })),
      {
        personId: colleague.id,
        unitId: actors[0].unitId,
        unitLabel: actors[0].unitLabel,
        role: 'manager' as const,
        capabilities: [],
      },
    ]);
  });
  return { actors, others, reads: reads() };
});

test('Å and å are one letter to who holds a user name on a database created with the C locale (L13)', async () => {
  // A database of its own, created with the C locale and migrated, since the suite's database may fold Å by itself.
  const db = database();
  const name = 'clew_test_c_locale_' + randomUUID().replaceAll('-', '').slice(0, 12),
    url = new URL(process.env.DATABASE_URL!);
  url.pathname = '/' + name;
  await db.execute(sql.raw(`create database ${name} template template0 encoding 'UTF8' locale 'C'`));
  const c = drizzle({ connection: { url: url.toString(), max: 2, onnotice: () => undefined } });
  try {
    const [locale] = await c.execute<{ collation: string; folds: boolean }>(
      sql`select datcollate as collation, lower('Å') = 'å' as folds from pg_database where datname = current_database()`,
    );
    expect(locale).toEqual({ collation: 'C', folds: false });
    await migrate(c, { migrationsFolder: resolve(import.meta.dir, '../../packages/db/migrations') });
    await c.insert(schema.people).values([
      { id: 'reader', organisationId: 'c', name: 'Läsare', userName: 'läsare' },
      { id: 'asa', organisationId: 'c', name: 'Åsa Öberg', userName: 'Åsa.Öberg' },
    ]);
    const reads = postgresUserReads(() => c);
    const decomposed = 'ÅSA.ÖBERG'.normalize('NFD');
    expect(Object.fromEntries(await reads.holders('reader', ['åsa.öberg', decomposed]))).toEqual({
      'åsa.öberg': 'asa',
      [decomposed]: 'asa',
    });
    // Plain lower() leaves Å as it is here, so the unique index lets a second person in as åsa.öberg (L13). Who holds the
    // name is then not known: it names neither of them.
    await c
      .insert(schema.people)
      .values({ id: 'asa-2', organisationId: 'c', name: 'Åsa Öberg', userName: 'åsa.öberg' });
    expect((await reads.holders('reader', ['åsa.öberg', decomposed, 'Åsa.Öberg'])).size).toBe(0);
  } finally {
    await c.$client.end();
    await db.execute(sql.raw(`drop database if exists ${name} with (force)`));
  }
}, 30_000);
