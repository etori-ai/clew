/**
 * An authorization server in memory (D147 item 14): a system's own OAuth server and the system it protects, as a
 * `fetch` the OAuth adapter is given, so the unit suite runs the real client code and needs no Keycloak. It is a test
 * double: it answers what the adapter asks and can be told to rotate, refuse, expire and fail.
 *
 * `modern` is a server of today: both metadata documents, PKCE checked, dynamic registration, revocation, the issuer
 * on return. `legacy` is the older kind a connected system may still run: no metadata, no PKCE, no registration, no
 * revocation, a client with a secret an administrator made.
 */
export interface AuthorizationServerOptions {
  kind?: 'modern' | 'legacy';
  issuer?: string;
  resource?: string;
  /** Where the server metadata is served: RFC 8414's place, or after the issuer's path as several servers do. */
  metadataAt?: 'inserted' | 'appended';
  /** Seconds an access token lives. */
  lifetime?: number;
  /** Whether a refresh gives a new refresh token and ends the old one. */
  rotate?: boolean;
}
interface Client {
  secret: string | null;
  redirectUris: string[];
}
interface Grant {
  account: string;
  clientId: string;
  scope: string;
  resource: string | null;
}
interface Code extends Grant {
  challenge: string | null;
  redirectUri: string;
}
const base64url = (bytes: ArrayBuffer) => Buffer.from(bytes).toString('base64url');
const sha256 = async (value: string) =>
  base64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)));
const oauthError = (status: number, error: string) => Response.json({ error }, { status });

