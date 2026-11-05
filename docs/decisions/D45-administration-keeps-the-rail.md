# D45 · Administration keeps the rail

**Status:** accepted · **Date:** 2026-11-05 · **Area:** ui

**Decision.** The administration pages draw the same rail as every other page. `AdminShell` in
`apps/web/src/pages/admin/shell.tsx` calls `useRail` with `surface: 'admin'` and the open `section`; its own rail is gone
(the section Anslutningar, the text Om administrationen and the row Till startsidan). The row Administration in
`apps/web/src/components/nav.tsx` is built like Områden and the account row: the whole row opens and closes, and
Anslutna system and Modeller are links under it. A click on one of them changes the page and leaves the rail where it is.
The row is collapsed until one of the administration's pages is open, and the open one is marked. The pages themselves,
their breadcrumbs and their `Layout` do not change.

**Why.** The product owner found it messy that one row replaced the whole menu: the person lost their place, and the way
back was a row of its own. Every other row changes the page inside one shell (D31, D42), so these do too.

The shape was settled by trying the alternatives, and the first two were built:

- A plain link with its sections drawn only inside the administration (`collapsible={false}`). The product owner rejected
  it: the row could not be opened and closed like the rows around it.
- `href` together with `collapsible`, a link and a separate toggle. Astryx draws that toggle's chevron 2 px to the left of
  the chevrons on Områden and the account row, and nothing short of custom CSS lines them up (measured 223 against 225 px).
- Tabs on the page. The sections would leave the rail, which is where every other section of the product is reached.

The cost of the chosen shape is one more click from elsewhere in the product: the row opens first, then a section changes
the page. That is how Områden has always worked.

Nothing is lost with the old rail: the text repeated the lead on Anslutna system, and the way home is the heading and the
breadcrumbs, as on every page. A person without the grant still meets `NotAdmin` with its own way back.

The administration pages now read threads and areas for the rail, through the same session cache as every other page; no
endpoint is new. `tests/a11y/admin.spec.ts` covers the path from the start page through both sections, and
`tests/a11y/shell.spec.ts` that Administration has the same start, width, height and type as Kalender and its chevron
sits where Områden has it. Opening and closing by keyboard is covered in the former.

**Replaces.** D34's point that the administration keeps its own sections, and the panel list in the screens section of
`docs/architecture/connector-administration.md`. D31's one shell stands.
