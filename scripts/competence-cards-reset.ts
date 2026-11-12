/**
 * Retire the competence cards that the scan left open from when it named a card by its topic alone (D108 item 12, D47).
 * Such a card was stored as topic-only work, which a complete observation never resolves, so "X saknas" or "X går ut"
 * stayed open after its cause was gone. In one transaction every open card of the `competence` connector whose open
 * occurrences are all topic-only has them resolved and is marked handled, as the refresh resolves a card whose source
 * says it is gone; the person's own snooze and reminder on it are ended, and each card is audited
 * (`thread.source_resolved`, reason `legacy-reset`) with the actor `operator:cli`. A card with a write under way is left
 * alone and counted. The next scan of each person pushes a fresh card for every cause that still stands.
 *
 * A dry run by default: it prints what it would do and writes nothing. Runs inside the app container with the server's
 * local settings (DATABASE_URL); no route and no `package.json` entry. A timer's running wait is not cancelled from here
 * (no durable engine runs in a script): its row is ended in the transaction, and the wait finds it so when it fires.
 *
 *   bun scripts/competence-cards-reset.ts [--confirm]
 */
import { resolve } from 'node:path';
import { COMPETENCE_CONNECTOR } from '@clew/connectors';
import { closeDatabase } from '@clew/db';
import { postgresRefreshStore } from '../apps/server/src/threads/adapters/refresh-postgres';
import { legacyCardsUsecases } from '../apps/server/src/threads/usecases/legacy-cards';
import { ledger } from '../apps/server/src/composition/durable';
import { openSecret, sealSecret } from '../apps/server/src/auth-crypto';
import { OPERATOR } from './competence-seed';

try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
} catch {
  /* settings may come from the environment */
}
const confirm = process.argv.slice(2).includes('--confirm');
const cards = legacyCardsUsecases({
  store: postgresRefreshStore({ durable: ledger, sealer: { seal: sealSecret, open: openSecret } }),
  clock: () => new Date(),
});
try {
  const done = await cards.reset(COMPETENCE_CONNECTOR, OPERATOR, { confirm });
  console.log(
    `${confirm ? 'Retired' : 'Would retire'} ${done.cards} open competence cards from topic-only scans (${done.occurrences} occurrences); ${done.skipped} with a write under way left alone; ${done.left} topic-only occurrences of cards that are not open left as they are.${confirm ? '' : ' Run again with --confirm to write.'}`,
  );
} catch (error) {
  console.error(`Could not reset: ${(error as Error).message}`);
  process.exitCode = 1;
} finally {
  await closeDatabase();
}
