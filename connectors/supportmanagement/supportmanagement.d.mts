import type { ErrandSource } from './connector.mjs';
export declare function createSupportManagementErrands(options: {
  url?: string;
  municipalityId?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  pageSize?: number;
  metadataSeconds?: number;
  areas?: Record<string, string>;
  now?: () => number;
}): ErrandSource;
