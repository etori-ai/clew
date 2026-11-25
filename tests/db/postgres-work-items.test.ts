import { afterAll } from 'bun:test';
import { randomBytes } from 'node:crypto';
import { eq, inArray, like, or } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import { withThreadTx } from '../../apps/server/src/threads/adapters/postgres';
import { dueTimerId, talkWorkItems } from '../../apps/server/src/composition/talk-work-items';
import { boardingTimerId, boardingWorkItems } from '../../apps/server/src/composition/boarding-work-items';
import { dialogueDueTimerId, dialogueWorkItems } from '../../apps/server/src/composition/dialogue-work-items';
import { approvalCardId, competenceWorkItems } from '../../apps/server/src/composition/competence-work-items';
import type { Transaction } from '../../packages/db/src/index';
import type { ThreadTx } from '../../apps/server/src/threads/model';
import {
  approvalWorkItemContract,
  boardingWorkItemContract,
  dialogueWorkItemContract,
  talkWorkItemContract,
  type CardHarness,
} from '../work-item-contract';
import { forgetTestWorkflows, testDurable } from './durable';

/**
 * The card port contract on composition's card ports over a Postgres transaction (`withThreadTx`), the same ports the
 * composed stores hand the use cases; `tests/unit/work-items.test.ts` runs it on the memory card sinks. Run with
 * `bun run test:db` inside the devcontainer. Every harness gets its own synthetic people, and everything they owned is
 * removed at the end.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');

const created: string[] = [];
const timerIds: string[] = [];
const options = { durable: testDurable, cancel: async () => {} };
const clock = () => new Date('2026-03-01T09:00:00.000Z');

afterAll(async () => {
  const db = database();
  if (created.length) {
    const owned = await db
      .select({ id: schema.threads.id })
      .from(schema.threads)
      .where(inArray(schema.threads.personId, created));
    const subjects = [...owned.map(r => `thread:${r.id}`), ...timerIds.map(id => `timer:${id}`)];
    if (subjects.length) await db.delete(schema.audit).where(inArray(schema.audit.subject, subjects));
    // A removed card's `thread.removed` row names a card that is gone; its id carries the run's prefix.
    await db.delete(schema.audit).where(like(schema.audit.subject, 'thread:wi-%'));
    await db.delete(schema.jobs).where(or(...created.map(p => like(schema.jobs.id, `attention:automatic:${p}:%`))));
    await db.delete(schema.workOccurrences).where(inArray(schema.workOccurrences.personId, created));
    await db.delete(schema.threads).where(inArray(schema.threads.personId, created));
    await db.delete(schema.timerIntents).where(inArray(schema.timerIntents.id, timerIds));
    await db.delete(schema.people).where(inArray(schema.people.id, created));
  }
  await forgetTestWorkflows();
  await closeDatabase();
});

/** A run's ids: people in one synthetic organisation, and cards that carry the run's prefix. */
function ids() {
  const prefix = `wi-${Math.random().toString(36).slice(2, 8)}`;
  let n = 0;
  return {
    async person() {
      const id = `${prefix}-p${++n}`;
      await database()
        .insert(schema.people)
        .values({ id, organisationId: prefix, name: `Synthetic Person ${prefix} ${n}` });
      created.push(id);
      return id;
    },
    card: () => `${prefix}-card-${++n}`,
  };
}
async function cardState(threadId: string) {
  const [row] = await database()
    .select({ state: schema.threads.state })
    .from(schema.threads)
    .where(eq(schema.threads.id, threadId));
  return row?.state;
}
async function timerRow(id: string) {
  const [row] = await database().select().from(schema.timerIntents).where(eq(schema.timerIntents.id, id));
  return row && { generation: row.generation, state: row.state, dueAt: row.dueAt.toISOString() };
}
/** One composition card port as the contract's harness, its timer by the id that port gives it. */
function harness<P>(port: (tx: Transaction, thread: ThreadTx) => P, timerId: (threadId: string) => string) {
  return async (): Promise<CardHarness<P>> => {
    const id = ids();
    return {
      person: id.person,
      cardId: () => {
        const card = id.card();
        timerIds.push(timerId(card));
        return card;
      },
      run: fn => withThreadTx(options, (tx, thread) => fn(port(tx, thread))),
      card: cardState,
      timer: threadId => timerRow(timerId(threadId)),
    };
  };
}

talkWorkItemContract(
  'postgres',
  harness((tx, thread) => talkWorkItems(tx, thread, { clock }), dueTimerId),
);
boardingWorkItemContract(
  'postgres',
  harness((tx, thread) => boardingWorkItems(tx, thread, { clock }), boardingTimerId),
);
dialogueWorkItemContract(
  'postgres',
  harness((tx, thread) => dialogueWorkItems(tx, thread, { clock }), dialogueDueTimerId),
);
approvalWorkItemContract('postgres', async () => {
  const id = ids();
  return {
    person: id.person,
    approvalId: id.card,
    run: fn => withThreadTx(options, (tx, thread) => fn(competenceWorkItems(tx, thread, { clock }))),
    async putAway(approvalId, managerId, state) {
      await database()
        .update(schema.threads)
        .set({ state, handledAt: new Date('2026-03-01T10:00:00.000Z') })
        .where(eq(schema.threads.id, approvalCardId(approvalId, managerId)));
    },
  };
});
