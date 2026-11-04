import type { Proposal, Thread } from '@clew/contracts';
import type { AuditEntry, JobInput, ProposalRecord, ProposalStore, ProposalThread, ProposalTx } from '../model';

/** The proposal store in memory (D25): what the unit tests run on, held to Postgres by `tests/proposal-store-contract.ts`. */
export interface MemoryProposalStore extends ProposalStore { audit: AuditEntry[]; jobs: JobInput[] }
interface Row { personId: string; thread: Omit<Thread, 'proposals'>; proposals: ProposalRecord[] }
const toProposal = (p: ProposalRecord): Proposal => ({ id: p.id, threadId: p.threadId, status: p.status, start: p.start, end: p.end, participant: { ...p.participant }, eventRef: p.eventRef, undoUntil: p.undoUntil });
export function memoryProposalStore(): MemoryProposalStore {
  let rows = new Map<string, Row>();
  let audit: AuditEntry[] = [];
  let jobs: JobInput[] = [];
  let sequence = 0;
  const copy = <T>(value: T): T => structuredClone(value);
  const view = (row: Row): ProposalThread => copy({ thread: { ...row.thread, proposals: row.proposals.filter(p => p.status !== 'superseded').map(toProposal) }, proposals: row.proposals });
  const tx: ProposalTx = {
    async insertThread(t) {
      if ([...rows.values()].some(r => r.personId === t.personId && r.thread.topic === t.topic && r.thread.state === 'open' && r.thread.kind === 'pushed')) return false;
      rows.set(t.id, { personId: t.personId, proposals: [], thread: { id: t.id, kind: 'pushed', topic: t.topic, title: t.title, state: 'open', trigger: copy(t.trigger), week: t.week, connector: 'calendar', area: t.area,
        summary: t.summary, items: [], actions: [], waitingOn: null, deadline: null, receipt: null, createdAt: t.createdAt, updatedAt: t.updatedAt, handledAt: null, remindedAt: null, messages: [] } });
      return true;
    },
    async updateThread(id, patch) { const row = rows.get(id); if (row) row.thread = { ...row.thread, ...copy(patch) }; },
    async addMessage(threadId, message) {
      const row = rows.get(threadId);
      if (!row) throw new Error(`Thread ${threadId} does not exist.`);
      row.thread.messages.push({ id: `message-${++sequence}`, role: message.role, body: message.body, createdAt: message.at });
      row.thread.updatedAt = message.at;
    },
    async insertProposals(records) { for (const p of records) { const row = rows.get(p.threadId); if (!row) throw new Error(`Thread ${p.threadId} does not exist.`); row.proposals.push(copy(p)); } },
    async updateProposals(ids, patch) { for (const row of rows.values()) row.proposals = row.proposals.map(p => ids.includes(p.id) ? { ...p, ...copy(patch) } : p); },
    async transition(threadId, from, patch) {
      const row = rows.get(threadId);
      if (!row) return [];
      const changed = row.proposals.filter(p => p.status === from).map(p => p.id);
      row.proposals = row.proposals.map(p => p.status === from ? { ...p, ...copy(patch) } : p);
      return changed;
    },
    async writeAudit(entry) { audit.push(copy(entry)); },
    async scheduleJob(job) { if (!jobs.some(j => j.id === job.id)) jobs.push(copy(job)); },
  };
  return {
    get audit() { return audit; },
    get jobs() { return jobs; },
    async readThread(personId, id) { const row = rows.get(id); return row && row.personId === personId ? view(row) : undefined; },
    async readThreadById(id) { const row = rows.get(id); return row ? view(row) : undefined; },
    async openThread(personId, topic) { const row = [...rows.values()].find(r => r.personId === personId && r.thread.topic === topic && r.thread.state === 'open'); return row ? view(row) : undefined; },
    async activeProposals(personId) { return copy([...rows.values()].filter(r => r.personId === personId).flatMap(r => r.proposals.filter(p => ['proposed', 'confirmed', 'final'].includes(p.status)))); },
    async transaction(fn) {
      const snapshot = { rows: copy(rows), audit: copy(audit), jobs: copy(jobs) };
      try { return await fn(tx); }
      catch (error) { rows = snapshot.rows; audit = snapshot.audit; jobs = snapshot.jobs; throw error; }
    },
  };
}
