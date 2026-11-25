import { and, desc, eq, gte, inArray, not, or, sql } from 'drizzle-orm';
import type { MessageMeta, Proposal, Thread, ThreadMessage } from '@clew/contracts';
import { database, type Transaction } from './index';
import { audit, proposals, threadMessages, threads, timerIntents } from './schema';

export type ThreadRow = typeof threads.$inferSelect;
export type ProposalRow = typeof proposals.$inferSelect;
export type MessageRow = typeof threadMessages.$inferSelect;
const iso = (d: Date | null) => (d ? d.toISOString() : null);
export const toProposal = (row: ProposalRow): Proposal => ({
  id: row.id,
  threadId: row.threadId,
  status: row.status,
  start: row.start.toISOString(),
  end: row.end.toISOString(),
  participant: { name: row.participantName, email: row.participantEmail },
  eventRef: row.eventRef,
  undoUntil: iso(row.undoUntil),
  reminders: row.reminders,
  remindedAt: iso(row.remindedAt),
});
const toMessage = (row: MessageRow): ThreadMessage => ({
  id: row.id,
  role: row.role,
  body: row.body,
  createdAt: row.createdAt.toISOString(),
  ...(row.meta ? { meta: row.meta } : {}),
});
export function toThread(
  row: ThreadRow,
  messages: MessageRow[],
  proposalRows: ProposalRow[],
  timerRows: Array<typeof timerIntents.$inferSelect> = [],
): Thread {
  // Only the person's own timers (`reminder`, `snooze`) are theirs to see and cancel; an `obligation` (D30) or an action
  // point's `due` timer (D96) is the system's and never listed.
  const timers = timerRows
    .filter(t => (t.kind === 'reminder' || t.kind === 'snooze') && ['active', 'blocked'].includes(t.state))
    .map(t => ({
      kind: t.kind as 'reminder' | 'snooze',
      dueAt: t.dueAt.toISOString(),
      // The workflow starts in the commit that writes the row (D86), so an active timer is scheduled; `queued` was the outbox's state.
      state: (t.state === 'blocked' ? 'blocked' : 'scheduled') as 'blocked' | 'scheduled' | 'queued',
    }));
  return {
    id: row.id,
    ...(row.sourceAuthorization ? { sourceAuthorization: row.sourceAuthorization } : {}),
    kind: row.kind,
    topic: row.topic,
    title: row.title,
    state: row.state,
    trigger: row.trigger,
    week: row.week,
    connector: row.connector,
    area: row.area,
    summary: row.summary,
    items: row.items,
    ...(row.subjects?.length ? { subjects: row.subjects } : {}),
    ...(row.handover ? { handover: row.handover } : {}),
    ...(row.askedBeside ? { askedBeside: row.askedBeside } : {}),
    actions: row.actions,
    waitingOn: row.waitingOn,
    ...(row.handOn ? { handOn: row.handOn } : {}),
    ...(row.handedOnAt && row.handedOnTo ? { handedOn: { to: row.handedOnTo, at: row.handedOnAt.toISOString() } } : {}),
    deadline: row.deadline,
    receipt: row.receipt ?? null,
    ...(row.execution ? { execution: row.execution } : {}),
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    ...(row.decisionRevision ? { decisionRevision: row.decisionRevision } : {}),
    handledAt: iso(row.handledAt),
    remindedAt: iso(row.remindedAt),
    snoozedUntil: iso(row.snoozedUntil),
    ...(timers.length ? { timers } : {}),
    messages: messages.map(toMessage),
    proposals: proposalRows.filter(p => p.status !== 'superseded').map(toProposal),
  };
}
/**
 * Unresolved work: a pushed card that is open, or whose execution has not settled. Written with its values in the text,
 * never as parameters, and as the condition of the index `thread_unresolved` is (schema.ts): the planner uses a
 * partial index only where it sees that the query's condition is the index's, which a parameter hides (DE-L12). In
 * parentheses of its own, so `not(unresolved)` negates the whole of it.
 */
const unresolved = sql`(${threads.kind} = 'pushed' AND (${threads.state} = 'open' OR coalesce(${threads.execution}->>'state' IN ('pending','running','unknown','partial','failed'), false)))`;
/** Threads with their messages, proposals and timers, in the order of the rows given. */
async function hydrate(rows: ThreadRow[]): Promise<Thread[]> {
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const [messages, proposalRows, timerRows] = await Promise.all([
    database()
      .select()
      .from(threadMessages)
      .where(inArray(threadMessages.threadId, ids))
      .orderBy(threadMessages.createdAt, threadMessages.seq),
    database().select().from(proposals).where(inArray(proposals.threadId, ids)).orderBy(proposals.start),
    database().select().from(timerIntents).where(inArray(timerIntents.threadId, ids)),
  ]);
  return rows.map(row =>
    toThread(
      row,
      messages.filter(m => m.threadId === row.id),
      proposalRows.filter(p => p.threadId === row.id),
      timerRows.filter(t => t.threadId === row.id),
    ),
  );
}
/** The person's unresolved work cards among these ids (as `listThreads` lists work), newest first; another person's id is left out. */
export async function unresolvedThreads(personId: string, ids: readonly string[]): Promise<Thread[]> {
  if (!ids.length) return [];
  const rows = await database()
    .select()
    .from(threads)
    .where(and(eq(threads.personId, personId), inArray(threads.id, [...ids]), unresolved))
    .orderBy(desc(threads.createdAt));
  return hydrate(rows);
}
/**
 * Every unresolved work card plus bounded conversation/handled history: the 50 with the latest activity. History can
 * never displace work. Alla samtal pages through every conversation with `listConversations`.
 */
