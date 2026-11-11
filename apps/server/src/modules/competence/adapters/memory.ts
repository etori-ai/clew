import { TypeNameTaken } from '../model';
import type {
  CompetenceAudit,
  CompetenceStore,
  CompetenceTx,
  Erased,
  HoldingRecord,
  PersonRef,
  TypeRecord,
} from '../model';

/**
 * The competence store in memory: the unit tests' adapter (D25), held to Postgres by
 * `tests/competence-store-contract.ts`. State is plain and seedable; a transaction is a snapshot that a throw restores,
 * the audit rows included. Transactions run one at a time, as row locks would make them.
 */
export interface MemoryCompetenceState {
  types: Map<string, TypeRecord>;
  holdings: Map<string, HoldingRecord>;
  persons: Map<string, PersonRef>;
  audit: CompetenceAudit[];
}
const byCreated = <T extends { createdAt: string; id: string }>(rows: T[]) =>
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
const sv = (a: string, b: string) => a.localeCompare(b, 'sv');

export function memoryCompetenceStore(seed: { persons?: PersonRef[] } = {}) {
  let state: MemoryCompetenceState = {
    types: new Map(),
    holdings: new Map(),
    persons: new Map((seed.persons ?? []).map(p => [p.id, { ...p }])),
    audit: [],
  };
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
  /** The unique index `competence_type_name`: one name per organisation among the types that are not archived. */
  const assertNameFree = (candidate: Pick<TypeRecord, 'id' | 'organisationId' | 'name' | 'archivedAt'>) => {
    if (candidate.archivedAt !== null) return;
    const taken = [...state.types.values()].some(
      t =>
        t.id !== candidate.id &&
        t.organisationId === candidate.organisationId &&
        t.archivedAt === null &&
        t.name.toLowerCase() === candidate.name.toLowerCase(),
    );
    if (taken) throw new TypeNameTaken();
  };
  const tx: CompetenceTx = {
    async types(organisationId, options = {}) {
      return [...state.types.values()]
        .filter(t => t.organisationId === organisationId && (options.archived || t.archivedAt === null))
        .sort((a, b) => sv(a.area, b.area) || sv(a.name, b.name) || a.id.localeCompare(b.id))
        .map(t => ({ ...t }));
    },
    async type(id) {
      const t = state.types.get(id);
      return t && { ...t };
    },
    async typesById(ids) {
      return ids.flatMap(id => (state.types.has(id) ? [{ ...state.types.get(id)! }] : []));
    },
    async insertType(type) {
      if (state.types.has(type.id)) throw new Error('duplicate type id');
      assertNameFree(type);
      state.types.set(type.id, { ...type });
    },
    async updateType(id, patch) {
      const t = state.types.get(id);
      if (!t) return;
      const next = { ...t, ...patch };
      assertNameFree(next);
      state.types.set(id, next);
    },
    async holdingsOf(personIds) {
      return byCreated([...state.holdings.values()].filter(h => personIds.includes(h.personId))).map(h => ({ ...h }));
    },
    async holdingsOfType(typeId) {
      return byCreated([...state.holdings.values()].filter(h => h.typeId === typeId)).map(h => ({ ...h }));
    },
    async holding(id) {
      const h = state.holdings.get(id);
      return h && { ...h };
    },
    async insertHolding(holding) {
      if (state.holdings.has(holding.id)) throw new Error('duplicate holding id');
      // The row refers to its type and its person, as the foreign keys make it in Postgres.
      if (!state.types.has(holding.typeId)) throw new Error('holding references an unknown type');
      if (!state.persons.has(holding.personId)) throw new Error('holding references an unknown person');
      state.holdings.set(holding.id, { ...holding });
    },
    async updateHolding(id, patch) {
      const h = state.holdings.get(id);
      if (h) state.holdings.set(id, { ...h, ...patch });
    },
    async persons(ids) {
      return ids.flatMap(id => (state.persons.has(id) ? [{ ...state.persons.get(id)! }] : []));
    },
    async erasePerson(personId) {
      let holdings = 0;
      const cleared = new Set<string>();
      for (const [id, h] of [...state.holdings]) {
        if (h.personId === personId) {
          state.holdings.delete(id);
          holdings++;
          continue;
        }
        if (h.registeredBy === personId) {
          h.registeredBy = null;
          cleared.add(id);
        }
        if (h.revokedBy === personId) {
          h.revokedBy = null;
          cleared.add(id);
        }
      }
      const erased: Erased = { holdings, cleared: cleared.size };
      return erased;
    },
    async exportOrganisation(organisationId) {
      const types = byCreated([...state.types.values()].filter(t => t.organisationId === organisationId));
      const ids = new Set(types.map(t => t.id));
      return structuredClone({
        types,
        holdings: byCreated([...state.holdings.values()].filter(h => ids.has(h.typeId))),
      });
    },
    async audit(entry) {
      state.audit.push(structuredClone(entry));
    },
  };
  const transaction: CompetenceStore['transaction'] = fn =>
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
    /** The current state; replaced (not mutated) when a transaction rolls back, so read it after the call. */
    get state() {
      return state;
    },
    /** A person the domain can name, as provisioning would have written them. */
    addPerson(person: PersonRef) {
      state.persons.set(person.id, { ...person });
    },
    audit: () => structuredClone(state.audit),
  };
}
export type MemoryCompetenceStore = ReturnType<typeof memoryCompetenceStore>;
