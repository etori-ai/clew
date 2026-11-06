# Design exploration: becoming done · one press, one at a time, and the receipt · 2026-11-06

Requested by the product owner on 2026-11-06: when a person completes an event or a ticket, should Clew show a modal
flow and an animated check so the person feels that it is really handled? Some things have a one-press action, the
one the cards have today; attesting several invoices probably wants a preview of each, a decision per invoice and
one send for all. Drawn on the canvas **Clew · att bli klar: ett tryck, en i taget, och kvittot** (Claude Design,
https://claude.ai/artifact/BZwgqCN9H9YGteA3XjNxfX, private until shared): six artboards joined by working links.
It builds on the sibling canvas **Clew · det jag gjorde, och ångra** (https://claude.ai/artifact/CDDCSdSrDTqUvXWxNb9N6Y,
same day, session "Invite completion visibility and undo"), whose building block is a decision drawn as one row
with six end states and whose recommendation is that the row carries the decision wherever the card lies and that
Klart becomes a log. That canvas draws where a decision is seen afterwards; this one draws how the person gets there.

## What the code does today

Read from `apps/web/src/components/card.tsx`, `conversation.tsx`, `connectors/finance/connector.mjs` and D45, D47,
D48, D49, D64, D65:

- A card's primary button executes at once. The card leaves the stream in the same moment (D64, optimistic), and
  the receipt is visible only on the open card ("Ångra allt · N kvar", one row per item with the source's answer,
  green only when read back) and as a row under Klart.
- "Attestera N valda" writes straight from the checkboxes on the card (artboard E of the start-page canvas). There is
  no way to see an invoice before deciding; "Öppna i ekonomisystemet" leaves Clew.
- A toast with Ångra exists for Avfärda and Inte nu only.
- Astryx has no animated check. `Icon` plus `useAnimator` or `useEntryAnimation` give scale and opacity on Astryx's
  motion tokens; a drawn stroke would be custom CSS.

## The principle

No modal for one step. A one-press action gets its confirmation on the row it was pressed on: the row changes to its
receipt state where it stands, the check is drawn when the source has read back (D45: green only when read back),
and only then does the row leave the list. The motion is the receipt, not the click.

A flow surface, a fullscreen dialog, only when the person needs to see something per row before deciding: a document,
an amount against a contract, a draft. The review is then the next step in D48's sense, and the write happens once at
the end. Both paths end in the same row: the decision row of the sibling canvas, state 1 ("window open") with Ångra
and the time left.

## The artboards

- **A · Ett tryck, tre ögonblick.** Godkänn ledighet on a row. 0 s: the button is pressed, the row gets its receipt
  state at once with an empty ring and "Skickas …" (D64's promise to show the person's own action at once holds).
  0,4 s: the source has read back, the ring becomes a check (300 ms on Astryx's motion tokens; under
  `prefers-reduced-motion` it appears without being drawn), the row gets "Ångra · 10 min kvar". 2 s: the row folds
  away (`useAnimatedLayout`), Behöver dig 4 → 3, Klart 1 → 2, and a toast says where the card went with Visa and Ångra
  (the sibling canvas's A). Three `role=status` announcements, one per moment. A source that does not answer within
  8 s turns the row into Kontrollera status (D47); no Ångra before a receipt exists.
- **B · Granska en i taget.** Astryx `Dialog variant="fullscreen" purpose="form"` over Hem, never the panel: the
  document needs width. Left the source's document (a preview read on the row; Lightbox for zoom; "Öppna i
  ekonomisystemet" stays), right the facts against the contract and the decision for this row: Attestera (primary,
  Enter), Lämna kvar · fråga leverantören i samtalet, Hoppa över (→). A Stepper on top, one step per invoice plus
  Skicka. Decisions so far are listed at the foot. Spara och stäng (Esc) keeps the decisions as the card's selection
  (the checkboxes of artboard E); nothing is written. No text field on the card or in the dialog (D12): a question
  to the supplier is asked in the conversation afterwards.
- **C · Sista steget.** A list of what the person chose, one row per invoice with its decision and Ändra back to the
  step, the sum that will be written, and one button that writes: "Skicka 2 attester · 60 700 kr". Under it what
  happens: written to the finance system in one decision, read back row by row, Ångra 10 minutes, the card goes to
  Klart, and the invoice left behind becomes its own card under Behöver dig. Same decision endpoint as Attestera 2
  valda today (D45/D47): the flow changes the way there, not the write.
- **D · Klart.** Not a screen of its own: the dialog closes, focus returns to the card's heading in the panel, and
  the card shows the receipt. The check is drawn large here, once, when the answer came. The heading says what was
  done with the amount, each row the source's answer, "Ångra allt · 9:58 kvar" as the red secondary button, and
  "Nästa som behöver dig" as a link onwards: momentum without jumping on its own. In the column the row has moved to
  Klart carrying the decision row, the invoice left behind is a card under Nu, and the toast says where the card went.
  Sedan i går gets its clause ("du attesterade 2 fakturor 08:02", D65).
- **E · Telefonen.** The fullscreen dialog is a `BottomSheet` with `height="tall"` (Astryx's AdaptiveDialog recipe),
  the document a thumbnail that opens Lightbox, the steps `Pagination variant="dots"`, the buttons stacked in the
  desktop order, Spara och stäng always reachable.
- **F · Vilket mönster när?** The card says it, not the person. One press for a row with nothing to read first
  (Godkänn ledighet), for a läskvitto (the text is the card), for "Skicka 6 inbjudningar" (the week on the card is
  the preview) and for Avfärda, Inte nu and Påminn mig (nothing is written, no check). One at a time when the rows
  each have a document or an amount against a contract. A proposal in the conversation when more than one system is
  involved (a job, D55). Three questions decide: a document per row, undoable, more than one system.

## Recommendation

A for everything that is one step without a document (approve, acknowledge, remind, dismiss). B, C and D for an
action over several rows where each row has its own document or amount; the card opens the flow, not the person,
through the connector declaring `review: 'each'` on the action and a preview read on the items. E is the same flow
as a sheet. F is the rule.

What a decision would change: D64's motion (the row leaves after the receipt, not before; the optimistic state is
the row's receipt state, not its absence), D48 (the review counts as the one next step for a card that declares it),
the connector protocol (`review` on an action, a `preview` read that returns an image or PDF reference for an item),
and the cards' toast rule (a toast on execute, which D64 left out; the sibling canvas's A). The animated check is a
recorded Astryx gap in that decision, not a gap report (product owner, 2026-11-04). Nothing here is built or decided.

## Open

- Whether the finance fixture should carry an invoice preview (an SVG or PDF per invoice) so B can be built against
  the dev stack, and whether a real finance system exposes one.
- Whether "Lämna kvar" should offer the question to the supplier directly as a proposal in the conversation, or only
  leave the invoice as its own card (drawn as the latter: the card never contains a text input).
- The 2 s pause before the row leaves: a product call against D64's "at once". The artboard draws the pause; the
  sibling canvas's row rule would make the pause unnecessary on Klart, since the row is there in the same shape.
