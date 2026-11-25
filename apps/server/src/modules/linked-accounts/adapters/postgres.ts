import { and, asc, count, eq, lte } from 'drizzle-orm';
import { database, schema, type Database, type Transaction } from '@clew/db';
import { writeAudit } from '@clew/db/threads';
import type { LinkedAccount, PendingLink } from '../contracts';
import type { Approval, LinkStore, LinkTx, OAuthClient } from '../ports';

/**
 * The link store the server runs (D25, D147), over Drizzle, held to the memory adapter by
 * `tests/linked-account-store-contract.ts`. Every secret is sealed before it is written and opened when it is read: a
 * link's two tokens as one envelope bound to the person and the connector, a pending authorization's PKCE verifier, and
 * a client's secret. `tx.link` takes the row's lock, so the transaction that refreshes a link holds it until it has
 * written the new tokens and a second one waits for them.
 */
export interface Sealer {
  seal(value: string, purpose: string): string;
  open(value: string, purpose: string): string;
}
const links = schema.linkedAccounts,
  pendings = schema.linkedAccountPending,
  clients = schema.linkedAccountClients,
  servers = schema.linkedAccountServers,
  later = schema.linkedAccountLater;
const linkPurpose = (personId: string, connectorId: string) => `linked-account:${connectorId}:${personId}`;
const clientPurpose = (connectorId: string) => 'linked-account-client:' + connectorId;
const PENDING_PURPOSE = 'linked-account-pending';

