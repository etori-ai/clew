/**
 * Seed the competence domain of the development organisation (D108): a small catalogue and holdings for the people the
 * synthetic provisioner pushed, so that a manager's list, the figure and the cards have something to show. Some
 * holdings have expired, some expire within 90 days, most are valid; which person gets what follows from their place
 * in the list of people by id, so two runs on the same directory give the same result. It also sets a handful of
 * requirements on the directory's positions and one share target (item 6), so that some people lack something and a
 * unit's coverage has something to count. Runs inside the app container with the server's local settings
 * (DATABASE_URL); the development seed (`dev-connectors.ts`) calls it. It adds the types the organisation lacks, holdings
 * for the people who have none, and the requirements and targets that are not there yet (a position the provisioner has
 * not pushed is skipped), so it can be run again after the provisioner has pushed more. Every row is audited with the
 * actor `operator:cli`.
 *
 *   bun scripts/competence-seed.ts [--organisation poc]
 *
 * Synthetic data only: nothing here is a real person's qualification.
 */
import { resolve } from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import { closeDatabase, database, schema } from '@clew/db';
import {
  DEVELOPMENT_CATALOGUE,
  DEVELOPMENT_ORGANISATION,
  DEVELOPMENT_REQUIREMENTS,
  DEVELOPMENT_SHARE_TARGETS,
} from './competence-development';
import { competence, competenceStore } from '../apps/server/src/composition/competence';

export const OPERATOR = 'operator:cli';
/** The organisation the development directory provisions into (`scripts/auth-setup.ts`). */
export { DEVELOPMENT_ORGANISATION };
const CATALOGUE = DEVELOPMENT_CATALOGUE;
const day = (at: Date) => at.toISOString().slice(0, 10);
const daysFrom = (today: Date, days: number) => day(new Date(today.getTime() + days * 86_400_000));

/**
 * Seed the organisation: the catalogue's types it does not have yet, by name, and holdings for every enabled person who
 * has none. A second run after the provisioner has pushed more people fills those in and leaves the rest alone.
 */
export async function seedCompetence(organisationId: string, today = new Date()) {
  const existing = await competenceStore.transaction(tx => tx.types(organisationId, { archived: true }));
  const ids = new Map(existing.map(t => [t.name, t.id]));
  let types = 0;
  for (const type of CATALOGUE) {
    if (ids.has(type.name)) continue;
    ids.set(type.name, await competence.seedType(OPERATOR, organisationId, type));
    types++;
  }
  const people = await database()
    .select({ id: schema.people.id })
    .from(schema.people)
    .where(and(eq(schema.people.organisationId, organisationId), eq(schema.people.enabled, true)))
    .orderBy(asc(schema.people.id));
  const held = new Set(
    (await competenceStore.transaction(tx => tx.holdingsOf(people.map(p => p.id)))).map(h => h.personId),
  );
  let seeded = 0;
  let holdings = 0;
  const hold = async (personId: string, type: string, issuedOn: string, expiresOn?: string) => {
    await competence.seedHolding(OPERATOR, organisationId, personId, {
      typeId: ids.get(type)!,
      issuedOn,
      ...(expiresOn ? { expiresOn } : {}),
    });
    holdings++;
  };
  for (const [i, person] of people.entries()) {
    if (held.has(person.id)) continue;
    seeded++;
    // Everyone has HLR, counted from the employer's 24 months: one in eleven let it run out, one in seven is close.
    await hold(person.id, 'HLR', daysFrom(today, i % 11 === 0 ? -760 : i % 7 === 0 ? -690 : -200 - (i % 9) * 30));
    if (i % 3 === 0) await hold(person.id, 'Brandskydd', daysFrom(today, -300 - (i % 5) * 60));
    // Certificates carry the issuer's own end date: one in four of these has passed it, one in four is close to it.
    if (i % 5 === 0)
      await hold(
        person.id,
        'Heta arbeten',
        daysFrom(today, -1700),
        daysFrom(today, i % 20 === 0 ? -25 : i % 20 === 5 ? 40 : 400),
      );
    if (i % 8 === 0) await hold(person.id, 'Fallskydd', daysFrom(today, -400), daysFrom(today, 700));
    if (i % 13 === 0) await hold(person.id, 'Delegering läkemedel', daysFrom(today, i % 26 === 0 ? -340 : -100));
    if (i % 17 === 0) await hold(person.id, 'Socionomexamen', '2015-06-05');
  }
  return { types, people: seeded, holdings, ...(await seedRequirements(organisationId, ids)) };
}

/**
 * The requirements and the share target of the development data (D108 item 6) that the organisation does not have yet,
 * on the positions the provisioner pushed, by code. `typeIds` is the catalogue by name.
 */
async function seedRequirements(organisationId: string, typeIds: ReadonlyMap<string, string>) {
  const { positions, required, targeted } = await competenceStore.transaction(async tx => ({
    positions: new Map((await tx.positions(organisationId)).map(p => [p.code, p.id])),
    required: new Set(
      (await tx.requirements(organisationId)).flatMap(r => (r.positionId ? [r.typeId + '\n' + r.positionId] : [])),
    ),
    targeted: new Set(
      (await tx.shareTargets(organisationId)).flatMap(t => (t.unitId === null ? [t.typeId + '\n' + t.positionId] : [])),
    ),
  }));
  let requirements = 0,
    targets = 0;
  for (const r of DEVELOPMENT_REQUIREMENTS) {
    const typeId = typeIds.get(r.type),
      positionId = positions.get(r.position);
    if (!typeId || !positionId || required.has(typeId + '\n' + positionId)) continue;
    await competence.seedRequirement(OPERATOR, organisationId, { typeId, positionId });
    requirements++;
  }
  for (const t of DEVELOPMENT_SHARE_TARGETS) {
    const typeId = typeIds.get(t.type),
      positionId = positions.get(t.position);
    if (!typeId || !positionId || targeted.has(typeId + '\n' + positionId)) continue;
    await competence.seedShareTarget(OPERATOR, organisationId, { typeId, positionId, minShare: t.minShare });
    targets++;
  }
  return { requirements, targets };
}

if (import.meta.main) {
  try {
    process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
  } catch {
    /* settings may come from the environment */
  }
  const args = process.argv.slice(2);
  const at = args.indexOf('--organisation');
  const organisationId = at >= 0 ? args[at + 1] : DEVELOPMENT_ORGANISATION;
  if (!organisationId || organisationId.startsWith('--')) {
    console.error('Usage: bun scripts/competence-seed.ts [--organisation <id>]');
    process.exit(2);
  }
  try {
    const seeded = await seedCompetence(organisationId);
    console.log(
      `Seeded competence for organisation "${organisationId}": ${seeded.types} new types, ${seeded.holdings} holdings for ${seeded.people} people who had none, ${seeded.requirements} requirements and ${seeded.targets} share targets.`,
    );
  } catch (error) {
    console.error(`Could not seed: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}
