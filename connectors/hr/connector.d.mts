import type { FixtureState } from './state.mjs';

export declare const manifest: unknown;
export declare const FAULTS: readonly string[];
export declare function createConnector(options?: {
  jwks?: object | (() => Promise<object>);
  secret?: string;
  clewUrl?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  state?: FixtureState;
  clock?: () => Date;
  fault?: string;
  unitMap?: Record<string, string>;
  personMap?: Record<string, string>;
  feedKey?: string;
  fresh?: boolean;
}): { manifest: unknown; handle(request: Request): Promise<Response>; close(): void };
