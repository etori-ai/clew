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
export interface ErrandSource {
  mine(token: string, relation: Relation): Promise<SourceErrand[]>;
  errand(token: string, namespace: string, id: string): Promise<SourceErrand>;
}
export declare const defaultStatusKinds: Record<string, StatusKind>;
export declare const STATUS_KINDS: StatusKind[];
/** The adapter `SM_ADAPTER` names. Throws when none is named, the name is unknown, or `fixture` is named beside `SM_URL`. */
export declare function adapterOf(env: Record<string, string | undefined>): 'api' | 'fixture';
export declare function createManifest(options?: { audience?: string; source?: string }): unknown;
export declare function createConnector(options?: {
  jwks?: object | (() => Promise<object>);
  secret?: string;
  source?: ErrandSource;
  municipalityId?: string;
  audience?: string;
  sourceLabel?: string;
  statusKinds?: Record<string, StatusKind>;
  links?: Record<string, string>;
  now?: () => number;
}): { manifest: unknown; handle(request: Request): Promise<Response> };
