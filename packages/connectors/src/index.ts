import type { TSchema } from '@sinclair/typebox';
import type { Area, CapabilityOverride, ConnectorAudience, ConnectorState, Receipt, ReceiptRow, SearchKind, SessionUser, PanelViewSpec, ThreadAction, ThreadItem, View, ViewOpen } from '@clew/contracts';
import { viewProblem } from './views';
export { openRef, readsSummary, rowsKey, viewProblem, viewRows, viewSummary } from './views';

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
/** The caller as capabilities see it: identity and scope, never tokens. */
export type Actor = Pick<SessionUser, 'id' | 'name' | 'unitId' | 'unitLabel' | 'role'>;
/** The actor a capability sees, cut from an authenticated context: identity and scope, never tokens. */
export const actorOf = (persona: Actor): Actor => ({ id: persona.id, name: persona.name, unitId: persona.unitId, unitLabel: persona.unitLabel, role: persona.role });
/**
 * Who may call a capability. Declarative so a remote manifest can carry it: no `roles` means every signed-in
 * person. A bundled connector may give a function instead. Either way `run` narrows further (unit, own records).
 */
export interface ScopeRule { roles?: Array<Actor['role']> }
export type Scope = ScopeRule | ((actor: Actor) => boolean);
export const inScope = (scope: Scope, actor: Actor) => typeof scope === 'function' ? scope(actor) : !scope.roles || scope.roles.includes(actor.role);

/** What a capability gets besides the actor and the input: the rest of Clew, as capabilities, for that actor. */
export interface Clew {
  /** Run another connector's `read` or `propose` as the same actor. Scope applies; `execute` is refused. */
  call<O = unknown>(name: string, input?: unknown): Promise<O>;
  /**
   * The person's IdP token for an audience, by token exchange from the session behind this call (D26). Missing when no
   * session is behind the run (a scan, a figure, a connector's callback); resolves undefined under a session without IdP
   * tokens. Never logged, never in an output.
   */
  delegate?: (audience: string) => Promise<string | undefined>;
}
/** What a caller with a session adds to a run. The registry carries it into every nested `clew.call`. */
export interface RunContext { delegate?: Clew['delegate'] }

export interface Capability<I = unknown, O = unknown> {
  /** `connector.verb`, stable, e.g. `raindance.approveInvoices`. */
  name: string;
  kind: CapabilityKind;
  /** Swedish, shown as a button label. */
  title: string;
  /** Swedish, read by the model when `model` is true. */
  description: string;
  input: TSchema;
  output: TSchema;
  /** Exposed as a tool to the model. `execute` defaults to false and should stay so (D8). */
  model: boolean;
  /** Who may call it. Evaluated on every call; never trusts the browser. */
  scope: Scope;
  /** For a `<id>.search` capability (D26): what it can find, so the composite search skips sources that cannot hold the answer. */
  kinds?: SearchKind[];
  /** How Clew draws the output (D38). Absent means the generic panel rules. */
  view?: View;
  run: (actor: Actor, input: I, clew: Clew) => Promise<O>;
}
/** A capability is a search source when it is named `<id>.search` and is a read (D26); the composite `clew.search` is never one itself. */
export const isSearchSource = (c: Pick<Capability, 'name' | 'kind'>, connectorId: string) => c.kind === 'read' && c.name === connectorId + '.search' && connectorId !== SEARCH_CONNECTOR;
/** The core connector that owns the composite search and the question area. */
export const SEARCH_CONNECTOR = 'clew';
/** What an execute capability returns: the source system's answer, row by row, read back. */
export interface ExecuteResult {
  headline: string;
  rows: ReceiptRow[];
  /** Name of the capability that reverses this within the undo window, if any. */
  undoCapability?: string;
  undoMinutes?: number;
}
/** A thread a connector wants to push. `topic` is the idempotency key per person. */
export interface ThreadDraft {
  topic: string; area: string; title: string; summary: string;
  reason: string; items?: ThreadItem[]; actions: ThreadAction[];
  waitingOn?: string | null; deadline?: string | null;
}
export interface AreaDefinition {
  id: string; title: string; roles: Array<Actor['role']>;
  figure?: (actor: Actor, clew: Clew) => Promise<Area['figure']>;
  /** Capability names shown under "Gör själv". */
  standing: string[];
  schedules: Array<{ label: string; when: string }>;
}
export interface Connector {
  id: string; kind: ConnectorKind;
  /** Swedish label of the source, shown on cards: "Heroma", "Raindance". */
  source: string;
  areas: AreaDefinition[];
  capabilities: Capability<any, any>[];
  /** The connector's triggers: what it wants to push for this actor right now. Deterministic, no model. */
  scan?: (actor: Actor, clew: Clew) => Promise<ThreadDraft[]>;
}

export class CapabilityError extends Error { constructor(message: string) { super(message); this.name = 'CapabilityError'; } }

/**
 * What an administrator decided about a connector (D23): on or off, who sees it, whether it pushes cards and offers
 * tools, and per-capability switches. The default is "enabled for everyone", which is what a connector without a row
 * gets. Narrowing only: an override can switch a capability or its tool off, never on.
 */
