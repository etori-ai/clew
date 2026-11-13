import { afterAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { inArray, sql, type SQL } from 'drizzle-orm';
import { database, schema, type Database } from '../../packages/db/src/index';
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
import { cLocaleDatabase } from './c-locale';

/**
 * The user reads on PostgreSQL: the contract on the suite's database, and, on a database created with the C locale,
 * where a plain lower() folds only A to Z, that the unique index folds under ICU and refuses Å and å as two people and
 * that who holds a user name matches across case and composition, a name held by a composed row and a decomposed (NFD)
 * one naming nobody (L13); and that who holds a name is looked up through an index, not by reading every person (D116).
 * Run with `bun run test:db` inside the devcontainer.
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

test('Å and å are one letter to the user name index and to who holds a name, on a database created with the C locale (L13)', async () => {
  // A database of its own, created with the C locale and migrated, since the suite's database may fold Å by itself.
  const { db: c, drop } = await cLocaleDatabase();
  try {
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
    // The unique index folds Å under ICU whatever the database's locale, so nobody else may hold the name in another
    // case.
    const refused = await c
      .insert(schema.people)
      .values({ id: 'asa-2', organisationId: 'c', name: 'Åsa Öberg', userName: 'åsa.öberg' })
      .then(
        () => undefined,
        (error: unknown) => (error as { cause?: { code?: string; constraint_name?: string } }).cause,
      );
    expect(refused).toMatchObject({ code: '23505', constraint_name: 'auth_person_user_name' });
    // A row stored decomposed (NFD), as one written before user names were normalised may be, is another name to the
    // index, which compares the folded bytes. Who holds the name is then not known: it names neither of them.
    await c
      .insert(schema.people)
      .values({ id: 'asa-nfd', organisationId: 'c', name: 'Åsa Öberg', userName: 'Åsa.Öberg'.normalize('NFD') });
    expect((await reads.holders('reader', ['åsa.öberg', decomposed, 'Åsa.Öberg'])).size).toBe(0);
  } finally {
    await drop();
  }
}, 30_000);

/** A node of PostgreSQL's plan as `explain (format json)` gives it, with the fields read here. */
interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Cond'?: string;
  Plans?: PlanNode[];
}
const planNodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(planNodes)];

test('who holds a user name is looked up through an index, not by reading every person in the installation (D116)', async () => {
  // The statement `holders` sends, taken as it is sent. A refresh, a declared view, a search and a started propose each
  // send it, so a lookup that read every person would cost more with every person the installation holds.
  const sent: SQL[] = [];
  const recording = {
    execute: async (query: SQL) => {
      sent.push(query);
      return [];
    },
  } as unknown as Database;
  await postgresUserReads(() => recording).holders(actors[0].id, ['åsa.öberg', 'ÅSA.ÖBERG'.normalize('NFD'), 'bo.ek']);
  expect(sent).toHaveLength(1);
  // A table of a few rows is read faster in full than through an index, so the planner is asked whether an index can
  // serve the lookup at all: with sequential scans switched off, it still reads auth_person in full when none can.
  const plan = await database().transaction(async tx => {
    await tx.execute(sql`set local enable_seqscan = off`);
    const [row] = await tx.execute<{ 'QUERY PLAN': unknown }>(sql`explain (format json) ${sent[0]}`);
    const explained = row!['QUERY PLAN'];
    return (typeof explained === 'string' ? JSON.parse(explained) : explained)[0].Plan as PlanNode;
  });
  const nodes = planNodes(plan);
  expect(nodes.filter(n => n['Node Type'] === 'Seq Scan' && n['Relation Name'] === 'auth_person')).toEqual([]);
  // The holders are found by the names asked, through a condition on the user name.
  expect(nodes.some(n => n['Index Cond']?.includes('user_name'))).toBe(true);
});
