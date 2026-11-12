# Design canvases

The design canvases are the reference for every screen: compare a screen with its artboard before calling it done.
They are Claude Design artifacts outside the repository and are private until the product owner shares them. Each row
names the decision that chose from a canvas and the review that describes it, so the reasoning can be read without the
link.

**Being replaced as the reference.**
[D115](../decisions/D115-the-startsidan-prototypes-version-1-0-is-the-reference-for-clews-look-and-layout.md)
(provisional, 2026-11-11) makes the startsidan prototype's Version 1.0 the reference for look and layout: the portal
in the repository `startsidan-prototype` (`apps/portal`), run with the cookie `startsidan-version=1.0`, described in
[the prototype against Clew](../reviews/2026-11-11-startsidan-prototype-version-1-0-against-clew.md). Until a step
of that decision is built, the screen it will change is still compared with its artboard below; once it is built,
that screen is compared with the prototype.

Add a row here in the change that first refers to a new canvas.

| Canvas | Link | What it draws | Decision | Review |
|---|---|---|---|---|
| The first canvas (no title recorded) | https://claude.ai/artifact/RhnCjPeZZHMmbvHQ5ZXobe | The chat-first start page on desktop and phone, asking a question, the "Läget" row, and the first use case: a manager plans the week | Not recorded | Not recorded; its rows are listed in the [frozen handover](../history/handover.md) |
| Clew uppmärksamhet | https://claude.ai/artifact/1P8XeGdLnBtRv87iHAwJxJ | Five attention levels with Astryx Neutral status tokens | None; an exploration | None |
| Clew designutforskning · schemaläggning och uppmärksamhet | https://claude.ai/artifact/MW2VeKV2pTrVvfLBUnzpki | Eight artboards on scheduling and attention | None; an exploration | [Scheduling and attention](../reviews/2026-11-04-design-exploration-scheduling-and-attention.md) |
| Clew startsida · översikt i stället för en lista | https://claude.ai/artifact/UiCMmm2fmEaq1M7cipBDvQ | The box with the brief, the conversation, the rail, the page without the model | [D34](../decisions/D34-the-box-is-the-page-and-the-push-is-its-brief.md) | [Start page overview](../reviews/2026-11-04-start-page-overview-exploration.md) |
| Clew · ett sammanhängande flöde | https://claude.ai/artifact/1dDLtj7R5AMmUa4qZNk6Da | The workspace: a flow map, Hem, the conversation with the panel, Att göra, a tool's page and two phone frames | [D50](../decisions/D50-the-conversation-is-the-column-and-the-panel-holds-what-it-is-about.md) | [UX flow exploration](../reviews/2026-11-05-ux-flow-exploration.md) |
| Clew startsida · dagen i ett svep | https://claude.ai/artifact/9xn43bAwXy2VioBqiG3xc6 | Hem: four directions A to D, then the flows E to K under A | [D53](../decisions/D53-hem-is-the-start-page-the-days-work-under-the-box-and-the-day-beside-it.md), [D63](../decisions/D63-hem-is-drawn-as-the-canvas-draws-it.md) | [Start page directions and flows](../reviews/2026-11-06-start-page-directions-and-flows.md) |
| Clew · hierarki, områden och figurer | https://claude.ai/artifact/YVw6FJL6YjKZprBAiAEA2f | Three type levels, the area mark, the figure's three forms, the answer with its view, the row and the open card | [D71](../decisions/D71-three-type-levels-and-an-area-mark-whose-colour-is-the-system.md) | [Visual hierarchy](../reviews/2026-11-06-visual-hierarchy-area-marks-and-figures.md) |
| Clew · att bli klar: ett tryck, en i taget, och kvittot | https://claude.ai/artifact/BZwgqCN9H9YGteA3XjNxfX | Completion: one press on the row, rows with a document reviewed one at a time, the receipt | [D70](../decisions/D70-one-press-confirms-on-the-row-and-rows-with-a-document-are-reviewed-one-at-a-time.md) | [Completion](../reviews/2026-11-06-completion-one-press-one-by-one-and-the-receipt.md) |
| Clew · det jag gjorde, och ångra | https://claude.ai/artifact/CDDCSdSrDTqUvXWxNb9N6Y | A decision as one row with six states, and undo | [D70](../decisions/D70-one-press-confirms-on-the-row-and-rows-with-a-document-are-reviewed-one-at-a-time.md), amended | [Completion](../reviews/2026-11-06-completion-one-press-one-by-one-and-the-receipt.md) |
| Clew · dagen bredvid eller i spalten | https://claude.ai/artifact/7XQKJ8PfcHAtp8QNQx7DXS | Where the day sits: beside the column or in it | [D72](../decisions/D72-the-day-is-the-pages-and-the-panel-holds-only-what-was-opened.md) | [The day beside or in the column](../reviews/2026-11-07-the-day-beside-or-in-the-column.md) |
| Clew · en entitet, många källor | https://claude.ai/artifact/Muchzp6aRAx9uxokwFLAfj | How a source attaches to a person or a unit: Personal, the lens under Visa, the opened person as sections; 19 artboards. A summary outside the repository: https://claude.ai/artifact/MC5SquxUxgPnJbEFhpsqxi | [D97](../decisions/D97-a-source-says-what-its-rows-are-about-and-clew-places-them.md) | [One entity, many sources](../reviews/2026-11-10-one-entity-many-sources.md) |

The descriptions are taken from the decisions, reviews and session notes that cite each canvas, not from the canvases
themselves. Where they disagree with the artboard, the artboard is right.
