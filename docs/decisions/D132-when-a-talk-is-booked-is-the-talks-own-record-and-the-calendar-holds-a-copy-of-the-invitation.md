# D132 · When a talk is booked is the talk's own record, and the calendar holds a copy of the invitation

**Status:** provisional (accepted once a manager and an HR practitioner have booked a round with it; questions 6 and 11 of [D96](D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md) still hold real data back); what happens when the meeting is changed afterwards is [D133](D133-a-talk-follows-its-meeting-by-the-events-id-and-only-the-manager-changes-it.md) (2026-11-20, provisional) · **Date:** 2026-11-19 · **Area:** product, integrations

**Decision.** A development talk is booked in Clew, and the booking results in a calendar event. What holds is
what Clew's talks module records, never what a calendar happens to contain.

1. **The booking is stored on the talk.** `talk` gains `booked_start`, `booked_end`, `booked_by`, `booked_at` and
   `invitation_id` (migration 0080, `TalkBooking` in `apps/server/src/modules/talks/model.ts`). A person's state in
   the round is read from that one row: held when a manager marked it, else booked when its booking counts, else
   missing. The built-in module reads no calendar and never answers `bookedUnknown`.
2. **Whose booking it is decides whether it counts.** A booking counts while the manager in `booked_by` manages the
   employee now (`standingBooking` in `domain.ts`, asked through the `Reports` port, which replaces `Manages`).
   Nothing is written when a manager leaves a person: their booking then counts for nobody, the talk reads as
   missing, and the person's managers now book it again over it. Erasing the manager nulls `booked_by`, with the
   same effect. Every current manager of the person reads the booking with its time: it is one talk and Clew's own
   record, not another manager's calendar.
3. **The calendar module tells the talks module of an invitation, in the same transaction.** `ProposalTx` carries
   the port `invitations` (`InvitationsTx` in `apps/server/src/modules/calendar/model.ts`). Composition binds it to
   `talkInvitations` in the talks module's `usecases.ts` (`apps/server/src/composition/talk-invitations.ts`), the way
   the people module tells of a leaver. `established` is told where the execution's projection marks a proposal
   confirmed, that is when the invitation has been sent and read back from the calendar by its own id
   (`composition/execution-projection.ts`). `ended` is told where the projection marks a proposal undone or
   replaced, and where the reply check records the invitee's no (`readReplies`). The talk and the invitation that
   carries its booking commit or roll back as one. The booking is recorded in the open round of the manager's
   organisation; with no open round, for a talk already held, or for people the directory does not hold in one
   organisation, nothing is written.
4. **A manager registers an agreed time by hand.** `PUT` and `DELETE /api/talks/:personId/booking` (`book`,
   `unbook`), for any current manager of the person, on the talk's tab as Ange tid, Ändra tid and Ta bort tiden.
   Nothing is sent and nothing is written to a calendar. It replaces a time set by hand before and a booking that
   no longer counts. It is refused for a talk marked held, and while an invitation carries the booking: that
   booking changes with its invitation, so the round and the invitation never say different things.
