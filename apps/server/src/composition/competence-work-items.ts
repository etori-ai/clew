import { and, eq, inArray, like } from 'drizzle-orm';
import type { ThreadAction } from '@clew/contracts';
import { COMPETENCE_CONNECTOR } from '@clew/connectors';
import { schema, type Transaction } from '@clew/db';
import type { ThreadTx } from '../threads/model';
import { APPROVAL_READ } from '../modules/competence/domain';
import type { ApprovalOutcome, ApprovalWorkItemTx } from '../modules/competence/model';

/**
 * The cards of a person's own registration waiting for approval (D108 item 7): the competence module's
 * `ApprovalWorkItemTx`, implemented over the thread store's transaction as `talk-work-items.ts` implements talks'
 * `WorkItemTx`. The holding, its cards, their deliveries, messages and audit rows commit or roll back as one, because
 * the competence transaction and this one share one physical database transaction (`competenceStoreWithCards`).
 *
 * One card per manager the person reports to when they register (D99 item 4), each in that manager's stream: the thread
 * `<threadId>:<manager id>` (`approvalCardId`), every card of the approval on one topic (`approvalTopic`), which a
 * partial index on `thread` finds, so a decision by any manager the person reports to, or the person taking the
 * registration back, closes every card in one go. The card names nobody and no competence in its title, summary,
 * trigger or messages, since those are what the assistant reads; the audit rows carry ids. The person who registered is
 * the card's own `subjects` (D97 item 6), a key that is never drawn on the card and never read by the assistant, so the
 * card shows under "Behöver dig" on that person for its owner. Its one action is a read (`competence.approval`) that
 * answers with rows, so its button leads to that read's page, which the web serves as the approval over the matrix. The
 * card has no deadline and no timer of its own; a reminder or a snooze its owner set ends with it. Clew sets a card aside
 * (`reassigned`, `paused`) with a trigger that says why, and opens again only a card it set aside: one its owner put
 * away stays as they left it. It is `core` (the
 * `competence` connector) and has no `sourceAuthorization`, so it stays with its owner when they change unit.
 */
export interface CompetenceWorkItemOptions {
  /** Composition's clock: the instant written where the port gives none (erasure). */
  clock: () => Date;
}
const ACTOR = 'competence:approval';
const AREA = 'competence';
const TITLE = 'Intyg att granska';
const SUMMARY = 'En medarbetare har registrerat ett eget intyg. Det räknas när du har godkänt det.';
const SOURCE = 'Kompetens';
const WAITING = 'Väntar på ditt godkännande';
const ENDED: Record<ApprovalOutcome, string> = {
  approved: 'Intyget är godkänt.',
  rejected: 'Intyget är avvisat.',
  withdrawn: 'Medarbetaren tog tillbaka registreringen.',
  reassigned: 'Du granskar inte längre den här registreringen.',
  paused: 'Registreringen vilar medan medarbetaren inte är aktiv.',
};
/**
 * Why Clew set a card aside, as its trigger says it (a card's why line): the mark by which `cards` tells a card Clew put
 * away, which it may open again, from one its owner put away, which it leaves alone.
 */
const SET_ASIDE: Partial<Record<ApprovalOutcome, string>> = {
  reassigned: 'Granskas inte längre av dig',
  paused: 'Medarbetaren är inte aktiv',
};
const asideReasons = new Set(Object.values(SET_ASIDE));
/** The topic every card of one approval carries. */
export const approvalTopic = (threadId: string) => `${COMPETENCE_CONNECTOR}:approval:${threadId}`;
/** One manager's card of one approval. */
export const approvalCardId = (threadId: string, managerId: string) => `${threadId}:${managerId}`;
const reviewAction = (holdingId: string): ThreadAction => ({
  id: 'review',
  label: 'Granska',
  capability: APPROVAL_READ,
  kind: 'read',
  role: 'primary',
  input: { holding: holdingId },
});

