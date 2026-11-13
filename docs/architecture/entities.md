# Entities: what sources say about a person or a unit

An **entity** is a person or a unit that Clew already holds ([D62](../decisions/D62-users-are-core-entities-not-connected-systems.md), [D68](../decisions/D68-people-are-pushed-into-clew-through-standard-scim.md)). A source, a remote connector or one of Clew's own modules, declares what the rows of a capability are **about**, and Clew decides where they show ([D97](../decisions/D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md)). No feature edits Personal or the person's page to appear there. This page describes what is built in this checkout. The connector author's side is in [Create a connector](../guides/creating-a-connector.md#8-say-what-your-rows-are-about); the wire rules are in the [protocol reference](../reference/connector-protocol.md#reads-and-actions-about-an-entity).

## Kinds and keys

`ENTITY_KINDS` in [`@clew/contracts`](../../packages/contracts/src/index.ts) is a closed list, `person` and `unit`. A new kind is a contract change that comes with the core rule saying who may be asked about it.

| Kind | Clew's key | Key on the wire | Compared on the wire |
|---|---|---|---|
| `person` | The person's id | The provisioned SCIM `userName` | Without regard to case, in NFC. A person without a user name, or a deactivated one, is never asked about. |
| `unit` | The unit id | The unit id | Exactly. |

Clew keys every record of its own about a person by the person's id, compared exactly ([D122](../decisions/D122-clew-keys-its-own-records-about-a-person-by-the-persons-id.md)): card rows, a card's own subjects, the index from entity to cards, action-point cards, started actions and their inputs, "Just nu", the address `/people/<id>` and erasure. A source names a person by the user name, and Clew's id is never sent to a source as a key, except by the talks profile for a person without a user name ([D96](../decisions/D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md), As built, item 8; D122 item 6). A name is resolved when it arrives, in one read per answer (`holders` in the people module's user reads), to whoever in the reader's organisation holds it then, active or not. A name nobody there holds names nobody: the row keeps its text, but it is on nobody's page and links nowhere. A name that two people there hold also names nobody. The unique index on user names folds case under ICU on any database, so that can only be a row stored decomposed (NFD), as before user names were normalised, beside a composed one. In an `EntityRef`, `key` is Clew's key, which is the address and what attention and card rows name, and `sourceKey` is what a source is asked with and answers a row's `key` with; the person's page shows `sourceKey` as "Användarnamn".

So a rename loses nothing: Clew's records, the cards, the index, "Just nu", the address and an undecided started action stay with the person, while rows a source still sends under the old name name nobody from then on, or the person the name is given to later. Rows already kept are never moved. After a name is reused, only rows and actions that arrive after it was given reach the new holder. A person's key is their id, 1 to 80 characters without a NUL; a unit's key is 1 to 256 characters without a NUL. Any other key names nobody: the routes answer 404 "Okänd adress." before the key reaches a source or a database query.

## Where a source shows

A capability declares `about: { entity }` on a read, or `about: { entity, param }` on a propose or execute. What it declares sets the most room it can get; it never names a place.

| Declared | Place | Who places it |
|---|---|---|
| A propose or execute about the kind | The entity's menu: the row menu on Personal; on the person's page the section of the source that offers it, or beside the name when that source has no section to hold it; beside the name on the unit's page | Nobody: scope and audience decide |
| A read about the kind (always a table or list) | A section on the opened entity | Nobody |
| The same read | A lens under "Visa" on the entity's list | An administrator |
| A field of that read with a `warn` or `alert` tone | A mark on the entity's row on "Alla", under "Just nu" | An administrator, by offering the read as a lens |
| One field of that read | A column on "Alla", the source's name under its heading | An administrator, at most three per kind |

