import { and, eq, inArray } from 'drizzle-orm';
import type { BoardingEvent, ThreadAction } from '@clew/contracts';
import { BOARDING_CONNECTOR } from '@clew/connectors';
import { schema, type Transaction } from '@clew/db';
import type { ThreadTx } from '../threads/model';
import { reminderStart } from '../threads/domain';
import { authorizationVersion } from '../auth-crypto';
import type { WorkItemTx } from '../modules/boarding/model';
import { dueTimerAt } from '../modules/boarding/domain';

/**
 * The owner's card of a plan's item (D124): the boarding module's `WorkItemTx`, implemented over the thread store's
 * transaction as `talk-work-items.ts` is for an action point. The card, its delivery, message, audit row and timer
 * (with its workflow start, D86) commit or roll back with the item they belong to, because the boarding transaction and
 * this one share one physical database transaction. Usage in composition:
 *
 *   transaction: fn =>
 *     withThreadTx(options, (tx, thread) =>
 *       fn(boardingTx(tx, { sealer, workItems: boardingWorkItems(tx, thread, { clock }) })),
 *     ),
 *
 * The card's title is the template title an administrator wrote, or for an item a manager typed a fixed sentence: the
 * typed text, a person's name and the plan's person are never in its title, summary, trigger or messages, since those
 * are what the assistant reads; the audit rows carry ids only. The plan's person is the card's own `subjects` (D97 item
 * 6), a key never drawn on the card. The card is `core` (the `boarding` connector) with no `sourceAuthorization`, so it
 * stays with its owner when they change unit, and it is opened for an owner who cannot sign in yet: it waits in their
 * stream. The timer records the owner's unit and authorisation version as every timer does (empty for someone without
 * a grant), but nothing blocks a `boarding` timer on them.
 */
export interface BoardingWorkItemOptions {
  /** Composition's clock: the instant written where the port gives none (erasure). */
  clock: () => Date;
}
const ACTOR = 'boarding:item';
const SOURCE = 'Introduktion och avslut';
/** The title of a card whose item a manager typed: the typed text is free text about a person's plan. */
const ADDED_TITLE: Record<BoardingEvent, string> = {
  introduction: 'En uppgift i en introduktion',
  leaving: 'En uppgift i ett avslut',
};
const STARTED: Record<BoardingEvent, string> = {
  introduction: 'En introduktion startades',
  leaving: 'Ett avslut startades',
};
const CONTEXT: Record<BoardingEvent, string> = {
  introduction: 'Uppgiften ingår i en introduktion',
  leaving: 'Uppgiften ingår i ett avslut',
};
/** The card's one action: the plan, read in the card (D111), for the owner as `boarding.plan` lets them see it. */
const actionFor = (planId: string): ThreadAction => ({
  id: 'plan',
  label: 'Visa planen',
  capability: BOARDING_CONNECTOR + '.plan',
  kind: 'read',
  role: 'primary',
  target: 'panel',
  input: { plan: planId },
});
export const boardingTimerId = (threadId: string) => `boarding:${threadId}`;
/** "12 mars" for a `YYYY-MM-DD` calendar day: the day is Swedish already, so it is formatted at noon UTC. */
const swedishDay = (day: string) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(
    new Date(day + 'T12:00:00Z'),
  );
const summaryFor = (event: BoardingEvent, dueOn: string) =>
  `${CONTEXT[event]} och ska vara klar senast ${swedishDay(dueOn)}.`;

