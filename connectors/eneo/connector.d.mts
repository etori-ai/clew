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
  /** Where a person opens Eneo in a browser (https), for the link that continues a conversation there. */
  eneoPublicUrl?: string;
  /** The longest one assistant answer may take. */
  askTotalMs?: number;
}): { manifest: unknown; handle(request: Request): Promise<Response> };
