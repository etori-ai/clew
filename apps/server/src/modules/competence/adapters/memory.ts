import { COMPETENCE_CONNECTOR } from '@clew/connectors';
import { TypeNameTaken } from '../model';
import type {
  CompetenceAudit,
  CompetenceStore,
  CompetenceTx,
  Erased,
  HoldingRecord,
  PersonRef,
  SourceMapping,
  SourceRecord,
  TypeRecord,
  WorkflowStart,
} from '../model';

/**
 * The competence store in memory: the unit tests' adapter (D25), held to Postgres by
 * `tests/competence-store-contract.ts`. State is plain and seedable; a transaction is a snapshot that a throw restores,
 * the audit rows, the workflow starts and the cards included. Transactions run one at a time, as row locks would make
 * them. A person SCIM has deactivated (D68) stays in `persons` with `enabled` false, as in the people table.
 *
 * The cards of the people's streams (`CompetenceCardsTx`) stand in `state.cards` instead of a thread store, as much of
 * each as an erasure reads: whose stream it is in and which connector pushed it. An erasure removes the person's own
 * competence cards there and writes their `thread.removed` rows among the audit rows, as composition does over the
 * thread store's transaction.
 */
export interface MemoryCard {
  personId: string;
  connector: string;
}
export interface MemoryCompetenceState {
  types: Map<string, TypeRecord>;
  holdings: Map<string, HoldingRecord>;
  persons: Map<string, PersonRef>;
  /** By `<connector>\n<organisation>\n<source type>`. */
  mappings: Map<string, SourceMapping>;
  sources: Map<string, SourceRecord>;
  /** The cards in the people's own streams (D108 item 12), by card id. */
  cards: Map<string, MemoryCard>;
  audit: CompetenceAudit[];
  /** The workflow starts committed (D86), each id once. */
  enqueued: WorkflowStart[];
}
const byCreated = <T extends { createdAt: string; id: string }>(rows: T[]) =>
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
const sv = (a: string, b: string) => a.localeCompare(b, 'sv');
const mappingKey = (connectorId: string, organisationId: string, sourceType: string) =>
  connectorId + '\n' + organisationId + '\n' + sourceType;