The opened entity starts with "Behöver dig" when the reader has work items about it. On a person, "Kontaktuppgifter" and "Anställningar" come next, how the person is reached before where they are employed ([D124](../decisions/D124-a-unit-is-walked-one-step-up-and-one-step-down-and-the-people-pages-follow-their-canvas.md) item 6): what the directory pushed about the person and Clew holds ([D114](../decisions/D114-person-profiles-show-employments-and-categorised-phone-numbers.md)), not a source's section, so neither has a badge. "Kontaktuppgifter" has the e-mail address and every phone number with its category, and "Anställningar" one item per current employment. Every active person of the organisation who opens the person sees them, a colleague as well as their manager, and each appears only when the directory sent something for it. Then comes one section per source: Clew's own domain first, badged "Clew", then the others by source name. A unit's page has neither of the directory's sections; on a unit the reader manages, Clew's own count of its people stands in the page's details rail. Each section is read on its own. A source that did not answer says so in its own section with "Försök igen" and the rest stand; a source that answered without a row for this entity leaves no section, since no row means "none" or "not allowed". Both pages draw every section at once, one under the other (D112 item 5); `?section=` scrolls to one and gives its heading the focus.

The code: the [entities module](../../apps/server/src/modules/entities/) and its [routes](../../apps/server/src/routes/entities.ts) (`GET /api/entities/:kind`, `/:kind/rows?capability=`, `/:kind/:key`, `/:kind/:key/section?capability=`, `POST /:kind/:key/actions` and `/:kind/:key/effect`, where `:key` is Clew's key), wired in [composition](../../apps/server/src/composition/entities.ts). The registry lists the reads and actions about a kind that a person may call (`aboutReads`, `aboutActions` in [the registry](../../packages/connectors/src/index.ts)).

## Who may be asked about

A core rule per kind, checked on every call that names a person or a unit, whatever path the call came by
([D117](../decisions/D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md)).
`personRelation` and `unitRelation` in [domain.ts](../../apps/server/src/modules/entities/domain.ts) say how the reader
stands to a person or a unit; the opened entity uses them (`resolve` in
[usecases.ts](../../apps/server/src/modules/entities/usecases.ts)), and the registry asks
[relations.ts](../../apps/server/src/modules/entities/relations.ts) before it runs any capability whose input names
someone. Both read where the reader stands from the people directory (`reach`): the units they are placed on, the people
Personal lists on the units they manage, who manages them (`above`) and which co-managers report to them
(`lineReports`), from one read of the tree.

| Kind | Relation | Reached through |
|---|---|---|
| `person` | `self`: the reader | The opened person, and any capability that admits it |
| `person` | `managed`: a direct report under D99 item 4: placed without a manager's role on a unit the reader manages, reporting to it from below (the managers of the nearest led units below it and the people of units nobody leads in between), or leading it beside the reader while their line runs to a unit above it that the reader leads (`lineReports`). Never a co-manager whose line runs elsewhere, never someone who manages the reader (`reportsTo`) | The list's sources, the opened person, and any capability that admits it |
| `person` | `colleague`: any other active person in the reader's organisation, opened by Clew's id and asked about by user name; a co-manager and the reader's own manager among them | The opened person; a source only when it admits `colleague` |
| `unit` | `manages`: a unit the reader holds a manager's role on | The list, the opened unit, and every read about a unit that admits it (all do by default) |
| `unit` | `member`: a unit the reader is placed on otherwise | The list, the opened unit, and a read about a unit that admits `member` |
| `unit` | `below`: a unit whose manager reports to the reader, one level below a unit the reader manages ([D117](../decisions/D117-a-manager-follows-up-the-units-below-and-a-source-is-told-them.md)) | The list, the opened unit, and a read about a unit that admits `below` |

The list of people holds everyone placed on the units the reader manages and those who report from below, one group per unit, as Personal always has; someone who manages nobody gets a list without groups. The sources behind its lenses, columns and marks are asked only about the reports among them, so a co-manager's row carries no source's value. The list of units holds the reader's own units under "Mina enheter" and the units below under "Enheter under dig", and a read about units is asked about all of them, with the units the reader follows up in the signed actor (`units`); the registry leaves out those the read does not admit. A key outside the rule, a source the reader may not call and a kind Clew does not have all answer the same 404 as an unknown address.

**What a source admits.** A capability says in `person.admits` or `unit.admits` which relations it may be asked about under; without it, `self` and `managed`, or `manages`. The registry ([`Registry.run`](../../packages/connectors/src/index.ts), `Registry.validate` before a write is approved, and `Registry.document` for a document's bytes) leaves out of `keys` every key outside what the capability admits, a key the directory does not know and a second spelling of one person, and writes a key that stays as the directory spells it. A single key (`about.param`, `person.param` and the inputs that name a person without declaring it) outside it, or anything but a string there, refuses the call as an unknown capability is refused. The section of a source that does not admit the reader's relation to the opened entity is not asked and has no row, and an action that does not admit it is not offered; the list asks no source that admits no report, and offers on its rows no person's action that does not admit `managed`. Inside the rule a source may still narrow as the person and answer a key it may not show as no row.

**Which inputs name someone.** A read about a person names one in `keys`, an action about one in `about.param`, any other capability in `person.param`. Three more name a person whether they declare it or not, so a forgotten declaration fails closed: the `person` of a `<id>.commitments` read, a property a row of a read about a person fills from its `key` when it opens another read, and an execute's effect read, which admits what its execute admits. The loader holds every one of them to a plain string property of the input (`named.ts`, the rule `named-input-is-a-string`). A core capability of Clew's own domains may add `person.ids`: a person without a user name may then be named by Clew's id, as the reader or a report.

**What the source is told.** Each key sent and its relation: `clew.about` in process, `about` in the request body for a remote connector, which the assertion binds by its digest ([Authorization](../guides/authorization.md#reads-about-a-person-or-a-unit)). A directory that cannot be read is an error (`RelationsUnavailableError`): the call fails, and an approved write waits as `source-unavailable` rather than being revoked. A write's dispatch redeems the resolution its check made just before (`Resolution`), so the directory is never read after the dispatch is recorded. Telling the source, and the binding, are protocol 3; a connector on 2 is held to the rule but told nothing ([protocol reference](../reference/connector-protocol.md#contract-changes)).

## How a source is asked

The rules a figure batch follows ([D75](../decisions/D75-source-snapshots-retain-the-authority-that-produced-them.md)), in `entityUsecases`:

- Only keys inside the rule, and of a relation the read admits, are sent, in calls of at most the read's own `maxItems`, never more than 200.
- One source gets four seconds for all its calls on one request, with at most four calls at once. The first call that fails stops the rest; when the budget ends, what still runs is cancelled through the call's signal.
- Rows are kept only when every call answered, so an absent row means "nothing about this one", never "not asked". A source that failed or ran out of time gives the status `unavailable` or `timeout` and no rows; it never fails the request, and the log line names the capability and the status, never a key or a row.
- A row whose `key` was not asked, or a second row for a key, is dropped. A kept row holds only `key` and the properties its view draws or opens with; `heading` and `note` pass when they are strings.
- The person's authority is checked again after the batch, and the source must still be theirs.
- Nothing is stored.

The list calls only a read an administrator placed as a lens or a column; `/rows` answers 404 for any other. A section may call any read about the kind the reader may call. A read about an entity is never offered to the model: the loader requires `model: false`.

## The administrator's choice

On Administration › Anslutna system, a connector's page has the section "På Personal och andra listor" for each read about a person or a unit with a table or list view: a switch to offer it under "Visa", and "Kolumn på Alla" to choose one field of its view or "Ingen kolumn". The choice is stored in the connector row's capability overrides (`lens: true`, `column: <field key>`) and audited as `connector.lens` and `connector.column`, one row per read that changed ([admin use cases](../../apps/server/src/connectors/usecases/admin.ts)). A choice past three columns for one kind across every connector is refused. Enabling a connector places nothing. For the development stack, `bun run dev:connectors` offers `hr.person`, `talks.person` and `boarding.person` as lenses, and the first two's fields `presence` and `next` as columns, while nobody has chosen ([dev-connectors.ts](../../scripts/dev-connectors.ts)). A source's way in that is a page of its own and no place in the rail (`boarding.person`'s `/boarding/{id}`) takes the page it is drawn on as `from`; a query alone (`?talk={id}`) joins that page's address, and a place in the rail (`/staff?…`) names no way back ([talk-address.ts](../../apps/web/src/talk-address.ts)).

## Cards and subjects

A card row (`ThreadItem.subject`), a search hit (`SearchHit.subject`) and a record of a table, list or detail view (`view.subject`, naming the record property that holds the key) may name one entity, a person by the user name the source knows. A card's rows are keyed when they arrive, from a draft or a refresh ([keys.ts](../../apps/server/src/threads/usecases/keys.ts)): from then on each row that names a person names them by id, or names nobody. A search hit that names a person is keyed the same way, and hits about one person from several sources, whatever case or Unicode composition they spell the name in, become one hit that lists every source ([search domain](../../apps/server/src/modules/search/domain.ts)). A view's records are not stored: `GET /api/cap/:name` and a card's read action answer the view with `view.people`, the user names its records hold mapped to people's ids in the reader's organisation, and the web links a record only through that map. The web links the name to the person's or the unit's page, with the current page as the way back, and to nothing else: a person's name always leads to the person (the app critique of 2026-11-13), so a view row's own read (`view.open`) is a link of its own beside the name, named with the read's title for the row, at the row's end in a list and in a column of its own in a table. A view that names no entity has a title that names the row's own thing, which opens the row's read. The page answers "finns inte" for an entity the reader may not ask about.

A card's rows are keyed again each time the source sends them, so a rename, a reused name or an erasure in Clew's directory rewrites a row to name another person, or nobody. That is no change of the work. A deactivation alone rewrites nothing, since a deactivated person still holds their name. A draft without `occurrences` of its own is revised by Clew's digest of the draft as the source wrote it, its user names included, not of the rows as keyed ([refresh.ts](../../apps/server/src/threads/usecases/refresh.ts)): the rows are rewritten with a `thread.refreshed` row whose `materialChange` is false, the card is not reopened, its snooze holds, nothing is delivered again, and a card that was dismissed or has a receipt stays as it is. A source that changes the user name a row carries has changed the work, and the card comes back. The in-process scan the unit suites use (`scanInto` in [cards.ts](../../apps/server/src/threads/usecases/cards.ts)) rewrites such a row too, and wakes a snoozed card only when something other than the people its rows name has moved.

A card of Clew's own may carry `Thread.subjects` instead: an action point's card is about the employee of the talk without naming them ([D96](../decisions/D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md) item 6). These are never drawn and never read by the model.

The thread store keeps an index from entity to cards by Clew's key, the table `thread_subject` ([migration 0046](../../packages/db/migrations/0046_thread_subjects.sql)), rewritten in the transaction that writes the card's rows. It answers two questions ([subjects.ts](../../apps/server/src/threads/usecases/subjects.ts)):

- "Behöver dig" on the opened entity: the reader's own cards naming it that still ask for them (not waiting on someone else, not set aside under Inte nu, still visible under current authority), the cards that wait for the reader first, then proposals, then information.
- "Just nu" on the list: per person, how many cards wait for the reader ("N att agera på") and how many are proposals ("N förslag"), with the card itself when there is only one, opened beside the list. Several lead to the person's page at "Behöver dig" ([D111](../decisions/D111-where-something-opens-is-decided-by-what-it-is.md), amended 2026-11-11); each card's `kind` (`act`, `proposal`, `fyi`) tells them apart.

The assistant reads the same index when a question names one of the reader's people ([D115](../decisions/D115-the-assistant-resolves-a-person-the-asker-names-and-hands-the-model-the-work-about-them-not-health-rows.md), [people.ts](../../apps/server/src/assistant/people.ts)): the cards whose rows name them are listed to the model by title, last day and buttons and drawn with the answer, and every card about them, an action point's included, is handed to the model by its title alone wherever it appears in the conversation. An action point's card is never listed.

## Actions started as cards

`POST /api/entities/:kind/:key/actions` with `{ capability }` starts an action from the entity's menu without the model ([actions.ts](../../apps/server/src/modules/entities/actions.ts), [started.ts](../../apps/server/src/threads/usecases/started.ts)). The action must be one the opened entity offers the reader. The key goes into its `param`, which the loader requires to be its only required input. For a person the source is sent the user name, while the card keeps the id. A propose runs as the person, and the `ThreadDraft` it answers becomes the card, its rows keyed as they arrive. An execute is never called here: the card's one button is the human decision ([D8](../decisions/D08-every-action-works-without-the-model.md)), and the execute runs after it through the ledger. The card's reason is the person's choice ("Du valde … för …"), not the source's. The same request while the card is open gives the same card. The card, its first message and the `thread.started` audit row, which names the entity by Clew's id, share one transaction. A follower and an execute with a `review` cannot be started this way, and neither can an action whose `about` does not take the opened person in that property: "Åtgärden kan inte startas härifrån.", so no card is made that could not be decided.

A started execute about a person keeps the person's id in its input, and its topic says where: `started:<capability>:<digest>:person:<param>` ([domain.ts](../../apps/server/src/threads/domain.ts)). When the person decides, and in the preview of what it would write, the capability must still take the person in that property; otherwise the decision is refused with "Åtgärden har ändrats sedan ärendet skapades. Inget har skickats." The id is then resolved to the user name the person has now, which goes into the approved payload, and the approval records the subject (`execution.subject`: the property and the person's id), which is part of the approval's digest. A person without a user name, as an erased person is ([D123](../decisions/D123-clew-empties-expired-sign-in-data-itself-and-a-leavers-retention-is-the-organisations-decision.md) item 3), or who is gone, is refused with "Personen finns inte längre i katalogen. Inget har skickats." Before dispatch, and before any replay, the ledger checks that the payload's user name still belongs to that person, compared without regard to case. If it does not, nothing is sent. An execution that was never dispatched settles `failed` with the reason `subject-changed`, and the card's own button decides again under a new decision id, on the user name the person has then. One that was already dispatched, and whose source has no trace of the write, settles `unknown` with that reason instead of being replayed: it keeps its decision id, and the card says that its outcome needs checking in the source system and offers no new decision. A write the source already took is still read back. The web opens the card beside the page the action was started on ([D111](../decisions/D111-where-something-opens-is-decided-by-what-it-is.md) rule 4), and a card under an entity's Behöver dig opens beside that entity's page.

## Erasure

[`scripts/subject-erase.ts`](../../scripts/subject-erase.ts) (`person <person id>` or `unit <unit id>`, with `--confirm`) removes one person or unit from every card in every person's stream: the `subject` of each row that names it, the card's own `subjects` and the index rows, in one transaction with one `thread.subject_erased` audit row that holds counts and names a person by Clew's id, never by the user name. A person is named by their id: an id the people table does not hold, a user name for example, is refused, and so is a person who is still active, since a person is erased only once the source has deactivated them ([D123](../decisions/D123-clew-empties-expired-sign-in-data-itself-and-a-leavers-retention-is-the-organisations-decision.md) item 3); nothing is erased or audited for either. Because the cards keep the id, one erasure reaches every card about the person, whatever user names they have held, and never another person's cards. The rows' text stays as the source wrote it, and a source that still names the entity names it again on its next scan. `competence-erase.ts` also removes the cards the competence scan put in the person's own stream, one `thread.removed` row per card. The [operations runbook](../maintainers/reliability-operations.md#entities-lenses-columns-and-erasure) has the commands.

## What is stored

| Stored | Where |
|---|---|
| The administrator's lenses and columns | The connector row's capability overrides, with their audit rows |
| Which entity a card row names | `thread.items[].subject`, `thread.subjects` and the index `thread_subject` (card, owner, kind, key), by Clew's key |
| That an action was started about an entity | The `thread.started` audit row, by Clew's id; an approved execute about a person also keeps `execution.subject` |
| What a source answered about an entity | Nothing. Every list, lens, column, mark and section asks the source again. |

## Sources in this checkout

| Capability | Source | About | Places it can take |
|---|---|---|---|
| `talks.person` | Clew's talks module ([capabilities.ts](../../apps/server/src/modules/talks/capabilities.ts)) | person | Section, lens, column, marks; the section's way in is the talk, `?talk={id}`, laid over the page it is drawn on (D111 rule 5) |
| `talks.unit` | Clew's talks module | unit | Section on the unit page and column on Dialogstöd; its way in is the lens on Personal |
| `competence.person` | Clew's competence module ([capabilities.ts](../../apps/server/src/modules/competence/capabilities.ts)), proposed in D108 and switched off until an administrator enables it | person | Section, lens, column, a mark for "Utgånget" and "Går ut snart"; the section's way in is the registration form, a query alone (`?register={id}`), so it lies over the page it is drawn on: the person's own page, or Personal from a row's menu |
| `hr.person` | The HR fixture ([manifest](../../connectors/hr/manifest.mjs)) | person | Section, lens, column; no field warns, so no mark |
| `hr.prepareAbsence` | The HR fixture | person | Menu: "Registrera frånvaro", a propose |
| `appraisals.person` | The talks-system fixture ([connector](../../connectors/appraisals/connector.mjs)), registered as a draft | person | Section, lens, column, a mark for "Saknas" |
| `qlik.unit` | The Qlik connector's sick leave ([manifest](../../connectors/qlik/manifest.mjs)) | unit | Section on the unit page and column on Dialogstöd |
| `qlik.economyUnit` | The Qlik connector's economy | unit | Section on the unit page and column on Dialogstöd |
| `qlik.hmeUnit` | The Qlik connector's employee engagement (HME) | unit | Section on the unit page and column on Dialogstöd |
| `servicedesk.person` | The IT service desk fixture ([manifest](../../connectors/servicedesk/manifest.mjs)) | person | Section, lens, column; admits `self` and `managed`; the section's way in is the person's equipment, `servicedesk.equipment` |
| `servicedesk.order` | The IT service desk fixture | person | Menu: "Beställ från IT-servicedesken", an execute that asks what and an optional message, for oneself or a direct report |

A read about a unit is a section on the unit's page and a column on Dialogstöd (`/units`), which asks it about every unit
the reader follows up ([D117](../decisions/D117-a-manager-follows-up-the-units-below-and-a-source-is-told-them.md)).

## Not built

- No source for Introduktion, access cards, or cases per person or unit. Rooms are not an entity kind.
- No calendar action about a person ("Boka möte"): the calendar connector has no propose capability. The calendar's planning card names nobody by subject, so it is not indexed.
- No source in this repository sets `subject` on a search hit (the phone book's people hits carry none), so one hit per entity is covered by tests only and has not been seen on a live stack.
- A read about an entity is never a model tool, and no assistant answer lists rows from two sources.
- The three-column limit is counted outside the transaction that saves the choice, without a lock; two administrators saving at once can pass it. The list still shows at most three.
- Cards stored before migration 0046 name nobody until their rows are next written. Cards and index rows written before D122 (migration 0056) name people by user name and match nobody until their rows are next written, when each name is resolved to the id of whoever holds it then; no migration re-keys them.
- The browser specs run on routed data, including sources the server does not have. No manual screen-reader pass has been made.

[Implementation status](../reference/status.md) lists the evidence; [interface spaces](../reference/interface-spaces.md#a-person-and-a-unit) gives where each surface opens and where it closes to.
