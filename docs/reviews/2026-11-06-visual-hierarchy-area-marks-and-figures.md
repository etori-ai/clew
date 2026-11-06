# Design pattern: three levels, one area mark, one figure family · 2026-11-06

Requested by the product owner on 2026-11-06 with seven pictures of the product as built (a conversation with the
Mötesrum view under its answer, a conversation that read Viktigt nu, Hem for Hillevi, a receipt card, an open card
beside the column, a row in Behöver dig, a leave request): "the titles are all the same size and weight everywhere";
cards should be distinguishable by connector; icons; and what the figures should look like. Drawn on the canvas
**Clew · hierarki, områden och figurer** (Claude Design, https://claude.ai/artifact/YVw6FJL6YjKZprBAiAEA2f, private
until shared): five artboards, a spec sheet each. This review records what the canvas proposes and why, so the
product owner can decide; nothing here is built.

## What was wrong, read from the code

- **One visual size for every title.** `start.tsx`, `thread.tsx`, `panel.tsx` and `GenericCard` draw almost every
  heading as `Heading level={3}` (Astryx 17 px semibold) and vary only `accessibilityLevel`. The page's own title
  ("Hej Hillevi", "Vilket rum har flest platser?"), a group ("Senare · 4") and a card's heading are the same size.
  Only the card beside the column takes level 2.
- **The meta line is as large as the row's title.** `ThreadRow` draws the line under the title as
  `Text color="secondary"` at body size (14 px) beside a 14 px semibold title. The eye gets weight but no size step.
- **Nothing says which system a card came from.** The area is a word in the meta line ("Medarbetare · hr"). The
  connector already declares an icon per area (`MenuIconSchema`: people, chart, document, bell, clock, phone,
  calendar, book, link, search) and Clew draws it in the menu under Verktyg (D40, D41), nowhere else.
- **A status field in a view can read "Ja · Ja".** `view.tsx` draws two status fields without their labels when the
  values are bare, so the Viktigt nu embed showed "Ja · Ja" and "Nej · Nej".
- **Figures are a shape without a drawing.** D54 proposes the richer figure (label, value, tone, comparison, progress,
  opens); the canvas it came from drew four tiles with one look. Nothing said what a figure looks like inline, in the
  rail or when the source is silent.

## The pattern, artboard by artboard

### 1 · Three levels on every surface, a fourth for numbers

Every surface is a title, sections in it, and rows. Each gets an Astryx token and a place it may be used:

| Level | Token | Size | Where |
| --- | --- | --- | --- |
| The surface's title | `Heading level 1` | 24 px semibold | Hem's greeting, a conversation's title, a tool page |
| The open card | `Heading level 2` | 20 px semibold | the card and the view beside the column |
| Section | `Heading level 3` | 17 px semibold | "Behöver dig · 4", "Senare", "I dag", "Sedan i går" |
| Row | `Text weight=semibold` | 14 px | a card in a list, a row in a view, an item in a card |
| Meta line | `Text type=supporting` | 12 px secondary | area · why · when, under every row title |
| Body | `Text type=body` | 14 px normal | the answer, a card's summary, Varför nu |
| Value | `Text type=display-3` | 29 px semibold, tabular | only in a figure |

Rules: one title per surface; the meta line is always 12 px and secondary and never carries status; bold is a row's
title and nothing else; category is a mark, status a badge or a dot with its word, time is text; display-3 exists only
in figures; the visual level and the document level stay two props (`level`, `accessibilityLevel`).

### 2 · The area mark: colour says the system, the icon says the area

A mark in two forms. The **chip** is an Astryx `Badge` colour variant with the area's icon and the area's word, drawn
above a card's title, in a view's header in the panel, in a figure's corner and in an answer's embedded view. The
**glyph** is the same icon as `Icon color=secondary size=sm` at the start of the meta line in a row (lists stay calm:
no hue in a row). Colour never stands alone: the chip carries the word, the glyph sits beside the word.

- Six category hues from Astryx, in the order the administrator registers the systems (D23): teal, purple, orange,
  cyan, pink, gray. Blue is the assistant's and info; green, yellow and red are status. A seventh system starts over;
  the icon and the word still tell them apart.
- The hue is the **system's**, not the area's: Personalsystemet is teal in Medarbetare and in Mitt pass, so one system
  reads as one system.
- Clew's own areas (Kalender, Kontakter, Mötesrum, Sök) are the house: an outlined chip with no hue. Guests get the
  colours.
- The icon comes from the manifest as today; the hue list lives in `packages/ui` beside `branding.ts` and `theme.ts`
  (D38), and a page component asks for a system's mark and gets the Badge variant back. Nothing custom.

Weighed and left: a hue per area (one system would look like several); a hue the administrator picks (D40: switches,
never composes); a hash of the id (neighbours get random-looking colours); logos (D52: generic systems).

### 3 · The figure: one line from the connector, three forms in Clew

A figure is label, value, tone, comparison, progress and `opens` (D54). One mapping, `figureItems()`, draws it in three
forms the way `agendaItems()` draws the calendar:

