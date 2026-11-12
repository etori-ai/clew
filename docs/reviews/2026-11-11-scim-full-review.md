# Review: the SCIM server in full, and the guides a provisioner is written from · 2026-11-11

Date: 2026-11-11

Reviewed revision: `4f28f8a` on `person-title` (`main` at `bebd73d` with the title of D110)
Status: review; every finding that could be fixed in the repository was fixed the same day, see Outcome

## Question

The product owner asked for a full review of SCIM, and of the two guides on the documentation site that the team
behind Sundsvall's directory (Metakatalogen) will write its provisioner from, before the work is called done.

This is the fourth review of the SCIM server, after
[the boundary](2026-11-09-scim-server-and-provisioning-boundary.md),
[conformance and operability](2026-11-10-scim-conformance-and-operability.md) and
[the flow end to end](2026-11-11-scim-flow-people-and-organisation.md). It was asked for because a reviewer from
outside the session had just found two faults in the title of D110 that the author had missed: a NUL character that
stopped a deactivation, and an attribute name in another case that cleared a title.

## Method

Three reviewers that had not seen the author's reasoning, each with one question and the code:

1. **The protocol as clients send it.** RFC 7643 and RFC 7644 operation by operation, and what Microsoft Entra ID and
   Okta document that they send.
2. **Integrity.** Fail-open paths, isolation between organisations, atomicity and audit, parity between the memory and
   PostgreSQL adapters, the tree, and inputs that answer 500.
3. **The guides against the code.** Every statement of `provisioning-for-operations.md` and
   `writing-a-provisioner.md`, read as the directory team reads them, and the example provisioner as reference code.

Each reproduced its findings with probes on the memory adapter where that was possible and said so where it was not.
The author then verified each finding, fixed it, and wrote a test that sends the request that was once answered
wrongly. The site was built from the branch and both guides read as published.

## Assessment

**The earlier reviews held for what they looked at.** A randomised check of four thousand sequential operations in
two organisations found no person whose grant differed from a fresh derivation. The tree's rules are the same on
`POST`, `PUT` and `PATCH`. Pagination, atomicity of a patch, `Location`, content types and token handling are right.

**The server was strict where it should be tolerant and silent where it should refuse.** Almost every finding is one
of three kinds:

- *A request a real client sends was refused whole*, and with it the deactivation it carried: `null` on an optional
  attribute, a required attribute removed beside `active: false`, Okta's update without `externalId`.
- *A request the server could not evaluate was answered 200 and did nothing, or did something else*: a `remove` of a
  member by a filter it did not read, `Value` or `Parent` in another case, a private address stored as the work one.
- *The same thing was checked on one path and not on another*: `PATCH` on `emails` stored the text "null" and had no
  length limit, a boolean as a word was taken in a patch and refused in a body.

They came from one cause: a full body was checked by a schema and a patch by hand-written code, and neither knew what
the other allowed. The fix was to read every request one way
([D113](../decisions/D113-a-deactivation-is-never-refused-for-what-stands-beside-it.md)).

**The example provisioner did what the guides warn against.** It stopped at the first person Clew refused, before it
had deactivated anybody who had left, and it never moved a reused account name off its old row although both guides
say a provisioner must.

**The guides were accurate in their tables and thin on what goes wrong.** The refusal table, the printed outputs and
the sign-in section matched the code. What a first provisioner is most likely to trip on was missing: that a member is
named by Clew's id and not the source's, that the walkthrough can be run once, that a unit's manager group has to be
removed with the unit.

## Findings and what was done

"Reproduced" means the reviewer sent the request to the memory adapter and saw the answer.

### The protocol