export interface Governance {
  state: ConnectorState;
  audience: ConnectorAudience;
  scanEnabled: boolean;
  toolsEnabled: boolean;
  capabilities: Record<string, CapabilityOverride>;
}
export const openGovernance = (): Governance => ({ state: 'enabled', audience: { mode: 'all' }, scanEnabled: true, toolsEnabled: true, capabilities: {} });
/** A person is in the audience by role, by unit or by group (any of). Groups match nothing until SCIM provides them. */
export const inAudience = (audience: ConnectorAudience, actor: Actor) =>
  audience.mode === 'all' || !!audience.roles?.includes(actor.role) || !!audience.units?.includes(actor.unitId);
/** Everything the person may not reach reads like "unknown", so a hidden connector cannot be probed (D23). */
export const UNKNOWN = 'Okänd förmåga.';

export interface RegistryOptions {
  /** A draft the scan refused (D35): the server logs it, the connector check fails on it. The other drafts still become cards. */
  onRefused?: (connectorId: string, topic: string, problem: string) => void;
}

export class Registry {
  private connectors = new Map<string, Connector>();
  private capabilities = new Map<string, { connector: Connector; capability: Capability<any, any> }>();
  private governed = new Map<string, Governance>();
  constructor(private readonly options: RegistryOptions = {}) {}
  register(connector: Connector) {
    if (this.connectors.has(connector.id)) throw new Error(`Connector ${connector.id} is already registered.`);
    for (const c of connector.capabilities) {
      if (!c.name.startsWith(connector.id + '.')) throw new Error(`Capability ${c.name} must be prefixed with ${connector.id}.`);
      if (c.kind === 'execute' && c.model) throw new Error(`Capability ${c.name}: execute capabilities are never tools (D8).`);
      if (this.capabilities.has(c.name)) throw new Error(`Capability ${c.name} is already registered.`);
      const problem = viewProblem(c, connector.capabilities);
      if (problem) throw new Error(`Capability ${problem} (D38).`);
      this.capabilities.set(c.name, { connector, capability: c });
    }
    this.connectors.set(connector.id, connector);
    return this;
  }
  /** Remove a connector and its capabilities; cards it pushed stay in the database. Its governance is forgotten too. */
  unregister(id: string) {
    const found = this.connectors.get(id);
    this.governed.delete(id);
    if (!found) return false;
    for (const c of found.capabilities) this.capabilities.delete(c.name);
    this.connectors.delete(id);
    return true;
  }
  /** Register, replacing an earlier registration with the same id (a refetched manifest, a changed secret). Governance survives. */
  replace(connector: Connector) {
    const governance = this.governed.get(connector.id);
    this.unregister(connector.id);
    this.register(connector);
    if (governance) this.governed.set(connector.id, governance);
    return this;
  }
  /** Apply an administrator's decision. Takes effect on the next call; nothing is restarted. */
  govern(id: string, governance: Governance) { this.governed.set(id, governance); return this; }
  governance(id: string): Governance { return this.governed.get(id) ?? openGovernance(); }
  /** Every registered connector, governed or not: for the loader and the administrator, never for a person's page. */
  list() { return [...this.connectors.values()]; }
  connector(id: string) { return this.connectors.get(id); }
  /** Lookup by name without any check: for validation and routing. Use `allowed` before acting for a person. */
  find(name: string) { return this.capabilities.get(name); }
  /** A connector exists for this person: registered, switched on and the person is in its audience. */
  visible(actor: Actor, connectorId: string) {
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
  /** The connectors a person can see, and the capabilities they may call: what `/api/connectors`, search and the typeahead list. */
  listFor(actor: Actor) { return this.list().filter(c => this.visible(actor, c.id)); }
  capabilitiesFor(actor: Actor) { return [...this.capabilities.values()].filter(c => this.allowed(actor, c.capability.name)); }
  /** The handle a connector gets to reach the rest of Clew as one actor: reads and proposals only, scope re-checked. */
  clewFor(actor: Actor, context: RunContext = {}): Clew {
    return {
      call: async <O,>(name: string, input: unknown = {}) => {
        const found = this.capabilities.get(name);
        if (found?.capability.kind === 'execute') throw new CapabilityError('En anslutning kan inte utföra åtgärder i en annan anslutning.');
        return this.run<O>(actor, name, input, context);
      },
      ...(context.delegate ? { delegate: context.delegate } : {}),
    };
  }
  /**
   * Run a capability for an actor. Visibility, the capability switch and scope are checked here, so every path (REST,
   * tool, card action, connector callback) is equal. A hidden connector answers exactly as an unknown capability does.
   * The context (the session's delegate) travels into every nested call the capability makes.
   */
  async run<O = unknown>(actor: Actor, name: string, input: unknown, context: RunContext = {}): Promise<O> {
    const found = this.capabilities.get(name);
    if (!found || !this.visible(actor, found.connector.id) || this.governance(found.connector.id).capabilities[name]?.enabled === false) throw new CapabilityError(UNKNOWN);
    if (!inScope(found.capability.scope, actor)) throw new CapabilityError('Du saknar behörighet för åtgärden.');
    return found.capability.run(actor, input, this.clewFor(actor, context)) as Promise<O>;
  }
  /**
   * Areas for one actor: one entry per area definition of a visible connector whose roles include the actor's role.
   * Counts are filled in by the caller. `figures: false` skips the figure calls (the administrator's structural preview).
   */
  async areas(actor: Actor, options: { figures?: boolean; connector?: string } = {}): Promise<Omit<Area, 'needsYou' | 'waiting' | 'urgency'>[]> {
    const out: Omit<Area, 'needsYou' | 'waiting' | 'urgency'>[] = [];
    const clew = this.clewFor(actor);
    for (const m of this.connectors.values()) {
      if (options.connector && m.id !== options.connector) continue;
      if (!this.visible(actor, m.id)) continue;
      for (const a of m.areas) {
        if (!a.roles.includes(actor.role)) continue;
        const standing = a.standing.map(n => this.allowed(actor, n)).filter((c): c is NonNullable<typeof c> => !!c)
          .map(c => ({ capability: c.capability.name, label: c.capability.title, kind: c.capability.kind }));
        out.push({ id: a.id, title: a.title, connector: m.id, source: m.source, figure: a.figure && options.figures !== false ? await a.figure(actor, clew) : null, standing, schedules: a.schedules });
      }
    }
    return out;
  }
  /**
   * Why a connector's draft may not become a card, or undefined when it may (D35). A card is one system's: every action on
   * it names a capability of the connector that pushed it, with that capability's own kind. Otherwise a connector could put
   * another system's execute on its card, or call an execute a read so the card would run it without a receipt or an audit row.
   */
  draftProblem(connectorId: string, draft: Pick<ThreadDraft, 'actions'>): string | undefined {
    for (const a of draft.actions) {
      const found = this.capabilities.get(a.capability);
      if (!found || found.connector.id !== connectorId) return `action ${a.id} names ${a.capability}, which is not a capability of ${connectorId}`;
      if (found.capability.kind !== a.kind) return `action ${a.id} says ${a.kind}, but ${a.capability} is ${found.capability.kind}`;
    }
    return undefined;
  }
  /** Drafts from every visible connector whose scan is switched on. A draft that breaks the action rule (D35) is refused and reported. */
  async scan(actor: Actor): Promise<Array<ThreadDraft & { connector: string }>> {
    const drafts: Array<ThreadDraft & { connector: string }> = [];
    const clew = this.clewFor(actor);
    for (const m of this.connectors.values()) {
      if (!m.scan || !this.visible(actor, m.id) || !this.governance(m.id).scanEnabled) continue;
      for (const d of await m.scan(actor, clew)) {
        const problem = this.draftProblem(m.id, d);
        if (problem) { this.options.onRefused?.(m.id, d.topic, problem); continue; }
        drafts.push({ ...d, connector: m.id });
      }
    }
    return drafts;
  }
  /** The search sources a person may use (D26): every `<id>.search` read in scope, except the composite itself. */
  searchSources(actor: Actor) {
    return this.capabilitiesFor(actor).filter(c => isSearchSource(c.capability, c.connector.id))
      .map(c => ({ name: c.capability.name, connectorId: c.connector.id, source: c.connector.source, ...(c.capability.kinds ? { kinds: c.capability.kinds } : {}), ...(this.opens(actor, c.capability) ? { open: this.opens(actor, c.capability)! } : {}) }));
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
    const chip = rows && !!view.ref && !!this.allowed(actor, found.connector.id + '.fetch') && this.searchSources(actor).some(s => s.connectorId === found.connector.id);
    const { open: _open, ...rest } = view as View & { open?: ViewOpen };
    const open = this.opens(actor, found.capability);
    return { ...rest, ...(open ? { open } : {}), capability: name, connector: found.connector.id, source: found.connector.source, chip } as PanelViewSpec;
  }
  /**
   * Tool definitions for the model: `model: true` capabilities the person may call, from connectors whose tools are on (D8).
   * The per-connector search sources are left out while the composite search is registered, so the model sees one search tool (D26).
   */
  tools(actor: Actor) {
    const composite = this.capabilities.has(SEARCH_CONNECTOR + '.search');
    return this.capabilitiesFor(actor).filter(c => { const g = this.governance(c.connector.id); return c.capability.model && g.toolsEnabled && g.capabilities[c.capability.name]?.model !== false; })
      .filter(c => !(composite && isSearchSource(c.capability, c.connector.id)))
      .map(c => ({ name: c.capability.name, title: c.capability.title, description: c.capability.description, input: c.capability.input, kind: c.capability.kind, source: c.connector.source, ...(c.capability.view ? { view: c.capability.view } : {}) }));
  }
}
export const receipt = (result: ExecuteResult, at = new Date()): Receipt => ({
  at: at.toISOString(), headline: result.headline, rows: result.rows,
  undoUntil: result.undoCapability ? new Date(at.getTime() + (result.undoMinutes ?? 10) * 60_000).toISOString() : null,
  undoCapability: result.undoCapability ?? null,
});
