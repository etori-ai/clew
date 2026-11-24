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

| # | Batch | Findings | Decided first |
|---|---|---|---|
| 13 | The conversation's state | `WD-L1`, `WD-L3`, `WD-L5`, `WD-L6`, `WD-L7`, `WD-L8` | |
| 15 | No installation's name or brand in the code, and Swedish where a person reads | `AM-12`, `BL-9`, `WA-L6`, `WA-L7`, `WA-L11`, `WA-L12`, `WA-L13` | |
| 17 | Tests and contracts that can see the fault | `WA-M5`, `DE-M4`, `DE-M7`, `ID-9`, `AM-13`, `BD-L6`, `DE-L3` | |
| 18 | The database: audit gaps, comparisons, indexes and migrations | `DE-L4`, `DE-L7`, `DE-L8`, `DE-L9`, `DE-L10`, `DE-L12`, `DE-L13`, `BD-L4` | |

## Counts

| Area | Review | High | Medium | Low | Total |
|---|---|---|---|---|---|
| ID | [Identity, sessions and authorization](../reviews/2026-11-23-review-identity-sessions-and-authorization.md) | 0 | 0 | 1 | 1 |
| CB | [The connector boundary in the core](../reviews/2026-11-23-review-connector-boundary-in-the-core.md) | 0 | 0 | 0 | 0 |
| AM | [The assistant and the model boundary](../reviews/2026-11-23-review-assistant-and-model-boundary.md) | 0 | 0 | 2 | 2 |
| DE | [Decisions, durable execution, audit and the database](../reviews/2026-11-23-review-decisions-durable-execution-audit-and-database.md) | 0 | 2 | 8 | 10 |
| BL | [Baseline, build and supply chain](../reviews/2026-11-23-review-baseline-build-and-supply-chain.md) | 0 | 1 | 1 | 2 |
| CO | [The competence domain](../reviews/2026-11-23-review-competence.md) | 0 | 0 | 0 | 0 |
| BD | [Introduction and leaving, the follow-up dialogue and talks](../reviews/2026-11-23-review-boarding-dialogue-and-talks.md) | 0 | 0 | 2 | 2 |
| WD | [The web app's data, state and errors](../reviews/2026-11-23-review-web-data-state-and-errors.md) | 0 | 0 | 6 | 6 |
| WA | [The web app against the Astryx rule, the interface spaces and WCAG 2.2 AA](../reviews/2026-11-23-review-web-astryx-interface-spaces-and-accessibility.md) | 0 | 1 | 5 | 6 |
| CS | [The connector services](../reviews/2026-11-23-review-connector-services.md) | 0 | 0 | 0 | 0 |
| | **Total** | **0** | **4** | **25** | **29** |

## High

No high finding is open.

## Identity, sessions and authorization

[The review](../reviews/2026-11-23-review-identity-sessions-and-authorization.md); its "Not established" holds five
points, and it carries a section on the earlier SCIM reviews.

| Id | Severity | Finding | Where |
|---|---|---|---|
| ID-9 | Low | No test covers a sign-in that succeeds, a second sign-in replacing the first, the mutation guard, `access-revoked`, sign-out or `localReturnTo`. | `tests/unit/auth-*.test.ts` |

## The connector boundary in the core

[The review](../reviews/2026-11-23-review-connector-boundary-in-the-core.md); its "Not established" holds six points.
It carries no tables of its own.

No finding of this area is open.

## The assistant and the model boundary

[The review](../reviews/2026-11-23-review-assistant-and-model-boundary.md); its "Not established" holds six points,
and it carries a table of what reaches the model and a table of the tools.

| Id | Severity | Finding | Where |
|---|---|---|---|
| AM-12 | Low | The system prompt tells the model it serves Sundsvalls kommun's Startsidan in every installation. | `apps/server/src/assistant/model.ts:137` |
| AM-13 | Low | The audit rows of a model's renamed fields (`model.title`, `model.model`, `model.description`), `model.audience`, `model.tools` and `model.removed` have no test, and the assistant's function ports (`run`, `start`, `people`, `handover`) have no contract case, so a test may bind them to something the server does not. | `apps/server/src/assistant/usecases/models.ts`, `apps/server/src/assistant/ports.ts` |

## Decisions, durable execution, audit and the database

[The review](../reviews/2026-11-23-review-decisions-durable-execution-audit-and-database.md); its "Not established"
holds nine points, and it carries the audit sweep of every mutating use case (tables A, B and C) and a table of
ports with no contract under M7.

| Id | Severity | Finding | Where |
|---|---|---|---|
| DE-M4 | Medium | The card projection, the owned domains' timer fences and the follow-up's writes are SQL in the composition root with no memory twin, so the unit suite tests a copy. | `apps/server/src/composition/execution-projection.ts:30-247` |
| DE-M7 | Medium | Ten ports or groups of ports have behaviour that no contract case holds both adapters to. | `tests/` (the store contracts) |
| DE-L3 | Low | `scanInto`, the first scan implementation, is unreachable in the server, and its tests still stand as evidence. | `apps/server/src/threads/usecases/cards.ts:110-203` |
| DE-L4 | Low | The projection's job inserts, an approved undo's end of the follow-up plan and a connector removal's cascade leave no audit row of their own. | `apps/server/src/composition/execution-projection.ts:227-236` |
| DE-L7 | Low | A connector's `observedAt` is compared with the stored one as a string, so an offset changes which is newer. | `apps/server/src/threads/usecases/refresh.ts:117` |
| DE-L8 | Low | `activeByUserName` in the competence store folds a user name's case with a plain `lower`, not ICU, and cannot use the index. | `apps/server/src/modules/competence/adapters/postgres.ts:710-726` |
| DE-L9 | Low | One open card per topic is enforced on insert only by the memory adapter, and a reopen can violate the PostgreSQL index. | `apps/server/src/threads/adapters/memory.ts:111-118` |
| DE-L10 | Low | The change-signal triggers miss columns and tables the browser shows, and are hand-written SQL that `schema.ts` does not name. | `packages/db/migrations/0018_black_zarek.sql:46-57` |
| DE-L12 | Low | Several queries run per page load have no index to serve them. | `apps/server/src/threads/adapters/refresh-postgres.ts:111-113` |
| DE-L13 | Low | `bun run db:init` applies only migrations newer than the last recorded one, so a skipped migration goes unnoticed. | `scripts/db-init.ts:10-13` |

## Baseline, build and supply chain

[The review](../reviews/2026-11-23-review-baseline-build-and-supply-chain.md); its "Not established" holds six points,
and it carries the baseline table of every suite, the failing-test table under finding 1 and a table of the eight
`proposed` records.

| Id | Severity | Finding | Where |
|---|---|---|---|
| BL-3 | Medium | `main` has no branch protection or ruleset, so no check is required before a change lands. | GitHub settings of the repository |
| BL-9 | Low | The web image serves Sundsvall's trademarked dragon from `apps/web/public/branding/`, though the build is said to carry no branding. | `apps/web/Dockerfile:7` |

## The competence domain

[The review](../reviews/2026-11-23-review-competence.md); its "Not established" holds five points, and it carries a
table of verdicts per question and a table of what erasure and export reach per competence table.

No finding of this area is open.

## Introduction and leaving, the follow-up dialogue and talks

[The review](../reviews/2026-11-23-review-boarding-dialogue-and-talks.md); its "Not established" holds four points,
and it carries tables of who reads and writes what, of erasure per table, of the talk booking stack's ten findings,
of the audit rows added to the decisions review's table B, and of test gaps under L6.

| Id | Severity | Finding | Where |
|---|---|---|---|
| BD-L4 | Low | `currentRound` takes a write lock on the organisation's one open round on every talks read, so every reader queues on one row. | `apps/server/src/modules/talks/adapters/postgres.ts:79-86` |
| BD-L6 | Low | Several boarding and dialogue work-item audit rows, `DialogueTx.lockPersonForErasure` and boarding's erasure refusals have no test or contract case. | `apps/server/src/composition/boarding-work-items.ts:153-289` |

## The web app's data, state and errors

[The review](../reviews/2026-11-23-review-web-data-state-and-errors.md); its "Not established" holds five points, and
it carries its follow-ups from wave 1 (a content security policy, binding a decision to what was shown, the change
stream's cost) with a table of statements per tick.

| Id | Severity | Finding | Where |
|---|---|---|---|
| WD-L1 | Low | Alla samtal shows at most 50 conversations, shared with recently handled work items and ordered by when they began. | `packages/db/src/threads.ts:116-138` |
| WD-L3 | Low | A turn the page reports as stopped or failed may already have written a work item or the answer, and a retry then asks twice. | `apps/server/src/assistant/index.ts:235-246` |
| WD-L5 | Low | A question to another system's assistant cannot be stopped and, when answered, can pull the person back or draw one conversation under another's address. | `apps/web/src/components/conversation/conversation-context.tsx:863-912` |
| WD-L6 | Low | The open conversation is a copy in component state that no change notice refreshes. | `apps/web/src/components/conversation/conversation-context.tsx:328` |
| WD-L7 | Low | A refused prediction is not taken back from the list once another write has landed on it. | `apps/web/src/thread-cache.ts:61-62` |
| WD-L8 | Low | A correction's status and a competence source's import are polled, against D33 and D46. | `apps/web/src/components/work/review-recovery.tsx:33` |

## The web app against the Astryx rule, the interface spaces and WCAG 2.2 AA

[The review](../reviews/2026-11-23-review-web-astryx-interface-spaces-and-accessibility.md); its "Not established"
holds seven points, and it carries the accessibility coverage map (routes, view kinds, states drawn without axe, mock
fixtures the server cannot produce).

| Id | Severity | Finding | Where |
|---|---|---|---|
| WA-M5 | Medium | Most pages' read failures, several empty states and loading surfaces have no spec, and twelve drawn states run no axe check. | `tests/a11y/` (the coverage map) |
| WA-L6 | Low | "Startsidan" is hard-coded in tab titles, the sign-in and error pages and several sentences, where the installation's site name belongs. | `packages/ui/src/tab-title.ts` (every tab's title: `apps/web/src/page-title.ts` and the ended session's `ENDED_TITLE`), `packages/ui/src/session.tsx` (`UNREACHABLE_WORDS`, `REACHED_WORDS` and the heading of `SessionNotice`) |
| WA-L7 | Low | Sundsvall's colours are the examples on Administration › Utseende and in the theme parser's message. | `apps/web/src/pages/admin/appearance.tsx:147` |
| WA-L11 | Low | Astryx's English fallbacks reach a Swedish reader in dialogs, date and number fields and on a phone. | `packages/ui/src/locale.ts` |
| WA-L12 | Low | Raw technical and browser messages, such as "Failed to fetch" and JSON details, are shown as they come. | `apps/web/src/components/shell/shell.tsx:218-223` |
| WA-L13 | Low | The English protocol pages render Astryx's own words and some model sentences in Swedish without marking them `lang="sv"`. | `apps/web/src/pages/protocol.tsx:96` |

## The connector services

[The review](../reviews/2026-11-23-review-connector-services.md); its "Not established" holds five points, and it
carries tables of acting as the person, the conformance check per connector, `model: true` capabilities, the manifest
fields an administrator never sees, writes and their deduplication, and error messages per connector.

No finding of this area is open.
