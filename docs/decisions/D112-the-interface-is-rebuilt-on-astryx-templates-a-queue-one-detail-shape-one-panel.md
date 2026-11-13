# D112 · The interface is rebuilt on Astryx's templates: a queue, one detail shape, and one panel with the assistant in it

**Status:** provisional (accepted when a manager has done a day's work in it and one connector author has declared an action that asks for input from the author's page alone); items 6 and 7 refined by [D116](D116-a-panel-is-a-peek-at-one-thing-a-list-is-a-page-and-every-view-has-an-address.md) (2026-11-12, provisional: a tool's page is every view's page, and the panel holds a view only when the view is one thing; a list or a table opened anywhere is its page); item 3's row gains the state's word by [D124](D124-a-unit-is-walked-one-step-up-and-one-step-down-and-the-people-pages-follow-their-canvas.md) item 9 (2026-11-13, provisional, built), and item 5's person page is redrawn by its item 6 (not built) · **Date:** 2026-11-11 · **Area:** ui

**Context.** Views, cards and navigation had grown by amendment (D50, D53, D63, D66, D72, D83, D97, D111) and were
hard to hold together. The product owner asked for a fresh approach drawn only from what Astryx already ships, saw it
on the canvas [Clew · a fresh start on Astryx templates](https://claude.ai/artifact/22VoDaxdttcxZMq2C4ijpa), and
decided on 2026-11-11 that the canvas is the reference where it differs from earlier choices. The owner also lifted
the freeze on new surface ([D101](D101-the-first-real-integration-is-nextclouds-approval-app-and-new-surface-waits-for-it.md))
for what this record needs: the destination Att göra, the work item's page, and the manifest fields `asks` and `effect`.

**Decision.** Each surface is one Astryx template. The canvas board is named in brackets.

1. **The shell is `shell-side-nav`** [Sidebar]. The rail, top to bottom: Ny fråga and Sök; Hem, Att göra with the
   count of what needs the person, Kalender, Personal (for a manager, D94); Verktyg, the tools an administrator placed
   (D40); Samtal, the conversation history, collapsible, each row with a status dot; Administration and the person in
   the footer. An installation with a shared header (D88) gets it as Astryx's TopNav above the rail [Tool]; without a
   header connector no TopNav is drawn.
2. **Hem is `ai-chat-landing`** [Main]: the question box centred under one heading, and under it two blocks, "Behöver
   dig" (the three most urgent work items, with a link to Att göra) and "I dag" (the day, the calendar family's event
   list). The work list itself is no longer on Hem.
3. **Att göra is `table-inbox`** [Inbox], at `/todo`: a queue with the tabs Behöver dig, Väntar på andra and Klart
   that indexes a reading pane. A row carries a state dot, the title, why, when it is due and the source. Choosing a
   row shows the work item in the pane (`/todo?item=<threadId>`); where the pane does not fit, the row leads to the
   item's page.
4. **A work item has one shape, `work-item-detail`** [WorkItem], drawn by one component at two widths. The header
   holds the source line, the title, the status, the badges and the buttons. The main column holds "Varför ser jag
   detta?", the rows as a checklist with progress, "Dokument", and "Händelser" (what Clew and the person did, with
   the receipts read back). The page `/items/<threadId>` adds the details rail: Detaljer, Berör, Öppna i källan. The
   reading pane and the panel draw the main column; "Öppna som sida" leads to the page. What the product called a
   card ("kort") is a work item ("ärende") in Swedish text from here on; `?card=` addresses lead to the same item.
5. **A person and a unit use the same shape** [Person]: breadcrumb, name and actions in the header; every section in
   the main column, one under the other, each naming its source; the directory's facts and "Tillhör" in the rail. The
   tab strip of sections is removed.
6. **A tool is a table with a filter bar and an inspector** [Tool]: the selected row's own read (`view.open`) is
   drawn in the end slot beside the table.
