export declare const manifest: unknown;
export declare function verifyAssertion(token: string, secret: string, now?: number): { id: string; name: string; unitId: string; unitLabel: string; role: 'manager' | 'employee' } | null;
export declare function createConnector(options?: { secret?: string; clewUrl?: string; fetch?: (input: string, init?: RequestInit) => Promise<Response> }): { manifest: unknown; handle(request: Request): Promise<Response> };
