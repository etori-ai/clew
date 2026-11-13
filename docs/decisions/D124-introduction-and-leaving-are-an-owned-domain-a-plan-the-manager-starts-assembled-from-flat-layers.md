# D124 · Introduction and leaving are an owned domain: a plan the manager starts, assembled from flat layers, each item a work item

**Status:** provisional (two statements by the product owner on 2026-11-13, quoted below; everything else is this build's choice; the server side built 2026-11-13 on synthetic data, no page yet; nothing outside the repository has tested it) · **Date:** 2026-11-13 · **Area:** product, people

**Decision.** Introduction and leaving (Swedish in the product: **Introduktion och avslut**; in code `boarding`) is a
domain Clew owns under [D95](D95-clew-may-own-a-domain-by-choice-decided-with-the-core-or-connector-checklist.md): a
module `apps/server/src/modules/boarding/` with its own tables (migration 0067) and the checklist block of
[Core or connector](../maintainers/core-or-connector.md) Part 5, built from the commitment block talks built
([D96](D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md)).

The product owner decided on 2026-11-13: onboarding and offboarding should be a core feature of Clew, built as core if
possible; and a plan is started by the manager: Clew suggests it, nothing starts from directory dates, and a leaver's
last day is entered by the manager. Every other item below is this build's choice.

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
     title, and an optional `tiedTo` text (a capability's name or a link) that later phases will use.
   - In this decision every kind behaves as a plain to-do: nothing is ordered from a service desk, booked in a
     calendar or checked against competence.
4. **Owners.** `manager` is the manager who starts the plan; `person` is the one the plan is about, before they can
   sign in too; `buddy` is the buddy the manager chose among their other reports, or the manager when none is chosen.
   An item's due day is the plan's day plus its offset.
5. **Every open item is a work item in its owner's stream.** In the same transaction as the item (the pattern of D96
   item 5): a pushed card with the due day as its deadline, the plan's person as its subject by user name (D97 item 6),
   one read that opens the plan, and a timer of its own kind, `boarding`, that brings the card back the morning after
   the due day while the item and its plan are open. Ticking the item off closes the card; ticking it back opens it;
   closing the plan closes every open card. A card for someone who cannot sign in yet waits in their stream.
6. **Text.** A template title is text an administrator wrote, names nobody, and is the card's title. A title a manager
   types for one plan is free text about a named person's plan: sealed at rest (purpose `boarding:item:<id>`) as
   approved execution input is, and never in an audit row, a log line, a card's title, summary or message, or a trace;
   its card says "En uppgift i en introduktion" (or "… i ett avslut"). Audit rows carry ids, dates, counts and roles.
7. **Who may do what.**
   - Start, preview and add an item: the manager the person reports to now, D117's `managed` (`reportsByUnit` over the
     people module's reach), never a co-manager whose line runs elsewhere nor the manager's own manager.
   - Read a plan: the person it is about; its manager, who is whoever the person reports to now, or, once the person
     is deactivated and so reports to nobody, the manager who started it; and an owner of some of its items (a buddy,
     a former manager), who reads those items only. Anyone else is told the plan does not exist.
   - Tick an item off or back: its owner, or the plan's manager. Close a plan: its manager. A closed plan is read-only.
8. **Clew suggests, the manager starts.** A report whose employment starts after today and within six weeks, with no
   introduction that covers that start (an open one, or one anchored at most 90 days before it or later), is suggested:
   one card per person and start in the manager's stream ("Förbered introduktionen", no name in its title, summary or
   reason; the person as its row's subject), a complete observation of the manager's reports at each scan, so a card
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

**The checklist's Part 3.** [Core or connector](../maintainers/core-or-connector.md):

| Question | Answer |
|---|---|
| 1. It removes something | The onboarding checklists of an HR system, and the spreadsheet, mail thread and paper list a manager keeps for a new hire or a leaver. What a pilot organisation uses today is unconfirmed |
| 2. The same everywhere | Yes. What differs is data: the layers, their conditions and their items |
| 3. Work between people who use Clew | Yes. Every open item is a work item in its owner's stream, the new hire's included |
| 4. Small | Yes, by item 3's rules: the commitment block made a checklist (Part 5), one new timer kind, flat layers. A rules engine, branches or forms would fail this question, which is why they need a new decision |
| 5. Works with the model off | Yes. No read is a model tool and no text reaches a model |
| 6. Clew can carry it | **Open.** Not answered: how long a plan is kept after it is closed or the person leaves, whether it is archived, the secrecy rule, and who may read a plan after the manager changes beyond item 7. Built: erasure of one person and the export; a plan is keyed on the person and goes with them; a typed title is sealed; the manager reads content, an item owner reads their own items |
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

Alternatives weighed. Starting a plan from the directory's start date or a deactivation: rejected by the product owner
(above). Conditions, dependencies or approvals per item: rejected by question 4, and they are what makes an HR system's
onboarding a workflow engine. One template per unit: rejected, every unit would copy the everyone list. Matching a unit
exactly, as competence's requirements do: rejected, a layer for an administration must reach its teams. A buddy chosen
from anyone in the organisation: rejected for the manager's own reports, whom the manager may give work. A suggestion
for a leaving: rejected, the last day is the manager's to enter. Storing the employment's start date on the plan:
rejected by D68; the date is copied into the plan only when the manager confirms it as the plan's day.

**Built 2026-11-13, server side.** The tables `boarding_layer`, `boarding_layer_item`, `boarding_plan` and
`boarding_item`; the module (`model.ts`, `domain.ts`, `usecases.ts`, `capabilities.ts`, a memory and a Postgres adapter
under one store contract); the cards in `composition/boarding-work-items.ts` and the timer kind `boarding` fired by
`fireTimer`; the routes; the capability `admin.boarding`; the parser `packages/contracts/src/boarding-import.ts`; the
operator scripts and the development seed (`scripts/boarding-seed.ts`, data in `scripts/boarding-development.ts`); a
person in the synthetic directory whose employment starts three weeks after the provisioner runs. Not built: every
page (the plan's page, the start dialog, the administrator's import page), the a11y specs, and anything item 3 holds
back. Nothing specific to leaving beyond the event exists: no return list, no hook on a leaver, no retention sweep.

**Not established.** The answers to questions 6 and 11. Whether matching on the free-text employment type is
acceptable (the directory has no concept of a consultant). Where a new hire finds their plan besides Hem and Att göra.
Whether an `order` item should close by itself when a service desk closes the request
([D123](D123-requests-are-a-profile-of-their-own-apart-from-the-errands-a-person-handles.md)). [D122](D122-the-assistant-may-read-and-propose-whatever-the-person-who-asks-may-and-adding-a-model-is-answering-for-it.md)
item 3 opens Clew's own domains to the assistant; this build keeps both reads closed (`model: false`), since a title
a manager typed is free text about a person, until that opening reaches this domain. When a person has two open plans
(an introduction and a leaving), `boarding.person` answers with the one started last. No signed-in pass and no
screen-reader pass.

**Replaces.** Nothing. Adds `admin.boarding` to [D85](D85-capabilities-are-mapped-from-provisioned-groups-in-clew.md)'s
closed list and the timer kind `boarding` beside D96's `due`.
