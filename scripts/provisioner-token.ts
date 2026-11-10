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
 */
import { and, eq, isNull } from 'drizzle-orm';
import { database, closeDatabase } from '@clew/db';
import { provisioners } from '@clew/db/auth';
import { writeAudit } from '@clew/db/threads';
import { randomToken, tokenDigest } from '../apps/server/src/auth-crypto';

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
if (command !== 'list' && !/^[a-z0-9][a-z0-9-]{1,63}$/.test(id!))
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
    const token = randomToken();
    await database().transaction(async tx => {
      const [existing] = await tx
        .select({ id: provisioners.id })
        .from(provisioners)
        .where(and(eq(provisioners.id, id!), isNull(provisioners.revokedAt)));
      if (existing)
        throw new Error(
          `Provisioner '${id}' already has an active token; use 'rotate ${id}' to replace it without a gap, or revoke it first.`,
        );
      const fresh = {
        organisationId,
        label,
        tokenDigest: tokenDigest(token),
        createdBy: 'bootstrap:cli',
        createdAt: new Date(),
        revokedAt: null,
        lastSeenAt: null,
        previousTokenDigest: null,
        previousValidUntil: null,
      };
      await tx
        .insert(provisioners)
        .values({ id: id!, ...fresh })
        .onConflictDoUpdate({ target: provisioners.id, set: fresh });
      await writeAudit(tx, {
        actor: 'bootstrap:cli',
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
    const token = randomToken(),
      now = new Date(),
      until = new Date(now.getTime() + hours * 60 * 60 * 1000);
    // One token is kept from before: a second rotation inside the grace period ends the first one's old token.
    const cutOff = await database().transaction(async tx => {
      const [current] = await tx
        .select({ tokenDigest: provisioners.tokenDigest, previousValidUntil: provisioners.previousValidUntil })
        .from(provisioners)
        .where(and(eq(provisioners.id, id!), isNull(provisioners.revokedAt)))
        .for('update');
      if (!current) throw new Error(`Provisioner '${id}' has no active token; use 'add'.`);
      await tx
        .update(provisioners)
        .set({
          tokenDigest: tokenDigest(token),
          previousTokenDigest: hours > 0 ? current.tokenDigest : null,
          previousValidUntil: hours > 0 ? until : null,
        })
        .where(eq(provisioners.id, id!));
      await writeAudit(tx, {
        actor: 'bootstrap:cli',
        action: 'provisioner.rotated',
        subject: 'provisioner:' + id,
        details: { graceHours: hours, previousValidUntil: hours > 0 ? until.toISOString() : null },
      });
      return current.previousValidUntil && current.previousValidUntil > now ? current.previousValidUntil : null;
    });
    console.log(
      hours > 0
        ? `Provisioner '${id}' has a new token. The previous one answers until ${until.toISOString()}. The new token, shown once:`
        : `Provisioner '${id}' has a new token and the previous one no longer authenticates. The new token, shown once:`,
    );
    console.log(token);
    if (cutOff)
      console.log(
        `Note: the token rotated out before that one would have answered until ${when(cutOff)} and no longer does.`,
      );
  } else {
    await database().transaction(async tx => {
      const changed = await tx
        .update(provisioners)
        .set({ revokedAt: new Date(), previousTokenDigest: null, previousValidUntil: null })
        .where(and(eq(provisioners.id, id!), isNull(provisioners.revokedAt)))
        .returning({ id: provisioners.id });
      if (!changed.length) throw new Error(`Provisioner '${id}' has no active token.`);
      await writeAudit(tx, {
        actor: 'bootstrap:cli',
        action: 'provisioner.revoked',
        subject: 'provisioner:' + id,
        details: {},
      });
    });
    console.log(`Provisioner '${id}' revoked; none of its tokens authenticates.`);
  }
} finally {
  await closeDatabase();
}
