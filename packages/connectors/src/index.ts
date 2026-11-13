import type { TSchema } from 'typebox';
import Ajv from 'ajv';
import addFormats from 'ajv-formats';
import type {
  About,
  ActionPath,
  Ask,
  Area,
  AreaFigure,
  AreaOverride,
  CapabilityOverride,
  ConnectorAudience,
  EntityKind,
  ConnectorState,
  EntityPage,
  MenuEntry,
  MenuHint,
  MenuIcon,
  PersonAccess,
  PersonRelation,
  Receipt,
  Relation,
  UnitAccess,
  ReceiptRow,
  SearchKind,
  SessionUser,
  SystemMark,
  PanelViewSpec,
  ThreadAction,
  ThreadItem,
  View,
  ViewEntry,
  ViewOpen,
} from '@clew/contracts';
import type { Figure } from './protocol';
import { menuEligible, menuRowOf } from './views';
import { viewOutputProblem } from './views';
import {
  DocumentBundleSchema,
  ENTITY_KEY_MAX,
  ENTITY_KEYS_MAX,
  HoldingsInputSchema,
  HoldingsOutputSchema,
  MAX_DOCUMENT_BYTES,
  RELATION_GRANTS,
  STRICT_RELATIONS,
  SiteHeaderOutputSchema,
  contractProblems,
  foldEntityKey,
  isEntityKind,
  type DocumentRequest,
  type DocumentContent,
  type HoldingsOutput,
  type SiteHeaderOutput,
} from '@clew/contracts';
import { Value } from 'typebox/value';
import { connectorProblems } from './validation';
import { namedInputs, type NamedInputs } from './named';
import { pathOf, unfilledInput } from './asks';
export {
  answersOf,
  asksFor,
  givenBy,
  pathOf,
  pendingAsks,
  unfilledInput,
  type AskingCapability,
  type GivingAction,
} from './asks';
export {
  MENU_DEFAULT_ICON,
  fieldTone,
  markFields,
  menuEligible,
  menuProblem,
  menuRowOf,
  openRef,
  placesOf,
  readsSummary,
  rowsKey,
  viewProblem,
  viewRows,
  viewSummary,
} from './views';
export { READING_CHARS, READING_ROWS, dateWords, fieldWords, modelReading } from './reading';

/**
 * The capability layer (D1, D3). A connector owns a Clew contract: capabilities with a kind, a scope and an
 * input/output schema. Everything the UI and the model see is derived from these descriptors: REST routes,
 * tool definitions, standing actions in an area, and the action slots on a card. Connectors never draw cards.
 *
 * Connectors never import each other (D20). A capability that needs another connector calls it through the `Clew`
 * handle it receives, which re-applies the other connector's scope for the same actor and refuses `execute`.
 * Bundled connectors are in-process `Connector` objects; third-party connectors are separate services behind the
 * connector protocol in `protocol.ts`, turned into the same `Connector` shape by `remote.ts` (D21).
 */
export type CapabilityKind = 'read' | 'propose' | 'execute';
export type ConnectorKind = 'core' | 'passthrough' | 'derived';
/**
 * The caller as capabilities see it: identity and scope, never tokens. `userName` is the person's provisioned directory
 * user name, signed into a connector's actor (D44) as the key other systems know them by (D97); absent without one.
 */
export type Actor = Pick<SessionUser, 'id' | 'name' | 'unitId' | 'unitLabel' | 'role'> & {
  userName?: string;
  /** The units the person follows up (D117), when the call has them. */
  units?: Array<{ unitId: string; unitLabel: string }>;
};
/** The actor a capability sees, cut from an authenticated context: identity and scope, never tokens. */
export const actorOf = (persona: Actor): Actor => ({
  id: persona.id,
  name: persona.name,
  unitId: persona.unitId,
  unitLabel: persona.unitLabel,
  role: persona.role,
  ...(persona.userName ? { userName: persona.userName } : {}),
  ...(persona.units?.length ? { units: persona.units.map(u => ({ unitId: u.unitId, unitLabel: u.unitLabel })) } : {}),
});
/**
 * Who may call a capability. Declarative so a remote manifest can carry it: no `roles` means every signed-in
 * person. A bundled connector may give a function instead. Either way `run` narrows further (unit, own records).
 */
export interface ScopeRule {
  roles?: Array<Actor['role']>;
}
export type Scope = ScopeRule | ((actor: Actor) => boolean);
export const inScope = (scope: Scope, actor: Actor) =>
  typeof scope === 'function' ? scope(actor) : !scope.roles || scope.roles.includes(actor.role);

/**
 * The people or the units a call names, and how the caller stands to each (D117), as the registry resolved them from
 * Clew's own directory before the call: every key exactly as the input carries it, in the directory's spelling. A
 * remote connector receives it as `about` in the request body, which the assertion binds.
 */
export interface AboutClaim {
  entity: EntityKind;
  relations: Record<string, Relation>;
}
/** How the caller stands to one key the input names (D117): `asked` as the input spelled it, `key` as the directory does. */
export interface Related {
  asked: string;
  key: string;
  relation: Relation;
}
/**
 * The core rule of who may be asked about (D97 item 8, D117), as the registry asks it: how `actor` stands to each of
 * these keys of `entity`, for the relations in `admits` only. A key the directory does not know, or that names someone
 * outside `admits`, is absent. With `ids`, a person without a user name may be named by Clew's own id (a core
 * capability of Clew's own domains only). Throws when the directory cannot be read: never an empty answer for an error.
 * Composition binds it to the entities module over the people directory.
 */
export type RelationResolver = (
  actor: Actor,
  entity: EntityKind,
  keys: readonly string[],
  admits: readonly Relation[],
  options?: { ids?: boolean },
) => Promise<Related[]>;
/**
 * The directory could not say how the caller stands to someone (D117): a transient failure, never a refusal. A route
 * answers it as an error, and an approved write is left unsent as `source-unavailable`, not revoked.
 */
export class RelationsUnavailableError extends Error {
  constructor(cause?: unknown) {
    super('Katalogen svarar inte just nu.', { cause });
    this.name = 'RelationsUnavailableError';
  }
}
export { namedInputs, plainStringProperty, type NamedInputs } from './named';
/** What a capability gets besides the actor and the input: the rest of Clew, as capabilities, for that actor. */
export interface Clew {
  signal?: AbortSignal;
  chain?: string[];
  /** Stable approved intent key for a direct source write; never propagated through nested calls. */
  operationId?: string;
  /**
   * The people or units this call's input names and how the caller stands to each (D117): set by the registry for the
   * capability it runs, never carried into a nested call and never taken from a caller.
   */
  about?: AboutClaim;
  /**
   * The assistant made this call for the person (D122 item 6), as `RunContext.caller` says; absent for every other
   * caller. In process only: a remote connector is never told. A source that logs reads of people records it.
   */
  caller?: RunCaller;
  /** Run another connector's `read` or `propose` as the same actor. Scope applies; `execute` is refused. */
  call<O = unknown>(name: string, input?: unknown): Promise<O>;
  /**
   * The person's IdP token for an audience, by token exchange from the session behind this call (D26): the request's own,
   * or, for an approved write and a scan, the person's session that approved or asked for it while it is active. Missing
   * when no session is behind the run (a figure, a connector's callback, a scan no live session asked for); resolves
   * undefined under a session without IdP tokens. Never logged, never in an output.
   */
  delegate?: (audience: string) => Promise<string | undefined>;
}
/** What a caller with a session adds to a run. The registry carries it into every nested `clew.call`. */
export interface RunContext {
  signal?: AbortSignal;
  delegate?: Clew['delegate'];
  chain?: string[];
  operationId?: string;
  /**
   * Whom the input names, as `validate` resolved it just before (D117): an approved write's dispatch hands it on so the
   * directory is read once, and a failure to read it can only come before the dispatch is recorded. Used once, and only
   * for the same actor, capability and input it was issued for; anything else, or something not issued by this
   * registry, is ignored and the input resolved again. Never carried into a nested call.
   */
  resolution?: Resolution;
  /**
   * The person's own session asked for this read itself, directly (`/api/cap`): the one call on which a relation the
   * person holds by grant (`RELATION_GRANTS`, D121's `registrar`) is resolved, and then only for a capability of a core
   * connector. Never carried into a nested call, so a read reached through any connector (a callback, a `clew.call`, a
   * scan), a card, a tool, a job or a figure sees the person as the colleague they are.
   */
  direct?: boolean;
  /**
   * Who made the call when it was not the person themself (D122 item 6): `assistant`, a read the assistant made in a
   * conversation turn for the person. Carried into every nested in-process call, since the read is still the
   * assistant's, and handed to the capability as `clew.caller`; never sent to a remote connector. It grants nothing and
   * is never `direct`: a call the assistant makes resolves no relation held by grant (D122 item 5).
   */
  caller?: RunCaller;
}
/** Who made a call for the person, when it was not the person themself (D122 item 6). */
export type RunCaller = 'assistant';
/** What `Registry.validate` resolved about whom an input names (D117): opaque, issued and redeemed by one registry. */
export class Resolution {
  private constructor() {}
  /** @internal The registry's own constructor; a caller cannot make one the registry will accept. */
  static issue() {
    return new Resolution();
  }
}

export type WriteSafety =
  | { strategy: 'manual' }
  | { strategy: 'deduplicated'; retentionSeconds: number; lookup: string }
  | { strategy: 'conditional'; lookup: string };

