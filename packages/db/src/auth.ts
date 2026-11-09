import { and, eq, gt, isNotNull, isNull, lte, or, sql } from 'drizzle-orm';
import { database } from './index';
import {
  people,
  accessGrants,
  identityBindings,
  groups,
  groupMembers,
  sessions,
  loginTransactions,
  authenticationAudit,
  logoutReceipts,
  audit,
} from './schema';
export {
  people,
  accessGrants,
  units,
  assignments,
  groups,
  groupMembers,
  groupCapabilities,
  provisioners,
  identityBindings,
  sessions,
  loginTransactions,
  authenticationAudit,
  logoutReceipts,
} from './schema';
export const LOGIN_TRANSACTION_MS = 5 * 60_000;
export const IDLE_MS = 8 * 60 * 60_000;
export const ABSOLUTE_MS = 8 * 60 * 60_000;
export type SessionRecord = typeof sessions.$inferSelect;

export function activeSession(digest: string, now = new Date()) {
  return and(
    eq(sessions.digest, digest),
    isNull(sessions.revokedAt),
    gt(sessions.expiresAt, now),
    gt(sessions.idleExpiresAt, now),
  );
}
export async function readSession(digest: string) {
  const [row] = await database().select().from(sessions).where(activeSession(digest));
  return row;
}
export async function readAccess(personId: string) {
  const [row] = await database()
    .select({ person: people, grant: accessGrants })
    .from(people)
    .innerJoin(accessGrants, eq(accessGrants.personId, people.id))
    .where(and(eq(people.id, personId), eq(people.enabled, true)));
  return row;
}
/** The external ids of the provisioned groups a person is in, for connector audiences (D23, D68). */
export async function readGroups(personId: string): Promise<string[]> {
  const rows = await database()
    .select({ externalId: groups.externalId })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.personId, personId), isNotNull(groups.externalId)))
    .orderBy(groups.externalId);
  return rows.map(r => r.externalId!);
}
export async function resolveSubject(issuer: string, subject: string) {
  const [row] = await database()
    .select()
    .from(identityBindings)
    .where(and(eq(identityBindings.issuer, issuer), eq(identityBindings.subject, subject)));
  return row ? readAccess(row.personId) : undefined;
}
/**
 * First login (D68 item 6): the verified subject binds to the one enabled, provisioned person whose `userName` equals the
 * configured claim's value without regard to case (RFC 7643's default for `userName`; Keycloak lowercases account names,
 * Entra does not). Exactly one match, never an e-mail address, one binding per person and issuer; a subject that
 * differs from an existing binding is refused and audited, because a change of subject needs a person's review. Returns
 * the person's access when bound, undefined when not; the caller treats undefined as a denied login.
 */
export async function bindFirstLogin(issuer: string, subject: string, claim: string, value: string) {
  return database().transaction(async tx => {
    const matches = await tx
      .select({ id: people.id, enabled: people.enabled })
      .from(people)
      .where(sql`lower(${people.userName}) = lower(${value})`);
    const [person] = matches;
    if (matches.length !== 1 || !person || !person.enabled) {
      // The claim is the account name the IdP vouched for, not a person Clew knows; it is what an operator needs to see.
      await tx.insert(authenticationAudit).values({ action: 'identity-unmatched', actor: 'claim:' + value });
      return undefined;
    }
    const [bound] = await tx
      .select({ subject: identityBindings.subject })
      .from(identityBindings)
      .where(and(eq(identityBindings.issuer, issuer), eq(identityBindings.personId, person.id)));
    if (bound) {
      if (bound.subject === subject) return readAccess(person.id);
      await tx.insert(authenticationAudit).values({ action: 'identity-conflict', actor: 'person:' + person.id });
      await tx.insert(audit).values({
        actor: 'person:' + person.id,
        action: 'identity.conflict',
        subject: 'person:' + person.id,
        details: { issuer, claim },
      });
      return undefined;
    }
    // Another binding may have claimed this subject between the lookup and here; the primary key says so.
    const inserted = await tx
      .insert(identityBindings)
      .values({ issuer, subject, personId: person.id })
      .onConflictDoNothing()
      .returning({ personId: identityBindings.personId });
    if (!inserted.length) return undefined;
    await tx.insert(authenticationAudit).values({ action: 'identity-bound', actor: 'person:' + person.id });
    await tx.insert(audit).values({
      actor: 'person:' + person.id,
      action: 'identity.bound',
      subject: 'person:' + person.id,
      details: { issuer, claim },
    });
    return readAccess(person.id);
  });
}
export async function auditAuth(action: string, actor?: string) {
  await database().insert(authenticationAudit).values({ action, actor });
}
export async function revokeSession(digest: string, action = 'logout') {
  return database().transaction(async tx => {
    const [row] = await tx
      .update(sessions)
      .set({ revokedAt: new Date(), tokens: '' })
      .where(and(eq(sessions.digest, digest), isNull(sessions.revokedAt)))
      .returning();
    if (row) await tx.insert(authenticationAudit).values({ action, actor: 'person:' + row.personId });
  });
}
export async function touchSession(digest: string) {
  const now = new Date();
  const [row] = await database()
    .update(sessions)
    .set({ idleExpiresAt: new Date(now.getTime() + IDLE_MS) })
    .where(activeSession(digest, now))
    .returning();
  return row;
}
export async function consumeLogin(digest: string) {
  const [row] = await database().delete(loginTransactions).where(eq(loginTransactions.digest, digest)).returning();
  return row && row.expiresAt > new Date() ? row : undefined;
}
export async function backchannelRevoke(input: {
  issuer: string;
  clientId: string;
  sid?: string;
  subject?: string;
  jti: string;
}) {
  await database().transaction(async tx => {
    const inserted = await tx
      .insert(logoutReceipts)
      .values({ issuer: input.issuer, jti: input.jti, expiresAt: new Date(Date.now() + 300_000) })
      .onConflictDoNothing()
      .returning();
    if (!inserted.length) return;
    const revoked = await tx
      .update(sessions)
      .set({ revokedAt: new Date(), tokens: '' })
      .where(
        and(
          eq(sessions.issuer, input.issuer),
          eq(sessions.clientId, input.clientId),
          isNull(sessions.revokedAt),
          input.sid ? eq(sessions.sid, input.sid) : undefined,
          input.subject ? eq(sessions.subject, input.subject) : undefined,
        ),
      )
      .returning({ personId: sessions.personId });
    for (const row of revoked)
      await tx.insert(authenticationAudit).values({ actor: 'person:' + row.personId, action: 'backchannel-logout' });
  });
}
export async function pruneAuthentication() {
  const now = new Date();
  await database().delete(loginTransactions).where(lte(loginTransactions.expiresAt, now));
  await database().delete(logoutReceipts).where(lte(logoutReceipts.expiresAt, now));
  await database().transaction(async tx => {
    const expired = await tx
      .update(sessions)
      .set({ revokedAt: now, tokens: '' })
      .where(and(isNull(sessions.revokedAt), or(lte(sessions.expiresAt, now), lte(sessions.idleExpiresAt, now))))
      .returning({ personId: sessions.personId });
    if (expired.length)
      await tx
        .insert(authenticationAudit)
        .values(expired.map(row => ({ actor: 'person:' + row.personId, action: 'expired' })));
  });
  await database()
    .delete(sessions)
    .where(lte(sessions.expiresAt, new Date(Date.now() - 86400_000)));
  await database()
    .delete(authenticationAudit)
    .where(lte(authenticationAudit.createdAt, new Date(Date.now() - 30 * 86400_000)));
}
