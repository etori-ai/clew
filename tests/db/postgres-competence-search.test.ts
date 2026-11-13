import { afterAll, describe, expect, test } from 'bun:test';
import { and, eq, inArray, like } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { postgresCompetenceStore } from '../../apps/server/src/modules/competence/adapters/postgres';
import type { CompetenceStore } from '../../apps/server/src/modules/competence/model';
import { competenceUsecases } from '../../apps/server/src/modules/competence/usecases';
import { testDurable } from './durable';

/**
 * Kompetenssökning on Postgres (D121 items 4 and 5, D108 item 15): a search, its file and a person opened each write
 * their row of the read log in the transaction that reads what it records, so a row the database refuses takes the read
 * with it, the file's audit row included, and nothing is answered. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');

const tag = Math.random().toString(36).slice(2, 8);
const ORG = `competence-search-${tag}`;
const anna = `${ORG}-anna`,
  bo = `${ORG}-bo`,
  hr = `${ORG}-hr`;
const people = [anna, bo, hr];
let n = 0;
const ids = () => `${ORG}-${String(++n).padStart(4, '0')}`;
const registrar: AuthenticatedContext = {
  id: hr,
  name: 'Synthetic Registrator',
  unitId: `unit-${tag}`,
  unitLabel: 'HR',
  role: 'employee',
  organisationId: ORG,
  principal: { id: 'person:' + hr, kind: 'person' },
  capabilities: [],
  relationGrants: ['registrar'],
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v1' }),
};
const store = postgresCompetenceStore(testDurable);
const usecasesOver = (over: CompetenceStore) =>
  competenceUsecases({
    store: over,
    staff: async () => ({ units: [] }),
    clock: () => new Date('2026-03-02T09:00:00.000Z'),
    ids,
  });
const competence = usecasesOver(store);
/** The same store, but every row of the read log it writes is one the table's checks refuse: a negative count. */
const refusing: CompetenceStore = {
  transaction: fn => store.transaction(tx => fn({ ...tx, logRead: entry => tx.logRead({ ...entry, rows: -1 }) })),
};
let typeId = '';

afterAll(async () => {
  const db = database();
  await db.delete(schema.competenceReadLog).where(eq(schema.competenceReadLog.organisationId, ORG));
  await db.delete(schema.audit).where(like(schema.audit.subject, `%${ORG}%`));
  await db.delete(schema.competenceHoldings).where(inArray(schema.competenceHoldings.personId, people));
  await db.delete(schema.competenceTypes).where(eq(schema.competenceTypes.organisationId, ORG));
  await db.delete(schema.people).where(inArray(schema.people.id, people));
  await closeDatabase();
});

const logged = () =>
  database()
    .select({
      kind: schema.competenceReadLog.kind,
      relation: schema.competenceReadLog.relation,
      typeId: schema.competenceReadLog.typeId,
      personId: schema.competenceReadLog.personId,
      rows: schema.competenceReadLog.rows,
    })
    .from(schema.competenceReadLog)
    .where(eq(schema.competenceReadLog.organisationId, ORG))
    .orderBy(schema.competenceReadLog.id);
const exported = () =>
  database()
    .select({ details: schema.audit.details })
    .from(schema.audit)
    .where(and(eq(schema.audit.subject, 'organisation:' + ORG), eq(schema.audit.action, 'competence.search_exported')));

describe('Kompetenssökning on Postgres (D121)', () => {
  test('a search, its file and a person opened are read and logged in one transaction each', async () => {
    await database()
      .insert(schema.people)
      .values([
        { id: anna, organisationId: ORG, name: 'Synthetic Anna', userName: `anna.${tag}` },
        { id: bo, organisationId: ORG, name: 'Synthetic Bo', userName: `bo.${tag}` },
        { id: hr, organisationId: ORG, name: 'Synthetic Registrator', userName: `hr.${tag}` },
      ]);
    typeId = await competence.seedType('operator:test', ORG, { name: 'HLR', area: 'Akut', kind: 'course' });
    await competence.seedHolding('operator:test', ORG, anna, { typeId, issuedOn: '2026-01-10' });
    await competence.seedHolding('operator:test', ORG, bo, { typeId, issuedOn: '2025-01-10', expiresOn: '2026-01-10' });
    const page = await competence.search(registrar, { typeId });
    expect(page.rows.map(r => [r.name, r.status])).toEqual([
      ['Synthetic Anna', 'valid'],
      ['Synthetic Bo', 'expired'],
    ]);
    const file = await competence.exportSearch(registrar, { typeId });
    expect(file.text.split('\r\n')).toHaveLength(4);
    // The registry tells the module `registrar` only on her own direct read of it (`RunContext.direct`).
    expect((await competence.holdings(registrar, { person: `ANNA.${tag}` }, 'registrar')).rows).toHaveLength(1);
    expect(await logged()).toEqual([
      { kind: 'search', relation: 'registrar', typeId, personId: null, rows: 2 },
      { kind: 'export', relation: 'registrar', typeId, personId: null, rows: 2 },
      { kind: 'person', relation: 'registrar', typeId: null, personId: anna, rows: 1 },
    ]);
    expect(await exported()).toEqual([{ details: { typeId, people: 2 } }]);
  });

  test('a row the database refuses takes the read with it: nothing is answered and the file is not audited', async () => {
    const failing = usecasesOver(refusing);
    for (const read of [
      () => failing.search(registrar, { typeId }),
      () => failing.exportSearch(registrar, { typeId }),
      () => failing.holdings(registrar, { person: `bo.${tag}` }, 'registrar'),
    ])
      await expect(read()).rejects.toThrow();
    // Only the three rows of the reads that answered are there; the refused file left no audit row behind.
    expect(await logged()).toHaveLength(3);
    expect(await exported()).toHaveLength(1);
  });

  test('a deactivated person is no one a registrar opens, and the refusal is not logged', async () => {
    await database().update(schema.people).set({ enabled: false }).where(eq(schema.people.id, bo));
    await expect(competence.holdings(registrar, { person: `bo.${tag}` }, 'registrar')).rejects.toThrow(
      'Personen finns inte bland dem du är chef för.',
    );
    expect((await competence.search(registrar, { typeId })).rows.map(r => r.name)).toEqual(['Synthetic Anna']);
    expect((await logged()).map(r => r.kind)).toEqual(['search', 'export', 'person', 'search']);
  });
});
