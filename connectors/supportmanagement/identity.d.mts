export declare const ACCOUNT_PATTERN: RegExp;
export declare function verifyPersonToken(
  token: string,
  jwks: unknown,
  options: { issuer: string; audience: string; now?: number },
): Record<string, unknown> | null;
export declare function createTokenVerifier(options: {
  issuer?: string;
  audience: string;
  jwks?: object | (() => Promise<object>);
  jwksUrl?: string;
  insecureHosts?: string[];
  fetch?: typeof fetch;
  now?: () => number;
}): (
  token: string,
) => Promise<{ status: 'ok'; claims: Record<string, unknown> } | { status: 'refused' } | { status: 'unavailable' }>;
