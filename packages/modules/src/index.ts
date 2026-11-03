import type { TSchema } from '@sinclair/typebox';
import type { Area, Receipt, ReceiptRow, SessionUser, ThreadAction, ThreadItem } from '@clew/contracts';

/**
 * The capability layer (D1, D3). A module owns a Clew contract: capabilities with a kind, a scope and an
 * input/output schema. Everything the UI and the model see is derived from these descriptors: REST routes,
 * tool definitions, standing actions in an area, and the action slots on a card. Modules never draw cards.
 */
export type CapabilityKind = 'read' | 'propose' | 'execute';
export type ModuleKind = 'core' | 'passthrough' | 'derived';
/** The caller as capabilities see it: identity and scope, never tokens. */
export type Actor = Pick<SessionUser, 'id' | 'name' | 'unitId' | 'unitLabel' | 'role'>;

export interface Capability<I = unknown, O = unknown> {
  /** `module.verb`, stable, e.g. `raindance.approveInvoices`. */
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
  scope: (actor: Actor) => boolean;
  run: (actor: Actor, input: I) => Promise<O>;
}
/** What an execute capability returns: the source system's answer, row by row, read back. */
export interface ExecuteResult {
  headline: string;
  rows: ReceiptRow[];
  /** Name of the capability that reverses this within the undo window, if any. */
  undoCapability?: string;
  undoMinutes?: number;
}
/** A thread a module wants to push. `topic` is the idempotency key per person. */
export interface ThreadDraft {
  topic: string; area: string; title: string; summary: string;
  reason: string; items?: ThreadItem[]; actions: ThreadAction[];
  waitingOn?: string | null; deadline?: string | null;
}
export interface AreaDefinition {
  id: string; title: string; roles: Array<Actor['role']>;
  figure?: (actor: Actor) => Promise<Area['figure']>;
  /** Capability names shown under "Gör själv". */
  standing: string[];
  schedules: Array<{ label: string; when: string }>;
}
export interface Module {
  id: string; kind: ModuleKind;
  /** Swedish label of the source, shown on cards: "Heroma", "Raindance". */
  source: string;
  areas: AreaDefinition[];
  capabilities: Capability<any, any>[];
  /** The module's triggers: what it wants to push for this actor right now. Deterministic, no model. */
  scan?: (actor: Actor) => Promise<ThreadDraft[]>;
}

export class CapabilityError extends Error { constructor(message: string) { super(message); this.name = 'CapabilityError'; } }

export class Registry {
  private modules = new Map<string, Module>();
  private capabilities = new Map<string, { module: Module; capability: Capability<any, any> }>();
  register(module: Module) {
    if (this.modules.has(module.id)) throw new Error(`Module ${module.id} is already registered.`);
    for (const c of module.capabilities) {
      if (!c.name.startsWith(module.id + '.')) throw new Error(`Capability ${c.name} must be prefixed with ${module.id}.`);
      if (c.kind === 'execute' && c.model) throw new Error(`Capability ${c.name}: execute capabilities are never tools (D8).`);
      if (this.capabilities.has(c.name)) throw new Error(`Capability ${c.name} is already registered.`);
      this.capabilities.set(c.name, { module, capability: c });
    }
    this.modules.set(module.id, module);
    return this;
  }
  list() { return [...this.modules.values()]; }
  module(id: string) { return this.modules.get(id); }
  find(name: string) { return this.capabilities.get(name); }
  /** Run a capability for an actor. Scope is checked here, so every path (REST, tool, card action) is equal. */
  async run<O = unknown>(actor: Actor, name: string, input: unknown): Promise<O> {
    const found = this.capabilities.get(name);
    if (!found) throw new CapabilityError('Okänd förmåga.');
    if (!found.capability.scope(actor)) throw new CapabilityError('Du saknar behörighet för åtgärden.');
    return found.capability.run(actor, input) as Promise<O>;
  }
  /** Areas for one actor: one entry per area definition whose roles include the actor's role. Counts are filled in by the caller. */
  async areas(actor: Actor): Promise<Omit<Area, 'needsYou' | 'waiting'>[]> {
    const out: Omit<Area, 'needsYou' | 'waiting'>[] = [];
    for (const m of this.modules.values()) for (const a of m.areas) {
      if (!a.roles.includes(actor.role)) continue;
      const standing = a.standing.map(n => this.capabilities.get(n)).filter((c): c is NonNullable<typeof c> => !!c && c.capability.scope(actor))
        .map(c => ({ capability: c.capability.name, label: c.capability.title, kind: c.capability.kind }));
      out.push({ id: a.id, title: a.title, module: m.id, source: m.source, figure: a.figure ? await a.figure(actor) : null, standing, schedules: a.schedules });
    }
    return out;
  }
  async scan(actor: Actor): Promise<Array<ThreadDraft & { module: string }>> {
    const drafts: Array<ThreadDraft & { module: string }> = [];
    for (const m of this.modules.values()) if (m.scan) for (const d of await m.scan(actor)) drafts.push({ ...d, module: m.id });
    return drafts;
  }
  /** Tool definitions for the model: only `model: true` capabilities within scope (D8). */
  tools(actor: Actor) {
    return [...this.capabilities.values()].filter(c => c.capability.model && c.capability.scope(actor))
      .map(c => ({ name: c.capability.name, description: c.capability.description, input: c.capability.input, kind: c.capability.kind }));
  }
}
export const receipt = (result: ExecuteResult, at = new Date()): Receipt => ({
  at: at.toISOString(), headline: result.headline, rows: result.rows,
  undoUntil: result.undoCapability ? new Date(at.getTime() + (result.undoMinutes ?? 10) * 60_000).toISOString() : null,
  undoCapability: result.undoCapability ?? null,
});
