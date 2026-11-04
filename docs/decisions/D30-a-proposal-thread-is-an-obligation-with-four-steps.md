# D30 · A proposal thread is an obligation with four steps, replies read back and follow-ups as cards

**Status:** accepted, the live Temporal run and the Nextcloud reply path unverified · **Date:** 2026-11-04 · **Area:** product

**Decision.** Twenty utvecklingssamtal are one obligation, not twenty bookings (artboards E to H of the design
exploration canvas, `docs/reviews/2026-11-04-design-exploration-scheduling-and-attention.md`):

1. **Four steps on the thread**, derived by a pure function `obligationStep(thread)` in the calendar domain from
   the proposal states: *Förslag* (any `proposed`), *Inbjudningar* (confirmed, none replied), *Svar* (replies
   coming in), *Klart* (every proposal final, declined by the person, or booked after a reply). Drawn with Astryx
   `Stepper` on the card and on the calendar page.
2. **Replies are read back.** `ProposalStatus` gains `accepted`, `declined-by-invitee` and `counter`. A calendar
   use case `readReplies(threadId)` looks each confirmed event up through the calendar port and maps PARTSTAT
   with the existing `participantResponse`. The memory calendar lets a test set a reply.
3. **One follow-up workflow per obligation**, in Temporal, started at confirm and cancelled by undo: reads the
   replies at every office hour; two workdays after an invitation without an answer pushes a card "Svara på
   inbjudan till utvecklingssamtal" into the invitee's own stream (the invitee is a Clew user; no e-mail, no push),
   at most twice; on the Friday 06:00 review on or after two workdays from the invitations it returns the thread to
   the manager's Nu group with the sum and the names of the silent ("4 har inte svarat efter 2 påminnelser: …");
   when every reply is in it writes the sum and closes the thread. Between confirm and that end the obligation is
   one open thread in the Pågår utan dig pile, waiting on "svar från N medarbetare", never a handled card; a no
   returns it to Nu early. The manager can send the follow-up at any time ("Påminn de N nu"). The policy is fixed
   in `usecases/obligation.ts` and stated on the thread; making it editable is a later step.
4. **The plan names its judgement calls.** `planWeek` keeps its shape; `unplacedReasons` beside it says why each
   person got no slot (busy all week, the manager's free hours ran out, free only on days the manager is not) and
   `draw` stores them as thread items `unplaced:<email>` with the reason as detail, drawn as tokens on the card
   next to "Vecka N i stället". The structured diff of artboard E (new, moved, conflicts) is a later polish.
5. **Load per weekday** is `dayLoad(events, proposals)` in `@clew/calendar`, busy minutes of office hours
   computed from what the thread already loads for the agenda; no extra free/busy fetch, no cache. Drawn as a
   `ProgressBar` in the day heading of `WeekAgenda`.
6. **"Annan tid" is the same thread with two alternatives.** A decline draws two new proposals for that one person
   with `planWeek` (the declined time kept busy) and returns the thread to Nu with the first one selected; CalDAV
   carries no counter-proposal, so the invitee's own suggestion waits for a source that has one. "Skicka" is the
   existing confirm: the new invitation goes out, the old event is cancelled only after the new one was read back,
   ten minutes of undo as today. The two side-by-side `SelectableCard`s of artboard G are a later polish of the same
   data.
7. **Proposals stay ghosts** in the agenda: `kind: proposal` with a "Förslag" badge and the muted variant until
   Astryx answers the gap report for a dashed Card variant; booked ones are solid with a check.

**Why.** Across 18 scheduling products the patterns that make batch scheduling bearable are a reviewable plan
diff with judgement calls and undo (Sunsama), proposals drawn as a preview layer that syncs nothing until
approved (Morgen, Clockwise, Reclaim's dotted outline), a pending view for what waits on others that flips back on
activity (Calendly, Zendesk), a decline-triggered reschedule with ranked alternatives and the reason a slot is
unavailable (Google Calendar, Cal.com), and a follow-up policy stated on the thread (Howie). The product owner
chose steps plus reply reading with a fixed policy, load bars from the loaded week, and two alternatives on the
card on 2026-11-04. Nextcloud's handling of iTIP COUNTER is unverified; a decline with a comment is assumed
until a spike shows otherwise.

**Replaces.** Nothing. Extends the proposal model from session 1 (`proposed`, `confirmed`, `final`, `undone`,
`declined`) and the undo window from D13.
