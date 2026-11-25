import { and, count, desc, eq, inArray, or, sql } from 'drizzle-orm';
import type { EntityKind, Subject, ThreadItem } from '@clew/contracts';
import { database, schema, type Transaction } from '@clew/db';
import { listConversations, listThreads, toThread, turnWritten, unresolvedThreads } from '@clew/db/threads';
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
  for (const s of subjects) byKind.set(s.entity, (byKind.get(s.entity) ?? new Set()).add(s.key));
  return or(
    ...[...byKind].map(([entity, keys]) =>
      and(eq(threadSubjects.entity, entity), inArray(threadSubjects.key, [...keys])),
    ),
  );
};
/** The unique index `thread_open_topic` refused a write; the driver may wrap the error once. */
function openTopicTaken(error: unknown) {
  const e = error as { code?: string; constraint_name?: string; cause?: { code?: string; constraint_name?: string } };
  return (
    (e?.code ?? e?.cause?.code) === '23505' && (e?.constraint_name ?? e?.cause?.constraint_name) === 'thread_open_topic'
  );
}
const date = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : new Date(value);
const toRow = (patch: ThreadPatch) => {
  const { handledAt, updatedAt, remindedAt, snoozedUntil, handedOn, ...rest } = patch;
  return {
    ...rest,
    ...(handedOn !== undefined
      ? { handedOnTo: handedOn?.to ?? null, handedOnAt: handedOn ? new Date(handedOn.at) : null }
      : {}),
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
        handover: t.handover ?? null,
        askedBeside: t.askedBeside ?? null,
        actions: t.actions,
        waitingOn: t.waitingOn,
        handOn: t.handOn ?? null,
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
  async reopenThread(id, patch) {
    // Only while no other open pushed card of the person holds the topic (DE-L9). In a savepoint, so a card made on the
    // topic by another transaction at this moment, which the index `thread_open_topic` refuses this update for, leaves
    // this transaction as it was.
    try {
      return await tx.transaction(async savepoint => {
        const reopened = await savepoint
          .update(threads)
          .set(toRow({ ...patch, state: 'open' }))
          .where(
            and(
              eq(threads.id, id),
              // The row being updated is `thread`; `other` is any other card of the person on the same topic.
              sql`(thread.kind <> 'pushed' or not exists (
                select 1 from thread other where other.person_id = thread.person_id and other.topic = thread.topic
                  and other.state = 'open' and other.kind = 'pushed' and other.id <> thread.id))`,
            ),
          )
          .returning({ id: threads.id });
        return reopened.length > 0;
      });
    } catch (error) {
      if (openTopicTaken(error)) return false;
      throw error;
    }
  },
  async topicHolder(id) {
    // A statement of its own, so after a reopen refused for a race it sees the card the other transaction committed.
    const [holder] = await tx.execute<{ id: string }>(
      sql`select other.id from thread other join thread own on other.person_id = own.person_id
            and other.topic = own.topic
          where own.id = ${id} and own.kind = 'pushed' and other.id <> own.id
            and other.state = 'open' and other.kind = 'pushed'
          limit 1`,
    );
    return holder?.id;
  },
  async eraseSubject(subject) {
    const erased = { cards: 0, rows: 0, cardSubjects: 0 };
    const where = and(eq(threadSubjects.entity, subject.entity), eq(threadSubjects.key, subject.key));
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
  async eraseConversationsBeside(personId) {
    // The thing a conversation was asked beside is kept in `asked_beside` as written (D136 item 1): containment matches
    // the kind and the id exactly. An operator's rare erasure reads the conversations without an index of its own.
    const beside = and(
      eq(threads.kind, 'question'),
      sql`${threads.askedBeside} @> ${JSON.stringify({ thing: { kind: 'person', id: personId } })}::jsonb`,
    );
    // Locked in id order, as the other erasure takes its threads, then deleted with what hangs on them.
    const rows = await tx.select({ id: threads.id }).from(threads).where(beside).orderBy(threads.id).for('update');
    if (!rows.length) return { conversations: 0, messages: 0 };
    const ids = rows.map(r => r.id);
    const [counted] = await tx
      .select({ messages: count() })
      .from(threadMessages)
      .where(inArray(threadMessages.threadId, ids));
    await tx.delete(threads).where(inArray(threads.id, ids));
    return { conversations: rows.length, messages: counted?.messages ?? 0 };
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
  async markRecordDraftSent(mark) {
    // One statement: the row is taken only while every condition holds, so of two marks of one draft the second finds it
    // marked once the first commits. `jsonb` compares the input as a value, its keys in any order (`marksRecordDraft`).
    const draft = sql`${threadMessages.meta} -> 'recordDraft'`;
    const marked = await tx
      .update(threadMessages)
      .set({
        meta: sql`jsonb_set(${threadMessages.meta}, '{recordDraft,sent}', ${JSON.stringify({ threadId: mark.threadId })}::jsonb)`,
      })
      .where(
        and(
          eq(threadMessages.id, mark.messageId),
          eq(threadMessages.threadId, mark.conversationId),
          sql`exists (select 1 from ${threads} where ${threads.id} = ${mark.conversationId} and ${threads.personId} = ${mark.personId} and ${threads.kind} = 'question')`,
          sql`${draft} ->> 'capability' = ${mark.capability}`,
          sql`${draft} -> 'record' ->> 'capability' = ${mark.record.capability}`,
          sql`${draft} -> 'record' -> 'input' = ${JSON.stringify(mark.record.input)}::jsonb`,
          sql`${draft} -> 'sent' is null`,
        ),
      )
      .returning({ id: threadMessages.id });
    return marked.length > 0;
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
    listConversations: (personId, { after, limit }) => listConversations(personId, after, limit),
    turnWritten,
    async claimHandover(turn, personId) {
      const inserted = await database()
        .insert(schema.handoverTurns)
        .values({ turn, personId })
        .onConflictDoNothing()
        .returning({ turn: schema.handoverTurns.turn });
      return inserted.length === 1;
    },
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