export function authorizationServer(options: AuthorizationServerOptions = {}) {
  const kind = options.kind ?? 'modern';
  const issuer = options.issuer ?? 'https://id.vendor.test';
  const resource = options.resource ?? 'https://hr.vendor.test';
  const modern = kind === 'modern';
  const endpoints = {
    authorize: issuer + '/authorize',
    token: issuer + '/token',
    revoke: issuer + '/revoke',
    register: issuer + '/register',
  };
  const clients = new Map<string, Client>();
  const codes = new Map<string, Code>();
  const access = new Map<string, Grant>();
  const refresh = new Map<string, Grant>();
  let serial = 0;
  const next = (prefix: string) => `${prefix}-${++serial}`;
  const self = {
    kind,
    issuer,
    resource,
    endpoints,
    /** Every request made of the server, as `METHOD address`, in order. */
    requests: [] as string[],
    /** The form of every request to the token endpoint, in order. */
    grants: [] as URLSearchParams[],
    /** Set to answer every request with this status: a server that is down or busy. */
    failing: null as number | null,
    /** Set to refuse every refresh with this OAuth error. */
    refusing: null as string | null,
    /** Set to answer the metadata with another issuer: a system that now names another authorization server. */
    claims: null as string | null,
    lifetime: options.lifetime ?? 3600,
    rotate: options.rotate ?? true,
    /** A client an administrator made at the system, with the secret they copied into Clew. */
    addClient(id: string, secret: string | null, redirectUri: string) {
      clients.set(id, { secret, redirectUris: [redirectUri] });
    },
    clientIds: () => [...clients.keys()],
    /**
     * The person at the authorization page: signed in to the system as `account`, they consent, or decline. Returns
     * the address their browser is sent back to.
     */
    async consent(url: string, account = 'account-anna', answer: { decline?: boolean; issuer?: string } = {}) {
      const asked = new URL(url);
      if (asked.origin + asked.pathname !== endpoints.authorize) throw new Error('Not the authorization page: ' + url);
      const params = asked.searchParams;
      const clientId = params.get('client_id') ?? '';
      const redirectUri = params.get('redirect_uri') ?? '';
      const client = clients.get(clientId);
      if (!client || !client.redirectUris.includes(redirectUri) || params.get('response_type') !== 'code')
        throw new Error('The authorization page refused the request');
      if (modern && params.get('code_challenge_method') !== 'S256') throw new Error('PKCE with S256 is required');
      const back = new URL(redirectUri);
      back.searchParams.set('state', params.get('state') ?? '');
      if (modern || answer.issuer) back.searchParams.set('iss', answer.issuer ?? issuer);
      if (answer.decline) {
        back.searchParams.set('error', 'access_denied');
        return back.href;
      }
      const code = next('code');
      codes.set(code, {
        account,
        clientId,
        scope: params.get('scope') ?? '',
        resource: params.get('resource'),
        challenge: params.get('code_challenge'),
        redirectUri,
      });
      back.searchParams.set('code', code);
      return back.href;
    },
    /** The account a bearer token is accepted for at the system, or null: what the connector's system would answer. */
    accepts: (token: string) => access.get(token)?.account ?? null,
    /** Every token of an account is taken away at the system: the person, or an administrator there, removed it. */
    removeAccount(account: string) {
      for (const [token, grant] of access) if (grant.account === account) access.delete(token);
      for (const [token, grant] of refresh) if (grant.account === account) refresh.delete(token);
    },
    /** Access tokens stop being accepted, as when their time has passed; refresh tokens are kept. */
    expireAccessTokens() {
      access.clear();
    },
    fetch: async (url: string, init?: RequestInit): Promise<Response> => {
      const request = new Request(url, init);
      self.requests.push(`${request.method} ${url}`);
      if (self.failing) return new Response('unavailable', { status: self.failing });
      if (request.method === 'GET') {
        if (url === new URL(resource).origin + '/.well-known/oauth-protected-resource' + pathOf(resource))
          return modern
            ? Response.json({ resource, authorization_servers: [issuer] })
            : new Response('not found', { status: 404 });
        const metadataUrl =
          options.metadataAt === 'appended'
            ? issuer + '/.well-known/oauth-authorization-server'
            : new URL(issuer).origin + '/.well-known/oauth-authorization-server' + pathOf(issuer);
        if (modern && url === metadataUrl)
          return Response.json({
            issuer: self.claims ?? issuer,
            authorization_endpoint: endpoints.authorize,
            token_endpoint: endpoints.token,
            revocation_endpoint: endpoints.revoke,
            registration_endpoint: endpoints.register,
            response_types_supported: ['code'],
            grant_types_supported: ['authorization_code', 'refresh_token'],
            code_challenge_methods_supported: ['S256'],
            authorization_response_iss_parameter_supported: true,
            token_endpoint_auth_methods_supported: ['none', 'client_secret_basic'],
          });
        return new Response('not found', { status: 404 });
      }
      if (modern && url === endpoints.register) {
        const body = (await request.json()) as { redirect_uris?: string[]; token_endpoint_auth_method?: string };
        const id = next('client');
        const secret = body.token_endpoint_auth_method === 'none' ? null : next('secret');
        clients.set(id, { secret, redirectUris: body.redirect_uris ?? [] });
        return Response.json({ client_id: id, ...(secret ? { client_secret: secret } : {}) }, { status: 201 });
      }
      const form = new URLSearchParams(await request.text());
      const clientId = authenticated(request, form);
      if (url === endpoints.token) {
        self.grants.push(form);
        if (!clientId) return oauthError(401, 'invalid_client');
        const grant = await granted(form, clientId);
        if (typeof grant === 'string') return oauthError(400, grant);
        const token = next('access');
        access.set(token, grant.grant);
        return Response.json({
          access_token: token,
          token_type: 'Bearer',
          expires_in: self.lifetime,
          ...(grant.refresh ? { refresh_token: grant.refresh } : {}),
          ...(grant.grant.scope ? { scope: grant.grant.scope } : {}),
        });
      }
      if (modern && url === endpoints.revoke) {
        if (!clientId) return oauthError(401, 'invalid_client');
        const token = form.get('token') ?? '';
        const revoked = refresh.get(token) ?? access.get(token);
        // Revoking either token ends the grant: every token of that account at that client.
        if (revoked && revoked.clientId === clientId) {
          for (const [t, g] of access) if (g.account === revoked.account && g.clientId === clientId) access.delete(t);
          for (const [t, g] of refresh) if (g.account === revoked.account && g.clientId === clientId) refresh.delete(t);
        }
        return new Response(null, { status: 200 });
      }
      return new Response('not found', { status: 404 });
    },
  };

  const pathOf = (address: string) => {
    const path = new URL(address).pathname;
    return path === '/' ? '' : path.replace(/\/$/, '');
  };
  /** The client a request to the token or revocation endpoint is from: its secret in a Basic header, or none. */
  function authenticated(request: Request, form: URLSearchParams): string | null {
    const header = request.headers.get('authorization');
    if (header?.startsWith('Basic ')) {
      const [id, secret] = Buffer.from(header.slice(6), 'base64')
        .toString()
        .split(':')
        .map(part => decodeURIComponent(part));
      const client = id ? clients.get(id) : undefined;
      return client && client.secret !== null && client.secret === secret ? id! : null;
    }
    const id = form.get('client_id') ?? '';
    const client = clients.get(id);
    // A client that has a secret must show it.
    return client && client.secret === null ? id : null;
  }
  /** The grant a token request earns, with the refresh token it is answered with, or the OAuth error it is refused with. */
  async function granted(
    form: URLSearchParams,
    clientId: string,
  ): Promise<{ grant: Grant; refresh: string | null } | string> {
    if (form.get('grant_type') === 'authorization_code') {
      const value = form.get('code') ?? '';
      const code = codes.get(value);
      // A code is redeemed once.
      codes.delete(value);
      if (!code || code.clientId !== clientId || code.redirectUri !== form.get('redirect_uri')) return 'invalid_grant';
      if (modern && code.challenge !== (await sha256(form.get('code_verifier') ?? ''))) return 'invalid_grant';
      const { challenge: _challenge, redirectUri: _redirectUri, ...grant } = code;
      const token = next('refresh');
      refresh.set(token, grant);
      return { grant, refresh: token };
    }
    if (form.get('grant_type') === 'refresh_token') {
      if (self.refusing) return self.refusing;
      const value = form.get('refresh_token') ?? '';
      const grant = refresh.get(value);
      if (!grant || grant.clientId !== clientId) return 'invalid_grant';
      if (!self.rotate) return { grant, refresh: null };
      // Rotation: the old refresh token ends with this use.
      refresh.delete(value);
      const token = next('refresh');
      refresh.set(token, grant);
      return { grant, refresh: token };
    }
    return 'unsupported_grant_type';
  }
  return self;
}
export type MemoryAuthorizationServer = ReturnType<typeof authorizationServer>;
