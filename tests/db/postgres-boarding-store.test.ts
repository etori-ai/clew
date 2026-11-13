import { afterAll } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { database, schema, type Transaction } from '../../packages/db/src/index';
import { postgresBoardingStore } from '../../apps/server/src/modules/boarding/adapters/postgres';
import type { WorkItemTx } from '../../apps/server/src/modules/boarding/model';
import { openSecret, sealSecret } from '../../apps/server/src/auth-crypto';
import { boardingStoreContract } from '../boarding-store-contract';

/** The boarding store contract on Postgres (D124). Run with `bun run test:db` inside the devcontainer. */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');
const prefixes: string[] = [];
afterAll(async () => {
  const db = database();
  for (const p of prefixes) {
    await db.delete(schema.boardingItems).where(like(schema.boardingItems.id, p + '%'));
    await db.delete(schema.boardingPlans).where(like(schema.boardingPlans.id, p + '%'));
    await db.delete(schema.boardingLayerItems).where(like(schema.boardingLayerItems.id, p + '%'));
    await db.delete(schema.boardingLayers).where(like(schema.boardingLayers.id, p + '%'));
    await db.delete(schema.threads).where(like(schema.threads.id, p + '%'));
    await db.delete(schema.audit).where(like(schema.audit.subject, '%:' + p + '%'));
    await db.delete(schema.people).where(like(schema.people.id, p + '%'));
  }
});
/**
 * A stand-in for composition's card port: `open` writes the minimal thread row the item's foreign key needs, `remove`
 * deletes it. The real one (the owner's stream, delivery and the timer) is composition's and has its own tests.
 */
const cards = (tx: Transaction): WorkItemTx => ({
  async open(input) {
    await tx.insert(schema.threads).values({
      id: input.threadId,
      personId: input.personId,
      kind: 'pushed',
      topic: 'boarding:item:' + input.itemId,
      title: input.title ?? 'En uppgift',
      trigger: { reason: 'test', source: 'boarding', at: input.at },
      connector: 'boarding',
      area: 'boarding',
    });
  },
  async close(threadId) {
    await tx.update(schema.threads).set({ state: 'handled' }).where(eq(schema.threads.id, threadId));
  },
  async reopen(threadId) {
    await tx.update(schema.threads).set({ state: 'open' }).where(eq(schema.threads.id, threadId));
  },
  async fire() {
    return false;
  },
  async remove(threadIds) {
    if (threadIds.length) await tx.delete(schema.threads).where(inArray(schema.threads.id, [...threadIds]));
  },
});

boardingStoreContract('postgres', async () => {
  const prefix = 'test-boarding-' + randomUUID().slice(0, 8);
  prefixes.push(prefix);
  const sealer = { seal: sealSecret, open: openSecret };
  return {
    store: postgresBoardingStore({ sealer, workItems: cards }),
    prefix,
    async seedPerson(person) {
      await database().insert(schema.people).values(person);
    },
    async auditFor(subject) {
      return database()
        .select({ actor: schema.audit.actor, action: schema.audit.action })
        .from(schema.audit)
        .where(eq(schema.audit.subject, subject))
        .orderBy(schema.audit.id);
    },
    async storedTitle(id) {
      const [row] = await database()
        .select({ title: schema.boardingItems.title, sealed: schema.boardingItems.textSealed })
        .from(schema.boardingItems)
        .where(eq(schema.boardingItems.id, id));
      return row!;
    },
  };
});
