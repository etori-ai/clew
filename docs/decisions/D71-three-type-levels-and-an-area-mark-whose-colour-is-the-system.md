# D71 · Three type levels on every surface, and an area mark whose colour is the system's

**Status:** accepted, built 2026-11-06 on `main` (the foundation, the row and the card, a card across systems,
Anslutna system and the phone); the figure forms, the views and answers, the calendar family and the mark on small
places are built by the sessions that own those files (see "Not built here"); the type sizes to be changed by [D115](D115-the-startsidan-prototypes-version-1-0-is-the-reference-for-clews-look-and-layout.md) (provisional, 2026-11-11; not built, so this record still binds what is built); the three levels and the area mark stand · **Date:** 2026-11-06 · **Area:** ui

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

**Amended 2026-11-06, the calendar family (artboard 6).** Built on `main` by the session that owns the calendar. The
calendar is Clew's own, the house; amends D27 §3 (how an entry looks) and keeps D32 (one family, one mapping):

1. **Levels.** The page's title is the week, the day or the month at `Heading level={1}` on every width ("Vecka 45 ·
   2–6 november 2026"; the phone's "Vecka 45" was level 3 drawn as 1). The panel beside the grid is the proposal card:
   the mark row (the outlined "Kalender" chip, "Kalendern · vecka 46" in supporting, the one badge "Förslag att
   bekräfta", or the dot "Hanterad"), the thread's title at level 2, the proposals as rows with the day in the start
   cell, the person at 14 semibold and the time in supporting. I dag on Hem keeps "I dag" at level 3 with "Hela veckan"
   at its end; its rows and every list (`EventList`, the phone's week) are the row level: the start tabular semibold in
   its cell, the title 14 semibold, the meta line with the length and the place ("30 min · Personalrummet").
2. **The grid is the one place a title is 12 px:** the title in supporting semibold, the time and the place (or who a
   samtal is with) in supporting under it, each one line ending in an ellipsis. A block in a week's column too short
   for two lines keeps its title, and the time stays in its accessible name ("Morgonmöte ledningsgrupp 08:15–08:45 ·
   A12, bokat"). The month is one supporting line: the start, then the title.
3. **The only blue in the calendar is the assistant's.** A meeting, and a booked samtal, is neutral:
   `--color-background-surface` with a `--color-border-emphasized` edge, thicker at the start; the past has the quieter
   `--color-border` edge, never opacity, so its meta line keeps 4.5:1. A drawn proposal carries "✦" before its title on
   every calendar surface (the grid, the panel's rows, lists, a proposal card's week agenda), seen and not read (the
   word "förslag" ends its name), on `--color-info-muted` with a dashed `--color-border-info` edge and
   `--color-on-info-muted` text. No hue and no icon in a cell: the system colours are the cards'. The week agenda on a
   proposal card draws a proposal as a blue `Token` (purple is a system's hue now) and a booked samtal as a green one,
   a status.
4. **`agendaItems()` stays the one mapping (D32)** and now carries the marker, the place and the row's meta line, and
   takes the day's free gaps as `gap` rows for I dag ("Ledigt till 17:00", the longest with "Längsta luckan · jag
   bokar inget här utan att fråga"); `EventCalendar` and `WeekAgenda` draw no gap. The adapter (Microsoft 365,
   CalDAV) is never named on a calendar surface; the source is "Kalendern".

Not as drawn: Astryx's `List` has no dashed divider, so the gap row stands on the list's ordinary divider and is told by
its secondary text and its words. The artboard's grid line "10:00–11:00 · förslag" names the person instead ("·
Anna Lindqvist"); the kind is in the name and in the ✦. The panel keeps the sentence on when invitations go and the
reply field, which the artboard does not draw.

**Amended 2026-11-06, the views, the answers and the small places (artboards 4, 7 and 8).** Built on `main` by the
session that owns the views and the conversation. Two small, additive protocol changes and three rules:

1. **A unit and a noun (protocol, additive).** A view field may carry `unit: { one, other }` and only on a `number`
   (`viewProblem` refuses it elsewhere, so the manifest loader and `connector-check` fail a connector that puts one on
   another format); a row then reads "12 platser", "1 plats", "11 200 kr", never "Platser: 12", and a table
   end-aligns it. A `table` or `list` may carry `noun: { one, other }` for the count in its header ("Ekonomisystemet · 3
   fakturor", "Kalendern · 7 rum"); without one a row is a "rad". Both are optional, so every protocol-2 connector
   stays valid; the published schema is regenerated. Swedish needs the two forms (plats/platser, faktura/fakturor),
   which is why neither is a single string. The calendar's rooms and the fixture views declare them where the unit
   alone says what the number is (seats, an amount, leave days); a table with several numbers of one unit (absence
   days per kind) keeps its labels.
2. **A status is one badge with one word.** A bare yes/no status takes the field's label as its word ("Kvitterad",
   "Inte kvitterad"), so two fields never read "Ja · Ja"; the view's `tones` (D38, keyed `true`/`false` for a yes/no)
   give a status colour only to the state that needs the person, the other is neutral (a yes carries a check). A
   status value that is a word and has no tone is supporting text, not a badge (artboard 7: "Att attestera" beside
   "Förfaller i dag"). In a list the badges stand at the row's end with its `@`. Viktigt nu now declares one field,
   `acknowledged` as "Kvitterad" with `false` in warning, in place of the two yes/no fields.
3. **One header for every view kind, drawn by `DeclaredView`.** The chip of the area whose `standing` offers the
   capability (else the capability's menu row, "Mötesrum"; else the system's one area; else the system's word alone,
   then not repeated), the source and the count in supporting, the view's controls or, under an answer, "Visa allt" at
   the end of the line. A tool page draws its title at level 1 under that line; a record's title is level 2 (its
   outline level under the surface's title); a text's Markdown headings start one level under the surface's title.
   Under the latest answer the view is a `Card` with that header and three rows ("3 av 7 rader. Inget av det sparas på
   Startsidan."), in the order the capability returned them: the answer sorts, the view follows, the web never sorts.
4. **The small places.** Composer tokens, the person's chips above their bubble and `@` rows carry the glyph of the
   system the ref names (`useObjectMark`), never a hue; the review dialog has the mark row under its title with the
   counter "1 av 3" as a neutral badge; search hits start their meta line with the source's glyph and word, and only an
   old review date is a warning badge ("14 månader sedan"). The D8 banner names a silent system in words at the top of
   every page (Shell, from the source statuses on `GET /api/threads`): "Ekonomisystemet svarar inte sedan 06:00", which
   cards may be old, that what is sent is queued and read back, and "Försök igen"; it is spoken once. A toast names the
   system and where the card lies, without a glyph.

Not built: a text view's own execute as its button ("Jag har läst" under the text, artboard 7). A view has no
execute in the protocol, and an execute outside a card would have no receipt, ledger row or undo (D45, D47); the
receipt stays the card's. Astryx draws a table's header cells and a `MetadataList`'s labels in its own type; Clew does
not restyle them (artboard 7 draws them 12 px supporting). `TypeaheadItem` has no end slot, so the `@` row says what
a thing is under its word, not at the row's end.

**Amended 2026-11-06, the figure's three forms (artboard 3).** Built on `main` with D54 by the session that owns the
figures. One mapping, `figureItems()` in `packages/ui/src/figure-items.ts` beside `agenda-items.ts`, takes an area's
figure and its mark to the three forms, drawn by `FigureTile`, `FigureTileSkeleton` and `FigureLine` in
`packages/ui/src/figure.tsx`. The tone's words are Clew's and fixed: ok is "Lugnt", warn "Bevaka", alert "Behöver dig";
none draws nothing.

1. **The tile (Läget on Hem, `apps/web/src/components/lage.tsx`).** After the groups, under "Läget · <unit>" at level 3,
   one tile per area with a figure in the areas' order, in a `Grid` (180 px least, four at most; two across on a
   phone). The chip top left and the tone top right in an `HStack` that wraps, so the tone goes under the chip when both
   do not fit: a `StatusDot` with its word, alert as an error `Badge` "Behöver dig" and the card's outline in error. The
   label in supporting over the value in `display-3` with tabular numbers; then the comparison in supporting, or a
   neutral `ProgressBar` in its place when the figure has progress; last the view's title with a chevron when it
   `opens`, and the whole tile is then a `ClickableCard` (low elevation) linking to the view in the panel (`open=`,
   D50). Without `opens` it is a `Card` with no chevron and no elevation, a group named like the link. A figure without
   a value is a sentence and never a link. A silent source is the muted card with the chip, a warning `Badge` "Svarar
   inte", "<source> svarar inte." and "Senast läst 06:00 · försöker igen 12:00". Loading draws four skeletons in the
   tile's shape. The tile's name is "<area>: <label> <value>, <tone's word>. Öppnar <view>".
2. **The line (`FigureLine`, `apps/web/src/components/figure-line.tsx`).** The area's glyph, the label in supporting,
   the value semibold and tabular at body size, the dot with its word, then "<comparison> · <source> <time>" in
   supporting; it wraps as words do, and no piece begins with a separator, so a wrapped line never starts with "·". Sedan i går draws the figures whose tone is warn or alert this way; under an answer
   it is mounted by the session that owns the conversation, for the areas the answer's view names.
3. **The word.** The rail's Hem badge is the worst tone among the person's figures in lower case ("lugnt", "bevaka",
   "behöver dig"), success, warning, error. The panel tab's word for a view with a figure is left to the views.
4. **The red outline is a theme variant.** Astryx's Card has tinted variants but no outlined status; the theme adds
   `card` `variant:alert` (the card background, an inset `--color-border-error` outline) the way it adds the gray and
   house badges, with module augmentation of `CardVariantMap` in `figure.tsx`. ClickableCard composes Card, so both take it.
5. **The bar is neutral.** Artboard 3 draws the bar in the text colour; Astryx's `ProgressBar` has no such variant, and
   accent is the assistant's blue, so the bar is `neutral`.
   **Amended 2026-11-10 ([D98](D98-the-installations-theme-and-logo-are-saved-in-clew-by-an-administrator.md)).** The
   variant stays `neutral`, and Clew's base theme now draws it as the artboard does: the fill is `--color-text-primary`
   and the track `--color-track` (`packages/ui/src/theme.ts`). As Astryx Neutral ships it the neutral fill is
   `--color-text-disabled` on a track of `--color-border-emphasized`, measured at 2.1:1 in the light appearance and
   1.0:1 in the dark one (the same grey), under WCAG 1.4.11's 3:1 for a bar whose label is hidden; it is now 13.9:1
   and 6.5:1. The track no longer follows the emphasized border, which an installation's theme may set to any colour.
   Open: the week card's `warning` bar for a day over 80 % is 1.0:1 on the track in the light appearance (4.4:1 in
   the dark one); the status colours are Clew's own and that bar needs its own decision.


**Amended 2026-11-07 by [D74](D74-one-page-header-for-every-surface.md).** A tool page's title comes first, with the
view's controls at the end of its line and the mark row under it.
