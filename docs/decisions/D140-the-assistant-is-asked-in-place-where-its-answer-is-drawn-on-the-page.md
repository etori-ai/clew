# D140 · The assistant is asked in place where its answer is drawn on the page, and an answer can carry a decision it has filled in

**Status:** provisional (the product owner chose it on 2026-11-18 from the third row of the canvas "Clew · Kalender, a pass", after "Fråga assistenten" on a meeting had taken them from the week to a conversation; stage 1, moving and cancelling a meeting of one's own, is built and covered by unit scenarios and the calendar's browser scenarios on routed data. On the development stack, with its local model, the assistant was seen once to fill in a time it was given; asked to choose one ("torsdag eftermiddag") it answered that no time was free when one was. Nothing outside the repository has tested it, and no manual screen-reader pass is made. Item 1's test was replaced the same day by [D141](D141-the-assistant-is-asked-beside-every-page-through-one-button-and-one-pane-of-the-page-frame.md): the assistant is asked beside every page, and Kalender's pane is that decision's reference for a pane that already holds a picked thing; since D141's stage 1 the pane draws the conversation with the shared parts, and "Fråga om veckan" is the frame's "Fråga assistenten". Numbered D129 until 2026-11-20, when the product owner asked for it to be renumbered ("renumber the branch's D129 too"): `main` holds another D129, the connector protocol's) · **Date:** 2026-11-18 · **Area:** ui, product

**Context.** [D126](D126-one-page-per-thing-one-astryx-template-per-page-type.md) item 4 gave the assistant two homes
and ended "No other page has a composer", so "Fråga assistenten" on a page starts a conversation with the thing beside
it. The rule was made to stop a box from growing at the foot of every page and pane, and it had been turned both ways
before. On Kalender it met a case it does not serve (the product owner, 2026-11-18): asked to move a meeting, a person
wants to see on the week where it ends up, and the conversation's page shows the meeting as a card beside a
transcript, not the week it is being placed in. Two things were also missing under the interface. An answer could
carry a time as data only as a `draft`, and a draft is a work item's action: it needs a work item, is keyed on it
everywhere and is sent through the work item's own decision. A calendar move or booking belongs to no work item. And
the model could read the person's own free time, never the time when several people are free.

**Decision.**

1. **The assistant is asked in place only where its answer is drawn on the page itself.** Kalender is such a page:
   the answer is a block on the grid and a form filled in. A page whose answer is something to read (Att göra, a
   person, a unit, a tool) is not, and "Fråga assistenten" there still starts a conversation with the thing beside it.
   This amends D126 item 4: the two homes stand, and a page of this kind may hold a box in its pane.
2. **The box stands at the pane's foot wherever an entry does** (the product owner, 2026-11-18, on seeing it built
   behind a button: the box need not be hidden). An entry in Kalender's pane has the assistant's box under it from the
   start, and no "Fråga assistenten" button; opening an entry still gives the focus to its name. "Fråga om veckan" (om
   dagen, om månaden) in the page's header opens the same pane with the box alone, named by the range, which is what
   the question is about, and the focus in the box. "Flytta …" on an entry keeps the box; "Ny bokning" opened by hand
   has none until a booking can be prepared.
3. **The pane draws the conversation about what it holds, whole, and finds it again** (the product owner,
   2026-11-18, on seeing a pane that kept only the last question and answer: with the box always there, a pane that
   forgets what was just said reads as broken). Every question and answer stands above the box, the newest last, as
   the panel of [D128](D128-another-systems-assistant-is-talked-to-beside-the-conversation-and-the-box-only-goes-to-clew.md)
   draws an assistant's exchange. It is a real conversation, kept under Alla samtal, and "Öppna samtalet" leads to its
   page; opening the same entry again shows the person's latest conversation about it, and the next question continues
   it. An earlier answer that proposed a time draws a row with a button for it; no form opens by itself.
4. **An answer can carry a prepared decision**: one of Clew's own human decisions, filled in and checked by the
   assistant, and not sent (`Prepared` in `@clew/contracts`, on the message's meta and on the response). Where a
   `draft` is a work item's action, a prepared decision belongs to no work item. The first kinds are `calendar.move`,
   a new time for a meeting of the person's own, and `calendar.cancel`, that meeting to be cancelled.
5. **The page the decision is made on draws it in the decision's own form.** On Kalender a prepared move fills in
   "Flytta …" and the meeting's block stands, dashed, where it would end up; the fields can be changed, the block
   dragged, and another time asked for in the box. A prepared cancellation opens the page's own question, "Ställ in
   mötet?", which the person answers. Beside a conversation the same answer draws one row with what is proposed and
   "Visa i kalendern", which opens Kalender with the form filled in or the question asked.
6. **Nothing is written before the person's own button.** The tool that prepares writes nothing and reaches no
   source; a calendar write is still not a capability and never a model tool
   ([D45](D45-approved-intent-precedes-source-dispatch.md), [D47](D47-occurrences-timers-and-attention-have-durable-identities.md),
   [D112](D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) item 8,
   [D122](D122-the-assistant-may-read-and-propose-whatever-the-person-who-asks-may-and-adding-a-model-is-answering-for-it.md) item 7). It checks what the decision will
   check, so the assistant cannot prepare what the person may not do.
7. **The model never names the meeting.** A meeting's handle and revision are not in what the model reads. The tool
   is offered only when a meeting the person may move stands open beside the question (`beside`), and takes the
   meeting from there. It is offered wherever such a meeting stands open, on Kalender and beside a conversation alike:
   the behaviour is the assistant's, not one page's.

**Why.** The test in item 1 is what the earlier turns lacked: it says for any page which way "Fråga assistenten" goes,
and it keeps the reason for D126 item 4: no box grows at the foot of pages whose answers are only to be read. Filling in the form the person would have filled in keeps one way of making the decision, with the
assistant as one more way of filling it in, and it keeps the audit and the durable path of the decision as they are.

**Amends.** D126 item 4 ("No other page has a composer"); [D128](D128-another-systems-assistant-is-talked-to-beside-the-conversation-and-the-box-only-goes-to-clew.md)
item 2, whose panel is no longer "the one box outside D126 item 4's two homes".

**Not built.**

- Finding a time for several people (stage 2): a read of when a named part of the person's team is free, a prepared
  booking (`calendar.book`), and "Ny bokning" filled in from it. Until then a question about the range is answered in
  the pane as text.
- **It is not yet a protocol feature** (the product owner, 2026-11-18: it should be, and not custom for the calendar).
  The envelope is general: any answer can carry a prepared decision, and the parts that ask in place know nothing of
  the calendar. The kinds are not: `calendar.move` and `calendar.cancel` and their two tools are named in the
  assistant. A connector can declare an action the assistant may fill in for a work item (`clew.draftAction`, D112
  item 8) and for a person or a unit (D97), and for nothing else: a row or a record of a view, which is what a meeting
  is, has no actions. The general form is one mechanism, an action declared on an object with what it asks, drafted
  by the one tool for whatever stands open, with the calendar declaring its own the same way. That is a change to the
  connector protocol and got its own decision on 2026-11-19,
  [D137](D137-an-action-says-which-record-it-is-about-and-the-assistant-fills-in-the-actions-of-what-stands-open.md);
  the calendar's two kinds move onto it in that record's item 5, which is not built.
- Moving a proposal (a samtal) by asking. Its "Flytta …" is the form as built.
- On a phone "Fråga assistenten" starts a conversation as before: the forms are dialogs there.
