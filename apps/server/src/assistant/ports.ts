import type {
  AuditEntryView,
  AuthenticatedContext,
  ConnectorAudience,
  ModelReasoning,
  ModelState,
  ProviderHealth,
} from '@clew/contracts';
import type { Registry } from '@clew/connectors';
import type { CalendarUsecases } from '../modules/calendar/usecases/samtal';
import type { ThreadStore } from '../threads/model';
import type { ModelGenerate } from './model';

/**
 * The ports of the assistant (D25). `ThreadStore` holds the conversations (question threads) and the drafts on cards.
 * The model behind the box is administered in the product (D24): `ModelStore` holds the providers, the models and each
 * person's pick, `ModelWire` is the one protocol (OpenAI-compatible), `KeySealer` keeps a provider's key sealed and
 * `ModelHealth` remembers which endpoints answer. With no model for a person the router answers (D8).
 * `adapters/postgres.ts` and `adapters/provider.ts` are what the server runs; `adapters/memory.ts` is what the tests run.
 */
export interface ProviderRecord {
  id: string;
  title: string;
  baseUrl: string;
  /** The sealed envelope, or null for an endpoint without a key. Opaque to the use case; never leaves the server. */
  apiKey: string | null;
  keyChangedAt: string | null;
  health: ProviderHealth;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
export interface NewProvider {
  id: string;
  title: string;
  baseUrl: string;
  apiKey: string | null;
  health: ProviderHealth;
  createdBy: string;
  at: string;
}
export type ProviderPatch = Partial<Pick<ProviderRecord, 'title' | 'baseUrl' | 'apiKey' | 'keyChangedAt' | 'health'>>;
export interface ModelRecord {
  id: string;
  providerId: string;
  model: string;
  title: string;
  description: string;
  state: ModelState;
  audience: ConnectorAudience;
  isDefault: boolean;
  tools: boolean;
  reasoning: ModelReasoning;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
}
/** A new model is off, for everyone, not the default: an administrator switches it on (nothing is live by accident). */
export interface NewModel {
  id: string;
  providerId: string;
  model: string;
  title: string;
  description: string;
  tools: boolean;
  createdBy: string;
  at: string;
}
export type ModelPatch = Partial<
  Pick<ModelRecord, 'model' | 'title' | 'description' | 'state' | 'audience' | 'isDefault' | 'tools' | 'reasoning'>
>;
export interface AuditEntry {
  actor: string;
  action: string;
  subject: string;
  at: string;
  details?: Record<string, unknown>;
}
/** Writes inside one transaction: the audit row commits or rolls back with the rest. */
export interface ModelTx {
  /** False when the id is taken. */
  insertProvider(record: NewProvider): Promise<boolean>;
  /** Bumps the version; false when the row does not exist. */
  updateProvider(id: string, patch: ProviderPatch, by: string, at: string): Promise<boolean>;
  removeProvider(id: string): Promise<void>;
  insertModel(record: NewModel): Promise<boolean>;
  updateModel(id: string, patch: ModelPatch, by: string, at: string): Promise<boolean>;
  /** Removes the model and every person's pick of it. */
  removeModel(id: string): Promise<void>;
  /** A person's pick in the composer; null removes it. */
  setChoice(personId: string, modelId: string | null, at: string): Promise<void>;
  writeAudit(entry: AuditEntry): Promise<void>;
}
export interface ModelStore {
  listProviders(): Promise<ProviderRecord[]>;
  readProvider(id: string): Promise<ProviderRecord | undefined>;
  /** In the order they were added. */
  listModels(): Promise<ModelRecord[]>;
  readModel(id: string): Promise<ModelRecord | undefined>;
  readChoice(personId: string): Promise<string | undefined>;
  /** A probe's or a test's result is not administration: no version bump, no audit. */
  recordHealth(providerId: string, health: ProviderHealth): Promise<void>;
  /** The audit rows about one subject (`provider:<id>`, `model:<id>`), oldest first. */
  history(subject: string): Promise<AuditEntryView[]>;
  transaction<T>(fn: (tx: ModelTx) => Promise<T>): Promise<T>;
}
/** Sealing is the composition root's business (the master key); the use case only hands envelopes around. */
export interface KeySealer {
  seal(value: string, providerId: string): string;
  open(sealed: string, providerId: string): string;
}
export interface Endpoint {
  baseUrl: string;
  apiKey?: string;
}
/** How a call to an endpoint failed: no answer (network, timeout, 5xx), the key refused (401, 403), or an answer that is not what was asked for. */
export class WireError extends Error {
  constructor(
    readonly kind: 'unreachable' | 'key-rejected' | 'unsupported',
    message: string,
  ) {
    super(message);
    this.name = 'WireError';
  }
}
/** The OpenAI-compatible protocol, the only one (D24, CLAUDE.md). Every failure is a `WireError`. */
export interface ModelWire {
  /** `GET {base}/models`: the ids the endpoint lists. */
  listModels(endpoint: Endpoint): Promise<string[]>;
  /** One tiny completion shaped like a real turn: proves the model id, the key and that the model takes the call (D84). */
  ping(endpoint: Endpoint, model: string, call: Pick<ModelRecord, 'tools' | 'reasoning'>): Promise<void>;
  /** What the assistant calls for one turn with this model. */
  generator(endpoint: Endpoint, model: string, reasoning: ModelReasoning): ModelGenerate;
}
/**
 * Which endpoints answer, per provider, in this process. A failed generation marks the provider down and the router
 * answers until a probe or a test brings it back (D8). A provider nobody has checked yet counts as worth trying.
 */
export interface ModelHealth {
  available(providerId: string): boolean;
  checkedAt(providerId: string): string | null;
  mark(providerId: string, ok: boolean, at: string): void;
}
/** The model one turn uses, resolved for the person on the server (D24). */
export interface ResolvedModel {
  id: string;
  title: string;
  providerId: string;
  tools: boolean;
  generate: ModelGenerate;
}
export interface ModelResolver {
  /** The person's model for this turn: their pick, else the default, else the first they may use; none means the router (D8). */
  resolve(persona: AuthenticatedContext): Promise<ResolvedModel | undefined>;
  health: Pick<ModelHealth, 'available' | 'mark'>;
}
export interface AssistantDeps {
  store: ThreadStore;
  registry: Pick<
    Registry,
    'tools' | 'areas' | 'list' | 'find' | 'allowed' | 'visible' | 'capabilitiesFor' | 'connector'
  >;
  run: <O = unknown>(persona: AuthenticatedContext, name: string, input: unknown) => Promise<O>;
  calendar: Pick<CalendarUsecases, 'listWeek' | 'readToday' | 'samtalStatus' | 'ensureProposalThread' | 'replan'>;
  models: ModelResolver;
  clock: () => Date;
  ids: () => string;
  log: (message: string, ...details: unknown[]) => void;
}
