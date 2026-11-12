import { and, desc, eq, inArray, or } from 'drizzle-orm';
import { foldEntityKey, type EntityKind, type Subject, type ThreadItem } from '@clew/contracts';
import { database, schema, type Transaction } from '@clew/db';
import { listThreads, toThread, unresolvedThreads } from '@clew/db/threads';
import { scheduleJob } from '@clew/db/jobs';
import { enqueueWorkflow, type DurableQueue } from '@clew/db/durable';
import type { ThreadPatch, ThreadStore, ThreadTx } from '../model';
import { namedAmong, namedSubjects, withoutSubject } from '../domain';
import { readTimer, timerTx } from './timer-postgres';
import { attentionTx } from './attention-postgres';
import { logger } from '../../logging';

/**
 * The store the server runs (D25): the `ThreadStore` port over Drizzle and Postgres. Held to the memory adapter's
 * behaviour by `tests/store-contract.ts`. `durable` names the engine's application and queue, so `enqueue` and every
 * scheduled job start their workflow inside the transaction (D86); `cancel` is called after a commit for each workflow
 * whose wait the transaction ended, best effort, and is the engine's `cancelDurable` in composition.
 */
export interface ThreadStoreOptions {
  durable: DurableQueue;
  cancel?: (workflowId: string) => Promise<void>;
}
const { threads, threadMessages, proposals, audit, threadSubjects } = schema;
/**
 * The index from entity to cards (D97 item 6), kept in step with a thread's items in the transaction that writes them:
 * the thread's rows are replaced by what its items and own subjects name now. A deleted thread takes its rows with it.
 */
