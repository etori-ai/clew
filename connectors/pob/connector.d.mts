import type { CaseSource } from './cases.mjs';
export type StatusKind = 'new' | 'open' | 'waiting-reporter' | 'waiting-other' | 'closed';
export declare const STATUS_KINDS: StatusKind[];
export declare const DEFAULT_COST_CODE: string;
export declare function createManifest(options?: {
  audience?: string;
  source?: string;
  writes?: string[];
  costs?: { identifier: string; amountLabel?: string };
}): unknown;
export declare function createConnector(options?: {
  jwks?: object | (() => Promise<object>);
  secret?: string;
  source?: CaseSource;
  identity?: {
    issuer?: string;
    jwks?: object | (() => Promise<object>);
    jwksUrl?: string;
    insecureHosts?: string[];
    fetch?: typeof fetch;
  };
  audience?: string;
  accountClaim?: string;
  sourceLabel?: string;
  statusKinds?: Record<string, StatusKind>;
  caseTypes?: string[];
  problemMemo?: string;
  caseLink?: string;
  writes?: string[];
  /** D148: the cost read, and which of the directory's unit identifiers the service desk books costs on. */
  costs?: { identifier: string; amountLabel?: string; codePattern?: string };
  create?: { caseType: string; category: string; groupId: string };
  urgentNote?: string;
  now?: () => number;
  log?: (line: Record<string, unknown>) => void;
}): { manifest: unknown; handle(request: Request): Promise<Response> };
