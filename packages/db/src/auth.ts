import { and, eq, gt, isNull, lte, or } from 'drizzle-orm';
import { database } from './index';
import { people, accessGrants, identityBindings, sessions, loginTransactions, authenticationAudit, logoutReceipts } from './schema';
export { people, accessGrants, identityBindings, sessions, loginTransactions, authenticationAudit, logoutReceipts } from './schema';
export const LOGIN_TRANSACTION_MS = 5 * 60_000;
export const IDLE_MS = 8 * 60 * 60_000;
export const ABSOLUTE_MS = 8 * 60 * 60_000;
export type SessionRecord = typeof sessions.$inferSelect;

export function activeSession(digest: string, now = new Date()) {
  return and(eq(sessions.digest, digest), isNull(sessions.revokedAt), gt(sessions.expiresAt, now), gt(sessions.idleExpiresAt, now));
}
export async function readSession(digest: string) {
  const [row] = await database().select().from(sessions).where(activeSession(digest));
  return row;
}
export async function readAccess(personId: string) {
  const [row] = await database().select({ person: people, grant: accessGrants }).from(people)
    .innerJoin(accessGrants, eq(accessGrants.personId, people.id)).where(and(eq(people.id, personId), eq(people.enabled, true)));
  return row;
}
export async function resolveSubject(issuer: string, subject: string) {
  const [row] = await database().select().from(identityBindings).where(and(eq(identityBindings.issuer, issuer), eq(identityBindings.subject, subject)));
  return row ? readAccess(row.personId) : undefined;
}
export async function auditAuth(action: string, actor?: string) {
  await database().insert(authenticationAudit).values({ action, actor });
}
export async function revokeSession(digest: string, action = 'logout') {
  return database().transaction(async tx => {
    const [row] = await tx.update(sessions).set({ revokedAt: new Date(), tokens: '' }).where(and(eq(sessions.digest, digest), isNull(sessions.revokedAt))).returning();
    if (row) await tx.insert(authenticationAudit).values({ action, actor: 'person:' + row.personId });
  });
}
export async function touchSession(digest: string) {
  const now = new Date();
  const [row] = await database().update(sessions).set({ idleExpiresAt: new Date(now.getTime() + IDLE_MS) }).where(activeSession(digest, now)).returning();
  return row;
}
export async function consumeLogin(digest: string) {
  const [row] = await database().delete(loginTransactions).where(eq(loginTransactions.digest, digest)).returning();
  return row && row.expiresAt > new Date() ? row : undefined;
}
export async function backchannelRevoke(input: { issuer: string; clientId: string; sid?: string; subject?: string; jti: string }) {
  await database().transaction(async tx => {
    const inserted = await tx.insert(logoutReceipts).values({ issuer: input.issuer, jti: input.jti, expiresAt: new Date(Date.now() + 300_000) }).onConflictDoNothing().returning();
    if (!inserted.length) return;
    const revoked = await tx.update(sessions).set({ revokedAt: new Date(), tokens: '' }).where(and(
      eq(sessions.issuer, input.issuer), eq(sessions.clientId, input.clientId), isNull(sessions.revokedAt),
      input.sid ? eq(sessions.sid, input.sid) : undefined, input.subject ? eq(sessions.subject, input.subject) : undefined,
    )).returning({ personId: sessions.personId });
    for (const row of revoked) await tx.insert(authenticationAudit).values({ actor: 'person:' + row.personId, action: 'backchannel-logout' });
  });
}
export async function pruneAuthentication() {
  const now = new Date();
  await database().delete(loginTransactions).where(lte(loginTransactions.expiresAt, now));
  await database().delete(logoutReceipts).where(lte(logoutReceipts.expiresAt, now));
  await database().transaction(async tx => {
    const expired = await tx.update(sessions).set({ revokedAt: now, tokens: '' }).where(and(isNull(sessions.revokedAt), or(lte(sessions.expiresAt, now), lte(sessions.idleExpiresAt, now)))).returning({personId:sessions.personId});
    if (expired.length) await tx.insert(authenticationAudit).values(expired.map(row=>({actor:'person:'+row.personId, action:'expired'})));
  });
  await database().delete(sessions).where(lte(sessions.expiresAt, new Date(Date.now() - 86400_000)));
  await database().delete(authenticationAudit).where(lte(authenticationAudit.createdAt, new Date(Date.now() - 30 * 86400_000)));
}