5. **The planner reads who has a talk from the round.** `PlanningRound` gains `booked` beside `held`
   (`adapters/talks-round.ts`), from whichever system answers the talks profile. The nightly draw, the count, the
   open card and the confirmation leave out a person the round records as held or booked. A confirmation of a time
   for a person the round records as booked is refused with "… har redan ett utvecklingssamtal bokat.", and a
   drawn time for one leaves the card as a row "har redan en tid bokad". The checks on Clew's own proposals
   (`bookedElsewhere`, the manager's sent invitations, the reservation at approval) stay as they are: they hold a
   person where another system answers the round and records none of Clew's invitations.
6. **Nothing is recognised by its title.** `heldAddresses`, `heldSamtal` and `samtalBookings` are removed. The
   calendar is read for three things: free time when times are drawn, the read-back of an invitation Clew just
   sent, by the id Clew gave it, and the invitee's answer to that invitation, by its stored ref. The title
   "Utvecklingssamtal · name" is what the invitee reads and nothing else.
7. **The profile says more about a booked row.** `TalkRow` gains the optional `until` (when it ends) and `invited`
   (true when an invitation the system sent carries the booking, false for a time set by hand). `at` is absent
   only when a system does not say when. The protocol changes in place
   ([D129](D129-the-connector-protocol-is-1-and-changes-in-place-until-the-first-release.md)).

**Why.** The product owner asked for it on 2026-11-19: a talk is booked in Clew and results in a calendar booking,
the ground for what holds is Clew's, and nothing may be matched on the name of a booking. Until now a calendar
event counted as a talk when its title began with "Utvecklingssamtal" and someone in the manager's team was a
participant. An information meeting named "Utvecklingssamtal 2027" booked every participant, a talk named
"Medarbetarsamtal Anna" booked nobody, and only the reader's own calendar was read, so a talk another manager
booked by hand was never seen.

D96 item 2 chose not to store the booking because it would copy a record the calendar owns and every confirm,
decline and move would have to write here. The ownership is the other way round now: the talk owns the booking and
the calendar event is the copy. The writes turned out to be three places, each already a transaction of Clew's
own, so the copy cannot drift from the proposal that carries it.

Alternatives weighed. *Deriving booked from the proposals alone*: rejected, a proposal belongs to a planning card
and is deleted with it, a time set by hand would be a second source beside it, and the reminder that is to come
needs one row to hang on. *Letting a manager change by hand a booking an invitation carries*: rejected, the round
would say one thing and the invitation another, and the planner, which leaves out a person its own invitation
holds, would never draw a person the round shows as missing. *Clearing a booking when its manager leaves the
person*: nothing tells the talks module of an assignment change, and who manages whom is read when asked
everywhere else in the domain, so a reorganisation needs no write here. *Reading the round again right before an
invitation is sent*: left as it is, the dispatch asks only what it can ask without the registry (D96, as amended),
and the invitation that was sent replaces a time set by hand in between.

**As built, 2026-11-19.**

- A booking belongs to the round that is open when it is recorded, whatever its day: a talk booked for after the
  due date reads as booked with its date. The check on other managers' proposals is still bounded by the round's
  period. When a new round is opened, a talk of the closed round that is booked for a time still to come, and not
  held, becomes the new round's talk: its booking moves with it, invitation included, in the transaction that opens
  the round (`carried` in the audit row `talks.round_opened`). Without that the person read as missing in the new
  round while the planner still left them out for the invitation it had sent (the review of 2026-11-20).
- The planner's open card is kept in step at every scan. The hourly reading of D96's amendment existed to spare a
  read of the manager's calendar, which is no longer made: the round, the team and the invitations are Clew's own
  records, so who joined or left the team reaches the card at the next scan and not within the hour.
- A time is stored as the two instants in their canonical form (`normaliseSpan`): at most a day apart, the end
  after the start.
- The audit rows are `talks.booked` and `talks.booking_removed`, with `by: 'manager' | 'invitation'`, the round, the
  employee and, for an invitation, its id, the manager whose booking it is and why it ended. No name and no text.
- The export `clew.talks/1` carries a talk's `booking`. A field was added and none changed, so the version stands.
- The form for the time follows the booking dialog: the day and start in one field, the end the same day, an hour
  suggested, and the end keeps the talk's length when the start is changed.

**Not established.**

- A change made to the event after it was sent did not reach the talk. Settled 2026-11-20 by
  [D133](D133-a-talk-follows-its-meeting-by-the-events-id-and-only-the-manager-changes-it.md): the event is read
  back by its id, a difference is recorded beside the booking and settled by the manager, and a move or a
  cancellation made on Clew's calendar page moves or ends the invitation and the talk with it.
- An invitation read back while no round is open books nothing, also when a round opens later.
- No card reminded the manager to prepare before a booked talk, and none asked afterwards whether it was held.
  Settled 2026-11-20 by
  [D134](D134-a-booked-talk-reminds-its-manager-to-prepare-and-asks-afterwards-whether-it-was-held.md).
- A talk booked by hand in a calendar no longer counts until its manager registers the time. Whether managers do
  is what makes the figure trustworthy, and nothing outside the repository has tested it.
- No screen-reader pass has been made of the form.

**Replaces.** Item 2 of [D96](D96-talks-is-the-first-owned-domain-the-round-and-action-points-behind-a-profile.md)
("Booked is not stored") and its rejected alternative "Storing booked in this module"; in the amendment of
2026-11-12, "without its time" and the row reason for a talk in the manager's own calendar that was booked by
hand; the talks module's `Bookings` and `Manages` ports and `bookedUnknown` in its answers. D96's rule of one talk a
person a round, who marks it held and who ticks off an action point stand as written.
