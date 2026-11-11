import type {
  CommitmentRecord,
  Erased,
  PersonRef,
  RoundRecord,
  TalkAudit,
  TalkRecord,
  TalkStore,
  TalkTx,
  WorkItemTx,
} from '../model';

/**
 * The talks store in memory: the unit tests' adapter (D25), held to Postgres by `tests/talk-store-contract.ts`. State
 * is plain and seedable; a transaction is a snapshot that a throw restores, the audit rows and the cards included.
 * Transactions run one at a time, as row locks would make them.
 *
 * The owner's cards (`WorkItemTx`) are recorded here instead of written to a stream: every call in `state.calls`, each
 * card's state in `state.cards`. A test makes the card sink throw with `sink.throwOn` and decides what `fire` answers
 * with `sink.fires`.
 */
export type WorkItemCall =
  | ({ op: 'open' } & Parameters<WorkItemTx['open']>[0])
  | { op: 'close'; threadId: string; at: string }
  | { op: 'reopen'; threadId: string; dueOn: string; at: string }
  | { op: 'fire'; threadId: string; generation: number; at: string; fired: boolean }
  | { op: 'remove'; threadIds: string[] };
export interface MemoryCard {
  personId: string;
  commitmentId: string;
  dueOn: string;
  state: 'open' | 'handled';
}
export interface MemoryTalkState {
  rounds: Map<string, RoundRecord>;
  talks: Map<string, TalkRecord>;
  commitments: Map<string, CommitmentRecord>;
  persons: Map<string, PersonRef>;
  audit: TalkAudit[];
  cards: Map<string, MemoryCard>;
  calls: WorkItemCall[];
}
export interface MemoryCardSink {
  /** The card call that throws, as a failing thread store would. */
  throwOn?: WorkItemCall['op'];
  /** What `fire` answers: true when the timer is still active at that generation. Default true for an open card. */
  fires?: boolean | ((threadId: string, generation: number) => boolean);
}
const byCreated = <T extends { createdAt: string; id: string }>(rows: T[]) =>
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));

