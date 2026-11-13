/**
 * Moves the durable engine's workflows that a deployment left waiting under an older application version to the latest
 * one, and starts one that ended in ERROR again once its cause is fixed (D85 item 2, as amended 2026-11-13; the
 * operations runbook, "After every deployment"). Runs inside the app container with the server's local settings
 * (DATABASE_URL), through a client of the engine's database: it launches no engine and runs no workflow itself, and the
 * server's engine runs what it moves.
 *
 *   bun scripts/workflows-move.ts                              lists what waits under another version than the latest
 *   bun scripts/workflows-move.ts --confirm                    moves each of them
 *   bun scripts/workflows-move.ts --workflow <id> [--confirm]  one workflow, also one in ERROR or one that a move cut
 *                                                              short left CANCELLED under an older version
 *
 * Run it once the processes of the older release have stopped: a process that still runs a workflow would run it
 * beside the moved one. A workflow that waits is cancelled, which changes only the engine's records, and rewound under
 * its own id, which the ledger's row names (D86), to the latest version on the ledger's queue, from its first step
 * without a record: the steps it recorded stand and are not run again, as when the engine recovers a workflow after a
 * crash, and the step it was in the middle of runs again, as it would then. One in ERROR is rewound from the step that
 * failed. The nights of the nightly scan and clean-up need none of this: a server's start takes them over. Never fork
 * a workflow instead: a fork has a new id, which the ledger's row does not name. `--application` names another
 * application in the same database, such as a test's engine.
 */
import { resolve } from 'node:path';
import { DEFAULT_APPLICATION, ledgerQueue } from '../apps/server/src/dbos/runtime';
import { moveCandidate, moveWorkflow, workflowClient } from '../apps/server/src/dbos/start';

const USAGE = 'Usage: bun scripts/workflows-move.ts [--application <name>] [--workflow <id>]... [--confirm]';

try {
  process.loadEnvFile(resolve(import.meta.dirname, '../apps/server/.env.local'));
} catch {
  /* settings may come from the environment */
}
const args = process.argv.slice(2);
const named: string[] = [];
let application = DEFAULT_APPLICATION,
  confirm = false,
  wellFormed = true;
for (let i = 0; i < args.length && wellFormed; i++) {
  const arg = args[i]!,
    value = args[i + 1];
  const hasValue = value !== undefined && !value.startsWith('--');
  if (arg === '--confirm' && !confirm) confirm = true;
  else if (arg === '--workflow' && hasValue) named.push(args[++i]!);
  else if (arg === '--application' && hasValue && application === DEFAULT_APPLICATION) application = args[++i]!;
  else wellFormed = false;
}
const databaseUrl = process.env.DATABASE_URL;
if (!wellFormed || !databaseUrl) {
  console.error(wellFormed ? 'DATABASE_URL is not set. Run inside the app container.' : USAGE);
  process.exit(2);
}
// The client's own warnings and errors are not this script's output: they go to stderr.
const engine = await workflowClient(databaseUrl, application, line => console.error(line));
try {
  const latest = await engine.latest(),
    queue = ledgerQueue(application);
  if (!latest) throw new Error(`no engine of ${application} has launched on this database`);
  const ids = named.length ? named : await engine.waitingUnderAnother(latest);
  if (!ids.length) console.log(`Nothing of ${application} waits under another version than ${latest}.`);
  for (const workflowID of ids) {
    const found = await moveCandidate(engine.controls, workflowID, latest);
    if ('refused' in found) {
      console.error(`${workflowID}: not moved, ${found.refused}.`);
      process.exitCode = 1;
      continue;
    }
    const where = `${found.workflowID} (${found.name}, ${found.status} under ${found.version ?? 'no version'})`;
    if (!confirm) console.log(`${where} would continue under ${latest} from step ${found.from}.`);
    else if (await moveWorkflow(engine.controls, found, latest, queue))
      console.log(`${where} moved to ${latest}, from step ${found.from}.`);
    else console.log(`${where} was moved to ${latest} by another move meanwhile.`);
  }
  if (ids.length && !confirm) console.log('Nothing was moved. Run again with --confirm to move.');
} catch (error) {
  console.error(`Could not move: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await engine.destroy();
}
