import { and, desc, eq, gte, inArray, or } from 'drizzle-orm';
import type { MessageMeta, Proposal, Thread, ThreadMessage } from '@clew/contracts';
import { database, type Transaction } from './index';
import { audit, proposals, threadMessages, threads } from './schema';

export type ThreadRow = typeof threads.$inferSelect;
export type ProposalRow = typeof proposals.$inferSelect;
export type MessageRow = typeof threadMessages.$inferSelect;
const iso = (d: Date | null) => d ? d.toISOString() : null;
export const toProposal = (row: ProposalRow): Proposal => ({ id: row.id, threadId: row.threadId, status: row.status, start: row.start.toISOString(), end: row.end.toISOString(),
  participant: { name: row.participantName, email: row.participantEmail }, eventRef: row.eventRef, undoUntil: iso(row.undoUntil) });
const toMessage = (row: MessageRow): ThreadMessage => ({ id: row.id, role: row.role, body: row.body, createdAt: row.createdAt.toISOString(), ...(row.meta ? { meta: row.meta } : {}) });
export function toThread(row: ThreadRow, messages: MessageRow[], proposalRows: ProposalRow[]): Thread {
  return { id: row.id, kind: row.kind, topic: row.topic, title: row.title, state: row.state, trigger: row.trigger, week: row.week,
    connector: row.connector, area: row.area, summary: row.summary, items: row.items, actions: row.actions, waitingOn: row.waitingOn, deadline: row.deadline, receipt: row.receipt ?? null,
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), handledAt: iso(row.handledAt), remindedAt: iso(row.remindedAt),
    messages: messages.map(toMessage), proposals: proposalRows.filter(p => p.status !== 'superseded').map(toProposal) };
}
/** Open threads plus what was handled in the last seven days, newest first. */
export async function listThreads(personId: string): Promise<Thread[]> {
  const since = new Date(Date.now() - 7 * 86400_000);
  const rows = await database().select().from(threads).where(and(eq(threads.personId, personId), or(eq(threads.state, 'open'), gte(threads.updatedAt, since)))).orderBy(desc(threads.createdAt)).limit(50);
  if (!rows.length) return [];
  const ids = rows.map(r => r.id);
  const [messages, proposalRows] = await Promise.all([
    database().select().from(threadMessages).where(inArray(threadMessages.threadId, ids)).orderBy(threadMessages.createdAt),
    database().select().from(proposals).where(inArray(proposals.threadId, ids)).orderBy(proposals.start),
  ]);
  return rows.map(row => toThread(row, messages.filter(m => m.threadId === row.id), proposalRows.filter(p => p.threadId === row.id)));
}
export async function readThread(personId: string, id: string, tx?: Transaction) {
  const db = tx ?? database();
  const [row] = await db.select().from(threads).where(and(eq(threads.id, id), eq(threads.personId, personId)));
  if (!row) return undefined;
  const [messages, proposalRows] = await Promise.all([
    db.select().from(threadMessages).where(eq(threadMessages.threadId, id)).orderBy(threadMessages.createdAt),
    db.select().from(proposals).where(eq(proposals.threadId, id)).orderBy(proposals.start),
  ]);
  return { row, messages, proposalRows, thread: toThread(row, messages, proposalRows) };
}
export async function writeAudit(tx: Transaction, entry: { actor: string; action: string; subject: string; details?: Record<string, unknown> }) {
  await tx.insert(audit).values({ actor: entry.actor, action: entry.action, subject: entry.subject, details: entry.details ?? {} });
}
export async function addMessage(tx: Transaction, threadId: string, role: 'assistant' | 'user', body: string, meta?: MessageMeta) {
  const [row] = await tx.insert(threadMessages).values({ id: crypto.randomUUID(), threadId, role, body, meta: meta ?? null }).returning();
  await tx.update(threads).set({ updatedAt: new Date() }).where(eq(threads.id, threadId));
  return row!;
}
export async function openProposalThread(personId: string, topic: string) {
  const [row] = await database().select().from(threads).where(and(eq(threads.personId, personId), eq(threads.topic, topic), eq(threads.state, 'open')));
  return row;
}
/** Proposals that are drawn or booked for a person, used to keep new plans from colliding with earlier ones. */
export async function activeProposals(personId: string) {
  return database().select().from(proposals).where(and(eq(proposals.personId, personId), inArray(proposals.status, ['proposed', 'confirmed', 'final'])));
}
export async function readAudit(subject: string) {
  return database().select().from(audit).where(eq(audit.subject, subject)).orderBy(audit.id);
}
