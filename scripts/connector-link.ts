/**
 * Approve where a connector's people are sent to link their account (D147 item 4), from the command line, until
 * Administration › Anslutna system has the review. Runs inside the app container with the server's local settings
 * (DATABASE_URL and the installation's key). The work is the linked-accounts use case's operator side: the same checks
 * and the same audit row (`account.server-approved`), with `bootstrap:linked-accounts` as the actor. Nothing is
 * restarted: the next person who links, and the next call, read the approval.
 *
 *   bun scripts/connector-link.ts <connector id>
 *       Reads the system's address from the connector's approved manifest (`linkedAccount.resource`), discovers its
 *       authorization server and approves it.
 *   bun scripts/connector-link.ts <connector id> --issuer <url> --authorization-endpoint <url> --token-endpoint <url>
 *                                 [--revocation-endpoint <url>] --client-id <id> [--client-secret-stdin]
 *       For a system that publishes no metadata: the addresses and the client made at the system, its secret read from
 *       standard input. `--client-id` may also be given alone, beside discovery, for a client registered by hand.
 *   bun scripts/connector-link.ts <connector id> --show
 *       What is approved now. Never a secret.
 *
 * The address to register at the system as the client's redirect address is printed with every answer.
 */
import { resolve } from 'node:path';
import { closeDatabase } from '@clew/db';

try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
} catch {
  /* settings may come from the environment */
}
const { linkedAccounts, LINK_REDIRECT_PATH } = await import('../apps/server/src/composition/linked-accounts');
const { LinkRefusedError, LinkUnavailableError } = await import('../apps/server/src/modules/linked-accounts/contracts');

const usage =
  'Usage: bun scripts/connector-link.ts <connector id> [--show | --issuer <url> --authorization-endpoint <url> ' +
  '--token-endpoint <url> [--revocation-endpoint <url>]] [--client-id <id> [--client-secret-stdin]]';
const args = process.argv.slice(2);
const id = args[0];
const option = (name: string) => {
  const at = args.indexOf('--' + name);
  return at > 0 ? args[at + 1] : undefined;
};
const flag = (name: string) => args.includes('--' + name);
/** Why the use case refused, in the script's own words: its messages are Swedish, written for a page. */
const refusals: Record<string, string> = {
  'unknown-connector': 'no connector with that id has an approved manifest that declares linkedAccount',
  'no-server':
    'the system publishes no authorization server at that address; give --issuer, --authorization-endpoint and --token-endpoint',
};
const show = (view: Awaited<ReturnType<typeof linkedAccounts.approveAsOperator>>) => {
  console.log(
    `${view.connectorId}: people are sent to ${view.issuer} (${view.origin}) for ${view.resource}. ` +
      `Client: ${view.clientId ?? 'registered by Clew when the first person links'}. ` +
      `Approved by ${view.approvedBy} at ${view.approvedAt}.`,
  );
  console.log(
    `Redirect address to register at the system: ${(process.env.PUBLIC_URL ?? '').replace(/\/$/, '')}${LINK_REDIRECT_PATH}`,
  );
};
async function main() {
  if (!id || id.startsWith('--')) {
    console.error(usage);
    return 1;
  }
  if (flag('show')) {
    const view = await linkedAccounts.approvalAsOperator(id);
    if (view) show(view);
    else console.log(`${id}: nothing is approved.`);
    return 0;
  }
  const issuer = option('issuer'),
    authorizationEndpoint = option('authorization-endpoint'),
    tokenEndpoint = option('token-endpoint'),
    clientId = option('client-id');
  const entered = [issuer, authorizationEndpoint, tokenEndpoint].filter(Boolean).length;
  if (entered !== 0 && entered !== 3) {
    console.error('Give --issuer, --authorization-endpoint and --token-endpoint together, or none of them.\n' + usage);
    return 1;
  }
  if (entered === 3 && !clientId) {
    console.error('A system whose addresses are entered needs the client made there: --client-id.\n' + usage);
    return 1;
  }
  if (flag('client-secret-stdin') && !clientId) {
    console.error('--client-secret-stdin needs --client-id.\n' + usage);
    return 1;
  }
  const secret = flag('client-secret-stdin') ? (await Bun.stdin.text()).trim() : undefined;
  if (flag('client-secret-stdin') && !secret) {
    console.error('No client secret was read from standard input.');
    return 1;
  }
  try {
    show(
      await linkedAccounts.approveAsOperator(id, {
        ...(entered === 3
          ? {
              server: {
                issuer: issuer!,
                authorizationEndpoint: authorizationEndpoint!,
                tokenEndpoint: tokenEndpoint!,
                revocationEndpoint: option('revocation-endpoint') ?? null,
              },
            }
          : {}),
        ...(clientId ? { client: { id: clientId, secret: secret ?? null } } : {}),
      }),
    );
    return 0;
  } catch (error) {
    if (error instanceof LinkRefusedError) console.error(`Refused: ${refusals[error.reason] ?? error.reason}.`);
    else if (error instanceof LinkUnavailableError)
      console.error(`The system's authorization server did not answer (${error.reason}). Nothing was approved.`);
    else if (error instanceof Error && error.name === 'InputError')
      console.error(
        'Refused: every address must be a full http or https address, and the client id must not be empty.',
      );
    else throw error;
    return 1;
  }
}
try {
  process.exitCode = await main();
} finally {
  await closeDatabase();
}
