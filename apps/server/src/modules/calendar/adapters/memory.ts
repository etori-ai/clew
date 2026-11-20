import type { Proposal, Thread } from '@clew/contracts';
import type {
  AuditEntry,
  InvitationNotice,
  InvitationsTx,
  JobInput,
  ObligationTimers,
  ProposalRecord,
  ProposalStore,
  ProposalThread,
  ProposalTx,
} from '../model';

/** The proposal store in memory (D25): what the unit tests run on, held to Postgres by `tests/proposal-store-contract.ts`. */
export interface MemoryProposalStore extends ProposalStore {
  audit: AuditEntry[];
  jobs: JobInput[];
  /** What the talks domain was told of invitations (D132 item 3), in order; a rollback takes it back with the rest. */
  invitations: InvitationCall[];
}
export type InvitationCall =
  ({ op: 'established' } & InvitationNotice) | ({ op: 'ended' } & Parameters<InvitationsTx['ended']>[0]);
interface Row {
  personId: string;
  thread: Omit<Thread, 'proposals'>;
  proposals: ProposalRecord[];
}
const toProposal = (p: ProposalRecord): Proposal => ({
  id: p.id,
  threadId: p.threadId,
  status: p.status,
  start: p.start,
  end: p.end,
  participant: { email: p.participant.email, name: p.participant.name },
  eventRef: p.eventRef,
  undoUntil: p.undoUntil,
  reminders: p.reminders,
  remindedAt: p.remindedAt,
});
/**
 * `invitations` is the port the store tells, as `postgresProposalStore`'s option is: a test that runs the talks module
 * beside the calendar passes the talks module's. Every call is recorded in `invitations` either way.
 */
export function memoryProposalStore(options: { invitations?: InvitationsTx } = {}): MemoryProposalStore {
  let rows = new Map<string, Row>();
  let audit: AuditEntry[] = [];
  let jobs: JobInput[] = [];
  let invitations: InvitationCall[] = [];
  let sequence = 0;
  let transactions = Promise.resolve();
  const copy = <T>(value: T): T => structuredClone(value);
  const view = (row: Row): ProposalThread =>
    copy({
      thread: { ...row.thread, proposals: row.proposals.filter(p => p.status !== 'superseded').map(toProposal) },
      proposals: row.proposals,
    });
  const tx: ProposalTx = {
    async lockThread(personId, id) {
      const row = rows.get(id);
      return row?.personId === personId ? view(row) : undefined;
    },
    async insertThread(t) {
      if (
        rows.has(t.id) ||
        [...rows.values()].some(
          r =>
            r.personId === t.personId &&
            r.thread.topic === t.topic &&
            r.thread.state === 'open' &&
            r.thread.kind === 'pushed',
        )
      )
        return false;
      rows.set(t.id, {
        personId: t.personId,
        proposals: [],
        thread: {
          id: t.id,
          kind: 'pushed',
          topic: t.topic,
          title: t.title,
          state: 'open',
          trigger: copy(t.trigger),
          week: t.week,
          connector: 'calendar',
          area: t.area,
          summary: t.summary,
          items: [],
          actions: [],
          waitingOn: null,
          deadline: null,
          receipt: null,
          createdAt: t.createdAt,
          updatedAt: t.updatedAt,
          handledAt: null,
          remindedAt: null,
          snoozedUntil: null,
          messages: [],
        },
      });
      return true;
    },
    async updateThread(id, patch) {
      const row = rows.get(id);
      if (row) row.thread = { ...row.thread, ...copy(patch) };
    },
    async addMessage(threadId, message) {
      const row = rows.get(threadId);
      if (!row) throw new Error(`Thread ${threadId} does not exist.`);
      row.thread.messages.push({
        id: `message-${++sequence}`,
        role: message.role,
        body: message.body,
        createdAt: message.at,
      });
      row.thread.updatedAt = message.at;
    },
    async insertProposals(records) {
      for (const p of records) {
        const row = rows.get(p.threadId);
        if (!row) throw new Error(`Thread ${p.threadId} does not exist.`);
        row.proposals.push(copy(p));
      }
    },
    async updateProposals(ids, patch) {
      for (const row of rows.values())
        row.proposals = row.proposals.map(p => (ids.includes(p.id) ? { ...p, ...copy(patch) } : p));
    },
    async transition(threadId, from, patch) {
      const row = rows.get(threadId);
      if (!row) return [];
      const changed = row.proposals.filter(p => p.status === from).map(p => p.id);
      row.proposals = row.proposals.map(p => (p.status === from ? { ...p, ...copy(patch) } : p));
      return changed;
    },
    async writeAudit(entry) {
      audit.push(copy(entry));
    },
    async scheduleJob(job) {
      if (!jobs.some(j => j.id === job.id)) jobs.push(copy(job));
    },
    invitations: {
      async established(invitation) {
        invitations.push({ op: 'established', ...copy(invitation) });
        await options.invitations?.established(invitation);
      },
      async ended(end) {
        invitations.push({ op: 'ended', ...copy(end) });
        await options.invitations?.ended(end);
      },
    },
  };
  return {
    get audit() {
      return audit;
    },
    get invitations() {
      return invitations;
    },
    get jobs() {
      return jobs;
    },
    async readThread(personId, id) {
      const row = rows.get(id);
      return row && row.personId === personId ? view(row) : undefined;
    },
    async readThreadById(id) {
      const row = rows.get(id);
      return row ? view(row) : undefined;
    },
    async latestThread(personId, topic) {
      const row = [...rows.values()]
        .filter(r => r.personId === personId && r.thread.topic === topic)
        .sort((a, b) => b.thread.createdAt.localeCompare(a.thread.createdAt))[0];
      return row ? view(row) : undefined;
    },
    async openThread(personId, topic) {
      const row = [...rows.values()].find(
        r => r.personId === personId && r.thread.topic === topic && r.thread.state === 'open',
      );
      return row ? view(row) : undefined;
    },
    async activeProposals(personId) {
      return copy(
        [...rows.values()]
          .filter(r => r.personId === personId)
          .flatMap(r => r.proposals.filter(p => ['proposed', 'confirmed', 'final', 'accepted'].includes(p.status))),
      );
    },
    async bookedProposals(participantIds) {
      const wanted = new Set(participantIds);
      return copy(
        [...rows.values()].flatMap(r =>
          r.proposals.filter(
            p => wanted.has(p.participant.personId) && ['confirmed', 'final', 'accepted'].includes(p.status),
          ),
        ),
      );
    },
    async transaction(fn) {
      const previous = transactions;
      let release!: () => void;
      transactions = new Promise<void>(resolve => {
        release = resolve;
      });
      await previous;
      const snapshot = { rows: copy(rows), audit: copy(audit), jobs: copy(jobs), invitations: copy(invitations) };
      try {
        return await fn(tx);
      } catch (error) {
        rows = snapshot.rows;
        audit = snapshot.audit;
        jobs = snapshot.jobs;
        invitations = snapshot.invitations;
        throw error;
      } finally {
        release();
      }
    },
  };
}

/** The obligation timers that only remember what was asked of them (D30). */
export function memoryObligations(): ObligationTimers & {
  started: Array<{ threadId: string; personId: string }>;
  cancelled: string[];
} {
  const started: Array<{ threadId: string; personId: string }> = [],
    cancelled: string[] = [];
  return {
    started,
    cancelled,
    async start(input) {
      started.push(input);
    },
    async cancel(threadId) {
      cancelled.push(threadId);
    },
  };
}
