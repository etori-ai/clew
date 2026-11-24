# D74 · One page header for every surface

**Status:** accepted, built 2026-11-07 on `main` (a tool page, the calendar, the admin pages, then Hem and a
conversation the same day); item 5's calendar amended 2026-11-20 by Oliver Borgström (the steps and the view switch
are a row of their own under the title, see the amendment) and on 2026-11-23 (on a phone the title has a line of its
own and the controls are two rows under it, see the amendment) · **Date:** 2026-11-07 · **Area:** ui

**Decision.** Every surface in the shell opens with the same header, drawn by one composition,
`PageHeader` in `apps/web/src/components/page-header.tsx`. The product owner asked for it on 2026-11-07 ("All views
should have the same header component right? It shifts a bit now depending on if the search is visible or not. Do a
review to make sure all headers are uniform."); the review is
[page headers across every surface](../reviews/2026-11-07-page-headers.md).

1. **The first line is the title, then the surface's own controls.** The surface's title as `Heading level={1}` at the
   start, the page's one level-1 heading (D71 item 1), and at the end of the same line what the surface lets the person
   do there: a view's search field and its choice, the calendar's week steps, view switch, Förslag and Ny bokning, a
   primary button, an on/off switch, the day on Hem. The line is vertically centred and as tall as the heading's line
   (24 px × 1.3333 = 32 px), which is Astryx's `md` control height (`--size-element-md`, 32 px); controls are `md` or
   `sm`, so a surface with controls and one without put the title at the same place. On a narrow screen the controls
   wrap under the title, and a row of controls wider than a phone wraps inside itself (1.4.10).
2. **The second line, when there is one, is the mark row or the subtitle**, in supporting text: the area chip or the
   system's swatch, the source, the count and the state, as D71 item 3 of the views section draws the mark row; or a
   lead sentence. A mark that belongs to the title and is not a word (Hem's sparkle, a connected system's swatch,
   D71 item 7) stands before the title on the first line; a badge with a word ("Standard", "1 av 3") goes on the
   second line, so the first line holds the title and the controls alone.
3. **The gutter is the page's.** The title stands 32 px in from the rail and 32 px down on a desktop, 12 px on a phone,
   from the `Layout`'s padding (a header in `LayoutHeader`, where `Layout` padding reaches every slot) or from the
   content stack's padding where the content is `padding={0}` for a table (Astryx's `table-page` template). No wrapper
   undoes a component's bleed.
4. **What stays outside the header.** The admin pages keep their breadcrumb trail above the header, where Astryx's
   `Breadcrumbs` documents it ("Place breadcrumbs above the page heading"), so their title stands one trail lower than
   on other surfaces. The protocol reference (English, outside the shell) and the login card are not shell surfaces and
   keep their own title-then-lead layout, which already has this order and no controls.
