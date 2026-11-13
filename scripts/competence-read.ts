/**
 * Read the sources that answer the holdings profile now (D108 item 9) and print what each read did, in counts only. The
 * run is asked for as an administrator's "Läs in nu" is: a `competenceCopy` workflow started with the transaction that
 * records the request (audited as `competence.read_requested` with the actor `operator:cli`), and read by the running
 * server's durable engine, which holds the live connectors; two runs never read one source at once. The script waits
 * for the run to finish and prints each source's outcome. Runs inside the app container with the server's local
 * settings (DATABASE_URL); no route and no `package.json` entry.
 *
 *   bun scripts/competence-read.ts [--connector <id>] [--wait <seconds>]
 *
 * Nothing is read while the competence module is switched off under Anslutna system, and a source that does not
 * answer is recorded as failed and read again at the next daily run.
 */
import { resolve } from 'node:path';
import { sql } from 'drizzle-orm';
import { closeDatabase, database } from '@clew/db';
import { competence, competenceStore } from '../apps/server/src/composition/competence';
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
const connectorId = option('connector');
const wait = Number(option('wait') ?? 600);
if ((connectorId !== undefined && !/^[a-z][a-z0-9-]*$/.test(connectorId)) || !Number.isFinite(wait) || wait < 0) {
  console.error('Usage: bun scripts/competence-read.ts [--connector <id>] [--wait <seconds>]');
  process.exit(2);
}
const status = async (workflowId: string) => {
  const rows = await database().execute<{ status: string }>(
    sql`select status from dbos.workflow_status where workflow_uuid = ${workflowId}`,
  );
  return [...rows][0]?.status;
};
try {
  const asked = await competence.requestRun(OPERATOR, connectorId);
  console.log(`Asked for run ${asked.run} (workflow ${asked.workflowId}).`);
  const until = Date.now() + wait * 1000;
  let state = await status(asked.workflowId);
  while (state !== 'SUCCESS' && state !== 'ERROR' && state !== 'CANCELLED' && Date.now() < until) {
    await new Promise(r => setTimeout(r, 1000));
    state = await status(asked.workflowId);
  }
  if (state !== 'SUCCESS') {
    console.log(
      state === 'ERROR' || state === 'CANCELLED'
        ? `The run ended ${state}: see the server's log.`
        : `The run is still ${state ?? 'queued'}: the server's durable engine reads it once an instance runs. Check again with the administration page.`,
    );
    process.exitCode = state === 'ERROR' || state === 'CANCELLED' ? 1 : 0;
  } else {
    const records = (await competenceStore.transaction(tx => tx.sources())).filter(
      s => s.finishedAt !== null && s.finishedAt >= asked.at && (!connectorId || s.connectorId === connectorId),
    );
    if (!records.length)
      console.log(
        'No source was read: none answers the holdings profile, another run held it, or the module is switched off.',
      );
    for (const s of records) {
      // The whole read's counts: an operator reads the installation's, every organisation's together.
      const c = s.counts!.total;
      console.log(
        `${s.connectorId.padEnd(14)} ${s.outcome}: ${c.read} read, ${c.stored} stored, ${c.unchanged} unchanged, ${s.counts!.unmatched} keys matched nobody, ${c.outside} people outside an audience, ${c.invalid} unusable, ${c.unmapped} types not mapped, ${c.revoked} revoked, ${c.removed} removed`,
      );
    }
  }
} catch (error) {
  // A message from the database names no person; the read's rows are never printed.
  console.error(`Could not read: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
