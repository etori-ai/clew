# Identity and authorization

Decided 2026-11-03. The decision log is in `docs/decisions/`.

## Principle

**OIDC for people, OAuth 2.1 with JWT access tokens for everything that calls on their behalf.** Keycloak is
the only identity provider and the only authorization server. There is one identification path: a person
logs in through OIDC. Every other credential in the system (BFF to MCP server, Clew to an external system,
a tool call made by the model) is an OAuth 2.1 access token derived from that login, bound to a user and an
audience. No path identifies a person by anything else, and no component acts as "Clew" without a user
behind it. Users never see a per-server consent popup: token exchange inside our own trust domain,
and the MCP Enterprise-Managed Authorization extension (ID-JAG) across trust domains, make every
downstream grant a policy decision in the IdP instead of a click. The only exception is the dev login described at the end, which exists for local development
and refuses to start anywhere else.

## Browser to BFF: OIDC

What runs today, ported from startsidan (`apps/server/src/auth.ts`):

- Authorization Code flow with PKCE against the Keycloak realm `clew`, client `clew-web`.
- The BFF holds the tokens. The browser gets an opaque session cookie (`clew-session`, `HttpOnly`,
  `SameSite=Lax`, 8 h idle and absolute). No token, claim or trusted identity context reaches the browser
  bundle.
- Login transactions (state, nonce, PKCE verifier) are stored server-side and consumed once.
- Back-channel logout from Keycloak is verified against the realm JWKS.
- Mutations carry a CSRF token checked by `verifyMutation`.

The session resolves to an `AuthenticatedContext` (`packages/contracts`): person, organisation, principal,
capabilities, authorization version and session binding. Every route and every capability call receives
this context. Visibility never grants access; the server decides.

## Model and MCP: OAuth 2.1 per the MCP authorization specification

Clew follows the MCP authorization specification (revision 2026-07-28, OAuth 2.1 profile) for every MCP
hop in both directions, plus the **Enterprise-Managed Authorization** extension
(`io.modelcontextprotocol/enterprise-managed-authorization`, stable in the same revision) so that no user
ever sees a per-server consent popup. References:

- Tutorial: https://modelcontextprotocol.io/docs/2026-07-28/tutorials/security/authorization
- Spec: https://modelcontextprotocol.io/specification/2026-07-28/basic/authorization
- Extension: https://modelcontextprotocol.io/extensions/auth/enterprise-managed-authorization
- ID-JAG: `draft-ietf-oauth-identity-assertion-authz-grant` (Identity Assertion JWT Authorization Grant)
- Client identity: `draft-ietf-oauth-client-id-metadata-document` (CIMD)

### The base protocol (every MCP server)

**Clew as MCP server** (an `apps/mcp-<name>` host, see `docs/architecture/integrations.md`):

- The server is an OAuth 2.1 **resource server**. It answers unauthenticated requests with `401` and a
  `WWW-Authenticate` header pointing at its Protected Resource Metadata (RFC 9728), which names Keycloak
  as the authorization server. Keycloak publishes Authorization Server Metadata (RFC 8414).
- Clients must use PKCE and resource indicators (RFC 8707), so every access token is audience-bound to one
  server. A token for the calendar server is useless against the Heroma server.
- Access tokens are JWTs. The server validates signature (realm JWKS via `jose`), issuer, audience, expiry
  and the scopes the capability requires. It never accepts a token it was not issued for, and never
  forwards a token it received to another system (no token passthrough).
- The validated token's subject is the user. The server builds the same `AuthenticatedContext` shape the
  BFF uses and applies the capability's `scope` rule. A request without a user subject is rejected.
- Scopes are per capability group, not catch-all: `calendar:read`, `calendar:propose`, never `mcp:tools`.

**Clew as MCP client** (the BFF, or a Clew MCP server, calling another MCP server):

- Clew identifies itself with a **Client ID Metadata Document**: a JSON document at a URL Clew controls,
  with name, redirect URIs and a public key for `private_key_jwt`. Dynamic Client Registration (RFC 7591)
  is the fallback when a server's authorization server does not support CIMD; manual registration is the
  last resort.
- Tokens Clew holds for downstream servers are sealed at rest with the same master key as the OIDC tokens,
  are short-lived, and are deleted on logout and on SCIM deprovisioning.

**The model itself has no identity.** A tool call from the model runs inside the request of the user who
asked, with that user's context and that user's downstream tokens. The model cannot obtain, see or choose
a token.

### No consent popup per server

Which mechanism removes the popup depends on whether the MCP server's authorization server is the
same trust domain as the user's IdP.

**Same trust domain: Clew's own MCP servers behind Keycloak.** The BFF already holds the user's tokens
from the OIDC login. It obtains a token for the target server through **token exchange** (RFC 8693) at
Keycloak: subject token = the user's token, `resource` = the MCP server, audience-bound result carrying
the user's subject and only the scopes that server needs. No browser, no consent. This is the ordinary
case for every `apps/mcp-<name>` host and needs no extension.

**Different trust domain: a vendor's or another municipality's MCP server.** Here the server's
authorization server is not our Keycloak, and the base protocol would send the user to that server's
authorize endpoint once per server. The Enterprise-Managed Authorization extension replaces that with an
ID-JAG flow, driven entirely by the BFF:

