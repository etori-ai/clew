# D66 · The panel keeps everything opened beside the page as tabs

**Status:** accepted, built 2026-11-06 on `main` · **Date:** 2026-11-06 · **Area:** ui

**Decision.** Beside a page the panel ([D50](D50-the-conversation-is-the-column-and-the-panel-holds-what-it-is-about.md)
item 3) no longer replaces what it holds. Each card or view opened joins a row of tabs in the panel's header, in the
order it came, and the one the address names is current: artboards F, H and J of the canvas
**Clew startsida · dagen i ett svep** draw it as "Det samtalet rör" with "Kortet · Avtalet", "Mitt team · fre ·
Vikarieförfrågan" and "Jobbet · Hassan Ali · Mitt team"; the product owner asked for it on 2026-11-06 with two cards
opened after each other on Hem ("clicking on a card overwrites previous, maybe we need some kind of tab view or
dropdown showing currently selected"). Built in `apps/web/src/components/panel.tsx` (`usePanel`, `OpenTab`,
`PanelFrame.tab`).

1. **The address holds the current one, as before** (D50 item 4: `card=`, `open=`, `open-card=`); the other tabs are
   the page's state, kept while the person stays on the page and gone on a reload. Hem and a conversation asked from it
   are one page component, so the tabs go along to the conversation (D50 item 5) and back. A tab remembers its own
   search and leads to it on the current path.
2. **With one thing open nothing changes**: the small heading ("Kort", or the view's title) and ✕. From two, Astryx's
   `TabList` with `role="tablist"` takes the heading's place, each `Tab` named by the thing itself (a card's title, a
   view's title: `PanelFrame.tab`, falling back to `title`), every tab pointing at the one body region (`panel-body`);
   "Öppna som sida" and ✕ stay at the end of the row. In the drawer (narrower windows and phones, artboard K) the same
   row stands above the body.
3. **Closing closes the current tab only.** ✕, Esc, the row's "Stäng kortet", "Ny fråga i stället" and the token's X
   all take the current thing out of the address; the tab before it (else the first) then takes its place in the
   address, and the panel is empty when the last tab goes. Folding the panel drops every tab
   ([D63](D63-hem-is-drawn-as-the-canvas-draws-it.md) item 14: the fold clears the selection).
4. **Focus and speech.** A thing opened beside the page takes the focus at the panel's start as before: the heading
   with one tab, the current tab with several; when it took another's place its own name is spoken (the card's title,
   not "Kort").
5. **No tab has an X of its own and none can be reordered.** Astryx's `Tab` has neither, and the artboards draw
   neither; Esc and ✕ close the current one.

**Why.** D50 made the panel one place for one thing, and D63 drew the single card against artboard E; the artboards
for a conversation (F, H, J) always drew several tabs, which D53 and D63 listed as not built. On Hem the single frame
meant a second card silently replaced the first, which the product owner saw as an overwrite. Weighed and left:

- **A dropdown of what is open.** The artboards draw tabs; a `Selector` would hide the names and add a click.
- **Keeping every open thing in the address** (`card=a&card=b`). Every link on the page builds the address
  (`homeHref`, `withoutPanel`, the rows' `cardHref`), and a reload would reopen a pile the person may have forgotten;
  the address names one thing (D43, D50 item 4) and the others are the page's working state.
- **✕ closing all.** Artboard J labels it "Stäng panelen", but one Esc dropping three cards is a loss, and the fold
  already clears everything on purpose.
- **A tab per thing in the row's "öppet bredvid".** The row says its card is open; which other cards are open is the
  panel's business.

**Tests.** `tests/a11y/todo.spec.ts` ("a row opens its card beside the list …": two cards as two tabs, the current one
focused and selected with `aria-controls`, a tab leads to its address, Esc closes the current tab and the other takes
its place, the last Esc empties the panel, no axe violations with the row of tabs).

**Replaces.** D50 item 3's one-thing-at-a-time panel (it still shows one thing; the others wait as tabs); D53's and
D63's "left for later" for the panel's tabs. D50 item 4 (the address) and item 5 (the card goes along) stand.
