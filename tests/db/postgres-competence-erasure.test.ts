import { afterAll, describe, expect, test } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { eq, inArray } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import { COMPETENCE_CONNECTOR } from '../../packages/connectors/src/index';
import { competenceStoreWithCards } from '../../apps/server/src/composition/competence';
import { competenceUsecases } from '../../apps/server/src/modules/competence/usecases';
import { forgetTestWorkflows, testDurable } from './durable';

/**
 * Erasing a person from the competence domain on Postgres (D108 item 14, R1 of the 2026-11-12 review): the use case over
 * the store composition builds (`competenceStoreWithCards`: the competence tables and the person's own competence cards
 * on one thread-store transaction), with the test's own engine queue. The holdings, the cards the competence scan put in
 * the person's stream, a `thread.removed` row per card and the erasure's own audit row commit together or not at all;
 * another connector's card of theirs and someone else's competence card stay; an id the people table does not hold, such
 * as the person's user name, and a person who is still active erase nothing and write no audit row (D117 item 3). Run
 * with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');

const tag = Math.random().toString(36).slice(2, 8);
const ORG = `competence-erase-${tag}`;
const person = `${ORG}-person`,
  colleague = `${ORG}-colleague`,
  userName = `Person.${tag}`;
const typeId = `${ORG}-type`;
const cards = {
  own: `${ORG}-card-own`,
  otherConnector: `${ORG}-card-other`,
  colleagues: `${ORG}-card-colleague`,
};
const cancelled: string[] = [];
const store = competenceStoreWithCards({ durable: testDurable, cancel: async id => void cancelled.push(id) });
const at = new Date('2026-11-12T08:00:00.000Z');
const competence = competenceUsecases({
  store,
  staff: async () => ({ units: [] }),
  clock: () => at,
  ids: () => `${ORG}-${Math.random().toString(36).slice(2, 8)}`,
});

async function seed() {
  const db = database();
  await db.insert(schema.people).values([
    { id: person, organisationId: ORG, name: 'Synthetic Person', userName },
    { id: colleague, organisationId: ORG, name: 'Synthetic Kollega', userName: `Kollega.${tag}` },
  ]);
  await db.insert(schema.competenceTypes).values({
    id: typeId,
    organisationId: ORG,
    name: `HLR ${tag}`,
    area: 'Säkerhet',
    kind: 'certificate',
    createdBy: 'operator:cli',
  });
  await db.insert(schema.competenceHoldings).values([
    {
      id: `${ORG}-holding`,
      personId: person,
      typeId,
      issuedOn: '2024-06-01',
      expiresOn: '2026-06-01',
      evidence: 'manager',
      state: 'valid',
      registeredBy: colleague,
    },
    {
      id: `${ORG}-holding-colleague`,
      personId: colleague,
      typeId,
      issuedOn: '2025-01-01',
      evidence: 'manager',
      state: 'valid',
      registeredBy: person,
    },
  ]);
  const card = (id: string, personId: string, connector: string) => ({
    id,
    personId,
    kind: 'pushed' as const,
    topic: `${connector}:${id}`,
    title: 'HLR gick ut 1 juni',
    state: 'open' as const,
    connector,
    area: connector,
    trigger: { reason: 'Behörigheten har gått ut', source: 'Kompetens', at: at.toISOString() },
    createdAt: at,
    updatedAt: at,
  });
  await db
    .insert(schema.threads)
    .values([
      card(cards.own, person, COMPETENCE_CONNECTOR),
      card(cards.otherConnector, person, 'hr'),
      card(cards.colleagues, colleague, COMPETENCE_CONNECTOR),
    ]);
  await db
    .insert(schema.threadMessages)
    .values({ id: `${cards.own}-message`, threadId: cards.own, role: 'assistant', body: 'HLR gick ut 1 juni.' });
}
const auditOf = (subjects: string[]) =>
  database()
    .select({
      actor: schema.audit.actor,
      action: schema.audit.action,
      subject: schema.audit.subject,
      details: schema.audit.details,
    })
    .from(schema.audit)
    .where(inArray(schema.audit.subject, subjects))
    .orderBy(schema.audit.id);
const threadsOf = (personId: string) =>
  database()
    .select({ id: schema.threads.id })
    .from(schema.threads)
    .where(eq(schema.threads.personId, personId))
    .orderBy(schema.threads.id);

afterAll(async () => {
  const db = database();
  const subjects = [`person:${person}`, `person:${userName}`, ...Object.values(cards).map(id => `thread:${id}`)];
  await db.delete(schema.audit).where(inArray(schema.audit.subject, subjects));
  await db.delete(schema.threads).where(inArray(schema.threads.personId, [person, colleague]));
  await db.delete(schema.competenceHoldings).where(eq(schema.competenceHoldings.typeId, typeId));
  await db.delete(schema.competenceTypes).where(eq(schema.competenceTypes.id, typeId));
  await db.delete(schema.people).where(inArray(schema.people.id, [person, colleague]));
  await forgetTestWorkflows();
  await closeDatabase();
});

describe('erasing a person from the competence domain on Postgres (D108 item 14, R1)', () => {
  test('a user name, in any case, is no id: nothing is erased and nothing is audited', async () => {
    await seed();
    for (const key of [userName, userName.toLowerCase(), `${ORG}-nobody`])
      expect([key, await competence.erasePerson('operator:cli', key)]).toEqual([key, { refused: 'unknown' }]);
    expect((await threadsOf(person)).map(t => t.id)).toEqual([cards.otherConnector, cards.own].sort());
    expect(await auditOf([`person:${userName}`, `person:${person}`])).toEqual([]);
  });
  test('a person who is still active is refused: nothing is erased and nothing is audited (D117 item 3)', async () => {
    expect(await competence.erasePerson('operator:cli', person)).toEqual({ refused: 'active' });
    expect((await threadsOf(person)).map(t => t.id)).toEqual([cards.otherConnector, cards.own].sort());
    expect(
      await database()
        .select({ id: schema.competenceHoldings.id })
        .from(schema.competenceHoldings)
        .where(eq(schema.competenceHoldings.personId, person)),
    ).toEqual([{ id: `${ORG}-holding` }]);
    expect(await auditOf([`person:${person}`, `thread:${cards.own}`])).toEqual([]);
    // The source deactivates the person: from now on the erasure goes through.
    await database().update(schema.people).set({ enabled: false }).where(eq(schema.people.id, person));
  });
  test('the cards go with the holdings in one transaction, or neither does', async () => {
    await expect(
      store.transaction(async tx => {
        expect(await tx.cards.removeOwn(person, 'operator:cli', at.toISOString())).toBe(1);
        throw new Error('crash');
      }),
    ).rejects.toThrow('crash');
    expect((await threadsOf(person)).map(t => t.id)).toEqual([cards.otherConnector, cards.own].sort());
    expect(await auditOf([`thread:${cards.own}`])).toEqual([]);
  });
  test('erasing by id removes the holdings, the name on what they registered and their competence cards, and audits each', async () => {
    expect(await competence.erasePerson('operator:cli', person)).toEqual({ holdings: 1, cleared: 1, cards: 1 });
    const db = database();
    expect(
      await db.select().from(schema.competenceHoldings).where(eq(schema.competenceHoldings.personId, person)),
    ).toEqual([]);
    expect(
      await db
        .select({ registeredBy: schema.competenceHoldings.registeredBy })
        .from(schema.competenceHoldings)
        .where(eq(schema.competenceHoldings.personId, colleague)),
    ).toEqual([{ registeredBy: null }]);
    // Only the competence card of theirs; another connector's card and a colleague's competence card stay.
    expect((await threadsOf(person)).map(t => t.id)).toEqual([cards.otherConnector]);
    expect((await threadsOf(colleague)).map(t => t.id)).toEqual([cards.colleagues]);
    expect(await db.select().from(schema.threadMessages).where(eq(schema.threadMessages.threadId, cards.own))).toEqual(
      [],
    );
    expect(await auditOf([`thread:${cards.own}`, `person:${person}`])).toEqual([
      {
        actor: 'operator:cli',
        action: 'thread.removed',
        subject: `thread:${cards.own}`,
        details: { reason: 'erasure' },
      },
      {
        actor: 'operator:cli',
        action: 'competence.person_erased',
        subject: `person:${person}`,
        details: { holdings: 1, cleared: 1, cards: 1 },
      },
    ]);
    expect(await auditOf([`thread:${cards.otherConnector}`, `thread:${cards.colleagues}`])).toEqual([]);
  });
});
