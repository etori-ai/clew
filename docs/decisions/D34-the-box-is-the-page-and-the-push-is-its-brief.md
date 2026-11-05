# D34 · The box is the page; the push is its brief; one rail orders everything by time

**Status:** accepted, implemented 2026-11-04, amended 2026-11-05; the chips under the box and the centred heading replaced by D41 · **Date:** 2026-11-04 · **Area:** ui

**Decision.** The start page is "Vad vill du göra?" first, as drawn on rows four to six of the canvas
"Clew startsida · översikt i stället för en lista" (https://claude.ai/artifact/UiCMmm2fmEaq1M7cipBDvQ, review
`docs/reviews/2026-11-04-start-page-overview-exploration.md`):

1. **`/` is the box with a brief.** The column holds, top to bottom, a brief of at most three rows of what the push
   found (requirements due today first, then the proposals, then what has a day ahead), each row with its day where it
   has one and its next step as the one button; the heading "Vad vill du göra?" with the `ChatComposer` in the page
   flow (the `ai-chat-landing` template, never a docked dock on the landing); the connectors' standing actions for the
   role as chips under it (`/api/completions` `do` first, then the areas' `standing`, ten at most: a read opens its
   view, the rest is asked in the box); and the day as a line. A pull and a push produce the same card: typing
   "attestera en faktura" and the 06:00 scan both land on the connector's card. "Visa hela bilden" is one link away.
2. **`/oversikt` is the whole picture.** The greeting as the h1, Läget (the four figures, `lage.tsx`, back on the page),
   then the groups beside a rail: the groups in a `Grid` of three columns with the groups spanning two, the rail folding
   under them below 1024 px as the `dashboard-alert-rail` template folds its rail. The rail holds I dag, the three piles
   with their counts as rows (Pågår utan dig, Inte nu, Klart i dag with a meter) and the assistant's own schedule. The
   box sits in the column's `LayoutFooter`; a question from the overview opens `/samtal/:id`. The piles' toggle group in
   the toolbar (D28 item 2) goes. `/omrade/:area`, `/pagar`, `/inte-nu`, `/hanterat` and `/vy/kort/…` render the overview;
   `/vy/:capability` renders the box unless the address names an area.
3. **Four kinds, not one list with a timeline.** What the page feeds is one of four: a **requirement** (`krav`: a
   deadline or a primary action; the day word where there is a day, the next step as the primary button, black only
   where a day is set), a **proposal** (`forslag`: proposals or a proposing primary action without a day; a soft button,
   "nej tack" is an answer, never a day), an **event** (`handelse`: nothing to do and no day; one sentence, no connector
   button, gone when read) and a **figure** (Läget, never a thread). `cardKind(thread)` in `@clew/contracts` derives the
   kind; nothing is stored. The overview's groups are Nu and Senare for requirements (a requirement without a day sits
   last in Senare with no day word: "bara det som har en dag får en dag"), then **Jag föreslår**, then **Till kännedom**.
   This narrows D28 item 1: the grouping by deadline applies to requirements only, so a proposal is never a "notice"
   and an event is never a row that demands a decision.
4. **One rail, ordered by time relative to the person** (`apps/web/src/components/nav.tsx`, the `shell-side-nav`
   template, Astryx `SideNav`): Ny fråga on top; **Från mig** (Behöver dig with a red badge only for a deadline today,
   Jag föreslår, Till kännedom); **Pågår** (one row per card waiting on someone else, a warning dot, four at most, then
   Inte nu); **Samtal** (the person's own conversations, eight newest, the time today and the day word before, then
   "Alla samtal och klart i dag" which is `/hanterat`); and what is always there: Kalender, Områden as a collapsible
   item holding the areas as lenses, Administration for an administrator. The `TopNav` keeps identity, the attention
   line and Logga ut, and nothing else: the surfaces are rows in the rail, never tabs. The rail replaces `areas.tsx`
   and serves the calendar page too; the administration keeps its own sections (replaced by D45: it has the same rail).
