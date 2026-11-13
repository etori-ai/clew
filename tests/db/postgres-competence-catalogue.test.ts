import { afterAll, describe, expect, test } from 'bun:test';
import { and, eq, inArray, like, or } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import type { AuthenticatedContext, CompetenceImportRowBody, StaffOverview } from '../../packages/contracts/src/index';
import { postgresCompetenceStore } from '../../apps/server/src/modules/competence/adapters/postgres';
import { CompetenceError, competenceUsecases } from '../../apps/server/src/modules/competence/usecases';
import { testDurable } from './durable';

/**
 * The catalogue at scale on Postgres (D120 item 7, D108 item 2): an import twice and two at once leave one type per
 * address; a merge re-points a person's skills under the one-skill index, folds the requirements and archives the type
 * with its reference, in one transaction; two merges of the same pair in opposite directions wait for each other, and
 * one is refused; a merged type is not restored. Run with `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');

const tag = Math.random().toString(36).slice(2, 8);
const ORG = `competence-catalogue-${tag}`;
const anna = `${ORG}-anna`,
  boss = `${ORG}-boss`,
  ada = `${ORG}-ada`;
const people = [anna, boss, ada];
let n = 0;
const ids = () => `${ORG}-${++n}`;
const persona = (
  id: string,
  role: 'manager' | 'employee',
  capabilities: AuthenticatedContext['capabilities'] = [],
): AuthenticatedContext => ({
  id,
  name: id,
  unitId: `unit-${tag}`,
  unitLabel: 'Enheten',
  role,
  organisationId: ORG,
  principal: { id: 'person:' + id, kind: 'person' },
  capabilities,
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v1' }),
});
const asAnna = persona(anna, 'employee');
const asBoss = persona(boss, 'manager');
const admin = persona(ada, 'employee', ['admin.competence']);
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
const uri = (i: number) => `http://data.europa.eu/esco/skill/${tag}-${i}`;
const row = (i: number): CompetenceImportRowBody => ({
  row: i + 1,
  name: `färdighet ${tag} ${i}`,
  area: 'Digitala färdigheter',
  kind: 'skill',
  validityMonths: null,
  uri: uri(i),
});

afterAll(async () => {
  const db = database();
  const types = await db
    .select({ id: schema.competenceTypes.id })
    .from(schema.competenceTypes)
    .where(eq(schema.competenceTypes.organisationId, ORG));
  await db.delete(schema.audit).where(
    or(
      eq(schema.audit.subject, 'organisation:' + ORG),
      like(schema.audit.subject, `holding:${ORG}%`),
      like(schema.audit.subject, `competence-requirement:${ORG}%`),
      types.length
        ? inArray(
            schema.audit.subject,
            types.map(t => 'competence-type:' + t.id),
          )
        : undefined,
    ),
  );
  await db.delete(schema.competenceHoldings).where(inArray(schema.competenceHoldings.personId, people));
  await db.delete(schema.competenceRequirements).where(eq(schema.competenceRequirements.organisationId, ORG));
  await db.delete(schema.competenceTypes).where(eq(schema.competenceTypes.organisationId, ORG));
  await db.delete(schema.people).where(inArray(schema.people.id, people));
  await closeDatabase();
});

describe('the catalogue at scale on Postgres (D120 item 7, D108 item 2)', () => {
  test('setup: three synthetic people', async () => {
    await database()
      .insert(schema.people)
      .values([
        { id: anna, organisationId: ORG, name: 'Synthetic Anställd', userName: `e2e.${tag}` },
        { id: boss, organisationId: ORG, name: 'Synthetic Chef' },
        { id: ada, organisationId: ORG, name: 'Synthetic Admin' },
      ]);
  });

  test('an import of a thousand rows, again, and twice at once leaves one type per address', async () => {
    const rows = Array.from({ length: 1000 }, (_, i) => row(i));
    expect(await competence.importTypes(admin, { format: 'esco', rows })).toEqual({ added: 1000, skipped: 0 });
    expect(await competence.importTypes(admin, { format: 'esco', rows })).toEqual({ added: 0, skipped: 1000 });
    const more = Array.from({ length: 50 }, (_, i) => row(1000 + i));
    const settled = await Promise.allSettled([
      competence.importTypes(admin, { format: 'esco', rows: more }),
      competence.importTypes(admin, { format: 'esco', rows: more }),
    ]);
    // One adds the rows; the other either finds them there or meets it halfway and is told to try again.
    for (const s of settled)
      if (s.status === 'rejected') {
        expect(s.reason).toBeInstanceOf(CompetenceError);
        expect((s.reason as Error).message).toStartWith('Katalogen ändrades medan filen lästes in');
      }
    const added = settled.flatMap(s => (s.status === 'fulfilled' ? [s.value.added] : []));
    expect(added.reduce((a, b) => a + b, 0)).toBe(50);
    const stored = await database()
      .select({ uri: schema.competenceTypes.sourceUri })
      .from(schema.competenceTypes)
      .where(and(eq(schema.competenceTypes.organisationId, ORG), like(schema.competenceTypes.sourceUri, `%${tag}%`)));
    expect(stored).toHaveLength(1050);
    expect(new Set(stored.map(s => s.uri)).size).toBe(1050);
  });

  test('a merge keeps the skill that decides under the one-skill index, folds a requirement, and archives the type', async () => {
    const from = await competence.seedType('operator:test', ORG, { name: 'Engelska', area: 'Språk', kind: 'skill' });
    const into = await competence.seedType('operator:test', ORG, {
      name: 'Engelska språket',
      area: 'Språk',
      kind: 'skill',
    });
    // Anna's own Expert rating of the one; her manager's confirmed Självständig of the other: the confirmed one decides.
    await competence.rateOwnSkill(asAnna, { typeId: from, level: 3, interest: true });
    const confirmed = await competence.registerSkill(asBoss, anna, { typeId: into, level: 2 });
    await competence.seedRequirement('operator:test', ORG, { typeId: from, personId: anna, minLevel: 3 });
    await competence.seedRequirement('operator:test', ORG, { typeId: into, personId: anna, minLevel: 1 });
    const moved = await competence.mergeTypes(admin, from, { into });
    expect(moved).toMatchObject({ holdings: 1, requirements: 1, requirementsFolded: 1, skillsSetAside: 1 });
    const held = await database()
      .select()
      .from(schema.competenceHoldings)
      .where(eq(schema.competenceHoldings.personId, anna));
    const skills = held.filter(h => h.typeId === into);
    expect(skills.map(h => [h.level, h.state, h.interest]).sort()).toEqual([
      [2, 'valid', true],
      [3, 'revoked', true],
    ]);
    expect(skills.find(h => h.state === 'valid')!.id).toBe(confirmed);
    const requirements = await database()
      .select()
      .from(schema.competenceRequirements)
      .where(eq(schema.competenceRequirements.organisationId, ORG));
    expect(requirements.map(r => [r.typeId, r.minLevel])).toEqual([[into, 3]]);
    const [type] = await database().select().from(schema.competenceTypes).where(eq(schema.competenceTypes.id, from));
    expect(type!.mergedInto).toBe(into);
    expect(type!.archivedAt).not.toBeNull();
    await expect(competence.restoreType(admin, from)).rejects.toThrow('en sammanslagning går inte att ångra');
  });

  test('two merges of one pair in opposite directions wait for each other: one merges, the other is refused', async () => {
    const a = await competence.seedType('operator:test', ORG, {
      name: 'Truckkort',
      area: 'Fordon',
      kind: 'certificate',
    });
    const b = await competence.seedType('operator:test', ORG, {
      name: 'Truckförarbevis',
      area: 'Fordon',
      kind: 'certificate',
    });
    await competence.registerHolding(asBoss, anna, { typeId: a, issuedOn: '2025-05-10' });
    const settled = await Promise.allSettled([
      competence.mergeTypes(admin, a, { into: b }),
      competence.mergeTypes(admin, b, { into: a }),
    ]);
    expect(settled.filter(s => s.status === 'fulfilled')).toHaveLength(1);
    const [refused] = settled.flatMap(s => (s.status === 'rejected' ? [s.reason as Error] : []));
    expect(refused).toBeInstanceOf(CompetenceError);
    expect(refused!.message).toMatch(/sammanslagen med en annan/);
    const types = await database()
      .select()
      .from(schema.competenceTypes)
      .where(inArray(schema.competenceTypes.id, [a, b]));
    expect(types.filter(t => t.mergedInto !== null)).toHaveLength(1);
  });
});
