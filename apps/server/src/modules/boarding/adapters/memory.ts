import { dueTimerAt, lineUpwards } from '../domain';
import {
  PlanTaken,
  type BoardingAudit,
  type BoardingDirectory,
  type BoardingStore,
  type BoardingTx,
  type Erased,
  type ItemRecord,
  type LayerItemRecord,
  type LayerRecord,
  type PersonRef,
  type PlanRecord,
  type Report,
  type UnitNode,
  type WorkItemTx,
} from '../model';

/**
 * The boarding store in memory: the unit tests' adapter (D25), held to Postgres by `tests/boarding-store-contract.ts`.
 * State is plain and seedable; a transaction is a snapshot that a throw restores, the audit rows and the cards included.
 * Transactions run one at a time, as row locks would make them.
 *
 * The owners' cards (`WorkItemTx`) are recorded here instead of written to a stream: every call in `state.calls`, each
 * card's state in `state.cards`. A test makes the card sink throw with `sink.throwOn` and decides what `fire` answers
 * with `sink.fires`.
 */
export type WorkItemCall =
  | ({ op: 'open' } & Parameters<WorkItemTx['open']>[0])
  | { op: 'close'; threadId: string; at: string; why: 'done' | 'closed' }
  | { op: 'reopen'; threadId: string; dueOn: string; at: string }
  | { op: 'fire'; threadId: string; generation: number; at: string; fired: boolean }
  | { op: 'remove'; threadIds: string[] };
export interface MemoryCard {
  personId: string;
  itemId: string;
  planId: string;
  title: string | null;
  dueOn: string;
  subject?: { entity: 'person' | 'unit'; key: string };
  state: 'open' | 'handled';
  /** Whether the card has a timer: none for a due day whose next morning has passed (`dueTimerAt`). */
  timer: boolean;
}
export interface MemoryBoardingState {
  layers: Map<string, LayerRecord>;
  layerItems: Map<string, LayerItemRecord>;
  plans: Map<string, PlanRecord>;
  items: Map<string, ItemRecord>;
  persons: Map<string, PersonRef>;
  audit: BoardingAudit[];
  cards: Map<string, MemoryCard>;
  calls: WorkItemCall[];
}
export interface MemoryCardSink {
  /** The card call that throws, as a failing thread store would. */
  throwOn?: WorkItemCall['op'];
  /** What `fire` answers: true when the timer is still active at that generation. Default true for an existing card. */
  fires?: boolean | ((threadId: string, generation: number) => boolean);
}
const sv = (a: string, b: string) => a.localeCompare(b, 'sv');
const newestFirst = (rows: PlanRecord[]) =>
  rows.sort((a, b) => b.startedAt.localeCompare(a.startedAt) || a.id.localeCompare(b.id));