| # | Finding | Evidence | Done |
|---|---|---|---|
| P1 | `PATCH` on `emails` as a list stored `"null"`, `"undefined"` and `"42"`, an empty address, an address of any length, and answered 500 for a `type` that was not text | Reproduced | Fixed: one reader for addresses in a body and in a patch |
| P2 | `Parent` in another case inside the unit extension made the unit a root, with a 200 | Reproduced | Fixed |
| P3 | A `remove` on a `members[…]` path the server did not read answered 200 and removed nobody; `replace` on `members` without a value emptied the group; a path-less `add` under the URN replaced everyone | Reproduced | Fixed: 400 `invalidPath`, a value required, the URN read |
| P4 | Okta's documented `PUT` without `externalId` or `displayName` was refused | Reproduced with the documented body | Fixed: a `PUT` keeps the stored `externalId`; the name is built from its parts |
| P5 | `null` on an optional attribute refused the whole resource or patch | Reproduced | Fixed: `null` is absent (RFC 7643 §2.5) |
| P6 | `emails[type eq "home" and primary eq true].value` was stored as the work address; a filtered address with the value as an object changed nothing; `add` of a home address was refused | Reproduced | Fixed: the work address by its filter only, another type ignored, any other filter `invalidPath` |
| P7 | A group's `displayName` filter was case-exact although `/Schemas` says it is not | Reproduced | Fixed on both adapters |
| P8 | Names were case-sensitive in the PatchOp message, in member objects and in a SearchRequest, where `Filter` read as no filter answered every user | Reproduced | Fixed |
| P9 | `attributes` and `excludedAttributes` were ignored on `POST`, `PUT` and `PATCH` | Reproduced | Fixed |
| P10 | A filter's attribute could not carry its URN, and a JSON escape in the value was misread | Reproduced | Fixed |
| P11 | `/Schemas` left out `name.givenName` and `familyName`, `referenceTypes` on `$ref`, and the mutability of read-only sub-attributes; a projected extension stayed in `schemas` | Read from the document | Fixed |
| P12 | A failure in the token check was answered by the application around the SCIM server, not as a SCIM error; `bearer` in lower case was refused; a wrong method answered 404 | Reproduced | Fixed: 503 with `Retry-After`, the scheme without regard to case, 405 with `Allow` |
| P13 | A value of the wrong type answered `invalidSyntax`; a boolean as a word was taken in a patch and refused in a body | Reproduced | Fixed: `invalidValue` naming the attribute, one reading of a boolean |
| P14 | `startIndex` past the range of a bigint | Read; reproduced on memory | Fixed: capped |
| P15 | A required attribute removed beside a deactivation refused the deactivation | Reproduced; the reviewer was unsure whether it was deliberate | Fixed: D113 |
| P16 | The limit of 500 operations in a patch could not be found out | Reproduced | The answer says the limit, and the guide lists it |
| P17 | Only space was taken as a `userName`, a name or an address | Reproduced | Fixed |

### Integrity

| # | Finding | Evidence | Done |
|---|---|---|---|
| I1 | A capability row left by a group that was gone was picked up by another organisation's group of the same id, and shown to its administrator | Reproduced | Fixed: a row has an organisation (migration 0051) |
| I2 | As P3 | Reproduced | Fixed |
| I3 | As P3 and P8: `Value` in another case emptied a group | Reproduced | Fixed |
| I4 | As P5; also an empty `name.formatted` hid the name's parts | Reproduced | Fixed |
| I5 | As P2 | Reproduced | Fixed |
| I6 | A mapping change and a membership write could interleave on PostgreSQL and leave a capability no row gave | Read from the SQL | Fixed with a lock on the group; no concurrency test was written |
| I7 | As P1 and P6 | Reproduced | Fixed |
| I8 | A second unit to lead, or membership of a plain group, left no audit row naming the person | Reproduced | Fixed: `assignments.derived`, and the people added or removed in the group's row up to fifty |
| I9 | NUL in an address or a filter, and a huge `startIndex`, reached PostgreSQL; a deeply nested body overflowed the stack | Read; the stack reproduced | Fixed |
| I10 | Every write of a group asked about every member, one read each; a body without a declared length was read whole before it was measured | Reproduced by counting | Fixed: only who comes, in one read; the body is stopped at the limit as it is read |
| I11 | A unit one organisation had left gave the next one its old name | Reproduced | Fixed: unit rows are read by organisation and taken over whole |
| I12 | A key with space in or before its prefix was stored as a plain group | Reproduced | Fixed: refused, as a key in another case is |
| I13 | A row from before provisioning was given an empty `externalId` by any patch, and a second such row was then refused | Reproduced | Fixed: only what changed is checked and written |
| I14 | The read of a unit's colleagues listed deactivated people | Read | Fixed |
| I15 | The store and the derivation could order unit ids differently and rewrite assignments on every derivation; names had no length limit | Read; the length reproduced | Fixed |

