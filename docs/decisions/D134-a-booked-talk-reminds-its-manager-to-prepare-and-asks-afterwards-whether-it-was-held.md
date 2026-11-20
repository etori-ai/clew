# D134 · A booked talk reminds its manager to prepare, and asks afterwards whether it was held

**Status:** provisional (accepted once managers have had the cards through a real round and say whether five working days and one reminder is right) · **Date:** 2026-11-20 · **Area:** product

**Decision.** Two cards hang on the time a talk is booked for
([D132](D132-when-a-talk-is-booked-is-the-talks-own-record-and-the-calendar-holds-a-copy-of-the-invitation.md)),
both asked for by the talks connector's scan and derived from the talk's record and the clock each time, as the
card of [D133](D133-a-talk-follows-its-meeting-by-the-events-id-and-only-the-manager-changes-it.md) item 5 is.
Nothing is stored for them and no timer runs.

1. **Before.** A set number of working days before the booked start, the manager whose booking it is gets one card,
   "Förbered utvecklingssamtalet", due the day of the talk. It leads to the talk, where the action points from last
   time already are. The number is the round's (`talk_round.prepare_days`, migration 0082): the same for the whole
   organisation, five when nothing else is said, from 0 to 30, and 0 is no reminder. An operator sets it when
   opening the round (`scripts/talk-round.ts --prepare-days`). A working day is Monday to Friday. One card, no
   repeat: it is resolved when the talk starts.
2. **How the manager prepares is theirs.** Clew holds no preparation: no form, no checklist, no text. The card says
   that a talk is coming, and nothing about what to do with that.
3. **After.** From the day after the booked time, while the talk is not marked held, the same manager gets the card
   "Hölls utvecklingssamtalet?". The talk's tab says the time has passed and offers the two answers. *Markera som
   hållet* marks it held on the day it was booked for, not the day the button is pressed. *Samtalet blev inte av*
   takes the time off, so the talk lacks a time and is booked again. It is offered for an invitation, which the
   manager whose it is ends with the decision `missed` on `POST /api/talks/:personId/booking/calendar`: that reads
   no calendar, leaves the meeting there as what was once planned, and ends the person's latest invitation, never
   an older one whose talk was held. A time set by hand is taken off with Ta bort tiden, as at any time, so there is
   one button for it and not two.
4. **Only the manager whose booking it is gets the cards**, and only while they manage the person. Another manager
   of the person reads the same on the talk's tab and may mark it held.
5. **The cards name nobody** (vision principle 7): the person is the row's subject, and the card opens the person's
   place in the round.

**Why.** The product owner said on 2026-11-19 what preparing means for a manager: it is enough to be told that it is
time for a talk with a person and that they need to prepare; how they prepare can be left to them. What preparing
means for the employee is not specified yet and waits. The question afterwards comes from D132: booked is not held,
and without it a talk stays booked until someone remembers to mark it.

Alternatives weighed. *A timer per booking, as an action point's card has*: rejected. A booking changes, moves and
ends, and each change would have to reschedule or cancel a workflow; the scan reads what holds now and needs
neither. The cost is that a card appears at the person's next scan, the nightly one or their first visit, which is
when they would see it. *The number of days per manager or per unit*: rejected, the round is the organisation's and
so is its rhythm. *Repeating the reminder*: rejected, one card that stays until the talk starts is the reminder.
*Marking held on the day the button is pressed*: rejected for a talk whose booked time has passed, since the day it
was booked for is the day it took place. *The person's name on the card*: rejected, as for every card of Clew's own
modules; the manager sees who it is where the card leads.

**As built, 2026-11-20.**

- `bookingAsks` in `apps/server/src/modules/talks/domain.ts` is the whole rule: prepare from the round's number of
  working days before the start until the start, nothing from the start to the end of that Swedish calendar day, and
  held from the next day.
- A card's identity is one per person and round for each kind, and its revision is the booked span: a talk moved to
  another time is a card that comes back, and a handled card stays handled while the time stands.
- The round's number is in the audit row `talks.round_opened` and in the export.

**Not established.**

- Whether five working days and a single reminder is what managers need. Nothing outside the repository has
  tested it.
- Public holidays: a working day is Monday to Friday, with no holiday calendar.
- The employee is told nothing beyond the calendar invitation, and their preparation is not specified.
- The card "Hölls utvecklingssamtalet?" stays until it is answered or the round is closed; nothing escalates it.
- A page for the operator's choice of days: it is the round script's option until the round has a page.
- No screen-reader pass has been made of the banner or the cards.

**Replaces.** The third point under "Not established" in D132.
