# Review: where Läget's figures come from, and who should own them · 2026-11-06

Requested by the product owner on 2026-11-06 with a picture of Läget on Hem for the unit IT och digitalisering:
Korttidsfrånvaro 4,1 %, Budgetavvikelse −1,8 %, HME 79, Utvecklingssamtal 0 av 0 kvar. The questions: are these
mocked, is this a view a connector should provide, what do the decisions say, how should they be managed and who
may edit the blocks. No code was changed for this review.

## What the tiles are today

Read from `apps/server/src/modules/figures/domain.ts`, `apps/server/src/routes/api.ts` (`GET /api/figures`),
`packages/contracts/src/index.ts` (`FigureSchema`) and `apps/web/src/components/lage.tsx`, `pages/start.tsx`:

- The four tiles are produced by the server's own figures module. Three are literal strings in the code (4,1 %,
  −1,8 %, 79) with their sources labelled "(syntetiskt)". Only Utvecklingssamtal is computed, from the calendar's
  `samtalStatus`, which is why a unit with no members shows "0 av 0 kvar".
- The contract pins the set: `FigureSchema.id` is a union of exactly `korttidsfranvaro`, `budgetavvikelse`, `hme` and
  `utvecklingssamtal`. The route maps each id to an owner connector (hr, finance, hr, calendar) and hides a tile when
  the person may not see that connector. No connector can add a tile or change one.
- Each tile is a `ClickableCard` that asks a question in the box, from a map of four fixed questions in `start.tsx`.

## What the protocol already offers, unused

- A connector's manifest area may declare `figure: true` (`ManifestAreaSchema` in `packages/connectors/src/protocol.ts`),
  and Clew then posts `FigureRequest` (`actor`, `area`) to `/clew/figure` and gets `{ label, tone }` or null
  (`FigureResponseSchema`). The registry's `areas()` fills `Area.figure` from it, skipping the call for the
  administrator's structural preview; a remote connector that is down answers "<source> svarar inte" with a warning
  tone (D8).
- Every bundled connector implements it: the HR mock ("Frånvaro 8 % · 11 av 12 på plats", and "07:00–16:00 på
  Avdelning B" for an employee's own shift), finance ("+1,2 % · prognos"), incidents ("2 öppna avvikelser"), the
  calendar ("3 möten i dag, lucka 11:00" and "4 hållna, 8 bokade · senast 28 nov").
- Nothing on the page draws it. The rail drew it beside each area until D50 took the areas out of the rail; today it
  appears only on the administrator's connector page as "figure yes/no" (`docs/architecture/connector-administration.md`),
  and `connector-check` keeps the value out of its report on purpose (D23, D44).

## What the decisions say

- D3 and `docs/architecture/integrations.md` name Läget a derived snapshot computed from pass-through connectors. That
  was the synthetic first build; the figures module predates connectors as a concept (D21, D22).
- D21 made `/clew/figure` part of the protocol; D22 says a connector brings capabilities, a scan, areas and figures.
  The intent that figures belong to connectors is already recorded.
- D34 makes a figure one of the four kinds a thing on the page can be (krav, förslag, händelse, figur), "Läget, never a
  thread". D38 lists `figures` (stat tiles) among the view kinds not yet built. D53 places Läget after the groups on
  Hem for every area at once.
- `docs/vision.md`: "Not a page builder. There is no operator-composed layout … Operators configure connectors, scopes
  and bundle times, not blocks." D40 is the precedent for how far administration goes: an administrator switches a
  connector's view on or off for the connector's audience, and arranges nothing.

## Findings

1. **The page draws the mechanism that cannot grow and ignores the one that can.** Läget comes from a fixed list in the
   server while every connector already answers a figure that no screen shows.
2. **A unit without the data shows a tile anyway.** "0 av 0 kvar" is the fixed list's calendar figure for a unit with
   no members; a connector answering null would simply not be drawn.
3. **The tile's richer shape is not in the protocol.** The page's tile has a value, a comparison, a tone and a progress
   bar; the connector's figure is one line and a tone. The richer shape is D38's `figures` view kind.
4. **The click is Clew's, not the connector's.** The question a tile asks is hard-coded per id, so a new connector's
   figure would have nowhere to lead.
5. **Who edits is already answered by the vision and D40,** and the answer is: the connector's author decides what the
   figure says, by role; the administrator decides whether an audience sees the area, and could switch a figure off;
   the person arranges nothing.

## Recommendation

Recorded as [D54](../decisions/D54-figures-come-from-connectors-and-laget-draws-them.md), proposed and not built:
Läget draws the areas' figures from the connectors, one tile per area the person has whose connector answers one; the
figures module and its four fixed ids go; a figure may name the read capability it stands for so the tile opens that
view without the model; the richer tile is the `figures` view kind D38 left open; the administrator gets one switch per
area, "Visa nyckeltalet", beside "Verktyg i menyn"; no pin, no hide and no order for the person. The mocks keep the
demo values, in the connectors where D52 wants them.
