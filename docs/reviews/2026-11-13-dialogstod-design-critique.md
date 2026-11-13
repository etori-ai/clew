# Design critique: Dialogstöd's overview and the unit page · 2026-11-13

A design critique of Dialogstöd as [D117](../decisions/D117-a-manager-follows-up-the-units-below-and-a-source-is-told-them.md) first built it: the overview at `/units` and a unit's page at `/units/<id>`, seen in the development stack as the persona Ingrid Holm, a manager with units below her. It was run by hand against the heuristics of the open-source `impeccable` design skill (Apache-2.0), because the skill was not loaded in the session. It scored 18 of 36. Oliver Borgström chose to fix all five findings, prioritisation first and the table kept on a wide screen.

## Findings

| | Finding | Why it matters |
|---|---|---|
| P1 | No prioritisation. The units stood in the list's order and every cell looked alike, so a unit that needed action was found only by reading the whole table | The page exists to choose what to talk about first; big-boss-board's start page leads with that |
| P1 | On a phone the table showed the unit names and scrolled the figures out of sight | A manager between meetings saw no key figure at all |
| P1 | The figures lacked context. A column said "Sjukfrånvaro" but not which measure or source; a change of 0,3 had no sign, so a rise and a fall read alike; HME had no scale | A figure without its measure, sign or scale cannot be judged |
| P2 | State words were uneven: sick leave within its target had no word while the economy said "Klarar budget" and HME "Över mål", so a calm cell was blank in one column and a badge in the next; and a column a group never had (the round of talks for the units below) stood empty with "–" in every cell | A missing word reads as missing data; empty columns are noise |
| P2 | The unit page had no hierarchy: every source was a section of equal weight, so the key figures were reached by scrolling | The figures are what the follow-up is about; the details come after |

## What changed

- **Att ta upp.** A card above the groups counts the units per source and state that needs action or watching ("1 enhet · Sjukfrånvaro · Åtgärd krävs"), action before watching; when nothing applies, a status line says so. Within each group the units with the most to take up come first, once every source has answered.
- **Context in each figure.** A column's heading names the source, the measure where it differs from the title ("Avvikelse mot budget"), and where it comes from ("Qlik", "Clew"). The Qlik connector sends a change as signed text ("+0,3 procentenheter", "−1,6 mnkr") and HME as "av 100".
- **The phone.** Below the mobile breakpoint each unit is a card with its figures one under the other, each under its source's name.
- **Words and columns.** Sick leave within the target is "Inom målet". A source with nothing for any unit of a group has no column there; Clew's own sources stand after the key figures.
- **The unit page.** The key figures stand on top as a row of cards, each with its value large and its state, above the sections that give the details. The same summary (`apps/web/src/components/unit-figures.tsx`) draws a cell on the overview and a card on the unit page, so a unit reads alike in both places.

Not addressed: a screen-reader pass of the new summary and the cards, which D117's manual check still owes.
