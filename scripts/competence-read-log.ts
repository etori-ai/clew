/**
 * Read the competence domain's read log (D108 item 15, D121 item 5): who read competence about other people, as which
 * relation, what and when, the newest first. A search across the organisation and its file name the type searched for
 * (with the least level and the unit, where one was given); one person's holdings opened names whom; a manager's matrix
 * as a file names neither. Ids and counts only, as the log holds them: no name and no content. Read-only: it writes
 * nothing, not even an audit row. Runs inside the app container with the server's local settings (DATABASE_URL); no
 * route, no page (D121 asks for none) and no `package.json` entry.
 *
 *   bun scripts/competence-read-log.ts [--organisation <id>] [--person <person id>] [--reader <person id>]
 *                                      [--relation managed|registrar|self] [--kind search|person|export]
 *                                      [--since <ISO instant>] [--limit <n, default 100, at most 10000>]
 *
 * One line per read, tab-separated: when, organisation, reader, relation, kind, the type or the person, the least level
 * and the unit where given, and how many rows the read returned. Every field is printed escaped (`printable`), so no
 * value a row holds can start a line of its own, hide one or move the terminal's cursor.
 */
import { resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import { COMPETENCE_READ_KINDS, COMPETENCE_READ_RELATIONS } from '@clew/contracts';
import { competence } from '../apps/server/src/composition/competence';
import type { ReadLogQuery } from '../apps/server/src/modules/competence/model';
import { printable } from './printable';

if (import.meta.main) {
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
  const usage =
    'Usage: bun scripts/competence-read-log.ts [--organisation <id>] [--person <person id>] [--reader <person id>] [--relation managed|registrar|self] [--kind search|person|export] [--since <ISO instant>] [--limit <n>]';
  const limit = option('limit') === undefined ? 100 : Number(option('limit'));
  const since = option('since'),
    relation = option('relation'),
    kind = option('kind');
  const relations: readonly string[] = [...COMPETENCE_READ_RELATIONS, 'self'];
  if (
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 10_000 ||
    (since !== undefined && Number.isNaN(Date.parse(since))) ||
    (relation !== undefined && !relations.includes(relation)) ||
    (kind !== undefined && !(COMPETENCE_READ_KINDS as readonly string[]).includes(kind))
  ) {
    console.error(usage);
    process.exit(2);
  }
  const query: ReadLogQuery = {
    ...(option('organisation') !== undefined ? { organisationId: option('organisation') } : {}),
    ...(option('person') !== undefined ? { personId: option('person') } : {}),
    ...(option('reader') !== undefined ? { readerId: option('reader') } : {}),
    ...(relation !== undefined ? { relation: relation as ReadLogQuery['relation'] } : {}),
    ...(kind !== undefined ? { kind: kind as ReadLogQuery['kind'] } : {}),
    ...(since !== undefined ? { since: new Date(since).toISOString() } : {}),
    limit,
  };
  try {
    const rows = await competence.readLog(query);
    console.log(
      ['readAt', 'organisation', 'reader', 'relation', 'kind', 'subject', 'minLevel', 'unit', 'rows'].join('\t'),
    );
    for (const r of rows)
      console.log(
        [
          r.readAt,
          r.organisationId,
          'person:' + r.readerId,
          r.relation,
          r.kind,
          r.personId !== null ? 'person:' + r.personId : r.typeId !== null ? 'type:' + r.typeId : '',
          r.minLevel ?? '',
          r.unitId ?? '',
          r.rows,
        ]
          .map(printable)
          .join('\t'),
      );
    console.log(
      `${rows.length} read${rows.length === 1 ? '' : 's'}${rows.length === limit ? ' (the limit; there may be more)' : ''}.`,
    );
  } catch (error) {
    // A message from the database names no person; it is printed escaped as every field is.
    console.error(`Could not read the log: ${printable((error as Error).message)}`);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}
