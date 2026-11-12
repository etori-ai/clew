import { and, eq, gt, isNotNull, isNull, lte, sql } from 'drizzle-orm';
import { database, type Database, type Transaction } from './index';
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
/** What reads a person's access: the pool, or the transaction a sign-in already holds (L1). */
type Reader = Pick<Transaction, 'select'>;
export async function readAccess(personId: string, db: Reader = database()) {
  const [row] = await db
    .select({ person: people, grant: accessGrants })
    .from(people)
    .innerJoin(accessGrants, eq(accessGrants.personId, people.id))
    .where(and(eq(people.id, personId), eq(people.enabled, true)));
  return row;
}
export type Access = NonNullable<Awaited<ReturnType<typeof readAccess>>>;
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
 * A person's `userName` equals `name` without regard to case (RFC 7643's default for it; Keycloak lowercases account
 * names, Entra does not), folded under ICU's root collation on both sides, so that Å and å are one letter on a database
 * created with the C locale too (L13). `name` is NFC-normalised first, as stored user names are (L12).
 */
export const sameUserName = (name: string) =>
  sql`lower(${people.userName} collate "und-x-icu") = lower(${name.normalize('NFC')}::text collate "und-x-icu")`;
/** A sign-in's outcome: the access when it may go on, and the person it concerned when one is known (L10). */
export interface SignIn {
  access?: Access;
  personId?: string;
}
/**
 * The person a verified sign-in is (D68 item 6). A subject seen before is its person, unless the binding claim names
 * another person: then the account's name has moved to someone else in the identity provider while the subject stayed
 * bound here, and the sign-in is refused with `identity-conflict` naming both, the claim's value and the subject, and
 * nothing is rebound (L2); an operator settles it with `scripts/identity-rebind.ts`. A claim that names nobody, or no
 * claim, does not refuse: the subject is the identity, and the provider may rename before Clew does. A subject seen for
 * the first time binds by the claim (`bindFirstLogin`). Compared at each sign-in, never on each request. `db` is the
 * server's pool unless a test names another database.
 */
export async function signIn(
  issuer: string,
  subject: string,
  claim: string,
  value: string | undefined,
  db: Database = database(),
): Promise<SignIn> {
  const name = value?.normalize('NFC');
  const [bound] = await db
    .select({ personId: identityBindings.personId })
    .from(identityBindings)
    .where(and(eq(identityBindings.issuer, issuer), eq(identityBindings.subject, subject)));
  if (!bound) return name ? bindFirstLogin(issuer, subject, claim, name, db) : {};
  if (name) {
    const named = await db.select({ id: people.id }).from(people).where(sameUserName(name));
    const [claimed] = named;
    if (claimed && !named.some(p => p.id === bound.personId)) {
      await db.transaction(tx =>
        refuseConflict(tx, { issuer, claim, value: name, subject, claimed: claimed.id, holder: bound.personId }),
      );
      return { personId: bound.personId };
    }
  }
  return accessOf(db, bound.personId);
}
async function accessOf(db: Reader, personId: string): Promise<SignIn> {
  const access = await readAccess(personId, db);
  return access ? { access, personId } : { personId };
}
/**
 * A sign-in refused because its subject and its claim name different people, audited in the transaction that found it:
 * `identity-conflict` in the authentication log on the claimed person, and `identity.conflict` on that person with the
 * claim's value, the refused subject and the person who holds that subject, if anyone does (L10).
 */
async function refuseConflict(
  tx: Transaction,
  c: { issuer: string; claim: string; value: string; subject: string; claimed: string; holder?: string },
) {
  await tx.insert(authenticationAudit).values({ action: 'identity-conflict', actor: 'person:' + c.claimed });
  await tx.insert(audit).values({
    actor: 'person:' + c.claimed,
    action: 'identity.conflict',
    subject: 'person:' + c.claimed,
    details: {
      issuer: c.issuer,
      claim: c.claim,
      value: c.value,
      subject: c.subject,
      ...(c.holder ? { holder: 'person:' + c.holder } : {}),
    },
  });
}
/**
 * First login (D68 item 6): the verified subject binds to the one enabled, provisioned person whose `userName` equals
 * the configured claim's value (`sameUserName`). Exactly one match, never an e-mail address, one binding per person and
 * issuer; a subject that differs from the person's binding, or that another person holds, is refused and audited,
 * because a change of subject needs an operator (`scripts/identity-rebind.ts`). Everything it reads, the access
 * included, goes through its own transaction: a second connection asked for inside it waits for the pool, and enough
 * first sign-ins at once held every connection while waiting for one (L1).
 */
