import { afterAll, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq, inArray, like, sql } from 'drizzle-orm';
import { database, schema, type Transaction } from '../../packages/db/src/index';
import { postgresTalkStore, talkTx } from '../../apps/server/src/modules/talks/adapters/postgres';
import type { RoundHold, WorkItemTx } from '../../apps/server/src/modules/talks/model';
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

/**
 * BD-L4: reading the open round takes no lock, so every talks page and every manager's scan reads it beside a write that
 * holds it, and beside one that closes it. A write in the round holds it only against closing: two writes go on beside
 * each other, and closing waits for them. Each try below gives up after half a second (`lock_timeout`), so a wait for a
 * lock fails it with 55P03.
 */
test('the open round is read without a lock; a write holds it only against closing, and closing holds off writes', async () => {
  const p = 'test-talk-' + randomUUID().slice(0, 8);
  prefixes.push(p);
  const org = p + '-org',
    round = p + '-round',
    sealer = { seal: sealSecret, open: openSecret };
  await database().insert(schema.talkRounds).values({
    id: round,
    organisationId: org,
    kind: 'development',
    label: 'Utvecklingssamtal',
    opensOn: '2026-11-01',
    dueOn: '2026-12-15',
    createdBy: 'operator:test',
  });
  const read = (tx: Transaction, hold?: RoundHold) =>
    talkTx(tx, { sealer, workItems: cards(tx) }).currentRound(org, 'development', hold);
  const promptly = (hold?: RoundHold) =>
    database()
      .transaction(async tx => {
        await tx.execute(sql`set local lock_timeout = '500ms'`);
        return (await read(tx, hold))?.id;
      })
      .catch((error: { code?: string; cause?: { code?: string } }) => error.code ?? error.cause?.code);
  /** Hold the round as `hold` in a transaction of its own while `meanwhile` runs, then end it. */
  async function holding<T>(hold: RoundHold, meanwhile: () => Promise<T>) {
    let release!: () => void, held!: () => void;
    const ended = new Promise<void>(resolve => (release = resolve)),
      holds = new Promise<void>(resolve => (held = resolve));
    const holder = database().transaction(async tx => {
      expect((await read(tx, hold))?.id).toBe(round);
      held();
      await ended;
    });
    await holds;
    try {
      return await meanwhile();
    } finally {
      release();
      await holder;
    }
  }
  expect(
    await holding('write', async () => ({
      read: await promptly(),
      write: await promptly('write'),
      close: await promptly('close'),
    })),
  ).toEqual({ read: round, write: round, close: '55P03' });
  expect(await holding('close', async () => ({ read: await promptly(), write: await promptly('write') }))).toEqual({
    read: round,
    write: '55P03',
  });
});
