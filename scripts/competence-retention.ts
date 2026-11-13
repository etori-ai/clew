/**
 * The retention period of the competence domain (D108 item 14): how many days after the directory deactivates a person
 * their competence is erased, per organisation. An operator's setting with no default: while it is unset, nothing is
 * erased (D120 "Open"). Runs inside the app container with the server's local settings (DATABASE_URL); no route, no
 * page and no `package.json` entry. A change is audited (`competence.retention_set` or `competence.retention_cleared`,
 * the period before and after and a count only) with the actor `operator:cli`.
 *
 *   bun scripts/competence-retention.ts --organisation <id>              print the period and who waits
 *   bun scripts/competence-retention.ts --organisation <id> --days <n>   set it, 1 to 3650 days (`--days=<n>` too)
 *   bun scripts/competence-retention.ts --organisation <id> --off        clear it
 *
 * The period applies at once to everyone of the organisation who is deactivated, counted from their deactivation (or
 * from when the server's hourly sweep first found it), and never brings an erasure due within a day of the change, so
 * a period set too short by mistake can be set again first. The running server's hourly sweep erases what is due;
 * this script erases nothing itself. An organisation is one that has a provisioned person or a provisioner: another
 * name is refused, so a typo sets nothing.
 */
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { closeDatabase, database, schema } from '@clew/db';
import { competence } from '../apps/server/src/composition/competence';
import { OPERATOR } from './competence-seed';
import { parseRetentionArguments, RETENTION_USAGE as usage } from './competence-retention-arguments';

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

if (import.meta.main) {
  try {
    process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
  } catch {
    /* settings may come from the environment */
  }
  const parsed = parseRetentionArguments(process.argv.slice(2));
  if (typeof parsed === 'string') {
    console.error(`${parsed}\n${usage}`);
    process.exit(2);
  }
  const { organisation: organisationId, days, off } = parsed;
  const changing = days !== undefined || off;
  try {
    const [person] = await database()
      .select({ id: schema.people.id })
      .from(schema.people)
      .where(eq(schema.people.organisationId, organisationId))
      .limit(1);
    const [provisioner] = person
      ? [person]
      : await database()
          .select({ id: schema.provisioners.id })
          .from(schema.provisioners)
          .where(eq(schema.provisioners.organisationId, organisationId))
          .limit(1);
    if (!provisioner) {
      console.error(
        `No organisation "${organisationId}": no person and no provisioner belong to it. Nothing was ${changing ? 'changed' : 'read'}.`,
      );
      process.exitCode = 2;
    } else {
      if (changing) {
        const wanted = off ? null : Number(days);
        const changed = await competence.setRetention(OPERATOR, organisationId, wanted);
        if (!changed.changed)
          console.log(
            wanted === null
              ? `No retention period was set for organisation "${organisationId}"; nothing changed.`
              : `The retention period of organisation "${organisationId}" is already ${plural(wanted, 'day', 'days')}; nothing changed.`,
          );
        else if (wanted === null)
          console.log(
            `Cleared the retention period of organisation "${organisationId}" (it was ${plural(changed.previous!, 'day', 'days')}). Nothing is erased until a period is set again.`,
          );
        else
          console.log(
            `Set the retention period of organisation "${organisationId}" to ${plural(wanted, 'day', 'days')}${changed.previous === null ? '' : ` (it was ${plural(changed.previous, 'day', 'days')})`}.`,
          );
      }
      const state = await competence.retentionOf(organisationId);
      console.log(
        state.period
          ? `Organisation "${organisationId}": the competence of a person the directory deactivates is erased ${plural(state.period.days, 'day', 'days')} after (set by ${state.period.setBy} at ${state.period.setAt}).`
          : `Organisation "${organisationId}" has no retention period: nothing is erased.`,
      );
      console.log(
        state.period
          ? `Deactivated people waiting for erasure: ${state.waiting}${state.nextDue ? ` (the next due at ${state.nextDue})` : ''}. Overdue: ${state.overdue}.`
          : `Deactivated people held without a period: ${state.held}.`,
      );
      if (state.overdue)
        console.log(
          `Note: ${plural(state.overdue, 'erasure is', 'erasures are')} due and not yet made; the server's hourly sweep makes them. If they stay overdue, read the server's log for the sweep's warnings.`,
        );
      if (state.dueWithinDay)
        console.log(
          `Note: ${plural(state.dueWithinDay, 'erasure falls', 'erasures fall')} due within a day. To hold them back, set a longer period or clear it with --off before then.`,
        );
    }
  } catch (error) {
    // An operator's error (a period out of bounds) or the database's; neither names a person.
    console.error(`Could not ${changing ? 'change' : 'read'} the retention period: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}
