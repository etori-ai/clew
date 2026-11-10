import { afterAll } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { database, schema, type Transaction } from '../../packages/db/src/index';
import { postgresTalkStore } from '../../apps/server/src/modules/talks/adapters/postgres';
import type { WorkItemTx } from '../../apps/server/src/modules/talks/model';
import { openSecret, sealSecret } from '../../apps/server/src/auth-crypto';
import { talkStoreContract } from '../talk-store-contract';

/** The talk store contract on Postgres (D96). Run with `bun run test:db` inside the devcontainer. */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');
const prefixes: string[] = [];
afterAll(async () => {
  const db = database();
  for (const p of prefixes) {
    await db.delete(schema.talkCommitments).where(like(schema.talkCommitments.id, p + '%'));
    await db.delete(schema.talks).where(like(schema.talks.id, p + '%'));
    await db.delete(schema.talkRounds).where(like(schema.talkRounds.id, p + '%'));
    await db.delete(schema.threads).where(like(schema.threads.id, p + '%'));
    await db.delete(schema.audit).where(like(schema.audit.subject, '%:' + p + '%'));
    await db.delete(schema.people).where(like(schema.people.id, p + '%'));
  }
});
/**
 * A stand-in for composition's card port: `open` writes the minimal thread row the action point's foreign key needs,
 * `remove` deletes it. The real one (the owner's stream, delivery and the `due` timer) is composition's and has its
 * own tests.
 */
const cards = (tx: Transaction): WorkItemTx => ({
  async open(input) {
    await tx.insert(schema.threads).values({
      id: input.threadId,
      personId: input.personId,
      kind: 'pushed',
      topic: 'commitment:' + input.commitmentId,
      title: 'Åtgärdspunkt',
      trigger: { reason: 'test', source: 'talks', at: input.at },
      connector: 'talks',
      area: 'talks',
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

talkStoreContract('postgres', async () => {
  const prefix = 'test-talk-' + randomUUID().slice(0, 8);
  prefixes.push(prefix);
  let opened = 0;
  const sealer = {
    seal: sealSecret,
    open(value: string, purpose: string) {
      opened++;
      return openSecret(value, purpose);
    },
  };
  return {
    store: postgresTalkStore({ sealer, workItems: cards }),
    prefix,
    opened: () => opened,
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
    async storedText(id) {
      const [row] = await database()
        .select({ text: schema.talkCommitments.textSealed })
        .from(schema.talkCommitments)
        .where(eq(schema.talkCommitments.id, id));
      return row!.text;
    },
  };
});