export function memoryBoardingStore(seed: { persons?: PersonRef[] } = {}) {
  let state: MemoryBoardingState = {
    layers: new Map(),
    layerItems: new Map(),
    plans: new Map(),
    items: new Map(),
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
      if (state.cards.has(input.threadId)) throw new Error(`The card ${input.threadId} already exists.`);
      state.cards.set(input.threadId, {
        personId: input.personId,
        itemId: input.itemId,
        planId: input.planId,
        title: input.title,
        dueOn: input.dueOn,
        ...(input.subject ? { subject: { ...input.subject } } : {}),
        state: 'open',
        timer: dueTimerAt(input.dueOn, input.at) !== undefined,
      });
    },
    async close(threadId, at, why) {
      fail('close');
      state.calls.push({ op: 'close', threadId, at, why });
      const card = state.cards.get(threadId);
      if (card) Object.assign(card, { state: 'handled', timer: false });
    },
    async reopen(threadId, dueOn, at) {
      fail('reopen');
      state.calls.push({ op: 'reopen', threadId, dueOn, at });
      const card = state.cards.get(threadId);
      if (card) Object.assign(card, { state: 'open', dueOn, timer: dueTimerAt(dueOn, at) !== undefined });
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
      for (const i of state.items.values()) if (i.threadId && threadIds.includes(i.threadId)) i.threadId = null;
    },
  };
  const byPlan = (a: ItemRecord, b: ItemRecord) => a.planId.localeCompare(b.planId) || a.position - b.position;
  const tx: BoardingTx = {
    async lockLayers() {
      // Transactions run one at a time here.
    },
    async layers(organisationId, event) {
      return [...state.layers.values()]
        .filter(l => l.organisationId === organisationId && (event === undefined || l.event === event))
        .sort((a, b) => a.event.localeCompare(b.event) || sv(a.name, b.name) || a.id.localeCompare(b.id))
        .map(l => ({ ...l }));
    },
    async layerItems(layerIds) {
      return [...state.layerItems.values()]
        .filter(i => layerIds.includes(i.layerId))
        .sort((a, b) => layerIds.indexOf(a.layerId) - layerIds.indexOf(b.layerId) || a.position - b.position)
        .map(i => ({ ...i }));
    },
    async insertLayer(layer) {
      if (state.layers.has(layer.id)) throw new Error('duplicate layer id');
      const key = layer.name.toLowerCase();
      if (
        [...state.layers.values()].some(
          l => l.organisationId === layer.organisationId && l.event === layer.event && l.name.toLowerCase() === key,
        )
      )
        throw Object.assign(new Error('duplicate key value violates unique constraint'), {
          code: '23505',
          constraint_name: 'boarding_layer_name',
        });
      state.layers.set(layer.id, { ...layer });
    },
    async updateLayer(id, patch) {
      const l = state.layers.get(id);
      if (l) Object.assign(l, patch);
    },
    async replaceLayerItems(layerId, items) {
      if (!state.layers.has(layerId)) throw new Error('items reference an unknown layer');
      for (const [id, i] of [...state.layerItems]) if (i.layerId === layerId) state.layerItems.delete(id);
      for (const i of items) state.layerItems.set(i.id, { ...i, layerId });
    },
    async plan(id) {
      const p = state.plans.get(id);
      return p && structuredClone(p);
    },
    async plansAbout(personIds) {
      return newestFirst([...state.plans.values()].filter(p => personIds.includes(p.personId))).map(p =>
        structuredClone(p),
      );
    },
    async openPlansOf(personId) {
      return newestFirst(
        [...state.plans.values()].filter(
          p => p.closedAt === null && (p.startedBy === personId || p.heldBy.includes(personId)),
        ),
      ).map(p => structuredClone(p));
    },
    async holdPlan(id, holders, at) {
      const p = state.plans.get(id);
      if (p) Object.assign(p, { heldAt: at, heldBy: [...new Set(holders)].sort() });
    },
    async releasePlan(id) {
      const p = state.plans.get(id);
      if (p) Object.assign(p, { heldAt: null, heldBy: [] });
    },
    async insertPlan(plan) {
      if (state.plans.has(plan.id)) throw new Error('duplicate plan id');
      if (!state.persons.has(plan.personId)) throw new Error('plan references an unknown person');
      if (
        plan.closedAt === null &&
        [...state.plans.values()].some(
          p => p.personId === plan.personId && p.event === plan.event && p.closedAt === null,
        )
      )
        throw new PlanTaken();
      state.plans.set(plan.id, { ...plan, heldAt: null, heldBy: [] });
    },
    async closePlan(id, at) {
      const p = state.plans.get(id);
      if (p) p.closedAt = at;
    },
    async items(planIds) {
      return [...state.items.values()]
        .filter(i => planIds.includes(i.planId))
        .sort(byPlan)
        .map(i => ({ ...i }));
    },
    async item(id) {
      const i = state.items.get(id);
      return i && { ...i };
    },
    async itemByThread(threadId) {
      const i = [...state.items.values()].find(i => i.threadId === threadId);
      return i && { ...i };
    },
    async insertItem(item) {
      if (state.items.has(item.id)) throw new Error('duplicate item id');
      if (!state.plans.has(item.planId)) throw new Error('item references an unknown plan');
      // The row refers to its card, as the foreign key on `thread_id` makes it in Postgres.
      if (item.threadId && !state.cards.has(item.threadId)) throw new Error('item references an unknown card');
      state.items.set(item.id, { ...item });
    },
    async updateItem(id, patch) {
      const i = state.items.get(id);
      if (!i) return;
      if ('doneAt' in patch) i.doneAt = patch.doneAt ?? null;
      if ('doneBy' in patch) i.doneBy = patch.doneBy ?? null;
    },
    async persons(ids) {
      return [...new Set(ids)].flatMap(id => (state.persons.has(id) ? [{ ...state.persons.get(id)! }] : []));
    },
    async erasePerson(personId) {
      const threadIds = new Set<string>(),
        cleared = new Set<string>();
      let plans = 0,
        items = 0;
      for (const [id, p] of [...state.plans]) {
        if (p.personId !== personId) continue;
        for (const [itemId, i] of [...state.items])
          if (i.planId === id) {
            if (i.threadId) threadIds.add(i.threadId);
            state.items.delete(itemId);
            items++;
          }
        state.plans.delete(id);
        plans++;
      }
      for (const [id, p] of state.plans) {
        if (p.buddyId === personId) {
          p.buddyId = null;
          cleared.add('plan:' + id);
        }
        if (p.startedBy === personId) {
          p.startedBy = null;
          cleared.add('plan:' + id);
        }
        if (p.heldBy.includes(personId)) {
          p.heldBy = p.heldBy.filter(h => h !== personId);
          cleared.add('plan:' + id);
        }
      }
      for (const [id, i] of state.items) {
        if (i.ownerId === personId) {
          if (i.threadId) threadIds.add(i.threadId);
          i.ownerId = null;
          i.threadId = null;
          cleared.add('item:' + id);
        }
        if (i.doneBy === personId) {
          i.doneBy = null;
          cleared.add('item:' + id);
        }
      }
      const erased: Erased = { plans, items, cleared: cleared.size, threadIds: [...threadIds].sort() };
      return erased;
    },
    async exportOrganisation(organisationId) {
      const layers = [...state.layers.values()]
        .filter(l => l.organisationId === organisationId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
        .map(l => ({
          ...l,
          items: [...state.layerItems.values()]
            .filter(i => i.layerId === l.id)
            .sort((a, b) => a.position - b.position)
            .map(i => ({ ...i })),
        }));
      const plans = [...state.plans.values()]
        .filter(p => p.organisationId === organisationId)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.id.localeCompare(b.id));
      const ids = new Set(plans.map(p => p.id));
      return structuredClone({
        layers,
        plans,
        items: [...state.items.values()].filter(i => ids.has(i.planId)).sort(byPlan),
      });
    },
    async audit(entry) {
      state.audit.push(structuredClone(entry));
    },
    workItems,
  };
  const transaction: BoardingStore['transaction'] = fn =>
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
    /** A person deactivated by the directory. */
    deactivate(personId: string) {
      const p = state.persons.get(personId);
      if (p) p.enabled = false;
    },
    audit: () => structuredClone(state.audit),
    calls: () => structuredClone(state.calls),
  };
}
export type MemoryBoardingStore = ReturnType<typeof memoryBoardingStore>;

