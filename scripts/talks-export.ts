/**
 * Export the talks domain of one organisation (D96 item 10) as one versioned document, `clew.talks/1`: every round, open
 * and closed, with its talks and action points, the text of each opened. Runs inside the app container with the
 * server's local settings (MASTER_KEY, DATABASE_URL); no route and no `package.json` entry. The export is audited
 * (`talks.exported`, counts only) with the actor `operator:cli`.
 *
 *   bun scripts/talks-export.ts --organisation <id> --out <file>
 *
 * The document holds free text about people: it is written with mode 0600, never over an existing file, and only the
 * counts are printed.
 */
import { resolve } from 'node:path';
import { open, unlink } from 'node:fs/promises';
import { closeDatabase } from '@clew/db';
import { talks } from '../apps/server/src/composition/talks';
import { OPERATOR } from './talk-round';

try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
} catch {
  /* settings may come from the environment */
}
const args = process.argv.slice(2);
const option = (name: string) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};
const organisationId = option('organisation'),
  out = option('out');
if (!organisationId || !out) {
  console.error('Usage: bun scripts/talks-export.ts --organisation <id> --out <file>');
  process.exit(2);
}
// The file first: `wx` never overwrites one already there, and the mode applies to the file this creates. So an
// export that cannot be written is never read or audited.
let file: Awaited<ReturnType<typeof open>> | undefined;
try {
  file = await open(out, 'wx', 0o600);
  const document = await talks.exportDomain(OPERATOR, organisationId);
  await file.writeFile(JSON.stringify(document, null, 2) + '\n');
  console.log(
    `Exported ${document.format} for organisation "${organisationId}" to ${out}: ${document.rounds.length} rounds, ${document.talks.length} talks, ${document.commitments.length} action points.`,
  );
} catch (error) {
  // A message from the file system or the database names no person; the document itself is never printed.
  console.error(`Could not export: ${(error as Error).message}`);
  // An empty or partial file this run created is not left behind.
  if (file) await unlink(out).catch(() => undefined);
  process.exitCode = 1;
} finally {
  await file?.close();
  await closeDatabase();
}