- **The tile** (Läget on Hem): the chip top left, the tone top right as a `StatusDot` with its word (an `HStack` that
  wraps, so a long area and a long tone word put the tone under the chip; nothing is cut or overflows), the label in
  supporting, the value in display-3, then the comparison or a `ProgressBar` when there is a target, and last the name
  of the view it opens with a chevron. With `opens` the tile is a `ClickableCard`; without it a `Card` with no chevron
  and no shadow. Drawn states: ok, warn, alert (a `Badge` "Behöver dig" and a red border), none (no dot at all), a
  figure without a value (a sentence, never a button), a silent source (the registry's warning tile with "Senast läst
  06:00 · försöker igen 12:00"), and the skeleton.
- **The line** (Sedan i går, an answer that read a figure): glyph, label, the value bold and tabular at body size, the
  dot with its word, the comparison and the source with its time. No display size outside the tile.
- **The word** (the rail's "Hem · lugnt", the panel's tab when a view with a figure is open): the worst tone among the
  figures as one badge word.

The tone's words are Clew's, so every system sounds the same: ok = Lugnt, warn = Bevaka, alert = Behöver dig. One
number per tile.

### 4 · The answer is a sentence, the view is the proof

The embedded view under an answer gets the same header the view has in the panel: the chip, the source and the count
on one line, "Visa allt" at its end. Rows follow the row level (14 semibold, 12 meta). A number carries its unit as a
word after it when the field has one ("12 platser", not "Platser: 12"). A status field is a badge with one word: the
field's label becomes the word, and only the state that needs the person gets a status colour ("Inte kvitterad" in
warning, "Kvitterad" neutral), declared through the view's `tones` (D38). The assistant's own line keeps the spark in
accent: the only blue on the surface.

### 5 · The row says what and where, the card says why and what happens

Hem as built (D53, D63) with the pattern laid on. The row keeps its day cell, its title as a 14 px semibold link, its
buttons; the meta line becomes 12 px with the area's glyph first, and a status badge appears in the meta line only
when the row needs a hand ("1 rad obekräftad"), never in the day cell. The open card gets the chip above its title in
place of "Medarbetare · hr", with the source and the time in supporting beside it, and the title in level 2. The
receipt keeps the mark, the check before its heading, and the warning as a badge on the mark's line.

## The remaining surfaces (artboards 6 to 12, added the same evening)

The product owner asked whether every element a connector can expose, and the calendar, were covered. They were not;
seven more artboards close the gaps:

- **6 · Kalendern är huset.** The calendar page (week title at level 1, "Förslag" in the panel at level 2, "I dag" at
  level 3), the grid as the one place a title is 12 px (supporting semibold, time under), the event row at the row
  level, the gap row as secondary text on a dashed line. The calendar's chip is the outlined "Kalender"; the adapter
  (Microsoft 365, CalDAV) is never named on the page. A proposal is the assistant's: ✦, dashed border, info-tinted,
  the only blue in the calendar; "Förslag att bekräfta" the only badge.
- **7 · Tabell, post, text och sökträffar.** One header for every view kind (chip, source, count, controls at its end),
  drawn once by `DeclaredView`. A table on a tool page: the mark row, then the title at level 1, header row in
  supporting semibold, amounts tabular and right-aligned, a status badge only where something needs the person. A
  detail record: title at level 2, fields as `MetadataList`. A text view: Markdown headings start one level under the
  surface's title. Search hits: the number as a neutral badge, title 14 semibold, snippet 12, the meta line with the
  source's glyph and word, a warning badge only when the review date is old.
- **8 · Märket på små platser.** Three densities: the chip above a title; glyph plus word in a row, a composer token
  or the `@` menu; the word alone in text (the D8 banner, a toast). The review dialog is a card: title at level 2, the
  mark row under it, the counter as a neutral badge. The rail is the house and stays as it is.
- **9 · Anslutna system.** Where a person learns the colours: a swatch beside each source in the list and on the
  connector page with the ordinal and the colour's name in supporting; Clew's own rows have a white swatch and the
  words "Clews egen"; the list is in registration order; a removed system frees its colour for the next one, the
  others keep theirs. The Områden tab draws the area's chip beside its switches (Verktyg i menyn, Visa nyckeltalet,
  Skickar kort).
- **10 · Ett kort, flera system.** A job (D55): one chip per card, the system whose fact started it; every step
  carries its own system's glyph and word first in its meta line; the receipt reads back per system, a watch stays
  warn until it lands; the row in the list says "3 steg i 3 system" and shows no three glyphs.
- **11 and 12 · Telefonen.** Hem on the phone: two tiles across, the mark and the tone wrap, the row's buttons under
  the line at 44 px, the docked composer. The card in the bottom sheet: the chip on its own line, the source under it,
  the title at level 2, buttons full width. Holds at 320 px.

## What it would take

- `packages/ui`: the hue list and a `systemMark()` beside `branding.ts`; `figureItems()` beside `agenda-items.ts`.
- `apps/web`: `Heading level={1}` on page titles and `level={2}` on the open card and the view in the panel; the meta
  line in `ThreadRow` as supporting with the glyph; the chip row in `GenericCard`, `ThreadCard` and the panel's view
  header; the header on `ViewEmbed`; status fields in `view.tsx` as labelled badges; the figure tiles when D54 lands;
  the calendar page and `today.tsx`; search rows and `Sources`; composer tokens and the `@` menu; the review dialog;
  the admin list and connector page; the job card's step rows; the phone layouts.
- The connector protocol changes nothing: the icon is already in the manifest, and the tone's word is Clew's.
- Tests: `tests/a11y/structure.spec.ts` (one h1 per page, the chip's text names the area and the system, the figure
  tile's name carries the value and the tone's word), the panel-labels test for the status badge words.

## Decision needed

Whether to take the pattern as drawn (a decision of its own under `docs/decisions/`, next free number), and in which
order: the type levels and the meta line first (a day, no protocol change), the area mark second, the figure forms
with D54.
