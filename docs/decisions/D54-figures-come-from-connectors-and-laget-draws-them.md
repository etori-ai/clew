# D54 · Figures come from connectors, and Läget draws them

**Status:** proposed 2026-11-06, not built; awaiting the product owner's decision · **Date:** 2026-11-06 · **Area:** integrations, ui

**Decision.** Läget on Hem shows the figures the person's connectors answer, not a list fixed in Clew's code. The
figure is the connector's, by area and by role; Clew decides where and how it is drawn, and an administrator decides
whether an audience sees it. Nobody arranges tiles.

1. **One tile per area with a figure.** `GET /api/figures` and `apps/server/src/modules/figures/` go. Hem draws
   `Area.figure` for every area the person has whose connector answered one, in the order the areas come (the same
   order as the toggles under the box, D41). An area whose connector answers null, or that the person may not see,
   has no tile. A connector that does not answer gets the one warning tile the registry already makes ("<source>
   svarar inte", D8), never an empty page.
2. **The figure's shape grows in the protocol, as a view kind.** `FigureResponse` keeps `label` and `tone` and gains
   optional `value`, `comparison` and `progress { value, max }`, the shape `FigureSchema` has today, so the tile can be
   drawn as it is now (a label, the value large, the tone as a `StatusDot` with its word, the comparison under it, a
   `ProgressBar` when there is a target). This is D38's `figures` view kind: declared by the connector, drawn by Clew
   with Astryx, never a connector's own rendering. The tone keeps D38's rule that colour never stands alone.
3. **The tile leads where the connector says.** The figure may name `opens`, a read capability of the same connector
   with a declared view (D38) that opens without input, and the tile is then a link to that view in the panel
   (`open=` in the address, D50 item 4), working without the model. A figure without `opens` is not a button: it is
   a sentence. The four fixed questions in `start.tsx` go with the fixed ids.
4. **Who decides what.** The connector's author decides what the figure says and for which roles, in the manifest and
   the figure route, as today. The administrator decides whether an audience sees the area at all (D23) and gets one
   `Switch` per area, "Visa nyckeltalet", on the connector's Områden tab beside "Verktyg i menyn" (D40): a figure that
   is right for a connector but wrong for a municipality is switched off there, for the connector's audience. The
   person pins, hides and orders nothing: the vision says Clew is not a page builder, and D40 left a person's own pin
   open; it stays open and is not taken here.
5. **The mocks keep the demo.** The bundled connectors already answer figures (`packages/connectors/src/mock/*`, the
   calendar connector); they gain the richer shape so the demo shows the same four tiles for a manager of a unit with
   data, from the connectors instead of from the server, which is where D52 wants synthetic values to live. HME, which
   no mock answers today, becomes an area figure of the HR mock or is left out.

**Astryx.** The tile is unchanged: `ClickableCard` where it opens a view, `Card` where it does not, `StatusDot`,
`ProgressBar`, `Grid`. The administrator's switch is the `Switch` D40 already uses. Nothing custom.

**Tests.** `tests/unit/connectors.test.ts` and `remote-connector.test.ts` (the richer figure from a bundled connector
and from a manifest, a null figure, a down connector's warning, `opens` refused when it names another connector or a
capability without a view), `tests/a11y/structure.spec.ts` (one tile per area with a figure, none for an area
without, the tile's name carries the value and the tone's word, a tile with `opens` is a link to the view),
`tests/a11y/admin.spec.ts` (the switch per area), the connector checker reports whether an area's figure has the
richer shape without printing its value (D44).

**Why.** The review [where Läget's figures come from](../reviews/2026-11-06-laget-figures-review.md), 2026-11-06. The
page draws four values hard-coded in the server while the protocol has had a figure route since D21 that every bundled
connector implements and no screen shows; a unit without the data shows "0 av 0 kvar"; a new connector has no way onto
Läget. Weighed and left:

- **Keeping the figures module as a derived connector** (D3's third kind) that reads the pass-through connectors and
  computes Läget. It would still name the four tiles in Clew's code and still need the richer figure from each
  source; it adds a layer without removing the fixed list. D22 keeps "derived" for a connector that genuinely combines
  sources, not for passing their figures through.
- **A tile configured by the administrator** (which capability, which label). That is the block layout the vision
  rules out, and D40's line holds: an administrator switches what a connector offers on or off, and never composes.
- **A person's own choice of tiles.** Left open as D40 left the pin open; a manager's unit is the natural scope if it
  comes, and it would be a decision of its own.
- **A chart in the tile.** D38 says `series` needs its own decision because Astryx has no chart component; a figure
  with a progress bar is as far as this goes.

**Replaces.** When accepted: the figures module named in [D20](D20-modular-monolith-ports-and-adapters.md) and the
"derived snapshot" wording for Läget in [D3](D03-three-module-kinds.md) and `docs/architecture/integrations.md`;
`FigureSchema` in `@clew/contracts`. Builds on [D21](D21-integrations-are-module-services.md),
[D22](D22-connectors-not-modules.md), [D38](D38-views-are-declared-by-connectors-and-drawn-by-clew.md) (the `figures`
view kind it lists as not built), [D40](D40-views-can-be-tools-in-the-menu-and-an-administrator-chooses-which.md) and
[D53](D53-hem-is-the-start-page-the-days-work-under-the-box-and-the-day-beside-it.md), which place Läget on Hem.
