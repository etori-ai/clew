export declare const manifest: unknown;
export declare function verifyAssertion(token: string, secret: string, now?: number): { id: string; name: string; unitId: string; unitLabel: string; role: 'manager' | 'employee' } | null;
export declare function decodeClaims(token: string): Record<string, unknown> | null;
export declare function createConnector(options?: { secret?: string; eneoUrl?: string; fetch?: (input: string, init?: RequestInit) => Promise<Response>; ttlSeconds?: number; now?: () => number; perCallMs?: number }): { manifest: unknown; handle(request: Request): Promise<Response> };