export function memoryTalkStore(seed: { persons?: PersonRef[] } = {}) {
  let state: MemoryTalkState = {
    rounds: new Map(),
    talks: new Map(),
    commitments: new Map(),
    persons: new Map((seed.persons ?? []).map(p => [p.id, { ...p }])),
    audit: [],
    cards: new Map(),
    calls: [],
  };
  const sink: MemoryCardSink = {};
  let tail = Promise.resolve();
  const serialized = async <T>(fn: () => Promise<T>): Promise<T> => {
    const previous = tail;
    let release!: () => void;
    tail = new Promise<void>(resolve => {
      release = resolve;
    });
    await previous;
    try {
      return await fn();
    } finally {
      release();
    }
  };
  const fail = (op: WorkItemCall['op']) => {
    if (sink.throwOn === op) throw new Error(`card sink failed on ${op}`);
  };
  const workItems: WorkItemTx = {
    async open(input) {
      fail('open');
      state.calls.push({ op: 'open', ...input });
      state.cards.set(input.threadId, {
        personId: input.personId,
        commitmentId: input.commitmentId,
        dueOn: input.dueOn,
        state: 'open',
      });
    },
    async close(threadId, at) {
      fail('close');
      state.calls.push({ op: 'close', threadId, at });
      const card = state.cards.get(threadId);
      if (card) card.state = 'handled';
    },
    async reopen(threadId, dueOn, at) {
      fail('reopen');
      state.calls.push({ op: 'reopen', threadId, dueOn, at });
      const card = state.cards.get(threadId);
      if (card) Object.assign(card, { state: 'open', dueOn });
    },
    async fire(threadId, generation, at) {
      fail('fire');
      const card = state.cards.get(threadId);
      const answer = typeof sink.fires === 'function' ? sink.fires(threadId, generation) : (sink.fires ?? true);
      const fired = !!card && answer;
      if (fired) card!.state = 'open';
      state.calls.push({ op: 'fire', threadId, generation, at, fired });
      return fired;
    },
    async remove(threadIds) {
      fail('remove');
      state.calls.push({ op: 'remove', threadIds: [...threadIds] });
      for (const id of threadIds) state.cards.delete(id);
      // The thread's foreign key nulls the pointer, as `ON DELETE SET NULL` does in Postgres.
      for (const c of state.commitments.values()) if (c.threadId && threadIds.includes(c.threadId)) c.threadId = null;
    },
  };
  const shows = (c: CommitmentRecord, roundId: string | null) => c.doneAt === null || c.roundId === roundId;
  const tx: TalkTx = {
    async currentRound(organisationId, kind = 'development') {
      const r = [...state.rounds.values()].find(
        r => r.organisationId === organisationId && r.kind === kind && r.closedAt === null,
      );
      return r && { ...r };
    },
    async insertRound(round) {
      if (state.rounds.has(round.id)) throw new Error('duplicate round id');
      if (
        round.closedAt === null &&
        [...state.rounds.values()].some(
          r => r.organisationId === round.organisationId && r.kind === round.kind && r.closedAt === null,
        )
      )
        throw Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
          constraint_name: 'talk_round_open',
        });
      state.rounds.set(round.id, { ...round });
    },
    async closeRound(id, at) {
      const r = state.rounds.get(id);
      if (r) r.closedAt = at;
    },
    async talks(roundId, employeeIds) {
      return byCreated(
        [...state.talks.values()].filter(t => t.roundId === roundId && employeeIds.includes(t.employeeId)),
      ).map(t => ({ ...t }));
    },
    async talk(roundId, employeeId) {
      const t = [...state.talks.values()].find(t => t.roundId === roundId && t.employeeId === employeeId);
      return t && { ...t };
    },
    async saveTalk(talk) {
      if (!state.rounds.has(talk.roundId)) throw new Error('talk references an unknown round');
      const existing = [...state.talks.values()].find(
        t => t.roundId === talk.roundId && t.employeeId === talk.employeeId,
      );
      if (existing) Object.assign(existing, { heldOn: talk.heldOn, heldBy: talk.heldBy, updatedAt: talk.updatedAt });
      else state.talks.set(talk.id, { ...talk });
    },
    async commitmentsAbout(employeeIds, roundId) {
      return byCreated(
        [...state.commitments.values()].filter(c => employeeIds.includes(c.employeeId) && shows(c, roundId)),
      ).map(c => ({ ...c }));
    },
    async commitmentsOwnedBy(ownerId, roundId) {
      return byCreated([...state.commitments.values()].filter(c => c.ownerId === ownerId && shows(c, roundId))).map(
        c => ({ ...c }),
      );
    },
    async openCounts(employeeIds) {
      const counts = new Map<string, number>();
      for (const c of state.commitments.values())
        if (c.doneAt === null && employeeIds.includes(c.employeeId))
          counts.set(c.employeeId, (counts.get(c.employeeId) ?? 0) + 1);
      return counts;
    },
    async commitment(id) {
      const c = state.commitments.get(id);
      return c && { ...c };
    },
    async commitmentByThread(threadId) {
      const c = [...state.commitments.values()].find(c => c.threadId === threadId);
      return c && { ...c };
    },
    async insertCommitment(commitment) {
      if (state.commitments.has(commitment.id)) throw new Error('duplicate commitment id');
      if (!state.rounds.has(commitment.roundId)) throw new Error('commitment references an unknown round');
      // The row refers to its card, as the foreign key on `thread_id` makes it in Postgres.
      if (commitment.threadId && !state.cards.has(commitment.threadId))
        throw new Error('commitment references an unknown card');
      state.commitments.set(commitment.id, { ...commitment });
    },
    async updateCommitment(id, patch) {
      const c = state.commitments.get(id);
      if (!c) return;
      if ('doneAt' in patch) c.doneAt = patch.doneAt ?? null;
      if ('doneBy' in patch) c.doneBy = patch.doneBy ?? null;
    },
    async persons(ids) {
      return ids.flatMap(id => (state.persons.has(id) ? [{ ...state.persons.get(id)! }] : []));
    },
    async erasePerson(personId) {
      const threadIds = new Set<string>();
      let talks = 0,
        commitments = 0;
      const cleared = new Set<string>();
      for (const [id, t] of [...state.talks])
        if (t.employeeId === personId) {
          state.talks.delete(id);
          talks++;
        } else if (t.heldBy === personId) {
          t.heldBy = null;
          cleared.add('talk:' + id);
        }
      for (const [id, c] of [...state.commitments]) {
        if (c.employeeId === personId) {
          if (c.threadId) threadIds.add(c.threadId);
          state.commitments.delete(id);
          commitments++;
          continue;
        }
        if (c.ownerId === personId) {
          if (c.threadId) threadIds.add(c.threadId);
          c.ownerId = null;
          c.threadId = null;
          cleared.add('commitment:' + id);
        }
        if (c.createdBy === personId) {
          c.createdBy = null;
          cleared.add('commitment:' + id);
        }
        if (c.doneBy === personId) {
          c.doneBy = null;
          cleared.add('commitment:' + id);
        }
      }
      const erased: Erased = { talks, commitments, cleared: cleared.size, threadIds: [...threadIds].sort() };
      return erased;
    },
    async exportOrganisation(organisationId) {
      const rounds = byCreated([...state.rounds.values()].filter(r => r.organisationId === organisationId));
      const ids = new Set(rounds.map(r => r.id));
      return structuredClone({
        rounds,
        talks: byCreated([...state.talks.values()].filter(t => ids.has(t.roundId))),
        commitments: byCreated([...state.commitments.values()].filter(c => ids.has(c.roundId))),
      });
    },
    async audit(entry) {
      state.audit.push(structuredClone(entry));
    },
    workItems,
  };
  const transaction: TalkStore['transaction'] = fn =>
    serialized(async () => {
      const before = structuredClone(state);
      try {
        return await fn(tx);
      } catch (error) {
        state = before;
        throw error;
      }
    });
  return {
    transaction,
    sink,
    /** The current state; replaced (not mutated) when a transaction rolls back, so read it after the call. */
    get state() {
      return state;
    },
    /** A person the domain can name, as provisioning would have written them. */
    addPerson(person: PersonRef) {
      state.persons.set(person.id, { ...person });
    },
    audit: () => structuredClone(state.audit),
    calls: () => structuredClone(state.calls),
  };
}
export type MemoryTalkStore = ReturnType<typeof memoryTalkStore>;
