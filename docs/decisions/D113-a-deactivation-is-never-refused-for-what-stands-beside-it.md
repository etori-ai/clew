# D113 · A deactivation is never refused for what stands beside it, and the SCIM server says no to what it did not do

**Status:** provisional (chosen in the build that followed [the full review of the SCIM server](../reviews/2026-11-11-scim-full-review.md), which the product owner asked for on 2026-11-11; the product owner has not read the three rules), built 2026-11-11; rules 2 and 3 amended 2026-11-12 in the fixes of the review of users and the organisation (Q1, Q2, Q3, X6, S2): a filter on an address type Clew does not hold answers 200 and changes nothing, a write to a sub-attribute of a phone number that Clew does not keep is accepted and not stored when a filter picks the numbers, an `add` or `replace` without a value is refused with 400 `invalidValue` on every path, on a group's `members` an `add` or `replace` with `null` is refused while a `remove` empties the group, and a group's `PUT` keeps its key when `externalId` is absent, `null` or empty while a `POST` without one is refused; rule 1's list of what still refuses a deactivation completed the same day; accepted once a real directory has sent a leaver through it · **Date:** 2026-11-11 · **Area:** identity

**Amended 2026-11-12.** In the fixes of the
[review of users and the organisation](../reviews/2026-11-12-users-the-organisation-and-the-guides-in-two-rounds.md),
which the product owner asked for on 2026-11-12 with every open decision taken in the work. The rules below stay as
written; where they differ from this paragraph, this paragraph holds.

