# D70 · One press confirms on the row, and rows with a document are reviewed one at a time

**Status:** accepted, built 2026-11-06 on `main` · **Date:** 2026-11-06 · **Area:** ui

**Decision.** How a card becomes done, chosen by the product owner on 2026-11-06 ("A plus B to D") from the canvas
**Clew · att bli klar: ett tryck, en i taget, och kvittot** (Claude Design, https://claude.ai/artifact/BZwgqCN9H9YGteA3XjNxfX;
review `docs/reviews/2026-11-06-completion-one-press-one-by-one-and-the-receipt.md`). The check is earned by the
receipt, never by the click.

1. **No modal for one step.** An execute whose rows need nothing read first (Godkänn, Kvittera, Skicka N inbjudningar)
   runs from its button as before. What changes is the moment after: the row the person pressed does not vanish.
   When the source has read back, the row changes to its receipt state where it stands, with the check drawn on
   arrival (Astryx `useEntryAnimation('scaleIn')`, which honours `prefers-reduced-motion`), the receipt's headline and
   the source's answer in its line, and `Ångra · N kvar` at its end. It stays there for `LINGER_MS` (2,5 s, `apps/web/src/stream.ts`),
   then leaves for Klart and the counters change. A toast says where the card went, with Visa and Ångra; it stays until
   closed (2.2.1), as the Avfärda toast does. The transition is seen in the page (`useReceiptArrivals` in
   `apps/web/src/pages/start.tsx`), not predicted: D64 item 2 still holds, nothing is drawn before the source's answer,
   and the pressed button keeps its loading state until then.
2. **Several rows with a document are reviewed one at a time.** A connector marks an execute action `review: 'each'`
   and names a `preview` read of its own (`ThreadActionSchema` in `packages/contracts`; `Registry.draftProblem`
   refuses a draft whose preview is not a read of the same connector). The card's next step is then `Granska N`, and it
   opens `ReviewDialog` (`apps/web/src/components/review.tsx`): Astryx `Dialog variant="fullscreen" purpose="form"`,
   a `Stepper` with one step per row and a last step Skicka, the row's document from `GET /api/threads/:id/preview?ref=`
   beside its facts, and for each row `Attestera` (focused on arrival, so Enter takes it), `Lämna kvar` and `Hoppa över`.
   Nothing is written until the last step's one button, which runs the same execute with the approved refs through the
   same decision endpoint (D45/D47). `Spara och stäng` and Esc keep the decisions as the card's selection; the rows left
   behind stay on the card, and the next scan carries what is still pending as its own card (refresh.ts: a thread with a
   receipt is retained, a changed observation makes a new one). The review counts as the card's one next step (D48 item 2).
   On a phone the dialog is the same fullscreen `Dialog`; artboard E's `BottomSheet` is a later polish.
3. **The receipt is on the card, and the card stays while it can be undone.** A done card in the panel shows the check
   large beside the receipt's headline, one row per item with the source's answer (green only when read back), `Ångra
   allt · N kvar`, and `Nästa som behöver dig` with the first row under Nu. The panel keeps a card whose undo window
   is open (`isOpen` in `usePanel`'s call on Hem), which amends D66's rule that a done card leaves with its row; when
   the window has passed, or the person closes it, it leaves. The Klart row carries the receipt's headline and the time
   the source answered, after the time the row already led with.
4. **What the preview is.** `PreviewOutput` (`packages/contracts`): a `title`, a `mediaType` among `image/svg+xml`,
   `image/png`, `image/jpeg` and `application/pdf`, and `data` as base64. Clew draws an image as `<img>` from a data
   URL, with Astryx `Lightbox` for a closer look, and offers a PDF as a download; a connector's SVG never runs as a
   document. The finance fixture's `finance.preview` draws each invoice as an SVG from its lines (`connectors/finance`).

**Why.** The product owner asked whether completing a card should get a modal flow and an animated check, and noted
that attesting several invoices wants a preview per invoice, a decision each and one send. In the code as it stood a
card left the stream the moment its button was pressed and the receipt was visible only on the open card and under
Klart; Attestera wrote straight from the checkboxes with no way to see an invoice; the Avfärda toast was the only one.
The sibling canvas **Clew · det jag gjorde, och ångra** (the same day) draws a decision as one row with six states and
recommends that the row carry the decision wherever the card lies; this decision makes the two paths end in that row.
A modal for a one-step action was rejected: it adds a step to what D48 made one step. Animating the click was rejected:
D45 says green only when read back, and a drawn check at the click would say more than Clew knows. Astryx has no
animated check; `useEntryAnimation` on the check icon is Astryx's own motion and needs no custom CSS, so no gap is
recorded. The 2,5 s linger is a product call against D64's "at once": the person sees what happened on the row they
pressed, and the row under Klart and the toast carry the same decision afterwards.

**Replaces.** Amends [D64](D64-a-card-shows-the-persons-own-action-at-once.md): the row keeps its place for a moment
after the receipt, and an execute gets a toast. Amends [D66](D66-the-panel-keeps-everything-opened-beside-the-page-as-tabs.md):
a done card with an open undo window stays in the panel. Extends [D48](D48-one-next-step-the-rest-one-step-away.md)
item 2: a review is the one next step for a card that declares it. Extends the connector protocol (D21, D22) with
`review`, `preview` and `PreviewOutput`, an additive change under protocol 2.

**Amended 2026-11-06, the same day.** A decision that leaves the card open and waiting on others follows item 1 the same
way. Sending the invitations of a proposal card (`calendar.confirmProposals`) keeps the thread `open` with `waitingOn`
and gives it a receipt with `calendar.undoProposals`; before this amendment the row under Väntar på andra said nothing
about that decision, no toast was raised, and `Ångra allt` lived on the open card alone, so with the panel closed the
ten minutes were invisible (the product owner, 2026-11-06, after sending four invitations: nothing on Hem said what was
done or offered the way back). Now `useReceiptArrivals` (`apps/web/src/linger.ts`) counts any receipt that arrives on
an open card, `groupThreads` keeps a lingering card in its group for the moment before it lies under Väntar på andra,
the toast names where the card lies (Klart or Väntar på andra) with Visa to that tab and Ångra, and the row under Väntar
på andra carries the receipt's line and `Ångra · N kvar` before Påminn mig while the window is open, through the same
`undo-receipt` endpoint as a done card (`ActionRow` and `ThreadRow` in `apps/web/src/components/card.tsx`). The open
card itself is unchanged. This is artboard A of the canvas **Clew · det jag gjorde, och ångra**
(https://claude.ai/artifact/CDDCSdSrDTqUvXWxNb9N6Y) applied to the proposal path; not built from that canvas are the
decision log Gjort (C), the card's head after the window has passed or after an undo (D), the row's "kan inte ångras"
state for a sent message or a time with a room (E, state six) and the Nyss strip (B, the alternative). Evidence:
`tests/unit/web-linger.test.ts`, `tests/a11y/undo.spec.ts`.
