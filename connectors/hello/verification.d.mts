export declare function verifyAssertion(token: string, jwks: object, audience: string, now?: number): { id: string; name: string; unitId: string; unitLabel: string; role: 'manager' | 'employee' } | null;
export declare function b64(value: string): Buffer;
export declare function callbackFor(token: string): string;
export declare function createVerifier(options: { secret?: string; jwks?: object | (() => Promise<object>); clewUrl?: string; fetch?: typeof fetch }, audience: string): (token: string, suppliedKey?: string | null) => Promise<ReturnType<typeof verifyAssertion>>;