async function indexSubjects(
  tx: Transaction,
  thread: { id: string; personId: string; items: ThreadItem[]; subjects?: Subject[] },
  replace: boolean,
) {
  if (replace) await tx.delete(threadSubjects).where(eq(threadSubjects.threadId, thread.id));
  const named = namedSubjects(thread);
  if (named.length)
    await tx
      .insert(threadSubjects)
      .values(named.map(s => ({ threadId: thread.id, personId: thread.personId, entity: s.entity, key: s.key })))
      .onConflictDoNothing();
}
/** The index rows naming any of these entities, one condition per kind. */
const naming = (subjects: readonly Subject[]) => {
  const byKind = new Map<EntityKind, Set<string>>();
  for (const s of subjects)
    byKind.set(s.entity, (byKind.get(s.entity) ?? new Set()).add(foldEntityKey(s.entity, s.key)));
  return or(
    ...[...byKind].map(([entity, keys]) =>
      and(eq(threadSubjects.entity, entity), inArray(threadSubjects.key, [...keys])),
    ),
  );
};
const date = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : new Date(value);
const toRow = (patch: ThreadPatch) => {
  const { handledAt, updatedAt, remindedAt, snoozedUntil, ...rest } = patch;
  return {
    ...rest,
    ...(handledAt !== undefined ? { handledAt: date(handledAt) } : {}),
    ...(updatedAt !== undefined ? { updatedAt: date(updatedAt)! } : {}),
    ...(remindedAt !== undefined ? { remindedAt: date(remindedAt) } : {}),
    ...(snoozedUntil !== undefined ? { snoozedUntil: date(snoozedUntil) } : {}),
  };
};
async function read(db: Transaction | ReturnType<typeof database>, where: ReturnType<typeof and>) {
  const [row] = await db.select().from(threads).where(where);
  if (!row) return undefined;
  const [messages, proposalRows, timerRows] = await Promise.all([
    db
      .select()
      .from(threadMessages)
      .where(eq(threadMessages.threadId, row.id))
      .orderBy(threadMessages.createdAt, threadMessages.seq),
    db.select().from(proposals).where(eq(proposals.threadId, row.id)).orderBy(proposals.start),
    db.select().from(schema.timerIntents).where(eq(schema.timerIntents.threadId, row.id)),
  ]);
  return toThread(row, messages, proposalRows, timerRows);
}
export const threadTx = (tx: Transaction, options: ThreadStoreOptions, ended?: string[]): ThreadTx => ({
  ...attentionTx(tx, options.durable),
  ...timerTx(tx, ended),
  enqueue: start => enqueueWorkflow(tx, options.durable, start),
  async lockThreadById(id) {
    const [r] = await tx.select().from(threads).where(eq(threads.id, id)).for('update');
    return r ? read(tx, eq(threads.id, id)) : undefined;
  },
  async lockThread(personId, id) {
    const [row] = await tx
      .select()
      .from(threads)
      .where(and(eq(threads.id, id), eq(threads.personId, personId)))
      .for('update');
    if (!row) return undefined;
    const [messages, proposalRows, timerRows] = await Promise.all([
      tx
        .select()
        .from(threadMessages)
        .where(eq(threadMessages.threadId, id))
        .orderBy(threadMessages.createdAt, threadMessages.seq),
      tx.select().from(proposals).where(eq(proposals.threadId, id)).orderBy(proposals.start),
      tx.select().from(schema.timerIntents).where(eq(schema.timerIntents.threadId, id)),
    ]);
    return toThread(row, messages, proposalRows, timerRows);
  },
  async insertThread(thread) {
    const { personId, ...t } = thread;
    const inserted = await tx
      .insert(threads)
      .values({
        id: t.id,
        personId,
        kind: t.kind,
        topic: t.topic,
        title: t.title,
        state: t.state,
        week: t.week,
        connector: t.connector,
        area: t.area,
        summary: t.summary,
        items: t.items,
        subjects: t.subjects ?? [],
        actions: t.actions,
        waitingOn: t.waitingOn,
        deadline: t.deadline,
        trigger: t.trigger,
        execution: t.execution ?? null,
        sourceAuthorization: t.sourceAuthorization ?? null,
        createdAt: new Date(t.createdAt),
        updatedAt: new Date(t.updatedAt),
      })
      .onConflictDoNothing()
      .returning({ id: threads.id });
    if (inserted.length) await indexSubjects(tx, { ...t, personId }, false);
    return inserted.length > 0;
  },
  async updateThread(id, patch) {
    if (patch.items === undefined) {
      await tx.update(threads).set(toRow(patch)).where(eq(threads.id, id));
      return;
    }
    // New rows may name other entities: the index follows in the same transaction.
    const [row] = await tx
      .update(threads)
      .set(toRow(patch))
      .where(eq(threads.id, id))
      .returning({ id: threads.id, personId: threads.personId, items: threads.items, subjects: threads.subjects });
    if (row) await indexSubjects(tx, row, true);
  },
  async eraseSubject(subject) {
    const erased = { cards: 0, rows: 0, cardSubjects: 0 };
    const where = and(
      eq(threadSubjects.entity, subject.entity),
      eq(threadSubjects.key, foldEntityKey(subject.entity, subject.key)),
    );
    const named = await tx.selectDistinct({ id: threadSubjects.threadId }).from(threadSubjects).where(where);
    if (!named.length) return erased;
    // The threads first, in id order, then their index rows, as a write of a thread's items takes them: two erasures, or
    // an erasure and a scan, cannot deadlock. A card that names the entity first after this read is left whole, index
    // and all, for the next erasure.
    const rows = await tx
      .select({ id: threads.id, items: threads.items, subjects: threads.subjects })
      .from(threads)
      .where(
        inArray(
          threads.id,
          named.map(n => n.id),
        ),
      )
      .orderBy(threads.id)
      .for('update');
    if (!rows.length) return erased;
    for (const row of rows) {
      const left = withoutSubject(row, subject);
      if (!left) continue;
      await tx.update(threads).set({ items: left.items, subjects: left.subjects }).where(eq(threads.id, row.id));
      erased.cards++;
      erased.rows += left.erased.rows;
      erased.cardSubjects += left.erased.cardSubjects;
    }
    await tx.delete(threadSubjects).where(
      and(
        where,
        inArray(
          threadSubjects.threadId,
          rows.map(r => r.id),
        ),
      ),
    );
    return erased;
  },
  async addMessage(threadId, message) {
    await tx.insert(threadMessages).values({
      id: crypto.randomUUID(),
      threadId,
      role: message.role,
      body: message.body,
      meta: message.meta ?? null,
      createdAt: new Date(message.at),
    });
    await tx
      .update(threads)
      .set({ updatedAt: new Date(message.at) })
      .where(eq(threads.id, threadId));
  },
  async writeAudit(entry) {
    await tx.insert(audit).values({
      actor: entry.actor,
      action: entry.action,
      subject: entry.subject,
      details: entry.details ?? {},
      createdAt: new Date(entry.at),
    });
  },
  async scheduleJob(job) {
    await scheduleJob(
      { id: job.id, kind: job.kind, runAt: new Date(job.runAt), payload: job.payload },
      options.durable,
      tx,
    );
  },
});
/** One thread transaction, then the cancels it asked for: a cancel that fails or never arrives is covered by the generation fence, so it is logged, never raised. */
export async function withThreadTx<T>(
  options: ThreadStoreOptions,
  fn: (tx: Transaction, thread: ThreadTx) => Promise<T>,
): Promise<T> {
  const ended: string[] = [];
  const result = await database().transaction(tx => fn(tx, threadTx(tx, options, ended)));
  for (const id of ended)
    await options
      .cancel?.(id)
      .catch(error => logger.error({ scope: 'threads', timer: id, error }, 'durable cancel failed'));
  return result;
}
export function postgresThreadStore(options: ThreadStoreOptions): ThreadStore {
  return {
    readTimer,
    listThreads: (personId, now) => listThreads(personId, new Date(now)),
    readThread: (personId, id) => read(database(), and(eq(threads.id, id), eq(threads.personId, personId))),
    readThreadById: id => read(database(), eq(threads.id, id)),
    async openThread(personId, topic) {
      return read(database(), and(eq(threads.personId, personId), eq(threads.topic, topic), eq(threads.state, 'open')));
    },
    async threadsNaming(personId, subjects) {
      if (!subjects.length) return [];
      const rows = await database()
        .select({ threadId: threadSubjects.threadId, entity: threadSubjects.entity, key: threadSubjects.key })
        .from(threadSubjects)
        .where(and(eq(threadSubjects.personId, personId), naming(subjects)));
      if (!rows.length) return [];
      const named = new Map<string, Subject[]>();
      for (const r of rows) named.set(r.threadId, [...(named.get(r.threadId) ?? []), { entity: r.entity, key: r.key }]);
      const found = await unresolvedThreads(personId, [...named.keys()]);
      return found.map(thread => ({ thread, subjects: namedAmong(named.get(thread.id)!, subjects) }));
    },
    async history(subjects, limit) {
      if (!subjects.length || limit < 1) return [];
      // The newest `limit` by the subject index (`audit_subject`), handed back oldest first.
      const rows = await database()
        .select()
        .from(audit)
        .where(inArray(audit.subject, [...subjects]))
        .orderBy(desc(audit.createdAt), desc(audit.id))
        .limit(limit);
      return rows.reverse().map(r => ({
        actor: r.actor,
        action: r.action,
        subject: r.subject,
        at: r.createdAt.toISOString(),
        details: r.details,
      }));
    },
    transaction: fn => withThreadTx(options, (_, tx) => fn(tx)),
  };
}