export async function bindFirstLogin(
  issuer: string,
  subject: string,
  claim: string,
  value: string,
  db: Database = database(),
): Promise<SignIn> {
  const name = value.normalize('NFC');
  return db.transaction(async tx => {
    const matches = await tx.select({ id: people.id, enabled: people.enabled }).from(people).where(sameUserName(name));
    const [person] = matches;
    if (matches.length !== 1 || !person || !person.enabled) {
      // The claim is the account name the IdP vouched for, not a person Clew knows: what an operator needs to see.
      await tx.insert(authenticationAudit).values({ action: 'identity-unmatched', actor: 'claim:' + name });
      return matches.length === 1 && person ? { personId: person.id } : {};
    }
    const [bound] = await tx
      .select({ subject: identityBindings.subject })
      .from(identityBindings)
      .where(and(eq(identityBindings.issuer, issuer), eq(identityBindings.personId, person.id)));
    if (bound) {
      if (bound.subject === subject) return accessOf(tx, person.id);
      await refuseConflict(tx, { issuer, claim, value: name, subject, claimed: person.id });
      return { personId: person.id };
    }
    const inserted = await tx
      .insert(identityBindings)
      .values({ issuer, subject, personId: person.id })
      .onConflictDoNothing()
      .returning({ personId: identityBindings.personId });
    if (!inserted.length) {
      // Another sign-in bound this subject or this person since the reads above. The person's own sign-in at the same
      // moment bound it to them; anything else is a conflict, named with whoever holds the subject (L10).
      const [holder] = await tx
        .select({ personId: identityBindings.personId })
        .from(identityBindings)
        .where(and(eq(identityBindings.issuer, issuer), eq(identityBindings.subject, subject)));
      if (holder?.personId === person.id) return accessOf(tx, person.id);
      await refuseConflict(tx, { issuer, claim, value: name, subject, claimed: person.id, holder: holder?.personId });
      return { personId: holder?.personId ?? person.id };
    }
    await tx.insert(authenticationAudit).values({ action: 'identity-bound', actor: 'person:' + person.id });
    await tx.insert(audit).values({
      actor: 'person:' + person.id,
      action: 'identity.bound',
      subject: 'person:' + person.id,
      details: { issuer, claim },
    });
    return accessOf(tx, person.id);
  });
}
/** Why an operator's rebind was refused; nothing was written. `holder` holds the subject, when that is why. */
export class RebindRefused extends Error {
  holder?: string;
  constructor(message: string, holder?: string) {
    super(message);
    this.name = 'RebindRefused';
    this.holder = holder;
  }
}
/**
 * An operator binds a person to a new sign-in account, or releases their binding (Q8 of the 2026-11-12 users review,
 * amending D68 item 6): the person's binding under the issuer moves to the new subject, or with `subject: null` is
 * removed, so that the next sign-in whose claim names the person binds them again as a first login does. One
 * `identity.rebound` audit row about the person (issuer, old subject, new subject or null, the operator's name) is
 * written in the same transaction. Refused, writing nothing, for a person id the people table does not hold and for a
 * subject already bound to another person: a subject is moved off its holder only by releasing the holder first, named
 * by its own id, so every change is audited on the person it changes. Never automatic and never on a page:
 * `scripts/identity-rebind.ts` is its one caller. The person's sessions under the old subject end at their next
 * request, because that subject no longer resolves to them.
 */
