import * as oidc from 'openid-client';
import { boundedJson } from '@clew/connectors/remote';
import { GrantRefused, type AuthorizationServer, type OAuth, type OAuthClient, type TokenSet } from '../ports';

/**
 * The OAuth port over openid-client (D147 item 3): Clew as a client of a system's own authorization server. The
 * library does the grants and their checks (the state, PKCE, the issuer on return); this file reads the two metadata
 * documents, registers a client, and turns every failure into `GrantRefused`, final or passing, with a code and never
 * the server's own words.
 */
export interface OAuthAdapterOptions {
  /** The name Clew registers itself under at a system. */
  clientName: string;
  /** Plain http is allowed. A local development stack only; every other installation reaches a system over HTTPS. */
  insecure?: boolean;
  /** The fetch to use. A test passes an authorization server in memory. */
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  /** How long one request may take, in seconds. */
  timeoutSeconds?: number;
}
/** The most of a metadata or registration answer Clew reads. */
const DOCUMENT_BYTES = 100_000;
/** OAuth errors that say "not now", whatever status they come with. */
const PASSING = new Set(['temporarily_unavailable', 'server_error', 'slow_down']);
/** A code as a log line or an audit row carries it: printable ASCII, at most 64 characters. */
const printable = (value: string) => value.replace(/[^\x21-\x7e]/g, '?').slice(0, 64) || 'unknown';
const codeOf = (value: unknown) =>
  value && typeof value === 'object' && 'code' in value && typeof value.code === 'string' ? value.code : undefined;
const statusOf = (value: unknown) =>
  value && typeof value === 'object' && 'status' in value && typeof value.status === 'number'
    ? value.status
    : undefined;
const passingStatus = (status: number) => status >= 500 || status === 429 || status === 408;
const text = (value: unknown) => (typeof value === 'string' && value ? value : undefined);

/**
 * A failure as the use cases read it. An answer that names an OAuth error is final unless the error or its status says
 * "not now"; an answer the library would not accept (a state or an issuer that does not match) is final; an answer
 * with only a status follows the status; anything that never got an answer is passing.
 */
export function refusalOf(error: unknown): GrantRefused {
  if (error instanceof GrantRefused) return error;
  if (error instanceof oidc.ResponseBodyError)
    return new GrantRefused(printable(error.error), !(PASSING.has(error.error) || passingStatus(error.status)));
  if (error instanceof oidc.AuthorizationResponseError) return new GrantRefused(printable(error.error), true);
  const cause = error instanceof Error ? error.cause : undefined;
  const code = codeOf(error) ?? codeOf(cause);
  const status = statusOf(error) ?? statusOf(cause);
  if (code === 'OAUTH_INVALID_RESPONSE') return new GrantRefused(code, true);
  if (status !== undefined) return new GrantRefused(printable(code ?? 'http-' + status), !passingStatus(status));
  return new GrantRefused(printable(code ?? 'unreachable'), false);
}

/** `/.well-known/<name>` placed between the host and the path, as RFC 8414 and RFC 9728 place it. */
function inserted(address: string, name: string): string {
  const url = new URL(address);
  return `${url.origin}/.well-known/${name}${url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')}`;
}
/** `/.well-known/<name>` after the path, as OpenID Connect Discovery places it and several servers place both. */
const appended = (address: string, name: string) => `${address.replace(/\/$/, '')}/.well-known/${name}`;
const sameAddress = (a: string, b: string) => {
  try {
    return new URL(a).href === new URL(b).href;
  } catch {
    return false;
  }
};

