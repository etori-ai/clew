/**
 * The arguments of `scripts/competence-retention.ts` (D108 item 14), apart from the script so a unit test reads them
 * without the server's composition. `--name value` and `--name=value` alike; anything else, or a name given twice, is an
 * error and never a read-only print.
 */
import { RETENTION_DAYS_MAX, RETENTION_DAYS_MIN } from '../apps/server/src/modules/competence/domain';

export const RETENTION_USAGE = `Usage: bun scripts/competence-retention.ts --organisation <id> [--days <${RETENTION_DAYS_MIN} to ${RETENTION_DAYS_MAX}> | --off]`;
/** The organisation, the period asked for as written (checked by the use case), and whether to clear it; or what is wrong. */
export function parseRetentionArguments(
  args: readonly string[],
): { organisation: string; days?: string; off: boolean } | string {
  const values = new Map<string, string>();
  let off = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--off') {
      if (off) return 'Give --off once.';
      off = true;
      continue;
    }
    const match = /^--(organisation|days)(?:=(.*))?$/.exec(arg);
    if (!match) return `Unknown argument "${arg}".`;
    const name = match[1]!,
      value = match[2] ?? args[++i];
    if (value === undefined || value === '' || value.startsWith('--')) return `--${name} needs a value.`;
    if (values.has(name)) return `Give --${name} once.`;
    values.set(name, value);
  }
  const organisation = values.get('organisation');
  if (!organisation) return 'Name the organisation with --organisation.';
  if (off && values.has('days')) return 'Give either --days or --off, not both.';
  return { organisation, ...(values.has('days') ? { days: values.get('days')! } : {}), off };
}
