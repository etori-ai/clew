/**
 * Issue or revoke a provisioner's bearer token for the SCIM server (D68). Run inside the app container:
 *   bun scripts/provisioner-token.ts add <id> --organisation <organisationId> --label "<text>"
 *   bun scripts/provisioner-token.ts revoke <id>
 * The token is printed once, here, and never stored: Clew keeps its digest. Hand it to the provisioner over a secure channel.
 */
import { and, eq, isNull } from 'drizzle-orm';
import { database, closeDatabase } from '@clew/db';
import { provisioners } from '@clew/db/auth';
import { writeAudit } from '@clew/db/threads';
import { randomToken, tokenDigest } from '../apps/server/src/auth-crypto';

const [command, id, ...rest] = process.argv.slice(2);
const option = (name: string) => {
  const index = rest.indexOf('--' + name);
  return index === -1 ? undefined : rest[index + 1];
};
if (!command || !id || !['add', 'revoke'].includes(command)) {
  console.error(
    'Usage: bun scripts/provisioner-token.ts add <id> --organisation <organisationId> --label "<text>" | revoke <id>',
  );
  process.exit(2);
}
if (!/^[a-z0-9][a-z0-9-]{1,63}$/.test(id))
  throw new Error('The provisioner id is lowercase letters, digits and dashes.');
try {
  if (command === 'add') {
    const organisationId = option('organisation'),
      label = option('label') ?? id;
    if (!organisationId) throw new Error('--organisation is required: the organisation this provisioner fills.');
    const token = randomToken();
    await database().transaction(async tx => {
      const [existing] = await tx
        .select({ id: provisioners.id })
        .from(provisioners)
        .where(and(eq(provisioners.id, id), isNull(provisioners.revokedAt)));
      if (existing) throw new Error(`Provisioner '${id}' already has an active token; revoke it first.`);
      await tx
        .insert(provisioners)
        .values({ id, organisationId, label, digest: tokenDigest(token), createdBy: 'bootstrap:cli' })
        .onConflictDoUpdate({
          target: provisioners.id,
          set: { organisationId, label, digest: tokenDigest(token), createdBy: 'bootstrap:cli', revokedAt: null },
        });
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
  } else {
    await database().transaction(async tx => {
      const changed = await tx
        .update(provisioners)
        .set({ revokedAt: new Date() })
        .where(and(eq(provisioners.id, id), isNull(provisioners.revokedAt)))
        .returning({ id: provisioners.id });
      if (!changed.length) throw new Error(`Provisioner '${id}' has no active token.`);
      await writeAudit(tx, {
        actor: 'bootstrap:cli',
        action: 'provisioner.revoked',
        subject: 'provisioner:' + id,
        details: {},
      });
    });
    console.log(`Provisioner '${id}' revoked; its token no longer authenticates.`);
  }
} finally {
  await closeDatabase();
}