export interface Capability<I = unknown, O = unknown> {
  review?: string;
  execution?: WriteSafety;
  /** `connector.verb`, stable, e.g. `finance.approveInvoices`. */
  name: string;
  kind: CapabilityKind;
  /** Swedish, shown as a button label. */
  title: string;
  /** Swedish, read by the model when `model` is true. */
  description: string;
  input: TSchema;
  output: TSchema;
  /**
   * Exposed as a tool to the model. `execute` defaults to false and should stay so (D8). What the model reads of the
   * output is derived from the declared view by `modelReading`, the same for every connector: nothing a capability runs
   * decides it.
   */
  model: boolean;
  /** Who may call it. Evaluated on every call; never trusts the browser. */
  scope: Scope;
  /** For a `<id>.search` capability (D26): what it can find, so the composite search skips sources that cannot hold the answer. */
  kinds?: SearchKind[];
  /** How Clew draws the output (D38). Absent means the generic panel rules. */
  view?: View;
  /** What the view's row is called and marked with when an administrator puts it in the menu (D40). */
  menu?: MenuHint;
  /** For a `propose` (D55): the fact kinds it answers for with step drafts of its own connector. Input is a fact envelope, output a follow response. */
  follows?: string[];
  /** The fact kind this capability brings about (D55); one of the connector's `facts`. */
  creates?: string;
  /**
   * What its rows concern (D97): a read asked with a batch of keys, or a propose or execute that takes one in `param`.
   * Only Clew's own connectors may add `page`, the owned domain's page where the person writes (D95, D96); a manifest
   * cannot carry it, so a remote connector never claims a page inside Clew.
   */
  about?: About & { page?: EntityPage };
  /**
   * Who may be asked about through it (D117): the relations a caller may have to a person its input names, and on a
   * capability not about a person the input property that takes the key. The registry enforces it on every path. Only
   * Clew's own connectors may add `ids`: a person without a user name may then be named by Clew's own id, as the talks
   * domain names them; a manifest cannot carry it, since Clew's id is never sent to a connector. Only they may admit
   * `registrar` (D121): the protocol's relations are `PROTOCOL_PERSON_RELATIONS`, so a manifest cannot carry it either,
   * and a connector is never told it.
   */
  person?: Omit<PersonAccess, 'admits'> & { admits?: PersonRelation[]; ids?: true };
  /** On a capability about a unit (D117): the relations a caller may have to the unit, `manages` when absent. */
  unit?: UnitAccess;
  /** On a propose or execute (D112): what the person fills in before it runs, each naming one input property. */
  asks?: Ask[];
  /** On an execute (D112): a read of the same connector, same input, that says what the write will do where. */
  effect?: string;
  /**
   * On a read of Clew's own connectors only: Clew's own page where its rows are worked through, a path inside Clew
   * (`ViewEntry.page`). Whatever opens the read without input (a figure's `opens`, a card's read, an answer's "Visa
   * allt") leads there, and the read's own page stays for an address that names it. A manifest cannot carry it, so a
   * remote connector never claims a page inside Clew, as with `about.page`.
   */
  page?: string;
  run: (actor: Actor, input: I, clew: Clew) => Promise<O>;
}
/** A capability is a search source when it is named `<id>.search` and is a read (D26); the composite `clew.search` is never one itself. */
export const isSearchSource = (c: Pick<Capability, 'name' | 'kind'>, connectorId: string) =>
  c.kind === 'read' && c.name === connectorId + '.search' && connectorId !== SEARCH_CONNECTOR;
/** The core connector that owns the composite search and the question area. */
export const SEARCH_CONNECTOR = 'clew';
/** A capability is an errand source when it is named `<id>.errands` and is a read (D35, D89); the composite `clew.errands` is never one itself. */
export const isErrandSource = (c: Pick<Capability, 'name' | 'kind'>, connectorId: string) =>
  c.kind === 'read' && c.name === connectorId + '.errands' && connectorId !== SEARCH_CONNECTOR;
/**
 * A capability is a request source when it is named `<id>.requests` and is a read (D123): what a person ordered or
 * reported in a service desk. Kept apart from the errand profile; the composite `clew.requests` is never one itself.
 */
export const isRequestSource = (c: Pick<Capability, 'name' | 'kind'>, connectorId: string) =>
  c.kind === 'read' && c.name === connectorId + '.requests' && connectorId !== SEARCH_CONNECTOR;
/** A capability is a news source when it is named `<id>.news` and is a read (D112, amended 2026-11-11); the composite `clew.news` is never one itself. */
export const isNewsSource = (c: Pick<Capability, 'name' | 'kind'>, connectorId: string) =>
  c.kind === 'read' && c.name === connectorId + '.news' && connectorId !== SEARCH_CONNECTOR;
/** The built-in connector of the talks domain (D96 item 9): Clew's own module, which answers the talks profile while it is enabled. */
export const TALKS_CONNECTOR = 'talks';
/** A capability answers the talks profile when it is named `<id>.talks` and is a read (D96 item 8); the composite `clew.talks` never does. */
export const isTalkSource = (c: Pick<Capability, 'name' | 'kind'>, connectorId: string) =>
  c.kind === 'read' && c.name === connectorId + '.talks' && connectorId !== SEARCH_CONNECTOR;
/** A capability lists action points when it is named `<id>.commitments` and is a read (D96 item 8); the composite `clew.commitments` never does. */
export const isCommitmentSource = (c: Pick<Capability, 'name' | 'kind'>, connectorId: string) =>
  c.kind === 'read' && c.name === connectorId + '.commitments' && connectorId !== SEARCH_CONNECTOR;
/** The built-in connector of the competence domain (D108 item 13): Clew's own module, switched on by an administrator. */
export const COMPETENCE_CONNECTOR = 'competence';
/** The built-in connector of the follow-up dialogue (D118): Clew's own module, a manager's dialogue per unit. */
export const DIALOGUE_CONNECTOR = 'dialogue';
/** The built-in connector of introduction and leaving plans (D124): Clew's own module, switched on by an administrator. */
export const BOARDING_CONNECTOR = 'boarding';
const TALK_COMPOSITE = SEARCH_CONNECTOR + '.talks';
const COMMITMENT_COMPOSITE = SEARCH_CONNECTOR + '.commitments';
/**
 * The one system that answers the talks profile for a person (D96 item 9), as `Registry.talkSource` names it. At least
 * one of `talks` and `commitments` is present: the round is usually a manager's read, the action points everyone's.
 */
export interface TalkSource {
  /** Clew's own module (`TALKS_CONNECTOR`) answers, so Clew's pages can write. */
  builtIn: boolean;
  connectorId: string;
  /** The answering system as a person reads it: the connector's `source`. */
  source: string;
  /** The connector's `<id>.talks` read, when it declares one the person may call. */
  talks?: string;
  /** The same connector's `<id>.commitments` read, when it declares one the person may call. */
  commitments?: string;
}
/**
 * A read about an entity kind as `Registry.aboutReads` names it for one person (D97): what the entities module needs to
 * offer it as a lens, a column or a section, and to call it.
 */
