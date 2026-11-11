/**
 * Seed the competence domain of the development organisation (D101): a small catalogue and holdings for the people the
 * synthetic provisioner pushed, so that a manager's list, the figure and the cards have something to show. Some
 * holdings have expired, some expire within 90 days, most are valid; which person gets what follows from their place
 * in the list of people by id, so two runs on the same directory give the same result. Runs inside the app container
 * with the server's local settings (DATABASE_URL); the development seed (`dev-connectors.ts`) calls it. It adds the
 * types the organisation lacks and holdings for the people who have none, so it can be run again after the provisioner
 * has pushed more people. Every row is audited with the actor `operator:cli`.
 *
 *   bun scripts/competence-seed.ts [--organisation poc]
 *
 * Synthetic data only: nothing here is a real person's qualification.
 */
import { resolve } from 'node:path';
import { and, asc, eq } from 'drizzle-orm';
import { closeDatabase, database, schema } from '@clew/db';
import type { CompetenceTypeBody } from '@clew/contracts';
import { competence, competenceStore } from '../apps/server/src/composition/competence';

export const OPERATOR = 'operator:cli';
/** The organisation the development directory provisions into (`scripts/auth-setup.ts`). */
export const DEVELOPMENT_ORGANISATION = 'poc';
const CATALOGUE: CompetenceTypeBody[] = [
  { name: 'HLR', area: 'Akut omhändertagande', kind: 'course', validityMonths: 24 },
  { name: 'Brandskydd', area: 'Säkerhet', kind: 'course', validityMonths: 36 },
  { name: 'Heta arbeten', area: 'Säkerhet', kind: 'certificate' },
  { name: 'Fallskydd', area: 'Säkerhet', kind: 'certificate' },
  { name: 'Arbete på väg', area: 'Säkerhet', kind: 'certificate' },
  { name: 'Yrkeskompetensbevis (YKB)', area: 'Fordon', kind: 'certificate' },
  { name: 'Delegering läkemedel', area: 'Vård', kind: 'authorisation', validityMonths: 12 },
  { name: 'Socionomexamen', area: 'Examen', kind: 'degree' },
];
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
  return { types, people: seeded, holdings };
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
      `Seeded competence for organisation "${organisationId}": ${seeded.types} new types and ${seeded.holdings} holdings for ${seeded.people} people who had none.`,
    );
  } catch (error) {
    console.error(`Could not seed: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}
