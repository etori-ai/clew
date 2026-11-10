/**
 * Open a round of development talks for an organisation (D96 item 1) from the command line: an operator's act, with no
 * route and no page. Opening a round closes the organisation's open one in the same transaction; both are audited with
 * the actor `operator:cli`. Runs inside the app container with the server's local settings (DATABASE_URL); there is no
 * `package.json` entry, as for the other operator scripts.
 *
 *   bun scripts/talk-round.ts --label "Utvecklingssamtal 2026" --opens 2026-09-01 --due 2026-11-28 [--organisation poc]
 *   bun scripts/talk-round.ts ... --if-none     open only when the organisation has no open round (the development seed)
 *
 * `--organisation` defaults to `poc`, the development directory's organisation (`scripts/auth-setup.ts`).
 */
import { resolve } from 'node:path';
import { closeDatabase } from '@clew/db';
import { talks, talkStore } from '../apps/server/src/composition/talks';

export const OPERATOR = 'operator:cli';
/** The organisation the development directory provisions into (`scripts/auth-setup.ts`). */
export const DEVELOPMENT_ORGANISATION = 'poc';
/** The development chain's round (D96): the planner's deadline before the talks module owned it. */
export const DEVELOPMENT_ROUND = {
  organisationId: DEVELOPMENT_ORGANISATION,
  label: 'Utvecklingssamtal 2026',
  opensOn: '2026-09-01',
  dueOn: '2026-11-28',
};
export interface RoundInput {
  organisationId: string;
  label: string;
  opensOn: string;
  dueOn: string;
}
/** The organisation's open round, read through the talks store's port (no use case reads it without a manager). */
export const openRoundOf = (organisationId: string) => talkStore.transaction(tx => tx.currentRound(organisationId));

/**
 * Open the round. With `ifNone`, an organisation that already has an open round keeps it and nothing is written. The
 * read and the open are two transactions, so two runs at once can still both open; the second closes the first.
 */
export async function openTalkRound(input: RoundInput, options: { ifNone?: boolean } = {}) {
  const current = await openRoundOf(input.organisationId);
  if (current && options.ifNone) return { opened: undefined, kept: current.id, closed: undefined };
  const opened = await talks.openRound(OPERATOR, input);
  return { opened, kept: undefined, closed: current?.id };
}

if (import.meta.main) {
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
  const label = option('label'),
    opensOn = option('opens'),
    dueOn = option('due');
  if (!label || !opensOn || !dueOn) {
    console.error(
      'Usage: bun scripts/talk-round.ts --label "<label>" --opens YYYY-MM-DD --due YYYY-MM-DD [--organisation <id>] [--if-none]',
    );
    process.exit(2);
  }
  const organisationId = option('organisation') ?? DEVELOPMENT_ORGANISATION;
  try {
    const result = await openTalkRound(
      { organisationId, label, opensOn, dueOn },
      { ifNone: args.includes('--if-none') },
    );
    if (result.kept) console.log(`Organisation "${organisationId}" already has an open round ${result.kept}; kept.`);
    else {
      console.log(`Opened round ${result.opened} for organisation "${organisationId}" (${opensOn} to ${dueOn}).`);
      if (result.closed) console.log(`Closed the previous open round ${result.closed}.`);
    }
  } catch (error) {
    console.error(`Could not open the round: ${(error as Error).message}`);
    process.exitCode = 1;
  } finally {
    await closeDatabase();
  }
}
