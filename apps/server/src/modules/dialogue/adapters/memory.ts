import type {
  ActivityRecord,
  AreaRecord,
  AssessmentRecord,
  DialogueAudit,
  DialogueStore,
  DialogueTx,
  DialogueWorkItems,
  NoteRecord,
  QuestionRecord,
} from '../model';

/**
 * The dialogue store in memory: the unit tests' adapter (D25), held to Postgres by `tests/dialogue-store-contract.ts`.
 * State is plain and seedable; a transaction is a snapshot that a throw restores, the audit rows and the cards included.
 * Transactions run one at a time, as row locks would make them.
 *
 * The owner's cards are recorded here instead of written to a stream: every call in `state.calls`, each card's state in
 * `state.cards`. A test makes the card sink throw with `sink.throwOn` and decides what `fire` answers with `sink.fires`.
 */
export type DialogueCardCall =
  | ({ op: 'open' } & Parameters<DialogueWorkItems['open']>[0])
  | { op: 'close'; threadId: string; at: string }
  | { op: 'reopen'; threadId: string; dueOn: string | null; at: string }
  | { op: 'retime'; threadId: string; dueOn: string | null; at: string }
  | { op: 'fire'; threadId: string; generation: number; at: string; fired: boolean }
  | { op: 'remove'; threadIds: string[] };
export interface MemoryDialogueCard {
  personId: string;
  activityId: string;
  dueOn: string | null;
  state: 'open' | 'handled';
}
export interface MemoryDialogueState {
  areas: AreaRecord[];
  questions: QuestionRecord[];
  assessments: Map<string, AssessmentRecord>;
  activities: Map<string, ActivityRecord>;
  notes: Map<string, NoteRecord>;
  persons: Map<string, string>;
  units: Map<string, string>;
  audit: DialogueAudit[];
  cards: Map<string, MemoryDialogueCard>;
  calls: DialogueCardCall[];
}
export interface MemoryDialogueSink {
  throwOn?: DialogueCardCall['op'];
  fires?: boolean | ((threadId: string, generation: number) => boolean);
}
const byCreated = <T extends { createdAt: string; id: string }>(rows: T[]) =>
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
const newestFirst = (rows: AssessmentRecord[]) =>
  rows.sort((a, b) => b.at.localeCompare(a.at) || b.id.localeCompare(a.id));

