# Review: users, groups, roles and SCIM · 2026-11-06

Date: 2026-11-06

Reviewed revision: `0857b46`, with the uncommitted work of the same day in the tree
Status: review and recommendation; no decision changed

## Question

The calendar review ([the calendar and a manager's team](2026-11-06-calendar-and-manager-teams.md)) ended on who may
invite whom. The product owner asked to settle the ground first: how users, groups and roles work, and how SCIM is
handled.

## Assessment

SCIM does not exist, and neither do groups. Every person, unit and role in a running Clew comes from three hard-coded
rows in `scripts/auth-setup.ts`. The login half is sound: no provisioned person means no access, and access is read
from the database on every request, so a change takes effect at once. The model underneath is too small for the real
organisation, though, and one detail of how authorization is fingerprinted would turn ordinary directory updates into
stopped work. That detail should be fixed before anything is synchronised.

## What exists

| Part | State | Where |
|---|---|---|
| OIDC login, subject bound to a person, no just-in-time creation | Built | `apps/server/src/auth.ts:143`, `packages/db/src/auth.ts:46` |
| Person | `id`, `organisationId`, `name`, `enabled`; no e-mail, user name or external id | `packages/db/src/schema.ts:28` |
| Grant | One row per person: one unit, one role, a capability list | `packages/db/src/schema.ts:45` |
| Role | `manager` or `employee`, in a database check, the contract and protocol 2 | `packages/contracts/src/index.ts`, `docs/protocol/connector-protocol.schema.json` |
| Capabilities | Free strings on the grant; `admin.connectors` is enforced | `apps/server/src/connectors/usecases/admin.ts:71` |
| Unit | No table; an id and a label repeated on each grant | `apps/server/src/connectors/adapters/postgres.ts:120` |
| Groups | Audience field and a disabled admin control; `inAudience` ignores them and `Actor` has none | `packages/connectors/src/index.ts:238`, `apps/web/src/pages/admin/audience.tsx:97` |
| SCIM endpoint | None; `docs/reference/status.md` already says so | |
| Provisioning | `scripts/auth-setup.ts:192`, three synthetic people | |

## Findings

1. **Directory updates would stop work in flight.** `authorizationVersion` is an HMAC over the whole `{ person, grant }`
   row (`apps/server/src/auth-crypto.ts:48`, called from `auth.ts:270` and `system-context.ts:15`). Durable work
   compares it exactly: executions and watches (`modules/executions/usecases.ts:337`, `:407`), reminders
   (`composition/index.ts:96`), calendar follow-up (`usecases/followups.ts:61`), and answers kept in a question thread
   (`threads/access.ts:20`). So a corrected name, a renamed unit label, or a new column on `auth_person` reads as lost
   authority. Adding `email` by migration would do this to everyone at once. This holds without SCIM, but SCIM makes it
   routine. Found by reading; not reproduced.

2. **One person, one unit, one role.** `auth_access_grant` has `personId` as its primary key. The personas already
   exceed that: Lena, HR-partner for several units and nobody's manager; Sara acting for Kim for three weeks
   (UC-KIM-5); and any manager of two units. `docs/personas.md` lists Lena as not provisioned for this reason.

3. **`manager` does not say manager of what.** The role is a label on the person. Scope comes from pairing it with the
   single unit. The mocks already reach for the missing relation with `managerOf` (`packages/connectors/src/mock/data.ts:92`).

4. **Four sources disagree about who is in a unit.** The grants, the calendar fixture (`packages/calendar/src/accounts.ts:25`),
   `managerOf`, and the phone book through `TELEFONBOK_UNIT_MAP`. Hillevi's unit has four members in the calendar and
   one in `people.directory`.

5. **No path from a provisioned person to a login.** `identity.md` says the OIDC subject "is matched to the provisioned
   user" and stops there. SCIM creates a person with no subject, and `auth_identity_binding` needs issuer and subject.
   The matching attribute has to be chosen, and it must be stable and not an e-mail address, because binding is what
   grants a person's access.

6. **The Keycloak half of the design is unconfirmed.** `identity.md` names "Keycloak or Entra" as the SCIM client.
   Keycloak's recent experimental SCIM work is reported as a server API, meaning Keycloak receives provisioning; I found
   no evidence of it pushing to an outside service, and sources disagree on the version (26.4 or 26.6). Clew is the
   server in the design, so that feature does not help. Entra does ship a client. A municipality running Keycloak
   without Entra has no client today.

7. **Documents ahead of the code.** D23 says `admin.connectors` is derived from a `clew-admin` group, but no such group
   is created anywhere; the seed writes the capability directly. `calendar:plan` is seeded and never checked.

8. **Protected people.** The phone book drops protected and hidden records (`connectors/telefonbok/directory.mjs:25`).
   SCIM has no such filter by default. If invite lists are built from provisioned people, a person with protected
   details could appear in them.

9. **The protocol fixes the actor's shape.** `Actor` in the published schema has `additionalProperties: false` and
   exactly `id`, `name`, `unitId`, `unitLabel`, `role`. The callback route compares unit and role
   (`apps/server/src/routes/connectors.ts:46`), and durable rows hold one `unitId`.

## Recommendation

1. **Find out where the facts live.** Which system knows a person's unit and who is a manager, whether Entra carries it
   as groups or attributes, and how ställföreträdare is recorded. This decides whether SCIM carries unit and role at
   all, or only the person. Everything below depends on it.
2. **Narrow `authorizationVersion`** to what is authority: `enabled`, `organisationId`, unit, role, capabilities and
   the grant `version`. Small, independent of SCIM, and worth doing before any column is added. Changing the formula
   changes every value once, so it needs the conservative upgrade path in the operations runbook.
3. **Separate the source's facts from Clew's derivation.** Add units, groups and memberships as provisioned data, and
   a mapping an administrator owns, from group or attribute to role and capability. D23 and `identity.md` already say
   roles are derived in Clew. No group name then needs to be hard-coded, which is what another municipality needs.
4. **Model many assignments, keep one active actor.** Replace the one-row grant with assignments (person, unit, role,
   validity period), one of them active. `Actor` keeps its shape, so protocol 2 and the durable rows stay as they are.
   Build the table now and the switching UI when a persona needs it. The validity period also gives ställföreträdare
   its automatic end.
5. **Build the SCIM server to the standard.** `Users`, `Groups` and the discovery endpoints, a bearer token for that
   purpose alone, an audit row in the same transaction as every change, and `DELETE` as deactivation, because audit
   and threads reference the person. Test with a scripted client, so that neither build nor tests need a vendor
   account. A small open import script keeps Keycloak-only installations possible.
6. **Decide binding** (finding 5), and let the first login bind only to a provisioned person, with an audit row.
7. **Then replace the fixtures** in the calendar and the mocks, and let `inAudience` read groups.

Entra's client has documented differences from the standard, including PATCH behaviour behind a feature flag, and
group changes carry only member ids. Those belong in the SCIM server's contract tests from the start.

## Decisions needed

- Which system is the source for unit and manager role, and whether SCIM carries them.
- Whether production keeps Keycloak as a broker in front of Entra, or uses OIDC directly. This is also HANDOVER's
  open question on Graph tokens, and it decides what the subject is.
- Whether people without a Clew login, but with a calendar, are provisioned. The calendar fixture assumes so; the
  vision keeps Clew's copy to what identifies and scopes a person.

## Verified

Read from the code at the lines cited. Nothing was run, and finding 1 is reasoned from the code, not reproduced. The
Keycloak and Entra statements in findings 5 and 6 and the closing note come from web sources, one of them a vendor
blog; they should be checked against the Keycloak release notes and Microsoft's documentation before a decision.

## Outcome

The product owner settled the direction the same day:
[D60](../decisions/D60-people-are-pushed-into-clew-through-standard-scim.md). Metakatalogen is Sundsvall's source, and
each installation pushes people through standard SCIM from a provisioner of its own. That replaces two recommendations
above: mapping sits in the provisioner rather than in an administrator's table in Clew (recommendation 3), and validity
dates stay in the source rather than on Clew's assignments (recommendation 4). Finding 6 no longer matters, since the
provisioner is the client.
