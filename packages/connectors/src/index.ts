import type { TSchema } from '@sinclair/typebox';
import type { Area, Receipt, ReceiptRow, SessionUser, ThreadAction, ThreadItem } from '@clew/contracts';

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
}

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
  run: (actor: Actor, input: I, clew: Clew) => Promise<O>;
}
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

export class Registry {
  private connectors = new Map<string, Connector>();
  private capabilities = new Map<string, { connector: Connector; capability: Capability<any, any> }>();
  register(connector: Connector) {
    if (this.connectors.has(connector.id)) throw new Error(`Connector ${connector.id} is already registered.`);
    for (const c of connector.capabilities) {
      if (!c.name.startsWith(connector.id + '.')) throw new Error(`Capability ${c.name} must be prefixed with ${connector.id}.`);
      if (c.kind === 'execute' && c.model) throw new Error(`Capability ${c.name}: execute capabilities are never tools (D8).`);
      if (this.capabilities.has(c.name)) throw new Error(`Capability ${c.name} is already registered.`);
      this.capabilities.set(c.name, { connector, capability: c });
    }
    this.connectors.set(connector.id, connector);
    return this;
  }
  /** Remove a connector and its capabilities; cards it pushed stay in the database. */
  unregister(id: string) {
    const found = this.connectors.get(id);
    if (!found) return false;
    for (const c of found.capabilities) this.capabilities.delete(c.name);
    this.connectors.delete(id);
    return true;
  }
  /** Register, replacing an earlier registration with the same id (a refetched manifest, a changed secret). */
  replace(connector: Connector) { this.unregister(connector.id); return this.register(connector); }
  list() { return [...this.connectors.values()]; }
  connector(id: string) { return this.connectors.get(id); }
  find(name: string) { return this.capabilities.get(name); }
  /** The handle a connector gets to reach the rest of Clew as one actor: reads and proposals only, scope re-checked. */
  clewFor(actor: Actor): Clew {
    return {
      call: async <O,>(name: string, input: unknown = {}) => {
        const found = this.capabilities.get(name);
        if (found?.capability.kind === 'execute') throw new CapabilityError('En modul kan inte utföra åtgärder i en annan modul.');
        return this.run<O>(actor, name, input);
      },
    };
  }
  /** Run a capability for an actor. Scope is checked here, so every path (REST, tool, card action, connector) is equal. */
  async run<O = unknown>(actor: Actor, name: string, input: unknown): Promise<O> {
    const found = this.capabilities.get(name);
    if (!found) throw new CapabilityError('Okänd förmåga.');
    if (!inScope(found.capability.scope, actor)) throw new CapabilityError('Du saknar behörighet för åtgärden.');
    return found.capability.run(actor, input, this.clewFor(actor)) as Promise<O>;
  }
  /** Areas for one actor: one entry per area definition whose roles include the actor's role. Counts are filled in by the caller. */
  async areas(actor: Actor): Promise<Omit<Area, 'needsYou' | 'waiting' | 'urgency'>[]> {
    const out: Omit<Area, 'needsYou' | 'waiting' | 'urgency'>[] = [];
    const clew = this.clewFor(actor);
    for (const m of this.connectors.values()) for (const a of m.areas) {
      if (!a.roles.includes(actor.role)) continue;
      const standing = a.standing.map(n => this.capabilities.get(n)).filter((c): c is NonNullable<typeof c> => !!c && inScope(c.capability.scope, actor))
        .map(c => ({ capability: c.capability.name, label: c.capability.title, kind: c.capability.kind }));
      out.push({ id: a.id, title: a.title, connector: m.id, source: m.source, figure: a.figure ? await a.figure(actor, clew) : null, standing, schedules: a.schedules });
    }
    return out;
  }
  async scan(actor: Actor): Promise<Array<ThreadDraft & { connector: string }>> {
    const drafts: Array<ThreadDraft & { connector: string }> = [];
    const clew = this.clewFor(actor);
    for (const m of this.connectors.values()) if (m.scan) for (const d of await m.scan(actor, clew)) drafts.push({ ...d, connector: m.id });
    return drafts;
  }
  /** Tool definitions for the model: only `model: true` capabilities within scope (D8). */
  tools(actor: Actor) {
    return [...this.capabilities.values()].filter(c => c.capability.model && inScope(c.capability.scope, actor))
      .map(c => ({ name: c.capability.name, title: c.capability.title, description: c.capability.description, input: c.capability.input, kind: c.capability.kind, source: c.connector.source }));
  }
}
export const receipt = (result: ExecuteResult, at = new Date()): Receipt => ({
  at: at.toISOString(), headline: result.headline, rows: result.rows,
  undoUntil: result.undoCapability ? new Date(at.getTime() + (result.undoMinutes ?? 10) * 60_000).toISOString() : null,
  undoCapability: result.undoCapability ?? null,
});