export function boardingWorkItems(tx: Transaction, thread: ThreadTx, options: BoardingWorkItemOptions): WorkItemTx {
  /** The owner's unit and authorisation version as of this transaction; empty when they have no grant yet. */
  async function authority(personId: string) {
    const [access] = await tx
      .select({ person: schema.people, grant: schema.accessGrants })
      .from(schema.people)
      .innerJoin(schema.accessGrants, eq(schema.accessGrants.personId, schema.people.id))
      .where(eq(schema.people.id, personId));
    return access
      ? { unitId: access.grant.unitId, authorizationVersion: authorizationVersion(access) }
      : { unitId: '', authorizationVersion: '' };
  }
  /**
   * The card's timer for the morning after `dueOn` (`dueTimerAt`). None when that morning has passed: starting a plan
   * late, or opening an overdue item again, leaves the card open and overdue and fires no reminder, so a plan started
   * a week late does not send one notification per item at once, outside the attention budget. The caller holds the
   * thread lock (or has just inserted the thread). A replaced generation's wait is cancelled after commit.
   */
  async function schedule(threadId: string, personId: string, dueOn: string, at: string) {
    const dueAt = dueTimerAt(dueOn, at);
    if (!dueAt) return undefined;
    const timer = await thread.scheduleTimer({
      id: boardingTimerId(threadId),
      personId,
      threadId,
      kind: 'boarding',
      ...(await authority(personId)),
      dueAt,
      requestedAt: at,
    });
    await thread.enqueue(reminderStart(timer));
    return timer;
  }
  /** The card's row, locked for the rest of the transaction; undefined when it no longer exists. */
  async function lock(threadId: string) {
    const [row] = await tx.select().from(schema.threads).where(eq(schema.threads.id, threadId)).for('update');
    return row;
  }
  /** The person's own snooze and reminder end with the card's state: they would otherwise reopen it as "Du bad …". */
  async function endOwnTimers(threadId: string, at: string) {
    await thread.cancelTimer(`snooze:${threadId}`, at);
    await thread.cancelTimer(`reminder:${threadId}`, at);
  }
  return {
    async open({ threadId, personId, itemId, planId, event, title, dueOn, at, subject }) {
      const summary = summaryFor(event, dueOn);
      const inserted = await thread.insertThread({
        id: threadId,
        personId,
        kind: 'pushed',
        topic: `${BOARDING_CONNECTOR}:item:${itemId}`,
        title: title ?? ADDED_TITLE[event],
        state: 'open',
        week: null,
        connector: BOARDING_CONNECTOR,
        area: BOARDING_CONNECTOR,
        summary,
        items: [],
        // The plan's person, by key, on the thread and never on a row (D97 item 6).
        ...(subject ? { subjects: [subject] } : {}),
        actions: [actionFor(planId)],
        waitingOn: null,
        deadline: dueOn,
        trigger: { reason: title === null ? 'Lades till i planen' : STARTED[event], source: SOURCE, at },
        createdAt: at,
        updatedAt: at,
      });
      if (!inserted) throw new Error(`The boarding card ${threadId} already exists.`);
      await thread.admitDelivery({ id: `delivery:${threadId}`, personId, threadId, kind: 'automatic', at });
      await thread.addMessage(threadId, { role: 'assistant', body: summary, at });
      const timer = await schedule(threadId, personId, dueOn, at);
      await thread.writeAudit({
        actor: ACTOR,
        action: 'thread.pushed',
        subject: `thread:${threadId}`,
        at,
        details: {
          item: itemId,
          plan: planId,
          owner: personId,
          timer: timer?.id ?? null,
          generation: timer?.generation ?? null,
        },
      });
    },
    async close(threadId, at, why) {
      const card = await lock(threadId);
      if (!card) return;
      const cancelled = await thread.cancelTimer(boardingTimerId(threadId), at);
      await endOwnTimers(threadId, at);
      if (card.state === 'handled' && !cancelled) return;
      await thread.updateThread(threadId, {
        state: 'handled',
        handledAt: at,
        waitingOn: null,
        snoozedUntil: null,
        updatedAt: at,
      });
      await thread.addMessage(threadId, {
        role: 'assistant',
        body: why === 'done' ? 'Uppgiften är klar.' : 'Planen är avslutad.',
        at,
      });
      await thread.writeAudit({
        actor: ACTOR,
        action: 'thread.handled',
        subject: `thread:${threadId}`,
        at,
        details: { owner: card.personId, timer: boardingTimerId(threadId), cancelled, why },
      });
    },
    async reopen(threadId, dueOn, at) {
      const card = await lock(threadId);
      if (!card) return;
      const personId = card.personId;
      await thread.updateThread(threadId, {
        state: 'open',
        handledAt: null,
        snoozedUntil: null,
        deadline: dueOn,
        updatedAt: at,
      });
      await thread.addMessage(threadId, {
        role: 'assistant',
        body: `Uppgiften är öppen igen och ska vara klar senast ${swedishDay(dueOn)}.`,
        at,
      });
      const timer = await schedule(threadId, personId, dueOn, at);
      await thread.writeAudit({
        actor: ACTOR,
        action: 'thread.reopened',
        subject: `thread:${threadId}`,
        at,
        details: { owner: personId, timer: timer?.id ?? null, generation: timer?.generation ?? null },
      });
    },
    async fire(threadId, generation, at) {
      const card = await lock(threadId);
      if (!card) return false;
      const timer = await thread.readTimer(boardingTimerId(threadId));
      if (
        !timer ||
        timer.kind !== 'boarding' ||
        timer.generation !== generation ||
        timer.state !== 'active' ||
        Date.parse(timer.dueAt) > Date.parse(at)
      )
        return false;
      await thread.updateTimer({ ...timer, state: 'fired', reason: null, leaseUntil: null });
      if (card.snoozedUntil) await thread.cancelTimer(`snooze:${threadId}`, at);
      const day = card.deadline ? swedishDay(card.deadline) : undefined;
      await thread.updateThread(threadId, {
        state: 'open',
        handledAt: null,
        waitingOn: null,
        snoozedUntil: null,
        remindedAt: at,
        updatedAt: at,
        trigger: { reason: day ? `Skulle vara klar ${day}` : 'Förfallodagen har passerat', source: SOURCE, at },
      });
      await thread.addMessage(threadId, {
        role: 'assistant',
        body: day ? `Uppgiften skulle vara klar ${day}.` : 'Uppgiften skulle vara klar.',
        at,
      });
      await thread.admitDelivery({
        id: `boarding:${threadId}:${generation}`,
        personId: timer.personId,
        threadId,
        kind: 'reminder',
        at,
      });
      await thread.writeAudit({
        actor: ACTOR,
        action: 'timer.fired',
        subject: `timer:${timer.id}`,
        at,
        details: { generation, owner: timer.personId },
      });
      await thread.writeAudit({
        actor: ACTOR,
        action: 'thread.reminded',
        subject: `thread:${threadId}`,
        at,
        details: { reason: 'due', generation, wasState: card.state, owner: timer.personId },
      });
      return true;
    },
    async remove(threadIds) {
      if (!threadIds.length) return;
      const at = options.clock().toISOString();
      // Only the boarding module's own cards: an id of any other card is left alone.
      const cards = await tx
        .select({ id: schema.threads.id })
        .from(schema.threads)
        .where(and(inArray(schema.threads.id, [...threadIds]), eq(schema.threads.connector, BOARDING_CONNECTOR)))
        .orderBy(schema.threads.id)
        .for('update');
      if (!cards.length) return;
      const ids = cards.map(c => c.id);
      // Every running wait ends after the commit, as a replaced generation's does; the rows go with the thread.
      const timers = await tx
        .select({ id: schema.timerIntents.id })
        .from(schema.timerIntents)
        .where(inArray(schema.timerIntents.threadId, ids))
        .orderBy(schema.timerIntents.id)
        .for('update');
      for (const timer of timers) await thread.cancelTimer(timer.id, at);
      // Messages, proposals, timers, deliveries and follow-up policies cascade; an occurrence only loses its pointer, so it goes here.
      await tx.delete(schema.workOccurrences).where(inArray(schema.workOccurrences.threadId, ids));
      await tx.delete(schema.threads).where(inArray(schema.threads.id, ids));
      for (const id of ids)
        await thread.writeAudit({
          actor: ACTOR,
          action: 'thread.removed',
          subject: `thread:${id}`,
          at,
          details: { reason: 'erasure' },
        });
    },
  };
}
