/**
 * The two OpenID Connect steps of a sign-in that need no database, so the unit suite runs them against a fake
 * provider: the authorization URL the browser is sent to, and the redemption of the code it comes back with. A sign-in
 * follows the identity provider's own session (Q9 of the 2026-11-12 users review): no `prompt` and no `max_age` are
 * sent, and the ID token's `auth_time` is not required, so single sign-on works and a provider that leaves `auth_time`
 * out signs the person in. An organisation that wants a fresh prompt, on shared computers for example, sets it in the
 * provider (Entra ID Conditional Access sign-in frequency).
 */
import {
  authorizationCodeGrant,
  buildAuthorizationUrl,
  calculatePKCECodeChallenge,
  type Configuration,
} from 'openid-client';

/** What one sign-in sends and later checks: the callback, the scope, and its state, nonce and PKCE verifier. */
export interface LoginRequest {
  callback: string;
  scope: string;
  state: string;
  nonce: string;
  verifier: string;
}
/** Authorization Code with PKCE (S256), state and nonce, the provider's pages in Swedish. */
export async function authorizationUrl(config: Configuration, request: LoginRequest) {
  return buildAuthorizationUrl(config, {
    redirect_uri: request.callback,
    scope: request.scope,
    state: request.state,
    nonce: request.nonce,
    code_challenge: await calculatePKCECodeChallenge(request.verifier),
    code_challenge_method: 'S256',
    ui_locales: 'sv',
  });
}
/** The tokens for the code the provider sent to `callback`, checked against the sign-in's state, nonce and PKCE. */
export function redeemCode(
  config: Configuration,
  callback: URL,
  request: Pick<LoginRequest, 'state' | 'nonce' | 'verifier'>,
) {
  return authorizationCodeGrant(config, callback, {
    pkceCodeVerifier: request.verifier,
    expectedState: request.state,
    expectedNonce: request.nonce,
    idTokenExpected: true,
  });
}
