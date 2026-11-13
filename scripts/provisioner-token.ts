/**
 * A provisioner's bearer token for the SCIM server (D68): issue, list, rotate, revoke. Run inside the app container:
 *   bun scripts/provisioner-token.ts add <id> --organisation <organisationId> --label "<text>"
 *   bun scripts/provisioner-token.ts list
 *   bun scripts/provisioner-token.ts rotate <id> [--grace-hours <n>]
 *   bun scripts/provisioner-token.ts revoke <id>
 * A token is printed once, here, and never stored: Clew keeps its digest. Hand it to the provisioner over a secure
 * channel. `rotate` issues a new token and lets the old one answer for the grace period (24 hours unless said, 0 ends
 * it at once), so the client is switched without a push failing. One old token is kept: rotating again inside the
 * grace period ends the one before, and the script says so. `revoke` ends every token of the provisioner now.
 * `rotate` and `revoke` run through the use cases the users page runs (D107 item 6), in one transaction with the same
 * audit rows, `endedEarlier` included, and with `bootstrap:cli` as the actor.
 */
import { PROVISIONER_ID_PATTERN, PROVISIONER_LABEL_PATTERN } from '@clew/contracts';
import { database, closeDatabase } from '@clew/db';
import { provisioners } from '@clew/db/auth';
import { randomToken, tokenDigest } from '../apps/server/src/auth-crypto';
import { postgresProvisionStore } from '../apps/server/src/modules/people/adapters/postgres';
import { provisionerKeys } from '../apps/server/src/composition/people';

/** Who the audit rows of this script name: the operator at the installation's command line (D107 item 6). */
const ACTOR = 'bootstrap:cli';
const USAGE =
  'Usage: bun scripts/provisioner-token.ts add <id> --organisation <organisationId> --label "<text>" | list | rotate <id> [--grace-hours <n>] | revoke <id>';
const [command, id, ...rest] = process.argv.slice(2);
const option = (name: string) => {
  const index = rest.indexOf('--' + name);
  return index === -1 ? undefined : rest[index + 1];
};
if (!command || !['add', 'list', 'rotate', 'revoke'].includes(command) || (command !== 'list' && !id)) {
  console.error(USAGE);
  process.exit(2);
}
if (command !== 'list' && !new RegExp(PROVISIONER_ID_PATTERN).test(id!))
  throw new Error('The provisioner id is lowercase letters, digits and dashes.');
const when = (at: Date | null) => (at ? at.toISOString() : 'never');
try {
  if (command === 'list') {
    const rows = await database().select().from(provisioners).orderBy(provisioners.id);
    if (!rows.length) console.log('No provisioner has been issued a token.');
    const now = new Date();
    for (const p of rows) {
      const state = p.revokedAt
        ? `revoked ${when(p.revokedAt)}`
        : p.previousValidUntil && p.previousValidUntil > now
          ? `active; the previous token also answers until ${when(p.previousValidUntil)}`
          : 'active';
      console.log(
        `${p.id}\torganisation ${p.organisationId}\t"${p.label}"\t${state}\tissued ${when(p.createdAt)}\tlast seen ${when(p.lastSeenAt)}`,
      );
    }
  } else if (command === 'add') {
    const organisationId = option('organisation'),
      label = option('label') ?? id!;
    if (!organisationId) throw new Error('--organisation is required: the organisation this provisioner fills.');
    // The rule the users page issues under: one line, without a control character.
    if (!new RegExp(PROVISIONER_LABEL_PATTERN).test(label))
      throw new Error('The label is one line of text without control characters.');
    const token = randomToken();
    // Issued by the store's own operation, the one the users page issues with (D107): the id is taken or not in the
    // write itself, so of two issues at once one is refused. This script used to look first and write afterwards.
    await postgresProvisionStore().transaction(async tx => {
      const issued = await tx.issueProvisioner({
        id: id!,
        organisationId,
        label,
        tokenDigest: tokenDigest(token),
        createdBy: ACTOR,
        createdAt: new Date().toISOString(),
      });
      if (!issued)
        throw new Error(
          `Provisioner '${id}' already has an active token, or the id is another organisation's; use 'rotate ${id}' to replace a token without a gap, revoke it first, or choose another id.`,
        );
      await tx.audit({
        actor: ACTOR,
        action: 'provisioner.added',
        subject: 'provisioner:' + id,
        details: { organisationId, label },
      });
    });
    console.log(
      `Provisioner '${id}' may push to /scim/v2 for organisation '${organisationId}'. Its token, shown once:`,
    );
    console.log(token);
  } else if (command === 'rotate') {
    // A flag without a number is refused, not read as the default: `--grace-hours` alone is easily meant as "none".
    const hours = rest.includes('--grace-hours') ? Number(option('grace-hours') ?? NaN) : 24;
    if (!Number.isFinite(hours) || hours < 0 || hours > 24 * 30)
      throw new Error('--grace-hours is a number of hours from 0 to 720.');
    const rotated = await provisionerKeys.rotate(ACTOR, id!, hours);
    if (!rotated) throw new Error(`Provisioner '${id}' has no active token; use 'add'.`);
    console.log(
      rotated.previousValidUntil
        ? `Provisioner '${id}' has a new token. The previous one answers until ${rotated.previousValidUntil}. The new token, shown once:`
        : `Provisioner '${id}' has a new token and the previous one no longer authenticates. The new token, shown once:`,
    );
    console.log(rotated.token);
    // One token is kept from before: a second rotation inside the grace period ended the first one's old token.
    if (rotated.endedEarlier)
      console.log(
        `Note: the token rotated out before that one would have answered until ${rotated.endedEarlier} and no longer does.`,
      );
  } else {
    if (!(await provisionerKeys.revoke(ACTOR, id!))) throw new Error(`Provisioner '${id}' has no active token.`);
    console.log(`Provisioner '${id}' revoked; none of its tokens authenticates.`);
  }
} finally {
  await closeDatabase();
}
