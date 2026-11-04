# D29 · "Inte nu" is a timed snooze with a visible landing time that breaks on activity

**Status:** accepted, implementation pending · **Date:** 2026-11-04 · **Area:** product

**Decision.** "Inte nu" on a card opens a picker, not a fixed rule (artboards B and D of the design exploration
canvas, `docs/reviews/2026-11-04-design-exploration-scheduling-and-attention.md`):

1. **Presets with the resolved time.** Om en timme (09:12), Efter lunch (13:00), I morgon (06:00 i
   genomgången), Nästa vecka (mån 06:00), and one preset from the calendar, "När jag är tillbaka från X", the end
   of the person's next meeting today. Every row shows the Stockholm time it lands on before it is chosen. The
   presets are computed by a pure function in the threads domain from the clock, `dayRhythm` and today's events.
2. **Free text in the same grammar as the composer.** "fredag kl 9", "om 20 min", "nästa vecka", "efter lunch"
   are parsed by a bounded, deterministic Swedish parser in the threads domain; the parsed time is shown beside
   the field before it is set. What the parser cannot read is not guessed: the button stays disabled and the
   composer is the fallback.
3. **One timer.** A snooze with a time other than the next 06:00 starts the D17 `reminder` workflow with a
   `silent` flag: when it fires the card returns to its place without the red "Påminnelse" badge and without the
   toast. `snoozedUntil` (D28) carries the time; the workflow id is stored in the audit row.
4. **Breaks on activity.** A scan that changes the card's draft, a reply on the thread, or a reminder the person
   set wakes the card early, cancels the timer and writes `thread.woken` with the reason. The picker says so.
5. **Conditions wait.** "Bevaka tills fakturan är attesterad" is drawn on the canvas and not built: a watch with
   a condition needs a connector that can be polled for the fact, and gets its own decision when the first real
   source is connected. The picker's "Eller bevaka tills" row is left out until then.

`POST /api/threads/:id/snooze` takes `{ preset }` or `{ until }` (ISO instant, at most 30 days ahead) and
returns the thread with `snoozedUntil` set and the label the card shows. The same picker replaces the fixed
"Påminn mig" menu from D17; a reminder is the same call without `silent`.

**Why.** Gmail prints the resolved time under each snooze preset and Superhuman and Linear take free text to the
minute; Linear and Gmail cancel a snooze when the thread moves, which is what stops a snoozed item from being
forgotten. A fixed "tomorrow 06:00" was the session-4 shortcut; the product owner chose times first and
conditions later on 2026-11-04 because a condition watch has no real source to poll yet.

**Replaces.** The fixed snooze to 06:00 from session 4 (now the default preset) and the fixed reminder menu from
D17 (10 seconds, 10 minutes, an hour, three hours), which becomes the same picker.
