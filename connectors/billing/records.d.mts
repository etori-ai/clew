export declare class SourceUnavailable extends Error {}
export declare class SourceNotFound extends Error {}
export declare class SourceRefused extends Error {}
export declare const STATUSES: readonly string[];
export declare function nextFifteenth(day: string): string;
export type BillingRecord = Record<string, any> & { id: string; status: string; category: string };
export interface BillingSource {
  list(userName: string | undefined): Promise<BillingRecord[]>;
  get(userName: string | undefined, id: string): Promise<BillingRecord>;
  put(userName: string | undefined, record: BillingRecord): Promise<BillingRecord | null>;
}
export declare function createFixtureRecords(options?: {
  category?: string;
  today?: () => string;
  fault?: string;
}): BillingSource & {
  calls: Array<{ userName: string | undefined; what: string }>;
  reset(): void;
  transfer(): void;
};
export declare const FIXTURE_CUSTOMERS: { INTERNAL: Record<string, string>; EXTERNAL: Record<string, string> };
