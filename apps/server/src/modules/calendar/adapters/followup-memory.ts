import type { AuditEntry } from '../model';
import type { FollowupSnapshot, FollowupStore, FollowupTx } from '../usecases/followups';
import { reminderCard, returnedCard } from '../usecases/obligation';

/** A reminder card put in an invitee's stream: whose it is, and what it says. */
export type DeliveredReminder = ReturnType<typeof reminderCard> & { personId: string };
/**
 * Test adapter with the same atomic policy, delivery ordinal and audit boundary as PostgreSQL, held to it by
 * `tests/followup-contract.ts`: the manager's card takes what a return writes, and a reminder is the invitee's card,
 * once per proposal and ordinal, with its `thread.pushed` row.
 */
export function memoryFollowupStore(initial: FollowupSnapshot) {
  let value = structuredClone(initial),
    audits: AuditEntry[] = [],
    delivered: DeliveredReminder[] = [],
    tail = Promise.resolve();
  const store: FollowupStore = {
    async read(id) {
      return id === value.thread.id ? structuredClone(value) : undefined;
    },
    async transaction(fn) {
      const previous = tail;
      let release!: () => void;
      tail = new Promise<void>(r => {
        release = r;
      });
      await previous;
      const next = structuredClone(value),
        a = structuredClone(audits),
        d = structuredClone(delivered);
      const tx: FollowupTx = {
        async load(id) {
          return id === next.thread.id ? structuredClone(next) : undefined;
        },
        async save(p) {
          next.policy = structuredClone(p);
        },
        async schedule(_p, dueAt) {
          next.timer = { generation: (next.timer?.generation ?? 0) + 1, state: 'active', dueAt };
        },
        async stop() {
          // As the timer store cancels: only a timer that may still fire.
          if (next.timer && ['active', 'blocked'].includes(next.timer.state)) next.timer.state = 'cancelled';
        },
        async deliver(personId, p, ordinal, sender, at) {
          const card = reminderCard(p.id, ordinal, sender, at);
          if (d.some(x => x.id === card.id)) return;
          d.push({ ...card, personId });
          a.push({
            actor: 'assistant:obligation',
            action: 'thread.pushed',
            subject: `thread:${card.id}`,
            at,
            details: { proposal: p.id, ordinal, owner: personId },
          });
        },
        async recordReminder(p, at) {
          const found = next.proposals.find(x => x.id === p.id);
          if (found?.reminders === p.reminders) {
            found.reminders++;
            found.remindedAt = at;
          }
        },
        async returnThread(_id, at, reason) {
          Object.assign(next.thread, returnedCard(reason, at));
        },
        async audit(e) {
          a.push(structuredClone(e));
        },
      };
      try {
        const result = await fn(tx);
        value = next;
        audits = a;
        delivered = d;
        return result;
      } finally {
        release();
      }
    },
  };
  return Object.assign(store, { audits: () => structuredClone(audits), deliveries: () => structuredClone(delivered) });
}
