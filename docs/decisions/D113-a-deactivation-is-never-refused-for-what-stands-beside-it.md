# D113 · A deactivation is never refused for what stands beside it, and the SCIM server says no to what it did not do

**Status:** provisional (chosen in the build that followed [the full review of the SCIM server](../reviews/2026-11-11-scim-full-review.md), which the product owner asked for on 2026-11-11; he has not read the three rules), built 2026-11-11; accepted once a real directory has sent a leaver through it · **Date:** 2026-11-11 · **Area:** identity

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
