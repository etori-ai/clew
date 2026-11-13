/**
 * Seed introduction and leaving of the development organisation (D124): the layers in `boarding-development.ts`,
 * imported as an administrator would import the file, and one open introduction that the development stack's manager
 * started a week ago, with some items done, one overdue and the rest ahead. The new teacher whose employment starts in
 * three weeks gets no plan: she is what Clew suggests. Runs inside the app container with the server's local settings
 * (DATABASE_URL, MASTER_KEY), after the provisioner has pushed the directory. Idempotent: a layer the organisation has
 * is left as it is when it is unchanged, and the plan is started only when the person has no open introduction. The
 * layers are audited with the actor `operator:cli`; the plan and its ticks are audited as the manager's, since a plan
 * is only ever started by the manager. The module itself stays off until an administrator switches it on.
 *
 *   bun scripts/boarding-seed.ts [--organisation poc]
 *
 * Synthetic data only.
 */
import { resolve } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { closeDatabase, database, schema } from '@clew/db';
import { parseBoardingImport, stockholmDate } from '@clew/contracts';
import { boarding, boardingStore } from '../apps/server/src/composition/boarding';
import { systemContext } from '../apps/server/src/system-context';
import { DEVELOPMENT_LAYERS, DEVELOPMENT_ORGANISATION, DEVELOPMENT_PLAN } from './boarding-development';

export const OPERATOR = 'operator:cli';
export { DEVELOPMENT_ORGANISATION };
const DAY_MS = 86_400_000;
const swedishDay = (at: Date) => stockholmDate(at.toISOString());

/** An active person of the organisation by user name, without regard to case; undefined when there is none. */
async function personByUserName(organisationId: string, userName: string): Promise<string | undefined> {
  const [row] = await database()
    .select({ id: schema.people.id })
    .from(schema.people)
    .where(
      and(
        eq(schema.people.organisationId, organisationId),
        eq(schema.people.enabled, true),
        sql`lower(${schema.people.userName}) = ${userName.toLowerCase()}`,
      ),
    );
  return row?.id;
}

export type SeededPlan = { state: 'started'; items: number; done: number } | { state: 'kept' | 'skipped' };
/** Seed the organisation's layers and its one open introduction; see the file's header. */
export async function seedBoarding(organisationId: string, today = new Date()) {
  const parsed = parseBoardingImport(DEVELOPMENT_LAYERS);
  if (parsed.problemCount)
    throw new Error(
      `The development layers have ${parsed.problemCount} problems, the first on row ${parsed.problems[0]!.row}.`,
    );
  const layers = await boarding.seedLayers(OPERATOR, organisationId, parsed.rows);
  const [managerId, personId, buddyId] = await Promise.all(
    [DEVELOPMENT_PLAN.manager, DEVELOPMENT_PLAN.person, DEVELOPMENT_PLAN.buddy].map(u =>
      personByUserName(organisationId, u),
    ),
  );
  const manager = managerId ? await systemContext(managerId, 'operator:seed') : undefined;
  let plan: SeededPlan = { state: 'skipped' };
  // Nothing to start before the provisioner has pushed the manager and the person.
  if (manager && personId) {
    const open = (await boardingStore.transaction(tx => tx.plansAbout([personId]))).some(
      p => p.event === 'introduction' && p.closedAt === null,
    );
    if (open) plan = { state: 'kept' };
    else {
      const { id } = await boarding.startPlan(manager, {
        personId,
        event: 'introduction',
        anchorOn: swedishDay(new Date(today.getTime() - DEVELOPMENT_PLAN.startedDaysAgo * DAY_MS)),
        ...(buddyId ? { buddyId } : {}),
      });
      const items = await boardingStore.transaction(tx => tx.items([id]));
      const cutoff = swedishDay(new Date(today.getTime() - 2 * DAY_MS));
      let done = 0;
      for (const item of items)
        if (item.dueOn < cutoff && item.title !== DEVELOPMENT_PLAN.leftOpen) {
          await boarding.setDone(manager, item.id);
          done++;
        }
      plan = { state: 'started', items: items.length, done };
    }
  }
  return { layers, plan };
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
    console.error('Usage: bun scripts/boarding-seed.ts [--organisation <id>]');
    process.exit(2);
  }
  try {
    const { layers, plan } = await seedBoarding(organisationId);
    console.log(
      `Seeded boarding for organisation "${organisationId}": ${layers.added} layers added, ${layers.replaced} replaced, ${layers.unchanged} unchanged; ` +
        (plan.state === 'started'
          ? `one introduction started with ${plan.items} items, ${plan.done} done.`
          : plan.state === 'kept'
            ? 'the open introduction kept.'
            : 'no introduction started (the manager or the person is not provisioned yet).'),
    );
  } catch (error) {
    console.error(`Could not seed: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}
