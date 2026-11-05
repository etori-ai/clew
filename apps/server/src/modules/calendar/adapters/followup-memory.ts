import type { AuditEntry } from '../model';
import type { FollowupSnapshot, FollowupStore, FollowupTx } from '../usecases/followups';

/** Test adapter with the same atomic policy, delivery ordinal and audit boundary as PostgreSQL. */
export function memoryFollowupStore(initial: FollowupSnapshot) {
  let value = structuredClone(initial), audits: AuditEntry[] = [], delivered: string[] = [], tail = Promise.resolve();
  const store: FollowupStore = {
    async read(id) { return id === value.thread.id ? structuredClone(value) : undefined; },
    async transaction(fn) {
      const previous = tail; let release!: () => void; tail = new Promise<void>(r => { release = r; }); await previous;
      const next = structuredClone(value), a = structuredClone(audits), d = [...delivered];
      const tx: FollowupTx = {
        async load(id) { return id === next.thread.id ? structuredClone(next) : undefined; },
        async save(p) { next.policy = structuredClone(p); },
        async schedule(_p, dueAt) { next.timer = { generation: (next.timer?.generation ?? 0) + 1, state: 'active', dueAt }; },
        async stop() { if (next.timer) next.timer.state = 'cancelled'; },
        async deliver(personId, p, ordinal) { const id = `${personId}:${p.id}:${ordinal}`; if (!d.includes(id)) d.push(id); },
        async recordReminder(p, at) { const found = next.proposals.find(x => x.id === p.id); if (found?.reminders === p.reminders) { found.reminders++; found.remindedAt = at; } },
        async returnThread(_id, at, reason) { Object.assign(next.thread, { state: reason === 'answered' ? 'handled' : 'open', waitingOn: null, updatedAt: at }); },
        async audit(e) { a.push(structuredClone(e)); },
      };
      try { const result = await fn(tx); value = next; audits = a; delivered = d; return result; } finally { release(); }
    },
  };
  return Object.assign(store, { audits: () => structuredClone(audits), deliveries: () => [...delivered] });
}
