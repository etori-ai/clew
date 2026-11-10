# D96 · A key written wrong is refused at the SCIM boundary, not stored as a plain group

**Status:** accepted, built 2026-11-10 · **Date:** 2026-11-10 · **Area:** identity

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