1. The BFF keeps the **ID token** from the user's OIDC login (the "identity assertion").
2. The BFF asks the IdP's token endpoint for an ID-JAG by token exchange (RFC 8693):
   `requested_token_type=urn:ietf:params:oauth:token-type:id-jag`, `subject_token` = the ID token,
   `audience` = the external authorization server's issuer, `resource` = the MCP server, `scope` = what
   the capability needs. The IdP evaluates **policy** (groups, roles, conditional access, which clients
   may reach which servers) and issues a short-lived signed JWT with `typ: oauth-id-jag+jwt`.
3. The BFF presents the ID-JAG at the external authorization server's token endpoint with the JWT bearer
   grant (RFC 7523) and its CIMD client id. That server validates signature, issuer trust, `aud`,
   `client_id` and maps `sub` to a local account, then returns an access token for the MCP server.
   No refresh token is returned; step 2 is repeated when needed.
4. The BFF calls the MCP server with that token.

The BFF declares the extension in `_meta` under `io.modelcontextprotocol/clientCapabilities.extensions`,
tries it first, and falls back to the `authorization_code` grant when the server's authorization server
does not list `urn:ietf:params:oauth:grant-profile:id-jag` in `authorization_grant_profiles_supported`.
The fallback is the one case where a user sees a consent screen, and it is logged as such.

Policy therefore lives in the IdP, where IT already manages it: which groups may use Clew against which
MCP servers, revocation in one place, an audit trail of every grant. Clew does not duplicate that policy;
it only applies the capability `scope` rule on top.

**Clew's servers for foreign clients.** When another organisation's assistant, or a desktop client inside
the municipality, wants to use a Clew MCP server, the same extension runs in reverse: Keycloak as Clew's
authorization server accepts ID-JAGs from a trusted external IdP, maps `sub` (and `email` for pre-existing
accounts) to a provisioned Clew user, and issues an audience-bound token. Only provisioned users get in;
there is no just-in-time account creation on this path either.

### Product reality, checked 2026-11-03

- Keycloak **accepts** ID-JAGs from 26.7.0, experimental, behind the `identity-assertion-jwt` feature
  flag, targeting draft revision 01. The local dev Keycloak is 26.2; upgrade before building the
  "foreign clients" path. Keycloak **issuing** ID-JAGs is not documented yet, so step 2 above depends on
  the production IdP (Keycloak or whatever the municipality federates through) gaining that role, or on a
  separate open-source issuer in front of it (Janssen, ThunderID, Athenz and AuthPlane all document both
  roles). Clew ships open source only, so the proprietary IdPs in the extension's support table are not
  options for the Clew side.
- Nothing in this section is built. The base protocol is needed as soon as the first `apps/mcp-<name>`
  host exists; the extension is needed when the first foreign-trust-domain MCP server is connected.

## Pass-through systems without OAuth

Not every municipal system will speak OAuth 2.1. The adapter auth modes in `docs/architecture/integrations.md`
cover this: `bound-credential` (a per-user credential sealed in Clew's DB, what the Nextcloud calendar uses
today) and `service` (one integration account, every call narrowed by the `scope` rule before it leaves the
process). Both still require an authenticated Clew user on the inbound side. They are bridges for systems
that cannot do better, not alternative identification paths.

## Users, groups and permissions

- Users and groups are a **core** module in Clew's Postgres. The IdP provisions them through SCIM 2.0:
  Clew is the SCIM server, Keycloak or Entra is the client, authenticated with a long-lived bearer token
  issued by Clew for that one purpose. SCIM is provisioning, not identification; a provisioned user still
  logs in through OIDC.
- On login the OIDC subject is matched to the provisioned user. A subject without a provisioned user is
  not logged in (no just-in-time user creation in v1).
- Clew roles (`manager`, `employee`, later finer scopes) are derived from SCIM group membership and OIDC
  claims, in Clew. The `capabilities` list and `authorizationVersion` on the context come from this
  derivation, so a group change invalidates cached authorization on the next request.

## Dev login (local only)

A username and password form for local development, so the stack runs without the shared Keycloak
container and a persona can be switched in seconds.

- Enabled only when `AUTH_DEV_LOGIN=true` **and** `NODE_ENV` is not `production`. If `AUTH_DEV_LOGIN` is set
  in production the server refuses to start; it does not silently ignore the flag.
- The form posts to the BFF, which checks the credentials against a seed file of synthetic personas (the
  same `hillevi` and `hassan` the Keycloak setup creates) and mints a **normal session**: same cookie,
  same `AuthenticatedContext` shape, same authorization derivation. Nothing downstream can tell the
  difference, which is the point: it exercises the real code paths.
- The session records `auth: 'dev'` so audit rows show it. Dev sessions get no downstream OAuth tokens;
  adapters in `user-delegated` mode return `unknown` under a dev session instead of failing.
- The dev-login route, the seed file and the flag live in `apps/server` only. Nothing about it reaches
  `apps/web` except the form, which renders only when the BFF reports the flag.

Status: decided, not yet built. HANDOVER lists it as a next step.
