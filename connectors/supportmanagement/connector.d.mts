export type Relation = 'assigned' | 'group' | 'reported';
export type StatusKind = 'new' | 'open' | 'waiting-reporter' | 'waiting-other' | 'closed';
export interface SourceErrand {
  namespace: string;
  area: string;
  id: string;
  errandNumber: string;
  type: string;
  status: string;
  statusLabel: string;
  since: string;
  relation?: Relation;
  suspendedTo?: string;
  title?: string;
  description?: string;
}
/** An errand as its owner's side works with it (requests.mjs). */
export interface OwnedRecord {
  errand: SourceErrand;
  created?: string;
  owner: { username: string; email?: string } | null;
  flowInstanceId?: string;
  /** The account that owns the Open-E flow instance, as Open-E answers. Without it no e-service message is shown. */
  flowInstanceOwner?: string;
}
export interface Message {
  id: string;
  channel: 'email' | 'webmessage' | 'conversation';
  direction: 'in' | 'out';
  internal?: boolean;
  at: string;
  from?: { name?: string; address?: string; account?: string };
  to?: string[];
  cc?: string[];
  text: string;
  attachments?: string[];
  conversation?: { type: 'EXTERNAL' | 'INTERNAL'; related: boolean; participants: string[] };
}
export interface ErrandSource {
  mine(token: string, relation: Relation): Promise<SourceErrand[]>;
  errand(token: string, namespace: string, id: string): Promise<SourceErrand>;
}
/** The owner's side of the port (requests.mjs), which a source answers when the connector's `owner` is on. */
export interface OwnerSource {
  owned(account: string): Promise<OwnedRecord[]>;
  record(account: string, namespace: string, id: string): Promise<OwnedRecord | null>;
  messages(account: string, record: OwnedRecord): Promise<Message[]>;
  postOwnerMessage(
    account: string,
    record: OwnedRecord,
    text: string,
    operationId?: string,
  ): Promise<{ id: string; at: string }>;
}
export interface OwnerSettings {
  identity: { issuer: string; jwksUrl?: string; jwks?: object | (() => Promise<object>); insecureHosts?: string[] };
  accountClaim?: string;
  replyAddresses?: Record<string, string>;
  stateSeconds?: number;
}
export declare const defaultStatusKinds: Record<string, StatusKind>;
export declare const STATUS_KINDS: StatusKind[];
export declare function createManifest(options?: { audience?: string; source?: string; owner?: boolean }): unknown;
export declare function createConnector(options?: {
  jwks?: object | (() => Promise<object>);
  secret?: string;
  source?: ErrandSource & Partial<OwnerSource>;
  municipalityId?: string;
  audience?: string;
  sourceLabel?: string;
  statusKinds?: Record<string, StatusKind>;
  links?: Record<string, string>;
  owner?: OwnerSettings;
  now?: () => number;
  log?: (line: Record<string, unknown>) => void;
}): { manifest: unknown; handle(request: Request): Promise<Response>; forget(): void };
