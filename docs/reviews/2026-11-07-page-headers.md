# Page headers across every surface

**Date:** 2026-11-07 · **Outcome:**
[D74](../decisions/D74-one-page-header-for-every-surface.md)

## The problem

The product owner, on 2026-11-07, with four pictures of the development stack in dark mode: "All views should have
the same header component right? It shifts a bit now depending on if the search is visible or not. Do a review to make
sure all headers are uniform." On a tool page the area chip and "Telefonboken · 14 rader" came first, with the view's
search field and choice at the end of that line, and the `h1` under it; a view with a search field made that line
taller, so the title stood lower on Telefonbok than on Mötesrum and jumped between the two pages. The calendar, the
review, Hem and the administration each drew their header another way.

## The surfaces as they were

Measured in the development stack's browser at 1440 × 900 with a fine pointer, signed in as Hillevi (not an
administrator), on `main` at `2059059`; the admin pages, which that person cannot open, are read from the code. "In" is
the title's distance from the rail's edge (the rail is 260 px), "down" its distance from the top of the shell's main
area.

| Surface | First line | Second line | Where the controls stand | Gutter (in · down) | Title moves with the controls? |
| --- | --- | --- | --- | --- | --- |
| Hem (`start.tsx`) | The sparkle and "Hej Hillevi" (h1) at the start, the day, the week and the unit in secondary at the end (D63 item 2) | None on a desktop; on a phone the day in supporting (artboard 11) | End of the title's line (text only) | 40 · 24 (the sparkle at 40, the words at 68) | No: the day is text, shorter than the heading's line |
| A conversation (`start.tsx`) | An Astryx `Toolbar` (size `sm`) in the `LayoutHeader`: the title (h1) at the start, "Startat av dig 09:12" and "Stäng samtalet" at the end | None | End of the title's line | 36 · 8 (Layout padding 16, a wrapper 24, less the toolbar's own bleed) | No: a toolbar has a least height per size |
| The calendar (`calendar.tsx`) | A `Toolbar` (`sm`) in the `LayoutHeader`, wrapped 20 px in and 24 px down to undo its bleed: the week (h1) and the week steps at the start, the view switch, Förslag and Ny bokning at the end | None on a desktop; on a phone the steps and the view menu under the title | Split: steps beside the title, the rest at the end | 32 · 32 | No, but only through the wrapper |
| A tool page with a search (`/tools/phonebook.directory`) | The mark row: the area chip, "Telefonboken · 14 rader", the search field and the scope `Selector` at the end | The title (h1) | End of the mark row, above the title | 32 · 64 | **Yes**: the 32 px controls make the mark row 32 px tall |
| A tool page without a search (`/tools/calendar.rooms`) | The mark row: the chip, "Kalendern · 2 rum" | The title (h1) | None | 32 · 52 | **Yes**: the row is the chip's 20 px, so the title is 12 px higher than on Telefonbok (the product owner measured 14 in the screenshots: y 287 against 301) |
| The review (`review.tsx`, D73) | "Granska 3 rader" (h1) with "Spara och stäng" at the end | The subtitle ("<card> · inget skrivs förrän du skickar"), then a third line, the mark row with the counter badge, then the steps | End of the title's line | 32 · 32 | No |
| The admin index (`/admin`, Anslutna system) | The breadcrumb trail "Startsidan / Administration / Anslutna system" | `PageLead`: the title (h1) with the lead sentence under it, "Anslut system" at the end, top-aligned | End of the title's line, aligned to its top | 24 · about 62 (Layout padding 24; the trail and a 20 px gap above the title) | No, but the button is aligned to the title's top, not its middle |
| A connector's page | The trail | `PageLead`: the swatch and the name (h1), "2:a anslutna systemet · färg lila · …" and the status line under it, the on/off `Switch` at the end | End, top-aligned | 24 · about 62 | No |
| A model's page | The trail | `PageLead`: the name (h1) with a "Standard" badge beside it, aligned to the text's foot; the status line under it; the `Switch` at the end | End, top-aligned | 24 · about 62 | No |
| The protocol reference (`/protocol/manifest`) | "Clew manifest reference" (h1), outside the shell, in English | Two lead paragraphs | The filter is in the outline panel beside the article (under the lead on a phone), not in the header | 32 from the centred article's edge · 32 | No controls |
| Login (`login.tsx`) | "Startsidan" (h1) in a centred card | A sentence and the sign-in button | In the card's flow | The card's own 32 px padding | No controls |

