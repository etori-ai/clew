# D74 · One page header for every surface

**Status:** accepted, built 2026-11-07 on `main` (a tool page, the calendar, the admin pages); Hem, a conversation and
the review follow in the sessions that own `start.tsx` and `review.tsx` · **Date:** 2026-11-07 · **Area:** ui

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
   moves from beside the name to the status line. Hem, a conversation and the review are listed under "Not built here".

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
conversation's 40 px (D63 item 12, D72's `PAGE_INLINE`) become 32 when the start session builds this; D72's
three-track breakpoint is then recomputed with `PAGE_INLINE = 32` (256 + 64 + 1024 + 45 + 440 = 1829 px).

**Not built here.** `start.tsx` and `review.tsx` are being changed by other sessions on 2026-11-07, so they follow:

- **Hem:** `PageHeader` with `title={'Hej ' + firstName}`, `titleId="hem"`, `icon` the sparkle
  (`<Icon icon={SparklesIcon} size="md" color="accent" />`), `end` the day, the week and the unit as now
  (`Text color="secondary"`) on a desktop and `meta` the same words in `Text type="supporting"` on a phone, in place of
  `greeting` and `lead`; the landing stack's padding `paddingInline={mobile ? 3 : 8}` and
  `paddingBlockStart={mobile ? 3 : 8}`, and `PAGE_INLINE` 32.
- **A conversation:** `PageHeader` with the conversation's title and, at the end, what the `Toolbar`'s `endContent`
  holds now ("Startat av dig …" and "Stäng samtalet"; on a phone the close button and the more menu), directly in the
  `LayoutHeader` without the wrapping `VStack`; the `Layout`'s `padding={mobile ? 3 : 8}` and the transcript's
  `paddingInline={mobile ? 0 : 8}`, so the title and the transcript are 32 px in. The short screen's
  `conversationHeader` becomes the same `PageHeader` in the flow.
- **The review:** `top` becomes `PageHeader` with `title={'Granska ' + n + ' rader'}`, `end` the ghost "Spara och
  stäng", and `meta` one mark row: the `AreaChip`, then `Text type="supporting"` with "<source> · <card's title> ·
  inget skrivs förrän du skickar", then the counter `Badge` "1 av 3"; the `Stepper` stays under the header in the
  pinned `LayoutHeader`. Its gutter is already 32 × 32.

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
