import { foldEntityKey, type Subject } from '@clew/contracts';
import { PendingTaken, RequirementTaken, ShareTargetTaken, SkillTaken, TypeNameTaken, TypeUriTaken } from '../model';
import type {
  ApprovalOutcome,
  ApprovalWorkItemTx,
  CompetenceAudit,
  CompetenceStore,
  CompetenceTx,
  Erased,
  HoldingRecord,
  PersonRef,
  PositionRecord,
  ReadLogEntry,
  RequirementRecord,
  ShareTargetRecord,
  SourceMapping,
  SourceRecord,
  TypeRecord,
  UnitRecord,
  WorkflowStart,
} from '../model';

/**
 * The competence store in memory: the unit tests' adapter (D25), held to Postgres by
 * `tests/competence-store-contract.ts`. State is plain and seedable; a transaction is a snapshot that a throw restores,
 * the audit rows, the workflow starts and the approvals' cards included. Transactions run one at a time, as row locks
 * would make them.
 *
 * The approvals' cards (`ApprovalWorkItemTx`, D108 item 7) are recorded here instead of written to a stream: every call
 * in `state.calls`, each manager's card in `state.cards` by its id (`<threadId>:<manager id>`). A test makes the card
 * sink throw with `sink.throwOn`.
 */
export type ApprovalWorkItemCall =
  | ({ op: 'open' } & Omit<Parameters<ApprovalWorkItemTx['open']>[0], 'managers'> & { managers: string[] })
  | { op: 'close'; threadId: string; at: string; outcome: ApprovalOutcome; only?: string[] }
  | { op: 'reopen'; threadId: string; personIds: string[]; at: string }
  | { op: 'remove'; threadIds: string[] }
  | { op: 'removeAbout'; subject: Subject }
  | { op: 'removeOwned'; personId: string };
/** One manager's card of one approval. */
export interface MemoryApprovalCard {
  personId: string;
  threadId: string;
  holdingId: string;
  /** The person the card is about, by key, when they have one. */
  subject: Subject | null;
  /** `dismissed` and a `handled` with no outcome are its owner's own doing (`setOwn`). */
  state: 'open' | 'handled' | 'dismissed';
  outcome: ApprovalOutcome | null;
}
export interface MemoryApprovalSink {
  /** The card call that throws, as a failing thread store would. */
  throwOn?: ApprovalWorkItemCall['op'];
}
export interface MemoryCompetenceState {
  types: Map<string, TypeRecord>;
  holdings: Map<string, HoldingRecord>;
  persons: Map<string, PersonRef>;
  /** People SCIM has deactivated (D68): they stay, and the copy matches nobody to them. */
  inactive: Set<string>;
  /** By `<connector>\n<organisation>\n<source type>`. */
  mappings: Map<string, SourceMapping>;
  sources: Map<string, SourceRecord>;
  /** The directory as SCIM wrote it (D108 item 5, D99): positions, who holds them, units, the tree and assignments. */
  positions: Map<string, PositionRecord>;
  /** By person: the ids of the positions they hold. */
  held: Map<string, Set<string>>;
  /** The units people may be assigned to that no group names: rows of `auth_unit` alone, which the tree leaves out. */
  units: Map<string, Omit<UnitRecord, 'parentId'>>;
  /** The pushed `unit:` groups by unit id: the organisation, the name and the unit above. */
  tree: Map<string, { organisationId: string; label: string; parentId: string | null }>;
  /** By person: the ids of the units they are assigned to. */
  assigned: Map<string, Set<string>>;
  requirements: Map<string, RequirementRecord>;
  shareTargets: Map<string, ShareTargetRecord>;
  audit: CompetenceAudit[];
  /** The workflow starts committed (D86), each id once. */
  enqueued: WorkflowStart[];
  /** The approvals' cards by card id, and every call to them in order (D108 item 7). */
  cards: Map<string, MemoryApprovalCard>;
  calls: ApprovalWorkItemCall[];
  /** The read log (D108 item 15, D121 item 5), in the order written. */
  readLog: ReadLogEntry[];
}
/**
 * The checks of `competence_read_log`: a person opened names whom and nothing of a search; a search and an export name
 * the type and nobody, and are a registrar's.
 */
