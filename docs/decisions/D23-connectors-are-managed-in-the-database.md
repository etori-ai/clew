# D23 · Connectors are registered and governed in the database by an administrator, not by environment variables

**Status:** accepted, admin API and screens not built yet · **Date:** 2026-11-04 · **Area:** integrations

**Decision.** A running Clew learns about a connector from its own Postgres, never from the environment.
An administrator adds a connector in the product (address, shared secret, who sees it), Clew fetches the
manifest, checks the service the way `connector-check` does, and registers it in the live registry without a
restart. The same page turns a connector on or off, limits it to an audience (roles, units and, when SCIM
lands, groups), switches its scan and its assistant tools on or off, disables single capabilities, rotates
the secret and removes it. `CLEW_CONNECTORS` and `CLEW_CONNECTOR_SECRET_<ID>` are removed; the only environment
Clew needs is what it already has (database, IdP, master key, Temporal). Design and screens:
`docs/architecture/connector-administration.md`.

The rules that follow:

- **Secrets rest sealed.** The shared secret is stored with the same envelope the session tokens use
  (`auth-crypto.ts`: a data key per row, sealed with the master key, purpose-bound `connector:secret:<id>`).
  It is read into memory to sign assertions and is never returned by any API, logged or shown again; the
  admin page shows when it was last changed and offers to replace it.
- **Visibility is enforced in the registry, for every surface at once.** A connector that is disabled, or
  whose audience does not include the acting person, does not exist for that person: no area in the
  sidebar, no tool in the model's list, no standing action, no object in search, no scan, no figure, no
  entry in `GET /api/connectors`, and a call to one of its capabilities answers exactly as an unknown
  capability does. An employee who is not in Raindance's audience cannot learn that Raindance is
  connected. Cards the connector pushed earlier are hidden while the person is outside the audience and
  come back if the audience widens again; receipts in Redan hanterat stay, because they are the person's
  own history. The connector's own authorisation (OAuth as the person, or a service account narrowed by
  scope) still decides what the person may do inside the source; the audience decides whether the source is
  on the person's page at all. Clew hides, the source system decides.
- **Two declarations, both must pass.** The manifest's `scope.roles` is the vendor's statement of what the
  connector supports. The audience is the operator's statement of who in this organisation gets it. The
  operator can narrow, never widen: an audience cannot give an employee a capability the manifest reserves
  for managers, and the operator cannot turn `model: true` on for a capability the vendor marked false, only
  off.
- **Administration is a Clew permission, not a work role.** `manager` and `employee` describe a person's
  work and are what connectors receive in the actor. The right to manage connectors is the grant
  capability `admin.connectors` on `auth_access_grant.capabilities`, derived from an IdP group
  (`clew-admin` in the dev realm, a third synthetic user `mikael`) and later from SCIM. Every admin mutation
  requires the step-up `authorize()` that `execute` requires, and writes its audit row in the same
  transaction (`connector.added`, `connector.enabled`, `connector.disabled`, `connector.audience`,
  `connector.capability`, `connector.secret`, `connector.removed`). An administrator sees structure (which
  roles get which areas), never people's data; UC-MIKAEL-3's masked preview is not built.
- **No restart, one process today.** The admin use cases write the row and then update the in-process
  registry in the same call: register, replace or unregister. The nightly scan, the figures and the model
  tools read the registry and follow. When Clew runs as more than one instance, each instance watches
  `connector.version` (a poll of `max(updated_at)` every few seconds, or `LISTEN/NOTIFY`); that is the only
  change multi-instance needs and it is noted, not built.
- **The checker is shared.** The manifest validation and the conformance probes in `scripts/connector-check.ts`
  move into `packages/connectors/check.ts` so the CLI and the admin page's "Testa anslutning" run the same
  code and report the same findings.

**Why.** D21 wired connectors through environment variables because it was the smallest thing that proved
the protocol. It is the wrong operating model for the product: most municipalities will run Clew as a
hosted service without an IT department of their own (`vision.md`), so the person who decides that Heroma
is connected and that only chefer see Raindance is a systemförvaltare (Mikael) with a browser, not someone
with access to a container's environment. Environment variables also mean a restart per change, a secret
in the orchestrator's config, and no audit trail of who connected what when, which is the first question a
data protection officer asks (UC-MIKAEL-5). The vision already says "operators configure connectors, scopes
and bundle times"; this is where that happens. Keeping both paths (environment as provisioning, database as
override) was considered and dropped: two sources of truth for the same row is a support problem, and the
development stack loses nothing, since adding the hello connector is one form in the browser or one line in
`scripts/auth-setup.ts`.

The audience is a Clew-side filter rather than IdP policy because it is about what is on a person's page,
not about whether the person may reach the source: identity.md keeps authorisation policy in the IdP and
in the source system, and this decision does not move it. The audience is deliberately coarse (roles,
units, groups per connector, not per capability) so an administrator can answer "who sees Raindance?" in
one line; finer rules belong in the manifest's scope and in the source.

**Replaces.** The configuration section of D21 and of `connector-protocol.md` (`CLEW_CONNECTORS`,
`CLEW_CONNECTOR_SECRET_<ID>`, "removing a connector is removing its line"). The protocol itself, the assertion and
the callback are unchanged. `connectors/hello/compose.yaml` and `apps/server/.env.example` lose their variables.
