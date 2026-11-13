import type {
  AuthenticatedContext,
  BoardingCondition,
  BoardingEvent,
  BoardingItemKind,
  BoardingOwnerRole,
  Subject,
} from '@clew/contracts';

/**
 * The ports of the boarding module (D124): introduction and leaving plans, Clew's third owned domain. Everything the use
 * cases read and write in Clew's own tables happens inside one `BoardingStore` transaction, together with the audit row
 * and the owners' cards (`WorkItemTx`), so a plan, its items and their cards commit or roll back as one, as talks'
 * action points do. `adapters/postgres.ts` runs in the server, `adapters/memory.ts` in the unit tests, both held to
 * `tests/boarding-store-contract.ts`. Whom the actor manages and what the layers match on come in as a function filled
 * in composition (`Staff`), so the module imports neither the people module nor the directory's tables.
 *
 * Every instant is an ISO string and every date a `YYYY-MM-DD` calendar day in Swedish time, handed in by the use case
 * from `clock`; every id comes from `ids`. Text is plain here: sealing a title a manager typed is the Postgres adapter's
 * job (`Sealer`). No audit entry carries such a title or a person's name.
 */

/** A layer of template items (D124): the event it is for and whom it applies to. `value` is null for `all`. */
export interface LayerRecord {
  id: string;
  organisationId: string;
  event: BoardingEvent;
  name: string;
  condition: BoardingCondition;
  value: string | null;
  /** The actor that imported it, such as `person:<id>` or `operator:cli`. */
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}
/** One template item of a layer, in its place. Template text an administrator wrote: never sealed, names nobody. */
export interface LayerItemRecord {
  id: string;
  layerId: string;
  position: number;
  title: string;
  kind: BoardingItemKind;
  ownerRole: BoardingOwnerRole;
  offsetDays: number;
  tiedTo: string | null;
}
/** One person's introduction or leaving (D124): open while `closedAt` is null, at most one open per person and event. */
export interface PlanRecord {
  id: string;
  organisationId: string;
  personId: string;
  event: BoardingEvent;
  /** The first day, or the last day of a leaving: entered or confirmed by the manager, never a directory date. */
  anchorOn: string;
  buddyId: string | null;
  /** The manager who started it; null once they were erased. */
  startedBy: string | null;
  startedAt: string;
  closedAt: string | null;
}
/** One item of a plan. Its owner's card is `threadId`; null once the card is removed by erasure. */
export interface ItemRecord {
  id: string;
  planId: string;
  position: number;
  /** Plain here. Template text when `added` is false; when true, free text the Postgres adapter seals at rest. */
  title: string;
  /** A manager typed the title for this plan: never in an audit row, a log line, a trace or a card. */
  added: boolean;
  kind: BoardingItemKind;
  ownerRole: BoardingOwnerRole;
  ownerId: string | null;
  dueOn: string;
  doneAt: string | null;
  doneBy: string | null;
  threadId: string | null;
  /** The layer it was copied from; null for one a manager added (or once that layer is gone). */
  sourceLayerId: string | null;
  tiedTo: string | null;
  createdAt: string;
}
export type ItemPatch = Partial<Pick<ItemRecord, 'doneAt' | 'doneBy'>>;
/** A person as the domain names them: to answer who owns what, and whether the person a plan is about is still active. */
export interface PersonRef {
  id: string;
  organisationId: string;
  name: string;
  userName: string | null;
  enabled: boolean;
}
/** One audit row, written in the same transaction as the change. Metadata only: ids, dates, counts and roles. */
export interface BoardingAudit {
  actor: string;
  action: string;
  subject: string;
  at: string;
  details?: Record<string, unknown>;
}
/** What `BoardingTx.erasePerson` did. */
export interface Erased {
  /** Plans removed because they were about the person, with their items. */
  plans: number;
  items: number;
  /** Rows of other people's plans and items from which the person was removed (buddy, started by, owner, done by). */
  cleared: number;
  /** The cards to remove with `WorkItemTx.remove`: of every item of the plans removed, and of every item they owned. */
  threadIds: string[];
}
/** The whole domain for one organisation, titles opened; the use case turns it into `clew.boarding/1`. */
export interface BoardingExport {
  layers: Array<LayerRecord & { items: LayerItemRecord[] }>;
  plans: PlanRecord[];
  items: ItemRecord[];
}

/**
 * The owner's card of an item (D124): a pushed thread in the owner's stream with the due day. Its title is the template
 * title an administrator wrote, or, for an item a manager typed, a fixed sentence: never the free text and never a
 * name, since title, summary and messages are what the assistant reads. The plan's person is the card's `subject` (D97
 * item 6), a key never drawn on the card. Its timer, of kind `boarding`, brings the card back the morning after the due
 * day while the item is open. Implemented in composition over the thread store's transaction, on the same database
 * transaction as the `BoardingTx` it belongs to, as `composition/talk-work-items.ts` does for talks.
 */
export interface WorkItemTx {
  /**
   * Insert the owner's open card `threadId`, admit its delivery, write its message and its `thread.pushed` audit row, and
   * schedule its timer for 06:00 Europe/Stockholm on the day after `dueOn`. Call it before the item that names
   * `threadId` is inserted, since that row refers to the card. `title` is the template title, or null for an item a
   * manager typed. The owner need not be able to sign in yet: the card waits in their stream.
   */
  open(input: {
    threadId: string;
    personId: string;
    itemId: string;
    planId: string;
    event: BoardingEvent;
    title: string | null;
    dueOn: string;
    at: string;
    subject?: Subject;
  }): Promise<void>;
  /** Mark the card handled and cancel its timer: the item is done (`done`), or its plan was closed (`closed`). */
  close(threadId: string, at: string, why: 'done' | 'closed'): Promise<void>;
  /** Open the card again and schedule its timer as `open` does; a day already past gives a timer due at once. */
  reopen(threadId: string, dueOn: string, at: string): Promise<void>;
  /**
   * The timer fired at `generation`: when it is still active at that generation and due by `at`, mark it fired, bring
   * the card back (open, through a reminder delivery) and return true. Otherwise change nothing and return false.
   */
  fire(threadId: string, generation: number, at: string): Promise<boolean>;
  /** Erasure: the cards gone with their messages, deliveries and timers (their workflows cancelled after commit). */
  remove(threadIds: readonly string[]): Promise<void>;
}

