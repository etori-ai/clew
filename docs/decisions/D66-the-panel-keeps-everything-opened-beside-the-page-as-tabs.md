# D66 · The panel keeps everything opened beside the page as tabs

**Status:** superseded by D110 as amended 2026-11-11 (the panel holds one thing; the tabs are removed), built 2026-11-06 on `main`, revised the same day (items 2, 4 and 5: a menu, not a row; item 3 the same evening: the fold keeps the tabs, Stäng alla closes all) · **Date:** 2026-11-06 · **Area:** ui

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
2. **With one thing open nothing changes**: the small heading ("Kort", or the view's title) and ✕ "Stäng panelen".
   From two, a menu of what is open takes the heading's place (revised 2026-11-06, see below): Astryx's `TabList` as a
   nav landmark named "Öppet bredvid", holding one `TabMenu` whose button reads the current thing's name (a card's
   title, a view's title: `PanelFrame.tab`, falling back to `title`) and opens the list of all of them, headed
   "N öppna bredvid", the current one checked, each leading to its address. "Öppna som sida" and ✕ stay at the end of
   the header. In the drawer (narrower windows and phones, artboard K) the same menu stands above the body. The card's
   own buttons, Inte nu among them, stay in the card: the header holds what is open and ✕, nothing of the card's
   (the product owner, 2026-11-06, against artboard E and D63 item 7, which had lifted the time action into the header).
3. **Closing closes the current tab only.** ✕, Esc, the row's "Stäng kortet", "Ny fråga i stället" and the token's X
   all take the current thing out of the address; the tab before it (else the first) then takes its place in the
   address, and the panel is empty when the last tab goes. With several open,
   ✕ is named after what it closes ("Stäng Omtankesamtal med Anna Lindqvist"), never "Stäng panelen", which it is not.
   Folding the panel keeps every tab ([D63](D63-hem-is-drawn-as-the-canvas-draws-it.md) item 14, revised the same
   evening; the afternoon's fold dropped them, which made a layout act the only way to close all). From two open,
   closing all is one choice, "Stäng alla (N)", in an Astryx `DropdownMenu` on a ⋯ icon button "Fler val för panelen"
   beside ✕ (in the drawer, beside "Öppna som sida" above the body); it drops every tab, closes the current thing and
   sends the focus back to what opened the panel, as the last ✕ does. The "N öppna bredvid" menu is a `TabMenu`, whose
   rows are tabs, so Stäng alla does not go among them.
4. **Focus and speech.** A thing opened beside the page takes the focus at the panel's start as before: the heading
   with one tab, the menu's button with several; when it took another's place its own name is spoken (the card's
   title, not "Kort").
5. **No tab has an X of its own and none can be reordered.** Astryx's `Tab` and `TabMenu` have neither, and the
   artboards draw neither; Esc and ✕ close the current one.

**Revised 2026-11-06, the same afternoon.** First built as a row of `Tab`s with `role="tablist"`, each pointing at the
body region, as the artboards draw it. The product owner compared it with the Claude desktop app's pane and named
three faults: the Inte nu picker in the header reads as a control over the tabs; ✕ at the far right reads as closing
the pane, as it does in every other app, and its label said so while it closed one tab; and the strip scrolled, so
with two cards open neither the current title nor what else was open could be read. The artboards' tab names are
short ("Kortet · Avtalet"); Clew's are full titles, and two of them overflow a 440 px panel, with the arrows taking
more. A strip that shows tabs while they fit and a menu when they do not would need a `ResizeObserver`, which the
working rules forbid, so from two it is always the menu, which Astryx ships for this ("use TabMenu when you want a
curated group of extra options rather than a scrolling strip").

**Why.** D50 made the panel one place for one thing, and D63 drew the single card against artboard E; the artboards
for a conversation (F, H, J) always drew several tabs, which D53 and D63 listed as not built. On Hem the single frame
meant a second card silently replaced the first, which the product owner saw as an overwrite. Weighed and left:

- **A dropdown of what is open** was left in the morning ("the artboards draw tabs; a `Selector` would hide the names
  and add a click") and chosen in the afternoon: the row hid the names worse, and the menu is Astryx's own `TabMenu`,
  not a `Selector`.
- **An X per tab, as the Claude desktop app draws it.** Astryx's `Tab` has none, and a hand-drawn one is a custom
  component the working rules forbid; with the menu, ✕ beside the current name does the same job.
- **Keeping every open thing in the address** (`card=a&card=b`). Every link on the page builds the address
  (`homeHref`, `withoutPanel`, the rows' `cardHref`), and a reload would reopen a pile the person may have forgotten;
  the address names one thing (D43, D50 item 4) and the others are the page's working state.
- **✕ closing all.** Artboard J labels it "Stäng panelen", but one Esc dropping three cards is a loss. (In the
  afternoon the fold cleared everything on purpose; since the evening it hides only, and the ⋯ beside ✕ closes all.)
- **A tab per thing in the row's "öppet bredvid".** The row says its card is open; which other cards are open is the
  panel's business.

**Tests.** `tests/a11y/todo.spec.ts` ("a row opens its card beside the list …": two cards open, the menu's button in
the "Öppet bredvid" landmark reads the current one's name and has the focus, ✕ is named after it, Inte nu is in the
card, the menu lists both with the current one checked and the other leads to its address, Esc closes the current
card and the other takes its place with the heading and "Stäng panelen" back, the last Esc empties the panel, no axe
violations with the menu closed and open; two opened again, "Stäng alla (2)" behind ⋯ empties the panel and gives
the focus back to the first row; "beside the page the panel folds away …": the fold keeps the card, the row and the
token, the focus on the button). `keyboard.spec.ts` and `card-actions.spec.ts` reach Inte nu in the card.

**Replaces.** D50 item 3's one-thing-at-a-time panel (it still shows one thing; the others wait as tabs); D53's and
D63's "left for later" for the panel's tabs. D50 item 4 (the address) and item 5 (the card goes along) stand.

**Amended 2026-11-06 by [D70](D70-one-press-confirms-on-the-row-and-rows-with-a-document-are-reviewed-one-at-a-time.md).** A done card whose receipt can still be undone stays in the panel, with the receipt, Ångra allt and the way on; the rule that a card leaves with its row now covers Inte nu, Avfärda and a receipt whose window has passed.

**Amended 2026-11-11 ([D110](D110-where-something-opens-is-decided-by-what-it-is.md)).** The tabs are withdrawn: the
panel holds one thing, and opening another replaces it, on every page, Hem included. The product owner, looking at the
app live, opened one card under "Behöver dig" on a person's page and then another, and the panel's header turned from
the small "Kort" and ✕ into a menu named by the second card's title with "Stäng alla" behind ⋯: several things beside
the page, which D110's amendment (answer 3: one opened thing, never a list) had ruled out. The header is always the
small title and ✕ "Stäng panelen", which closes the panel; the `TabList` with its `TabMenu` ("N öppna bredvid"), ✕
named after the current tab, the ⋯ with "Stäng alla (N)", `OpenTab`, `PanelFrame.tab`, a view's figure word on its tab
and `usePanel`'s `isOpen` and `replaces` options are gone. What stands: item 2's card buttons in the card, Inte nu
among them; item 4's speech, a card that takes another's place said by its own title (`PanelFrame.spoken`) with the
focus on the heading; and, from Personal's one thing at a time, the link that opened the new thing as the way back on
close. Browser Back returns to the card opened before because the address names it (`card=`), as it always did.
`tests/a11y/todo.spec.ts` and `views.spec.ts` assert the replacement in place of the menu.
