# SCIM profile updates before the directory handover

Reviewed on 2026-11-12 against the working tree based on `eb8d4a8`. This follows the [earlier D114 review](2026-11-12-scim-and-the-guides-before-the-handover.md) and covers the two guides, contact details and updates to concurrent employments. The [outcome](#outcome) records the fixes made after the review.

## Changes before handover

### 1. A PATCH without a value can erase a person's profile lists

With two employments and three phone numbers stored, a path-based `add` without a `value` member returned HTTP 200. A subsequent GET confirmed the targeted lists were empty. The same happened with `replace`. A provisioner can produce this request accidentally when serialising an undefined source field. The user PATCH handler passes both an absent member and explicit JSON `null` to the removal path. The documentation already assigns a meaning to explicit `null`. [User PATCH handling](../../apps/server/src/modules/people/domain.ts) · [Add operation in RFC 7644](https://www.rfc-editor.org/rfc/rfc7644.html#section-3.5.2.1)

Reject a missing `value` for list writes with HTTP 400 and preserve both lists. Cover `add`, `replace`, explicit `null`, `remove` and the existing deactivation rule in route tests. A GET after a refused write should return the original entries.

### 2. A filtered phone update can change more numbers than the guide promises

With two mobile numbers and one work number, replacing `phoneNumbers[type eq "mobile"].value` changed both mobile numbers to the new value. Clew then deduplicated the pair. A GET returned one mobile number and the original work number. The guide says the operation sets the first number. A plain type filter legitimately matches both rows. The more specific filter `type eq "mobile" and primary eq true` produced exactly the same result because Clew discards the primary condition. The guide also promises HTTP 400 for other paths, while a filtered `.display` returned HTTP 200 with no change. [Phone numbers in the guide](../guides/writing-a-provisioner.md#phone-numbers) · [Phone PATCH handling](../../apps/server/src/modules/people/domain.ts) · [Replace operation in RFC 7644](https://www.rfc-editor.org/rfc/rfc7644.html#section-3.5.2.3)

Show a complete-list replacement that changes the second of two numbers in the same category. Document how the plain type filter works. For clients sending a primary predicate, refuse an ambiguous update before it changes either number, or implement primary selection. Include a test with two numbers of the same type. The existing compatibility test starts with one.

### 3. The operations guide and schema discovery disagree about e-mail selection

Given two `home` addresses, with the second marked primary, POST returned HTTP 201 and selected the second. The operations guide says the first wins when no work or untyped address exists. The description returned by the User schema says a work e-mail is required. A directory following those instructions can predict the wrong published address or withhold an otherwise valid person. Use the preference order already given by the protocol guide in both places. The directory can select one publishable address upstream when it wants an unambiguous result. [Operations guide](../guides/scim-directory-operations.md#what-it-reads-from-the-source) · [Protocol guide](../guides/writing-a-provisioner.md#users) · [Address selection and User schema](../../apps/server/src/modules/people/domain.ts)

### 4. The protocol guide's event table leaves out changes to employment details

The table tells a writer to send an employment change when a job begins, ends or changes title. A change from 60 to 40 percent, a corrected start date or a change of employment type can happen while the unit and title stay the same. A writer using the table as its list of source events could leave the old value on the profile until the daily reconciliation. The operations guide and the full-list PATCH example already handle this case. Link that example from the protocol guide's event table and name changes to any published employment field as a trigger. [Protocol event table](../guides/writing-a-provisioner.md#what-a-provisioner-does-when-something-changes) · [Operations event table](../guides/scim-directory-operations.md#what-it-sends-when-something-changes)

## Verified profile example

The JSON blocks in the [employment guide](../guides/writing-a-provisioner.md#current-employments) were sent verbatim through the authenticated SCIM HTTP routes using the memory store. After creating `unit:9540`, the POST created Mikael with two titles, two start dates, two forms of employment and shares of 60 and 40. A PATCH on the group using Clew's returned user id granted the placement. The employment rows alone granted none.

The guide's PATCH changed the shares to 62.5 and 40. Both GET and the read used by the profile returned those shares. Withdrawing one percentage preserved its job. Withdrawing an entire job preserved the other. Zero remained a number. An input string such as `"40 %"` left the job without a percentage. The provisioning checker still counted the user as having employment in that case. For handover acceptance, compare the fields in the GET response against the source for a person with two jobs. The checker's totals cannot establish whether both percentages arrived. [Worked update](../guides/writing-a-provisioner.md#updating-employment-details) · [Provisioning checker](../../scripts/provisioner/check.ts)

## Review and verification

Codex reviewed the working tree and exercised the public SCIM routes with synthetic data. Claude Opus 5.5 independently reviewed frozen extracts of the guides, implementation and tests through the terminal with `--model claude-opus-5-5 --effort xhigh`. The completed CLI response reported that model. Both reviews identified the phone filter behaviour and the e-mail preference mismatch. Codex reproduced the missing-value data loss. Opus also identified the omission in the event table and highlighted the limits of the provisioning check. A second Codex reader independently identified the phone discrepancy.

Two lower-priority wording changes follow from those checks. An unfiltered `remove` on either list clears it even if a client supplies a `value` identifying one entry. To withdraw one job, replace the list with the remaining jobs. The checker also says a deleted unit leaves the title on the profile. Some jobs only have a date or percentage, and a row with no remaining details disappears from the profile. State only which unit reference needs reconciliation. [List operations](../../apps/server/src/modules/people/domain.ts) · [Checker warning](../../scripts/provisioner/check.ts) · [Profile projection](../../apps/server/src/modules/people/usecases.ts)

Twelve focused tests for phone numbers, employments and the synthetic Mikael passed. The documentation checks passed. The HTTP and profile checks used the memory store. This review covers the working copy. A real Meta directory push, PostgreSQL and browser rendering were outside this run.

## Outcome

1. **Missing PATCH value.** A user `add` or `replace` targeting a path without a `value` now returns HTTP 400 with `invalidSyntax`. Route tests read the person back to verify that both lists and any earlier operation remain unchanged. Explicit `null` and `remove` still clear the target. When the request also deactivates the person, Clew applies the deactivation and preserves the lists.
2. **Repeated phone categories.** A primary predicate with multiple candidate numbers now returns HTTP 400 for a write to the numbers. An ordinary type or value filter still selects every match. The protocol guide describes filtered writes and shows a full-list replacement that changes just the second work number. A test runs the published example through the HTTP routes.
3. **Published e-mail.** The operations guide and SCIM User schema describe the existing selection order, including the primary address in each fallback. The e-mail contract test covers a primary address that comes second when both addresses have a non-work type.
4. **Employment change events.** The protocol guide lists the unit, title, employment type, start date and percentage as triggers for sending the current jobs. The acceptance check asks the writer to compare a two-job GET with the source. The executable example verifies both jobs after a percentage changes.

Both list descriptions explain the effect of an unfiltered `remove` with a value. The provisioning checker names the user and the missing unit for reconciliation. The 33 focused tests for SCIM clients, the guide examples, the checker and e-mail selection passed against the in-memory implementation.

## Pre-merge review of the fixes

Claude Opus 5.5 reviewed the patch at `9cb77d4` through the terminal with extra-high effort. It reported no blocking code defects and identified documentation and coverage gaps. The guide now explains how missing values on unknown paths are handled, when a primary phone filter is ambiguous, and which parts of the returned e-mail and phone numbers to compare with the source.

The follow-up tests exercise a missing value on a title and an unknown path, a deactivation alongside an ambiguous phone update, discovery and read-back for a primary home e-mail, and the initial phone list in the worked example. The earlier [e-mail selection test](../../tests/unit/scim.test.ts) also covers the second of two non-work addresses being primary. GitHub CI on `9cb77d4` ran the full check and the PostgreSQL reliability workflow successfully.
