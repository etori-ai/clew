export interface StatRow {
  unit: string;
  period: string;
  total: number | null;
  short: number | null;
  long: number | null;
  headcount: number | null;
}
export interface EconomyRow {
  unit: string;
  period: string;
  budget: number;
  forecast: number;
}
export interface HmeRow {
  unit: string;
  year: number;
  total: number;
  motivation: number;
  leadership: number;
  governance: number;
  respondents: number;
}
export interface Statistics {
  /** True when the adapter reads only the units it is asked about, so the connector caches per set of units. */
  perUnit?: boolean;
  read(units?: string[]): Promise<{ reloadedAt: string | null; rows: StatRow[] }>;
  economy?(units?: string[]): Promise<{ reloadedAt: string | null; rows: EconomyRow[] }>;
  hme?(units?: string[]): Promise<{ reloadedAt: string | null; rows: HmeRow[] }>;
}
export declare const manifest: unknown;
export declare function createConnector(options?: {
  jwks?: object | (() => Promise<object>);
  secret?: string;
  statistics?: Statistics;
  /** `null` is the fixture's open mode: every unit Clew asks about, by Clew's id. */
  unitMap?: Record<string, string[]> | null;
  minGroup?: number;
  warnAbove?: number;
  alertAbove?: number;
  economyAlertBelow?: number;
  hmeOkFrom?: number;
  hmeWarnFrom?: number;
  cacheSeconds?: number;
  now?: () => number;
}): { manifest: unknown; handle(request: Request): Promise<Response> };