/** The store's refusal of a second open plan of one person and event (the index `boarding_plan_open`). */
export class PlanTaken extends Error {
  constructor() {
    super('The person already has an open plan of this event.');
    this.name = 'PlanTaken';
  }
}

/** Everything a boarding use case reads and writes in one transaction. Reads that a write follows take a row lock. */
export interface BoardingTx {
  // Layers.
  /** Serialises imports of one organisation's layers: the first call in a transaction waits for any other. */
  lockLayers(organisationId: string): Promise<void>;
  /** The organisation's layers, of one event or of both, by event and then name in Swedish order. */
  layers(organisationId: string, event?: BoardingEvent): Promise<LayerRecord[]>;
  /** The items of these layers, by layer and position. */
  layerItems(layerIds: readonly string[]): Promise<LayerItemRecord[]>;
  /** Insert a layer. One with the same name and event, without regard to case, is refused. */
  insertLayer(layer: LayerRecord): Promise<void>;
  /** Change a layer's name as written (the same without regard to case), its condition and its value. */
  updateLayer(id: string, patch: Pick<LayerRecord, 'name' | 'condition' | 'value' | 'updatedAt'>): Promise<void>;
  /** Replace every item of a layer with these. */
  replaceLayerItems(layerId: string, items: readonly LayerItemRecord[]): Promise<void>;
  // Plans.
  /** One plan; locked with `lock`, for a write that follows. */
  plan(id: string, lock?: boolean): Promise<PlanRecord | undefined>;
  /** The plans about these people, open and closed, newest first. */
  plansAbout(personIds: readonly string[]): Promise<PlanRecord[]>;
  /** The open plans this person started, newest first. */
  openPlansStartedBy(personId: string): Promise<PlanRecord[]>;
  /** Insert a plan. A second open plan of the person and event is refused with `PlanTaken`. */
  insertPlan(plan: PlanRecord): Promise<void>;
  closePlan(id: string, at: string): Promise<void>;
  // Items.
  /** The items of these plans, by plan and position. */
  items(planIds: readonly string[]): Promise<ItemRecord[]>;
  /** One item, locked. */
  item(id: string): Promise<ItemRecord | undefined>;
  /** The item whose card this is, locked: what the timer knows. */
  itemByThread(threadId: string): Promise<ItemRecord | undefined>;
  insertItem(item: ItemRecord): Promise<void>;
  updateItem(id: string, patch: ItemPatch): Promise<void>;
  // People.
  /** These people as the domain names them; an unknown id is absent. */
  persons(ids: readonly string[]): Promise<PersonRef[]>;
  // Erasure and export.
  /**
   * Remove every plan about the person with its items, and remove them from the rest (null `buddyId`, `startedBy`,
   * `ownerId` with the card pointer, `doneBy`). Returns the counts and the cards to remove; the use case passes those to
   * `workItems.remove` in the same transaction.
   */
  erasePerson(personId: string): Promise<Erased>;
  /** Every layer, plan and item of the organisation, titles opened. */
  exportOrganisation(organisationId: string): Promise<BoardingExport>;
  audit(entry: BoardingAudit): Promise<void>;
  workItems: WorkItemTx;
}
export interface BoardingStore {
  transaction<T>(fn: (tx: BoardingTx) => Promise<T>): Promise<T>;
}

/** A unit of the organisation tree as the layers match on it: its id and the unit above it. */
export interface UnitNode {
  id: string;
  parentId: string | null;
}
/** One of the actor's reports as the layers match on them (D124), read from the directory when asked. */
export interface Report {
  id: string;
  name: string;
  userName: string | null;
  enabled: boolean;
  /** The units they are assigned to. */
  unitIds: string[];
  /** The codes of the positions they hold. */
  positionCodes: string[];
  /** Their employments' types and start dates as the directory wrote them; a start date only prefills a suggestion. */
  employments: Array<{ employmentType?: string; startDate?: string }>;
}
/** What `Staff` answers: whether the actor manages any unit, their reports, and the tree the unit layers walk. */
export interface Staffing {
  manages: boolean;
  reports: Report[];
  tree: UnitNode[];
}
/**
 * The actor's reports (D99 item 4, D117's `managed`: never a co-manager whose line runs elsewhere and never the actor's
 * own manager), each with what the layers match on, and the organisation's tree; read on every call, never stored.
 * Someone who manages no unit gets `{ manages: false, reports: [], tree }`.
 */
export type Staff = (persona: AuthenticatedContext) => Promise<Staffing>;
/** Seals a title a manager typed at rest, as approved execution input is. Used by the Postgres adapter only. */
export interface Sealer {
  seal(value: string, purpose: string): string;
  open(value: string, purpose: string): string;
}
/** A line in the server's log (D91): a message in English and counts, never a name or a title. */
export type BoardingLog = (message: string, ...details: unknown[]) => void;
export interface BoardingDeps {
  store: BoardingStore;
  staff: Staff;
  clock: () => Date;
  ids: () => string;
  log?: BoardingLog;
}