5. **The surfaces.** A tool page: the view's name with the view's own search and choice at the end, the mark row (the
   "Kontakter" chip, "Telefonboken · 14 rader") under it, drawn by `DeclaredView` when it has a `title`; before the view has
   arrived the page draws the same header with the title alone, and its skeleton is the heading's 32 px line. The
   calendar: the week as the title, the week steps, the view switch, Förslag and Ny bokning at the end, in the
   `LayoutHeader`; on a phone the title with Förslag and Ny bokning, and the steps with the view menu as the second line
   (in the `section` named "Kalender" the phone's header already had). The admin pages: the title with the primary
   action or the on/off switch at the end, the lead sentence or the status line under it; the model's "Standard" badge
   moves from beside the name to the status line. Hem: "Hej" and the first name with the sparkle before it, the day,
   the week and the unit at the end (under the title on a phone). A conversation: its title with when it was started
   and "Stäng samtalet" at the end (on a phone the close button and the more menu), pinned in the `LayoutHeader` and in
   the flow on a short screen.

**Astryx.** `bunx astryx search "page header title actions"`, `bunx astryx template --list` and
`bunx astryx component PageHeader` (no such component; the CLI offers `LayoutHeader` as "another name for it") were run
against `@astryxdesign/core` 0.7.7. Astryx offers:

- `LayoutHeader`, a slot ("Top bar for page titles, app bars, and toolbars") with `hasDivider`, `height`, `label`,
  `role` and `paddingBlockEnd`: where a pinned header goes, not what it holds. The calendar's header stays in it.
- `Toolbar`, "for contextual actions within a content area (above a table, inside a card, or in a panel), not as a
  page-level header", with a least height per size and a roving tab index that makes its controls one tab stop. The
  `layout/headers-and-footers` guide suggests it "instead of LayoutHeader when the header carries interactive
  controls", but inside a `LayoutHeader` it bleeds to the edge and pads 12 px of its own: the calendar and the
  conversation each needed a wrapper (20 px in and 24 down; 24 in) to put the title back on the gutter.
- Templates that compose the masthead by hand: `table-page` ("Searchable Table": an `HStack gap={3} vAlign="center"
  wrap="wrap"`, the `Heading level={1}` in a `StackItem size="fill"`, the action after it),
  `LayoutHeaderWithActions` (the heading and a primary button in an `HStack` with `hAlign="between"`) and
  `HeadingPageLayout` (the heading with a supporting `Text` under it).

There is no page-header component, so `PageHeader` is that template composition, `HStack`, `StackItem`, `Heading` and
`VStack`, kept in one file so that no page composes its own. It has no CSS, no inline style and no pixel height: the
line is the heading's height because the controls are Astryx's own sizes. Its props are `title`, `icon` (the mark
before the title), `titleId` (a heading that focus can be sent back to, as Hem's is), `end` and `meta`; no page needs
another visual level, so there is no level prop. `end` is a plain flex child, not a static `StackItem`, because a
static item cannot shrink and a phone's search field and choice would then scroll the page sideways. Nothing custom and
no new dependency.

**Why.** On a tool page the line above the title was the mark row with the view's controls, so its height was the
height of the controls the view happened to have: 32 px with a search field, the chip's 20 px without, and the title
moved 12 px between Telefonbok and Mötesrum (the product owner measured 14 in the screenshots). The other surfaces
already put the title first, and D63 item 13 had drawn a view as a page that way ("the view's name at 20 px with its
source under it at the start of the line and the view's own search (240 px, its label hidden) and its choice as a
`Selector` at the end"); the build had drifted when D71 put the chip above the title. Weighed and left:

- **Keep the mark row first and give it a fixed height.** It stops the jump, but needs a pixel height on an Astryx
  stack, leaves the tool page the only surface whose title is not first, and puts the controls above what they filter.
- **The `Toolbar` on every page.** It has the fixed least height, but Astryx says it is not a page header; it bleeds
  out of the `LayoutHeader` and needed a wrapper on each page; and its roving tab index changes how the controls are
  reached from the keyboard, which a page with a search field and a choice does not need.
- **Breadcrumbs dropped on the admin index pages** (Astryx: "Don't show breadcrumbs on top-level pages that have no
  parent"). It would put the admin title on the same line as every other surface, but it removes a `nav` landmark from
  two pages; left for the product owner.

**Replaces.** D71's "A tool page draws its title at level 1 under that line" (the amendment on the views, item 3): the
title comes first and the mark row is under it, with the view's controls at the end of the title's line. D71's
header for a view in the panel and under an answer is unchanged. D71 item 7's swatch beside the connector's name stands
(it is the header's `icon`). The calendar's `Toolbar` header and its wrapper (the gutter comment in `calendar.tsx`,
2026-11-07 morning) go. The admin pages' `PageLead` goes. The admin gutter of 24 px becomes 32. Hem's and a
conversation's 40 px (D63 items 2 and 12, D72's `PAGE_INLINE`) become 32, and D72's three-track breakpoint is
recomputed with `PAGE_INLINE = 32` (256 + 64 + 1024 + 45 + 440 = 1829 px). Hem's lead (`greeting` and `lead` in
`start.tsx`) and the conversation's `Toolbar` with its wrapper go.

**Built the same day for Hem and the conversation.** `apps/web/src/pages/start.tsx`: Hem's lead is `PageHeader` with
`titleId="hem"` (the focus still goes back to it), the sparkle as `icon`, the day as `end` on a desktop and as `meta` in
supporting on a phone; the landing stack's padding is 32 px in and 32 px down (`paddingInline={8}`,
`paddingBlockStart={8}`) and `PAGE_INLINE` is 32, so D72's three-track breakpoint is 1829 px. A conversation's header is
`PageHeader` directly in the `LayoutHeader` (the `Toolbar` named "Samtalet" and its `VStack` wrapper are gone), the
`Layout`'s padding 32 on a desktop, the transcript's `paddingInline={8}`; the short screen draws the same header in the
flow, so a wide short screen no longer has its own "Nytt samtal" button (the box's "Ny fråga i stället" and the rail's
"Ny fråga" start one, and a phone keeps "Nytt samtal" in the more menu). The review's header (D73) is not changed here.

**Tests.** No new route, view or state: the specs that touch these pages run as they are (`tools.spec.ts`,
`calendar.spec.ts`, `admin.spec.ts`, `structure.spec.ts`); they find each page's title by its role and level 1, the
search field by its label, the swatch by its name and the connector's line by its text, all of which are unchanged.
The development stack was measured at 1440 and 320 px: the title of `/tools/calendar.rooms`, `/tools/phonebook.directory`
and `/calendar` stands 32 px in from the rail and 32 px down at 1440 (12 px in under the phone bar at 320), with no
horizontal scroll at 320.

**Built.** `apps/web/src/components/page-header.tsx` (new). `apps/web/src/components/view.tsx`: the mark row is its own
`MarkRow`; with a `title` the view's header is `PageHeader` with the controls at the end and the mark row as `meta`,
else the D71 header line as before. `apps/web/src/pages/tool.tsx`: `PageHeader` while the view loads, a 32 px
skeleton, the content stack 32 px down (`paddingBlockStart={8}`). `apps/web/src/pages/calendar.tsx`: `PageHeader` in
the `LayoutHeader` in place of the `Toolbar` and its wrapper, the `DatePicker` given `size="sm"` (it took `sm` from the
toolbar before). `apps/web/src/pages/admin/shell.tsx`: `PageLead` removed, `Layout` padding 32;
`connectors.tsx`, `connector.tsx`, `models.tsx`, `model.tsx` and `provider.tsx` draw `PageHeader`.

## Amendment, 2026-11-20: the calendar's steps are a row of their own

Asked for by Oliver Borgström on 2026-11-20, after a long title pushed the date picker onto the next line. Item 5 put
the calendar's week steps and view switch at the end of the title's line, in the same wrapping row as a title whose
length changes as the person steps ("Vecka 47 · 16–20 november 2026", "Onsdag 4 november", "November 2026"). A long
title made the row wrap and the steps move to the line under it, and stepping could move "Nästa vecka" from under the
pointer that had just pressed it.

On a desktop the title's line now holds the title and what the person can do there (Fråga om veckan, Förslag, Ny
bokning). Where in time and how it is shown stand on a row of their own under it, in `PageFrame`'s `below`: the steps
with I dag and the date picker, the view switch, and in the week view the week's dates in secondary text. The controls
come first and the dates, whose length varies, last, so neither a step nor a change of view moves a control. The week's
title is "Vecka 47" on a desktop as it already was on a phone. The phone's header is unchanged: it already had the steps
and the view menu as its second line.

Built in `apps/web/src/pages/calendar.tsx`. `tests/a11y/calendar.spec.ts` checks that the steps stand still while the
title changes, and scrolls the month's day into view before clicking it, since the grid now starts one row lower.

## Amendment, 2026-11-23: a phone's head is the title and two rows of controls

Found by the review of the phone view on 2026-11-23: `tests/a11y/touch.spec.ts` ("the calendar's head stays two rows at
that size") was red, with 309 px between the shell's bar and the week where it allowed 140.

**What had happened.** Item 5 gave a phone the title with Förslag and Ny bokning on one line and the steps with the view
menu on the next, and the spec's measure (137 px, written 2026-11-10) was that head in the 12 px gutter of the time.
`PageFrame` has since given a phone's page a 24 px inset (D126, 2026-11-14) and a trail above its title (D130,
2026-11-19): with the title those are 144 px before any control, so the measure could not hold, and the suite does not
run by itself (D59), so nothing said so. The amendment of 2026-11-20 did not change the phone's head (read from its
diff, not run again). In the frame's column neither of the two lines fits either. Under a finger at 375 px the column is
327 px: the steps (206 px) with "Vy: Vecka" (122) need 336, and "Vecka 45" (104) with Förslag and Ny bokning (233) needs
353. So the steps, the view menu and the two buttons each took a row under the title, three rows of controls in a head
that does not scroll: 345 px of a 375 × 812 window (42 %) and 361 px of 320 × 640 (56 %).