## What is uniform and what is not

Uniform: every surface has exactly one level-1 heading and it is the surface's title (D71 item 1); every control in a
header is an Astryx component; on a phone every title stands 12 px in.

Not uniform:

1. **The order.** A tool page put the mark row above the title; every other surface puts the title first. That is the
   jump the product owner saw: a line above the title whose height is the height of whatever controls the view has.
2. **The component.** Four ways to draw the same thing: an Astryx `Toolbar` (the calendar, a conversation), the admin
   pages' own `PageLead`, a hand-composed `HStack` (Hem, the review, a view's header), and the view's header line. The
   `Toolbar` is documented by Astryx for actions inside a content area, "not as a page-level header", and bleeds out of
   the `LayoutHeader`, which is why the calendar and the conversation each needed a wrapper to put the title back on
   the page's gutter.
3. **The gutter.** 24 (admin), 32 (a tool page, the calendar, the review), 36 × 8 (a conversation) and 40 × 24 (Hem)
   from the rail and the top. A tool page was 32 in but 20 down.
4. **The alignment.** The admin header aligned the action to the title's top and the model's badge to the title's
   foot; everything else centres.
5. **What stands beside the title.** The calendar's week steps beside the title at the start; the model's "Standard"
   badge beside its name; the connector's swatch before its name; Hem's sparkle before the greeting.
6. **The second line.** The review has a subtitle and then the mark row as a third line; the admin pages have a lead
   sentence; a tool page had its mark row above, not under.

The breadcrumb trail on the admin pages, the protocol reference and the login card are not headers in this sense: the
trail is navigation that Astryx places above a page's heading (`Breadcrumbs`: "Place breadcrumbs above the page
heading"), the reference is an English document outside the shell, and the login is a single card.

## The shape unified on

One shape, one shared composition (`apps/web/src/components/page-header.tsx`, recorded in D74):

- **The first line** is the surface's title as `Heading level={1}` at the start, and the surface's own controls at the
  end: a search and its scope, a view switch and the week steps, a primary button, an on/off switch, the day on Hem. The
  line is vertically centred and is as tall as the heading's line (24 px × 1.3333 = 32 px), which is Astryx's `md`
  control height (`--size-element-md`), so a surface with controls and one without put the title at the same height.
  On a narrow screen the controls wrap under the title.
- **The second line**, when the surface has one, is the mark row in supporting text (the area chip or the system's
  swatch, the source, the count, the state), as D71 item 3 of the views draws it, or the subtitle. A mark that belongs to
  the title and is not a word (Hem's sparkle, a system's swatch) stands before it; a badge with a word goes on the
  second line.
- **The gutter** is the page's: the title 32 px in from the rail and 32 px down on a desktop, 12 on a phone, from the
  `Layout`'s padding or the content stack's, never from a wrapper that undoes a component's bleed.

D63 item 13 already describes this order for a view as a page ("the view's name at 20 px with its source under it at
the start of the line and the view's own search … and its choice … at the end"); the build had drifted from it when
D71 put the chip above the title.

## After

Measured the same way after the change, on the working tree:

| Surface | In · down at 1440 | In · down at 320 | Horizontal scroll at 320 |
| --- | --- | --- | --- |
| `/tools/calendar.rooms` | 32 · 32 | 12 · 60 (under the 48 px phone bar) | None |
| `/tools/phonebook.directory` | 32 · 32 | 12 · 60 | None |
| `/calendar` | 32 · 32 | 12 · 60 | None |
| `/admin` | Not measured (the signed-in person is not an administrator); from the code 32 in, the trail 32 down and the title under it | | |

Hem, a conversation and the review are owned by other sessions on 2026-11-07 and are left to them; D74 says what each
becomes.
