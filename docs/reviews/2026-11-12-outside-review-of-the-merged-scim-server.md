# Review: an outside reading of the merged SCIM server and its example provisioner · 2026-11-12

Date: 2026-11-12

Reviewed revision: `eb8d4a8` on `main`, after [the full review](2026-11-11-scim-full-review.md) was merged
Status: review by a reader outside the session that built the code; every finding was reproduced and fixed the same day, see Outcome

## Question

The product owner handed the merged code to another reviewer and asked whether it is clear what a directory team has
to deliver, and what should be put right before the first real directory is connected. He then asked for each point
to be judged, not agreed with.

## Assessment

**All five findings are right.** Each was reproduced on the merged code before anything was changed. Three of them
come from the work of the day before: one is a direct consequence of
[D113](../decisions/D113-a-deactivation-is-never-refused-for-what-stands-beside-it.md), one was introduced by the fix
that was meant to prevent it, and one is half of a fix whose commit message claimed the whole.

**The findings are about the seams, not the parts.** Every request involved is well formed and correctly answered.
What goes wrong is what two or three correct requests add up to: two rows for one id, a deactivation that waits
behind an unrelated write, a row checked leniently because it said inactive and then switched on.

**The reviewer's order is the right one:** identities and leavers first, then the return of a person and the
address, then the tidying.

## Findings and what was done

| # | Finding | Reproduced | Judgement | Done |
|---|---|---|---|---|
| 1 | Two source rows with one person id become one person with both rows' placements | Yes: Anna and Bo with one id became one person named Bo, placed on both units, with no refusal | Rightly first. A person with two employments exported as two rows is an ordinary source. It is the example's fault and not the server's, which sees two well-formed requests, and it is the code a directory team copies | The export is refused whole when a person id, a unit id, a group id or an active account name occurs twice |
| 2 | A failure that has nothing to do with them keeps leavers active | Yes: a unit with a blank name stopped the run, and the person who had left stayed enabled | Rightly first. The day before, leavers were moved before the people and left behind the units and the renaming | Who has left, and who the source now marks inactive, is deactivated straight after the checks, before anything else is written |
| 3 | A person who returns is let in with stale required attributes | Yes: a returner with no address in the source was activated with the old address and nothing was reported; the same mistake for a person who never left is refused | Worth more than the reviewer gave it. It is what D113 does to any provisioner that sends a row as inactive and then sets `active` alone | The example sends the whole row again as active at the end; a row Clew refuses leaves the person inactive and is reported. D113 and the guide say that a request with `active: false` checks nothing else |
| 4 | A group's `meta.lastModified` goes back after a member change | Yes: the `PATCH` answered the new time and the next `GET` the old one | Real, older than this work, and missed by four reviews. Less urgent than the reviewer has it: neither Entra nor Okta compares these times | The group's time is written whenever a member comes or goes; a repeat that changes nothing leaves it |
| 5 | A value that says `home` under a path that says `work` is stored as the work address | Yes | Introduced the day before, by the fix that was to keep a private address out. The request contradicts itself and will be rare, and the guide promises it never happens | Refused with `invalidValue`; beside a deactivation it is passed over like any wrong value |
| 6 | The token script looks first and writes afterwards, so two issues at once can both report success | From reading | True, and unlikely: one person runs it by hand once. The gain is one way of issuing instead of two | The script issues with the store's own operation, the one the users page uses |
| 7 | Unused surface: the alias `provisioning`, the type `ProvisioningUsecases`, the TypeBox import in the SCIM contract, the derivation spread onto the SCIM use cases | From reading | True on all four. The import was left behind when the input schemas were removed | Removed |
| 8 | A list of users reads each person's groups although the caller asked to have them left out | Yes, by counting store calls | The most useful of the tidying points: ten thousand queries a day at Sundsvall's size, to answer nothing. The same was fixed for groups the day before and missed here | The groups are not read when the projection leaves them out |

## What the review does not say

- **Finding 3 is larger than the example.** Any provisioner that stages a row with `active: false` has it. That is
  why it is in the decision and the guide and not only in the example's code.
- **Two active people with one account name** were not in the review. The same check that finds a repeated person id
  finds them, and the renaming of reused names assumed they could not happen.
- **PostgreSQL was not run** by the reviewer. Finding 4 was confirmed there afterwards, with a test.

## Left as it is

- A returner whose row Clew refuses is already a member of their new groups, added before the activation that then
  fails. They are inactive, so nothing is open to them; the memberships are right once the source is.
- Everything listed as left in [the full review](2026-11-11-scim-full-review.md) still stands.

## Outcome

Built on the branch `scim-outside-review`. Tests: three cases in `tests/unit/provisioner.test.ts`, two in
`tests/unit/scim-as-clients-send-it.test.ts`, one in `tests/unit/scim-integrity.test.ts`, and one on PostgreSQL in
`tests/db/postgres-scim-concurrency.test.ts`. The token script was run against a database: an id is issued once,
refused a second time and for another organisation, and issued again after it is revoked.
