# D110 · Where something opens is decided by what it is, never by the page it was clicked on

**Status:** provisional (accepted when the rules have been used by people outside the repository: a manager on Personal and one connector author placing a view and a card from the author's page alone); rule 7 ("no control chooses a surface") and the panel's header replaced by [D111](D111-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) (2026-11-11: "Öppna som sida" is back and the panel holds the thing with the conversation about it); rules 1, 4, 6 and 8 stand, and rule 2 stands with D111's panel · **Date:** 2026-11-11 · **Area:** ui

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

**Amended 2026-11-11, after the first four changes were seen live.** The product owner looked at stages 1 to 5 in one
window about 1900 px wide and found "multiple different sidebars": a card stood beside Hem under a small "Kort", the same
card was a modal drawer over Personal under a large "Kort" (Personal's panel stood beside only where its whole table
fit, about 1780 px), and "2 att agera på" listed cards in the drawer, where a card and then its own read each replaced
the one before with only ✕ leading back. Their five answers:

1. **One panel, one width, every page.** The panel stands beside the page from one window width on every page that
   holds it: Hem's, the rail, 640 px of column and the panel, 256 + 640 + 440 = 1336 px (`BESIDE_FROM` in
   `apps/web/src/components/panel.tsx`). The page gives way, the panel does not: where the page's wide layout no longer
   fits beside the panel it draws the narrow layout it already has (Personal its rows instead of the table, a person's
   page its drill-in, a tool's page its list), its own breakpoint shifted by the panel's width while the panel is open.
   The modal drawer remains only below that width, on a short screen (1.4.10) and on a phone. Kalender, whose end slot
   holds its own Förslag panel, and Administration, whose pages grow with the shell's scroll and have no narrow layout,
   keep the shell's drawer.
2. **One header.** Beside the page and in the drawer the panel has the same header: the same name at the same size and
   level, ✕ in the same place, "Tillbaka" in the same place. Astryx's `DrawerHeader` is not used for it, since its
   title is always a full-size h2 that takes no ref.
3. **The panel holds one opened thing, never a list of cards.** Answer 6 in the table above is reversed to the review's
   proposal: "N att agera på" or "N förslag" counting several cards leads to the person's page at "Behöver dig"
   (`/people/<key>?section=needs-you&from=<the list>`), where each card opens beside that page; one card still opens
   beside Personal. `/staff?cards=<key>` from before leads there in its place.
4. **A card's read unfolds in the card.** A card's own read into the panel is drawn inside the card under its buttons,
   folded and unfolded as "Varför nu?" is, titled with the action's words, so the card and its decision stay in view,
   wherever the card is drawn, a conversation's answer included. `open-card` and `open-action` now say which read is
   unfolded; the address is replaced, not pushed, so Back never steps through folds. A row's own view in the read
   still opens in the card's place with "Tillbaka". A read that answers with a table (today only "Se i
   personalsystemet" on a leave request) still opens in the card's place until the product owner places it.
5. **Unchanged:** the wide modal drawer for focused work, a review and a talk, is the one other side surface.

For a connector author the table's "a card's read lies over the card" now reads "a card's read unfolds in the card".

Seen live again at 18:00, a second card opened beside a person's page still turned the header into
[D66](D66-the-panel-keeps-everything-opened-beside-the-page-as-tabs.md)'s menu of open things: D66's tabs are withdrawn
(its amendment of 2026-11-11), so answer 3 holds on every page, Hem included, and opening another thing replaces what
the panel holds under answer 2's one header.

