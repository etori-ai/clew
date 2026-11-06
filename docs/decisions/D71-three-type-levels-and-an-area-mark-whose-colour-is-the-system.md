# D71 · Three type levels on every surface, and an area mark whose colour is the system's

**Status:** accepted, built 2026-11-06 on `main` (the foundation, the row and the card, a card across systems,
Anslutna system and the phone); the figure forms, the views and answers, the calendar family and the mark on small
places are built by the sessions that own those files (see "Not built here") · **Date:** 2026-11-06 · **Area:** ui

**Decision.** The design pattern drawn on the canvas **Clew · hierarki, områden och figurer** (Claude Design,
https://claude.ai/artifact/YVw6FJL6YjKZprBAiAEA2f, twelve artboards) and written up in
`docs/reviews/2026-11-06-visual-hierarchy-area-marks-and-figures.md`, taken whole by the product owner on 2026-11-06.

1. **Type roles (artboard 1).** Exactly these Astryx tokens, nothing custom, and the visual level and the outline stay
   two props (`level`, `accessibilityLevel`):

   | Role | Token | Where |
   | --- | --- | --- |
   | The surface's title | `Heading level={1}` (24 px) | Hem's greeting, a conversation's title, a tool page, an admin page |
   | The open card | `Heading level={2}` (20 px) | `GenericCard` and `ThreadCard` beside the column, in the sheet, in a transcript; the view beside the column |
   | Section | `Heading level={3}` (17 px) | Nu, Jag föreslår, Senare, Till kännedom, Väntar på andra, Redan hanterat, Sedan i går, an admin page's parts |
   | Row | `Text weight="semibold"` (14 px) | a card's row in a list (`Link weight="semibold"`), a row of a card, a receipt row |
   | Meta line | `Text type="supporting"` (12 px, secondary) | under every row title; never carries status |
   | Body | `Text type="body"` | the answer, a card's summary (secondary), Varför nu; never bold inside running text |
   | Value | `Text type="display-3"` | only a figure's value |

   A long reference page (`protocol.tsx`) puts its sub-sections at `level={4}` (14 px, the row's size).
2. **The area mark (artboard 2): the colour says the system, the icon says the area.** A connected system gets a hue
   from the fixed list teal, purple, orange, cyan, pink, gray (`packages/ui/src/system-hues.ts`, beside `branding.ts`
   and `theme.ts`, D38), by its place in the order the administrator registered the systems; the seventh starts over at
   teal. Blue is the assistant's and info's; green, yellow and red are status. Clew's own systems (a bundled row, or a
   connector of kind `core`: people, the calendar, search) are the house: no hue, an outlined mark. The icon is the
   area's, from the manifest (`MenuIcon`, D41); `clewIcon` moved from `apps/web/src/icons.ts` to
   `packages/ui/src/mark.tsx` (the old name re-exports it), and a connector still sends a name, never a drawing (D40).
   Three forms, all in `packages/ui/src/mark.tsx`: `AreaChip` (an Astryx `Badge` in the hue's variant with the icon
   and the area's word, above a card's title), `AreaGlyph` (`Icon color="secondary" size="sm"`, no hue, so a list stays
   calm) and `AreaLine` (the glyph followed by the meta line's words, which wrap beside it). Colour never stands alone
   (1.4.1): the chip carries the word, the glyph is followed by it.
3. **The order comes from the server.** A `connector` row carries `ordinal` (migration `0032_connector_ordinal`):
   the lowest one no other remote row holds when it is added (`nextOrdinal` in `@clew/contracts`, applied by both store
   adapters and by `insertConnector`), so a removed system frees its colour for the next one and the others keep theirs;
   a bundled row has none. Existing rows were numbered by `created_at`. The ordinal reaches the live registry in the
   row's governance; `Registry.ordinal(id)` is null for a core connector, and `Registry.systems(actor)` lists the
   systems a person can see. `GET /api/areas` adds `systems: SystemMark[]` (connector, source, ordinal); the admin
   summary adds `ordinal`, the admin area view adds the area's `icon`. The web asks `useMarks()` (`apps/web/src/marks.ts`)
   for a card's, an area's or a ref's mark and draws the components; no page component knows a hue.
4. **Two Badge variants from the theme.** Astryx's `Badge` has the five hues but no gray and no outlined form. The
   theme adds them the way Astryx documents for a new variant (`components.badge['variant:gray' | 'variant:house']` in
   `theme.ts`, module augmentation of `BadgeVariantMap` in `mark.tsx`): gray on Astryx's own `--color-background-gray`
   and `--color-text-gray`, the house on the card background with an inset `--color-border-emphasized` outline.
5. **The row and the card (artboard 5).** The row keeps its day cell, its title as a 14 px semibold link and its
   buttons; its meta line is `AreaLine` (glyph, area, why, "öppet bredvid"), and a status badge follows it only when
   the row needs a hand (a receipt row unconfirmed or failed, Att bekräfta, a reminder that fired), never in the day
   cell. The open card's first line is the mark row: the chip, then the source and when in supporting
   ("Personalsystemet · 13 nov · 9 dagar", "Ekonomisystemet · skickat 09:00", or the time the source pushed it), then
   the one status (the receipt's badge or dot, the red "i dag", who it waits on). The title is level 2 everywhere, the
   summary body in secondary. The receipt keeps the check before its heading and rows with dot and word, and its row
   titles are now semibold. "Nästa som behöver dig", "Varför nu?" and the undo window (D70) are unchanged.
6. **A card across systems (artboard 10).** When a card's rows name a system other than the card's (a ref's first
   segment is the connector, D55), the card keeps one chip (the triggering system), and every row's meta line carries
   its own system: glyph, the system's word, the area's word, then the row's words ("Tidrapporteringen · Bemanning ·
   passet 07:00–16:00 blir obemannat"); Clew's own system is named without its area ("Kalendern · förslag …"). The
   receipt reads back per system ("Tidrapporteringen svarade 07:02", "Lönesystemet · kontrolleras igen 08:00"). The row in the list says "Personal · 3 steg
   i 3 system · …" and draws one glyph. A ref whose system the person cannot see, or a system with more than one area,
   draws no glyph rather than a wrong one.
7. **Anslutna system (artboard 9).** The list is in registration order, Clew's own rows last with "Clews egen" in
   their line; the connector page's title has the swatch and, under it, "2:a anslutna systemet · färg lila · direkt
   från källan · protokoll 2". Astryx has no swatch: the swatch is Astryx's colour-only `Badge` (empty label), with
   `role="img"` and a name that says the colour and the ordinal ("Färg lila, 2:a anslutna systemet", "Vit, Clews
   egen"). The colours are named in Swedish (blågrön, lila, orange, cyan, rosa, grå): the canvas wrote Astryx's English
   names, but a person reads this line. The Områden tab draws each area's chip; "Verktyg i menyn" is as before, and the
   room for "Visa nyckeltalet" and "Skickar kort" per area is the figures' (D54).
8. **The phone (artboards 11 and 12).** Hem draws rows on a phone too, the next step filling the line under the row
   with the `@` beside it (`AddToConversation`), 44 px under a finger through the theme's coarse-pointer sizes; the
   meta line wraps. The card the address names rises in Astryx's `BottomSheet` (`height="tall"`) with "Hem" and ✕ on
   its first line, the chip on its own line and the source under it, the title at level 2, and the next step and the
   secondary actions full width; the rest wraps as on the desktop. The greeting's date stands under it in supporting.

**Not built here.** The figure's three forms and the two tiles across on the phone (artboard 3, D54); the view's header
under an answer and in the panel, status fields as labelled badges, the view kinds' header (artboards 4 and 7); the
calendar family (artboard 6); tokens, the `@` menu, the review dialog, banners and toasts (artboard 8). The phone keeps
its one "Visa:" menu for the tabs (1.4.10 at 320 px) where artboard 11 draws a tab strip.

**Why.** The product owner saw every title at one size and weight, nothing saying which system a card came from, and
figures without a drawing (the review's "What was wrong, read from the code"). Weighed and left: a hue per area (one
system would look like several); a hue the administrator picks (D40: the administrator switches, never composes); a
hash of the id (neighbours get random-looking colours and two systems can collide); logos (D52: the systems are
generic); a rank computed from `created_at` without storing it (removing a system would move every later system to
another colour); Astryx's `neutral` variant for the sixth hue (it is a solid status fill and would read as the house);
the chip without its icon as the swatch (it would repeat the area's word in the list, where the system is meant).

**Replaces.** The phone's "every thread is a card in the list" (D50, D53 item 2): rows and the sheet now. Amends D40
and D41: the icon map lives in `packages/ui`. Every `Heading level={3}` with only `accessibilityLevel` varying is
replaced by the roles above.
