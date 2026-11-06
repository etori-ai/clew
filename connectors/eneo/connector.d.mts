export declare const manifest: unknown;
export declare function decodeClaims(token: string): Record<string, unknown> | null;
export declare function createConnector(options?: {
  jwks?: object | (() => Promise<object>);
  secret?: string;
  eneoUrl?: string;
  fetch?: (input: string, init?: RequestInit) => Promise<Response>;
  ttlSeconds?: number;
  now?: () => number;
  perCallMs?: number;
}): { manifest: unknown; handle(request: Request): Promise<Response> };
