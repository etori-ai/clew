# D90 · Mina ärenden is a section on Hem, after the day's work

**Status:** accepted (product owner, 2026-11-09), built; not compared with the design canvas, which has no errand section, and not yet seen against a running stack · **Date:** 2026-11-09 · **Area:** ui

**Decision.** A person with a case system sees their errands on Hem itself, as a list in the page's own column.

1. **Where.** On the Behöver dig tab, after the groups of the day's work (Nu, Jag föreslår, Senare, Till kännedom) and before Läget, under a group heading "Mina ärenden" at the level of the other groups. It is drawn with every area and with Ärenden as the chosen area, and not with another area chosen.

2. **What.** The combined list `clew.errands` ([D89](D89-an-errand-connector-acts-as-the-person-and-the-case-system-decides-access.md) item 8), drawn by the one view renderer (`DeclaredView`) from the view the core connector declares, in a `Card`: the view's own header with the count, its choice between what is assigned and what the person reported, the first five rows, "5 av 12 rader", and the systems that did not answer. Under it a button "Visa alla 12 ärenden" shows the rest in place, after which the focus is on the section's heading. What waits on the person is first in the list's own order, so the five rows are the ones that matter.

3. **A row opens the errand beside the page**, in the system it came from, as a card's row opens its card (D50): the list stays in the column and the errand is in the panel.

4. **Only for a person with a case system.** The section is there when the person's areas offer `clew.errands`, which the server does only then (D89). Without one, Hem is as before.

5. **Never "no errands" when nobody answered.** While the first read is on its way the section reserves its place with a skeleton (D76). A read that fails is an alert with the server's sentence and "Försök igen".

6. **Nothing is stored and nothing is pushed.** The list is read as the person when Hem is, with their token for each system. It is not a card: it has no state of its own, cannot be dismissed, snoozed or reminded about, and is not counted in "Behöver dig · n", in the rail's count or in Lugnt läge. An errand becomes a card when the scan of D89 item 5 is built; this section does not replace that.

Code: `apps/web/src/components/my-errands.tsx` (`MyErrands`, `hasErrands`) and one line in `apps/web/src/pages/start.tsx`. Astryx components only, after the "load more under a list" composition Astryx documents (`bunx astryx search` finds it as the `useTranslatorHookUsage` template: a count and a button under the rows); no new component and no CSS. Tests: `tests/a11y/errands.spec.ts` (the first five and then all with the focus kept, links into each system, the missing system named, no section without a case system, the failed read and the retry, 320 px).

**Why.** The product owner opened the combined list in the running stack and found it in the panel on the right, where a view opens when it is opened beside something, and asked for a list on Hem instead (2026-11-09). A tool page under Verktyg would have put it in the middle, but only after an administrator chooses the menu row, and it would still be one click away from the page a person starts on. Asked how errands should show on Hem, the product owner chose a section with the list over errands as cards and over both.

Cards remain the product's way to say "this needs you" (D35 item 5), and they need a scan that carries the person's token, which is not built (D89). The section is what can be true today: a read while the person is signed in. Item 6 keeps the two apart, so that the section is not mistaken for the stream: a list that cannot be dismissed must not raise the page's counts, and Lugnt läge keeps meaning that nothing was pushed.

The view is reused rather than drawn again because the list already has one declaration and one renderer: the order, the tone on the row that waits on the person, the system on every row and the sentence about missing systems are the same wherever the list is drawn. Five rows are a starting point, not a measured number.

Hem is otherwise drawn as the canvas draws it (D63). The canvas has no errands, so this section is an addition the canvas should take up; until it has, the section's place and its five rows are this decision's.

**Replaces.** Nothing. It adds a section to the Hem of D53 and D63.