export function competenceWorkItems(
  tx: Transaction,
  thread: ThreadTx,
  options: CompetenceWorkItemOptions,
): ApprovalWorkItemTx {
  const { threads } = schema;
  /** The person's own snooze and reminder end with the card's state: they would otherwise reopen it as "Du bad …". */
  async function endOwnTimers(threadId: string, at: string) {
    await thread.cancelTimer(`snooze:${threadId}`, at);
    await thread.cancelTimer(`reminder:${threadId}`, at);
  }
  /** Every card of one approval, whichever stream it is in, locked in one order. */
  const lockCards = (threadId: string) =>
    tx
      .select({ id: threads.id, personId: threads.personId, state: threads.state, trigger: threads.trigger })
      .from(threads)
      .where(and(eq(threads.connector, COMPETENCE_CONNECTOR), eq(threads.topic, approvalTopic(threadId))))
      .orderBy(threads.id)
      .for('update');
  /** Remove these cards with what hangs on them, as erasure does; the running waits end after the commit. */
  async function removeCards(ids: readonly string[]) {
    if (!ids.length) return;
    const at = options.clock().toISOString();
    const timers = await tx
      .select({ id: schema.timerIntents.id })
      .from(schema.timerIntents)
      .where(inArray(schema.timerIntents.threadId, [...ids]))
      .orderBy(schema.timerIntents.id)
      .for('update');
    for (const timer of timers) await thread.cancelTimer(timer.id, at);
    // Messages, proposals, timers, deliveries and follow-up policies cascade; an occurrence only loses its pointer.
    await tx.delete(schema.workOccurrences).where(inArray(schema.workOccurrences.threadId, [...ids]));
    await tx.delete(threads).where(inArray(threads.id, [...ids]));
    for (const id of ids)
      await thread.writeAudit({
        actor: ACTOR,
        action: 'thread.removed',
        subject: `thread:${id}`,
        at,
        details: { reason: 'erasure' },
      });
  }
  return {
    async open({ threadId, holdingId, managers, at, subject }) {
      for (const personId of [...new Set(managers)].sort()) {
        const id = approvalCardId(threadId, personId);
        const inserted = await thread.insertThread({
          id,
          personId,
          kind: 'pushed',
          topic: approvalTopic(threadId),
          title: TITLE,
          state: 'open',
          week: null,
          connector: COMPETENCE_CONNECTOR,
          area: AREA,
          summary: SUMMARY,
          items: [],
          // The person who registered, by key, on the thread and never on a row (D97 item 6).
          ...(subject ? { subjects: [subject] } : {}),
          actions: [reviewAction(holdingId)],
          waitingOn: null,
          deadline: null,
          trigger: { reason: WAITING, source: SOURCE, at },
          createdAt: at,
          updatedAt: at,
        });
        if (!inserted) throw new Error(`The approval card ${id} already exists.`);
        await thread.admitDelivery({ id: `delivery:${id}`, personId, threadId: id, kind: 'automatic', at });
        await thread.addMessage(id, { role: 'assistant', body: SUMMARY, at });
        await thread.writeAudit({
          actor: ACTOR,
          action: 'thread.pushed',
          subject: `thread:${id}`,
          at,
          details: { holding: holdingId, owner: personId },
        });
      }
    },
    async close(threadId, at, outcome, only) {
      const aside = SET_ASIDE[outcome];
      for (const card of await lockCards(threadId)) {
        if (only && !only.includes(card.personId)) continue;
        await endOwnTimers(card.id, at);
        // One its owner already put away (handled or dismissed) stays as they left it.
        if (card.state !== 'open') continue;
        await thread.updateThread(card.id, {
          state: 'handled',
          handledAt: at,
          waitingOn: null,
          snoozedUntil: null,
          updatedAt: at,
          ...(aside ? { trigger: { reason: aside, source: SOURCE, at } } : {}),
        });
        await thread.addMessage(card.id, { role: 'assistant', body: ENDED[outcome], at });
        await thread.writeAudit({
          actor: ACTOR,
          action: 'thread.handled',
          subject: `thread:${card.id}`,
          at,
          details: { owner: card.personId, outcome },
        });
      }
    },
    async cards(threadId) {
      return (await lockCards(threadId)).map(card => ({
        personId: card.personId,
        open: card.state === 'open',
        setAside: card.state === 'handled' && asideReasons.has(card.trigger.reason),
      }));
    },
    async reopen(threadId, personIds, at) {
      for (const card of await lockCards(threadId)) {
        if (!personIds.includes(card.personId)) continue;
        // Only a card Clew set aside; one its owner put away stays as they left it.
        if (card.state !== 'handled' || !asideReasons.has(card.trigger.reason)) continue;
        await thread.updateThread(card.id, {
          state: 'open',
          handledAt: null,
          snoozedUntil: null,
          updatedAt: at,
          trigger: { reason: WAITING, source: SOURCE, at },
        });
        await thread.addMessage(card.id, {
          role: 'assistant',
          body: 'Registreringen väntar på ditt godkännande igen.',
          at,
        });
        await thread.admitDelivery({
          id: `reopened:${card.id}:${at}`,
          personId: card.personId,
          threadId: card.id,
          kind: 'automatic',
          at,
        });
        await thread.writeAudit({
          actor: ACTOR,
          action: 'thread.reopened',
          subject: `thread:${card.id}`,
          at,
          details: { owner: card.personId },
        });
      }
    },
    async remove(threadIds) {
      if (!threadIds.length) return;
      const cards = await tx
        .select({ id: threads.id })
        .from(threads)
        .where(and(eq(threads.connector, COMPETENCE_CONNECTOR), inArray(threads.topic, threadIds.map(approvalTopic))))
        .orderBy(threads.id)
        .for('update');
      await removeCards(cards.map(c => c.id));
    },
    async removeAbout(subject) {
      // Through the index from entity to cards, which holds a person by Clew's key, their id, compared exactly (D122).
      const rows = await tx
        .selectDistinct({ id: threads.id })
        .from(threads)
        .innerJoin(schema.threadSubjects, eq(schema.threadSubjects.threadId, threads.id))
        .where(
          and(
            eq(threads.connector, COMPETENCE_CONNECTOR),
            like(threads.topic, approvalTopic('%')),
            eq(schema.threadSubjects.entity, subject.entity),
            eq(schema.threadSubjects.key, subject.key),
          ),
        )
        .orderBy(threads.id);
      await removeCards(rows.map(r => r.id));
    },
    async removeOwned(personId) {
      // Every card of the module in their stream: the approvals they decide as a manager, and the scan's cards about
      // their own competence ("HLR saknas", "… gick ut"), whose titles name a type and a day (D108 items 7, 12 and 14).
      const cards = await tx
        .select({ id: threads.id })
        .from(threads)
        .where(and(eq(threads.personId, personId), eq(threads.connector, COMPETENCE_CONNECTOR)))
        .orderBy(threads.id)
        .for('update');
      await removeCards(cards.map(c => c.id));
      // The occurrences the scan keeps for them, a type and its dates in each key and period, card or none.
      await tx
        .delete(schema.workOccurrences)
        .where(
          and(
            eq(schema.workOccurrences.personId, personId),
            eq(schema.workOccurrences.connector, COMPETENCE_CONNECTOR),
          ),
        );
    },
  };
}