function assertReadLog(r: ReadLogEntry) {
  const ok =
    r.rows >= 0 &&
    (r.minLevel === null || (r.minLevel >= 1 && r.minLevel <= 3)) &&
    (r.kind === 'person'
      ? r.personId !== null && r.typeId === null && r.minLevel === null && r.unitId === null
      : r.typeId !== null && r.personId === null && r.relation === 'registrar');
  if (!ok) throw new Error('competence_read_log check violated');
}
const byCreated = <T extends { createdAt: string; id: string }>(rows: T[]) =>
  rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
const sv = (a: string, b: string) => a.localeCompare(b, 'sv');
const mappingKey = (connectorId: string, organisationId: string, sourceType: string) =>
  connectorId + '\n' + organisationId + '\n' + sourceType;

export function memoryCompetenceStore(seed: { persons?: PersonRef[] } = {}) {
  let state: MemoryCompetenceState = {
    types: new Map(),
    holdings: new Map(),
    persons: new Map((seed.persons ?? []).map(p => [p.id, { ...p }])),
    inactive: new Set(),
    mappings: new Map(),
    sources: new Map(),
    positions: new Map(),
    held: new Map(),
    units: new Map(),
    tree: new Map(),
    assigned: new Map(),
    requirements: new Map(),
    shareTargets: new Map(),
    audit: [],
    enqueued: [],
    cards: new Map(),
    calls: [],
    readLog: [],
  };
  const sink: MemoryApprovalSink = {};
  const logSink = { fail: false };
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
  /**
   * The unique index `competence_type_source_uri`: one address per organisation, whatever the type's state; and the
   * check `competence_type_merged` with the reference of `merged_into`.
   */
  const assertType = (candidate: TypeRecord) => {
    if (
      candidate.sourceUri !== null &&
      [...state.types.values()].some(
        t =>
          t.id !== candidate.id && t.organisationId === candidate.organisationId && t.sourceUri === candidate.sourceUri,
      )
    )
      throw new TypeUriTaken();
    if (candidate.mergedInto !== null) {
      if (candidate.archivedAt === null || candidate.mergedInto === candidate.id)
        throw new Error('a merged type is archived and not merged into itself');
      if (!state.types.has(candidate.mergedInto)) throw new Error('a merged type refers to the type it went into');
    }
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
    if (holding.decidedBy !== null && !state.persons.has(holding.decidedBy))
      throw new Error('holding references an unknown decider');
    assertDecision(holding);
  };
  /**
   * The checks `competence_holding_own`, `competence_holding_decided` (D108 item 7), `competence_holding_skill`,
   * `competence_holding_rated` and `competence_holding_validated` (D120).
   */
  const assertDecision = (h: HoldingRecord) => {
    if ((h.state === 'pending' || h.state === 'rejected') && h.evidence !== 'self')
      throw new Error("only a person's own registration waits or is rejected");
    if (h.decidedBy !== null && h.decidedAt === null) throw new Error('a decision has its time');
    if (h.threadId !== null && h.evidence !== 'self') throw new Error("only a person's own registration has cards");
    if (
      h.level !== null
        ? h.decidedAt !== null
        : h.evidence === 'self'
          ? (h.state === 'pending') !== (h.decidedAt === null)
          : h.decidedAt !== null
    )
      throw new Error("a person's own registration is decided exactly when it no longer waits");
    if (
      h.level !== null &&
      (!Number.isInteger(h.level) ||
        h.level < 1 ||
        h.level > 3 ||
        h.expiresOn !== null ||
        h.copy !== null ||
        h.evidence === 'system' ||
        h.threadId !== null ||
        (h.state !== 'valid' && h.state !== 'revoked'))
    )
      throw new Error('a skill has a level from 1 to 3, no end date, no source and no approval');
    if ((h.level === null) !== (h.ratedAt === null))
      throw new Error('a skill, and nothing else, has when it was rated');
    if (h.validatedBy !== null && h.validatedAt === null) throw new Error('a confirmation has its time');
    if ((h.validatedAt !== null || h.interest) && h.level === null)
      throw new Error('only a skill is confirmed or carries an interest mark');
    if (h.validatedBy !== null && !state.persons.has(h.validatedBy))
      throw new Error('holding references an unknown person who confirmed it');
  };
  /** The unique index `competence_holding_one_skill`: one skill of a type that counts per person (D120 item 1). */
  const assertOneSkill = (h: HoldingRecord) => {
    if (h.level === null || h.state !== 'valid') return;
    const other = [...state.holdings.values()].some(
      x =>
        x.id !== h.id && x.level !== null && x.state === 'valid' && x.personId === h.personId && x.typeId === h.typeId,
    );
    if (other) throw new SkillTaken();
  };
  /** The unique index `competence_holding_pending`: one registration of a type waiting per person. */
  const assertOnePending = (h: HoldingRecord) => {
    if (h.state !== 'pending') return;
    const other = [...state.holdings.values()].some(
      x => x.id !== h.id && x.state === 'pending' && x.personId === h.personId && x.typeId === h.typeId,
    );
    if (other) throw new PendingTaken();
  };
  const fail = (op: ApprovalWorkItemCall['op']) => {
    if (sink.throwOn === op) throw new Error(`card sink failed on ${op}`);
  };
  const workItems: ApprovalWorkItemTx = {
    async open(input) {
      fail('open');
      state.calls.push(structuredClone({ op: 'open' as const, ...input, managers: [...input.managers] }));
      for (const personId of input.managers) {
        // The card's id is its key, as the thread's primary key is in Postgres.
        if (state.cards.has(input.threadId + ':' + personId)) throw new Error('the approval card exists already');
        state.cards.set(input.threadId + ':' + personId, {
          personId,
          threadId: input.threadId,
          holdingId: input.holdingId,
          subject: input.subject ? { ...input.subject } : null,
          state: 'open',
          outcome: null,
        });
      }
    },
    async close(threadId, at, outcome, only) {
      fail('close');
      state.calls.push({ op: 'close', threadId, at, outcome, ...(only ? { only: [...only] } : {}) });
      for (const card of state.cards.values())
        if (card.threadId === threadId && card.state === 'open' && (!only || only.includes(card.personId)))
          Object.assign(card, { state: 'handled', outcome });
    },
    async cards(threadId) {
      return [...state.cards.values()]
        .filter(c => c.threadId === threadId)
        .sort((a, b) => a.personId.localeCompare(b.personId))
        .map(c => ({
          personId: c.personId,
          open: c.state === 'open',
          setAside: c.state === 'handled' && (c.outcome === 'reassigned' || c.outcome === 'paused'),
        }));
    },
    async reopen(threadId, personIds, at) {
      fail('reopen');
      state.calls.push({ op: 'reopen', threadId, personIds: [...personIds], at });
      for (const card of state.cards.values())
        if (
          card.threadId === threadId &&
          personIds.includes(card.personId) &&
          card.state === 'handled' &&
          (card.outcome === 'reassigned' || card.outcome === 'paused')
        )
          Object.assign(card, { state: 'open', outcome: null });
    },
    async remove(threadIds) {
      fail('remove');
      state.calls.push({ op: 'remove', threadIds: [...threadIds] });
      for (const [id, card] of [...state.cards]) if (threadIds.includes(card.threadId)) state.cards.delete(id);
    },
    async removeAbout(subject) {
      fail('removeAbout');
      state.calls.push({ op: 'removeAbout', subject: { ...subject } });
      // The index from entity to cards compares a person's key without regard to case (D97 item 6).
      const key = foldEntityKey(subject.entity, subject.key);
      for (const [id, card] of [...state.cards])
        if (card.subject?.entity === subject.entity && foldEntityKey(card.subject.entity, card.subject.key) === key)
          state.cards.delete(id);
    },
    async removeOwned(personId) {
      fail('removeOwned');
      state.calls.push({ op: 'removeOwned', personId });
      for (const [id, card] of [...state.cards]) if (card.personId === personId) state.cards.delete(id);
    },
  };
  const copied = () => [...state.holdings.values()].filter(h => h.copy);
  /** The codes of the positions a person holds, as `auth_person_position` joined to `auth_position` reads them. */
  const codesOf = (personId: string) =>
    [...(state.held.get(personId) ?? [])]
      .flatMap(id => {
        const p = state.positions.get(id);
        return p && p.organisationId === state.persons.get(personId)?.organisationId ? [p.code] : [];
      })
      .sort();
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
      assertType(type);
      state.types.set(type.id, { ...type });
    },
    async updateType(id, patch) {
      const t = state.types.get(id);
      if (!t) return;
      const next = { ...t, ...patch };
      assertNameFree(next);
      assertType(next);
      state.types.set(id, next);
    },
    async insertTypes(types) {
      // One after the other, so a name or an address twice in the batch is refused as the index refuses it; the
      // transaction's snapshot makes it all or none.
      for (const type of types) await tx.insertType(type);
    },
    async findTypes(organisationId, words, limit) {
      const folded = (value: string) => value.toLocaleLowerCase('sv');
      return [...state.types.values()]
        .filter(
          t =>
            t.organisationId === organisationId &&
            t.archivedAt === null &&
            words.every(w => folded(t.name).includes(folded(w)) || folded(t.area).includes(folded(w))),
        )
        .sort((a, b) => sv(a.name, b.name) || a.id.localeCompare(b.id))
        .slice(0, limit)
        .map(t => ({ ...t }));
    },
    async holdingsOf(personIds) {
      return byCreated([...state.holdings.values()].filter(h => personIds.includes(h.personId))).map(h =>
        structuredClone(h),
      );
    },
    async waitingRegistrations() {
      return byCreated([...state.holdings.values()].filter(h => h.evidence === 'self' && h.state === 'pending')).map(
        h => structuredClone(h),
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
      assertOnePending(holding);
      assertOneSkill(holding);
      state.holdings.set(holding.id, structuredClone(holding));
    },
    async updateHolding(id, patch) {
      const h = state.holdings.get(id);
      if (!h) return;
      const next = { ...h, ...patch };
      if (next.decidedBy !== null && !state.persons.has(next.decidedBy))
        throw new Error('holding references an unknown decider');
      if (next.registeredBy !== null && !state.persons.has(next.registeredBy))
        throw new Error('holding references an unknown registrar');
      assertDecision(next);
      assertOnePending(next);
      assertOneSkill(next);
      state.holdings.set(id, next);
    },
    async deleteHolding(id) {
      // A copied row goes only with its source or its person.
      if (!state.holdings.get(id)?.copy) state.holdings.delete(id);
    },
    async retypeHoldings(holdingIds, typeId) {
      if (!state.types.has(typeId)) throw new Error('holding references an unknown type');
      let n = 0;
      for (const id of new Set(holdingIds)) {
        const h = state.holdings.get(id);
        if (!h) continue;
        const next = { ...h, typeId };
        assertOnePending(next);
        assertOneSkill(next);
        state.holdings.set(id, next);
        n++;
      }
      return n;
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
        if (h.state === 'revoked' || state.inactive.has(h.personId)) continue;
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
        .filter(p => p.userName !== null && wanted.has(p.userName.toLowerCase()) && !state.inactive.has(p.id))
        .map(p => ({ ...p }));
    },
    async activeIds(personIds) {
      return new Set(personIds.filter(id => state.persons.has(id) && !state.inactive.has(id)));
    },
    async positions(organisationId) {
      return [...state.positions.values()]
        .filter(p => p.organisationId === organisationId)
        .sort((a, b) => sv(a.label, b.label) || a.code.localeCompare(b.code))
        .map(p => ({ ...p }));
    },
    async units(organisationId) {
      return [...state.tree]
        .filter(([, node]) => node.organisationId === organisationId)
        .map(([id, node]) => ({ id, organisationId, label: node.label, parentId: node.parentId }))
        .sort((a, b) => sv(a.label, b.label) || a.id.localeCompare(b.id));
    },
    async placedOn(organisationId, unitIds) {
      const wanted = new Set(unitIds);
      return [...state.assigned]
        .filter(
          ([personId, units]) =>
            state.persons.get(personId)?.organisationId === organisationId &&
            !state.inactive.has(personId) &&
            [...units].some(u => wanted.has(u)),
        )
        .map(([personId]) => personId)
        .sort();
    },
    async placesOf(organisationId, personIds) {
      return [...new Set(personIds)]
        .filter(id => state.persons.get(id)?.organisationId === organisationId)
        .map(personId => ({
          personId,
          unitIds: [...(state.assigned.get(personId) ?? [])].sort(),
          positionCodes: codesOf(personId),
        }));
    },
    async positionHolders(organisationId, codes) {
      const wanted = new Set(codes);
      return [...state.persons.values()]
        .filter(p => p.organisationId === organisationId && !state.inactive.has(p.id))
        .flatMap(p => codesOf(p.id).flatMap(code => (wanted.has(code) ? [{ personId: p.id, code }] : [])))
        .sort((a, b) => a.personId.localeCompare(b.personId) || a.code.localeCompare(b.code));
    },
    async requirements(organisationId) {
      return byCreated([...state.requirements.values()].filter(r => r.organisationId === organisationId)).map(r => ({
        ...r,
      }));
    },
    async requirement(id) {
      const r = state.requirements.get(id);
      return r && { ...r };
    },
    async insertRequirement(requirement) {
      if (state.requirements.has(requirement.id)) throw new Error('duplicate requirement id');
      const targets = [requirement.positionCode, requirement.unitId, requirement.personId].filter(v => v !== null);
      if (targets.length !== 1) throw new Error('a requirement names exactly one of a position, a unit and a person');
      if (!state.types.has(requirement.typeId)) throw new Error('requirement references an unknown type');
      // A position and a unit are named by key, not by row: as in Postgres, there is no reference to check.
      if (requirement.personId !== null && !state.persons.has(requirement.personId))
        throw new Error('requirement references an unknown person');
      if (requirement.minLevel !== null && (requirement.minLevel < 1 || requirement.minLevel > 3))
        throw new Error('a least level is 1 to 3');
      const taken = [...state.requirements.values()].some(
        r =>
          r.typeId === requirement.typeId &&
          r.positionCode === requirement.positionCode &&
          r.unitId === requirement.unitId &&
          r.personId === requirement.personId,
      );
      if (taken) throw new RequirementTaken();
      state.requirements.set(requirement.id, { ...requirement });
    },
    async removeRequirement(id) {
      return state.requirements.delete(id);
    },
    async updateRequirement(id, patch) {
      const r = state.requirements.get(id);
      if (!r) return;
      const next = { ...r, ...patch };
      if (!state.types.has(next.typeId)) throw new Error('requirement references an unknown type');
      if (next.minLevel !== null && (next.minLevel < 1 || next.minLevel > 3))
        throw new Error('a least level is 1 to 3');
      const taken = [...state.requirements.values()].some(
        o =>
          o.id !== id &&
          o.typeId === next.typeId &&
          o.positionCode === next.positionCode &&
          o.unitId === next.unitId &&
          o.personId === next.personId,
      );
      if (taken) throw new RequirementTaken();
      state.requirements.set(id, next);
    },
    async shareTargets(organisationId) {
      return byCreated([...state.shareTargets.values()].filter(t => t.organisationId === organisationId)).map(t => ({
        ...t,
      }));
    },
    async shareTarget(id) {
      const t = state.shareTargets.get(id);
      return t && { ...t };
    },
    async insertShareTarget(target) {
      if (state.shareTargets.has(target.id)) throw new Error('duplicate share target id');
      if (!state.types.has(target.typeId)) throw new Error('share target references an unknown type');
      if (!Number.isInteger(target.minShare) || target.minShare < 1 || target.minShare > 100)
        throw new Error('a least share is 1 to 100');
      const taken = [...state.shareTargets.values()].some(
        t =>
          t.typeId === target.typeId &&
          t.positionCode === target.positionCode &&
          t.unitId === target.unitId &&
          (t.unitId !== null || t.organisationId === target.organisationId),
      );
      if (taken) throw new ShareTargetTaken();
      state.shareTargets.set(target.id, { ...target });
    },
    async removeShareTarget(id) {
      return state.shareTargets.delete(id);
    },
    async updateShareTarget(id, patch) {
      const t = state.shareTargets.get(id);
      if (!t) return;
      const next = { ...t, ...patch };
      if (!state.types.has(next.typeId)) throw new Error('share target references an unknown type');
      if (!Number.isInteger(next.minShare) || next.minShare < 1 || next.minShare > 100)
        throw new Error('a least share is 1 to 100');
      const taken = [...state.shareTargets.values()].some(
        o =>
          o.id !== id &&
          o.typeId === next.typeId &&
          o.positionCode === next.positionCode &&
          o.unitId === next.unitId &&
          (o.unitId !== null || o.organisationId === next.organisationId),
      );
      if (taken) throw new ShareTargetTaken();
      state.shareTargets.set(id, next);
    },
    async erasePerson(personId) {
      let holdings = 0,
        requirements = 0;
      for (const [id, r] of [...state.requirements])
        if (r.personId === personId) {
          state.requirements.delete(id);
          requirements++;
        }
      const cleared = new Set<string>(),
        threadIds = new Set<string>();
      for (const [id, h] of [...state.holdings]) {
        if (h.personId === personId) {
          if (h.threadId) threadIds.add(h.threadId);
          state.holdings.delete(id);
          holdings++;
          continue;
        }
        for (const column of ['registeredBy', 'revokedBy', 'decidedBy', 'validatedBy'] as const)
          if (h[column] === personId) {
            h[column] = null;
            cleared.add(id);
          }
      }
      // The requirements and share targets the person set keep standing, without their author.
      const actor = 'person:' + personId;
      let authored = 0;
      for (const [id, r] of state.requirements)
        if (r.createdBy === actor) {
          state.requirements.set(id, { ...r, createdBy: null });
          authored++;
        }
      for (const [id, t] of state.shareTargets)
        if (t.createdBy === actor) {
          state.shareTargets.set(id, { ...t, createdBy: null });
          authored++;
        }
      const erased: Erased = {
        holdings,
        cleared: cleared.size + authored,
        requirements,
        threadIds: [...threadIds].sort(),
      };
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
        requirements: byCreated([...state.requirements.values()].filter(r => r.organisationId === organisationId)),
        shareTargets: byCreated([...state.shareTargets.values()].filter(t => t.organisationId === organisationId)),
      });
    },
    async audit(entry) {
      state.audit.push(structuredClone(entry));
    },
    async logRead(entry) {
      if (logSink.fail) throw new Error('the read log cannot be written');
      if (state.readLog.some(r => r.id === entry.id)) throw new Error('duplicate read log id');
      assertReadLog(entry);
      state.readLog.push(structuredClone(entry));
    },
    async readLog(query) {
      return state.readLog
        .filter(
          r =>
            (query.organisationId === undefined || r.organisationId === query.organisationId) &&
            (query.personId === undefined || r.personId === query.personId) &&
            (query.readerId === undefined || r.readerId === query.readerId) &&
            (query.since === undefined || r.readAt >= query.since),
        )
        .sort((a, b) => b.readAt.localeCompare(a.readAt) || a.id.localeCompare(b.id))
        .slice(0, query.limit)
        .map(r => structuredClone(r));
    },
    workItems,
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
    sink,
    /** Set `fail` and the read log refuses every row, as a database that cannot write it would (D121 item 5). */
    readLogSink: logSink,
    /** The read log as written, oldest first. */
    readLog: () => structuredClone(state.readLog),
    /** The calls to the approvals' cards, in order. */
    calls: () => structuredClone(state.calls),
    /** The current state; replaced (not mutated) when a transaction rolls back, so read it after the call. */
    get state() {
      return state;
    },
    /** A person the domain can name, as provisioning would have written them. */
    addPerson(person: PersonRef) {
      state.persons.set(person.id, { ...person });
    },
    /** A manager puts a card of an approval away themselves (handled or dismissed), as the stream lets them. */
    setOwn(cardId: string, next: 'handled' | 'dismissed') {
      const card = state.cards.get(cardId);
      if (card) Object.assign(card, { state: next, outcome: null });
    },
    /** SCIM deactivates a person (D68): they stay, and leave every list. */
    deactivate(personId: string) {
      state.inactive.add(personId);
    },
    /** SCIM activates a person again. */
    reactivate(personId: string) {
      state.inactive.delete(personId);
    },
    /** A position of an organisation, as a `position:` group would have written it (D108 item 5). */
    addPosition(position: PositionRecord) {
      state.positions.set(position.id, { ...position });
    },
    /** The person holds the position, as their `position:` membership would have derived it. */
    holdPosition(personId: string, positionId: string) {
      state.held.set(personId, (state.held.get(personId) ?? new Set()).add(positionId));
    },
    /**
     * A unit as SCIM writes it (D99): its row, under the name the directory holds, and its `unit:` group with the unit
     * above it. `pushed: false` writes the row alone, as for a unit people are assigned to that no group names.
     */
    addUnit(unit: Omit<UnitRecord, 'parentId'> & { parentId?: string | null; pushed?: boolean }) {
      const { parentId = null, pushed = true, ...row } = unit;
      state.units.set(row.id, row);
      if (pushed) state.tree.set(row.id, { organisationId: row.organisationId, label: row.label, parentId });
    },
    /** A unit's group is removed (D99): its node leaves the tree; the people the SCIM use case moved are the caller's. */
    removeUnit(unitId: string) {
      state.tree.delete(unitId);
    },
    /** A position's group is removed (D108 item 5): its row goes, and with it who held it. */
    removePosition(positionId: string) {
      state.positions.delete(positionId);
      for (const held of state.held.values()) held.delete(positionId);
    },
    /** The person is assigned to the unit, as a `unit:` membership would have placed them. */
    assign(personId: string, unitId: string) {
      state.assigned.set(personId, (state.assigned.get(personId) ?? new Set()).add(unitId));
    },
    audit: () => structuredClone(state.audit),
  };
}
export type MemoryCompetenceStore = ReturnType<typeof memoryCompetenceStore>;