**Decision.** On a phone the title has a line of its own, and the controls are one wrapping row under it in the order
they are reached: the steps with I dag and the date picker, the view menu, Förslag where proposals wait, and Ny bokning.
From 360 px that is two rows of 44 px controls in every view, the steps with the view menu and Förslag with Ny bokning:
249 px from the shell's bar to the week at 375 and at 360 px (it was 309), and the head ends 285 px down a 375 × 812
window (35 %).

1. **Nothing shares the title's line.** The reason is the one of 2026-11-20. A phone's title is "Vecka 45", "Måndag 4
   maj", "Onsdag 4 november" or "November 2026", and a control at the end of its line wraps under it when the title
   grows: Ny bokning fits beside "Vecka 45" (104 px) and "Måndag 4 maj" (164) and not beside "Onsdag 4 november" (236).
   The steps would then move down a row as the person steps from a short date to a long one, and Ny bokning would stand
   where "Nästa dag" had just been pressed.
2. **The view menu's button shows the view alone**: "Vecka", "Dag" or "Månad" with the menu's chevron, 27 px narrower
   than "Vy: Vecka". Its accessible name is still "Vy: Vecka" (Astryx's `Button` takes the name as `label` and the
   visible text as `children`), so the name holds what is shown (2.5.3) and says what the button chooses.