export function memoryCompetenceStore(seed: { persons?: PersonRef[]; cards?: Record<string, MemoryCard> } = {}) {
  let state: MemoryCompetenceState = {
    types: new Map(),
    holdings: new Map(),
    persons: new Map((seed.persons ?? []).map(p => [p.id, { ...p }])),
    mappings: new Map(),
    sources: new Map(),
    cards: new Map(Object.entries(seed.cards ?? {}).map(([id, card]) => [id, { ...card }])),
    audit: [],
    enqueued: [],
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
  /** The foreign keys and checks Postgres holds a holding to. */
  const assertHolding = (holding: HoldingRecord) => {
    if (holding.typeId !== null && !state.types.has(holding.typeId))
      throw new Error('holding references an unknown type');
    if (!state.persons.has(holding.personId)) throw new Error('holding references an unknown person');
    if (holding.typeId === null && !holding.copy) throw new Error('only a copied holding may lack a type');
    if (holding.copy && !state.sources.has(holding.copy.connectorId))
      throw new Error("a copied holding refers to its source's row");
    if (holding.copy && (holding.evidence !== 'system' || holding.registeredBy !== null))
      throw new Error('a copied holding is attested by its system and registered by nobody');
    if (holding.expiresOn !== null && holding.expiresOn < holding.issuedOn)
      throw new Error('holding ends before it begins');
  };
  const copied = () => [...state.holdings.values()].filter(h => h.copy);
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
      return byCreated([...state.holdings.values()].filter(h => personIds.includes(h.personId))).map(h =>
        structuredClone(h),
      );
    },
    async holdingsOfType(typeId) {
      return byCreated([...state.holdings.values()].filter(h => h.typeId === typeId)).map(h => structuredClone(h));
    },
    async holding(id) {
      const h = state.holdings.get(id);
      return h && structuredClone(h);
    },
    async insertHolding(holding) {
      if (state.holdings.has(holding.id)) throw new Error('duplicate holding id');
      assertHolding(holding);
      state.holdings.set(holding.id, structuredClone(holding));
    },
    async updateHolding(id, patch) {
      const h = state.holdings.get(id);
      if (h) state.holdings.set(id, { ...h, ...patch });
    },
    async copiedFrom(connectorId) {
      return byCreated(copied().filter(h => h.copy!.connectorId === connectorId)).map(h => structuredClone(h));
    },
    async copiedPeople(connectorId) {
      return [
        ...new Set(
          copied()
            .filter(h => h.copy!.connectorId === connectorId)
            .map(h => h.personId),
        ),
      ];
    },
    async removeCopied(connectorId, holdingIds) {
      let n = 0;
      for (const id of holdingIds) {
        const h = state.holdings.get(id);
        if (h?.copy?.connectorId === connectorId) {
          state.holdings.delete(id);
          n++;
        }
      }
      return n;
    },
    async putCopied(rows) {
      for (const row of rows) {
        if (!row.copy) throw new Error('a copied row carries its source');
        assertHolding(row);
        const other = copied().find(
          h =>
            h.id !== row.id && h.copy!.connectorId === row.copy!.connectorId && h.copy!.sourceId === row.copy!.sourceId,
        );
        if (other) throw new Error('the source row is copied already');
        state.holdings.set(row.id, structuredClone(row));
      }
    },
    async touchCopied(connectorId, sourceIds, at) {
      const ids = new Set(sourceIds);
      for (const h of copied())
        if (h.copy!.connectorId === connectorId && ids.has(h.copy!.sourceId)) h.copy = { ...h.copy!, readAt: at };
    },
    async retypeCopied(connectorId, organisationId, sourceType, typeId) {
      if (typeId !== null && !state.types.has(typeId)) throw new Error('mapping references an unknown type');
      let n = 0;
      for (const h of copied())
        if (
          h.copy!.connectorId === connectorId &&
          h.copy!.sourceType === sourceType &&
          state.persons.get(h.personId)?.organisationId === organisationId
        ) {
          h.typeId = typeId;
          n++;
        }
      return n;
    },
    async sourceTypes(organisationId) {
      const counted = new Map<string, { connectorId: string; sourceType: string; label: string; holdings: number }>();
      const labelReadAt = new Map<string, string>();
      for (const h of copied()) {
        if (h.state === 'revoked' || state.persons.get(h.personId)?.enabled === false) continue;
        if (state.persons.get(h.personId)?.organisationId !== organisationId) continue;
        const key = h.copy!.connectorId + '\n' + h.copy!.sourceType;
        const row = counted.get(key) ?? {
          connectorId: h.copy!.connectorId,
          sourceType: h.copy!.sourceType,
          label: h.copy!.sourceLabel,
          holdings: 0,
        };
        // The label read last wins, as the source names the type now; on a tie the greatest, as Postgres picks it.
        const seen = labelReadAt.get(key);
        if (
          seen === undefined ||
          h.copy!.readAt > seen ||
          (h.copy!.readAt === seen && h.copy!.sourceLabel > row.label)
        ) {
          row.label = h.copy!.sourceLabel;
          labelReadAt.set(key, h.copy!.readAt);
        }
        row.holdings++;
        counted.set(key, row);
      }
      return [...counted.values()].sort(
        (a, b) => a.connectorId.localeCompare(b.connectorId) || a.sourceType.localeCompare(b.sourceType),
      );
    },
    async mappings(organisationId, connectorId) {
      return [...state.mappings.values()]
        .filter(
          m => m.organisationId === organisationId && (connectorId === undefined || m.connectorId === connectorId),
        )
        .map(m => ({ ...m }));
    },
    async mappingsOf(connectorId) {
      return [...state.mappings.values()].filter(m => m.connectorId === connectorId).map(m => ({ ...m }));
    },
    async putMapping(mapping) {
      if (!state.types.has(mapping.typeId)) throw new Error('mapping references an unknown type');
      state.mappings.set(mappingKey(mapping.connectorId, mapping.organisationId, mapping.sourceType), { ...mapping });
    },
    async removeMapping(connectorId, organisationId, sourceType) {
      return state.mappings.delete(mappingKey(connectorId, organisationId, sourceType));
    },
    async sources() {
      return [...state.sources.values()]
        .sort((a, b) => a.connectorId.localeCompare(b.connectorId))
        .map(s => structuredClone(s));
    },
    async source(connectorId) {
      const s = state.sources.get(connectorId);
      return s && structuredClone(s);
    },
    async openSource(blank) {
      if (!state.sources.has(blank.connectorId)) state.sources.set(blank.connectorId, structuredClone(blank));
      return structuredClone(state.sources.get(blank.connectorId)!);
    },
    async putSource(record) {
      state.sources.set(record.connectorId, structuredClone(record));
    },
    async forgetSource(connectorId) {
      let holdings = 0,
        mappings = 0;
      for (const h of copied())
        if (h.copy!.connectorId === connectorId) {
          state.holdings.delete(h.id);
          holdings++;
        }
      for (const [key, m] of [...state.mappings])
        if (m.connectorId === connectorId) {
          state.mappings.delete(key);
          mappings++;
        }
      state.sources.delete(connectorId);
      return { holdings, mappings };
    },
    async enqueue(start) {
      if (!state.enqueued.some(s => s.id === start.id)) state.enqueued.push(structuredClone(start));
    },
    async persons(ids) {
      return ids.flatMap(id => (state.persons.has(id) ? [{ ...state.persons.get(id)! }] : []));
    },
    async activeByUserName(userNames) {
      const wanted = new Set(userNames.map(n => n.toLowerCase()));
      return [...state.persons.values()]
        .filter(p => p.userName !== null && wanted.has(p.userName.toLowerCase()) && p.enabled)
        .map(p => ({ ...p }));
    },
    async activeIds(personIds) {
      return new Set(personIds.filter(id => state.persons.get(id)?.enabled === true));
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
      const ofOrganisation = (personId: string) => state.persons.get(personId)?.organisationId === organisationId;
      return structuredClone({
        types,
        holdings: byCreated([...state.holdings.values()].filter(h => ofOrganisation(h.personId))),
        mappings: [...state.mappings.values()]
          .filter(m => m.organisationId === organisationId)
          .sort(
            (a, b) =>
              a.connectorId.localeCompare(b.connectorId) ||
              a.sourceType.localeCompare(b.sourceType) ||
              a.mappedAt.localeCompare(b.mappedAt),
          ),
      });
    },
    cards: {
      async removeOwn(personId, actor, at) {
        // In card id order, as the thread store locks and removes them.
        const own = [...state.cards]
          .filter(([, card]) => card.personId === personId && card.connector === COMPETENCE_CONNECTOR)
          .map(([id]) => id)
          .sort();
        for (const id of own) {
          state.cards.delete(id);
          state.audit.push({
            actor,
            action: 'thread.removed',
            subject: `thread:${id}`,
            at,
            details: { reason: 'erasure' },
          });
        }
        return own.length;
      },
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
    /** SCIM deactivates a person (D68): they stay, and leave every list. */
    deactivate(personId: string) {
      const person = state.persons.get(personId);
      if (person) person.enabled = false;
    },
    /** A card in a person's own stream, as a scan would have pushed it. */
    addCard(id: string, card: MemoryCard) {
      state.cards.set(id, { ...card });
    },
    audit: () => structuredClone(state.audit),
  };
}
export type MemoryCompetenceStore = ReturnType<typeof memoryCompetenceStore>;
