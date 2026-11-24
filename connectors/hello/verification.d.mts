/**
 * What a request binds an assertion to (D117, D119): the digest of its exact body, its `X-Clew-Operation-Id` when it
 * carries one, and, on a capability's route or an installation read's, its name and which route it is. `capability` is
 * undefined only on the routes that name none (`/clew/scan`, `/clew/figure`, `/clew/documents`, `/clew/ask`) and null on
 * any other path, which no assertion matches.
 */
export interface AssertionBinding {
  body: string;
  operationId?: string;
  capability?: string | null;
  route?: 'capabilities' | 'installation';
}
/** The subject and the `caller` claim of the installation's own assertion (D119). */
export declare const INSTALLATION_SUBJECT: 'clew:installation';
export declare const INSTALLATION_CALLER: 'installation';
export declare function bodyDigest(text: string): string;
export declare function bindingOf(request: Request): Promise<AssertionBinding>;
export declare function verifyAssertion(
  token: string,
  jwks: object,
  audience: string,
  now?: number,
  binding?: AssertionBinding,
): { id: string; name: string; unitId: string; unitLabel: string; role: 'manager' | 'employee' } | null;
/** Whether the assertion is the installation's own for exactly this request (D119); `binding` is required. */
export declare function verifyInstallationAssertion(
  token: string,
  jwks: object,
  audience: string,
  now?: number,
  binding?: AssertionBinding,
): boolean;
export declare function b64(value: string): Buffer;
export declare function callbackFor(token: string): string;
/** The person behind a request, or null; `.installation` says whether the installation itself sent it (D119). */
export interface Verifier {
  (token: string, suppliedKey?: string | null, request?: Request): Promise<ReturnType<typeof verifyAssertion>>;
  installation(token: string, suppliedKey?: string | null, request?: Request): Promise<boolean>;
}
export declare function createVerifier(
  options: { secret?: string; jwks?: object | (() => Promise<object>); clewUrl?: string; fetch?: typeof fetch },
  audience: string,
): Verifier;
