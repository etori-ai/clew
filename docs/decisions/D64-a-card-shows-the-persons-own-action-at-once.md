# D64 · A card shows the person's own action at once, and keeps it on its way until the source has answered

**Status:** accepted, built 2026-11-06 for the generic card and row; the proposal card in `thread.tsx` and Påminn mig keep the earlier behaviour · **Date:** 2026-11-06 · **Area:** ui

**Decision.** A card answers the person's own click right away, in one of two ways, and nothing in between is drawn.

1. **An outcome the person chose is drawn before the server answers.** Avfärda, Inte nu, Ta upp nu and the toast's
   Ångra write the predicted thread into the query cache first (`apps/web/src/optimistic.ts`, `previewThread` in
   `thread-cache.ts`, `run(fn, { optimistic })` in `mutations.ts`): the card leaves the stream, lands in its pile or
   comes back at once, and the focus hand-over runs for that write. The server's answer replaces the prediction as it
   always has (D33), and the toast with Ångra appears on the answer, since it is the confirmation. A refused request puts
   the previous thread back where the prediction still stands and says why in an error toast, which outlives the card's
   component; an answer that landed meanwhile is newer and stays.
2. **An outcome the source decides is never predicted** (D45: approval, audit, visible card state and dispatch commit
   together, and the receipt is the source's). Instead the pressed button keeps its loading state, and the rows stay as
   they were, from the click until the card has come to rest: no decision pending or running, no timer waiting for
   Temporal (`atRest`). The window is four seconds (`SETTLE_MS`): the change stream is polled every two seconds on the
   server, so the resting state normally arrives within one poll. A source that takes longer is then shown as what it
   is, with "Ditt beslut är sparat och väntar på källan" and Kontrollera status, and announced once. The committed
   steps in between (pending, running, a queued timer) are neither drawn nor announced inside the window.
3. **A change notice that arrives while the person's own request is on its way waits for its answer.** `changeNotices`
   in `thread-cache.ts` holds the stream's invalidation while the mutation cache has a request in flight and applies it
   once the cache is idle. The notice is still applied (D46); it no longer draws the committed intermediate state over
   the prediction or the answer.

Not covered yet: the proposal card (`apps/web/src/components/thread.tsx`, confirm and undo) keeps its earlier
presentation, and Påminn mig still shows the timer as queued and then scheduled; both follow the same rule when they are
next touched.

**Why.** The ledger commits intent before dispatch (D45, D47): the answer to a card action carries a pending decision
or a queued timer, and every commit after it (running, dispatched, succeeded) bumps the person's revision, which the
stream turns into a refetch of every read. One click on Attestera therefore drew three states in about two seconds
(the button's spinner, "Ditt beslut är sparat och väntar på källan" with Kontrollera status, the receipt), each
announced, and Avfärda waited a round trip before the card moved. The product owner asked on 2026-11-06 for the flipping
to stop.

Alternatives weighed: letting the server wait for the dispatch before answering (rejected: the request would hang on
the source's time, and a use case has no timers); predicting the receipt (rejected: the outcome is the source's, D45);
merging the pending and running wording (not a presentation matter alone; the words stay). Astryx's `Button` already
carries the in-progress state (`isLoading`: spinner, `aria-busy`, still focusable), so nothing is drawn by hand.

**Evidence.** `tests/unit/web-optimistic.test.ts` and `tests/unit/web-thread-cache.test.ts` cover the predictions, the
preview and its restore, the held notice and the settle window; `tests/a11y/optimistic.spec.ts` covers Avfärda
leaving before the answer with focus moved on, and a refused request bringing the card back with the reason.

**Replaces.** Extends [D33](D33-browser-reads-go-through-one-query-cache.md): a mutation's answer is still the truth for
every screen, and a prediction may precede it. Extends
[D46](D46-browser-updates-use-committed-revisions.md): a notice is applied after the person's own request has settled,
never dropped.