5. **A notification is never its own inbox.** It has three homes: a toast beside the box now, a dot on its row in the
   rail until opened, and a row in the brief next time the page opens. A job the person asked for never counts against
   the attention budget; a push does. (The rail's "something happened since you were here" dot on a conversation and
   the job steps of a long-running conversation are drawn on the canvas and not built: nothing in the server marks a
   conversation as changed since last seen, and no conversation carries a Temporal job yet.)
6. **The same page without the model (D8).** The banner the shell already has says what still works: the push, the
   cards and their ladders, the chips, the planner, the calendar and undo. The box falls back to the router; the chips'
   line under the box changes to say they are the way in. Nothing is hidden.
7. **The theme.** Astryx Neutral extended with a sober municipal blue as the accent (`#1f4e8c`, `#8ab4f8` in dark),
   a cool tinted body (`#f3f6fa`) behind white surfaces and a tinted rail (`#eaf0f8`), every token a `[light, dark]`
   tuple (`packages/ui/src/theme.ts`). Status colours stay Neutral's; the areas keep their category tokens.

Astryx only: `SideNav` with `topContent` and collapsible `SideNavItem`, `Badge`, `StatusDot`, `List` rows for the brief,
`Grid` + `GridSpan` for the overview, `LayoutFooter` for the overview's box, `ChatComposer` in flow on the landing,
`ChatLayout` for a conversation. The alert-rail template's fold is a `useMediaQuery` hook, as in the template itself.
Not built from the canvas and recorded as the next steps: the search field in the rail (no endpoint searches
conversations and cards yet), the conversation's "something happened" dot, job steps on a running conversation, and
the ladder's `step` on the thread action contract (artboard E) so a read-receipt card gets "Läs rutinen" before "Jag
har läst"; the kommunikation mock still delivers no document to open.

**Why.** The product owner found the one-list stream gave no overview and leaned too hard on every item being an
action with a timeline, and said the original idea was a page scaled back to one box, "what do you want to do?", with
the platform's push on top. The exploration (review above) compared six page shapes against the personas and the
Astryx templates; the landing with the brief won because every persona opens the page with a question in mind and
the push answers it when no one asked, and because the four kinds let an event or a figure sit on the page without
pretending to be a task. The rail replaces a sidebar of areas with the person's own time axis, so a conversation, a
running task and a notification are found where they are expected rather than in a pile.

