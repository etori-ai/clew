# D133 · A talk follows its meeting by the event's id, and only the manager changes it

**Status:** provisional (accepted once a manager has moved and cancelled a talk's meeting in a real calendar and settled it in Clew) · **Date:** 2026-11-20 · **Area:** product, integrations

**Decision.** [D132](D132-when-a-talk-is-booked-is-the-talks-own-record-and-the-calendar-holds-a-copy-of-the-invitation.md)
made the booking of a talk Clew's own record and the calendar event a copy. A copy can be changed by anyone with
the calendar. This decision says what happens then, and keeps three things apart by name everywhere, in the code,
on the page and in the documentation:

- **The talk** (samtalet) is what holds: its time, its state and whose booking it is, in the talks module.
- **The invitation** (inbjudan) is Clew's record of what it sent: to whom, for when, and the id of the event. It is
  the calendar module's proposal.
- **The meeting** (mötet) is the event in the calendar, which Clew created and does not control afterwards.

1. **The meeting is read back by its id.** The calendar module looks up the event of every invitation that books
   someone by the ref it stored when the invitation was sent (`follow` in
   `apps/server/src/modules/calendar/usecases/invitations.ts`), as part of the manager's scan, at most once an hour
   per manager. Never by title: a meeting renamed in the calendar is still the invitation's, and another meeting
   that carries a talk's title is nobody's.
2. **What the calendar holds is recorded beside the booking, and the booking stands.** The calendar module tells
   the talks module what it read through the invitations port (`observed`). When that is not what the booking says,
   the talks module records it on the talk (`TalkBooking.calendar`, migration 0081): the time the meeting has now,
   or that it is gone. Nothing else changes. When the calendar agrees again, what was recorded is cleared. A talk
   marked held has nothing to settle.
3. **Only the manager's decision changes the talk.** The manager whose booking it is settles the difference on the
   talk's tab (`POST /api/talks/:personId/booking/calendar`, the calendar module's `settle`): `adopt` moves the
   invitation and the talk to the time the meeting has now; for a meeting that is gone, `remove` ends the
   invitation and takes the time off the talk, and `keep` ends the invitation and keeps the time as one the manager
   set by hand. The event is read again first, so the decision is about what the calendar holds now, and one that
   no longer fits is refused. Clew writes nothing to the calendar for this: a meeting moved by mistake is moved back
   there, and the next reading finds them agreeing.
4. **A move or a cancellation made in Clew needs no second decision.** When a person moves or cancels a meeting on
   Clew's calendar page and the meeting is an invitation's, found by its ref, the execution's projection moves or
   ends the invitation and tells the talks module in the same transaction (`followOwnEvents` in
   `composition/execution-projection.ts`; the port's `moved`, and `ended` with `cancelled`). An undo of the move is a
   move back and takes the same path.
5. **The manager is told by a card the scan derives.** The talks connector declares a `scan`
   (`modules/talks/capabilities.ts`): for the manager whose booking it is, one card per person and round when the
   meeting was moved or is gone. It is derived from the talk's record each time and never stored. The platform
   opens it, resolves it when its cause is gone, and brings a handled one back when what it says changes (D47). The
   card names nobody (vision principle 7, as the boarding module's cards): the person is the row's subject, and the
   card opens the person's place in the round, from which the talk opens.
6. **Another manager of the person reads the difference and decides nothing.** `TalkRow` gains `own` (the booking
   is the reader's) and `calendar` (what the calendar holds when it differs). The protocol changes in place
   ([D129](D129-the-connector-protocol-is-1-and-changes-in-place-until-the-first-release.md)).

**Why.** D132 listed this as its first gap: a talk kept the time it was booked at whatever happened to the meeting,
and a time an invitation carried could not be changed from Clew once its undo window had passed. The product owner
asked on 2026-11-20 for both this and the cards before and after a talk to be built, and for it to be plain what is
what and how the parts hang together. That is why the three names above are part of the decision and not only of a
comment.

The difference is recorded and not applied because the calendar is the copy. If the calendar could change the
talk, a mistaken drag in a calendar client would move a talk nobody decided to move, and the round's status would
again be what a calendar happens to hold. In practice only the organiser's calendar is read and only the organiser
moves the meeting, so the answer is nearly always yes; asking costs one press and keeps the rule whole.

Alternatives weighed. *Applying a move from the calendar automatically*: rejected for the reason above. *A button
that moves the meeting back from Clew*: left out, it is a calendar write through the execution ledger for something
the person does in one drag where they made the change, and the next reading clears the difference. *Storing the
difference on the proposal*: rejected, the page and the card read the talk, and what holds against a booking belongs
beside the booking. *A timer per invitation*: rejected for the scan, which already runs per person, needs no
workflow and survives a booking that changes. *A card port of the talks module's own, as an action point has*:
rejected, the scan's occurrences already give a card that opens, resolves and comes back by itself, and nothing has
to be kept in step.

**As built, 2026-11-20.**

- An invitation is followed from when it is sent until thirty days after its time, the follow-up policy's own span,
  so a meeting moved close to its time is still found.
- A calendar that cannot be read tells nothing and is asked again at the next reading, an hour later. The reading
  back is started by the scan and not waited for, and looks events up four at a time: it never counts against the
  calendar source's scan deadline and never holds the planner up, and a failure is logged.
- A card about a person provisioned without a user name has no subject to link and cannot open the person's place
  in the round, since such a person cannot be asked about (D97): it opens the round, where the talk is found by its
  time.
- The audit rows are `talks.calendar_differs`, `talks.calendar_agrees`, `talks.booking_moved` and
  `talks.booking_kept` beside D132's, and `proposals.moved` and `proposals.cancelled` on the planning card's thread,
  with `by: 'calendar'` for the manager's settlement and `by: 'decision'` for a move or cancellation made in Clew.
  Instants and ids only.
- An invitation whose meeting is gone and that the manager settles is marked `undone`, as one the manager undid.
- The card in Att göra can lag the page by one scan: the talk's tab is right as soon as the reading back has run.

**Not established.**

- A meeting changed in a real calendar. The reading back is tested against the calendar in memory and, for moves
  and cancellations made in Clew, through the execution ledger on PostgreSQL; no CalDAV or Microsoft 365 calendar
  has been used.
- The time of a booking an invitation carries is still not changed on the talk itself: the manager moves the
  meeting, on Clew's calendar page or in the calendar, and the talk follows.
- A change of who is invited, or of the meeting's room, is not read: only its time and that it exists.
- No screen-reader pass has been made of the banner or the card.

**Replaces.** The first point under "Not established" in D132, and the sentence on the talk's tab that said the
time of an invited booking is not changed here.
