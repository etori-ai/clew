import { randomUUID } from 'node:crypto';
import { generateKeyPair, exportPKCS8 } from 'jose';
import { database, schema } from '@clew/db';
import { eq } from 'drizzle-orm';
import type { JWK } from 'jose';
import { openSecret, sealSecret } from '../auth-crypto';
import { connectorAuthority, type ConnectorAuthority } from './authority';

let cached: { version: string; authority: Promise<ConnectorAuthority> } | undefined;
/** The installation's signing key survives restarts and is shared by all BFF instances; only its sealed form is stored. */
export async function signingAuthority() {
  const db = database();
  let [row] = await db.select().from(schema.connectorSigningKey);
  if (!row) {
    const { privateKey } = await generateKeyPair('RS256', { modulusLength: 3072, extractable: true });
    const kid = randomUUID(), pem = await exportPKCS8(privateKey);
    await db.transaction(async tx => {
      const inserted = await tx.insert(schema.connectorSigningKey).values({ id: 'installation', kid, sealed: sealSecret(pem, 'connector-signing:' + kid) }).onConflictDoNothing().returning();
      if (inserted.length) await tx.insert(schema.audit).values({ actor: 'system:boot', action: 'connector.signing_key_created', subject: 'connector-signing:' + kid, details: {} });
    });
    [row] = await db.select().from(schema.connectorSigningKey);
  }
  if (!row) throw new Error('Connector signing key unavailable.');
  const previous = row.previous.filter(p => p.until > new Date().toISOString());
  const version = row.kid + ':' + previous.map(p => p.key.kid).join(':');
  if (cached?.version !== version) cached = { version, authority: connectorAuthority(openSecret(row.sealed, 'connector-signing:' + row.kid), row.kid, previous.map(p => p.key as JWK)) };
  try { return await cached.authority; } catch (error) { cached = undefined; throw error; }
}

/** Operator rotation: serialize rotations, publish the old public key for three minutes, and audit the replacement. */
export async function rotateSigningKey(actor: string) {
  await signingAuthority();
  const { privateKey } = await generateKeyPair('RS256', { modulusLength: 3072, extractable: true });
  const kid = randomUUID(), pem = await exportPKCS8(privateKey), now = new Date();
  await database().transaction(async tx => {
    const [row] = await tx.select().from(schema.connectorSigningKey).where(eq(schema.connectorSigningKey.id, 'installation')).for('update');
    if (!row) throw new Error('Connector signing key unavailable.');
    const old = await connectorAuthority(openSecret(row.sealed, 'connector-signing:' + row.kid), row.kid);
    const previous = [...row.previous.filter(p => p.until > now.toISOString()), { key: old.jwks.keys[0] as Record<string, unknown>, until: new Date(now.getTime() + 180_000).toISOString() }];
    await tx.update(schema.connectorSigningKey).set({ kid, sealed: sealSecret(pem, 'connector-signing:' + kid), previous, createdAt: now }).where(eq(schema.connectorSigningKey.id, 'installation'));
    await tx.insert(schema.audit).values({ actor, action: 'connector.signing_key_rotated', subject: 'connector-signing:' + kid, details: { previousKid: row.kid } });
  });
  return kid;
}
