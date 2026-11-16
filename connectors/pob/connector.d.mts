import type { CaseSource } from './cases.mjs';
export type StatusKind = 'new' | 'open' | 'waiting-reporter' | 'waiting-other' | 'closed';
export declare const STATUS_KINDS: StatusKind[];
export declare function createManifest(options?: { audience?: string; source?: string; writes?: string[] }): unknown;
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
  create?: { caseType: string; category: string; groupId: string };
  urgentNote?: string;
  now?: () => number;
  log?: (line: Record<string, unknown>) => void;
}): { manifest: unknown; handle(request: Request): Promise<Response> };
