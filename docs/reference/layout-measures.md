# Layout measures

The measures Clew's pages are held to, and the one place each of them is set. Clew's look and layout follow the
startsidan prototype ([D130](../decisions/D130-clews-look-and-layout-are-the-startsidan-prototypes-built-with-astryx.md));
the numbers below were read in the running prototype (`startsidan-prototype/apps/portal`, 1440 px wide) on 2026-11-18
and are what a new or changed page is compared with. Exact pixels are not the aim. Nothing on a page should catch the
eye: an edge that does not line up with the heading over it, a row tighter than its neighbours, a title with no air.

## Where a measure lives

Three layers, and a page sets none of them itself.

| Layer | What it holds | Where |
|---|---|---|
| Tokens | The scale every measure is taken from: spacing steps (a step is 4 px), radii, type sizes, shadows, colours | `packages/ui/src/theme.ts` |
| Layout components | The rhythm: a page's column and gutters, the air around a title, a card's inset, a row's shape, and the gaps pages share | `packages/ui/src/components/` (`BoardCard`, `KeyFigure`, `StatusRow`, `measures.tsx`; listed in its `README.md`) and, for what reads the session or the address, `apps/web/src/components/` (`PageFrame`, the shell) |
| Pages | What the page holds, in those components. No gap, inset or width of its own | `apps/web/src/pages/` |

A measure that several pages share belongs in a layout component, never in the theme and never in a page. The theme
changes a measure only when every use of a token or a component should change with it. A page that needs a number of
its own is a sign that a layout component is missing a prop: add the prop.

## The measures

Spacing is written in Astryx's steps (`gap={6}` is 24 px).

| What | Measure | Set in |
|---|---|---|
| The shell's column | 1280 px at most, centred, 32 px at each side; the header's rows stand on the same lines | `SHELL_WIDTH` in `shell.tsx`, `PageFrame` |
| Over a title: the trail or the way back | 12 px to the title. A page of the row "Mina sidor" itself has neither: the row marks it (D130 item 17 as amended 2026-11-21) | `PageFrame`, `RowPage` in `shell.tsx` |
| Tabs on a title's line | Att göra's piles, 24 px after the title, from 1025 px of window; under the title below that and on a phone (D130 item 19 as amended 2026-11-21) | `PageFrame` (`tabsOnLine`) |
| Page title | 32 px, 800; 24 px below `md` | `theme.ts` |
| Facts line under a title | 17 px in the secondary colour, 8 px under the title | `PageFrame` |
| Between cards that stand together | 20 px: a board's blocks and columns, key figures in their row | `CARD_GAP` in `measures.tsx` |
| Between a page's sections | 24 px: a register's key figures and its card | `SECTION_GAP` in `measures.tsx` |
| Hem's greeting | 48 px under the header, 20 px to the line to ask, 48 px from the line to the board | `PageFrame` (`plain`) |
| Card | 16 px corners, the low shadow, 1 px border | `theme.ts` |
| A card's heading | Inside the card, 24 px from its sides and 20 px from its top; 17 px, 800; the count after it, 12 px bold | `BoardCard` |
| A card's content | 24 px from the sides and the foot, 16 px under the heading or the tools; a list's rows 12 px, since a row insets itself | `BoardCard` |
| What stands in a card | Starts on the heading's line: a table stands inside the card's inset, never flush to its edge under a heading | `BoardCard` (`flush` only where the card has no heading over the table) |
| Key figure | 20 px by 24 px inset; label 11 px bold small capitals; value 30 px, 800, in its status colour or, for a plain count, the identity colour; four to a row, two on a phone | `KeyFigure`, `FigureRow` in `measures.tsx`, `theme.ts` |
| A list beside its reading pane | No card and no inset of its own: the frame's card and inset are its | `BoardCard` (`bare`) |
| A row that needs the person | The ground's colour, 6 px corners, a 4 px edge in its status colour, 12 px inset, 8 px between rows | `StatusRow`, `theme.ts` |
| Register table | 65 px rows (Astryx `Table` `density="spacious"`), 40 px initials on the identity colour | `registerTable` and `PersonAvatar` in `measures.tsx`, `theme.ts` |
| Badge | 6 px corners, bold in the heading face, a tint with its colour's own words | `theme.ts` |
| Button | 8 px corners, bold in the heading face; the assistant's is a pill | `theme.ts` |
| The ask pill | 62 px high, a 36 px round mark, the button inside it | `start.tsx`, `theme.ts` |
| The assistant's button | 46 px high with 24 px at each side, a pill, in the ask pill and in the corner | `theme.ts` (`variant:ai` with `size:lg`) |
| Focus news | 32 px inset, the headline 30 px | `focus-news.tsx` |
| Closing line | 12 px; 40 px under a board's last card, a rule over it | `PageFrame` |
| What scrolls | A board and a read with facts, sections or tabs (a work item, a record, a person, a unit, a plan, Administration) scroll as one page under the shell's header; a fixed work surface (Kalender, Att göra with its reading pane, a conversation, the review) and every page beside the assistant's pane keep their header while their column scrolls; a short screen pins nothing (D130 item 8 as amended 2026-11-21) | `PageFrame` (`asOne`, `pin`) |
| A sticking tab row | On a page that scrolls as one, the tabs alone stay at the top of the window: 8 px over them and 12 px under, the ground's colour behind, and 64 px of `scroll-padding-top` on the shell's column so the keyboard's focus stops under the row (2.4.11). The one sticky written by hand, D130 "Astryx gaps"; not on a short screen | `PageFrame` (`STUCK_TABS`, `STUCK_ROOM`) |
| The assistant's pane | A card at the end of the shell's column, 400 px wide (the person's grip: 360 px to half the column, at most 720), 20 px from the page's card or 32 px from a board's cards; beside the page from 1180 px of window, a drawer below | `PageFrame` (`aside`), `paneBesideQuery` in `media.ts` |

## Checking a page

1. Open the page in Clew (`http://localhost:3020`) and its counterpart in the prototype (`http://localhost:3010/portal`)
   at the same width.
2. Read both in the browser, not by eye alone: the box of the title block, each card, a table's first cell and a row,
   and their computed padding. Compare the left edges first (a heading and what stands under it), then the vertical
   rhythm.
3. Close a difference in the layout component that owns the measure. Then look at one other page that uses the same
   component: a change there is a change everywhere.
4. What still differs, and why (data Clew does not have, a product decision, an Astryx gap), goes in D130.

## Open

A person's page, a unit's page, a tool's page and the administration have not been compared with the prototype; they
still stand in the frame's card. The field in the ask pill is 14 px where the prototype's is 18. Personal's column
headings are two lines (the label and its source), so its table's head is 60 px where the prototype's is 32.