/** A person as the memory directory holds them: their assignments with the role on each, positions and employments. */
export interface MemoryDirectoryPerson extends Pick<Report, 'positionCodes' | 'employments'> {
  id: string;
  organisationId: string;
  enabled: boolean;
  assignments: Array<{ unitId: string; role: 'manager' | 'employee' }>;
}
/**
 * The directory in memory (D25): the unit tests' `BoardingDirectory`, held to Postgres by
 * `tests/boarding-directory-contract.ts`. Seedable, and changed by the test as provisioning would change it.
 */
export function memoryBoardingDirectory(
  seed: {
    units?: Array<UnitNode & { organisationId: string; label: string }>;
    people?: MemoryDirectoryPerson[];
  } = {},
) {
  const units = new Map((seed.units ?? []).map(u => [u.id, { ...u }]));
  const people = new Map((seed.people ?? []).map(p => [p.id, structuredClone(p)]));
  const directory: BoardingDirectory = {
    async facts(organisationId, personIds) {
      const found = new Map<string, Pick<Report, 'unitIds' | 'positionCodes' | 'employments'>>();
      for (const id of personIds) {
        const p = people.get(id);
        if (!p || p.organisationId !== organisationId) continue;
        found.set(id, {
          unitIds: p.assignments.map(a => a.unitId).sort(),
          positionCodes: [...p.positionCodes].sort(),
          employments: structuredClone(p.employments),
        });
      }
      return found;
    },
    async tree(organisationId) {
      return [...units.values()]
        .filter(u => u.organisationId === organisationId)
        .map(u => ({ id: u.id, parentId: u.parentId }));
    },
    async unitLabels(organisationId, unitIds) {
      return new Map(
        unitIds.flatMap(id => {
          const u = units.get(id);
          return u && u.organisationId === organisationId ? [[id, u.label] as const] : [];
        }),
      );
    },
    async lineManagers(organisationId, personId) {
      const person = people.get(personId);
      if (!person || person.organisationId !== organisationId) return [];
      const parents = new Map(
        [...units.values()].filter(u => u.organisationId === organisationId).map(u => [u.id, u.parentId]),
      );
      const leadersOf = (unitId: string) =>
        [...people.values()]
          .filter(
            p =>
              p.id !== personId &&
              p.enabled &&
              p.organisationId === organisationId &&
              p.assignments.some(a => a.unitId === unitId && a.role === 'manager'),
          )
          .map(p => p.id);
      return lineUpwards(person.assignments, parents, leadersOf);
    },
  };
  return {
    ...directory,
    /** Put a person in the directory, or change them, as provisioning would. */
    setPerson(person: MemoryDirectoryPerson) {
      people.set(person.id, structuredClone(person));
    },
    /** Put a unit in the tree, or move or rename it. */
    setUnit(unit: UnitNode & { organisationId: string; label: string }) {
      units.set(unit.id, { ...unit });
    },
  };
}
export type MemoryBoardingDirectory = ReturnType<typeof memoryBoardingDirectory>;
