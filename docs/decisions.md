# Decision log

One entry per decision, newest last. Each entry says what was decided, why, and what it replaces.
HANDOVER.md section 2 carries the short table; this file carries the reasoning. Longer designs live in
`docs/architecture/`.

## D1 · Clew owns every integration contract (2026-11-03)

**Decision.** The model's tool surface and the UI's view shapes are defined by Clew-owned capability
descriptors in `packages/contracts`. Adapters translate to the external protocol. External systems never
define the contract. Design: `docs/architecture/integrations.md`.

**Why.** The guardrails (human decision endpoint is not a tool, every source scoped before joining, no raw
access for the model) need a place to live. A Clew-owned descriptor with `kind`, `scope` and `model`
fields gives them one. It also keeps the model's tools at domain granularity instead of REST granularity.

**Replaces.** Nothing; generalises the `CalendarProvider` interface decision from session 1.

## D2 · No OpenAPI-to-MCP conversion in the running system (2026-11-03)

**Decision.** Clew does not generate tools from external OpenAPI documents (the Open WebUI `mcpo` /
`openapi-servers` pattern) and does not expose a generated MCP surface from a foreign spec. A converter may
scaffold an adapter at dev time. Clew **publishes** OpenAPI for its own BFF, generated from TypeBox.

**Why.** Conversion makes the external system the author of the tool surface, which contradicts D1. Forty
narrow endpoints with generic descriptions also work badly for a model, and there is nowhere in a generated
surface to say "not a tool" or "scope to this unit".

**Replaces.** An option under consideration; nothing built.

## D3 · Three module kinds: core, pass-through, derived (2026-11-03)

**Decision.** Modules are sorted by who owns the data. Core (users, permissions, threads, audit, jobs) lives
in Clew's Postgres and has no provider interface. Pass-through (calendar, Heroma, Raindance) lives in the
external system; Clew stores refs, revisions and audit rows only, behind a provider interface, in-process
first and lifted to an MCP server when release cadence, network zone or ownership demands it. Derived
(figures, attention counter) is a snapshot computed from pass-through modules.

**Why.** The question "MCP or REST?" has different answers per kind. Naming the kinds settles it per module
instead of per conversation.

## D4 · Foreign MCP servers are wrapped, not passed through (2026-11-03)

**Decision.** A vendor's MCP tools are their contract. Default is a Clew adapter implementing the Clew
capability by calling them. Passing a foreign tool straight to the model is a per-tool allowlist entry with
a `scope` rule, never automatic.

**Why.** Same reasoning as D1 and D2, applied to MCP instead of OpenAPI.

## D5 · OIDC and OAuth 2.1 with JWT access tokens are the only identification path (2026-11-03)

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

## D6 · Dev login with username and password, local only (2026-11-03)

**Decision.** A BFF-side username and password form, enabled only by `AUTH_DEV_LOGIN=true` outside
production, that mints a normal session for a seeded synthetic persona and marks it `auth: 'dev'`. The
server refuses to start if the flag is set in production. Not built yet.

**Why.** Running the stack without the shared Keycloak container, and switching between `hillevi` and
`hassan` in seconds. Minting a real session rather than a special one keeps every downstream code path
honest.

## D7 · Bun is the server runtime (2026-11-03)

**Decision.** `apps/server` runs on Bun (`bun --watch` in dev, `bun run` in the container), not on Node with
`tsx`. Hono serves through Bun's native server instead of `@hono/node-server`. Bun stays the package manager
and script runner as before. Node 24 remains in the image only as a toolchain dependency for tools that need
it (Vite, drizzle-kit, the Astryx CLI) until each is verified under Bun.

**Why.** One runtime for scripts, tests and the server. Bun runs TypeScript directly, which removes the
reason `tsx` was chosen (Node's type stripping needed `.ts` import extensions and no parameter properties).
Hono was picked in part because the same code runs on Bun without adapters.

**Replaces.** The session-1 decision "Node 24 LTS, run with tsx". Switching is a next step in HANDOVER:
change the dev and start scripts, replace `@hono/node-server` in `apps/server/src/main.ts`, and verify
`postgres`, `openid-client` and the scheduler under Bun.
