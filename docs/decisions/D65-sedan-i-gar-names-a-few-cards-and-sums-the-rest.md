# D65 · "Sedan i går" names a few cards and sums the rest

**Status:** accepted, built 2026-11-06 on `main` · **Date:** 2026-11-06 · **Area:** ui

**Decision.** The "Sedan i går" card beside Hem's stream ([D53](D53-hem-is-the-start-page-the-days-work-under-the-box-and-the-day-beside-it.md)
item 6, [D63](D63-hem-is-drawn-as-the-canvas-draws-it.md) item 3) keeps artboard A's three sentences at any count. A
sentence names at most three cards and sums the rest as a number: "34 klara: ny rutin vid hot och våld 13:25, attestera
3 fakturor, 37 050 kr 21:48, tillbud 2026-1182, halkolycka i duschen 13:25 och 31 till." The sentences are built in
`apps/web/src/since.ts` (`sinceSentences`, `some`, `NAMED`) and drawn by `apps/web/src/components/since.tsx`.

1. **The closed cards are named newest first**, in the artboard's forms: the title and the time; ", kvitto läst från
   <källa> <tid>" where the source read the decision back; ", avfärdad <tid>" for a dismissed card.
2. **Up to four distinct cards are all named**, joined as the artboard joins them ("a, b, c och d"), because "och 1
   till" says less than the name would. From five, the first three and "och N till".
3. **A card that closed more than once since the day began is named once.** The count ("34 klara") and the rest ("och
   31 till") count cards, not names, so the sentence still adds up.
4. **"N väntar på andra" follows the same rule.** The third sentence, the next review and whether every source
   answered, is unchanged.
5. **"Allt som är klart" leads to the Klart tab**, where every closed card is a row, as before. The card is not a list,
   has no "visa fler" and no style of its own: `Card variant="muted"`, `Text`, `Link`.

**Why.** On 2026-11-06 the product owner saw Hillevi Berg's card on the development stack read "34 klara: …" as one
sentence the whole column high: `since.tsx` joined every closed card's title and time. None of the 34 was a card she had
closed that day: 11 were open cards the fixture cutover of 13:25 had closed (five expired payroll watches from the
`jobs-check` runs, six cards of the new fixture topics), and the rest were cards closed on 3 to 5 November whose state
and time `scripts/fixture-maintenance.ts` had overwritten with the cutover's (fixed the same day: a reset closes open
cards and leaves closed ones alone; the development database was repaired from the audit table; `HANDOVER.md`). But a
manager who closes twenty cards in a day is normal, and a sentence that grows with the count stops being the artboard's
sentence. Weighed and left:

- **A list of the closed cards.** The Klart tab is that list, one link away, and D63 chose sentences for this card.
- **Grouping by title with a count** ("lönesystemet har inte visat det som bevakades, sex gånger"). The repeats were the
  reset's doing; a sentence that counts repeats draws attention to a fault instead of the day.
- **A "visa fler" control.** A card beside the stream that grows on a click is what the artboard avoids.
- **Naming areas instead of cards.** The artboard names cards.
- **One or two names.** The artboard names one closed card and two waiting; three keeps the sentence under two lines at
  the column's width with ordinary titles and still says what the day was.

**Tests.** `tests/unit/web-since.test.ts` (the forms, the cut at five, repeats named once, Hillevi's 34, the waiting
sentence); `tests/a11y/structure.spec.ts` ("when many cards closed since the day began …": seven closed, three named,
"och 4 till", the Klart tab's count).

**Replaces.** Nothing. D53 item 6 and D63 item 3 (three sentences in the artboard's words) stand; this says what the
sentences do at any count.
