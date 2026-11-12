# D54 · Figures come from connectors, and Läget draws them

**Status:** accepted 2026-11-06 with the canvas D71 builds, built 2026-11-06 on `main`; amended below where the build differs; the tile's drawing and its place on the page to be changed by [D115](D115-the-startsidan-prototypes-version-1-0-is-the-reference-for-clews-look-and-layout.md) (provisional, 2026-11-11; not built, so this record still binds what is built); where figures come from stands · **Date:** 2026-11-06 · **Area:** integrations, ui

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

**Replaces.** The figures module named in [D20](D20-modular-monolith-ports-and-adapters.md) and the
"derived snapshot" wording for Läget in [D3](D03-three-module-kinds.md) and `docs/architecture/integrations.md`;
`FigureSchema` in `@clew/contracts`. Builds on [D21](D21-integrations-are-module-services.md),
[D22](D22-connectors-not-modules.md), [D38](D38-views-are-declared-by-connectors-and-drawn-by-clew.md) (the `figures`
view kind it lists as not built), [D40](D40-views-can-be-tools-in-the-menu-and-an-administrator-chooses-which.md) and
[D53](D53-hem-is-the-start-page-the-days-work-under-the-box-and-the-day-beside-it.md), which place Läget on Hem.

**Amended 2026-11-06, as built.** Built with artboard 3 of the canvas (D71's amendment says how the three forms are
drawn). Where the build differs from the text above or settles what it left open:

1. **The figure's shape.** `FigureSchema` in `packages/connectors/src/protocol.ts` (published in
   `docs/protocol/connector-protocol.schema.json`): `label` and `tone` as before, optional `value` (one number and its
   unit, a string the connector formats: "4,2 %", "14 av 23"), `comparison`, `progress { value, max }` and `opens` (a
   capability name). Without a value the label is the whole figure as a sentence ("Inget nytt sedan i går."), drawn
   without a tone word unless the tone says one, and never as a link even when it names `opens`. `FigureSchema` in
   `@clew/contracts` is gone; the browser gets `AreaFigureSchema` on `Area.figure`: the connector's answer with `opens`
   resolved to `{ capability, title }`, the time Clew read it (`observedAt`, for the line's "Personalsystemet 06:00"),
   and `unavailable: true` on the warning figure.
2. **The warning figure is the registry's.** A connector that throws, answers an error or answers outside the shape is
   one figure, "<source> svarar inte." in warn with `unavailable`, made in `Registry.areas`, for a bundled connector as
   for a remote one (`remote.ts` now throws instead of building the warning itself). The tile says when the source last
   answered (the card read's source status) and when Clew tries again (the next review or bundle of the day's rhythm).
3. **`opens` is checked like a menu row.** It must name a read of the same connector whose view opens without input
   (`menuEligible`, D40); otherwise the registry drops it, keeps the figure, and reports it through `onRefused` with the
   topic `figure:<area>`, which the connector check fails on. A view the person may not call is dropped silently, as a
   row's `open` is (D38).
4. **The switch is stored per area.** `connector.areas` (jsonb, migration `0033_connector_areas`) holds
   `{ <area>: { figure: false } }`; narrowing only, absent means shown. `PATCH /api/admin/connectors/:id` takes
   `figures: { <area>: boolean }` and writes one `connector.figure` audit row per area that changed, with the area's
   title. The registry reads it from the governance (`Governance.areas`) and asks no figure for an area switched off.
   It sits on the area's row of the Områden tab, as `Switch` "Visa nyckeltalet".
5. **The demo's figures.** HME is left out. The calendar's figure moved to its `calendar` area for a manager
   ("Utvecklingssamtal bokade", "14 av 23" from `samtalStatus`, which now also counts the members due a talk), so the
   chip reads Kalender as artboard 3 draws it; `utvecklingssamtal` has no figure. The HR, economy, deviation, time and
   communication fixtures answer the artboard's figures from their records (D52): the period's sick leave against the
   target, the share of the period's frame spent (the economy seed gained `frame`), open incidents with those older than
   14 days (the deviation seed gained two under investigation), today's booked substitutes, and what was published today.
   A development stack seeded before this needs `bun run fixtures:reset` for the economy figure.
6. **The fixed questions.** The router (D8) answers "hur ligger budgeten?" and the like from the areas' figures through
   the registry, not from the removed module.
7. **The rail's word.** The Hem row's badge is the worst tone among the person's figures ("lugnt", "bevaka", "behöver
   dig"); a person with no figure that has a tone keeps the count of what needs them, without the old fixed "lugnt".

