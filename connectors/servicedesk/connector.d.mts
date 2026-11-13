import type { FixtureState } from './state.mjs';

export declare const manifest: unknown;
export declare const FAULTS: readonly string[];
export declare const ADVANCES: readonly ['active', 'waiting-on-me', 'closed'];
export declare function createConnector(options?: {
  jwks?: object | (() => Promise<object>);
  secret?: string;
  clewUrl?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  state?: FixtureState;
  clock?: () => Date;
  fault?: string;
  /** Opens `POST /fixture/requests/<number>`, the fixture's own route that moves a request forward. */
  fixtureKey?: string;
  fresh?: boolean;
  /** The source port (desk.mjs); the fixture over `state` by default. */
  desk?: object;
}): { manifest: unknown; handle(request: Request): Promise<Response>; close(): void };