export function memoryDialogueStore(seed: { persons?: Record<string, string>; units?: Record<string, string> } = {}) {
  let state: MemoryDialogueState = {
    areas: [],
    questions: [],
    assessments: new Map(),
    activities: new Map(),
    notes: new Map(),
    persons: new Map(Object.entries(seed.persons ?? {})),
    units: new Map(Object.entries(seed.units ?? {})),
    audit: [],
    cards: new Map(),
    calls: [],
  };
  const sink: MemoryDialogueSink = {};
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
  const fail = (op: DialogueCardCall['op']) => {
    if (sink.throwOn === op) throw new Error(`card sink failed on ${op}`);
  };
  const workItems: DialogueWorkItems = {
    async open(input) {
      fail('open');
      state.calls.push({ op: 'open', ...structuredClone(input) });
      state.cards.set(input.threadId, {
        personId: input.personId,
        activityId: input.activityId,
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
    async retime(threadId, dueOn, at) {
      fail('retime');
      state.calls.push({ op: 'retime', threadId, dueOn, at });
      const card = state.cards.get(threadId);
      if (card) card.dueOn = dueOn;
    },
    async fire(threadId, generation, at) {
      fail('fire');
      const card = state.cards.get(threadId);
      const answer = typeof sink.fires === 'function' ? sink.fires(threadId, generation) : (sink.fires ?? true);
      const fired = !!card && card.dueOn !== null && answer;
      if (fired) card!.state = 'open';
      state.calls.push({ op: 'fire', threadId, generation, at, fired });
      return fired;
    },
    async remove(threadIds) {
      fail('remove');
      if (!threadIds.length) return;
      state.calls.push({ op: 'remove', threadIds: [...threadIds] });
      for (const id of threadIds) state.cards.delete(id);
      // The thread's foreign key nulls the pointer, as `ON DELETE SET NULL` does in Postgres.
      for (const a of state.activities.values()) if (a.threadId && threadIds.includes(a.threadId)) a.threadId = null;
    },
  };
  const ofUnits =
    (organisationId: string, unitIds: readonly string[]) => (r: { organisationId: string; unitId: string }) =>
      r.organisationId === organisationId && unitIds.includes(r.unitId);
  const tx: DialogueTx = {
    async areas(organisationId) {
      return structuredClone(
        state.areas.filter(a => a.organisationId === organisationId).sort((a, b) => a.ordinal - b.ordinal),
      );
    },
    async questions(organisationId) {
      return structuredClone(
        state.questions
          .filter(q => q.organisationId === organisationId)
          .sort((a, b) => a.areaKey.localeCompare(b.areaKey) || a.ordinal - b.ordinal || a.id.localeCompare(b.id)),
      );
    },
    async replaceConfig(organisationId, areas, questions) {
      state.areas = [...state.areas.filter(a => a.organisationId !== organisationId), ...structuredClone(areas)];
      state.questions = [
        ...state.questions.filter(q => q.organisationId !== organisationId),
        ...structuredClone(questions),
      ];
    },
    async assessments(organisationId, unitIds) {
      return structuredClone(newestFirst([...state.assessments.values()].filter(ofUnits(organisationId, unitIds))));
    },
    async insertAssessment(a) {
      state.assessments.set(a.id, structuredClone(a));
    },
    async activities(organisationId, unitIds) {
      return structuredClone(byCreated([...state.activities.values()].filter(ofUnits(organisationId, unitIds))));
    },
    async openAreaKeys(organisationId) {
      return [
        ...new Set(
          [...state.activities.values()]
            .filter(a => a.organisationId === organisationId && a.doneAt === null)
            .map(a => a.areaKey),
        ),
      ].sort();
    },
    async activitiesOwnedBy(ownerId) {
      return structuredClone(
        byCreated([...state.activities.values()].filter(a => a.ownerId === ownerId && a.doneAt === null)),
      );
    },
    async activity(id) {
      const a = state.activities.get(id);
      return a ? structuredClone(a) : undefined;
    },
    async activityByThread(threadId) {
      const a = [...state.activities.values()].find(a => a.threadId === threadId);
      return a ? structuredClone(a) : undefined;
    },
    async insertActivity(a) {
      if (a.threadId && !state.cards.has(a.threadId)) throw new Error('The activity names a card that does not exist.');
      state.activities.set(a.id, structuredClone(a));
    },
    async updateActivity(id, patch) {
      const a = state.activities.get(id);
      if (a) Object.assign(a, structuredClone(patch));
    },
    async deleteActivity(id) {
      state.activities.delete(id);
    },
    async notes(organisationId, unitIds, authorId) {
      return structuredClone(
        [...state.notes.values()]
          .filter(n => n.authorId === authorId)
          .filter(ofUnits(organisationId, unitIds))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)),
      );
    },
    async note(id) {
      const n = state.notes.get(id);
      return n ? structuredClone(n) : undefined;
    },
    async insertNote(n) {
      state.notes.set(n.id, structuredClone(n));
    },
    async updateNote(id, patch) {
      const n = state.notes.get(id);
      if (n) Object.assign(n, structuredClone(patch));
    },
    async deleteNote(id) {
      state.notes.delete(id);
    },
    async names(ids) {
      return new Map(ids.flatMap(id => (state.persons.has(id) ? [[id, state.persons.get(id)!] as const] : [])));
    },
    async unitLabels(ids) {
      return new Map(ids.flatMap(id => (state.units.has(id) ? [[id, state.units.get(id)!] as const] : [])));
    },
    async erasePerson(personId) {
      const cleared = new Set<string>(),
        threadIds = new Set<string>();
      for (const a of state.activities.values()) {
        if (a.ownerId === personId) {
          if (a.threadId) threadIds.add(a.threadId);
          a.ownerId = null;
          a.threadId = null;
          cleared.add('activity:' + a.id);
        }
        if (a.createdBy === personId) {
          a.createdBy = null;
          cleared.add('activity:' + a.id);
        }
        if (a.doneBy === personId) {
          a.doneBy = null;
          cleared.add('activity:' + a.id);
        }
      }
      for (const a of state.assessments.values())
        if (a.authorId === personId) {
          a.authorId = null;
          cleared.add('assessment:' + a.id);
        }
      for (const n of [...state.notes.values()])
        if (n.authorId === personId) {
          state.notes.delete(n.id);
          cleared.add('note:' + n.id);
        }
      return { cleared: cleared.size, threadIds: [...threadIds].sort() };
    },
    async exportOrganisation(organisationId) {
      return {
        areas: await tx.areas(organisationId),
        questions: await tx.questions(organisationId),
        assessments: structuredClone(
          [...state.assessments.values()]
            .filter(a => a.organisationId === organisationId)
            .sort((a, b) => a.at.localeCompare(b.at) || a.id.localeCompare(b.id)),
        ),
        activities: structuredClone(
          byCreated([...state.activities.values()].filter(a => a.organisationId === organisationId)),
        ),
        notes: structuredClone(byCreated([...state.notes.values()].filter(n => n.organisationId === organisationId))),
      };
    },
    async audit(entry) {
      state.audit.push(structuredClone(entry));
    },
    workItems,
  };
  const transaction: DialogueStore['transaction'] = fn =>
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
    addPerson(id: string, name: string) {
      state.persons.set(id, name);
    },
    addUnit(id: string, label: string) {
      state.units.set(id, label);
    },
    audit: () => structuredClone(state.audit),
    calls: () => structuredClone(state.calls),
  };
}
export type MemoryDialogueStore = ReturnType<typeof memoryDialogueStore>;
