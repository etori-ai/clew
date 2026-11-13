# D116 · Clew keys its own records about a person by the person's id

**Status:** provisional (taken in the fixes of [the review of users and the organisation](../reviews/2026-11-12-users-the-organisation-and-the-guides-in-two-rounds.md), Q11, on the product owner's word of 2026-11-12 to fix every finding and take every open decision), built 2026-11-12; accepted once a directory outside the team has renamed a person and given a leaver's name to someone else, and the rows that a source not written for Clew sent under those names reached the right people · **Date:** 2026-11-12 · **Area:** identity, integrations

A person has two keys. Clew's id is given when the person is first pushed, never changes and is never reused. The user
name is SCIM's `userName`: the directory can rename a person, and an organisation may give a leaver's name to someone
else later, but it is the key other systems know. Until this record Clew kept its own records about a person under the
user name, so a rename separated a person from the cards about them and a reuse gave a leaver's cards to the newcomer
(N1).

**Decision.**

1. **What Clew keeps by the id.** Every record Clew keeps about a person names them by their id, compared exactly: the
   subject of a card's row and the card's own subjects, the index `thread_subject` from a person to the cards about
   them, action-point cards, and a card started from a person's menu with its input. The erasure scripts take the id
   (item 7). What the browser is given names the person by id too: the cards counted in Personal's "Just nu", search
   hits, the links of a read's records and the person's address `/people/<id>`, which reads `/api/entities/person/<id>`.
   A user name there names nobody, and the read is answered 404 "Okänd adress.". So is the id of a person who is
   deactivated or has no user name, since no source can be asked about them. A calendar proposal keeps its participant's
   id beside the address the invitation goes to (`proposal.participant_id`, N3). A unit's id is both of its keys, as
   before.
2. **A source's key is resolved when a row arrives.** A source names a person by their user name (item 6). When rows
   arrive (a scan's or a refresh's cards, a started propose's draft, a read's records and search hits), Clew resolves
   every user name in them with one read (`holders` in `apps/server/src/modules/people/ports.ts`) to whoever in the
   reader's organisation holds that name at that moment, active or deactivated, compared in the composed form (NFC) and
   without regard to case under ICU's root collation. The row then names that person by id. A name that nobody there
   holds names nobody: the row keeps its text as the source wrote it and links nowhere. A name that two people hold
   names neither of them. The unique index on user names folds case under ICU on any database, so that can only be a
   row stored decomposed (NFD) beside a composed one. A read's records are linked through the view's `people`, from
   user name to id, and the web links a record only through it. The talks' rows are placed only on the reader and the
   people the reader manages now, compared in NFC and without regard to case, and a row that names nobody there is
   left out ([D96](D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md) item 8). With
   Clew's own talks module, an action point the reader owns about someone they no longer manage is placed with
   `holders`. What Clew has kept is never moved afterwards.
3. **A rename and a reuse.** A rename moves nothing in Clew: every card keeps the id. Rows that the source sends under
   the old name afterwards name nobody until the source uses the new name, or name the next holder once the organisation
   gives the old name to someone else. After a reuse, only rows that arrive later reach the new holder. The cards about
   the leaver stay with the leaver's id. A change in the directory alone is no change of the work. A card's rows are
   resolved again when the source next sends them, but a draft without occurrences of its own is revised by Clew's
   digest of what the source wrote, user names included, and not of the rows as resolved. A rename, a leaver or a
   reused name therefore rewrites the rows without reopening the card, waking or cancelling its snooze or delivering it
   again, and a card that was dismissed or has a receipt stays as it is. A source that changes the user name a row
   carries has changed the work, and the card comes back. A draft with occurrences carries the source's own revision.
   The scan that the unit suites run in process (`scanInto`) rewrites such rows too, and wakes a snoozed card only when
   something other than the people its rows name has moved.
4. **An action started about a person.** A card started from a person's menu keeps the person's id in the input property
   the capability names (`about.param`). Its topic, `started:<capability>:<digest>`, is made from that input, with the
   id in it and never the user name, so a reused name gives another card. Starting is refused with
   "Åtgärden kan inte startas härifrån." when that property does not hold the person's id, or when the capability does
   not take the person there.
   - A `propose` is run at once, and the source is sent the user name the person has at that moment. Its digest also
     covers the topic of the source's draft. The card is that draft, its rows resolved as item 2 says, and its actions
     are the source's own.
   - An `execute` sends nothing when it is started: the card's one action is the decision. Its topic ends in
     `:person:<param>`, the property that keeps the id, and a rename keeps the same card. When the person decides, the
     capability must still take the person there, or the decision is refused with "Åtgärden har ändrats sedan ärendet
     skapades. Inget har skickats.", and so is the dialog's preview, "Det här händer". Otherwise the id the card keeps
     would reach the source as if it were a user name, for example when the connector has since declared the capability
     without `about` or with another `param`. The id is then resolved to the user name the person has now, and a person
     without one is refused with "Personen finns inte längre i katalogen. Inget har skickats.". The approved payload
     carries that user name, and the execution keeps whom it was decided for (`execution.subject`), which is part of the
     digest of what was approved ([D45](D45-approved-intent-precedes-source-dispatch.md),
     [D47](D47-occurrences-timers-and-attention-have-durable-identities.md)).
5. **Dispatch checks the name.** A write that was already dispatched is read back first, as every write is. Before an
   approved write is sent, dispatch compares the payload's user name with the user name the person holds now, both
   folded (`stillNamed` in `apps/server/src/modules/executions/usecases.ts`). When the name is no longer the person's,
   or the person holds none, as after an erasure
   ([D117](D117-clew-empties-expired-sign-in-data-itself-and-a-leavers-retention-is-the-organisations-decision.md)
   item 3), nothing is sent. An execution never dispatched is settled `failed` with the reason `subject-changed`. One
   that was dispatched, and whose read-back found nothing, is settled `unknown` with that reason, since a replay would
   reach someone else. Each is audited (`execution.failed`, `execution.unknown`). The card says "Personen har inte
   längre det användarnamn som beslutet gällde. Inget skickades. Fatta beslutet igen." or "Personen har inte längre det
   användarnamn som beslutet gällde, så åtgärden skickas inte igen. Utfallet behöver kontrolleras i källsystemet.". A
   failed one is decided again from its card, as a new decision, on the user name the person has then. Without the
   people port, nothing about a person is ever dispatched.
6. **The user name stays on the wire.** A source is asked about a person, and sent the person of an action, by the user
   name, compared without regard to case and in NFC, as
   [D96](D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md) item 8 keys the talks. A
   source is never asked about a person by Clew's id. The signed actor a connector receives carries the id, and the user
   name when the person has one ([D97](D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md)). Whether
   `Actor` should also carry a key that the source knows and that never changes, such as the directory's `externalId`,
   stays an [open question](../maintainers/open-questions.md#waiting-for-the-product-owner), in its row on `Actor`.
7. **Erasure is by the id.** `bun scripts/subject-erase.ts person <person id> --confirm`,
   `bun scripts/talks-erase.ts --person <person id> --confirm` and
   `bun scripts/competence-erase.ts --person <person id> --confirm` take the person's id, never a user name. An id the
   people table does not hold is refused, and nothing is erased or audited. One erasure reaches every card about the
   person, whatever user names they have held, and never the cards of someone who holds one of those names now. The
   rows' text stays as the source wrote it. `competence-erase` also removes the cards the competence scan put in the
   person's stream, each with one `thread.removed` row (`details.reason` `erasure`) written at the time of the erasure.
   When a person's own record is erased is
   [D117](D117-clew-empties-expired-sign-in-data-itself-and-a-leavers-retention-is-the-organisations-decision.md)'s.
8. **D97's two open items on keys are settled.** The key on the wire is the user name. The key on Clew's card rows is
   the person's id, so the key Clew keeps on a card is never one of the person's names, as [principle
   7](../vision.md#principles) of the vision asks, and one erasure reaches the whole person.
9. **The advice to erase a leaver before a name is reused is dropped.** The review's fix for N2 would have told
   directory teams that "No" is the safer answer to whether a name is ever reused, and to erase the leaver's cards
   before the name moves. Clew's own records need neither now. A provisioner still frees a reused name by renaming the
   leaver's row first, since a user name is unique in the installation
   ([D101](D101-a-provisioner-pushes-the-organisation-first-and-adds-before-it-removes-and-a-unit-belongs-to-one-organisation.md)
   item 9). A connected system that keeps records under the name answers for whoever holds the name now. What an
   operator does there on a rename and before a reuse belongs to that system, as [the Nextcloud connector's
   README](../../connectors/nextcloud-approval/README.md#accounts-and-user-names) says for Nextcloud.

**Why.** The review showed what keying by the user name did (N1). After a rename, a card about the person left the
person's page and its owner's "Just nu" on Personal. After a reuse, the open cards about the leaver showed on the
newcomer's page, and an approval started about the leaver could act on the newcomer. No erasure reached the leaver
alone: an erasure by a name reached whoever held it now. With the user name in the address of every request about a
person, a request's span and its failure line carried it too, often a person's sign-in address (T2).

**Weighed and left.**

- Moving the stored names when a user name changes, in the same SCIM request, with one audit row (the review's fix for
  N1). It covers renames only, and a reuse only when every provisioner renames the leaver before it gives the name away.
  An approved payload cannot be moved without changing what the person approved
  ([D45](D45-approved-intent-precedes-source-dispatch.md)). And a rename would rewrite every card about the person
  inside a SCIM request.
- The directory's `externalId` on the wire. Most systems Clew reads do not know it, so each source would need a mapping
  it does not have.
- Clew's id on the wire. Only Clew knows it, so each source would need a table from Clew's ids to its own.

The chosen rule does not depend on the order in which a provisioner pushes a rename and a reuse: Clew's records never
move, and a row is placed by whoever holds its name when it arrives. Nobody is better than the wrong person: a row whose
name has no single holder links nowhere, where a guess could put a leaver's case on a newcomer's page. Dispatch checks
the name rather than resolving the id again, because an approved write carries what the person approved: a write is
never sent about someone the person did not decide about. The cost is one more decision in the rare case that a name
moves between the decision and the dispatch. A change in the directory alone is not counted as the source changing the
work, since nothing about the work has moved: reopening a card, breaking its snooze or delivering it again would
interrupt a person for a change that asks nothing of them.

In an organisation of several thousand employees, renames are routine: a marriage, a corrected spelling, a new naming
standard after a merger of administrations. Leavers' names come back with new staff, the common ones above all, and
returners come back to the record they had. Keying by the id keeps each person's cards and history whole through all of
these, and none of them needs an operator.

**As built.** In `@clew/contracts`: `foldSourceKey`, `EntityRefSchema` with Clew's `key` and the source's `sourceKey`,
`PanelViewSpec.people` and `SUBJECT_CHANGED`. The people port's `userName`, `holders` and `exists` (`UserReads`) are
read from PostgreSQL through `postgresUserReads`, the only adapter that has them. `tests/user-reads-contract.ts` holds
them there, in `tests/db/user-reads.test.ts`, on a database created with the C locale too, and holds the unit suite's
in-memory double to the same; `tests/db/postgres-entity-keys.test.ts` opens a person's address by id on PostgreSQL.
`keyedDrafts` and `viewWithPeople` in `apps/server/src/threads/usecases/keys.ts`; `keyedItems`, `startedTopic`,
`startedDecision` and `takesStarted` in `apps/server/src/threads/domain.ts`; `started.ts` and `decisions.ts` in
`apps/server/src/threads/usecases/`; `stillNamed` in the executions module; search's `keyedHits`; the talks seam's
`keyIndex`. Migration `0054_person_keys_and_participants.sql` adds `execution.subject` and `proposal.participant_id`.
Tests: `tests/unit/entities-cards.test.ts` (a renamed person keeps the cards that named them, a reused user name
reaches only rows that arrive after, and a rename the source has not made rewrites a row and keeps a card's snooze),
`tests/unit/entities-actions.test.ts` (an execute about a person erased since cannot be decided),
`tests/unit/executions.test.ts` (an approved action about a person), `tests/unit/card-decisions.test.ts`,
`tests/unit/search.test.ts`, `tests/unit/refresh.test.ts` (a rename in the directory alone rewrites the rows and
reopens, wakes and delivers nothing; a source that names another person in a row brings the card back),
`tests/unit/capability-routes.test.ts`, `tests/db/postgres-competence-erasure.test.ts`, and
`tests/a11y/executions.spec.ts` for the card's text and the button that decides again. No migration re-keys the
cards written before, since Clew is not launched and its data is synthetic: a card whose rows named a person by user
name names nobody until its rows are next written, when each name is resolved as item 2 says. A request's span records
an entity's key as `:key` in `url.full` and the route template as `http.route` (`apps/server/src/request-spans.ts`),
and the "request failed" line carries the route template (`failure()` in `apps/server/src/context.ts`), so no user name
reaches a span or that line through the address (T2).

**Replaces.** Settles the two items on keys in the "Open" list of
[D97](D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md), and replaces the keying by user name that
D97's build took for card rows, the subject index, started actions and erasure.
[D96](D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md) item 8 stands: rows are keyed
on the user name on the wire. The advice in the review's fix for N2, to erase a leaver before the name is reused, is not
given.
