import type { BillingSource } from './records.mjs';
export declare const ACCOUNT_PATTERN: RegExp;
export declare function writable(record: Record<string, unknown>): Record<string, unknown>;
export declare function createBillingPreprocessor(options: {
  url?: string;
  tokenUrl?: string;
  clientId?: string;
  clientSecret?: string;
  municipalityId?: string;
  category?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  pageSize?: number;
  now?: () => number;
}): BillingSource;
