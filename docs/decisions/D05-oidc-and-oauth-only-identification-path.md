# D5 · OIDC and OAuth 2.1 with JWT access tokens are the only identification path

**Status:** accepted · **Date:** 2026-11-03 · **Area:** identity

**Decision.** People log in through OIDC (Authorization Code + PKCE, Keycloak, opaque server session).
Every call on their behalf (BFF to MCP server, Clew to an external system, a model tool call) uses an OAuth
2.1 JWT access token bound to the user and the target audience, per the MCP authorization specification
revision 2026-07-28: Protected Resource Metadata (RFC 9728), Authorization Server Metadata (RFC 8414),
PKCE, resource indicators (RFC 8707), Client ID Metadata Documents for Clew's own client identity with
DCR as fallback, no token passthrough. The model has no identity of its own. SCIM 2.0 provisions users and
groups into Clew's core tables; it is provisioning, not identification. Design:
`docs/architecture/identity.md`.

**No per-server consent popup.** Inside our trust domain (Clew's own MCP servers behind Keycloak) the BFF
uses token exchange (RFC 8693) to get an audience-bound token silently. Across trust domains (vendor or
other-municipality MCP servers) Clew implements the MCP **Enterprise-Managed Authorization** extension
(`io.modelcontextprotocol/enterprise-managed-authorization`, stable 2026-07-28): the BFF exchanges the
user's ID token for an ID-JAG at the IdP, which evaluates policy, and trades the ID-JAG for an access token
at the server's authorization server with the JWT bearer grant. Fallback to `authorization_code` only when
the server does not support the extension, logged as such. Policy for "who may use Clew against which
server" lives in the IdP, not in Clew.

**Why.** One IdP, one token format and one validation routine (`jose` against the realm JWKS) across every
hop. Audience binding means a stolen token for one MCP server is useless against another. Keeping the model
without identity makes "tool calls run as the asking user" a property of the system rather than a rule.
The extension puts access policy where IT already manages it, with revocation in one place.

**Known constraint.** Keycloak accepts ID-JAGs from 26.7.0 (experimental, feature flag
`identity-assertion-jwt`); issuing them is not documented for Keycloak yet. The dev realm runs 26.2. The
cross-domain path is therefore designed, not buildable today, and depends on the production IdP or an
open-source issuer (Janssen, ThunderID, Athenz, AuthPlane document both roles).

**Replaces.** Extends the session-1 identity decision (OIDC + opaque session) to MCP and external calls.
