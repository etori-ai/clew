import type { FixtureState } from './state.mjs';

export interface ReportedAbsence {
  ref: string;
  person: string;
  from: string;
  to: string;
  extent: number;
  at: string;
}
export declare const manifest: unknown;
export declare const FAULTS: readonly string[];
export declare function httpFeed(options: {
  url?: string;
  key?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
}): () => Promise<ReportedAbsence[]>;
export declare function createConnector(options?: {
  jwks?: object | (() => Promise<object>);
  secret?: string;
  clewUrl?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  state?: FixtureState;
  clock?: () => Date;
  fault?: string;
  unitMap?: Record<string, string>;
  feed?: () => Promise<ReportedAbsence[]>;
}): { manifest: unknown; handle(request: Request): Promise<Response>; close(): void };
