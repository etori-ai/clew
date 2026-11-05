# D49 · A card has one time action, and it always says when it is back

**Status:** accepted · **Date:** 2026-11-05 · **Area:** product

**Decision.** Inte nu and Påminn mig stop being two choices on the same card. The product owner left the choice to this
session on 2026-11-05: "Gör det val som är mest logiskts och mest användbart."

1. **One time action per card.** An open card has `Inte nu`: in view on a card and under `Fler val` on a row. A card that
   waits on someone else has `Påminn mig`, since it is already out of the person's way and there is nothing to put aside.
   The two never stand on the same card, and neither list sits a second time under `Fler val`. The open thread
   (`apps/web/src/components/thread.tsx`) uses the same picker instead of its fixed button to 06:00, through
   `useSnoozeRows` and `TimePicker` in `apps/web/src/components/card.tsx`.
2. **One way back.** When the time comes the card comes back the same way from both: first under Nu for the day, the
   red "Påminnelse" badge, the reason on its trigger, and the persistent toast with Visa. `surface` in
   `apps/server/src/threads/usecases/reminders.ts` has one path. A snooze still writes `thread.woken` with the reason
   `time`, a reminder `thread.reminded`, so the audit trail keeps what the person pressed. This covers the default too: a
   snooze with no time, which only the assistant's confirmed action sends now, is a reminder at the next 06:00.
3. **Inte nu keeps its pile and its break.** The card lies under Inte nu until then, the page says so
   (`Jag påminner dig i morgon 06:00. Kortet ligger under Inte nu tills dess.`), and `Ta upp nu` and Ångra still end
   the timer. Activity still wakes it early (D29 §4). That ends the timer, so the word the person was promised goes out
   at once: a `woken:` delivery on the scan path, as the refresh path's `work:` delivery already did.
4. **A reminder never replaces who a card waits on.** `remind` keeps a real `waitingOn`, and the card's state line says
   `Väntar på skyddsombudet · påminner dig i morgon 06:00`. Ångra leaves it where it was. When the reminder fires
   the card comes to the person, `waitingOn` is cleared so it is under Nu where Visa looks for it, and the trigger keeps
   `Väntade på skyddsombudet`.
5. **What stays.** `POST /api/threads/:id/remind` and its cancel stay; they serve the waiting card. The endpoint still
   parks a card that waits on nothing under `påminnelsen 10:16`, which no surface reaches any more but timers already
   running do. `ReminderInput.silent` keeps its name for the workflows already running and means "this is a snooze's
   timer". A snooze that is due has no quiet path left, so no data or workflow migration is needed. The sweep's
   quiet wake covers only a snooze without a timer row, which is legacy data. `Om 10 sekunder` stays on the waiting
   card's picker alone; `om 1 min` under Skriv själv shows the same return on an open card.

**Why.** The two looked different and were not. Both used the same presets and the same picker, and both took the card
out of Behöver dig: Inte nu by `snoozedUntil`, Påminn mig by a made-up `waitingOn`. So the label this session had written,
`Påminn mig · kortet ligger kvar`, was false: the card did not stay. The only real difference was the way back, and a
quiet return is the wrong default for someone who has just chosen a time, since the card returns to the middle of a list
with nothing pointing at it. It also cost the person a decision they cannot be expected to make from two rows with
the same times. The assistant already treated them as one (`/\binte nu\b|\bsenare\b|\bi morgon\b|\bpåminn\b/` in
`apps/server/src/assistant/verbs.ts`), and Gmail, Apple Mail and Superhuman each have one such action, with the item back
on top. D29 cited Gmail and had already written that a reminder was the same call.

Keeping both was rejected for that reason. Keeping only Påminn mig was rejected because its parking was the false
statement: "Väntar på påminnelsen" under Pågår utan dig, when nothing goes on without the person. Keeping only a quiet
Inte nu was rejected because it loses the one thing a time is for. The price is noise: several cards that come back
at once give one toast each, and D28's Nu now also holds what the person put off to today. That is a person's own
request rather than an interruption, so `kind: 'reminder'` stays outside the attention budget.

**Replaces.** D29 §3's `silent` return and the sentence that a reminder is "the same call without `silent`": a reminder
and a snooze now differ in where the card waits, not in how it returns. D17's reminder on any open card, which is
narrowed to a card that waits on someone. D48's "Not changed" paragraph on two sub-menus and its point that a row
holds two time pickers.
