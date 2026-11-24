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
| 8 | Erasure reaches everything | `DE-M6`, `BD-M1`, `BD-M2`, `BD-L1`, `BD-L3`, `BD-L5` | |
| 10 | The assistant's prompt, tools, provider and record | `AM-2`, `AM-3`, `AM-5`, `AM-6`, `AM-7`, `AM-8`, `AM-9`, `AM-10` | |
| 11 | Connector administration and its scripts | `DE-M5`, `CB-9`, `CB-10`, `CB-11`, `CB-12`, `CB-13` | |
| 12 | The session and the change stream in the browser | `WD-M1`, `WD-M2`, `WD-M3`, `WD-M4`, `WD-L2`, `WD-L4`, `WD-L9` | |
| 13 | The conversation's state | `WD-L1`, `WD-L3`, `WD-L5`, `WD-L6`, `WD-L7`, `WD-L8` | |
| 14 | The calendar's time zones, entries and talk meetings | `DE-M8`, `DE-L14`, `DE-L15`, `DE-L16`, `WA-M2`, `WA-L5` | |
| 15 | No installation's name or brand in the code, and Swedish where a person reads | `AM-12`, `BL-9`, `WA-L6`, `WA-L7`, `WA-L11`, `WA-L12`, `WA-L13` | |
| 16 | The interface's theme check, spaces and measures | `WA-M1`, `WA-L4`, `WA-L8`, `WA-L9`, `WA-L10`, `WA-L14` | |
| 17 | Tests and contracts that can see the fault | `WA-M5`, `DE-M4`, `DE-M7`, `ID-9`, `AM-13`, `BD-L6`, `DE-L3` | |
| 18 | The database: audit gaps, comparisons, indexes and migrations | `DE-L4`, `DE-L7`, `DE-L8`, `DE-L9`, `DE-L10`, `DE-L12`, `DE-L13`, `BD-L4` | |
| 19 | The build, the images and the documents that span areas | `BL-4`, `BL-5`, `BL-11`, `BL-12`, `BL-13`, `BL-14`, `BL-15` | |
| 20 | The connector services | `CS-L1`, `CS-L2`, `CS-L4`, `CS-L5`, `CS-L6`, `CS-L7`, `CS-L8` | |

## Counts

