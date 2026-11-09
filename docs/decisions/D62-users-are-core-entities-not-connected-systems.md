# D62 · Users are core entities, not connected systems

**Status:** accepted, built 2026-11-06 · **Date:** 2026-11-06 · **Area:** identity, integrations

**Decision.** Users, login and access grants belong to Clew's core. They have no connector lifecycle.
Do not show the former `people` / “Startsidan” entry under **Anslutna system**, or offer connector
administration operations for it. The user-facing name of this domain is **Användare**.

The existing `people.me` and `people.directory` read names stay stable. Their internal provider,
`apps/server/src/modules/people/capabilities.ts`, reuses capability dispatch, input validation and
per-user scope checks. Composition identifies it separately from managed bundled connectors. This
adds no field to the remote manifest and does not change calendar or search administration.

New installations do not create a connector row for users. Reconciliation keeps the internal provider
enabled even with a missing or disabled legacy row. Existing rows are retained only to preserve
optional read restrictions: audience, per-capability access and model exposure. A formerly disabled
row does not automatically expose its tools to the model. These restrictions govern the supplemental
reads; they never govern login, user records or the current user's authorization context.

The connected-systems list excludes the internal provider, and direct administration requests and CLI lifecycle commands reject
it. A remote connector cannot replace registered core capabilities. No user records, grants or audit
history are deleted. There is no new user-administration page or new assistant-policy editor in this
change; any future editor belongs with users or assistant settings, not connected-system lifecycle. (Administration ›
Användare arrived 2026-11-09 with [D85](D85-capabilities-are-mapped-from-provisioned-groups-in-clew.md): a read view of the
provisioned people and the group-to-capability mapping, behind `admin.users`, outside connected-system lifecycle as this
decision asks.)

**Why.** A row called “Startsidan” with an off switch suggests an administrator can disable Clew itself.
Renaming that row would still present a required core entity as an optional integration. Internal reuse
of dispatch is an implementation detail; it does not make users a connected system. External directory
and provisioning integrations remain separate from the local user records they supply.

**Verification.** Connector administration/reconciliation tests cover a fresh installation, legacy
disabled rows, missing managed rows, preserved scope/model restrictions, refused administration and
remote replacement. The internal read port has a shared memory/PostgreSQL contract for identity and unit scope. The existing administration accessibility suite checks the unchanged list surface.

**Replaces.** The users portion of [D23](D23-connectors-are-managed-in-the-database.md)'s assumption
that every bundled capability provider has an administrable connector row. D23 still governs managed
connectors. This refines [D61](D61-fixture-sources-are-independent-connectors.md)'s description of the
bundled core; external connector authoring is unchanged.