export async function rebindIdentity(
  actor: string,
  input: { issuer: string; personId: string; subject: string | null; operator: string },
) {
  const { issuer, personId, subject, operator } = input;
  return database().transaction(async tx => {
    const [person] = await tx.select({ id: people.id }).from(people).where(eq(people.id, personId));
    if (!person) throw new RebindRefused(`no person has the id "${personId}"`);
    if (subject !== null) {
      const [holder] = await tx
        .select({ personId: identityBindings.personId })
        .from(identityBindings)
        .where(and(eq(identityBindings.issuer, issuer), eq(identityBindings.subject, subject)));
      if (holder && holder.personId !== personId)
        throw new RebindRefused(
          `the subject is already bound to another person, "${holder.personId}"`,
          holder.personId,
        );
    }
    const [current] = await tx
      .select({ subject: identityBindings.subject })
      .from(identityBindings)
      .where(and(eq(identityBindings.issuer, issuer), eq(identityBindings.personId, personId)));
    const oldSubject = current?.subject ?? null;
    if (oldSubject === subject) return { changed: false, oldSubject };
    if (current)
      await tx
        .delete(identityBindings)
        .where(and(eq(identityBindings.issuer, issuer), eq(identityBindings.personId, personId)));
    if (subject !== null) {
      // A first sign-in may bind the subject between the read above and here; the primary key refuses it then.
      const inserted = await tx
        .insert(identityBindings)
        .values({ issuer, subject, personId })
        .onConflictDoNothing()
        .returning({ personId: identityBindings.personId });
      if (!inserted.length) throw new RebindRefused('the subject was bound to another person meanwhile');
    }
    await tx.insert(audit).values({
      actor,
      action: 'identity.rebound',
      subject: 'person:' + personId,
      details: { issuer, oldSubject, newSubject: subject, operator },
    });
    return { changed: true, oldSubject };
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
/**
 * A session's refreshed IdP tokens, stored over the ones they were refreshed from (L1, L4): no connection is held while
 * the provider answers, so the row is compared instead of locked. Undefined when the session no longer holds those
 * tokens, because another request refreshed it meanwhile, or has ended.
 */
export async function storeRefreshedTokens(
  digest: string,
  previous: string,
  next: { tokens: string; tokenExpiresAt: Date },
) {
  const [row] = await database()
    .update(sessions)
    .set(next)
    .where(and(activeSession(digest), eq(sessions.tokens, previous)))
    .returning();
  return row;
}
export async function consumeLogin(digest: string) {
  const [row] = await database().delete(loginTransactions).where(eq(loginTransactions.digest, digest)).returning();
  return row && row.expiresAt > new Date() ? row : undefined;
}
/**
 * Ends the open sessions an identity provider's logout names, by the provider's session id (`sid`), the subject or
 * both, under this installation's issuer and client, each with a row in the authentication log whose action says which
 * logout ended it. Both logout channels end sessions here (D115). A logout that names neither is refused, since it
 * would end every session of the client.
 */
async function endProviderSessions(
  tx: Transaction,
  input: { issuer: string; clientId: string; sid?: string; subject?: string },
  action: 'backchannel-logout' | 'frontchannel-logout',
) {
  if (!input.sid && !input.subject) throw new Error('A provider logout must name a sid or a subject');
  const ended = await tx
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
  if (ended.length)
    await tx.insert(authenticationAudit).values(ended.map(row => ({ actor: 'person:' + row.personId, action })));
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
    await endProviderSessions(tx, input, 'backchannel-logout');
  });
}
/**
 * OpenID Connect Front-Channel Logout 1.0 (D115): the open sessions of the provider's `sid` end as a back-channel
 * logout ends them, each with a `frontchannel-logout` row. No receipt is kept: the request carries no token that could
 * be replayed, and a second request for sessions that have ended ends nothing.
 */
export async function frontchannelRevoke(input: { issuer: string; clientId: string; sid: string }) {
  await database().transaction(tx => endProviderSessions(tx, input, 'frontchannel-logout'));
}
/**
 * The nightly clean-up of sign-in machinery (D117; L3 of the 2026-11-12 users review), in one transaction: every
 * session past either expiry is removed with its sealed tokens, and one that was still open is ended with an `expired`
 * row in the authentication log; login transactions and logout receipts past their expiry are removed. The
 * authentication log itself is kept, since how long sign-in history is kept is the organisation's decision (Q7). One
 * statement removes the sessions and writes their rows, so however many sessions expired, it is one request.
 */
export async function removeExpiredSignIns(now: Date) {
  const at = now.toISOString();
  await database().transaction(async tx => {
    await tx.execute(sql`
      with removed as (
        delete from ${sessions}
         where ${sessions.expiresAt} <= ${at}::timestamptz or ${sessions.idleExpiresAt} <= ${at}::timestamptz
        returning person_id, revoked_at
      )
      insert into ${authenticationAudit} (actor, action)
      select 'person:' || person_id, 'expired' from removed where revoked_at is null`);
    await tx.delete(loginTransactions).where(lte(loginTransactions.expiresAt, now));
    await tx.delete(logoutReceipts).where(lte(logoutReceipts.expiresAt, now));
  });
}
