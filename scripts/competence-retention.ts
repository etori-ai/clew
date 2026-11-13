/**
 * The retention period of the competence domain (D108 item 14): how many days after the directory deactivates a person
 * their competence is erased, per organisation. An operator's setting with no default: while it is unset, nothing is
 * scheduled and nothing is erased (D120 "Open"). Runs inside the app container with the server's local settings
 * (DATABASE_URL); no route, no page and no `package.json` entry. A change is audited (`competence.retention_set` or
 * `competence.retention_cleared`, the period before and after and counts only) with the actor `operator:cli`.
 *
 *   bun scripts/competence-retention.ts --organisation <id>              print the period and who waits
 *   bun scripts/competence-retention.ts --organisation <id> --days <n>   set it, 1 to 3650 days
 *   bun scripts/competence-retention.ts --organisation <id> --off        clear it
 *
 * Setting the period schedules the erasure of everyone of the organisation the directory has deactivated and who is not
 * yet erased, counted from their deactivation where Clew recorded it, else from now. Changing it re-times every erasure
 * that waits, shorter or longer. Clearing it cancels them all; the people are held until a period is set again. No
 * erasure set or changed here falls due within a day of the change, so a period set too short by mistake can be set
 * again first. The durable engine of the running server carries the erasures out; a wait this script ends is cancelled
 * by the server's engine when it can, and is otherwise refused by its generation when it wakes.
 */
import { resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import { competence } from '../apps/server/src/composition/competence';
import { RETENTION_DAYS_MAX, RETENTION_DAYS_MIN } from '../apps/server/src/modules/competence/domain';
import { OPERATOR } from './competence-seed';

try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
} catch {
  /* settings may come from the environment */
}
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf('--' + name);
  const value = i >= 0 ? args[i + 1] : undefined;
  return value && !value.startsWith('--') ? value : undefined;
};
const usage = `Usage: bun scripts/competence-retention.ts --organisation <id> [--days <${RETENTION_DAYS_MIN} to ${RETENTION_DAYS_MAX}> | --off]`;
const organisationId = option('organisation'),
  days = option('days'),
  off = args.includes('--off');
if (!organisationId || (days !== undefined && off) || (args.includes('--days') && days === undefined)) {
  console.error(usage);
  process.exit(2);
}
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
try {
  if (days !== undefined || off) {
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
        `Cleared the retention period of organisation "${organisationId}" (it was ${plural(changed.previous!, 'day', 'days')}): ${plural(changed.cancelled, 'scheduled erasure', 'scheduled erasures')} cancelled. Nothing is erased until a period is set again.`,
      );
    else
      console.log(
        `Set the retention period of organisation "${organisationId}" to ${plural(wanted, 'day', 'days')}${changed.previous === null ? '' : ` (it was ${plural(changed.previous, 'day', 'days')})`}: ${plural(changed.scheduled, 'erasure', 'erasures')} scheduled, ${changed.retimed} re-timed${changed.cancelled ? `, ${changed.cancelled} cancelled for people active again` : ''}.`,
      );
  }
  const state = await competence.retentionOf(organisationId);
  console.log(
    state.period
      ? `Organisation "${organisationId}": the competence of a person the directory deactivates is erased ${plural(state.period.days, 'day', 'days')} after (set by ${state.period.setBy} at ${state.period.setAt}).`
      : `Organisation "${organisationId}" has no retention period: nothing is scheduled and nothing is erased.`,
  );
  console.log(
    `Deactivated people waiting for erasure: ${state.waiting}${state.firstDue ? ` (the first due at ${state.firstDue})` : ''}. Held without a period: ${state.held}.`,
  );
  if (state.dueWithinDay)
    console.log(
      `Note: ${plural(state.dueWithinDay, 'erasure falls', 'erasures fall')} due within a day. To hold them back, set a longer period or run with --off.`,
    );
} catch (error) {
  // An operator's error (a period out of bounds) or the database's; neither names a person.
  console.error(
    `Could not ${days !== undefined || off ? 'change' : 'read'} the retention period: ${(error as Error).message}`,
  );
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
