# D92 · The `protected` key is refused at the SCIM boundary until Clew decides whether it may hold the fact

**Status:** accepted, built 2026-11-09 · **Date:** 2026-11-09 · **Area:** identity

**Decision.** A group whose `externalId` is `protected` (D68 item 2) is refused by the SCIM server with 400
`invalidValue` and a detail that names this decision, on `POST`, `PUT` and `PATCH` alike. Nothing about a protected
person is stored, derived into an authenticated context, listed in an administration view or offered as an audience.
The derivation keeps its `protected` flag for a row written before this decision; it is false in every installation
provisioned after it. The provisioner guide and D68's table say so.

**Why.** D68 left open whether Clew may hold the fact that a person is protected (skyddad identitet, in Sundsvall's
terms), and said that if it does, the membership must stay out of logs, audit details and administration views. The
[SCIM review](../reviews/2026-11-09-scim-server-and-provisioning-boundary.md) of 2026-11-09 found that a pushed
`protected` group was in fact stored like any other, rode in the context's `groups`, appeared among a person's groups
on Administration › Användare and was selectable in the capability and audience editors, while the status matrix said
it was not stored. Refusing the key is the one state that matches what the documents promise and that fails loudly: a
provisioner that sends it learns at once that the question is unsettled, instead of Clew quietly holding a sensitive
fact it has no decision to hold. Filtering the key out of every view instead would have kept the fact in the database
with no owner for the policy around it.

**What settles it later.** Sundsvall's answer to how protected people are recorded and whether Clew may know. If Clew
may, a decision replaces this one with the storage, the filtering of every list another person can see and the audit
rules; if it may not, the provisioner never sends the key and this decision stands as the guard.

**Replaces.** Amends D68 item 2's row for `protected` and its open question. Corrects the status matrix, which said the
membership was derived but not stored.
