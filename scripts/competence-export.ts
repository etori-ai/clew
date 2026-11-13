/**
 * Export the competence domain of one organisation (D108 item 14) as one versioned document, `clew.competence/8`: the
 * catalogue, archived and merged types included with the address each was imported with, every holding of its people (copied ones with their source, a person's own with
 * its decision, item 7), the mappings of sources' types (item 9), and the requirements and share targets (item 6). Runs inside the app container with the server's local
 * settings (DATABASE_URL); no route and no `package.json` entry. The export is audited (`competence.exported`, counts
 * only) with the actor `operator:cli`.
 *
 *   bun scripts/competence-export.ts --organisation <id> --out <file>
 *
 * The document says what named people hold: it is written with mode 0600, never over an existing file, and only the
 * counts are printed.
 */
import { resolve } from 'node:path';
import { open, unlink } from 'node:fs/promises';
import { closeDatabase } from '@clew/db';
import { competence } from '../apps/server/src/composition/competence';
import { OPERATOR } from './competence-seed';

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
  console.error('Usage: bun scripts/competence-export.ts --organisation <id> --out <file>');
  process.exit(2);
}
// The file first: `wx` never overwrites one already there, and the mode applies to the file this creates. So an
// export that cannot be written is never read or audited.
let file: Awaited<ReturnType<typeof open>> | undefined;
try {
  file = await open(out, 'wx', 0o600);
  const document = await competence.exportDomain(OPERATOR, organisationId);
  await file.writeFile(JSON.stringify(document, null, 2) + '\n');
  console.log(
    `Exported ${document.format} for organisation "${organisationId}" to ${out}: ${document.types.length} types, ${document.holdings.length} holdings, ${document.requirements.length} requirements, ${document.shareTargets.length} share targets.`,
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