export async function listThreads(personId: string, now = new Date()): Promise<Thread[]> {
  const since = new Date(now.getTime() - 7 * 86400_000);
  const [work, history] = await Promise.all([
    database()
      .select()
      .from(threads)
      .where(and(eq(threads.personId, personId), unresolved))
      .orderBy(desc(threads.createdAt)),
    database()
      .select()
      .from(threads)
      .where(
        and(
          eq(threads.personId, personId),
          not(unresolved),
          or(eq(threads.state, 'open'), gte(threads.updatedAt, since)),
        ),
      )
      .orderBy(desc(threads.updatedAt), desc(threads.id))
      .limit(50),
  ]);
  return hydrate([...work, ...history].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()));
}
/** A thread's latest activity to the microsecond, as text the cursor carries and `timestamptz` reads back exactly. */
const activityText = sql<string>`to_char(${threads.updatedAt} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;
/**
 * Alla samtal (WD-L1): `limit` of the person's conversations after the cursor, the latest activity first, and the
 * cursor of the last one when more follow. The order is `thread_conversation_recent`'s.
 */
export async function listConversations(
  personId: string,
  after: { at: string; id: string } | undefined,
  limit: number,
): Promise<{ threads: Thread[]; next: { at: string; id: string } | null }> {
  const rows = await database()
    .select({ thread: threads, at: activityText })
    .from(threads)
    .where(
      and(
        eq(threads.personId, personId),
        eq(threads.kind, 'question'),
        after ? sql`(${threads.updatedAt}, ${threads.id}) < (${after.at}::timestamptz, ${after.id})` : undefined,
      ),
    )
    .orderBy(desc(threads.updatedAt), desc(threads.id))
    .limit(limit + 1);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  return {
    threads: await hydrate(page.map(r => r.thread)),
    next: rows.length > limit && last ? { at: last.at, id: last.thread.id } : null,
  };
}
/**
 * Where a question with this turn key was written (WD-L3), whoever wrote it: the key is unique across the
 * installation (`thread_message_turn`), so it is looked up across it, and the caller holds it to the person.
 */
export async function turnWritten(turn: string): Promise<{ personId: string; threadId: string } | undefined> {
  const [row] = await database()
    .select({ personId: threads.personId, threadId: threads.id })
    .from(threadMessages)
    .innerJoin(threads, eq(threads.id, threadMessages.threadId))
    .where(and(eq(threadMessages.role, 'user'), sql`(${threadMessages.meta}->>'turn') = ${turn}`))
    .limit(1);
  return row;
}
export async function readThread(personId: string, id: string, tx?: Transaction) {
  const db = tx ?? database();
  const [row] = await db
    .select()
    .from(threads)
    .where(and(eq(threads.id, id), eq(threads.personId, personId)));
  if (!row) return undefined;
  const [messages, proposalRows, timerRows] = await Promise.all([
    db
      .select()
      .from(threadMessages)
      .where(eq(threadMessages.threadId, id))
      .orderBy(threadMessages.createdAt, threadMessages.seq),
    db.select().from(proposals).where(eq(proposals.threadId, id)).orderBy(proposals.start),
    db.select().from(timerIntents).where(eq(timerIntents.threadId, id)),
  ]);
  return { row, messages, proposalRows, thread: toThread(row, messages, proposalRows, timerRows) };
}
export async function writeAudit(
  tx: Transaction,
  entry: { actor: string; action: string; subject: string; details?: Record<string, unknown> },
) {
  await tx
    .insert(audit)
    .values({ actor: entry.actor, action: entry.action, subject: entry.subject, details: entry.details ?? {} });
}
export async function addMessage(
  tx: Transaction,
  threadId: string,
  role: 'assistant' | 'user',
  body: string,
  meta?: MessageMeta,
) {
  const [row] = await tx
    .insert(threadMessages)
    .values({ id: crypto.randomUUID(), threadId, role, body, meta: meta ?? null })
    .returning();
  await tx.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, threadId));
  return row!;
}
export async function openProposalThread(personId: string, topic: string) {
  const [row] = await database()
    .select()
    .from(threads)
    .where(and(eq(threads.personId, personId), eq(threads.topic, topic), eq(threads.state, 'open')));
  return row;
}
/** Proposals that are drawn or booked for a person, used to keep new plans from colliding with earlier ones. */
export async function activeProposals(personId: string) {
  return database()
    .select()
    .from(proposals)
    .where(and(eq(proposals.personId, personId), inArray(proposals.status, ['proposed', 'confirmed', 'final'])));
}
export async function readAudit(subject: string) {
  return database().select().from(audit).where(eq(audit.subject, subject)).orderBy(audit.id);
}
