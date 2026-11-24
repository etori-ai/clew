# The phone view, reviewed and refreshed

Date: 2026-11-23. Asked by the product owner: the phone view is poorly designed around its buttons, its settings and
more; evaluate it as a UX professional would, and refresh it so that it looks good, is clear, holds WCAG 2.2 AA, and
is easy to maintain with clear responsibilities in the code.

Scope: the web app at 375 × 812 and 320 × 640 with a touch pointer, signed in as the manager persona on the
development stack, light appearance: the header band, "Meny", the reminders, the person's settings, Sök, Hem, Att göra
and a work item, Kalender, Personal, Läget, Samtal, Alla verktyg and the person's own page.

Method: two readers that did not see each other's findings, then one synthesis. The first read the screens as a
design review (Nielsen's ten heuristics, cognitive load, three personas). The second measured: touch targets, reflow,
the header's boxes, what a fixed element covers, the sheets' geometry, type sizes and contrast, with a source scan and
an in-page scan by a design detector. Both were automated readers started by the session that then made the changes;
no person has reviewed the findings, and nothing was tried on a real phone or with a screen reader.

## What held

- Every control of the header and every drawer row is a 44 × 44 target; no page scrolls sideways at 320 px; nothing
  measured is under WCAG 2.5.8's 24 px.
- No text pair is under 4.5:1 on any screen (lowest: "Fråga AI", white on the information colour, 4.57:1).
- Esc closes the drawer, the sheets and the dialogs and returns the focus to what opened them.
- Läget's own page (`/units`) and Kalender's agenda rows are laid out for a phone already.

Heuristic score before the changes: 20 of 36 (error recovery not reachable read-only), "acceptable": the content is
the product's own, but the phone composition was the wide page stacked.

## Findings

| # | Finding | Measured | Kind | Outcome |
|---|---|---|---|---|
| 1 | The header band broke into two rows under 375 px: the name above, the controls below, the rest empty | The row needed exactly 375 px; 92 px tall at 320 px, 14 % of the window | Layout, 1.4.10 in spirit | Fixed |
| 2 | The focus ring was invisible in what the bell and the person open | Outline white, 2 px, on a white ground, with no theme saved | WCAG 2.4.7 | Fixed |
| 3 | Those two sheets were 92 % of the window for a few lines, with no visible close | 747 px sheet, 350 to 500 px of it empty; the close hidden until a keyboard reached it; "Min sida" and "Logga ut" 8 px apart in the middle | Layout, control | Fixed |
| 4 | Key figures stood two to a row at 375 px | 154 px cards: "−2,1 mnkr" over two lines, a word broken in the middle, a label clipped behind the card's own scrollbar on Personal | Legibility, 1.4.10 | Fixed |
| 5 | "Behöver dig" stood a screen and a half down on Hem | Its top at y = 1234 of an 812 px window, under the news and 642 px of key figures | Hierarchy | Fixed |
| 6 | The floating "Fråga AI" lay over content in the thumb's corner | 139 × 48 px over a row's "Öppna", a figure's value, a heading, row menus on Personal | Obstruction | Reduced: the mark alone, 48 px |
| 7 | The person's own page had a second way to the settings, on another surface, and its buttons were cut at 320 px | "Inställnin…" and "Fråga assisten…"; a centred dialog with the content of the header's sheet | Consistency, 1.4.10 | Fixed: one way to the settings, and with one button fewer "Fråga assistenten" is drawn in full at 320 px (seen in the browser) |
| 8 | Att göra is a two-column table on a phone | Title column 157 px, a status column of 120 px that is empty in four rows of six; rows 119 to 155 px; the first at y = 538 | Layout | Fixed in a change of its own, the same day: a list of rows below 768 px (D130 item 19, amended) |
| 9 | A work item's "Godkänn" and "Avslå" look the same, 8 px apart, at the top of the page | Both secondary, at y = 228 | Error prevention, reach | Left |
| 10 | Three names for one place (Start, Hem, Startsidan), and "Samtal" means two things | | Language | Left |
| 11 | Heading levels skip on Kalender (h1 to h5) and on the person's page (h1 to h3) | | Structure | Left |
| 12 | "Försenad" is drawn three ways (a red badge, an ochre dot with lowercase text, an amber count) | | Consistency | Left |
| 13 | A text field's border is 1.48:1 against its ground, and a sheet's grab bar 1.20:1 | Astryx's defaults | 1.4.11, arguable | Left |
| 14 | Kalender's head is three rows of controls on a phone, and nothing under it scrolls into them | 345 px that do not scroll at 375 px, 42 % of the window; 361 px, 56 %, at 320 px | Layout | Fixed in a change of its own, the same day: the title and two rows of controls from 360 px (D74, amended); `touch.spec.ts`'s case, red on `main` since 2026-11-20, passes |

## What was changed, and who owns it now

One owner per concern, so the next change has one place to go:

- **`createHeaderBandTheme` (`packages/ui/src/theme.ts`) owns the colours of what opens from the band.** Every token
  the band changes is set back on Astryx's `popover` and `bottom-sheet` to what the page resolves it to. Nothing that
  opens there wraps itself in a theme any more (finding 2).
- **`Flyout` (`packages/ui/src/flyout.tsx`) owns the choice of surface** for what a band control opens under itself:
  a popover with a pointer, a sheet at the height of its content with a visible "Stäng" on a touch phone. The bell and
  the person both use it (finding 3).
- **`SiteHeaderPerson` (`packages/site-header/src/person.tsx`) owns the person and is the one way to the settings.**
  It is three small parts: the button, the appearance choice, and the surface. The shell's copy of the dialog, the
  address `?settings=1` and the page's "Inställningar" are gone (finding 7).
- **`SiteHeader` owns the phone bar's row**: marks alone, edge to edge (finding 1).
- **`FigureRow` (`packages/ui`) owns how many key figures stand in a row** (finding 4), and Hem decides its own order
  on a phone (finding 5).
- **`AssistantCorner` owns the floating button**, the mark alone on a phone (finding 6).

The decisions that record them: [D39](../decisions/D39-compact-header-profile-and-reminders.md) and
[D130](../decisions/D130-clews-look-and-layout-are-the-startsidan-prototypes-built-with-astryx.md), both amended
2026-11-23.

## What was left, and why

Att göra as a table (8) and Kalender's head (14) were first left here as redesigns of their own, and were then done as
two changes of their own on the same day, each with its decision's amendment; they land together with this one.

- **The decision buttons of a work item (9)** are how a decision is made, with decision records and canvases of their
  own; that is not a refresh. Whether "Godkänn" may be drawn as the primary choice is a product question: the two are
  equal today so that Clew does not lean on a decision.
- **Names (10) and "Försenad" (12)** run through every width, not the phone alone.
- **Heading levels (11)** are real markup faults, small, and on pages this change did not otherwise touch.
- **The field border and the grab bar (13)** are Astryx's defaults; a sheet now has a button that closes it, so the
  grab bar is no longer the only visible way out.
- **The floating button still stands over the page** (6): a third of what it covered, not nothing. Hem still shows it
  beside its own line to ask.

## Not verified

The specs the three changes touch were run together, 388 cases in twenty spec files; the whole suite was not. Two
cases fail, and fail the same way on `main` without these changes: `reflow.spec.ts` "the row keeps what needs the
person readable on a short screen" and `undo.spec.ts` "sending the invitations keeps the row with the receipt". A
third that was red on `main`, `card-actions.spec.ts` "the calendar on a phone", measured the calendar's head from the
top of the screen as it was before the page frame; it now holds the amended head (D74) and passes. One case of
`admin-appearance.spec.ts` failed once on a race between a field's status and its live region, and passed six times of
six when repeated; it passes on `main`.

No real device: a swipe to close, the on-screen keyboard over Sök's results and the safe areas are unseen. No screen
reader. The dark appearance and a saved theme were not walked by the readers; the theme change is covered for both by
how it is built (it reads the page's resolved tokens) and by the specs' contrast measure in the light appearance only.
