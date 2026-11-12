/** What a request binds an assertion to (D117): the digest of its exact body and, on a capability's route, its name. */
export interface AssertionBinding {
  body: string;
  capability?: string;
}
export declare function bodyDigest(text: string): string;
export declare function bindingOf(request: Request): Promise<AssertionBinding>;
export declare function verifyAssertion(
  token: string,
  jwks: object,
  audience: string,
  now?: number,
  binding?: AssertionBinding,
): { id: string; name: string; unitId: string; unitLabel: string; role: 'manager' | 'employee' } | null;
export declare function b64(value: string): Buffer;
export declare function callbackFor(token: string): string;
export declare function createVerifier(
  options: { secret?: string; jwks?: object | (() => Promise<object>); clewUrl?: string; fetch?: typeof fetch },
  audience: string,
): (token: string, suppliedKey?: string | null, request?: Request) => Promise<ReturnType<typeof verifyAssertion>>;
