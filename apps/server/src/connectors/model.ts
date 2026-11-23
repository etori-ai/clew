import type {
  AreaOverride,
  AuditEntryView,
  CapabilityOverride,
  CheckFinding,
  CheckReport,
  ConnectorAudience,
  ConnectorHealth,
  ConnectorState,
} from '@clew/contracts';
import type { ConnectorManifest } from '@clew/connectors/protocol';

/**
 * The ports of connector administration (D23, D25): what the admin use cases may read and write, and the two things they
 * must never do themselves, open a secret and talk to a service. Instants are ISO strings handed in by the use case.
 * `adapters/postgres.ts` is what the server runs; `adapters/memory.ts` is what the unit tests run, held to the same
 * behaviour by `tests/connector-store-contract.ts`.
 */
export interface ConnectorRecord {
  id: string;
  bundled: boolean;
  url: string | null;
  /** The sealed envelope, opaque to the use case. Never leaves the server. */
  secret: string | null;
  secretChangedAt: string | null;
  state: ConnectorState;
  audience: ConnectorAudience;
  scanEnabled: boolean;
  toolsEnabled: boolean;
  /** Gives Clew its shared header (D88): at most one row, chosen by an administrator. */
  header: boolean;
  capabilities: Record<string, CapabilityOverride>;
  /** Per area of the manifest (D54): `figure: false` when its figure is switched off on Hem. */
  areas: Record<string, AreaOverride>;
  /** The manifest an administrator approved: the only one the registry registers (D144). */
  manifest: unknown | null;
  manifestAt: string | null;
  /** What the service serves when it differs from the approved manifest, and since when; never live (D144). */
  offered: unknown | null;
  offeredAt: string | null;
  health: ConnectorHealth;
  createdBy: string;
  updatedBy: string;
  createdAt: string;
  updatedAt: string;
  version: number;
  /** The system's place in the registration order (D71), assigned by the store on insert; null on a bundled row. */
  ordinal: number | null;
}
export interface NewConnector {
  id: string;
  bundled: boolean;
  url: string | null;
  secret: string | null;
  state: ConnectorState;
  manifest: unknown | null;
  health: ConnectorHealth;
  createdBy: string;
  at: string;
}
export type ConnectorPatch = Partial<
  Pick<
    ConnectorRecord,
    | 'url'
    | 'secret'
    | 'secretChangedAt'
    | 'state'
    | 'audience'
    | 'scanEnabled'
    | 'toolsEnabled'
    | 'header'
    | 'capabilities'
    | 'areas'
    | 'manifest'
    | 'manifestAt'
    | 'offered'
    | 'offeredAt'
    | 'health'
  >
>;
export interface AuditEntry {
  actor: string;
  action: string;
  subject: string;
  at: string;
  details?: Record<string, unknown>;
}
/** Writes inside one transaction: the audit row commits or rolls back with the rest. */
export interface ConnectorTx {
  /** False when the id is taken. */
  insert(record: NewConnector): Promise<boolean>;
  /** Bumps the version; false when the row does not exist. */
  update(id: string, patch: ConnectorPatch, by: string, at: string): Promise<boolean>;
  remove(id: string): Promise<void>;
  /** Dismiss every open card this connector pushed, at this instant; returns how many. */
  dismissOpenThreadsOf(connectorId: string, at: string): Promise<number>;
  writeAudit(entry: AuditEntry): Promise<void>;
}
export interface ConnectorStore {
  list(): Promise<ConnectorRecord[]>;
  read(id: string): Promise<ConnectorRecord | undefined>;
  /**
   * A check's result is not administration: no version bump, no audit, and the approved manifest is never touched
   * (D144). `offered` is what the service serves when it differs from the approved one, `null` when it does not, and is
   * left alone when omitted; the same offer seen again keeps the instant `at` it was first seen.
   */
  recordHealth(id: string, health: ConnectorHealth, offered?: unknown, at?: string): Promise<void>;
  /** A bundled connector's description is its code and moves with the build; a remote row is never changed here. */
  recordDescription(id: string, manifest: unknown, at: string): Promise<void>;
  /** The audit rows about one connector, oldest first. */
  history(id: string): Promise<AuditEntryView[]>;
  transaction<T>(fn: (tx: ConnectorTx) => Promise<T>): Promise<T>;
}
/** Sealing is the composition root's business (the master key); the use case only hands envelopes around. */
export interface Secrets {
  seal(value: string, connectorId: string): string;
  open(sealed: string, connectorId: string): string;
}
/** The service side: fetching a manifest and running the conformance check, with the secret the use case opened. */
export interface Transport {
  fetchManifest(url: string, id: string): Promise<ConnectorManifest>;
  check(input: {
    url: string;
    id: string;
    secret: string;
  }): Promise<CheckReport & { findings: CheckFinding[]; manifest?: ConnectorManifest }>;
}
/** The live registry's remote side (`remote.ts`): put a connector in with its signer, or take it out. */
export interface LiveRegistration {
  register(source: { id: string; url: string; secret: string; manifest: unknown }, manifest: ConnectorManifest): void;
  unregister(id: string): void;
}
/** The organisation's units as provisioned (D68), for the audience editor. */
export interface Units {
  list(): Promise<Array<{ id: string; label: string }>>;
}
/** The provisioned groups with an external id (D68), for the audience editor: `id` is the external id an audience names. */
export interface Groups {
  list(): Promise<Array<{ id: string; label: string }>>;
}
