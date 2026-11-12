import { RequirementTaken, ShareTargetTaken, TypeNameTaken } from '../model';
import type {
  CompetenceAudit,
  CompetenceStore,
  CompetenceTx,
  Erased,
  HoldingRecord,
  PersonRef,
  PositionRecord,
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
 * the audit rows and the workflow starts included. Transactions run one at a time, as row locks would make them.
 */
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
    async erasePerson(personId) {
      let holdings = 0,
        requirements = 0;
      for (const [id, r] of [...state.requirements])
        if (r.personId === personId) {
          state.requirements.delete(id);
          requirements++;
        }
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
      const erased: Erased = { holdings, cleared: cleared.size + authored, requirements };
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
      state.inactive.add(personId);
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