| Area | Review | High | Medium | Low | Total |
|---|---|---|---|---|---|
| ID | [Identity, sessions and authorization](../reviews/2026-11-23-review-identity-sessions-and-authorization.md) | 0 | 0 | 1 | 1 |
| CB | [The connector boundary in the core](../reviews/2026-11-23-review-connector-boundary-in-the-core.md) | 0 | 0 | 5 | 5 |
| AM | [The assistant and the model boundary](../reviews/2026-11-23-review-assistant-and-model-boundary.md) | 0 | 5 | 5 | 10 |
| DE | [Decisions, durable execution, audit and the database](../reviews/2026-11-23-review-decisions-durable-execution-audit-and-database.md) | 0 | 5 | 11 | 16 |
| BL | [Baseline, build and supply chain](../reviews/2026-11-23-review-baseline-build-and-supply-chain.md) | 0 | 2 | 7 | 9 |
| CO | [The competence domain](../reviews/2026-11-23-review-competence.md) | 0 | 0 | 0 | 0 |
| BD | [Introduction and leaving, the follow-up dialogue and talks](../reviews/2026-11-23-review-boarding-dialogue-and-talks.md) | 0 | 2 | 5 | 7 |
| WD | [The web app's data, state and errors](../reviews/2026-11-23-review-web-data-state-and-errors.md) | 0 | 4 | 9 | 13 |
| WA | [The web app against the Astryx rule, the interface spaces and WCAG 2.2 AA](../reviews/2026-11-23-review-web-astryx-interface-spaces-and-accessibility.md) | 0 | 3 | 11 | 14 |
| CS | [The connector services](../reviews/2026-11-23-review-connector-services.md) | 0 | 0 | 7 | 7 |
| | **Total** | **0** | **21** | **61** | **82** |

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

| Id | Severity | Finding | Where |
|---|---|---|---|
| CB-9 | Low | Adding or testing a connector whose service does not answer ends in "Något gick fel", and `unreachable` is never recorded. | `apps/server/src/composition/index.ts:403-405` |
| CB-10 | Low | Several connector administration audit rows and the signing key's rows have no scenario test that asserts them. | `apps/server/src/connectors/usecases/admin.ts:609-618` |
| CB-11 | Low | The registration script sets a re-registered connector to draft under one `connector.secret` row and writes state and removal rows for changes that did not happen. | `scripts/connector-registry.ts:48-77` |
| CB-12 | Low | Current documentation still names protocols 2 and 3, though the loader refuses any number but 1. | `docs/reference/connector-protocol.md:183` |
| CB-13 | Low | Without `--id`, the check script signs request, callback and installation assertions for whatever audience an unregistered service's manifest names. | `scripts/connector-check.ts:81-87` |

## The assistant and the model boundary

[The review](../reviews/2026-11-23-review-assistant-and-model-boundary.md); its "Not established" holds six points,
and it carries a table of what reaches the model and a table of the tools.

| Id | Severity | Finding | Where |
|---|---|---|---|
| AM-2 | Medium | Source text is written into the system prompt beside Clew's rules, with no rule that it is data and no line rule on its fields. | `apps/server/src/assistant/model.ts:136-213` |
| AM-3 | Medium | The live server binds the assistant's `people` port with the person's Clew id and the prompt calls it their user name, which the registry refuses. | `apps/server/src/composition/index.ts:359-363` |
| AM-5 | Medium | One failed turn marks the provider down for everyone, and turns fail for reasons unrelated to the endpoint: an 8-second budget, no text after tool calls, no token limit. | `apps/server/src/assistant/index.ts:734` |
| AM-6 | Medium | A model call that does not end in the model's answer leaves no record of which model was called or what it read. | `apps/server/src/assistant/index.ts:727` |
| AM-7 | Medium | D115's guard is applied to the turn's prompt but not to the conversation's history, which is sent unchecked. | `apps/server/src/assistant/context.ts:92` |
| AM-8 | Low | A failed tool's error message, a connector's own or any other error's, is handed to the model as it is. | `apps/server/src/assistant/model.ts:54-56` |
| AM-9 | Low | The administrator's "Assistent" switch closes tools only; chips, matched cards and the router's answers from a closed connector still reach the model. | `packages/connectors/src/index.ts:1891-1894` |
| AM-10 | Low | Changing a provider's address keeps its sealed key, which is then sent to the new address. | `apps/server/src/assistant/usecases/models.ts:229-256` |
| AM-12 | Low | The system prompt tells the model it serves Sundsvalls kommun's Startsidan in every installation. | `apps/server/src/assistant/model.ts:137` |
| AM-13 | Low | Several model administration audit rows have no test, the assistant's function ports have no contract case, and nothing tests what a stopped turn or a model-started item leaves. | `apps/server/src/assistant/usecases/models.ts` |

## Decisions, durable execution, audit and the database

[The review](../reviews/2026-11-23-review-decisions-durable-execution-audit-and-database.md); its "Not established"
holds nine points, and it carries the audit sweep of every mutating use case (tables A, B and C) and a table of
ports with no contract under M7.

| Id | Severity | Finding | Where |
|---|---|---|---|
| DE-M4 | Medium | The card projection, the owned domains' timer fences and the follow-up's writes are SQL in the composition root with no memory twin, so the unit suite tests a copy. | `apps/server/src/composition/execution-projection.ts:30-247` |
| DE-M5 | Medium | Connector administration merges and writes from a row read before its transaction, with no version compared, and nothing keeps `header_holder` to one row. | `apps/server/src/connectors/usecases/admin.ts:331` |
| DE-M6 | Medium | No erasure clears an invitee's `participant_name` and `participant_email` from `proposal`. | `packages/db/src/schema.ts:433-435` |
| DE-M7 | Medium | Ten ports or groups of ports have behaviour that no contract case holds both adapters to. | `tests/` (the store contracts) |
| DE-M8 | Medium | The CalDAV adapter builds a person's address as `<login>@clew.test` and reads an appointment with no organiser as someone else's. | `packages/calendar/src/nextcloud.ts:68` |
| DE-L3 | Low | `scanInto`, the first scan implementation, is unreachable in the server, and its tests still stand as evidence. | `apps/server/src/threads/usecases/cards.ts:110-203` |
| DE-L4 | Low | The projection's job inserts, an approved undo's end of the follow-up plan and a connector removal's cascade leave no audit row of their own. | `apps/server/src/composition/execution-projection.ts:227-236` |
| DE-L7 | Low | A connector's `observedAt` is compared with the stored one as a string, so an offset changes which is newer. | `apps/server/src/threads/usecases/refresh.ts:117` |
| DE-L8 | Low | `activeByUserName` in the competence store folds a user name's case with a plain `lower`, not ICU, and cannot use the index. | `apps/server/src/modules/competence/adapters/postgres.ts:710-726` |
| DE-L9 | Low | One open card per topic is enforced on insert only by the memory adapter, and a reopen can violate the PostgreSQL index. | `apps/server/src/threads/adapters/memory.ts:111-118` |
| DE-L10 | Low | The change-signal triggers miss columns and tables the browser shows, and are hand-written SQL that `schema.ts` does not name. | `packages/db/migrations/0018_black_zarek.sql:46-57` |
| DE-L12 | Low | Several queries run per page load have no index to serve them. | `apps/server/src/threads/adapters/refresh-postgres.ts:111-113` |
| DE-L13 | Low | `bun run db:init` applies only migrations newer than the last recorded one, so a skipped migration goes unnoticed. | `scripts/db-init.ts:10-13` |
| DE-L14 | Low | The CalDAV adapter mishandles time zones in events other clients wrote: a process-wide zone registry, floating times read in the server's zone, and invalid `TZID` with UTC. | `packages/calendar/src/nextcloud.ts:148-151` |
| DE-L15 | Low | A meeting made all-day and then adopted books the talk from midnight UTC. | `apps/server/src/modules/calendar/usecases/invitations.ts:53-54` |
| DE-L16 | Low | A nonexistent date gives a 500 in the calendar's reads, and an availability check for eight participants and a room is refused by both adapters. | `apps/server/src/modules/calendar/usecases/events.ts:81-84` |

## Baseline, build and supply chain

[The review](../reviews/2026-11-23-review-baseline-build-and-supply-chain.md); its "Not established" holds six points,
and it carries the baseline table of every suite, the failing-test table under finding 1 and a table of the eight
`proposed` records.

| Id | Severity | Finding | Where |
|---|---|---|---|
| BL-3 | Medium | `main` has no branch protection or ruleset, so no check is required before a change lands. | GitHub settings of the repository |
| BL-4 | Medium | The local development guide starts a Keycloak container that nothing in the repository creates, pins or describes. | `docs/maintainers/local-development.md:16` |
| BL-5 | Low | Seven connector images set a SQLite path under `/data`, which the image lacks and `node` cannot write, so they do not start as built. | `connectors/hr/Dockerfile:5` |
| BL-9 | Low | The web image serves Sundsvall's trademarked dragon from `apps/web/public/branding/`, though the build is said to carry no branding. | `apps/web/Dockerfile:7` |
| BL-11 | Low | The documentation site's lockfile pins `vite` and `esbuild` with known advisories, and no workflow runs `bun audit`. | `site/package.json` |
| BL-12 | Low | Connector base images are pinned by tag only and named without a registry, and `bun` is installed globally without integrity. | `connectors/*/Dockerfile` |
| BL-13 | Low | `bun run deps` does not cruise `apps/web`, where one violation of `clew-does-not-import-connectors` stands in a test. | `package.json` |
| BL-14 | Low | Documents that span areas state things the repository no longer holds: duplicate decision numbers, protocol 2, Astryx and FullCalendar commands, ports and the trailing slash. | `docs/reference/status.md:29` |
| BL-15 | Low | The connector protocol's reference page serves Scalar's packaged standalone script, which bundles Vue and other packages, with Scalar's own notice only (`apps/server/licences/scalar-MIT.txt`); the other packages' notices survive in part as `@license` comments. Found by the review of the licence batch, 2026-11-23. | `apps/server/src/routes/protocol.ts:25` |

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
| BD-M1 | Medium | The documented procedure for erasing one person runs no boarding export or erasure, and D123, the status page and the scripts' headers leave it out too. | `docs/maintainers/reliability-operations.md:199` |
| BD-M2 | Medium | `boarding.erasePerson` refuses neither an unknown id nor an active person, and its script parses arguments its own way and reaches for the durable engine. | `apps/server/src/modules/boarding/usecases.ts:952-969` |
| BD-L1 | Low | A plan item owned by a manager who has been deactivated waits for nobody, since it is handed back only when its owner is erased. | `apps/server/src/modules/boarding/domain.ts:328-329` |
| BD-L3 | Low | Two scan cards of Clew's own put the person's user name in their action input, which no erasure reaches. | `apps/server/src/modules/boarding/capabilities.ts:197` |
| BD-L4 | Low | `currentRound` takes a write lock on the organisation's one open round on every talks read, so every reader queues on one row. | `apps/server/src/modules/talks/adapters/postgres.ts:79-86` |
| BD-L5 | Low | Dialogue's own copy of the card-removal helper audits every card an erasure removes as an activity removed by hand. | `apps/server/src/composition/dialogue-work-items.ts:26` |
| BD-L6 | Low | Several boarding and dialogue work-item audit rows, `DialogueTx.lockPersonForErasure` and boarding's erasure refusals have no test or contract case. | `apps/server/src/composition/boarding-work-items.ts:153-289` |

## The web app's data, state and errors

[The review](../reviews/2026-11-23-review-web-data-state-and-errors.md); its "Not established" holds five points, and
it carries its follow-ups from wave 1 (a content security policy, binding a decision to what was shown, the change
stream's cost) with a table of statements per tick.

| Id | Severity | Finding | Where |
|---|---|---|---|
| WD-M1 | Medium | The session boundary ends the session, in every tab, on any non-2xx answer or network error, so a transient failure reads as a sign-out. | `packages/ui/src/session.tsx:98` |
| WD-M2 | Medium | The change stream's `EventSource` has no `onerror`, so after one reconnect answered with an HTTP error it stays closed. | `apps/web/src/main.tsx:126-130` |
| WD-M3 | Medium | A link opened signed out loses its query on the way through sign-in, and "Logga in igen" loses the whole address. | `apps/web/src/main.tsx:195` |
| WD-M4 | Medium | Typed text and user names are sent as query strings in four places, where nginx's default access log and the browser history keep them. | `apps/web/src/components/conversation/composer.tsx:187` |
| WD-L1 | Low | Alla samtal shows at most 50 conversations, shared with recently handled work items and ordered by when they began. | `packages/db/src/threads.ts:116-138` |
| WD-L2 | Low | Toasts with live buttons and the tab's title stay on screen after the session ends. | `apps/web/src/main.tsx:486` |
| WD-L3 | Low | A turn the page reports as stopped or failed may already have written a work item or the answer, and a retry then asks twice. | `apps/server/src/assistant/index.ts:235-246` |
| WD-L4 | Low | Session storage keeps what a conversation showed, view inputs included, after the session ends. | `apps/web/src/conversation-shown.ts:52-76` |
| WD-L5 | Low | A question to another system's assistant cannot be stopped and, when answered, can pull the person back or draw one conversation under another's address. | `apps/web/src/components/conversation/conversation-context.tsx:863-912` |
| WD-L6 | Low | The open conversation is a copy in component state that no change notice refreshes. | `apps/web/src/components/conversation/conversation-context.tsx:328` |
| WD-L7 | Low | A refused prediction is not taken back from the list once another write has landed on it. | `apps/web/src/thread-cache.ts:61-62` |
| WD-L8 | Low | A correction's status and a competence source's import are polled, against D33 and D46. | `apps/web/src/components/work/review-recovery.tsx:33` |
| WD-L9 | Low | The first load asks for the session twice, in a chain, before the page's first read. | `apps/web/src/main.tsx:82-119` |

## The web app against the Astryx rule, the interface spaces and WCAG 2.2 AA

[The review](../reviews/2026-11-23-review-web-astryx-interface-spaces-and-accessibility.md); its "Not established"
holds seven points, and it carries the accessibility coverage map (routes, view kinds, states drawn without axe, mock
fixtures the server cannot produce).

| Id | Severity | Finding | Where |
|---|---|---|---|
| WA-M1 | Medium | The theme check does not test the focus ring, marks, icons or success and information text against the card's ground. | `packages/contracts/src/theme-file.ts:143-169` |
| WA-M2 | Medium | A calendar entry is a button wherever it is drawn, and in four places pressing it does nothing, while the spoken summary says Enter opens it. | `packages/ui/src/calendar.tsx:168` |
| WA-M5 | Medium | Most pages' read failures, several empty states and loading surfaces have no spec, and twelve drawn states run no axe check. | `tests/a11y/` (the coverage map) |
| WA-L4 | Low | An entry in the pane beside a conversation opens a dialog over the conversation page, against D126 rule 3. | `apps/web/src/pages/conversation.tsx:173` |
| WA-L5 | Low | `agendaItems` recognises a talk's meeting by its title, which D133 forbids. | `packages/ui/src/agenda-items.ts:26` |
| WA-L6 | Low | "Startsidan" is hard-coded in tab titles, the sign-in and error pages and several sentences, where the installation's site name belongs. | `apps/web/src/page-title.ts:7` |
| WA-L7 | Low | Sundsvall's colours are the examples on Administration › Utseende and in the theme parser's message. | `apps/web/src/pages/admin/appearance.tsx:147` |
| WA-L8 | Low | The calendar theme sizes and offsets several things in pixels where D27 asks for tokens. | `packages/ui/src/calendar-theme.css:155` |
| WA-L9 | Low | Six admin pages decide a phone at 720 px while the rest of the app uses 767 px. | `apps/web/src/pages/admin/models.tsx:49` |
| WA-L10 | Low | The interface spaces document still lists "Visa detaljer" as a dialog of a page, though the control is gone. | `docs/reference/interface-spaces.md:17` |
| WA-L11 | Low | Astryx's English fallbacks reach a Swedish reader in dialogs, date and number fields and on a phone. | `packages/ui/src/locale.ts` |
| WA-L12 | Low | Raw technical and browser messages, such as "Failed to fetch" and JSON details, are shown as they come. | `apps/web/src/components/shell/shell.tsx:218-223` |
| WA-L13 | Low | The English protocol pages render Astryx's own words and some model sentences in Swedish without marking them `lang="sv"`. | `apps/web/src/pages/protocol.tsx:96` |
| WA-L14 | Low | Under Behöver dig, a work item's line takes the label of the row that names a person as whom the item is about, and drops the reason; the HR connector labels such rows "Ansökan" and "Medarbetare" and names the person by key only (D97), so the line names no one. The key is Clew's own (D62), so the name can come from Clew. Found while making the accessibility suite's mock rows match the HR connector's, 2026-11-23. | `apps/web/src/pages/todo.tsx:161-165`, `connectors/hr/connector.mjs:592` |

## The connector services

[The review](../reviews/2026-11-23-review-connector-services.md); its "Not established" holds five points, and it
carries tables of acting as the person, the conformance check per connector, `model: true` capabilities, the manifest
fields an administrator never sees, writes and their deduplication, and error messages per connector.

| Id | Severity | Finding | Where |
|---|---|---|---|
| CS-L1 | Low | The verifier never records `jti` and the operation id is outside the binding, so a captured write sent under a new operation id runs again in five connectors. | `connectors/*/verification.mjs:62` |
| CS-L2 | Low | Fifteen connectors run a capability on a path the verifier does not bind to a capability, so D117's capability binding does not hold. | `connectors/*/verification.mjs:12-34` |
| CS-L4 | Low | The supportmanagement and pob compose files give a `CLEW_URL` over `http:` that the verifier refuses to fetch keys from. | `connectors/supportmanagement/compose.yaml:4` |
| CS-L5 | Low | `reference` answers 401 to an employee, which Clew reads as the source unavailable, and fails the conformance check. | `connectors/reference/connector.mjs:98` |
| CS-L6 | Low | `hello` puts the underlying error's text in its answer. | `connectors/hello/connector.mjs:295` |
| CS-L7 | Low | Five real-system connectors serve made-up fixture data when the adapter is left unset. | `connectors/supportmanagement/server.mjs:37` |
| CS-L8 | Low | `connectors/README.md` counts four reads for communication, whose manifest has five. | `connectors/README.md:49` |
