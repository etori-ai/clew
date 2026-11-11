import type { ApprovalSource } from './approvals.mjs';
export declare function createManifest(options?: { audience?: string; source?: string }): unknown;
export declare function createConnector(options?: {
  jwks?: object | (() => Promise<object>);
  secret?: string;
  source?: ApprovalSource;
  audience?: string;
  sourceLabel?: string;
  publicUrl?: string;
  clewUrl?: string;
  now?: () => number;
}): { manifest: unknown; handle(request: Request): Promise<Response> };
