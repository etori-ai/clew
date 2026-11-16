import type { CaseSource } from './cases.mjs';
export type FieldMap = Record<
  | 'id'
  | 'number'
  | 'title'
  | 'status'
  | 'caseType'
  | 'category'
  | 'handler'
  | 'group'
  | 'customer'
  | 'changed'
  | 'created'
  | 'closed'
  | 'userGroups',
  string
>;
export declare const DEFAULT_FIELDS: FieldMap;
export declare function fieldMap(overrides?: Record<string, unknown>): FieldMap;
export declare function instantIn(value: unknown, timeZone: string): string | undefined;
export declare function createPobCases(options?: {
  url?: string;
  authorization?: string;
  fields?: FieldMap;
  userMatch?: string;
  customerMatch?: string;
  statusLabels?: Record<string, string>;
  timeZone?: string;
  listLimit?: number;
  timeoutMs?: number;
  inFlight?: number;
  insecureHosts?: string[];
  fetch?: typeof fetch;
  now?: () => number;
}): CaseSource & { check(): Promise<{ described: boolean; missing: string[] }> };