export interface AboutRead {
  name: string;
  connectorId: string;
  /** The source as a person reads it: the connector's `source`. */
  source: string;
  title: string;
  /** The declared table or list, with a row's `open` only when the person may call that read. */
  view: View;
  /** The page of Clew's own domain where the person writes about one entity (D95, D96), from a core connector. */
  page?: EntityPage;
  /** The most keys one call takes: the read's own `maxItems`, never more than `ENTITY_KEYS_MAX`. */
  batch: number;
  /** The administrator offers it under Visa on the entity's list (D97 item 3). */
  lens: boolean;
  /** The field of its view the administrator shows as a column on "Alla" (D97 item 4). */
  column?: string;
  /** The connector is one of Clew's own (`kind: 'core'`): the source is Clew's own domain (D97). */
  core?: true;
  /** The relations it admits (D117): a key of anyone else is never sent, so the entities module does not ask. */
  admits: readonly Relation[];
}
/** A propose or execute about an entity kind as `Registry.aboutActions` names it for one person (D97). */
export interface AboutAction {
  name: string;
  connectorId: string;
  source: string;
  title: string;
  kind: 'propose' | 'execute';
  /** The input property that takes the entity's key. */
  param: string;
  /** What the person passes through before it runs (D112): the asks less the key, the effect and the description. */
  path: ActionPath;
  /** The connector is one of Clew's own (`kind: 'core'`). */
  core?: true;
  /** The relations it admits (D117): it is offered only on an entity the reader stands to so. */
  admits: readonly Relation[];
}
/** Plain ordering of ids and names, the same in every locale. */
const compare = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);
/** The longest key a card row may name an entity by (`SubjectSchema`). */
const SUBJECT_KEY_MAX = ENTITY_KEY_MAX;
/** What an execute capability returns: the source system's answer, row by row, read back. */
export interface ExecuteResult {
  headline: string;
  rows: ReceiptRow[];
  /** Name of the capability that reverses this within the undo window, if any. */
  undoCapability?: string;
  undoMinutes?: number;
  undoInput?: Record<string, unknown>;
}
/** A thread a connector wants to push. `topic` is the idempotency key per person. */
export interface ThreadDraft {
  occurrences?: Array<{ key: string; revision: string; period: string }>;
  topic: string;
  area: string;
  title: string;
  summary: string;
  reason: string;
  items?: ThreadItem[];
  actions: ThreadAction[];
  waitingOn?: string | null;
  deadline?: string | null;
}
/** A fact kind a connector creates (D55). The kind's name is its contract (D37): a breaking change is a new kind. */
export interface FactDeclaration {
  kind: string;
  title: string;
  attributes: TSchema | Record<string, unknown>;
}
/** The follower a binding names, as the job assembler sees it: `available` is the actor's visibility, switch and scope for it. */
export interface FollowerRef {
  name: string;
  connectorId: string;
  source: string;
  follows: string[];
  available: boolean;
}
export interface AreaDefinition {
  id: string;
  title: string;
  roles: Array<Actor['role']>;
  /** The area's figure (D54): the connector's answer, or null. The registry turns a throw into the warning figure and checks `opens`. */
  figure?: (actor: Actor, clew: Clew) => Promise<Figure | null>;
  /** Capability names the area offers: a propose or execute is suggested under "Menar du" on Hem; a read takes the area's mark. */
  standing: string[];
  schedules: Array<{ label: string; when: string }>;
  /** One of Clew's icons for the area's mark on its cards and views (D41, D71). */
  icon?: MenuIcon;
  /**
   * For Clew's own connectors only: whether the area exists for this person at all. The errand area is there only for
   * a person with a case system (D89). A connector outside Clew cannot declare it: a manifest carries no code.
   */
  offered?: (actor: Actor) => boolean;
}
export interface Connector {
  documents?: (actor: Actor, request: DocumentRequest, clew: Clew) => Promise<DocumentContent>;
  delegation?: { audience: string };
  id: string;
  kind: ConnectorKind;
  /** Swedish label of the source, shown on cards: "Personalsystemet", "Ekonomisystemet". */
  source: string;
  areas: AreaDefinition[];
  capabilities: Capability<any, any>[];
  /** Explicit dependencies for cross-connector calls. Core composition may use '*'; remote manifests cannot. */
  uses?: string[];
  /** The fact kinds this connector creates (D55), `<id>:<kind>`, each with the JSON Schema of its attributes. */
  facts?: FactDeclaration[];
  /** The connector's triggers: what it wants to push for this actor right now. Deterministic, no model. */
  scan?: (actor: Actor, clew: Clew) => Promise<ThreadDraft[] | ScanObservation>;
  /** The read capability that answers the shared header (D88), when this connector gives Clew one. */
  header?: string;
  /** The protocol a remote connector's manifest is written to (D60); absent for Clew's own, which follow the current one. */
  protocol?: number;
  /**
   * The reads Clew makes as the installation itself (D119), apart from `capabilities`: no person's path reaches them.
   * Only `Registry.holdingsSources` and `Registry.readHoldings` call them.
   */
  installation?: InstallationRead<any, any>[];
}
/**
 * A read Clew makes as the installation itself, with no person behind the call (D119): no actor, nobody resolved, no
 * delegated token. Not a capability, so it is never in `capabilities`, never a tool, a view, a card's action or a
 * callback's target. Today only the holdings profile, `<id>.holdings` (D108 item 9).
 */
export interface InstallationRead<I = unknown, O = unknown> {
  /** `<connector id>.<profile>`, one of `INSTALLATION_PROFILES`. */
  name: string;
  /** Swedish, as an administrator reads it. */
  title: string;
  description: string;
  input: TSchema;
  output: TSchema;
  run: (input: I, context: { signal?: AbortSignal }) => Promise<O>;
}

export class CapabilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CapabilityError';
  }
}
/** The protocol's error kinds (`ProtocolError.code`). */
export type SourceErrorCode = 'invalid' | 'denied' | 'not-found' | 'unavailable' | 'unknown';
/**
 * Why a read made as the installation gave no answer (D119), in the protocol's error kinds: `not-found` (no enabled
 * connector declares it for the installation), `invalid` (the input was refused, Clew's or the source's: a cursor the
 * source does not know), `denied` (the source refused Clew's assertion or its own credential: an operator's matter),
 * `unavailable` (no answer in time, or a source that is down), `unknown` (anything else, an answer outside the declared
 * shape or the profile among them). The message is Swedish and names no person.
 */
export class InstallationReadError extends CapabilityError {
  constructor(
    readonly code: SourceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'InstallationReadError';
  }
}
/**
 * What each kind of failure of a read made as the installation says (D119), in Clew's words: a connector's own message
 * is never passed on, into a log, an audit row or an administrator's check, since nobody knows what it carries (D91).
 * `source` is the connector's name as the administration shows it.
 */
export function installationReadText(code: SourceErrorCode, source: string): string {
  switch (code) {
    case 'invalid':
      return `${source} godtog inte förfrågan.`;
    case 'denied':
      return `${source} godtar inte Clews intyg.`;
    case 'not-found':
      return UNKNOWN;
    case 'unavailable':
      return `${source} svarar inte just nu.`;
    default:
      return 'Källans svar kunde inte verifieras.';
  }
}
/** An enabled connector that answers the holdings profile for the installation (D119). */
export interface HoldingsSource {
  connectorId: string;
  /** The system as a person reads it: the connector's `source`. */
  source: string;
}
/**
 * The port Clew's competence register copies every source's holdings through (D108 item 9, D119). Only the core holds
 * it: composition binds it to the registry, and nothing a person, the model or a connector reaches can call it.
 * `readHoldings` reads one page as the installation, validated against the read's declaration and the profile, and
 * throws `InstallationReadError` with the protocol's error kind.
 */
export interface HoldingsReader {
  holdingsSources(): Promise<HoldingsSource[]>;
  readHoldings(connectorId: string, cursor?: string, options?: { signal?: AbortSignal }): Promise<HoldingsOutput>;
}
/** The schemas of each profile Clew reads as the installation (D119), checked on every call besides the declaration. */
const INSTALLATION_PROFILE_SCHEMAS: Record<string, { input: TSchema; output: TSchema }> = {
  holdings: { input: HoldingsInputSchema, output: HoldingsOutputSchema },
};

/**
 * What an administrator decided about a connector (D23): on or off, who sees it, whether it pushes cards and offers
 * tools, and per-capability switches. Missing governance denies access. Narrowing only: an override can switch a
 * capability or its tool off, never on. A view in the menu (D40) is the
 * one thing that is switched on (`menu: true` on the capability): it is a place in the menu, not access, and no connector
 * takes that place by itself.
 */
export interface Governance {
  state: ConnectorState;
  audience: ConnectorAudience;
  scanEnabled: boolean;
  toolsEnabled: boolean;
  capabilities: Record<string, CapabilityOverride>;
  /** Per area (D54): `figure: false` when the administrator switched the area's figure off on Hem. */
  areas?: Record<string, AreaOverride>;
  /** The row's place in the registration order (D71), for the hue of the system's mark; absent for Clew's own. */
  ordinal?: number;
  /** The connector that gives Clew its shared header (D88): an administrator's explicit choice, one row at a time. */
  header?: boolean;
}
export const openGovernance = (): Governance => ({
  state: 'enabled',
  audience: { mode: 'all' },
  scanEnabled: true,
  toolsEnabled: true,
  capabilities: {},
});
export const deniedGovernance = (): Governance => ({
  state: 'disabled',
  audience: { mode: 'all' },
  scanEnabled: false,
  toolsEnabled: false,
  capabilities: {},
});

export interface ScanObservation {
  drafts: ThreadDraft[];
  observation?: {
    scope: string;
    observedAt: string;
    version: string;
    completeness: 'complete' | 'delta' | 'partial' | 'unavailable' | 'authorization-required';
    exhausted: boolean;
    tombstones?: Array<{ key: string; period: string }>;
  };
}
/** A person is in the audience by role, by unit or by group (any of). Groups are the provisioned groups' external ids (D68). */
/** An actor with the provisioned groups the authenticated context carries (D68); a bare actor has none. */
export type AudiencedActor = Actor & { groups?: readonly string[] };
export const inAudience = (audience: ConnectorAudience, actor: AudiencedActor) =>
  audience.mode === 'all' ||
  !!audience.roles?.includes(actor.role) ||
  !!audience.units?.includes(actor.unitId) ||
  !!audience.groups?.some(g => actor.groups?.includes(g));
/** Everything the person may not reach reads like "unknown", so a hidden connector cannot be probed (D23). */
export const UNKNOWN = 'Okänd förmåga.';

export interface RegistryOptions {
  /** Bounded figure fan-out. One total budget includes queued sources; order remains the manifest order. */
  figures?: { concurrency?: number; totalMs?: number };
  /**
   * A draft the scan refused (D35), or a figure's `opens` the registry dropped (D54, topic `figure:<area>`): the server
   * logs it, the connector check fails on it. The other drafts still become cards, the figure is drawn without its link.
   */
  onRefused?: (connectorId: string, topic: string, problem: string) => void;
  /**
   * Who may be asked about (D117): how the caller stands to the people or units an input names. Without it nobody may
   * be asked about anyone: every key is left out and a call that names one is refused, so a registry built without the
   * rule fails closed.
   */
  relations?: RelationResolver;
}