3. **The steps stand edge to edge on a phone** (`gap={0}`; 4 px apart on a desktop as before). Each is a 44 px target
   of its own under a finger, and the 12 px is what lets "Månad", the widest view, stand beside them at 360 px (302 px
   of the column's 312).
4. **One wrapping row, not two fixed ones**, so the controls take the rows the width gives them: one row from about
   600 px, two from 360 px, and at 320 px two rows where no proposal waits (the steps, then the view menu with Ny
   bokning).
5. **The order a keyboard or a screen reader meets them in is unchanged**: the steps, the date picker, the view menu,
   Förslag, Ny bokning. It is now also the order they are drawn in.

**Limits.** At 320 px with proposals waiting, the week and the month take three rows (the steps; the view menu with
Förslag; Ny bokning): 277 px from the bar to the week, 8 px less than before, and the head still ends 353 px down a
320 × 640 window. The column is 288 px there and the steps are 194, which leaves room for no labelled button beside
them, and the view menu, Förslag and Ny bokning are 341 px with their gaps. With the text spacing of 1.4.12 the controls
wrap to a third row at 360 px too. Nothing scrolls sideways and no label is cut at any of these widths.

**Astryx.** `bunx astryx docs layout`, `component HStack`, `StackItem`, `DropdownMenu` and `Button` were read against
`@astryxdesign/core` 0.7.16. The row is an `HStack` with `wrap="wrap"`; a `StackItem size="fill"` grows and keeps its
content's width as its basis, which is why a control on the title's line wraps rather than the title. Nothing custom,
no CSS and no inline style. `PageFrame`'s `actionsOnLine` is removed: the calendar was its only caller, and a phone's
calendar no longer passes actions.

**Weighed and left.**

- **Ny bokning or the view menu as an icon alone.** It would give two rows at 320 px with proposals too, but takes the
  word from a control on the screen where there is least else to explain it.
- **A shorter title on a phone** ("Ons 4 nov"), so that Ny bokning could share its line. It abbreviates the page's one
  heading, for the eye and for a screen reader alike, to make room for one button.
- **The date picker at the end of the title's line.** It would give two rows at 320 px with proposals waiting too (the
  two arrows and I dag with the view menu are 258 px), but the title's line grows from 32 to 44 px at every width, the
  picker leaves the group of steps it belongs to and is reached before them, and beside the longest day titles ("Onsdag
  30 september", 260 px) it does not fit a 320 px screen either.

**The wide layout is unchanged**: the title's line with Fråga om veckan, Förslag and Ny bokning, and the steps with the
view switch and the week's dates on the row under it.

**Tests.** `tests/a11y/touch.spec.ts`: the case opens the week, the day and the month at 375 and at 360 px under a
finger and checks that the steps, the view menu, Förslag and Ny bokning stand on two rows and that the week starts less
than 260 px under the shell's bar (249 measured; a third row makes it 301). `tests/a11y/calendar.spec.ts`: the phone's
view menu shows "Vecka" and is named "Vy: Vecka". Built in `apps/web/src/pages/calendar.tsx` and
`apps/web/src/components/shell/page-frame.tsx`. No screen-reader pass was made.
