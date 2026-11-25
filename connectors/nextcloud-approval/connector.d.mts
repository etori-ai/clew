import type { ApprovalSource } from './approvals.mjs';
/**
 * The adapter `NEXTCLOUD_ADAPTER` names. Throws when none is named, the name is unknown, or `fixture` is named beside
 * `NEXTCLOUD_URL`.
 */
export declare function adapterOf(env: Record<string, string | undefined>): 'nextcloud' | 'fixture';
export declare function createManifest(options?: {
  audience?: string;
  source?: string;
  linkedAccount?: { resource: string; scopes?: string[] };
}): unknown;
export declare function createConnector(options?: {
  jwks?: object | (() => Promise<object>);
  secret?: string;
  source?: ApprovalSource;
  audience?: string;
  /** The person links an account at Nextcloud's own OAuth 2 server (D147), instead of a token from the identity provider. */
  linkedAccount?: { resource: string; scopes?: string[] };
  sourceLabel?: string;
  publicUrl?: string;
  clewUrl?: string;
  now?: () => number;
}): { manifest: unknown; handle(request: Request): Promise<Response> };
