# D28 · The stream has two groups and three piles, and the day is drawn as one track

**Status:** accepted, implementation in progress · **Date:** 2026-11-04 · **Area:** ui

**Decision.** The start page groups open cards in two headings and parks the rest in three piles, as drawn on
artboards A and D of the canvas "Clew designutforskning · schemaläggning och uppmärksamhet"
(`docs/reviews/2026-11-04-design-exploration-scheduling-and-attention.md`):

1. **Nu** holds a card whose deadline is today or has passed, or that a reminder brought back today. **Senare**
   holds every other card with a deadline, each row carrying the weekday word ("tor", "fre") or the date in place
   of a colour; cards without a deadline are rows under **Till kännedom** at the end. The grouping is the pure
   function `streamGroup(thread, today)` in `@clew/contracts`, beside `attentionLevel`, which stays for sorting
   and for the sidebar's worst-level dot. Colour is reserved for today's deadline (error badge), a reminder
   (error badge) and receipts (success); the day word is text.
2. **Three piles** sit above the composer on every screen, as a single-select toggle group with a count each:
   *Pågår utan dig* (open, `waitingOn` set), *Inte nu* (open, `snoozedUntil` in the future, label "tillbaka
   06:00") and *Klart i dag* (handled or dismissed since the day's review). A pile opens its rows in place of
   the stream. On a phone the three do not fit one row and Astryx's toggle group never wraps, so there they are
   three buttons that wrap, at the end of the stream rather than on the dock, which keeps the dock's height and the
   toasts above it. The collapsed "Väntar på någon annan" section and the sidebar's "Redan hanterat" link go;
   `/hanterat` stays as the route of the third pile, with its filters.
3. **Snooze is its own column.** `thread.snoozed_until` (migration `0008`) replaces the sentinel
   `waitingOn === 'i morgon 06:00'`. `waitingOn` means waiting on someone else and nothing else. A snoozed card
   wakes when its time passes (the first read after it, and the 06:00 scan), and earlier when the scan changes its
   draft or a reminder fires; every wake writes `thread.woken` with the reason. This decision sets the default,
   next 06:00; D29 adds the picker.
4. **The day has a rhythm, drawn once.** The digest card at the top of the stream shows the day as one track:
   the 06:00 review, the interruptions used of the budget, the 12:00 and 16:00 bundles, and quiet from 17:00.
   The times are constants in `@clew/contracts` (`dayRhythm`) that the scheduler and the attention endpoint both
   read, so the page never hardcodes a time. `GET /api/attention` returns the rhythm with the state of each point
   and the time of each interruption pushed today. The budget keeps its D7-era wording: the assistant's cap,
   never a measure of the person. A point on the track is a moment, never a card (amended 2026-11-04, after the
   track drew one clock per card pushed by a 36-card scan): a scan pushes its cards in one go, so the cards it
   brought fold into one point with a count, a card pushed within `dayRhythm.graceMinutes` of the review or a
   bundle belongs to that point, and only the moments outside them are interruptions and count against the
   budget. Withdrawn the same evening: the track itself. The product owner found it read-only and of little value,
   and "Avbrott 5 av 3" told the person nothing. The digest is now one supporting line (the review's time, the threads
   read, the next bundle or the next review), the greeting sentence and the budget's promise; `GET /api/attention`
   keeps returning the rhythm, which the line reads for its times.
5. **Why is a token.** Every card and row shows its trigger reason as an Astryx `Token` ("Varför: du är chef"),
   not a tooltip, so it can be read, filtered and announced.

Astryx only: `ToggleButtonGroup` for the piles,
`Token` for the reason, `Badge` for today's deadline, `List` rows for Senare and Till kännedom. The dashed
border drawn on the "Inte nu" pile has no Astryx counterpart and is reported as a gap; until then the pile is a
plain toggle.

**Why.** The comparison of 35 inbox and attention surfaces in the review found that the products people keep
using hold one stream with a two-way split and secondary states as piles at the edge (Linear Priority/Other,
HEY's bottom piles, Todoist's overdue header), show urgency with time words and position rather than a colour
wall (Things, Todoist, iOS interruption levels), render the digest as a header with a count and one sentence at
times the person chose (iOS Scheduled Summary), and expose the reason an item appeared as data (GitHub
`reason:`). The five levels from "Clew uppmärksamhet" produced five headings and four colours on a page that
rarely has more than six cards; the product owner chose the two-way split on 2026-11-04. The snooze column is
needed because the sentinel string conflated two states the piles must tell apart.

**Replaces.** Narrows the canvas row "Clew uppmärksamhet" (session 7): the levels stay as a sort key, the
grouping by level goes. The sentinel `waitingOn === 'i morgon 06:00'` from session 4 is withdrawn.

**Amended 2026-11-05 by D48.** The reason and the area are text, never a colour.
