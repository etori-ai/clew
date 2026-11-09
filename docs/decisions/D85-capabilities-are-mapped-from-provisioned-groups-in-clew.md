# D85 · Capabilities are mapped from provisioned groups in Clew; units and manager roles keep D68's keys

**Status:** accepted, built 2026-11-09 (the mapping table, the closed list `CAPABILITIES` with `admin.connectors` and `admin.users`, the derivation, the editor on Administration › Användare) · **Date:** 2026-11-09 · **Area:** identity

**Decision.** The SCIM server of [D68](D68-people-are-pushed-into-clew-through-standard-scim.md) accepts every group a
client pushes, and Clew, not the provisioner, decides which of those groups carry a capability. D68's keys for units,
manager roles and protected people stand. Precisely:

1. **Every group is stored as pushed.** `externalId`, `displayName` and `members`, with `PATCH` on `members` handled
   incrementally (add and remove of single members, as Entra sends them, as well as a replaced list). A group whose
   `externalId` carries no D68 key and no mapping below is a plain group: it gives nothing in authorization and is
   available as an audience in connector administration (D23's `groups`, which has matched nothing until now). Clew
   matches audiences and mappings on the group's `externalId`, never on its `displayName`, because directory groups are
   renamed.

2. **Units and manager roles are unchanged.** `unit:<unitId>` and `unit-manager:<unitId>` remain the provisioner's job,
   as D68 item 2 says. A source that records a department and a manager flag on the person, as Sundsvall's does, derives
   both groups from those two fields; a manager of several units or an HR partner is several memberships. `protected`
   is unchanged.

3. **Capabilities are mapped in Clew.** A table of rows *group → capability* (`auth_group_capability`), owned by an administrator and edited
   under Administration › Användare by a person holding the new capability `admin.users`. One row maps one group
   (`externalId`) to one capability; a group may map to several. Every change writes an audit row (`group-capability.added`,
   `group-capability.removed`, with the group, the capability and the actor) in the same transaction, and re-derives the
   capabilities of every current member in that transaction. D68's `capability:<name>` key keeps working as a direct path
   that needs no row, and is how an installation bootstraps its first `admin.users` holder; the development stack's
   synthetic provisioner uses it.

4. **Capability names are a closed list.** `CapabilitySchema` in `@clew/contracts` enumerates them; the mapping, the
   `capability:` key and `auth_access_grant.capabilities` accept nothing else. The list starts with what the server
   enforces, `admin.connectors`, plus `admin.users` from this decision. `calendar:plan` is seeded today and checked
   nowhere; it is removed from the seed unless a check is written. There is no outside list to import: startsidan is
   this product's earlier name, so its capabilities are Clew's own and enter the list as the checks that enforce them are
   ported. Adding a name is a contract change, not a configuration change.

5. **Derivation is the only path to authority.** A person's capabilities are the union of what their memberships give
   through D68's keys and this mapping, recomputed whenever a membership or a mapping changes. There is no way to give a
   person a capability directly: not in the administration page, not through SCIM's `User` resource. A group without a
   key or a mapping fails closed. `authorizationVersion` changes only when the derived set changes, which depends on
   D68's must-land-first narrowing of that fingerprint.

**Why.** The product owner settled this on 2026-11-09. The municipality's directory groups are many, dynamic and named
for the directory's own purposes, and a provisioner that must translate each of them into `capability:` groups needs a
code change every time an administrator wants a new group to carry a right in Clew. The
[SCIM review](../reviews/2026-11-06-users-groups-roles-and-scim.md) argued against a mapping table in Clew because it
does not scale to every unit in a municipality. That argument holds for units, which D68 therefore keeps in the
provisioner, and not for capabilities: the server enforces one today and the list will stay short, so the table has a
handful of rows. What D68 protects is kept: Clew names no source (an administrator points at a group; Clew does not know
it is Active Directory), membership is the only authority (the mapping derives, it never grants), and a mistake fails
closed.

Alternatives weighed. *D68 as written*, all mapping in the provisioner: rejected for the operational friction above.
*A full mapping table* that also maps groups to units and roles, the review's recommendation 3: rejected for D68's
reason, and because the source already knows the department. *The Enterprise User extension's `department`* for the
unit instead of `unit:` groups: rejected because it is free text and gives neither a stable unit id nor a separate
label, which `unit:<unitId>` with `displayName` does.

**Replaces.** Amends item 2 of [D68](D68-people-are-pushed-into-clew-through-standard-scim.md): "an administrator cannot
hand one out separately" still holds for a person, but the capability meaning of a group may now be set in Clew. Makes
good on [D23](D23-connectors-are-managed-in-the-database.md)'s statement that `admin.connectors` is derived from an IdP
group, which no code has done so far, and on D23's `groups` audience. Consistent with
[D62](D62-users-are-core-entities-not-connected-systems.md): the editor belongs with users, not with connected-system
lifecycle. Nothing is built; D68's order of work applies, with this mapping after the SCIM server and before the
users page.