7. **There is one panel, in the end slot, and it is always about a thing** [Calendar, Assistant]. Top: the thing's
   title, facts and buttons. Under it: the conversation about it. Bottom: the box. With nothing opened, "Fråga Clew"
   in the page header makes the page itself the thing (the week, the work item on the page). When a conversation
   runs, the facts fold to the essentials and the buttons, with "Visa allt". The buttons are what the source lets the
   person do to the thing; the box is there whenever the person may read it and a model is configured (D8: without a
   model the panel is the thing alone). A long exchange continues in the conversation view, `ai-chat` [Chat], where
   the transcript is the main column and the thing is its artifact panel.
8. **The assistant drafts, the person decides.** An action the assistant fills in is drawn in the transcript as a
   draft with "Granska och …" and "Ändra"; both open the same dialog as the button (item 10), at its last and its
   first step. The decision endpoint is still never a tool. The assistant cannot draft what the person may not do.
9. **The calendar is not redesigned** [Calendar]. `EventCalendar` (D27, D32) stays; an event or a proposal opens in
   the end slot like any thing, and the list of proposals is reached from the toolbar. In context the calendar is its
   compact family: the day strip in the dialog's "När", the event list on Hem.
10. **A write passes one path, from every entry point** [ActBook, ActEffect, ActReceipt]. The path is Astryx's
    Dialog Wizard (`form-wizard-dialog`) over the page, and a step is drawn only when the declaration calls for it:
    - *Fill in*, when the capability declares `asks`: what the action asks the person for. An ask of a meeting time
      draws three suggested free times from the person's own calendar, "Annan tid", and the day underneath.
    - *Det här händer*, the last step of the same dialog: the values, and what will be written where. The rows come
      from the capability's `effect`, a read of the same connector that takes the same input and writes nothing;
      without it Clew names the source and shows the capability's own description.
    - Nothing is sent before the last button. The receipt is drawn on the work item, each row read back, with Ångra
      while the connector allows it, and logged under Händelser.
    A write without `asks` whose result can be undone stays one press (D70). `confirm` and `review: "each"` stand.
    The first slice of a meeting time writes to the source system only; Clew writes nothing to a calendar.
11. **The manifest preview shows both halves for every write** [Entrypoints]: where a person can start it (a work
    item, a person or unit, the question box, a conversation, a fact from elsewhere) and which steps of the path its
    declaration draws.
12. **Phone** [PhoneInbox, PhoneItem]: the rail is AppShell's drawer, a row opens the item full screen, the details
    are behind an information button, the panel is a sheet, and the buttons are pinned to the bottom.

**What this replaces.** [D111](D111-where-something-opens-is-decided-by-what-it-is.md) rule 7 ("no control chooses a
surface": "Öppna som sida" is back) and its panel header; rules 1, 4, 6 and 8 stand, and rule 2 stands with the panel
of item 7. [D66](D66-the-panel-keeps-everything-opened-beside-the-page-as-tabs.md) stays superseded. Hem as the day's
work under the box ([D53](D53-hem-is-the-start-page-the-days-work-under-the-box-and-the-day-beside-it.md),
[D63](D63-hem-is-drawn-as-the-canvas-draws-it.md)) gives way to items 2 and 3. The placement of a person's action in
its source's section ([D97](D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md), amended) gives way to
the header of item 5. [D73](D73-the-review-is-a-page-in-the-shell-with-an-address.md)'s review of rows one at a time
and [D96](D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md)'s talk keep their
drawer over the page. [D83](D83-interface-spaces-have-stable-navigation-roles.md)'s spaces stand, with
`docs/reference/interface-spaces.md` rewritten to this record.

**Not drawn, so kept as they are until decided.** Läget's figures, "Mina ärenden", the person's own action points and
"Sedan i går" have no board. They keep their components and are drawn on Hem under the two blocks; an errand list is
also a tool in the rail when an administrator places it. See `docs/maintainers/open-questions.md`.

**Amended 2026-11-11: Hem holds the 1.0 parts.** The product owner decided that Clew follows the feature set of the
product manager's start-page prototype, version 1.0 for managers, folded into Clew's own design (the canvas leads on
layout), and approved the board Hem10, which places those parts on Hem. Item 2 and "Not drawn, so kept" read as follows
from here on; the board is the reference for order and words, never for its inline styles.

1. **Fokusnyhet.** Between the box and the blocks stands one callout, Astryx's `Banner` (info, card container): the open
   work item that asks for the person's read receipt. It says the title, the source, when it was published and that a
   receipt is required, with "Läs", which opens the item in Att göra (`/todo?item=<id>`) as every row on Hem does, and
   the item's own receipt action as its button, through the one path of item 10 (one press when the action asks
   nothing). It stays until the receipt is given and has no dismiss button, against Astryx's advice for an info banner,
   because it is a requirement; the receipt's arrival is said by Hem's receipt notice, and for the moment the item
   keeps its place the callout says the source's answer. With several such items the most urgent, in Att göra's order,
   is the callout and the rest are ordinary rows under "Behöver dig"; with none, nothing is drawn. The signal is
   explicit, never read from a reason's words: a source marks the execute that is the receipt with
   `acknowledgement: { publishedAt }` on the action in its draft (`ThreadActionSchema`), only on an execute and at most
   one per item; the registry refuses a draft that breaks this as it refuses any that breaks the action rule (D35).
