# D96 · A key written wrong is refused at the SCIM boundary, not stored as a plain group

**Status:** accepted, built 2026-11-10; what it does to rows already stored amended 2026-11-13 in the fixes of the review of users and the organisation: Clew reads a key the one way this boundary accepts it, so a unit key with space around its id, stored before this decision, gives nobody anything · **Date:** 2026-11-10 · **Area:** identity

**Amended 2026-11-13.** Verifying the fixes of the
[review of users and the organisation](../reviews/2026-11-12-users-the-organisation-and-the-guides-in-two-rounds.md)
found that "gives nobody anything", under "What it does to rows already stored", did not hold for every key written
wrong. The derivation matched a key's prefix and took the rest as it stood. So a stored `unit: skola` or
`unit-manager:skola ` placed its members on, or made them managers of, a unit whose id kept the space, and a manager's
role on it came back when a leaver was made active again. The check called the group harmless and left the leaver out
of its warning about duties. Only a reserved word in another case or with space in or before it, a key without an id
and a capability outside the list gave nothing. Clew now reads a key one way, as this boundary accepts it
(`readScimGroupKey` in `packages/contracts/src/scim-group-key.ts`): one of the three prefixes exactly, in lower case,
and directly after it an id or a name that is not empty and has no space at either end. The boundary, the derivation,
the organisation tree and the example's check all read it so. The check also names a person whose only unit key is
written wrong among the active users without a unit. A grant derived from such a row before this change stays until
the person is next derived, which any write of the person does.

*Why.* One reading was chosen over a check that reports what the derivation made of such a key. A key this decision
refuses as a mistake should mean nothing wherever it is stored, and the check then says what Clew does. Nothing
rewrites the rows: Clew is not launched, its data is synthetic, and `DELETE` removes such a row.

**Decision.** The SCIM server refuses a group whose `externalId` is one of D68's keys written wrong, with 400
`invalidValue` and a detail that names the key and this decision, on `POST`, `PUT` and `PATCH` alike:

| `externalId` | Refused because |
|---|---|
| `Unit:skola`, `UNIT-MANAGER:skola`, `Capability:admin.users` | A reserved prefix in another case. Keys are case exact and written in lower case. |
| `unit:`, `unit-manager:`, `unit: skola` | No unit id directly after the prefix. |
| `capability:`, `capability:admin.nope` | No name, or a name outside the closed list `CAPABILITIES`; the detail lists the names this installation has. |
| `Protected`, `PROTECTED` | [D93](D93-the-protected-key-is-refused-at-the-scim-boundary.md)'s key in another case. D93 refused only the exact word, so a capital letter stored the fact D93 exists to keep out. |

Every other `externalId` is a plain group, as D68 says. The reserved words are the three prefixes `unit:`,
`unit-manager:` and `capability:` and the word `protected`, compared without regard to case; an `externalId` that only
contains one of them further in (`S-1-5-21-unit:7`) is not a key.

**Why.** D68 makes a mapping mistake fail closed: a person with no unit membership has no access. That is the right
direction and the wrong volume. The [review of 2026-11-10](../reviews/2026-11-10-scim-conformance-and-operability.md)
pushed `unit:` with no id, `capability:admin.nope` and `Unit:skola` and got 201 for each; each then meant nothing, the
provisioner's log said success, and the first sign would have been a person who could not do what they should. A
capability outside the closed list is always a mistake, since the list is a contract ([D85](D85-capabilities-are-mapped-from-provisioned-groups-in-clew.md)).
A reserved prefix in another case is, with near certainty, a key somebody meant: a directory's own identifiers are
GUIDs, SIDs and distinguished names, not `Unit:` followed by a name. Refusing costs a source that really has such an
identifier one prefix in its provisioner; storing it costs a municipality a morning of people without access.

**What it does to rows already stored.** Nothing until they are written again. A group stored before this decision
with a key written wrong keeps its row and gives nobody anything, as before; the provisioner's next `PUT` or `PATCH`
of it is refused and says why, and `DELETE` works. `bun scripts/provisioner-check.ts` lists such rows.

**Replaces.** Narrows D68 item 2's last row, "anything else is a plain group", by the reserved words above. Extends
D93 to every case of its key.