**Replaces.** Narrows D28 items 1 and 2 (the deadline grouping applies to requirements; the piles are rows in the rail
and the overview's side list, not a toggle group). Amends D31: the conversation still takes the column, but the box on
the landing is in the page flow and the overview's box is a footer; `ChatLayout` is for a conversation only. Replaces
the `TopNav` surfaces (Kalender, Administration) with rows in the rail.

**Amended 2026-11-05 (closer to the canvas).** The product owner found the first build far from G. Changed to match
rows four to six of the canvas:

- **No TopNav (item 4).** The shell is the `shell-side-nav` template as H1 and H4 draw it: `SideNavHeading` "Startsidan"
  with the person and unit at the top of the rail, Ny fråga and the search under it, the rail's own sections, and at
  the foot Kalender, Områden (collapsed until asked for, H3 item 7), Administration and Logga ut. AppShell `elevated`
  gives the grey rail beside a white page. Below `md` AppShell's own top bar carries the heading and the menu button,
  which is the G phone header. The attention line leaves the chrome; the overview's digest still states the promise.
  `Shell` takes `nav: { top, sections, footer }`; `useRail()` returns it for the start page and the calendar, and
  administration passes its own sections (replaced by D45).
- **The rail's search is built (item 4).** A `Typeahead` over what the cache already holds: conversations, open cards
  and areas; picking one opens it. No endpoint; a server search can replace the source later.
- **Conversations by day.** Samtal groups by Stockholm date (I dag with the time, I går, Tidigare), not by `dayWord`,
  which says "i dag" for every past day.
- **The brief (item 1)** is a `List` in a `Card` (the G note), each row a fixed day column (red "i dag" badge, the day
  word, or empty so titles line up), the title, the area and the trigger's reason, and the next step. A card whose
  action needs a choice first gets "Granska", which opens the card, instead of a button that starts disabled.
- **The box by place.** On the landing it has no scope line, a larger field and the placeholder "Skriv eller säg vad
  du vill göra …"; in a conversation it says "Det här samtalet" with "Ny fråga i stället" and ⌘K; at the foot of the
  overview it says "Ny fråga". Its accessible name is "Vad vill du göra" (in a conversation "Svara i samtalet").
  "Menar du" is back under the box while typing: a matching open card first ("öppnar kortet"), then the standing
  actions and the reads, then an earlier conversation; all of it works without the model. ⌘K is Ny fråga from
  anywhere (H3 item 1): in a conversation it starts a new one.
- **"Lägg till i samtalet" on the brief rows.** The G artboard draws one button per row, but the brief is where the
  landing shows cards, and without it a card could reach the box only through `@`. The row carries the same control as
  the card ("I samtalet ✓" once there); the card becomes a token in the box's drawer. On a phone the row's buttons sit
  under its text (two buttons beside a title do not fit 320 px).
- **`@` has a context.** The box sends `near`, the refs the person is looking at: in a conversation every card and row
  its turns touched (chips, a draft's card, a proposal's card), on the landing the brief, on the overview the cards in
  view, plus whatever is in the drawer or the field. `GET /api/objects?q=&near=` returns, with nothing typed, the
  context alone (its cards, their rows, proposed times; an item ref brings its whole card); with text, everything in
  scope with the context first, twelve at most. Before, an empty `@` listed every open card and every row.
- **The answer is the card (H1).** A turn records the open cards it is about in `MessageMeta.cards` (three at most):
  the chipped cards, else the open cards the question names (`matchCards` in `assistant/router.ts`: a card whose title
  shares at least half of the question's words). The transcript draws them in the assistant's turn with the page's own
  card (rows, buttons, receipt, undo), read from the same cache, so it is live. Without the model the turn's sentence
  is the card's own (summary and why now, `cardPath`); with the model, the named card is in its context as if pointed
  at and the model writes the sentence. A card already shown in the conversation is not drawn again. Asking never acts:
  the card's buttons do. The audit row carries the card ids.
- **The landing's shape.** The heading is centred at display size, the chips are centred under the box, eight at
  most, the day is one line at the foot ("I dag · 08:15 … · längsta luckan …", Hela veckan). On a phone the box is
  docked at the foot with the heading and chips above it, as on the G phone artboard.
- **The theme (item 7) is plain Astryx Neutral again.** The canvas is drawn in Neutral (Figtree, zinc, a black primary
  button); the blue accent and tinted body and rail were not on it and are gone. `theme.ts` keeps only D31's
  ChatLayout scroll padding.

Still not built from the canvas: H1's line of what the assistant did ("Läste attestlistan i Raindance, 0,8 s"), collapsing the rail (H1's button; the rows have no icons to collapse to), counts on
the chips ("Attestera fakturor · 3"; no mapping from a standing capability to the cards it produces), the figures in
the G header (H4 drops them once the rail is there), the "something happened" dot, job steps and the ladder's `step`.

**Amended 2026-11-05 by D36.** The landing's box is anchored from the top with the brief, and only the day line is
pushed to the foot, so "Menar du" never moves the field while the person types. "Lägg till i samtalet" is an icon
button (the box's `@`) on the brief rows and the cards, and the brief's rows centre their day and actions on desktop.

**Amended 2026-11-05 by D39.** The box rests on the column's centre line whenever the brief fits in the upper half,
and follows the brief when it does not; the day line is the `Layout`'s footer. "Menar du" still never moves the field.

**Amended 2026-11-05 by D47.** The filled button is for what is due today only. The overview's header is an `h1`, one line and an `InfoTip`; its group captions are gone. The box in the footer has no scope line, no shortcut and no model menu.
