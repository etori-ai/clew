# Open findings

These are the findings of the review of the whole repository on 2026-11-23, at `9fd4c962`, one review per area,
linked below. They are fixed in the order of work below. A row is removed
in the change that fixes it; a finding it is decided not to fix is removed with that decision named in the commit
message. The severity is the review's own. The reviews were made by automated reviewers, the coordinating session
checked the high findings of the first five reviews against the code, and no person has reviewed any of them. Each
review's own sections "Not established" and "Seen outside this area" hold more that is not listed here.
[The overview](../reviews/2026-11-23-review-of-the-whole-repository.md) says what was reviewed, which findings are one
weakness seen from several areas, and how far to trust them.

## Order of work

The product owner decided on 2026-11-23 that the findings are fixed, a batch at a time, in this order; the first nine
fixes (#96 to #104) came before it. Each batch is one pull request stacked on the one before. After one or two
batches, those pull requests get a review of their own: what it finds in them is fixed in them, and what it finds
elsewhere is added here. A batch's line goes when its last finding does; a finding that moves to another batch takes
its id with it. `BL-3` (protecting `main`) waits for the run-up to the first release, by the same decision, and is in
no batch.

No batch is open.

## Counts

| Area | Review | High | Medium | Low | Total |
|---|---|---|---|---|---|
| ID | [Identity, sessions and authorization](../reviews/2026-11-23-review-identity-sessions-and-authorization.md) | 0 | 0 | 0 | 0 |
| CB | [The connector boundary in the core](../reviews/2026-11-23-review-connector-boundary-in-the-core.md) | 0 | 0 | 0 | 0 |
| AM | [The assistant and the model boundary](../reviews/2026-11-23-review-assistant-and-model-boundary.md) | 0 | 0 | 0 | 0 |
| DE | [Decisions, durable execution, audit and the database](../reviews/2026-11-23-review-decisions-durable-execution-audit-and-database.md) | 0 | 0 | 0 | 0 |
| BL | [Baseline, build and supply chain](../reviews/2026-11-23-review-baseline-build-and-supply-chain.md) | 0 | 1 | 0 | 1 |
| CO | [The competence domain](../reviews/2026-11-23-review-competence.md) | 0 | 0 | 0 | 0 |
| BD | [Introduction and leaving, the follow-up dialogue and talks](../reviews/2026-11-23-review-boarding-dialogue-and-talks.md) | 0 | 0 | 0 | 0 |
| WD | [The web app's data, state and errors](../reviews/2026-11-23-review-web-data-state-and-errors.md) | 0 | 0 | 0 | 0 |
| WA | [The web app against the Astryx rule, the interface spaces and WCAG 2.2 AA](../reviews/2026-11-23-review-web-astryx-interface-spaces-and-accessibility.md) | 0 | 0 | 0 | 0 |
| CS | [The connector services](../reviews/2026-11-23-review-connector-services.md) | 0 | 0 | 0 | 0 |
| | **Total** | **0** | **1** | **0** | **1** |

## High

No high finding is open.

## Identity, sessions and authorization

[The review](../reviews/2026-11-23-review-identity-sessions-and-authorization.md); its "Not established" holds five
points, and it carries a section on the earlier SCIM reviews.

No finding of this area is open.

## The connector boundary in the core

[The review](../reviews/2026-11-23-review-connector-boundary-in-the-core.md); its "Not established" holds six points.
It carries no tables of its own.

No finding of this area is open.

## The assistant and the model boundary

[The review](../reviews/2026-11-23-review-assistant-and-model-boundary.md); its "Not established" holds six points,
and it carries a table of what reaches the model and a table of the tools.

No finding of this area is open.

## Decisions, durable execution, audit and the database

[The review](../reviews/2026-11-23-review-decisions-durable-execution-audit-and-database.md); its "Not established"
holds nine points, and it carries the audit sweep of every mutating use case (tables A, B and C) and a table of
ports with no contract under M7.

No finding of this area is open.

## Baseline, build and supply chain

[The review](../reviews/2026-11-23-review-baseline-build-and-supply-chain.md); its "Not established" holds six points,
and it carries the baseline table of every suite, the failing-test table under finding 1 and a table of the eight
`proposed` records.

| Id | Severity | Finding | Where |
|---|---|---|---|
| BL-3 | Medium | `main` has no branch protection or ruleset, so no check is required before a change lands. | GitHub settings of the repository |

## The competence domain

[The review](../reviews/2026-11-23-review-competence.md); its "Not established" holds five points, and it carries a
table of verdicts per question and a table of what erasure and export reach per competence table.

No finding of this area is open.

## Introduction and leaving, the follow-up dialogue and talks

[The review](../reviews/2026-11-23-review-boarding-dialogue-and-talks.md); its "Not established" holds four points,
and it carries tables of who reads and writes what, of erasure per table, of the talk booking stack's ten findings,
of the audit rows added to the decisions review's table B, and of test gaps under L6.

No finding of this area is open.

## The web app's data, state and errors

[The review](../reviews/2026-11-23-review-web-data-state-and-errors.md); its "Not established" holds five points, and
it carries its follow-ups from wave 1 (a content security policy, binding a decision to what was shown, the change
stream's cost) with a table of statements per tick.

No finding of this area is open.

## The web app against the Astryx rule, the interface spaces and WCAG 2.2 AA

[The review](../reviews/2026-11-23-review-web-astryx-interface-spaces-and-accessibility.md); its "Not established"
holds seven points, and it carries the accessibility coverage map (routes, view kinds, states drawn without axe, mock
fixtures the server cannot produce).

No finding of this area is open.

## The connector services

[The review](../reviews/2026-11-23-review-connector-services.md); its "Not established" holds five points, and it
carries tables of acting as the person, the conformance check per connector, `model: true` capabilities, the manifest
fields an administrator never sees, writes and their deduplication, and error messages per connector.

No finding of this area is open.
