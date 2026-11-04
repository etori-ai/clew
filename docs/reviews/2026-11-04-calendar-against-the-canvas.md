# Review: the calendar page against the canvas row Chef-kalender (2026-11-04)

What was compared: the calendar page after D32 (session 23, branch `worktree-kalender`), rendered through the
a11y harness at 1280 × 800 and 375 × 667 with the mocked API (`CLEW_SCREENS=1 … playwright test -c tests/a11y
screens.calendar`, images in `test-results/screens/`), against the canvas row Chef-kalender as the calendar
component survey described it (`2026-11-04-calendar-component-alternatives.md`, "Where the calendar stands"):
five columns on an 08–17 hour axis, bookings as grey blocks, proposals as outlined blocks, a Dag / Vecka / Månad
switch in the header, a "Ny bokning" button, and the panel text "Dra ett förslag i veckovyn för att byta tid".

## What matches

- **The week.** Five weekday columns on an hour axis, 07–18 stretched to the week's meetings, office hours plain and
  the rest muted, a `now` line in the accent. Bookings are grey blocks (`--color-background-gray`), a drawn proposal
  an outlined purple block, a booked samtal green: the three kinds the agenda card already uses, same tokens.
- **The header.** The h1 names the span ("Vecka 46 · 9–13 november 2026"), previous / I dag / next and the date
  picker beside it, the Dag / Vecka / Månad `SegmentedControl` and the primary "Ny bokning" at the end, all in one
  Astryx `Toolbar` with one control size. The canvas drew the switch and the button; they are now there.
- **The panel.** Unchanged from session 22 (a nested `Layout`, the reply field pinned), with one sentence rewritten:
  "Öppna ett förslag i kalendern för att flytta det" replaces the canvas's "Dra ett förslag i veckovyn", because
  drag is never the only way (D27 §4) and the sentence must name the path that works for everyone.
- **The dialogs.** Ny bokning is the `form-wizard-dialog` shape (title, two time fields side by side, guests, room,
  the check and the two buttons). An opened entry shows the day around it above its details, as D9 asks.

## What differs, and why

- **Weekends are hidden** (`weekends={false}`), as in session 19; the canvas drew five columns too.
- **The phone** is not a five-column grid but FullCalendar's list for the week and its month grid for the month
  (product owner, 2026-11-04). The list reads top to bottom with one heading per day; the toolbar wraps into three
  rows (view menu, Förslag, Ny bokning) at 375 px, which is more than the canvas drew but each row is one control.
- **The proposal panel below 1024 px** opens from a "Förslag · n" button as a `Drawer`, following the responsive
  guide's three-two-one contract; the canvas only drew the desktop.
- **Month cells show dots and titles** (`dayMaxEvents`), not blocks; the canvas did not draw a month.

## Found and fixed while comparing

- The month view's column headers showed the first row's day numbers ("5 6 7 8 9") because the week's day heading
  was reused; the month now shows weekday names only.
- Overlapping weeks at a month's edges were deduplicated by event id alone, which dropped whole weeks when ids
  repeat (the mock's do); an occurrence is now one id at one start.
- Today's day header in the list view set secondary text on the accent background (axe `color-contrast`); the list
  heading is now one line, today told by the accent colour of the text.
- The three segment labels do not fit 320 px under the 1.4.12 text-spacing overrides; a phone gets an adaptive
  `DropdownMenu`, as the piles do (D31 §5).

## Left open

- A manual screen-reader pass on the dialogs and the view switch (VoiceOver, NVDA).
- The live Chrome pass against Nextcloud: create, move and cancel a booking, drag a proposal.
- The canvas itself should be redrawn to the Astryx shapes (the rule in HANDOVER §7): the month view, the phone list
  and the two dialogs have no artboard yet.
