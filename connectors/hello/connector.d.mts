export declare const manifest: unknown;
export declare function createConnector(options?: { jwks?: object | (() => Promise<object>); secret?: string; clewUrl?: string; fetch?: (input: string, init?: RequestInit) => Promise<Response> }): { manifest: unknown; handle(request: Request): Promise<Response> };