export class Registry implements HoldingsReader {
  private readonly ajv = addFormats(new Ajv({ allErrors: false, strict: false, addUsedSchema: false }));
  private validators = new WeakMap<object, ReturnType<Ajv['compile']>>();
  private refresh: () => Promise<void> = async () => {};
  private connectors = new Map<string, Connector>();
  private capabilities = new Map<string, { connector: Connector; capability: Capability<any, any> }>();
  /**
   * The reads Clew makes as the installation (D119), kept apart from `capabilities`: every person's path looks a name
   * up there, so a name here is as unknown to it as a name nobody declared.
   */
  private installationReads = new Map<string, { connector: Connector; read: InstallationRead<any, any> }>();
  private governed = new Map<string, Governance>();
  /** The inputs of each capability that name an entity (D117), drawn from the declarations at installation. */
  private named = new Map<string, NamedInputs>();
  /** What `validate` resolved, by the opaque handle it gave out (D117): redeemed once by `run`, for the same call only. */
  private resolutions = new WeakMap<
    Resolution,
    { actor: string; name: string; input: string; narrowed: { input: unknown; about?: AboutClaim } }
  >();
  constructor(private readonly options: RegistryOptions = {}) {}
  /** The inputs of a capability that name a person or a unit, and what it admits (D117); undefined when none does. */
  namedInputs(name: string): NamedInputs | undefined {
    return this.named.get(name);
  }
  /**
   * Who may be asked about, applied to one call (D97 item 8, D117). Every key the input names is resolved against the
   * caller's place in Clew's own directory: a key in `keys` the caller may not ask about is left out, a second spelling of
   * one person is left out, and a key that stays is written as the directory spells it. A single key (`about.param`,
   * `person.param` and the inputs that name a person without declaring it) that the caller may not ask about, or that is
   * not a string, refuses the call as an unknown capability is refused, so the answer never tells whether that person
   * exists; it is checked whether or not the input schema lists it. `about` is what the connector is told: each key sent
   * and its relation. A directory that cannot be read throws `RelationsUnavailableError`, never an empty answer.
   *
   * A relation held by grant (`RELATION_GRANTS`, D121) is admitted only where `granted` says so: the person's own session
   * asked a core connector's read directly (`RunContext.direct`). On any other call it is taken out of what the
   * capability admits before the resolver is asked, so a reader who holds it stands as they would without it.
   */
  private async narrow(
    actor: Actor,
    name: string,
    input: unknown,
    options: { granted?: boolean } = {},
  ): Promise<{ input: unknown; about?: AboutClaim }> {
    const declared = this.named.get(name);
    if (!declared) return { input };
    const named = options.granted
      ? declared
      : { ...declared, admits: declared.admits.filter(r => !(RELATION_GRANTS as readonly string[]).includes(r)) };
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new CapabilityError(UNKNOWN);
    const given = input as Record<string, unknown>;
    if (
      named.keys &&
      given.keys !== undefined &&
      (!Array.isArray(given.keys) || given.keys.some(k => typeof k !== 'string'))
    )
      throw new CapabilityError(UNKNOWN);
    const keys = named.keys ? ((given.keys as string[] | undefined) ?? []) : [];
    const single = named.params.filter(p => given[p] !== undefined);
    if (single.some(p => typeof given[p] !== 'string')) throw new CapabilityError(UNKNOWN);
    if (!named.keys && !single.length) return { input };
    const asked = [...new Set([...keys, ...single.map(p => given[p] as string)])];
    let related: Related[] = [];
    if (asked.length && this.options.relations)
      try {
        related = await this.options.relations(actor, named.entity, asked, named.admits, { ids: named.ids });
      } catch (cause) {
        throw new RelationsUnavailableError(cause);
      }
    // The resolver answers for the relations admitted; anything else it says is not trusted.
    const found = new Map(related.filter(r => named.admits.includes(r.relation)).map(r => [r.asked, r]));
    const relations: Record<string, Relation> = {};
    const out: Record<string, unknown> = { ...given };
    if (named.keys) {
      const seen = new Set<string>();
      out.keys = keys.flatMap(k => {
        const r = found.get(k);
        const folded = r && foldEntityKey(named.entity, r.key);
        if (!r || seen.has(folded!)) return [];
        seen.add(folded!);
        relations[r.key] = r.relation;
        return [r.key];
      });
    }
    for (const p of single) {
      const r = found.get(given[p] as string);
      if (!r) throw new CapabilityError(UNKNOWN);
      out[p] = r.key;
      relations[r.key] = r.relation;
    }
    return { input: out, about: { entity: named.entity, relations } };
  }
  /** What `validate` resolved for exactly this call, once (D117); undefined for anything else, which is resolved again. */
  private redeem(actor: Actor, name: string, input: unknown, resolution: Resolution | undefined) {
    const kept = resolution && this.resolutions.get(resolution);
    if (!kept) return undefined;
    this.resolutions.delete(resolution!);
    return kept.actor === actor.id && kept.name === name && kept.input === JSON.stringify(input)
      ? kept.narrowed
      : undefined;
  }
  private check(connector: Connector) {
    const problems = connectorProblems(connector, schema => this.validator(schema));
    if (problems.length) throw new Error(problems[0]);
    // One name space for both: a person's name and the installation's never collide, whichever connector declares them.
    for (const name of [...connector.capabilities, ...(connector.installation ?? [])].map(c => c.name)) {
      const existing = this.capabilities.get(name) ?? this.installationReads.get(name);
      if (existing && existing.connector.id !== connector.id)
        throw new Error(`Capability ${name} is already registered.`);
    }
  }
  private install(connector: Connector) {
    for (const c of connector.capabilities) this.capabilities.set(c.name, { connector, capability: c });
    for (const r of connector.installation ?? []) this.installationReads.set(r.name, { connector, read: r });
    for (const [name, inputs] of namedInputs(connector)) this.named.set(name, inputs);
    this.connectors.set(connector.id, connector);
    return this;
  }
  register(connector: Connector) {
    if (this.connectors.has(connector.id)) throw new Error(`Connector ${connector.id} is already registered.`);
    this.check(connector);
    return this.install(connector);
  }
  /** Remove a connector and its capabilities; cards it pushed stay in the database. Its governance is forgotten too. */
  unregister(id: string) {
    const found = this.connectors.get(id);
    this.governed.delete(id);
    if (!found) return false;
    for (const c of found.capabilities) {
      this.capabilities.delete(c.name);
      this.named.delete(c.name);
    }
    for (const r of found.installation ?? []) this.installationReads.delete(r.name);
    this.connectors.delete(id);
    return true;
  }
  /** Register, replacing an earlier registration with the same id (a refetched manifest, a changed secret). Governance survives. */
  replace(connector: Connector) {
    // Validate the entire replacement before removing the working registration.
    this.check(connector);
    const governance = this.governed.get(connector.id);
    this.unregister(connector.id);
    this.install(connector);
    if (governance) this.governed.set(connector.id, governance);
    return this;
  }
  /** Apply an administrator's decision. Takes effect on the next call; nothing is restarted. */
  govern(id: string, governance: Governance) {
    this.governed.set(id, governance);
    return this;
  }
  governance(id: string): Governance {
    return this.governed.get(id) ?? deniedGovernance();
  }
  /** Installed by composition; a failed refresh aborts the invocation before any source access. */
  setRefresh(refresh: () => Promise<void>) {
    this.refresh = refresh;
  }
  async refreshGovernance() {
    await this.refresh();
  }
  /**
   * Validate an approval without performing its source effect. `pending` names asked properties (D112) the person
   * answers later, when they decide: the input may lack them though the schema requires them, and nothing else.
   * `subjects: false` is for reading what was already decided (D117): who the input names is resolved for a new effect,
   * an approval or a dispatch, not for showing a decision that someone has since moved away from.
   */
  async validate(
    actor: Actor,
    name: string,
    input: unknown,
    pending: readonly string[] = [],
    options: { subjects?: boolean } = {},
  ) {
    await this.refresh();
    const found = this.allowed(actor, name);
    if (!found) throw new CapabilityError(UNKNOWN);
    const asked = new Set((found.capability.asks ?? []).map(a => a.property));
    const waiting = pending.filter(p => asked.has(p));
    if (!this.validator(found.capability.input, waiting)(input))
      throw new CapabilityError('Ogiltig förfrågan till ' + name + '.');
    // A write about someone the person may not ask about is refused before it is approved (D117), as it is when it runs.
    if (options.subjects === false) return found;
    const narrowed = await this.narrow(actor, name, input);
    const resolution = Resolution.issue();
    this.resolutions.set(resolution, { actor: actor.id, name, input: JSON.stringify(input), narrowed });
    return { ...found, resolution };
  }
  private pendingValidators = new WeakMap<object, Map<string, ReturnType<Ajv['compile']>>>();
  private validator(schema: object, pending: readonly string[] = []) {
    if (pending.length) {
      const key = [...pending].sort().join(',');
      const forSchema = this.pendingValidators.get(schema) ?? new Map<string, ReturnType<Ajv['compile']>>();
      this.pendingValidators.set(schema, forSchema);
      let partial = forSchema.get(key);
      if (!partial) {
        const required = (schema as { required?: unknown }).required;
        partial = this.ajv.compile({
          ...JSON.parse(JSON.stringify(schema)),
          ...(Array.isArray(required) ? { required: required.filter(r => !pending.includes(r)) } : {}),
        });
        forSchema.set(key, partial);
      }
      return partial;
    }
    let validator = this.validators.get(schema);
    if (!validator) {
      validator = this.ajv.compile(schema);
      this.validators.set(schema, validator);
    }
    return validator;
  }
  /** Every registered connector, governed or not: for the loader and the administrator, never for a person's page. */
  list() {
    return [...this.connectors.values()];
  }
  connector(id: string) {
    return this.connectors.get(id);
  }
  /** Lookup by name without any check: for validation and routing. Use `allowed` before acting for a person. */
  find(name: string) {
    return this.capabilities.get(name);
  }
  /** A connector exists for this person: registered, switched on and the person is in its audience. */
  visible(actor: AudiencedActor, connectorId: string) {
    if (!this.connectors.has(connectorId)) return false;
    const g = this.governance(connectorId);
    return g.state === 'enabled' && inAudience(g.audience, actor);
  }
  /** A capability the person may call: visible connector, capability not switched off, and the connector's own scope. */
  allowed(actor: Actor, name: string) {
    const found = this.capabilities.get(name);
    if (!found || !this.visible(actor, found.connector.id)) return undefined;
    if (this.governance(found.connector.id).capabilities[name]?.enabled === false) return undefined;
    return inScope(found.capability.scope, actor) ? found : undefined;
  }
  /**
   * A system's place in the registration order (D71), which gives its mark the hue; null for Clew's own: a core
   * connector, or one whose row carries no ordinal (a bundled row).
   */
  ordinal(id: string): number | null {
    const connector = this.connectors.get(id);
    if (!connector || connector.kind === 'core') return null;
    return this.governance(id).ordinal ?? null;
  }
  /** The systems a person can see with what their marks need (D71): the source's word and the ordinal, in registration order, Clew's own last. */
  systems(actor: Actor): SystemMark[] {
    return this.listFor(actor)
      .map(c => ({ connector: c.id, source: c.source, ordinal: this.ordinal(c.id) }))
      .sort((a, b) => (a.ordinal ?? Infinity) - (b.ordinal ?? Infinity) || a.connector.localeCompare(b.connector));
  }
  /** The connectors a person can see, and the capabilities they may call: what `/api/connectors`, search and the typeahead list. */
  listFor(actor: Actor) {
    return this.list().filter(c => this.visible(actor, c.id));
  }
  capabilitiesFor(actor: Actor) {
    return [...this.capabilities.values()].filter(c => this.allowed(actor, c.capability.name));
  }
  /** The handle a connector gets to reach the rest of Clew as one actor: reads and proposals only, scope re-checked. */
  clewFor(actor: Actor, context: RunContext = {}, origin?: string): Clew {
    return {
      chain: context.chain ?? [],
      ...(context.signal ? { signal: context.signal } : {}),
      ...(context.operationId ? { operationId: context.operationId } : {}),
      ...(context.caller ? { caller: context.caller } : {}),
      call: async <O>(name: string, input: unknown = {}) => {
        await this.refresh();
        const found = this.capabilities.get(name);
        const owner = origin ? this.connectors.get(origin) : undefined;
        if (origin && (!this.visible(actor, origin) || !(owner?.uses?.includes(name) || owner?.uses?.includes('*'))))
          throw new CapabilityError(UNKNOWN);
        if ((context.chain?.length ?? 0) >= 8 || context.chain?.includes(name))
          throw new CapabilityError('Anropet innehåller en cirkulär förfrågan.');
        if (found?.capability.kind === 'execute')
          throw new CapabilityError('En anslutning kan inte utföra åtgärder i en annan anslutning.');
        return this.run<O>(actor, name, input, {
          delegate: context.delegate,
          chain: context.chain,
          signal: context.signal,
          ...(context.caller ? { caller: context.caller } : {}),
        });
      },
      ...(context.delegate ? { delegate: context.delegate } : {}),
    };
  }
  /**
   * Run a capability for an actor. Visibility, the capability switch and scope are checked here, so every path (REST,
   * tool, card action, connector callback) is equal. A hidden connector answers exactly as an unknown capability does.
   * Who may be asked about is checked here too (D117): an input that names a person or a unit reaches the connector
   * with only the keys the caller may ask about, and the connector is told how the caller stands to each.
   * The context (the session's delegate) travels into every nested call the capability makes.
   */
  async run<O = unknown>(actor: Actor, name: string, input: unknown, context: RunContext = {}): Promise<O> {
    return (await this.invoke<O>(actor, name, input, context)).output;
  }
  /** `run`, with what the call was narrowed to (D117): the input the connector got and what it was told. */
  private async invoke<O>(
    actor: Actor,
    name: string,
    input: unknown,
    context: RunContext,
  ): Promise<{ output: O; narrowed: { input: unknown; about?: AboutClaim } }> {
    await this.refresh();
    const found = this.capabilities.get(name);
    if (
      !found ||
      !this.visible(actor, found.connector.id) ||
      this.governance(found.connector.id).capabilities[name]?.enabled === false
    )
      throw new CapabilityError(UNKNOWN);
    if (!inScope(found.capability.scope, actor)) throw new CapabilityError('Du saknar behörighet för åtgärden.');
    if (!this.validator(found.capability.input)(input))
      throw new CapabilityError('Ogiltig förfrågan till ' + name + '.');
    // A relation held by grant (D121) only on the person's own direct read of a core connector's capability, and never
    // for a read the assistant makes, whatever else the context says (D122 item 5).
    const granted = context.direct === true && context.caller === undefined && found.connector.kind === 'core';
    const narrowed =
      this.redeem(actor, name, input, context.resolution) ?? (await this.narrow(actor, name, input, { granted }));
    const { resolution: _resolution, direct: _direct, ...nested } = context;
    const clew = this.clewFor(actor, { ...nested, chain: [...(context.chain ?? []), name] }, found.connector.id);
    const output = await found.capability.run(
      actor,
      narrowed.input,
      narrowed.about ? { ...clew, about: narrowed.about } : clew,
    );
    if (!this.validator(found.capability.output)(output))
      throw new CapabilityError('Källans svar kunde inte verifieras.');
    const viewError = viewOutputProblem(found.capability.view, output);
    if (viewError) throw new CapabilityError(viewError);
    // Permission can change while a source is answering. Do not release the result under the old policy.
    await this.refresh();
    if (!this.allowed(actor, name)) throw new CapabilityError(UNKNOWN);
    return { output: output as O, narrowed };
  }
  /** Metadata and binary bytes share the read's scope and source, with a final descriptor/policy check. */
  async document(actor: Actor, request: DocumentRequest, context: RunContext = {}): Promise<DocumentContent> {
    await this.refresh();
    const initial = this.allowed(actor, request.capability);
    if (initial?.capability.kind !== 'read' || !initial.connector.documents) throw new CapabilityError(UNKNOWN);
    const { output, narrowed } = await this.invoke<Record<string, unknown>>(
      actor,
      request.capability,
      request.input,
      context,
    );
    const found = this.allowed(actor, request.capability);
    if (found?.connector !== initial.connector) throw new CapabilityError(UNKNOWN);
    const view = found?.capability.view;
    const key = view?.kind === 'document' ? view.body : view?.kind === 'record' ? view.document : undefined;
    const bundle = key ? output[key] : null;
    if (!found?.connector.documents || found.capability.kind !== 'read' || !Value.Check(DocumentBundleSchema, bundle))
      throw new CapabilityError('Dokumentet finns inte.');
    const document = bundle.documents.find(d => d.id === request.document);
    if (
      !document ||
      bundle.ref !== request.ref ||
      bundle.revision !== request.revision ||
      document.revision !== request.documentRevision
    )
      throw new CapabilityError('Underlaget har ändrats. Öppna dokumentet igen.');
    // The bytes are asked for with the input the metadata read was narrowed to, and told the same relations (D117).
    const clew = this.clewFor(actor, context, found.connector.id);
    const content = await found.connector.documents(
      actor,
      { ...request, input: narrowed.input as DocumentRequest['input'] },
      narrowed.about ? { ...clew, about: narrowed.about } : clew,
    );
    if (
      content.bytes.length !== document.size ||
      content.bytes.length > MAX_DOCUMENT_BYTES ||
      content.mediaType !== document.mediaType ||
      content.revision !== document.revision
    )
      throw new CapabilityError('Dokumentet kunde inte verifieras.');
    const hash = new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(content.bytes)));
    if (Array.from(hash, b => b.toString(16).padStart(2, '0')).join('') !== document.sha256)
      throw new CapabilityError('Dokumentet kunde inte verifieras.');
    await this.refresh();
    if (this.allowed(actor, request.capability)?.connector !== found.connector) throw new CapabilityError(UNKNOWN);
    return { ...content, filename: document.filename };
  }
  /**
   * Areas for one actor: one entry per area definition of a visible connector whose roles include the actor's role.
   * Counts are filled in by the caller. `figures: false` skips the figure calls (the administrator's structural preview).
   */
  async areas(
    actor: Actor,
    options: { figures?: boolean; connector?: string; authorize?: () => Promise<unknown> } = {},
  ): Promise<Omit<Area, 'needsYou' | 'waiting' | 'urgency'>[]> {
    await this.refresh();
    const entries = [...this.connectors.values()].flatMap(connector =>
      (!options.connector || connector.id === options.connector) && this.visible(actor, connector.id)
        ? connector.areas.filter(area => area.roles.includes(actor.role)).map(area => ({ connector, area }))
        : [],
    );
    const wantsFigure = ({ connector, area }: (typeof entries)[number]) =>
      !!area.figure && options.figures !== false && this.governance(connector.id).areas?.[area.id]?.figure !== false;
    const figures: Array<AreaFigure | null> = entries.map(entry =>
      wantsFigure(entry) ? this.unavailableFigure(entry.connector) : null,
    );
    const queue = entries.map((entry, i) => ({ ...entry, i })).filter(wantsFigure);
    if (queue.length) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<undefined>(resolve => {
        timer = setTimeout(() => {
          controller.abort();
          resolve(undefined);
        }, this.options.figures?.totalMs ?? 2000);
      });
      let next = 0;
      const worker = async () => {
        while (!controller.signal.aborted && next < queue.length) {
          const { connector, area, i } = queue[next++]!;
          const clew = this.clewFor(actor, { signal: controller.signal }, connector.id);
          const answer = await Promise.race([
            this.figureOf(actor, connector, area.id, () => area.figure!(actor, clew)),
            expired,
          ]);
          if (!controller.signal.aborted && answer !== undefined) figures[i] = answer;
        }
      };
      try {
        const concurrency = Math.max(1, Math.floor(this.options.figures?.concurrency ?? 4));
        await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker));
      } finally {
        clearTimeout(timer);
      }
    }
    // Recheck the person and every result AFTER the whole batch, including figures that answered early.
    await options.authorize?.();
    await this.refresh();
    return entries.flatMap(({ connector, area }, i) => {
      if (
        this.connectors.get(connector.id) !== connector ||
        !this.visible(actor, connector.id) ||
        !area.roles.includes(actor.role) ||
        (area.offered && !area.offered(actor))
      )
        return [];
      const figure = wantsFigure({ connector, area }) ? figures[i]! : null;
      return [
        {
          id: area.id,
          title: area.title,
          connector: connector.id,
          source: connector.source,
          ...(area.icon ? { icon: area.icon } : {}),
          figure:
            figure?.opens && !this.allowed(actor, figure.opens.capability) ? { ...figure, opens: undefined } : figure,
          standing: area.standing.flatMap(name => {
            const found = this.allowed(actor, name);
            return found ? [{ capability: name, label: found.capability.title, kind: found.capability.kind }] : [];
          }),
          schedules: area.schedules,
        },
      ];
    });
  }
  private unavailableFigure(connector: Connector): AreaFigure {
    return { label: `${connector.source} svarar inte.`, tone: 'warn', unavailable: true };
  }
  /**
   * Why a figure's `opens` may not be a link, or undefined when it may (D54): it names a read of the same connector whose
   * view opens without input, the rule a view in the menu follows (D40).
   */
  figureProblem(connectorId: string, opens: string): string | undefined {
    const found = this.capabilities.get(opens);
    if (!found || found.connector.id !== connectorId)
      return `figure opens ${opens}, which is not a capability of ${connectorId}`;
    if (!menuEligible(found.capability))
      return `figure opens ${opens}, which is not a read with a view that opens without input`;
    return undefined;
  }
  /**
   * One area's figure for one actor (D54): a connector that throws or does not answer is the one warning figure (D8);
   * `opens` stays only when it may be a link and the person may call it, and is resolved to the view's title.
   */
  private async figureOf(
    actor: Actor,
    connector: Connector,
    areaId: string,
    read: () => Promise<Figure | null>,
  ): Promise<AreaFigure | null> {
    let answer: Figure | null;
    try {
      answer = await read();
    } catch {
      return this.unavailableFigure(connector);
    }
    if (!answer) return null;
    const { opens, ...figure } = answer;
    if (!opens) return figure;
    const problem = this.figureProblem(connector.id, opens);
    if (problem) {
      this.options.onRefused?.(connector.id, 'figure:' + areaId, problem);
      return figure;
    }
    const target = this.allowed(actor, opens);
    return target ? { ...figure, opens: { capability: opens, title: target.capability.title } } : figure;
  }
  /**
   * Why a connector's draft may not become a card, or undefined when it may (D35). A card is one system's: every action on
   * it names a capability of the connector that pushed it, with that capability's own kind. Otherwise a connector could put
   * another system's execute on its card, or call an execute a read so the card would run it without a receipt or an audit row.
   */
  draftProblem(connectorId: string, draft: Pick<ThreadDraft, 'actions' | 'items'>): string | undefined {
    // A row may name the person or unit it is about (D97 item 6): a known kind and a key that fits. Clew does not check
    // that the key exists; the index from entity to cards only ever answers for an entity the reader may ask about.
    for (const item of draft.items ?? []) {
      const subject = item.subject as { entity?: unknown; key?: unknown } | undefined;
      if (subject === undefined) continue;
      if (typeof subject?.entity !== 'string' || !isEntityKind(subject.entity))
        return `row ${item.ref} names an entity of an unknown kind`;
      if (typeof subject.key !== 'string' || !subject.key.length || [...subject.key].length > SUBJECT_KEY_MAX)
        return `row ${item.ref} names a ${subject.entity} without a key of 1 to ${SUBJECT_KEY_MAX} characters`;
    }
    for (const a of draft.actions) {
      const found = this.capabilities.get(a.capability);
      if (!found || found.connector.id !== connectorId)
        return `action ${a.id} names ${a.capability}, which is not a capability of ${connectorId}`;
      if (found.capability.kind !== a.kind)
        return `action ${a.id} says ${a.kind}, but ${a.capability} is ${found.capability.kind}`;
      // A review one item at a time (D70) needs items to review and a document to show: a read of the same connector.
      if (a.review && (a.kind !== 'execute' || !a.usesItems))
        return `action ${a.id} asks for a review, which only an execute over the items can have`;
      if (a.preview) {
        const preview = this.capabilities.get(a.preview);
        if (!preview || preview.connector.id !== connectorId)
          return `action ${a.id} names ${a.preview} as preview, which is not a capability of ${connectorId}`;
        if (preview.capability.kind !== 'read')
          return `action ${a.id} names ${a.preview} as preview, which is not a read`;
      }
      if (a.review && !a.preview) return `action ${a.id} asks for a review but names no preview`;
      // A read receipt (D112, amended 2026-11-11) is a write the person makes, with the time of what they acknowledge.
      if (a.acknowledgement !== undefined) {
        if (a.kind !== 'execute') return `action ${a.id} is marked as a read receipt, which only an execute can be`;
        const published = (a.acknowledgement as { publishedAt?: unknown } | null)?.publishedAt;
        if (typeof published !== 'string' || Number.isNaN(Date.parse(published)))
          return `action ${a.id} is a read receipt without the instant it was published`;
      }
      // Every property the input requires has someone to fill it (D112): the action's input, the rows, the review or an ask.
      const unfilled = a.kind === 'read' ? undefined : unfilledInput(found.capability, a);
      if (unfilled)
        return `action ${a.id} leaves ${unfilled}, which ${a.capability} requires, to nobody: give it in input, use the rows or ask for it`;
    }
    if (draft.actions.filter(a => a.acknowledgement !== undefined).length > 1)
      return 'more than one action is marked as the read receipt; a work item has one';
    return undefined;
  }
  /** Drafts from every visible connector whose scan is switched on. A draft that breaks the action rule (D35) is refused and reported. */
  async scan(actor: Actor): Promise<Array<ThreadDraft & { connector: string }>> {
    const drafts: Array<ThreadDraft & { connector: string }> = [];
    // A snapshot, as in `areas`: a connector replaced during a scan's await is not scanned twice.
    for (const m of [...this.connectors.values()]) {
      const clew = this.clewFor(actor, {}, m.id);
      if (!m.scan || !this.visible(actor, m.id) || !this.governance(m.id).scanEnabled) continue;
      const result = await m.scan(actor, clew);
      for (const d of Array.isArray(result) ? result : result.drafts) {
        const problem = this.draftProblem(m.id, d);
        if (problem) {
          this.options.onRefused?.(m.id, d.topic, problem);
          continue;
        }
        drafts.push({ ...d, connector: m.id });
      }
    }
    return drafts;
  }
  /**
   * One connector's scan for one actor. A connector that acts as the person (D26) is scanned only with a token from the
   * person's own session, obtained here first: without a delegate in `context`, or when the session yields no token, it
   * answers `authorization-required` and is never called. The delegate travels into the scan like any run's (`clewFor`).
   */
  async scanOne(actor: Actor, connectorId: string, context: RunContext = {}): Promise<ScanObservation> {
    await this.refresh();
    const m = this.connectors.get(connectorId);
    if (!m?.scan || !this.visible(actor, connectorId) || !this.governance(connectorId).scanEnabled)
      throw new CapabilityError(UNKNOWN);
    if (m.delegation && !(context.delegate && (await context.delegate(m.delegation.audience))))
      return {
        drafts: [],
        observation: {
          scope: actor.unitId + ':' + actor.role,
          observedAt: new Date().toISOString(),
          version: '',
          completeness: 'authorization-required',
          exhausted: false,
        },
      };
    const value = await m.scan(actor, this.clewFor(actor, context, m.id));
    const result = Array.isArray(value) ? { drafts: value } : value;
    const drafts = result.drafts.filter(d => !this.draftProblem(m.id, d));
    return {
      ...result,
      drafts,
      ...(drafts.length !== result.drafts.length && result.observation
        ? { observation: { ...result.observation, completeness: 'partial' } }
        : {}),
    };
  }
  /** The search sources a person may use (D26): every `<id>.search` read in scope, except the composite itself. */
  searchSources(actor: Actor) {
    return this.capabilitiesFor(actor)
      .filter(c => isSearchSource(c.capability, c.connector.id))
      .map(c => ({
        name: c.capability.name,
        connectorId: c.connector.id,
        source: c.connector.source,
        ...(c.capability.kinds ? { kinds: c.capability.kinds } : {}),
        ...(this.opens(actor, c.capability) ? { open: this.opens(actor, c.capability)! } : {}),
      }));
  }
  /**
   * The errand sources a person may use (D35, D89): every `<id>.errands` read in scope, with the read a row of it opens.
   * The name is tested before the scope: `clew.errands` is in scope only for a person with a source, so its own scope
   * asks this, and must never be asked from here.
   */
  errandSources(actor: Actor) {
    return [...this.capabilities.values()]
      .filter(c => isErrandSource(c.capability, c.connector.id) && !!this.allowed(actor, c.capability.name))
      .map(c => ({
        name: c.capability.name,
        connectorId: c.connector.id,
        source: c.connector.source,
        ...(this.opens(actor, c.capability) ? { open: this.opens(actor, c.capability)! } : {}),
      }));
  }
  /**
   * The request sources a person may use (D123): every `<id>.requests` read in scope, with the read a row of it opens.
   * As in `errandSources`, the name is tested before the scope: `clew.requests` is in scope only for a person with a
   * source, so its own scope asks this, and must never be asked from here.
   */
  requestSources(actor: Actor) {
    return [...this.capabilities.values()]
      .filter(c => isRequestSource(c.capability, c.connector.id) && !!this.allowed(actor, c.capability.name))
      .map(c => ({
        name: c.capability.name,
        connectorId: c.connector.id,
        source: c.connector.source,
        ...(this.opens(actor, c.capability) ? { open: this.opens(actor, c.capability)! } : {}),
      }));
  }
  /**
   * The news sources a person may read (D112, amended 2026-11-11): every `<id>.news` read in scope, with the read a row
   * of it opens in Clew. As in `errandSources`, the name is tested before the scope: `clew.news` is in scope only for a
   * person with a source, so its own scope asks this, and must never be asked from here.
   */
  newsSources(actor: Actor) {
    return [...this.capabilities.values()]
      .filter(c => isNewsSource(c.capability, c.connector.id) && !!this.allowed(actor, c.capability.name))
      .map(c => ({
        name: c.capability.name,
        connectorId: c.connector.id,
        source: c.connector.source,
        ...(this.opens(actor, c.capability) ? { open: this.opens(actor, c.capability)! } : {}),
      }));
  }
  /**
   * The reads about an entity kind a person may call (D97), connector by connector and by name within one, with what the
   * entities module places them by: the view as the person gets it (a row's `open` only when they may call that read),
   * how many keys one call takes, and the administrator's lens and column (a column only while its field is in the
   * view). As in `errandSources`, `about` is tested before the scope and Clew's core connector is skipped: a core
   * capability's scope may ask the registry, and must never be asked from here.
   */
  aboutReads(actor: Actor, entity: EntityKind): AboutRead[] {
    return this.aboutCapabilities(actor, entity, true).flatMap(({ connector, capability }) => {
      const view = capability.view;
      if (view?.kind !== 'table' && view?.kind !== 'list') return [];
      const { open: _open, ...rest } = view;
      const open = this.opens(actor, capability);
      const choice = this.governance(connector.id).capabilities[capability.name];
      const column = choice?.column && view.fields.some(f => f.key === choice.column) ? choice.column : undefined;
      const declared = (capability.input as { properties?: { keys?: { maxItems?: unknown } } }).properties?.keys
        ?.maxItems;
      return [
        {
          name: capability.name,
          connectorId: connector.id,
          source: connector.source,
          title: capability.title,
          view: { ...rest, ...(open ? { open } : {}) } as View,
          ...(capability.about?.page ? { page: capability.about.page } : {}),
          batch:
            typeof declared === 'number' && declared >= 1
              ? Math.min(ENTITY_KEYS_MAX, Math.floor(declared))
              : ENTITY_KEYS_MAX,
          lens: choice?.lens === true,
          ...(column ? { column } : {}),
          ...(connector.kind === 'core' ? { core: true as const } : {}),
          admits: this.named.get(capability.name)?.admits ?? [],
        },
      ];
    });
  }
  /** The proposes and executes about an entity kind a person may call (D97), in the order of `aboutReads`, each with the input property that takes the key. */
  aboutActions(actor: Actor, entity: EntityKind): AboutAction[] {
    return this.aboutCapabilities(actor, entity, false).flatMap(({ connector, capability }) =>
      capability.kind !== 'read' && capability.about?.param
        ? [
            {
              name: capability.name,
              connectorId: connector.id,
              source: connector.source,
              title: capability.title,
              kind: capability.kind,
              param: capability.about.param,
              path: pathOf(capability, [capability.about.param])!,
              ...(connector.kind === 'core' ? { core: true as const } : {}),
              admits: this.named.get(capability.name)?.admits ?? [],
            },
          ]
        : [],
    );
  }
  private aboutCapabilities(actor: Actor, entity: EntityKind, reads: boolean) {
    return [...this.capabilities.values()]
      .filter(
        c =>
          c.capability.about?.entity === entity &&
          (c.capability.kind === 'read') === reads &&
          c.connector.id !== SEARCH_CONNECTOR &&
          !!this.allowed(actor, c.capability.name),
      )
      .sort((a, b) => compare(a.connector.id, b.connector.id) || compare(a.capability.name, b.capability.name));
  }
  /**
   * The one system that answers the talks profile for this person (D96 item 9). A connector is a candidate when the
   * person may call its `<id>.talks` or its `<id>.commitments`: the round is often a manager's read while everyone reads
   * their own action points, so an employee gets the system through the second alone. Of the candidates the built-in
   * `TALKS_CONNECTOR` answers; otherwise the single other one does. When several others qualify none answers, and each
   * of them is reported through `onRefused` (topic `talks`), since an installation must choose one. The answer names
   * only the reads the person may call. As in `errandSources`, the name is tested before the scope, so the composites
   * `clew.talks` and `clew.commitments` may ask this from their own scope.
   */
  talkSource(actor: Actor): TalkSource | undefined {
    const reads = new Map<string, { connector: Connector; talks?: string; commitments?: string }>();
    for (const c of this.capabilities.values()) {
      const id = c.connector.id;
      const which = isTalkSource(c.capability, id)
        ? 'talks'
        : isCommitmentSource(c.capability, id)
          ? 'commitments'
          : undefined;
      if (!which || !this.allowed(actor, c.capability.name)) continue;
      reads.set(id, { connector: c.connector, ...reads.get(id), [which]: c.capability.name });
    }
    const builtIn = reads.get(TALKS_CONNECTOR);
    const others = [...reads.keys()].filter(id => id !== TALKS_CONNECTOR).sort();
    if (!builtIn && others.length > 1) {
      for (const id of others)
        this.options.onRefused?.(
          id,
          'talks',
          `several connectors answer the talks profile (${others.join(', ')}); none is used until one remains`,
        );
      return undefined;
    }
    const chosen = builtIn ?? (others[0] === undefined ? undefined : reads.get(others[0]));
    if (!chosen) return undefined;
    return {
      builtIn: chosen.connector.id === TALKS_CONNECTOR,
      connectorId: chosen.connector.id,
      source: chosen.connector.source,
      ...(chosen.talks ? { talks: chosen.talks } : {}),
      ...(chosen.commitments ? { commitments: chosen.commitments } : {}),
    };
  }
  /**
   * Every registered `propose` that follows a fact kind (D55), whether or not this person may call it: the job assembler
   * classifies an administrator's binding against it, so a follower that went away or out of scope is named, never silently skipped.
   */
  followers(actor: Actor, kind: string): FollowerRef[] {
    return [...this.capabilities.values()]
      .filter(c => c.capability.kind === 'propose' && c.capability.follows?.includes(kind))
      .map(c => ({
        name: c.capability.name,
        connectorId: c.connector.id,
        source: c.connector.source,
        follows: c.capability.follows!,
        available: !!this.allowed(actor, c.capability.name),
      }));
  }
  /** Whether an enabled connector still creates this fact kind (D55). A binding on a kind nobody creates is degraded. */
  offered(kind: string) {
    return [...this.connectors.values()].some(
      c => this.governance(c.id).state === 'enabled' && c.facts?.some(f => f.kind === kind),
    );
  }
  /**
   * The connectors that answer the holdings profile for the installation (D108 item 9, D119): enabled, declaring
   * `<id>.holdings` under `installation`, the read not switched off. By connector id. The call itself names nobody,
   * so no audience narrows it; what it answers is about people, so the competence register keeps a row only for a
   * person inside the connector's audience (D23, composition's `admitted`).
   */
  async holdingsSources(): Promise<HoldingsSource[]> {
    await this.refresh();
    return [...this.installationReads.values()]
      .filter(
        ({ connector, read }) => read.name === connector.id + '.holdings' && this.answers(connector.id, read.name),
      )
      .map(({ connector }) => ({ connectorId: connector.id, source: connector.source }))
      .sort((a, b) => compare(a.connectorId, b.connectorId));
  }
  /**
   * One page of every holding one source has, read as the installation (D119): `{}` for the first page, `{ cursor }`
   * with the `next` of the page before. Validated against the read's declaration and the profile; refused with
   * `InstallationReadError` in the protocol's error kinds. The core's alone: no person's path leads here.
   */
  async readHoldings(
    connectorId: string,
    cursor?: string,
    options: { signal?: AbortSignal } = {},
  ): Promise<HoldingsOutput> {
    return this.asInstallation<HoldingsOutput>(
      connectorId + '.holdings',
      cursor === undefined ? {} : { cursor },
      options,
    );
  }
  /** Whether a connector answers one of its installation reads now: enabled, and the read not switched off (D23, D119). */
  private answers(connectorId: string, name: string) {
    const governance = this.governance(connectorId);
    return governance.state === 'enabled' && governance.capabilities[name]?.enabled !== false;
  }
  /**
   * Run a read the installation makes itself (D119). The one way into `installationReads`, and private: a person's path
   * (`run`, `validate`, `document`, `clewFor`, `scan`, `header`) never comes here, and this never takes an actor, so
   * nothing a person, the model or a connector sends can name such a read. The input and the answer are checked against
   * the declaration and the profile, and the governance again after the answer, as a person's call is.
   */
  private async asInstallation<O>(name: string, input: unknown, context: { signal?: AbortSignal }): Promise<O> {
    await this.refresh();
    const found = this.installationReads.get(name);
    if (!found || !this.answers(found.connector.id, name)) throw new InstallationReadError('not-found', UNKNOWN);
    const profile = INSTALLATION_PROFILE_SCHEMAS[name.slice(found.connector.id.length + 1)];
    if (!this.validator(found.read.input)(input) || (profile && !this.validator(profile.input)(input)))
      throw new InstallationReadError('invalid', 'Ogiltig förfrågan till ' + name + '.');
    let output: unknown;
    try {
      output = await found.read.run(input, context.signal ? { signal: context.signal } : {});
    } catch (error) {
      if (error instanceof InstallationReadError) throw error;
      throw new InstallationReadError('unavailable', `${found.connector.source} svarar inte just nu.`);
    }
    if (!this.validator(found.read.output)(output) || (profile && !this.validator(profile.output)(output)))
      throw new InstallationReadError('unknown', 'Källans svar kunde inte verifieras.');
    // An administrator can switch the connector off while it answers: nothing is released under the old decision.
    await this.refresh();
    if (this.installationReads.get(name)?.connector !== found.connector || !this.answers(found.connector.id, name))
      throw new InstallationReadError('not-found', UNKNOWN);
    return output as O;
  }
  /** The read a row of this capability's view opens (D38), when the person may call it. */
  private opens(actor: Actor, capability: Capability): ViewOpen | undefined {
    const view = capability.view;
    const open = view && (view.kind === 'table' || view.kind === 'list') ? view.open : undefined;
    return open && this.allowed(actor, open.capability) ? open : undefined;
  }
  /**
   * A capability's view as the browser draws it (D38): the declaration, whose it is, a row's `open` only when the person
   * may call that read, and whether a row can be chipped (the connector is a search source, so `<id>.fetch` reads a ref back).
   */
  viewFor(actor: Actor, name: string): PanelViewSpec | undefined {
    const found = this.allowed(actor, name);
    const view = found?.capability.view;
    if (!found || !view) return undefined;
    const rows = view.kind === 'table' || view.kind === 'list';
    const chip =
      rows &&
      !!view.ref &&
      !!this.allowed(actor, found.connector.id + '.fetch') &&
      this.searchSources(actor).some(s => s.connectorId === found.connector.id);
    const { open: _open, ...rest } = view as View & { open?: ViewOpen };
    const open = this.opens(actor, found.capability);
    return {
      ...rest,
      ...(open ? { open } : {}),
      capability: name,
      connector: found.connector.id,
      source: found.connector.source,
      chip,
      ...(rows && found.connector.kind === 'core' ? { rowViews: true } : {}),
      // Who owns the data (D3): anything but Clew's own domain lives in the system it was read from.
      ...(found.connector.kind !== 'core' ? { external: true } : {}),
    } as PanelViewSpec;
  }
  /**
   * The shared header a person gets (D88): the answer of the one connector an administrator chose to give it
   * (`Governance.header`), when it is enabled, the person is in its audience and may call its header capability, checked
   * against the protocol's shape. Exclusive, never merged and never inferred: no holder, a person outside the holder's
   * audience, an answer out of shape or a connector that does not answer all give null, and the page draws Clew's
   * default; a refusal is reported through `onRefused`. The call is a read as the person: the content system lists what
   * they may see.
   */
  async header(
    actor: Actor,
    context: RunContext = {},
  ): Promise<{ connector: Connector; output: SiteHeaderOutput } | null> {
    const holder = this.list().find(c => c.header && this.governance(c.id).header === true);
    if (!holder || !this.visible(actor, holder.id) || !this.allowed(actor, holder.header!)) return null;
    try {
      const output = await this.run<unknown>(actor, holder.header!, {}, context);
      if (Value.Check(SiteHeaderOutputSchema, output)) return { connector: holder, output };
      const problem = contractProblems(SiteHeaderOutputSchema, output, 1)[0];
      this.options.onRefused?.(
        holder.id,
        'header',
        `answer is not a SiteHeaderOutput: ${problem?.path ?? '/'} ${problem?.message ?? ''}`.trim(),
      );
    } catch (error) {
      this.options.onRefused?.(holder.id, 'header', error instanceof Error ? error.message : String(error));
    }
    return null;
  }
  /**
   * The menu rows a person gets (D40): every view an administrator put in the menu, of a capability the person may call
   * and that can still be a tool. In Swedish alphabetical order, so no connector and no operator places a row.
   */
  menu(actor: Actor): MenuEntry[] {
    const out: MenuEntry[] = [];
    for (const { connector, capability } of this.capabilitiesFor(actor)) {
      if (this.governance(connector.id).capabilities[capability.name]?.menu !== true) continue;
      const row = menuRowOf(capability);
      if (row)
        out.push({
          connector: connector.id,
          source: connector.source,
          capability: capability.name,
          title: capability.title,
          label: row.label,
          icon: row.icon,
        });
    }
    return out.sort((a, b) => a.label.localeCompare(b.label, 'sv'));
  }
  /**
   * The reads a person may open as a view (D116): every read capability they may call, with its title, the kind of
   * view it declares (D38) and the input property it takes one person's key in, when it takes one, with the relations
   * to that person it admits (D117). Each has a page of its own; the browser opens one that answers with rows there and
   * anything else beside the page it was opened from. A read the person may not call is missing, as one that does not
   * exist is.
   */
  views(actor: Actor): ViewEntry[] {
    return this.capabilitiesFor(actor)
      .filter(({ capability }) => capability.kind === 'read')
      .map(({ capability, connector }) => ({
        capability: capability.name,
        title: capability.title,
        ...(capability.view ? { kind: capability.view.kind } : {}),
        // Clew's own page for the read's rows: only a core connector's read has one.
        ...(capability.page && connector.kind === 'core' ? { page: capability.page } : {}),
        // Where the read takes one person (D117), so a page can open it for the person it is about (D124), and whom
        // through it: what the registry resolves the key against on that page's own read (`narrow`, granted).
        ...(capability.person?.param
          ? {
              person: capability.person.param,
              admits: [...(this.named.get(capability.name)?.admits ?? STRICT_RELATIONS)],
            }
          : {}),
      }));
  }
  /**
   * Tool definitions for the model: `model: true` capabilities the person may call, from connectors whose tools are on (D8).
   * The per-connector search sources are left out while the composite search is registered, so the model sees one search tool (D26).
   * The per-connector errand lists are left out the same way while `clew.errands` is registered (D35 item 4), the
   * per-connector request lists while `clew.requests` is (D123), and the per-connector news lists while `clew.news` is
   * (D112, amended 2026-11-11).
   * The talks profile and its composites are never tools, registered or not: no read of that domain reaches a model (D96 item 6).
   * A read about an entity is never a tool either (D97 item 7): the loader refuses `model: true` on one, and this holds
   * whatever a registration says. Clew's own connectors are governed here as any other (D122 item 4): the connector's
   * assistant switch and each read's. What the model reads of a tool's output is `modelReading` of its view.
   */
  tools(actor: Actor) {
    const composite = this.capabilities.has(SEARCH_CONNECTOR + '.search');
    const errands = this.capabilities.has(SEARCH_CONNECTOR + '.errands');
    const requests = this.capabilities.has(SEARCH_CONNECTOR + '.requests');
    const news = this.capabilities.has(SEARCH_CONNECTOR + '.news');
    // An execute's effect read (D112) says what a decision will write; the loader holds it to model: false, and this holds whatever a registration says.
    const effects = new Set(
      [...this.capabilities.values()].flatMap(c => (c.capability.effect ? [c.capability.effect] : [])),
    );
    return this.capabilitiesFor(actor)
      .filter(c => !effects.has(c.capability.name))
      .filter(c => {
        const g = this.governance(c.connector.id);
        return c.capability.model && g.toolsEnabled && g.capabilities[c.capability.name]?.model !== false;
      })
      .filter(c => !(composite && isSearchSource(c.capability, c.connector.id)))
      .filter(c => !(errands && isErrandSource(c.capability, c.connector.id)))
      .filter(c => !(requests && isRequestSource(c.capability, c.connector.id)))
      .filter(c => !(news && isNewsSource(c.capability, c.connector.id)))
      .filter(c => !isTalkSource(c.capability, c.connector.id) && !isCommitmentSource(c.capability, c.connector.id))
      .filter(c => c.capability.name !== TALK_COMPOSITE && c.capability.name !== COMMITMENT_COMPOSITE)
      .filter(c => !(c.capability.kind === 'read' && c.capability.about))
      .map(c => ({
        name: c.capability.name,
        title: c.capability.title,
        description: c.capability.description,
        input: c.capability.input,
        kind: c.capability.kind,
        source: c.connector.source,
        ...(c.capability.view ? { view: c.capability.view } : {}),
      }));
  }
}
export const receipt = (result: ExecuteResult, at = new Date()): Receipt => ({
  at: at.toISOString(),
  headline: result.headline,
  rows: result.rows,
  undoUntil: result.undoCapability ? new Date(at.getTime() + (result.undoMinutes ?? 10) * 60_000).toISOString() : null,
  undoCapability: result.undoCapability ?? null,
  ...(result.undoInput ? { undoInput: result.undoInput } : {}),
});
