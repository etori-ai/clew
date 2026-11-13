# D124 · Introduction and leaving are an owned domain: a plan the manager starts, assembled from flat layers, each item a work item

**Status:** provisional (two statements by the product owner on 2026-11-13, paraphrased below, and their request the same day for a row in the rail, item 12; everything else is this build's choice; the server side and its pages built 2026-11-13 on synthetic data, and amended the same day after an independent review; nothing outside the repository has tested it) · **Date:** 2026-11-13 · **Area:** product, people

**Decision.** Introduction and leaving (Swedish in the product: **Introduktion och avslut**; in code `boarding`) is a
domain Clew owns under [D95](D95-clew-may-own-a-domain-by-choice-decided-with-the-core-or-connector-checklist.md): a
module `apps/server/src/modules/boarding/` with its own tables (migrations 0071 and 0072) and the checklist block of
[Core or connector](../maintainers/core-or-connector.md) Part 5, built from the commitment block talks built
([D96](D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md)).

The product owner decided on 2026-11-13, in substance (paraphrased, not quoted): onboarding and offboarding should be a
core feature of Clew, built as core if possible; and a plan is started by the manager, nothing starts from directory
dates, and the manager enters a leaver's last day. They chose "the manager starts it" from an option whose description
said that Clew suggests it with a work item and the manager confirms. Later the same day they asked for an item in the
sidebar (item 12). Every other item below, and whom that row is for and what its page holds, is this build's choice.

1. **A plan.** A checklist about one person for one event: `introduction`, anchored on a first day, or `leaving`,
   anchored on a last day. The day is the plan's own data, entered or confirmed by the manager; Clew holds no validity
   dates from the directory ([D68](D68-people-are-pushed-into-clew-through-standard-scim.md) item 4,
   [D109](D109-a-provisioner-sends-a-change-when-it-happens-and-reconciles-the-whole-source-daily.md) item 4). An
   employment's `startDate` ([D114](D114-person-profiles-show-employments-and-categorised-phone-numbers.md)) only
   prefills a suggestion. A day more than a year from today either way is refused as a typing error. At most one open
   plan per person and event.
2. **Layers.** A plan is assembled from layers an administrator imports: flat lists of template items, each layer for
   one event and one condition: everyone (`all`); a unit and every unit below it in the tree (`unit`, matched by walking
   upwards from each unit the person is assigned to, so a layer on an administration reaches a team two levels
   below); a position by its code (`position`, as competence's requirements match); or an employment type exactly as
   the directory writes it (`employment_type`). A nurse and a developer share the everyone layer and differ in the
   rest. The items of every layer that applies are copied into the plan, flat, ordered by due day, then by the layers'
   order (everyone, unit, position, employment type, each by name) and each item's place in its layer. Nothing is
   merged: the same item in two layers is two items.
3. **What keeps it small, and may not grow without a new decision.**
   - A layer is a flat list: no branches, no dependencies between items, no condition per item, no approvals, no forms.
   - An item has a kind from a closed set (`todo`, `order`, `meeting`, `course`, `acknowledge`), an owner role
     (`manager`, `person`, `buddy`), an offset in whole days from the plan's day (negative before it, -365 to 365), a
     title, and an optional `tiedTo`: what the item is done with, one of a capability's name (`<connector>.<name>`,
     with optional preset answers after a `?`, `servicedesk.order?item=laptop`) or an absolute `https://` address
     (`boardingTieOf` in `packages/contracts/src/boarding-import.ts`, the rule the page and the import both apply; any
     other text is a problem with its row).
   - The plan holds the item, never what it is done with: no order, booking or inventory is stored with a plan, no
     item is generated from one, and nothing ticks an item by itself. An item's row opens what it is tied to for a
     reader who may tick it: an action about the person the reader may start for them (those the person's page offers
     the reader, `GET /api/entities/person/:key`) is a button that starts it on the person's page's own path, its work
     item beside the plan with the action dialog over it and the preset answers chosen and changeable, nothing sent
     before its last button and nothing ticked by it; a read the reader may open is a link to its page with the person
     as its input where it takes one (D116), and such a read only where it admits how the reader stands to the person
     ([D117](D117-the-core-decides-who-a-source-may-be-asked-about-on-every-call-and-signs-the-relation.md): its `admits` against the relation the
     person's page answers, a buddy being a colleague), named for someone else as the person's page names its way into
     it ("Kompetenser", not the reader's own "Mina kompetenser"); an https address is a link out in a new tab (rule 10
     of the interface reference), named with the item's title. Anything else opens nothing, and a done item starts no
     action but keeps a read's or an address's link.
     The kinds have no behaviour of their own: `meeting` books nothing in a calendar, `course` checks nothing against
     competence, and an `order` is ordered only by the tied action the reader starts.
4. **Owners.** `manager` is the manager who starts the plan; `person` is the one the plan is about, before they can
   sign in too; `buddy` is the buddy the manager chose among their other reports, or the manager when none is chosen.
   An item's due day is the plan's day plus its offset.
5. **Every open item is a work item in its owner's stream.** In the same transaction as the item (the pattern of D96
   item 5): a pushed card with the due day as its deadline, the plan's person as its subject by user name (D97 item 6),
   one read that opens the plan, and a timer of its own kind, `boarding`, that brings the card back the morning after
   the due day while the item and its plan are open. Ticking the item off closes the card; ticking it back opens it;
   closing the plan closes every open card. A card for someone who cannot sign in yet waits in their stream. A due day
   whose next morning has already passed (a plan started late, an overdue item ticked back) gets no timer: the card is
   simply open and overdue, so a late start sends no burst of reminders, one per item, outside the attention budget. A
   timer that fires while the module is switched off for the installation is dropped: no card comes back and no
   delivery or audit row is written; the card stays as it was, open and overdue unless its owner put it away, and gets a
   timer again only when the item is ticked back.
6. **Text.** A template title is text an administrator wrote, names nobody, and is the card's title. A title a manager
   types for one plan is free text about a named person's plan: sealed at rest (purpose `boarding:item:<id>`) as
   approved execution input is, and never in an audit row, a log line, a card's title, summary or message, or a trace;
   its card says "En uppgift i en introduktion" (or "… i ett avslut"). An item a manager adds ties to nothing: `tiedTo`
   is an administrator's, on a layer's item, and a body that carries one is refused. Audit rows carry ids, dates,
   counts and roles.
7. **Who may do what.** All of it this build's choice, the deactivation rule amended after review the same day.
   - Start and preview: the manager the person reports to now, D117's `managed` (`reportsByUnit` over the people
     module's reach), never a co-manager whose line runs elsewhere nor the manager's own manager.
   - The plan's manager is whoever the person reports to now. **Once the directory deactivates the person**, the plan is
     held by the manager or managers they reported to at that moment: the people module's leavers port tells boarding
     in the transaction that deactivates them (`boardingLeavers`, bound beside competence's in `composition/people.ts`,
     each domain in a savepoint of its own so one failing never stops the other or the deactivation, D113), and
     boarding records the holders on every plan of the person, read from the directory in that transaction (D99's line:
     up from each unit they are on to the nearest one somebody active leads). Activated again, nobody holds the plans
     and the line decides as before. The call is best effort: when nothing was recorded, the manager who started a plan
     holds it. A manager who started a plan and is not its holder gets nothing beyond what an item owner gets.
   - Read a plan: the person it is about; its manager; and an owner of some of its items (a buddy, a former manager),
     who reads those items only, and the counts and the note over those alone. Anyone else, another organisation's
     manager included, is told the plan does not exist. What an item is tied to (`tiedTo`) is sent only on an item the
     reader may tick: a capability's name says a connector exists, which the person reading the manager's items may be
     outside the audience of (D23).
   - Add an item and close a plan: the plan's manager, by the same rule. Tick an item off or back: its owner, or the
     plan's manager. A closed plan is read-only.
   - An item whose owner is gone (erased, or their row deleted) belongs to the plan's manager role: the manager may
     tick it, it is shown as theirs and counted among what waits for them; the erasure opens no card for it.
8. **Clew suggests, the manager starts.** A report whose employment starts after today and within six weeks, with no
   introduction that covers that start (an open one, or one anchored at most 90 days before it or later), is suggested:
   one card per person and start in the manager's stream ("Förbered introduktionen"; no name in its title, summary,
   reason or row, whose label is "Ny medarbetare", vision principle 7; the person only as the row's subject and the
   read's input, by user name), a complete observation of the manager's reports at each scan, so a card
   whose cause is gone is resolved. Nothing starts from the date. A leaving is never suggested: the manager enters the
   last day.
9. **The seam.** A connector of kind `core`, id `boarding`, source "Clew", bundled and created switched off
   (`offAtFirstBoot`, as competence is, D108 item 13), with one area, "Introduktion och avslut". Two reads, neither a
   model tool: `boarding.person` about a person (D97: a section on the person's page and a lens on Personal, admitting
   `managed` only, its way in the plan's page `/boarding/{id}`), and `boarding.plan`, one plan by its id, whose access
   the use case checks since a plan id names no person the registry resolves (as competence's approval read). The
   domain's writes are Clew's own routes under `/api/boarding`, refused while the module is off for the person; none is
   a capability, an execution in the ledger or a tool (D95, D96).
10. **Layers are imported, and the capability is `admin.boarding`.** An administrator with the new grant capability
    `admin.boarding` (D85's closed list) imports a CSV file, one row per item with its layer's name, event, condition
    and value (the format is the header of `packages/contracts/src/boarding-import.ts`). The page and the server read it
    with the same pure parser; the server checks every row again and refuses the whole file with the first problem's row
    number. An import replaces a layer by its event and name without regard to case when anything of it differs and
    leaves it alone when nothing does, so the same file twice changes nothing; plans already started keep their items.
11. **Erasure and export** are use cases with scenario tests from this slice, reached by operator scripts
    (`scripts/boarding-erase.ts --confirm`, `scripts/boarding-export.ts`): erasing a person removes every plan about them
    with its items and cards, the cards of the items they own in other plans, and their id on other people's plans; the
    export is one versioned JSON document, `clew.boarding/1`, typed titles opened.
12. **A row in the rail, and a list that is a page.** The product owner asked on 2026-11-13 for an item in the sidebar;
    the rest of this item is this build's choice. The rail draws "Introduktion och avslut" among the places, after
    Kompetens, while the module is switched on and visible to the reader (the signal of item 9 and of its row under
    Administration) and only where it applies to them, which the server says in one read: `GET /api/boarding/plans`
    answers the open plans the reader manages or holds (item 7), the open plans about the reader themself apart from
    them (`own`), and whether the reader manages a unit now (`manages`, D99's line). For a manager, or someone holding a
    plan to manage, the row leads to the list `/boarding`; for someone with an open plan about themself and nothing to
    manage, a new hire or a leaver, straight to their own plan's page; for anyone else there is no row. No capability
    is added: the read is behind the module's switch and its use case's own reach. The list is a page of its own
    ([D116](D116-a-panel-is-a-peek-at-one-thing-a-list-is-a-page-and-every-view-has-an-address.md)): the reader's own
    open plans apart and above; while any wait, the reports item 8 suggests an introduction for, each with
    "Starta introduktion", the start dialog over that person's page; and the open plans the reader manages, nearest day
    first, each row the person's name as the link to the plan, the event, its day, how many items are done and a badge
    where any is late, facts only. A plan opened from it has the list as its way back. Closed plans are on no list; the
    person's page still lists them.

**The checklist's Part 3.** [Core or connector](../maintainers/core-or-connector.md):

| Question | Answer |
|---|---|
| 1. It removes something | The onboarding checklists of an HR system, and the spreadsheet, mail thread and paper list a manager keeps for a new hire or a leaver. What a pilot organisation uses today is unconfirmed |
| 2. The same everywhere | Yes. What differs is data: the layers, their conditions and their items |
| 3. Work between people who use Clew | Yes. Every open item is a work item in its owner's stream, the new hire's included |
| 4. Small | Yes, by item 3's rules: the commitment block made a checklist (Part 5), one new timer kind, flat layers. A rules engine, branches or forms would fail this question, which is why they need a new decision |
| 5. Works with the model off | Yes. No read is a model tool, no card names the person or carries a typed title, and no text reaches a model |
| 6. Clew can carry it | **Open.** Not answered: how long a plan is kept after it is closed or the person leaves, whether it is archived, and the secrecy rule. Built: erasure of one person and the export; a plan is keyed on the person and goes with them; a typed title is sealed; the manager reads content, an item owner reads their own items; after a deactivation the manager the person had then holds the plan (item 7) |
| 7. Everything that reads it today still can | Nothing reads it: checked against this repository only |
| 8. A way in and a way out | In: starting empty is acceptable, and the layers are imported from a file. Out: the export |
| 9. Behind capabilities | Yes, item 9 |
| 10. An installation can choose | Yes: the module is off until an administrator switches it on, and nothing else depends on it |
| 11. Reviewed by someone who knows the domain | **Open.** No HR practitioner has seen it |
| 12. The team accepts being its vendor | The product owner asked for it as core on 2026-11-13. Support beyond the lab phase is not established |

D95 item 3 requires the answers to question 6 before real data is entered: until questions 6 and 11 are answered this
domain runs on the development stack's synthetic directory only.

**Why.** [Core or connector](../maintainers/core-or-connector.md) names onboarding and offboarding core on 2026-11-10,
and Part 4 puts it next after talks: its commitment block is built (D96's action point with its card and timer), the
record is light (a checklist, not notes), it serves every manager and every new hire, and it is the event that starts
the retention clock of other domains. Layers rather than one template per unit: what differs between a nurse and a
developer is a few items, and an organisation keeps one everyone list instead of copying it into every unit's.

Alternatives weighed. Starting a plan from the directory's dates: the product owner's decision (above); starting a
leaving from a deactivation follows from it and is this build's reading. Leaving a deactivated person's plan with the
manager who started it (the first build): rejected on review, since a manager from years ago would regain the whole
plan the day the person left, and the manager they had at the end would lose it. Conditions, dependencies or approvals per item: rejected by question 4, and they are what makes an HR system's
onboarding a workflow engine. One template per unit: rejected, every unit would copy the everyone list. Matching a unit
exactly, as competence's requirements do: rejected, a layer for an administration must reach its teams. A buddy chosen
from anyone in the organisation: rejected for the manager's own reports, whom the manager may give work. A suggestion
for a leaving: rejected, the last day is the manager's to enter. Storing the employment's start date on the plan:
rejected by D68; the date is copied into the plan only when the manager confirms it as the plan's day.

**Built 2026-11-13, server side.** The tables `boarding_layer`, `boarding_layer_item`, `boarding_plan` and
`boarding_item`, and (migration 0072, after review) `boarding_plan_holder` with `boarding_plan.held_at`; the module (`model.ts`, `domain.ts`, `usecases.ts`, `capabilities.ts`, a memory and a Postgres adapter
under one store contract); the cards in `composition/boarding-work-items.ts` and the timer kind `boarding` fired by
`fireTimer`; the routes; the capability `admin.boarding`; the parser `packages/contracts/src/boarding-import.ts`; the
operator scripts and the development seed (`scripts/boarding-seed.ts`, data in `scripts/boarding-development.ts`); a
person in the synthetic directory whose employment starts three weeks after the provisioner runs. Not built on the
server: anything item 3 holds back. Nothing specific to leaving beyond the event exists: no return list, no hook on a
leaver, no retention sweep.

**Built 2026-11-13, web side.** One person's plans as a page, `/boarding/<personId>` with `?plan=` (the detail shape of
a person's page: the plan's day, progress and counts in the header, a section per phase, each item a checkbox named by
its title for a reader who may tick it, the facts and "Tillhör" in the rail), reached from `boarding.person`'s way in
with the page it was drawn on as `from`, and from the pages of both reads (an item's card, the suggestion's card), which
lead there. "Lägg till punkt" and "Avsluta planen" (Astryx's confirmation) for the plan's manager; an owner who is
neither manager nor person told they see their own items; with no plan, "Starta introduktion" and "Starta avslut" for
the manager and "Planen finns inte" for anyone else. The start dialog over the page (`?start=`), the action dialog's two
steps over `POST /api/boarding/preview`. Administration › Introduktion och avslut, the layers read only, and its import
page, which reads a file with the server's parser and sends only a whole file without problems. The browser specs on a
mock (`tests/a11y/boarding.spec.ts`, `boarding-start.spec.ts`, `admin-boarding.spec.ts`), and `boarding.person` among the
development stack's lenses with the seed run by `bun run dev:connectors`. Not built: editing a layer in the product, the canvas's order dialog and one layer's page, the groups the canvas draws for a
leaving (return, access, handover), "Planen är byggd av" (the plan's output does not name an item's layer), and "Fråga Clew"
on the plan's page (nothing of a plan reaches a model).

**Amended 2026-11-13 after an independent review.** Item 7's deactivation rule (above), the counts an item owner is
told, an item whose owner is gone, and the leavers binding for two domains; item 5's past due days and switched-off
timers; item 6's `tiedTo` on an added item; item 8's neutral row. Also: a layer on a unit carries the unit's name
(`unitLabel`) in the preview and the administrator's list; a file's rows of only delimiters are skipped with their
numbers kept; the import route takes any file the limits allow, its bound computed from them; and every transaction
locks a plan before its items, its items before their cards.

**Built 2026-11-13, what an item is done with.** Item 3's `tiedTo` read by one pure rule shared by the import and the
page (`boardingTieOf`); a file that names anything else is refused with the row's number. The plan's page draws each
row's control from it (`rowControl` in `apps/web/src/boarding.ts`): an action starts through the person's page's own
start (`useEntityAction` in `apps/web/src/entity-actions.ts`, which takes the preset answers into the action dialog and
keeps what is typed per start and preset, `askDraftKey`, so one row's answers never fill another's), a
read leads to its page with the person in the input property its view entry names (`ViewEntry.person`, the read's
`person.param`, added to `GET /api/areas`) where the relations beside it admit the reader (`ViewEntry.admits`, read
against `EntityDetail.relation` and a relation held by grant), an address leaves in a new tab. The development layers tie their orders to
the IT service desk's `servicedesk.order` with the catalogue's item, the return of equipment to `servicedesk.equipment`
and one reading to a made-up page on `example.org`. Not built: a booking from a `meeting` item, a check of a `course`
item against competence, and an item that closes when what it was done with is done.

**Built 2026-11-13, the place in the rail.** Item 12: `GET /api/boarding/plans` answers `own` and `manages` beside
`rows`, with a scenario test of whom each reader is answered; the rail's row (`useRail`, drawn from that read once it
has answered, so it never leads somewhere and then moves); the list `/boarding` (`apps/web/src/pages/boarding-list.tsx`,
Astryx's card with a toolbar over a `Table` where its columns fit beside the rail, else a `List`, as Personal and
Kompetens draw theirs); the plan's way back to it and the rail's mark on a plan opened from it, and on the reader's own
plan; the browser spec `tests/a11y/boarding-list.spec.ts`.

**Not established.** The answers to questions 6 and 11. Whether matching on the free-text employment type is
acceptable (the directory has no concept of a consultant). Whether the row of item 12 is drawn for the right people and
leads where they expect: the product owner asked for the row, not for its conditions or the list's contents.
Whether an `order` item should close by itself when a service desk closes the request
([D123](D123-requests-are-a-profile-of-their-own-apart-from-the-errands-a-person-handles.md)). [D122](D122-the-assistant-may-read-and-propose-whatever-the-person-who-asks-may-and-adding-a-model-is-answering-for-it.md)
item 3 opens Clew's own domains to the assistant; this build keeps both reads closed (`model: false`), since a title
a manager typed is free text about a person, until that opening reaches this domain. When a person has two open plans
(an introduction and a leaving), `boarding.person` answers with the one started last. No signed-in pass and no
screen-reader pass.

**Replaces.** Nothing. Adds `admin.boarding` to [D85](D85-capabilities-are-mapped-from-provisioned-groups-in-clew.md)'s
closed list and the timer kind `boarding` beside D96's `due`.
