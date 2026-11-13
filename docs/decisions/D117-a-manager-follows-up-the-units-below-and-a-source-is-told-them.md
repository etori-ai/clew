# D117 · A manager follows up the units of the managers who report to them, and a source is told those units

**Status:** provisional (Oliver Borgström, 2026-11-13; built on the branch `dialogue-reach`, tested by nothing outside the repository; item 3's overview is a new page, built as an exception to the freeze on new surface, D101, at Oliver Borgström's choice) · **Date:** 2026-11-13 · **Area:** product, integrations

**Decision.** The follow-up of the dialogue support (Dialogstöd) reaches one level down the organisation tree that SCIM
pushes ([D99](D99-units-form-a-tree-pushed-over-scim-and-a-manager-works-with-their-direct-reports.md)): a manager
follows up their own units and the units led by the managers who report to them, D99's reporting line. Clew opens
those units to them and tells a connector which units they are.

1. **The units below.** For a manager, the units below are the units whose managers are in the reader's reporting line
   (Personal's "rapporterar hit" rows, D99): the nearest unit below each unit they manage that has a manager, passing
   through units nobody leads. One level, never the whole branch; a function that wants the branch still needs its own
   decision (D99).
2. **The unit's page opens for them.** `/units/<id>` resolves a unit below with the relation `below`; its page says
   "Enhetens chef rapporterar till dig" as the reader's role. A unit the reader manages lists the units below it in the
   facts rail, "Enheter under", each a link to its page with the unit as the way back. The list of units
   (`GET /api/entities/unit`) has them as a second group, "Enheter under dig". Nothing upward opens: a rektor does not
   open the unit of their own manager.
3. **Dialogstöd is an overview first.** `/units`, the entry under Start (amends
   [D116](D116-start-and-the-row-under-it-are-clews.md) item 1), lists the units the reader follows up side by side in
   the list's two groups, "Mina enheter" and "Enheter under dig": one row per unit, one column per source about a unit
   (the key figures and the round of talks), each cell the source's row in short, its title value and the state the view
   gives a tone ("7,3 %" and "Bevaka"). A unit's name opens its page. This is big-boss-board's start page, and the one
   new page of this record: built as an exception to the freeze on new surface
   ([D101](D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md)) at Oliver
   Borgström's choice, after a page that opened the reader's own unit first was found to give no overview. Because every
   unit page's address starts with `/units`, the entry stays marked on each of them.
4. **Moving between them.** Above a unit's name a trail, Astryx's `Breadcrumbs`: Dialogstöd, for a unit below the reader
   the way up to their own unit it reports to, then the unit itself as a menu (`BreadcrumbItem`'s `menu`) of every other
   unit they follow up in the list's two groups, each a link. A reader who follows up one unit has no trail. Astryx's
   `Selector` was weighed and left: its guidance is that it is not for navigation, and a link should be a link.
5. **A source is told the units.** The actor Clew signs to a connector gains an optional `units`: the units the person
   follows up, their own and those below, each with its id and name. It is set on a read about units for the unit's page
   and on a view the page opens (`GET /api/cap/:name`), where Clew has read the reporting line for the request; on other
   calls it is absent and a connector knows `unitId` alone, as before. A connector answers for these units and refuses
   every other, as the connector check already requires of a read about units.
6. **The Qlik connector** answers its tables, charts and reads about a unit for every unit in `units` (with a map, the
   source units the map names for each), names them as Clew sent them in open mode, and keeps refusing the rest.
7. **A development persona one level up.** Ingrid Holm leads Grundskola, the unit above the schools, so the rektorer
   (Hillevi among them) report to her and the follow-up can be tried signed in. She takes Grundskola's one generated
   seat, so the directory keeps its two hundred and fifty people.

**Why.** Oliver Borgström, 2026-11-13: the roles and the organisation tree are on `main` through SCIM, so the follow-up
can use them. Big-boss-board lets a manager go through the key figures of the level below with each manager in turn
([the plan](../reviews/2026-11-12-absorbing-big-boss-board-into-clew.md), decision B item 4), and D99's reporting line
is that level.

Weighed and left: the whole branch below, which D99 keeps to a decision of its own; telling every connector call the
units, which would read the reporting line on every request (the figure on Hem stays the reader's own unit); trusting
Clew's keys in the connector without a list it can check, which the connector check refuses.

**Not established.** Whether a person who follows up a unit may see each figure about it is the source's and the
organisation's rule (who may see sick leave per unit is open, the plan's questions). The dialogue itself (questions,
assessments, activities) is not built and still waits for the freeze to lift.

**Builds on** D99 (the tree and the reporting line), D97 (entities and reads about a unit), D44 (the signed actor).
