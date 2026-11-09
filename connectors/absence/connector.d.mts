export interface StatRow {
  unit: string;
  period: string;
  total: number | null;
  short: number | null;
  long: number | null;
  headcount: number | null;
}
export interface Statistics {
  read(): Promise<{ reloadedAt: string | null; rows: StatRow[] }>;
}
export declare const manifest: unknown;
export declare function createConnector(options?: {
  jwks?: object | (() => Promise<object>);
  secret?: string;
  statistics?: Statistics;
  unitMap?: Record<string, string[]>;
  minGroup?: number;
  warnAbove?: number;
  cacheSeconds?: number;
  now?: () => number;
}): { manifest: unknown; handle(request: Request): Promise<Response> };