/** The store's transaction on a transaction somebody else opened: how the SCIM transaction ends a leaver's links. */
export const linkTx = (tx: Transaction, sealer: Sealer): LinkTx => parts(sealer).within(tx);
export function postgresLinkStore(sealer: Sealer): LinkStore {
  const { within, listed, putOffBy } = parts(sealer);
  return {
    linksOf: personId => listed(database(), eq(links.personId, personId)),
    putOffBy: personId => putOffBy(database(), personId),
    // Counted in the database, by two columns that are plain text: no row's tokens are read or opened.
    counts: async connectorId =>
      (
        await database()
          .select({ issuer: links.issuer, state: links.state, people: count() })
          .from(links)
          .where(eq(links.connectorId, connectorId))
          .groupBy(links.issuer, links.state)
          .orderBy(asc(links.issuer), asc(links.state))
      ).map(row => ({ issuer: row.issuer, state: row.state as LinkedAccount['state'], people: Number(row.people) })),
    transaction: fn => database().transaction(tx => fn(within(tx))),
  };
}
function parts(sealer: Sealer) {
  function linkOf(row: typeof links.$inferSelect): LinkedAccount {
    const tokens: { access: string; refresh: string | null } | null = row.tokens
      ? JSON.parse(sealer.open(row.tokens, linkPurpose(row.personId, row.connectorId)))
      : null;
    return {
      personId: row.personId,
      connectorId: row.connectorId,
      issuer: row.issuer,
      resource: row.resource,
      scopes: row.scopes,
      state: row.state,
      accessToken: tokens?.access ?? null,
      refreshToken: tokens?.refresh ?? null,
      expiresAt: row.expiresAt?.toISOString() ?? null,
      lastError: row.lastError,
      lostAt: row.lostAt?.toISOString() ?? null,
      linkedAt: row.linkedAt.toISOString(),
    };
  }
  const listed = async (db: Database | Transaction, where: ReturnType<typeof eq>) =>
    (await db.select().from(links).where(where).orderBy(asc(links.connectorId), asc(links.personId))).map(linkOf);
  const putOffBy = async (db: Database | Transaction, personId: string) =>
    (
      await db
        .select({ connectorId: later.connectorId })
        .from(later)
        .where(eq(later.personId, personId))
        .orderBy(asc(later.connectorId))
    ).map(row => row.connectorId);
  const clientOf = (connectorId: string, id: string, secret: string | null, source: OAuthClient['source']) => ({
    id,
    secret: secret ? sealer.open(secret, clientPurpose(connectorId)) : null,
    source,
  });
  const sealedSecret = (connectorId: string, client: OAuthClient | null) =>
    client?.secret ? sealer.seal(client.secret, clientPurpose(connectorId)) : null;

  const within = (tx: Transaction): LinkTx => ({
    async link(personId, connectorId) {
      const [row] = await tx
        .select()
        .from(links)
        .where(and(eq(links.personId, personId), eq(links.connectorId, connectorId)))
        .for('update');
      return row ? linkOf(row) : null;
    },
    async save(link) {
      const values = {
        issuer: link.issuer,
        resource: link.resource,
        scopes: link.scopes,
        state: link.state,
        tokens: link.accessToken
          ? sealer.seal(
              JSON.stringify({ access: link.accessToken, refresh: link.refreshToken }),
              linkPurpose(link.personId, link.connectorId),
            )
          : null,
        expiresAt: link.expiresAt ? new Date(link.expiresAt) : null,
        lastError: link.lastError,
        lostAt: link.lostAt ? new Date(link.lostAt) : null,
        linkedAt: new Date(link.linkedAt),
      };
      await tx
        .insert(links)
        .values({ personId: link.personId, connectorId: link.connectorId, ...values })
        .onConflictDoUpdate({ target: [links.personId, links.connectorId], set: values });
    },
    async remove(personId, connectorId) {
      await tx.delete(links).where(and(eq(links.personId, personId), eq(links.connectorId, connectorId)));
    },
    linksOf: personId => listed(tx, eq(links.personId, personId)),
    linksTo: connectorId => listed(tx, eq(links.connectorId, connectorId)),
    async pend(pending) {
      await tx.insert(pendings).values({
        state: pending.state,
        verifier: sealer.seal(pending.verifier, PENDING_PURPOSE),
        personId: pending.personId,
        connectorId: pending.connectorId,
        issuer: pending.issuer,
        returnTo: pending.returnTo,
        expiresAt: new Date(pending.expiresAt),
      });
    },
    async take(state): Promise<PendingLink | null> {
      // The delete is the taking: of two returns with one state, one gets the row and the other gets none.
      const [row] = await tx.delete(pendings).where(eq(pendings.state, state)).returning();
      return row
        ? {
            state: row.state,
            verifier: sealer.open(row.verifier, PENDING_PURPOSE),
            personId: row.personId,
            connectorId: row.connectorId,
            issuer: row.issuer,
            returnTo: row.returnTo,
            expiresAt: row.expiresAt.toISOString(),
          }
        : null;
    },
    async expire(now) {
      await tx.delete(pendings).where(lte(pendings.expiresAt, new Date(now)));
    },
    async client(connectorId, issuer) {
      const [row] = await tx
        .select()
        .from(clients)
        .where(and(eq(clients.connectorId, connectorId), eq(clients.issuer, issuer)));
      return row ? clientOf(connectorId, row.clientId, row.secret, row.source) : null;
    },
    async saveClient(connectorId, issuer, client) {
      const values = { clientId: client.id, secret: sealedSecret(connectorId, client), source: client.source };
      await tx
        .insert(clients)
        .values({ connectorId, issuer, ...values })
        .onConflictDoUpdate({ target: [clients.connectorId, clients.issuer], set: values });
    },
    async approval(connectorId): Promise<Approval | null> {
      const [row] = await tx.select().from(servers).where(eq(servers.connectorId, connectorId));
      if (!row) return null;
      return {
        resource: row.resource,
        server: {
          issuer: row.issuer,
          authorizationEndpoint: row.authorizationEndpoint,
          tokenEndpoint: row.tokenEndpoint,
          revocationEndpoint: row.revocationEndpoint,
          registrationEndpoint: row.registrationEndpoint,
          pkce: row.pkce,
          issuerOnReturn: row.issuerOnReturn,
          clientDocuments: row.clientDocuments,
        },
        origin: row.origin,
        client: row.clientId ? clientOf(connectorId, row.clientId, row.clientSecret, 'entered') : null,
        approvedBy: row.approvedBy,
        approvedAt: row.approvedAt.toISOString(),
      };
    },
    async approve(connectorId, approval) {
      const values = {
        resource: approval.resource,
        origin: approval.origin,
        issuer: approval.server.issuer,
        authorizationEndpoint: approval.server.authorizationEndpoint,
        tokenEndpoint: approval.server.tokenEndpoint,
        revocationEndpoint: approval.server.revocationEndpoint,
        registrationEndpoint: approval.server.registrationEndpoint,
        pkce: approval.server.pkce,
        issuerOnReturn: approval.server.issuerOnReturn,
        clientDocuments: approval.server.clientDocuments,
        clientId: approval.client?.id ?? null,
        clientSecret: sealedSecret(connectorId, approval.client),
        approvedBy: approval.approvedBy,
        approvedAt: new Date(approval.approvedAt),
      };
      await tx
        .insert(servers)
        .values({ connectorId, ...values })
        .onConflictDoUpdate({ target: servers.connectorId, set: values });
    },
    async putOff(personId, connectorId, at) {
      await tx
        .insert(later)
        .values({ personId, connectorId, at: new Date(at) })
        .onConflictDoNothing();
    },
    putOffBy: personId => putOffBy(tx, personId),
    async takeUp(personId, connectorId) {
      await tx
        .delete(later)
        .where(
          connectorId === undefined
            ? eq(later.personId, personId)
            : and(eq(later.personId, personId), eq(later.connectorId, connectorId)),
        );
    },
    audit: entry => writeAudit(tx, entry),
  });

  return { within, listed, putOffBy };
}