- **Rule 1, what still refuses a deactivation.** Rule 1's last paragraph names examples of what is wrong with the
  request itself. The whole list, as the code refuses it and the guides give it: a body that is not a resource; a
  malformed PatchOp message (no operations or more than 500, an operation without a known `op`, a path that is not
  text, a `remove` without a path); a path to a read-only attribute (`id`, `schemas`, `meta` or a user's `groups`); an
  `id` that names another resource; and a `userName` or `externalId` that another person holds, a person who has left
  included, which answers 409 `uniqueness`. Each refuses the request, deactivation and all.
- **Rule 2, a filter on another address type (Q2).** Clew holds one address and answers it as `type: "work"`,
  `primary: true`, whatever type it arrived with. A path whose filter names another type, such as
  `emails[type eq "home"].value`, names an address Clew does not hold: it answers 200 and changes nothing, with no
  audit row and `meta.lastModified` unchanged, as P6 of [the full review](../reviews/2026-11-11-scim-full-review.md)
  left it. The address is changed through `emails[type eq "work"].value`, a filter on `primary eq true`, a `replace` on
  `emails` or a `PUT`. A filter Clew cannot evaluate is still refused with 400 `invalidPath`.
- **Rule 2, sub-attributes Clew does not keep (Q3).** A write to a sub-attribute of the numbers a filter picks,
  other than `.value` and `.type`, is accepted and stores nothing: `phoneNumbers[type eq "work"].display` or
  `.primary`, for example. So are `display` and `primary` inside a number sent as an object, in a body or as an
  operation's value. Without a filter, such a path is still refused with 400 `invalidPath`, as rule 2 says of a path
  Clew cannot evaluate: `phoneNumbers.display` or `phoneNumbers.primary`, for example. Clew keeps a number's value
  and category only.
- **Rule 3, an operation without a value (Q1).** An `add` or `replace` that carries no `value` member is malformed on
  every path and every resource, users and groups, path-based and path-less, `title` included, and is refused with 400
  `invalidValue`, as the rule's one way of naming a refusal asks. A path-based one answers "Operation '<op>' on
  '<path>' requires a value.", and a path-less one "Operation '<op>' without a path requires a value.". When the
  object of the unit extension or the employment extension leaves out its one attribute, `parent` or `employments`,
  the answer is "Operation '<op>' on '<path>' requires a value for '<attribute>'.". Beside a deactivation the refusal
  waits (rule 1). An explicit `null` and a `remove` stay the ways to take an attribute away.
- **Rule 3, the `members` exception (X6).** On a group's `members`, `null` does not take the members away: an `add` or
  `replace` with `null` is refused with 400 `invalidValue` ("Path 'members' needs a value: the members to set. To take
  everyone out, remove 'members'."), and one without a value is refused as every path's is. A `remove` of `members`
  empties the group. Rule 2's last sentence already said that `add` and `replace` on `members` need a value; rule 3's
  "in a patch takes it away" does not hold there.
- **Rule 3, a group's key (S2).** A group's `PUT` that leaves out `externalId`, or sends it as `null` or empty, keeps
  the stored key, as a user's does. A group's `POST` without a key is refused with 400 `invalidValue`. The group
  schema marks the key optional because an explicit `PATCH` can remove it from an existing group.

**Why these choices.** They were taken in the work, as the product owner asked. A filter on another address type stays a
200 that changes nothing because standard Microsoft Entra ID mappings send filtered operations for several address
types; refusing them would refuse whole updates of ordinary people. Storing the type an address arrived with, so that
such a filter could reach it, would add a stored field for a case no known source sends. Writes to sub-attributes Clew
does not keep stay accepted for the same reason: directory mappings send them, and refusing would refuse every update of
those people. Both are named here so that rule 2's promise is exact. The missing value is refused because RFC 7644
§3.5.2.1 and §3.5.2.3 require a value for `add` and `replace` and its Table 9 types a missing one as `invalidValue`;
Entra ID and Okta never send one, and a silent 200 that drops a unit's key or parent cuts people off from their
managers. A group's `PUT` keeps its key as a user's does. Read as no key, an absent or empty `externalId` once dropped
the key with a 200, and the group's people lost the unit, manager role or capability it gave them. A group's `POST`
without a key is refused so the provisioner can recover the group's Clew id by its source key after a lost response.

**Decision.** Three rules for how `/scim/v2` reads what a provisioner sends. They are one decision because they have
one reason: a directory will send things nobody here foresaw, and what Clew does then must never leave a person with
access the source has taken away, nor tell a provisioner that something was done when it was not.

1. **A deactivation is never refused for what stands beside it.** A request that says `active: false` deactivates the
   person, whatever else it carries. In a `PATCH`, an operation that takes a required attribute away, sets one to a
   value Clew cannot take, or names an e-mail path Clew cannot evaluate is left undone and the attribute stays as it
   was. In a `PUT`, a required attribute that is missing or wrong is kept as Clew holds it. The same request without
   the deactivation is refused as before, and so is one aimed at a person who is already deactivated.

   Microsoft Entra sends a leaver's emptied mailbox as a `Remove` in the same `PATCH` as `active: False`. A daily
   reconciliation sends a `PUT` of a leaver whose address is gone from the source. Both were refused whole, which
   kept the leaver active. [D110](D110-a-persons-title-is-pushed-as-scims-title-and-kept-apart-from-the-role.md)
   found the first case of this for a title; this is the rule it was a case of.

   What is wrong about the request itself is still refused: a body that is not a resource, an unknown operation, a
   read-only attribute, another resource's `id`.

2. **Clew does not answer yes to what it did not do.** An attribute Clew does not hold is accepted and ignored, as
   the standard asks. A path under an attribute it does hold, which it cannot evaluate, is refused with 400
   `invalidPath`: `members[value eq "a" or value eq "b"]`, `members[display eq "…"]`, `emails[value eq "…"].value`.
   Accepted and ignored, such a `remove` told a provisioner that a manager had left a group they were still in.
   `add` and `replace` on `members` need a value; without one a `replace` emptied the group.

3. **A request is read one way.** A full representation and a patch go through the same checks, attribute by
   attribute, so each refusal names its attribute with `invalidValue` and nothing is checked on one path and not on
   the other. Names are read without regard to case everywhere a name stands (RFC 7643 §2.1): attributes, nested
   attributes, the unit extension, the PatchOp message's own names, a SearchRequest. `null` is the same as leaving the
   attribute out (§2.5), and in a patch takes it away. A boolean may be the word for one in any case. A `PUT` that
   leaves out `externalId` keeps the stored one.

**What a provisioner loses.** Under rule 1, the error. A leaver whose request carried a wrong name is deactivated
with the old name, and nothing tells the directory that the name was refused. That is the right way round for a
person who has left, and it is why the rule covers a request that deactivates and no other.

**What follows for a provisioner.** During deactivation, Clew can apply valid profile fields while passing over an
invalid one. Staging a return with `active: false` could therefore rename a person even when Clew later refused
their return. The example uses the existing SCIM id to update memberships and remove old duties, then sends the
complete profile once with `active: true`. A refusal leaves the account inactive and is visible in the run report.
[Review of the provisioner](../reviews/2026-11-12-outside-review-of-the-merged-scim-server.md).

**Not covered.** A `userName` or `externalId` that is taken (409) beside a deactivation still refuses the request:
the conflict is found against the store, after the request is read. A provisioner that deactivates and renames a
person in one request should send the deactivation by itself.

**Weighed and left.**

- *Ignoring every attribute error everywhere.* It would hide a broken mapping for people who are staying, which is
  where it does harm.
- *Leaving a deactivated person's attributes alone on every request.* A deactivated person may be corrected before
  they return; refusing nothing about them would hide that too.
- *Answering 207 or a warning.* SCIM has no partial success for a single resource, and no client reads one.

**As built.** `userFields`, `applyUserPatch`, `applyGroupPatch`, `patchOperations`, `plain` and `emailTarget` in
`apps/server/src/modules/people/domain.ts`; the TypeBox input schemas are gone from `contracts.ts`. Tests:
`tests/unit/scim-as-clients-send-it.test.ts`, one case per request that was once answered wrongly.
