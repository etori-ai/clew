import type { FixtureState } from './state.mjs';

export declare const FAULTS: readonly string[];
export declare function createConnector(options?: {
  jwks?: object | (() => Promise<object>);
  secret?: string;
  clewUrl?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  state?: FixtureState;
  clock?: () => Date;
  fault?: string;
  fresh?: boolean;
  resource?: string;
  issuer?: string;
  issuerJwks?: object | (() => Promise<object>);
  scopes?: string[];
}): { manifest: unknown; handle(request: Request): Promise<Response>; close(): void };
