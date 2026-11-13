import { afterAll, describe, expect, test } from 'bun:test';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import type { AuthenticatedContext, StaffOverview } from '../../packages/contracts/src/index';
import { postgresCompetenceStore } from '../../apps/server/src/modules/competence/adapters/postgres';
import { CompetenceError, competenceUsecases } from '../../apps/server/src/modules/competence/usecases';
import { testDurable } from './durable';

/**
 * A person's own skill on Postgres (D120 item 2): two writes of it at once. Two changes follow each other, since the
 * change reads the row locked, so each audit row says the level the other left; two adds of one skill keep one, the
 * other refused in Swedish by the store's one-skill index. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');

const tag = Math.random().toString(36).slice(2, 8);
const ORG = `competence-skills-${tag}`;
const anna = `${ORG}-anna`,
  boss = `${ORG}-boss`;
const people = [anna, boss];
let n = 0;
const ids = () => `${ORG}-${++n}`;
const persona = (id: string, role: 'manager' | 'employee'): AuthenticatedContext => ({
  id,
  name: id,
  unitId: `unit-${tag}`,
  unitLabel: 'Enheten',
  role,
  organisationId: ORG,
  principal: { id: 'person:' + id, kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v1' }),
});
const asAnna = persona(anna, 'employee');
const overview: StaffOverview = {
  units: [
    {
      unitId: `unit-${tag}`,
      unitLabel: 'Enheten',
      people: [
        { id: anna, name: 'Synthetic Anställd', userName: `e2e.${tag}`, email: null, role: 'employee', enabled: true },
      ],
    },
  ],
};
const competence = competenceUsecases({
  store: postgresCompetenceStore(testDurable),
  staff: async p => (p.id === boss ? overview : { units: [] }),
  clock: () => new Date('2026-03-02T09:00:00.000Z'),
  ids,
});
let typeIds: string[] = [];
const holdingIds: string[] = [];

afterAll(async () => {
  const db = database();
  await db
    .delete(schema.audit)
    .where(
      inArray(schema.audit.subject, [
        ...holdingIds.map(id => `holding:${id}`),
        ...typeIds.map(id => `competence-type:${id}`),
      ]),
    );
  await db.delete(schema.competenceHoldings).where(inArray(schema.competenceHoldings.personId, people));
  await db.delete(schema.competenceTypes).where(eq(schema.competenceTypes.organisationId, ORG));
  await db.delete(schema.people).where(inArray(schema.people.id, people));
  await closeDatabase();
});

const ratings = (holdingId: string) =>
  database()
    .select({ details: schema.audit.details })
    .from(schema.audit)
    .where(and(eq(schema.audit.subject, `holding:${holdingId}`), eq(schema.audit.action, 'competence.skill_rated')))
    .orderBy(asc(schema.audit.id));

describe('a person’s own skill on Postgres, two writes at once (D120 item 2)', () => {
  test('setup: two synthetic people and two skills', async () => {
    await database()
      .insert(schema.people)
      .values([
        { id: anna, organisationId: ORG, name: 'Synthetic Anställd', userName: `e2e.${tag}` },
        { id: boss, organisationId: ORG, name: 'Synthetic Chef' },
      ]);
    typeIds = [
      await competence.seedType('operator:test', ORG, { name: 'Engelska', area: 'Språk', kind: 'skill' }),
      await competence.seedType('operator:test', ORG, { name: 'Kalkylprogram', area: 'Digitalt', kind: 'skill' }),
    ];
  });

  test('two changes at once follow each other: the second reads what the first wrote', async () => {
    const id = await competence.rateOwnSkill(asAnna, { typeId: typeIds[0]!, level: 2, interest: false });
    holdingIds.push(id);
    await Promise.all([
      competence.changeOwnSkill(asAnna, id, { level: 3, interest: false }),
      competence.changeOwnSkill(asAnna, id, { level: 1, interest: true }),
    ]);
    const rows = (await ratings(id)).map(r => r.details as { level: number; levelBefore: number | null });
    expect(rows).toHaveLength(3);
    const [added, first, second] = rows as [(typeof rows)[0], (typeof rows)[0], (typeof rows)[0]];
    expect(added).toMatchObject({ level: 2, levelBefore: null });
    // Locked, never interleaved: the first changed from 2, the second from what the first left.
    expect(first.levelBefore).toBe(2);
    expect(second.levelBefore).toBe(first.level);
    const [row] = await database().select().from(schema.competenceHoldings).where(eq(schema.competenceHoldings.id, id));
    expect(row!.level).toBe(second.level);
  });

  test('two adds of one skill at once keep one, and the other is refused in Swedish', async () => {
    const settled = await Promise.allSettled([
      competence.rateOwnSkill(asAnna, { typeId: typeIds[1]!, level: 1, interest: false }),
      competence.rateOwnSkill(asAnna, { typeId: typeIds[1]!, level: 3, interest: true }),
    ]);
    const kept = settled.flatMap(s => (s.status === 'fulfilled' ? [s.value] : []));
    const refused = settled.flatMap(s => (s.status === 'rejected' ? [s.reason as Error] : []));
    holdingIds.push(...kept);
    expect(kept).toHaveLength(1);
    expect(refused).toHaveLength(1);
    expect(refused[0]).toBeInstanceOf(CompetenceError);
    expect(refused[0]!.message).toBe('Du har redan den färdigheten. Ändra nivån under Färdigheter i stället.');
    const rows = await database()
      .select()
      .from(schema.competenceHoldings)
      .where(and(eq(schema.competenceHoldings.personId, anna), eq(schema.competenceHoldings.typeId, typeIds[1]!)));
    expect(rows.map(r => r.id)).toEqual(kept);
  });
});