### The guides and the example provisioner

| # | Finding | Done |
|---|---|---|
| G1 | The example stopped at the first refused person, before deactivating who had left | Fixed: leavers first, a refusal is one person's, the run reports them and fails |
| G2 | The example never moved a reused account name off its old row | Fixed: the old row takes its `externalId` as its name |
| G3 | The walkthrough cannot be repeated in an installation, and nothing said so | Said, with what to do |
| G4 | The first block's `set -e` closes an interactive shell; a token that was set and not exported passed the first block | Said; the block exports both |
| G5 | A replaced account at the identity provider locks the person out, and nothing in Clew undoes a binding | Said, as a thing never to do; an open question |
| G6 | "One row is always let through" is false for the only row of its kind | Corrected |
| G7 | The refusals a first provisioner hits were not listed: a member by the source's id, a wrong type, the limit of a patch, the member paths | Listed in both guides |
| G8 | Removing a unit leaves its manager group, and a manager of a unit that is gone | Said in both guides: remove both groups |
| G9 | The prefix on every person's source id is a permanent choice, and so is the organisation's id | Said |
| G10 | The title was missing where the guides say what to send on a change and how to check | Added; the check counts titles |
| G11 | Required attributes were stated three ways | One statement: four required, `active` defaults, `title` optional |
| G12 | "Does not change it afterwards" was true for a patch only | Corrected |
| G13 | Two figures showed `protected` as a working key and lacked newer columns | Corrected |
| G14 | A stray backtick broke a link and a sentence on the published page | Corrected |
| G15 | `provisioner.seen` does not mark each comparison for a provisioner that sends changes through the day | Corrected |
| G16 | "The lowest unit id" is text order: `10` before `9` | Said |
| G17 | `HOST` was missing; the id rule was incomplete; no recipe exists for running Clew in production | Added; the missing recipe is said plainly |
| G18 | "Not decided yet" did not match the open questions | Both brought in line |
| G19 | Stale numbers: the length of the example, the largest group, the depth of the tree | Corrected |
| G20 | "Key" meant both the token and a group's prefix; the product's own words never appeared | The page defines its words and uses "token"; the Swedish labels are named |

## Left as it is

- **Connector audiences match a group by its `externalId` with no organisation.** The same pick-up as I1, outside the
  SCIM server: connectors and their audiences know of no organisation at all. One organisation per installation is
  what is supported; it is an [open question](../maintainers/open-questions.md).
- **A unit's id answers differently when another organisation holds it** (409, 400 or 201), so its existence can be
  read. It follows from ids that are unique in the installation, which D101 chose.
- **A taken `userName` beside a deactivation still refuses the request.** D113 says so.
- **A capability row whose group is gone, changed while that group is being created again**, is not locked against
  each other. Rare, and it heals at the next derivation of the member.
- **A possible deadlock** between a change of `externalId` and a membership write of the same person. From reading,
  not reproduced, and the reviewer was unsure.
- **`lower()` on a database created with the C locale** folds only a to z, so `userName` would be matched with regard
  to case for å, ä and ö there. The development database is not such a one. Not verified.
- **Renaming a unit re-derives every member**, about nine store calls each. That is the derivation, not a mistake.
- **Nothing here was sent by a real Entra or Okta tenant.** The requests are the documented ones.
- **No manual pass of the published guides by somebody from the directory team.**

## Outcome

Built on the branch `scim-full-review`, on top of D110's title. A request is read one way
([D113](../decisions/D113-a-deactivation-is-never-refused-for-what-stands-beside-it.md)); a capability row has an
organisation ([D85](../decisions/D85-capabilities-are-mapped-from-provisioned-groups-in-clew.md), amended); the
example provisioner carries on past a refused person and moves a reused account name; both guides and three figures
are corrected. New tests: `tests/unit/scim-as-clients-send-it.test.ts` and `tests/unit/scim-integrity.test.ts`, with
cases added to the store contract, which runs on PostgreSQL too.
