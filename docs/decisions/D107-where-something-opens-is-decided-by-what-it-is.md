# D107 · Where something opens is decided by what it is, never by the page it was clicked on

**Status:** provisional (accepted when the rules have been used by people outside the repository: a manager on Personal and one connector author placing a view and a card from the author's page alone) · **Date:** 2026-11-11 · **Area:** ui

**Decision.** Eight rules place everything a person opens in Clew. They refine
[D83](D83-interface-spaces-have-stable-navigation-roles.md), whose spaces stand; what changes is that the space no
longer depends on the page the control was on.

1. **Only choosing a place changes the page.** The rail, and a name that leads to a person or a unit.
2. **What is opened from a page opens beside that page.** Every page has the panel, not only Hem: Kalender,
   Administration, a person's and a unit's page included. A card from the bell, a toast or the rail's search opens
   beside the page the person is on. Closing puts the page back exactly as it was. In a narrow window the panel is
   drawn over the page, on a phone as a sheet: the same thing, the same way back.
3. **A person and a unit are pages, shown one way.** Cards about them open beside their page. No person beside a
   list.
4. **Starting something never moves the person.** An action about a person or a unit makes a card, and the card
   opens beside the page where it was started.
5. **Focused work lies over the page it was started on.** "Granska N" and one person's utvecklingssamtal open over
   whichever page they were opened from and close to what was under them.
6. **Opening is not asking.** A card goes into the question box only with "Lägg till i samtalet", which is offered
   only where the page has a box. Asking opens the conversation with what the person was looking at beside it, and
   closing it returns them.
7. **No control chooses a surface.** No "Öppna som sida", no "Visa bredvid". The window's width decides how the
   panel is drawn, never where the person ends up.
8. **Out of Clew is a new tab, every time, and marked as leaving.** The shared header's places are the one
   exception: they cross sites in the same tab ([D88](D88-the-web-app-draws-the-shared-header-and-an-administrator-owns-its-content.md)).

The product owner answered the seven choices of the
[review](../reviews/2026-11-11-navigation-where-things-open.md#choices-that-are-the-product-owners) on 2026-11-11:

| # | Choice | Answer |
|---|---|---|
| 1 | A person as a page, or beside a list | A page only. `?person=`, the compact list and the phone's drill-in on Personal go. |
| 2 | The panel on every page | Yes, every page. Nothing opened from a page lands on Hem. |
| 3 | A card opened on Hem is put in the question box as "Om kortet" | It stops. |
| 4 | "Lägg till i samtalet" where the page has no box | Hidden there. |
| 5 | "Öppna som sida" on a view beside Hem | Removed. The tool stays in the rail when an administrator put it there. |
| 6 | "N att agera på" on Personal when it counts several cards | Those cards as a list beside Personal; one of them opens over the list. The review proposed the person's page at "Behöver dig"; the owner chose the list beside, so the count never leaves Personal. |
| 7 | The freeze on new surface ([D101](D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md)) | The work restructures what exists and all ten items of the review may be built, a unit's actions on the unit's page included. |

For a connector author the rules are one table with no column for the page: a read's view and a card open beside
the page; a row's own view takes the list's place there; a name leads to the person's or unit's page; a card's read
lies over the card; a decision runs on the card; a review lies over the page; an entity read is a section of the
entity's page; an entity action makes a card beside the page; a link out is a new tab.

The rules are built in the order of the review's list, one change per item, and each change amends the page it
makes untrue. Until the last one lands, [interface spaces](../reference/interface-spaces.md) and
[the people status page](../reference/status/people.md) say what the code does; this record says where it is going.

**Why.** On 2026-11-11 the product owner followed four ordinary links on Personal and each one surprised them: a
count that started the work on Hem, a name that opened a panel with the page as a link inside it, a menu choice of
where to show a person, and a card on a person's page that led to Hem again. The review's inventory showed the
cause: Hem was the only page that could hold everything, so seven kinds of control ended there from other pages,
and the same card, row or talk opened differently by where it was clicked. Patching one link at a time had been
tried the same day and produced "Visa bredvid", which was removed within the hour. A rule keyed on the kind of
thing is the only one an end user can predict and a connector author can be told in one table. The canvas "Clew
navigation map" ([design canvases](../reference/design-canvases.md)) draws today's placements, the rules and the
author's table.

**Replaces.** In [D50](D50-the-conversation-is-the-column-and-the-panel-holds-what-it-is-about.md): the box asking
about the open card by opening it, and "Öppna som sida" on a view in the panel (with
[D42](D42-a-tool-opens-as-a-page.md)'s promotion link). In
[D73](D73-the-review-is-a-page-in-the-shell-with-an-address.md): the review as a drawer over Hem only. In
[D97](D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md) item 5 and its amendments of 2026-11-11:
the person beside the list, and an action about a person leading to Hem. In
[D83](D83-interface-spaces-have-stable-navigation-roles.md) rule 1: the explicit "Öppna som sida" promotion. Each of
those records is amended in the change that builds the rule.