export function oauthAdapter(options: OAuthAdapterOptions): OAuth {
  const fetchOf = options.fetch ?? ((url: string, init?: RequestInit) => fetch(url, init));
  const timeout = options.timeoutSeconds ?? 10;

  /** A request of this file's own. An address that is not HTTPS is refused unless the installation is a local one. */
  async function request(url: string, init: RequestInit): Promise<Response> {
    let address: URL;
    try {
      address = new URL(url);
    } catch {
      throw new GrantRefused('malformed-address', true);
    }
    if (address.protocol !== 'https:' && !(options.insecure && address.protocol === 'http:'))
      throw new GrantRefused('insecure-address', true);
    try {
      // A redirect is not followed: the address an administrator approved is the one that is asked.
      return await fetchOf(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(timeout * 1000) });
    } catch (error) {
      throw new GrantRefused(printable(codeOf(error) ?? (error instanceof Error ? error.name : 'unreachable')), false);
    }
  }

  /** A JSON document at an address, or null where the server has none there. */
  async function document(url: string): Promise<Record<string, unknown> | null> {
    const response = await request(url, { headers: { accept: 'application/json' } });
    if (response.status === 404 || response.status === 410) {
      await response.body?.cancel().catch(() => undefined);
      return null;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new GrantRefused('metadata-' + response.status, !passingStatus(response.status));
    }
    let body: unknown;
    try {
      body = await boundedJson(response, DOCUMENT_BYTES);
    } catch {
      throw new GrantRefused('metadata-malformed', true);
    }
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new GrantRefused('metadata-malformed', true);
    return body as Record<string, unknown>;
  }

  function configuration(server: AuthorizationServer, client: OAuthClient): oidc.Configuration {
    const config = new oidc.Configuration(
      {
        issuer: server.issuer,
        authorization_endpoint: server.authorizationEndpoint,
        token_endpoint: server.tokenEndpoint,
        ...(server.revocationEndpoint ? { revocation_endpoint: server.revocationEndpoint } : {}),
        authorization_response_iss_parameter_supported: server.issuerOnReturn,
      },
      client.id,
      undefined,
      client.secret ? oidc.ClientSecretBasic(client.secret) : oidc.None(),
    );
    config.timeout = timeout;
    if (options.fetch) config[oidc.customFetch] = (url, init) => options.fetch!(url, init as RequestInit);
    if (options.insecure) oidc.allowInsecureRequests(config);
    return config;
  }

  const tokensOf = (answer: oidc.TokenEndpointResponse): TokenSet => ({
    accessToken: answer.access_token,
    refreshToken: text(answer.refresh_token) ?? null,
    expiresIn: typeof answer.expires_in === 'number' ? answer.expires_in : null,
    scopes: text(answer.scope)?.split(' ').filter(Boolean) ?? null,
  });

  return {
    async discover(resource) {
      // The system says who issues its tokens (RFC 9728). One that says nothing may be its own authorization server.
      const protectedResource = await document(inserted(resource, 'oauth-protected-resource'));
      let issuer = resource.replace(/\/$/, '');
      if (protectedResource) {
        if (!sameAddress(text(protectedResource.resource) ?? '', resource))
          throw new GrantRefused('resource-mismatch', true);
        const servers = protectedResource.authorization_servers;
        const first = Array.isArray(servers) ? text(servers[0]) : undefined;
        if (!first) return null;
        issuer = first;
      }
      // RFC 8414's place first, then the two places servers that began with OpenID Connect use.
      const metadata =
        (await document(inserted(issuer, 'oauth-authorization-server'))) ??
        (await document(appended(issuer, 'oauth-authorization-server'))) ??
        (await document(appended(issuer, 'openid-configuration')));
      if (!metadata) return null;
      // The document must be the issuer's own (RFC 8414, section 3.3), or another server could answer for it.
      if (metadata.issuer !== issuer) throw new GrantRefused('issuer-mismatch', true);
      const authorizationEndpoint = text(metadata.authorization_endpoint);
      const tokenEndpoint = text(metadata.token_endpoint);
      if (!authorizationEndpoint || !tokenEndpoint) throw new GrantRefused('metadata-malformed', true);
      const methods = metadata.code_challenge_methods_supported;
      return {
        issuer,
        authorizationEndpoint,
        tokenEndpoint,
        revocationEndpoint: text(metadata.revocation_endpoint) ?? null,
        registrationEndpoint: text(metadata.registration_endpoint) ?? null,
        pkce: Array.isArray(methods) && methods.includes('S256'),
        issuerOnReturn: metadata.authorization_response_iss_parameter_supported === true,
        clientDocuments: metadata.client_id_metadata_document_supported === true,
      };
    },

    async register(server, redirectUri) {
      if (!server.registrationEndpoint) throw new GrantRefused('no-registration', true);
      const response = await request(server.registrationEndpoint, {
        method: 'POST',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({
          client_name: options.clientName,
          redirect_uris: [redirectUri],
          grant_types: ['authorization_code', 'refresh_token'],
          response_types: ['code'],
          // Without a secret where the server checks PKCE; with one everywhere else (D147 item 3).
          token_endpoint_auth_method: server.pkce ? 'none' : 'client_secret_basic',
        }),
      });
      let body: unknown;
      try {
        body = await boundedJson(response, DOCUMENT_BYTES);
      } catch {
        body = undefined;
      }
      const answer = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
      if (!response.ok)
        throw new GrantRefused(
          printable(text(answer.error) ?? 'registration-' + response.status),
          !passingStatus(response.status),
        );
      const id = text(answer.client_id);
      if (!id) throw new GrantRefused('registration-malformed', true);
      return { id, secret: text(answer.client_secret) ?? null, source: 'registered' };
    },

    async begin(server, client, ask) {
      const state = oidc.randomState();
      const verifier = oidc.randomPKCECodeVerifier();
      // PKCE and the resource are always sent: a server that knows neither ignores them.
      const parameters: Record<string, string> = {
        redirect_uri: ask.redirectUri,
        state,
        code_challenge: await oidc.calculatePKCECodeChallenge(verifier),
        code_challenge_method: 'S256',
        resource: ask.resource,
      };
      if (ask.scopes.length) parameters.scope = ask.scopes.join(' ');
      return { url: oidc.buildAuthorizationUrl(configuration(server, client), parameters).href, state, verifier };
    },

    async redeem(server, client, answer) {
      // The library reads the redirect address from the address it is given, so the answer's parameters are put on the
      // one Clew registered: what a proxy made of the request's own address never reaches the token endpoint.
      const current = new URL(answer.redirectUri);
      try {
        for (const [name, value] of new URL(answer.returned).searchParams) current.searchParams.append(name, value);
        return tokensOf(
          await oidc.authorizationCodeGrant(
            configuration(server, client),
            current,
            { pkceCodeVerifier: answer.verifier, expectedState: answer.state },
            { resource: answer.resource },
          ),
        );
      } catch (error) {
        throw refusalOf(error);
      }
    },

    async refresh(server, client, refreshToken, resource) {
      try {
        return tokensOf(await oidc.refreshTokenGrant(configuration(server, client), refreshToken, { resource }));
      } catch (error) {
        throw refusalOf(error);
      }
    },

    async revoke(server, client, token) {
      if (!server.revocationEndpoint) throw new GrantRefused('no-revocation', true);
      try {
        await oidc.tokenRevocation(configuration(server, client), token);
      } catch (error) {
        throw refusalOf(error);
      }
    },
  };
}