2. **Nyheter.** A third block beside "Behöver dig" and "I dag", the three side by side where they fit and one under the
   other where they do not: the three newest pieces of news, the headline as the row's one link and the sender and the
   day as its supporting line, each row the same one-link row a work item has (`LinkRow`), and "Alla nyheter". A row
   leaves Clew in a new tab by its `link`, marked as leaving, or opens beside the page by its source's own read. With no
   news source in the person's scope, or none that answered, there is no block and no error. "Alla nyheter" is the
   joined list at a tool's address, `/tools/clew.news`, drawn as a tool's page draws a view (item 6); an administrator
   may place it in the rail under Verktyg like any tool (D40), and nothing places it there by itself.
3. **The news profile, and why it exists.** Clew is not a news site ([vision](../vision.md)): it keeps no news, has no
   editor and draws no body or picture. What the prototype asks for, the newest news on the start page and all of it a
   click away, is a list a news source already has, so it comes through a connector profile as errands do (D89),
   answered as the person by the systems that hold the news. A connector declares a read `<id>.news` that takes `{}` and
   answers a `NewsOutput`: rows of `ref`, `title`, `sender`, `publishedAt` and an optional `link`, nothing else. Clew
   joins every `<id>.news` in the person's scope into the core read `clew.news`, newest first, each source asked under a
   short budget; a source that fails, is late or answers out of shape contributes nothing and is not named, since Hem is
   not where a news source's silence is reported. As the errand list is, `clew.news` is the one news tool the model is
   offered, reading how many rows there are and never the rows, and no per-source read is; it is never a write. The
   communication fixture is the first source.
4. **Dialogstöd's figures are Läget.** Läget's tiles stay as D54 draws them and stand under the three blocks, headed
   "Läget på <enhet>" with the unit's name leading to the unit's page, and "Öppna dialogstödet" leading to the same page,
   both with Hem as the way back. A tile opens what it opened before, and a manager of several units sees the session's
   unit, as before.
5. **Verktygslådan.** Under Läget, one tile per tool an administrator placed for the person: the rail's Verktyg (D40) in
   its order, each tile with the tool's icon, its name and its source, leading to the tool's page (D42); a person with no
   tools gets no section. Beside the heading a link out, "Fler verktyg på intranätet", when the shared header's connector
   (D88) lists a place or a page the installation marked as its page of tools (`purpose: 'toolbox'`, an optional field
   of `SiteMenuPlace` and `SiteMenuLink`); without one there is no link, and Clew never makes up the address.
