import type { BillingSource } from './records.mjs';
export declare const money: (amount: number) => string;
export declare function shownRecord(raw: unknown, customers?: object): Record<string, any>;
export declare function quantityOf(shown: object): string;
export declare function createConnector(options: {
  secret?: string;
  jwks?: object | (() => Promise<object>);
  clewUrl?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  source: BillingSource;
  sourceLabel?: string;
  errandLink?: string;
  customers?: { INTERNAL?: Record<string, string>; EXTERNAL?: Record<string, string> };
  clock?: () => Date;
  log?: (entry: Record<string, unknown>) => void;
}): { manifest: unknown; handle(request: Request): Promise<Response> };
