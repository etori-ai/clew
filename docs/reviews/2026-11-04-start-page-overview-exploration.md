# Design exploration: the start page as an overview, not a list · 2026-11-04

Requested by the product owner in the evening of 2026-11-04: the stream built under D28 and D31 gives no
overview ("it doesn't provide good enough overview for me as a user"); drop the single-list approach, take
the Astryx templates as inspiration, and decide from the personas what each of them should be fed when the
page opens. A second observation in the same session: the card "Ny rutin vid hot och våld" says a read
receipt is required but offers no action that opens the routine, so its calls to action do not lead the
person. Drawn on the canvas **Clew startsida · översikt i stället för en lista** (Claude Design,
https://claude.ai/artifact/UiCMmm2fmEaq1M7cipBDvQ, private until shared), six artboards in three rows.

Nothing is decided. The canvas proposes, each artboard with its Astryx mapping and persona coverage in
sticky notes:

- **A · Översikten (desktop, Hillevi).** Three bands as in the templates `dashboard-scorecard` and
  `dashboard-alert-rail`: the greeting as one sentence, Läget (the four figures that `lage.tsx` already
  renders but the start page no longer shows), then a two-thirds column of grouped rows (`table-grouped`:
  Nu, Senare, Till kännedom) beside a rail with I dag, the three piles and the watches. Every row carries
  its next step as a button; the card is the exception, opened from the row. `Layout contentWidth` 1180
  instead of 800. The rail is a `Grid` with `minWidth` 320 so it folds under the rows on a narrow screen.
- **B · Inkorg med läsruta (Alex, Hillevi).** The `table-inbox` template: the whole list on the left at
  compact density, the selected card on the right with its items, actions and conversation. Best for a
  case officer with forty cases. In tension with D31, which keeps the conversation in the column and the
  side panel for views only.
- **C · Dagen som tavla.** The `kanban-board` template without drag: four lanes that are D28's groups
  and piles (Nu, Senare, Pågår utan dig, Klart i dag). Läget as a row of chips. Lanes are status, so
  Inte nu and Påminn mig move a card through its menu, never drag (as D27 for the calendar).
- **D · Telefon (Hassan).** One card per obligation in order of the morning: the shift, the read receipt,
  the balance, then Till kännedom as a line. No Läget for an employee: the cards are the figures.
- **E · Kortets handlingsstege.** The rule to propose as a decision: the primary button is the next step
  in the card's ladder, never the end step while an earlier step remains. A card with a requirement (read
  receipt, attest, decision, booking) must carry an action that opens the material; when the connector
  does not deliver one, Clew fills in the source link itself. Verified in
  `packages/connectors/src/mock/kommunikation.ts`: the connector delivers `notices` and `acknowledge`
  only, and a notice has a body text but no document, so the card has nothing to open. The thread action
  contract would gain a `step` (ordinal and the step it presumes).
- **F · Vad varje person matas med.** The three bands keep their place for every persona; only the
  content changes: Hillevi/Kim, Hassan/Fatima, Alex, Johan/Eva, Lena, with the use cases from
  `docs/personas.md` and what each must never see.

Correction the same evening, from the product owner: not everything on the page is an action with a
timeline, and the first draft of A leaned that way (a day word and a black button on every row). The
canvas now separates four kinds: a **requirement** (ladder, day, primary button), a **proposal** from the
assistant (soft button, "nej tack" is an answer, no day), a **figure** (no button, the tile opens its
thread) and an **event** (one sentence with source and time, no button, gone when read). Only the
requirement has a day. This strains D28, which groups by deadline and leaves everything without a date
in a remainder; the alternative is to group by what the item asks of the person: Behöver dig (with a day
where one exists), Jag föreslår, Till kännedom, and Läget as its own band.

A third thread the same evening: a manager also comes to Clew knowing what to do (attest invoices,
check the budget, report an employee's absence), so the product owner's original idea was a page scaled
back to one box, "Vad vill du göra?", with the platform's push on top of it. Drawn as row four, **G ·
Fråga först**, desktop and phone, in the shape of the Astryx `ai-chat-landing` template: the push brief
above the box (at most three rows and a link to the whole picture, artboard A), the box with the
existing "Menar du" list, and the connectors' standing actions for the role as chips under it. What
carries the model is that a pull and a push produce the same card: "attestera en faktura" and the 06:00
scan both land on the Raindance invoice card with the same ladder, receipt and undo. "Rapportera
frånvaro för en medarbetare" does not exist as a capability in the Heroma mock yet; the chip is drawn as
the connector would deliver it.

The product owner chose G and asked what happens after Enter, and how the navigation ties
conversations, long-running tasks and notifications together, with the no-model mode (D8) holding. Drawn as
rows five and six:

- **H1 · Samtalet.** After "attestera en faktura" the conversation opens in the column (D31) with the
  invoice card as the assistant's first turn, a follow-up question with an object chip, and the composer
  scoped to "Det här samtalet". The rail is the Astryx `shell-side-nav` template around `ai-chat`.
- **H2 · Pågår.** A conversation can carry a job (Temporal, D17). While it runs the conversation sits under
  Pågår with a yellow dot and a step list; the person can leave. A toast from another conversation (the
  attest read back from Raindance, with undo) arrives beside the composer meanwhile.
- **H3 · Navet utfällt.** The rail orders everything by time relative to the person: Ny fråga and search;
  Från mig (the push in its three groups); Pågår (a running job, a card waiting on a source system, a
  question waiting on the model); Samtal by day with a green dot for "something happened since you were
  here"; Alla samtal och klart i dag (`/hanterat`); then Kalender, Områden collapsed as lenses,
  Administration, the account. A table says what each event does in the toast, the rail, the brief and the
  attention budget. A notification is never its own inbox: it has those three homes.
- **H4 · Utan modellen.** The same G with the banner the shell already has: push, cards, ladders, chips,
  planner, calendar and undo work unchanged; the box falls back to the router, which matches standing
  actions, cards and the document search, and a free-text question is parked under Pågår until the model
  is back. Chips are drawn stronger because they are the way in.

Recommendation after the evening: G as the page (with H1 to H4 as its flow), A as "hela bilden" behind a
link, D and the G phone as the phone forms, E as a decision of its own, B kept for the case officer persona
when it is provisioned, C not pursued (it reads well with six cards and badly with thirty). HANDOVER.md was being edited by another session and was not updated; add the canvas link under
section 1 and this review in the session log.

Outcome: the product owner chose G with H1 to H4 and asked for it to be built the same evening; D34 records what was
built and what the canvas still holds for later (the rail's search, the "something happened" dot, job steps, the
action ladder's `step`).
