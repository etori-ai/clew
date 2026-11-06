# D58 · A click on the calendar's grid starts a booking

**Status:** accepted · **Date:** 2026-11-06 · **Area:** ui

**Decision.** On the calendar page, a click or a tap on an empty place in the grid opens "Ny bokning" with the time
filled in, as a dragged span already did. `EventCalendar` (`packages/ui/src/calendar.tsx`) does it through FullCalendar's
`dateClick`, behind the same `onSelectRange`. A click on an entry still opens the entry.

1. **A click gives an hour, from the row clicked.** An hour is what the "Ny bokning" button starts with. The start is the
   30-minute row the person sees, not the 15-minute snap under the pointer.
2. **A day with no clock starts at nine.** The month and the all-day row hand over a date and the form needs a time, so
   they open at 09:00–10:00 on that day.
3. **A click is heard outside office hours.** A drag stays inside them (`selectConstraint`), and across whole days it
   still opens nothing. A click has no such limit, because the form has none and a click that does nothing is what this
   decision removes.
4. **A phone is unchanged.** The page passes no `onSelectRange` at phone width, so the list and the button remain its
   path. A touch screen wide enough for the grid gets the tap.
5. **The keyboard path is unchanged.** The button is that path. D27 §4 holds: `dateClick` is not relied on by keyboard.

**Why.** The product owner, 2026-11-06: "När man klickar i kalendern så händer inget man måste dra." `selectMinDistance`
asks for 4 px of movement, so a press without movement was ignored and nothing on the screen said a drag was wanted.

Dropping `selectMinDistance` instead would have kept one code path, but `select` obeys `selectConstraint`, so the shaded
hours would stay silent, and on a touch screen it starts only after a long press. A press that moves a few pixels inside
one snap fires both `select` and `dateClick`. `dateClick` comes last and wins, so that press is a click too, and
`tests/a11y/calendar.spec.ts` holds that order to a FullCalendar upgrade.

**Replaces.** Widens D32 §4: "a span dragged on the grid only fills it in" now holds for a row clicked too.
