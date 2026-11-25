import type { Execution } from '../../modules/executions/model';
import type { InvitationsTx, ProposalPatch, ProposalRecord } from '../../modules/calendar/model';
import { BOOKED } from '../../modules/calendar/usecases/booked';
import type { FollowupPolicy } from '../../modules/calendar/usecases/followups';
import type { InvitationElsewhere, ProjectionJob, ProjectionStage, ProjectionTx } from '../projection-model';
import { projectOntoCard } from '../usecases/projection';
import type { MemoryThreadStore } from './memory';

/** A proposal as the memory twin holds it: the record, and the approved execution that last took it (M1). */
export interface MemoryProposal extends ProposalRecord {
  executionId: string | null;
}
/** What the talks domain was told, in order, when no talks port is bound. */
export type InvitationCall = {
  [K in keyof InvitationsTx]: { kind: K; notice: Parameters<InvitationsTx[K]>[0] };
}[keyof InvitationsTx];
export interface MemoryProjectionDeps {
  /** Where an execution stands now: the ledger's `read`, for another manager's invitation on its way (M1). */
  execution?: (id: string) => Promise<Pick<Execution, 'state' | 'reason' | 'expiresAt'> | undefined>;
}
const instant = (at: string) => new Date(at).toISOString();
const normalized = (patch: ProposalPatch): ProposalPatch =>
  Object.fromEntries(
    Object.entries(patch).map(([key, value]) => [
      key,
      ['start', 'end', 'confirmedAt', 'undoUntil', 'remindedAt'].includes(key) && typeof value === 'string'
        ? instant(value)
        : value,
    ]),
  );
const record = ({ executionId: _, ...p }: MemoryProposal): ProposalRecord => structuredClone(p);

/**
 * The projection's port in memory (D25), the unit tests' twin of `projection-postgres.ts`, held to it by
 * `tests/projection-contract.ts`. The card, its obligation timer, the workflow starts and the audit rows go through the
 * memory thread store's own transaction; the proposals, the follow-up policies, the job rows and what the talks domain
 * was told are held here. `transaction` is the hook `memoryExecutionStore({ projection })` takes: one ledger
 * transaction runs inside one thread store transaction and a snapshot of these rows, so a throw anywhere in it rolls
 * back the execution, the card and the rows together, as the one Postgres transaction does. The job rows' workflow
 * starts are the engine's (D86) and are not recorded here.
 */
export function memoryProjection(threads: MemoryThreadStore, deps: MemoryProjectionDeps = {}) {
  let proposals = new Map<string, MemoryProposal>(),
    policies = new Map<string, FollowupPolicy>(),
    jobs = new Map<string, ProjectionJob>(),
    told: InvitationCall[] = [];
  const port = (
    cards: ProjectionTx['cards'],
    p: Map<string, MemoryProposal>,
    f: Map<string, FollowupPolicy>,
    j: Map<string, ProjectionJob>,
    t: InvitationCall[],
  ): ProjectionTx => ({
    cards,
    proposals: {
      async lockProposal(personId, proposalId, threadId) {
        const x = p.get(proposalId);
        return x && x.personId === personId && (threadId === undefined || x.threadId === threadId)
          ? record(x)
          : undefined;
      },
      async lockBooked(personId, eventRef) {
        const x = [...p.values()].find(
          r => r.personId === personId && r.eventRef === eventRef && BOOKED.includes(r.status),
        );
        return x && record(x);
      },
      async updateProposal(personId, proposalId, patch) {
        const x = p.get(proposalId);
        if (!x || x.personId !== personId) return false;
        Object.assign(x, structuredClone(normalized(patch)));
        return true;
      },
      async lockInvitees(personId, invitees) {
        const found: InvitationElsewhere[] = [];
        for (const x of p.values()) {
          if (!invitees.includes(x.participant.personId) || x.personId === personId || x.status !== 'proposed')
            continue;
          const e = x.executionId ? await deps.execution?.(x.executionId) : undefined;
          if (e && ['pending', 'running', 'unknown'].includes(e.state))
            found.push({
              personId: x.participant.personId,
              start: x.start,
              state: e.state,
              reason: e.reason,
              expiresAt: e.expiresAt,
            });
        }
        return found;
      },
      async takeProposals(proposalIds, executionId) {
        for (const id of proposalIds) {
          const x = p.get(id);
          if (x) x.executionId = executionId;
        }
      },
      async policy(threadId) {
        return structuredClone(f.get(threadId));
      },
      async savePolicy(policy) {
        f.set(policy.threadId, structuredClone({ ...policy, expiresAt: instant(policy.expiresAt) }));
      },
    },
    async insertJob(job) {
      if (j.has(job.id)) return false;
      j.set(job.id, structuredClone({ ...job, runAt: instant(job.runAt) }));
      return true;
    },
    invitations: {
      established: async notice => void t.push({ kind: 'established', notice: structuredClone(notice) }),
      observed: async notice => void t.push({ kind: 'observed', notice: structuredClone(notice) }),
      moved: async notice => void t.push({ kind: 'moved', notice: structuredClone(notice) }),
      ended: async notice => void t.push({ kind: 'ended', notice: structuredClone(notice) }),
    },
  });
  return {
    /** Run one ledger transaction inside the projection's own; `project` is what the ledger calls on insert and update. */
    transaction<T>(fn: (project: (e: Execution, stage: ProjectionStage) => Promise<void>) => Promise<T>): Promise<T> {
      return threads.transaction(async cards => {
        const p = structuredClone(proposals),
          f = structuredClone(policies),
          j = structuredClone(jobs),
          t = structuredClone(told);
        const result = await fn((e, stage) => projectOntoCard(port(cards, p, f, j, t), e, stage));
        proposals = p;
        policies = f;
        jobs = j;
        told = t;
        return result;
      });
    },
    /** A proposal as the calendar module stored it, for a test to start from. */
    seedProposal(proposal: ProposalRecord, executionId: string | null = null) {
      const { start, end, confirmedAt, undoUntil, remindedAt } = proposal;
      proposals.set(proposal.id, {
        ...structuredClone(proposal),
        start: instant(start),
        end: instant(end),
        confirmedAt: confirmedAt && instant(confirmedAt),
        undoUntil: undoUntil && instant(undoUntil),
        remindedAt: remindedAt && instant(remindedAt),
        executionId,
      });
    },
    proposal: (id: string) => structuredClone(proposals.get(id)),
    policy: (threadId: string) => structuredClone(policies.get(threadId)),
    jobs: () => structuredClone([...jobs.values()]),
    told: () => structuredClone(told),
  };
}
export type MemoryProjection = ReturnType<typeof memoryProjection>;