6. **Kept, under Verktygslådan.** Mina ärenden, the person's own action points and Sedan i går, with their components.
7. **Not built.** "Anpassa startsidan" (the owner's one exception to Hem10): no control and no setting. "Min AI" has no
   surface of its own: it is the box and Samtal. No suggestion chips under the box, no news authoring, no pictures and no
   carousel.

**Amended 2026-11-12: a work item opened from Hem opens beside Hem, and a notice reads as a notice.** The product owner
tried Fokusnyhet and found it strange that "Läs" on a notice threw them into the queue, and that the notice's own text
had no path: the item showed its two sentences under "Varför ser jag detta?", a "Rader" section that only repeated the
title, and no way to the whole text. They approved the change on 2026-11-12: "what you propose is what I as a user
expect, beside Hem". Item 2 and the first amendment's item 1 ("Läs", which opens the item in Att göra) read as follows
from here on.

1. **Beside Hem.** "Läs" on Fokusnyhet, every row under "Behöver dig", the day's link to the item a meeting came from and
   an item suggested under the box open the work item in the panel of item 7, beside Hem, by the address every page uses
   (`/?card=<threadId>`), and the person stays on Hem. It is the work item Att göra's reading pane draws, with its
   buttons, the action dialog, the receipt with Ångra, "Öppna som sida" and the box under it. The row is marked while its
   item is open; ✕ or Esc gives the focus back to what opened it, and to "Behöver dig" when that is gone (the receipt
   took the item off Hem). A decision made there changes Hem's blocks and the callout as one made on Hem does. Below the
   panel's width it is the drawer over Hem, as on every page. Att göra is unchanged, and "Alla N i Att göra" still leads
   there. What belongs to no page (the bell, a toast, the rail's search) opens over Hem the same way (D111 rule 2); only
   Hem's old tabs and area (`/?tab=`, `/?area=`) lead to Att göra.
2. **A notice reads as a notice.** A work item whose execute is the person's read receipt (`acknowledgement`) leads with
   its text, the draft's `summary` paragraph by paragraph, first under the head and under no heading of its own; after
   the text stands the item's first read that leads out of Clew (`target: 'link'`, marked as leaving, D111 rule 8) as the
   way to the whole of it, there and not among the buttons. "Varför ser jag detta?" is then the provenance line alone: the
   source's reason (who published it, when, that a receipt is required) and where and when the item came. The receipt's
   button stays among the head's buttons and is reached from the text; nothing is added for it. After the receipt the
   text stays under it, to be read again.
3. **A row that only repeats the title is not drawn.** On every work item "Rader" is left out when its one row is the
   item itself: the title as its label, no detail, no person or unit, nothing to choose. A row with any fact of its own
   is drawn, and so are two rows or more.
4. **The protocol is unchanged.** The way to the whole text is the existing read with `target: 'link'`, and the text is
   the draft's `summary`. The communication fixture's notice "Ny rutin vid hot och våld" has a body of a few paragraphs
   and a link to its full text, carried on its news row (`NewsRow.link`) and on its work item as the read
   `communication.open`.

**Consequences.** Astryx's templates are the implementation, not an inspiration: `bunx astryx template <id>` is read
before a surface is written, and a surface that needs something a template lacks records the gap here before any
custom composition. Every route, view and state above gets its scenario in `tests/a11y`. `asks` and `effect` are
contract changes to the connector protocol (`packages/connectors/src/protocol.ts`) and come with the checks that
enforce them and with the HR fixture's `hr.bookTalk` as the first use.

**Astryx gaps.** Add one here in the change that meets it.

1. `SideNav resizable` puts its resize handle outside the navigation landmark, which fails axe's `region` rule. The
   rail is collapsible but not resizable.
2. The queue's rows are `List` and `ListItem` (a link with `isSelected`), not `table-inbox`'s `Table`: a `Table` in
   data mode always draws a header row, which the board has none of, and the template marks the open row with an
   inline style on its cells.
3. At 320 px with the text-spacing overrides three tabs with counts do not fit and `TabList`'s scrolling strip fails
   the reflow check (WCAG 1.4.10). On a phone the queue's tabs are short words without counts; the rail carries the
   count.
4. Astryx has no hook for a container's width. Att göra measures its own box the way the `table-inbox` template does
   (a `ResizeObserver` in the template's own `useSurfaceWidth`), which is the one sanctioned copy.
5. `Layout contentWidth` with one end panel aligns the panel to the content frame, so Hem bounds its column as Personal
   does, a `VStack` with a `maxWidth` (the page's 1216 px less its padding) centred in one with `hAlign="center"`, and
   the box at its 720 px reading width the same way inside it, to keep the panel at the page edge. The template's
   vertical centring is an inline style and is not copied.
6. `work-item-detail` draws an attachment's icon on a square tile (`AspectRatio` with a width and a background of its own
   StyleX) and sets the breadcrumb's vertical rule's height the same way. Clew draws the document's icon without the
   tile, and the trail's `Divider` takes the line's height from an `HStack` that stretches its children.
7. The action dialog (item 10) has two steps where Astryx's Stepper asks for three or more; the boards draw the two
   markers, and the Stepper is drawn as the template draws it, a position indicator without `onStepClick`. With one step
   no Stepper is drawn.
8. `form-wizard-dialog` resets its draft on every close and asks for a "continue where you left off" affordance before
   resuming one. The action dialog keeps what the person typed while the work item stays open (so "Ändra" from an
   assistant's draft and a reopened dialog lose nothing, item 8) and drops it with the item and once it is sent; it
   draws no such affordance.
9. `DayStrip` needs 380 px, so on a phone the dialog draws the person's day with the family's `EventList`, which the
   family's contract allows down to 280 px; the strip's picture is said in words through its `accessiblePath`.
10. `ChatLayout`'s panel view (`ChatLayoutPanelChat`) holds messages and a docked composer and has no slot for a thing
    above the messages that is not one of them. The panel of item 7 (and Att göra's reading pane) stacks `ChatLayout`
    under an empty `VStack` in the panel's height, and while a conversation runs the thing draws its head there, outside
    the transcript's scroll, as the board Calendar draws it fixed: a work item its source line, title, status, badges and
    buttons, as its page keeps them in `LayoutHeader`; a calendar entry its badges, when and buttons (`useThingHead`, a
    React portal into that stack, no style of its own). What remains of the thing, its facts folded under "Visa allt"
    (`Collapsible`), scrolls with the transcript. Before anything is asked the thing is drawn whole as the first child of
    the message area. On a short screen (1.4.10) nothing is docked: the thing, the transcript and the box follow one
    another in the panel's own scroll.
11. The `ai-chat` template's artifact panel heads its card with a `Toolbar` (title, subtitle, actions, close). The panel
    keeps its own header, a heading and icon buttons ("Fortsätt som samtal", ✕), because the heading takes the focus when
    the panel opens and a toolbar would offer its arrow keys there; the subtitle is supporting text under the heading.
12. A `Table` has no state for the row whose read is open in an inspector: `table-filter` and `table-grouped` mark it
    with StyleX of their own through the row transform. A tool's page (item 6) sets `aria-current` on that row through
    the same documented `transformBodyRow`, with no style, and says it on the row's name with an accent `StatusDot`
    named "Visas bredvid"; where the rows are a `List` (narrower, or beside the panel) the row is `ListItem`'s
    `isSelected`.
13. `detail-page` and `work-item-detail` have no way to send the reader to one section of the main column. A person's
    and a unit's page (item 5) keep `?section=<capability>` from the tab strip it replaces: once the section's heading
    is drawn it is scrolled into view and takes the focus from a script (`tabIndex={-1}`), unless something opened
    beside or over the page holds it. The sections answer one by one and push the heading down as they grow in, so
    while it holds the focus it is scrolled to again as each read lands and once Astryx's motion has ended; a fitting
    `ScrollableArea` clips until it has observed its content overflow, so the column keeps its containment with the
    documented `stickyContainment="always"` and can be scrolled from the first section that arrives.
14. Rows nested in a collapsible `SideNavItem` are not held to the rail's width: the folded region is a grid whose item
    keeps `min-width: auto`, so a row grows as wide as its text and a long label overflows the rail instead of being cut
    with the label's ellipsis. Samtal is therefore a visible `SideNavSection` with the conversations as plain rows, not
    a disclosure (2026-11-12). "Fler verktyg" and Administration still use the collapsible with sub-rows and have the
    same latent overflow for a long label; that is known and not changed.
