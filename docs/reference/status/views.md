# Implementation status: views and documents

One page of [implementation status](../status.md). Each entry says what works in this checkout, what limits it or is still to do, and where the code and tests that show it are.

## Views and menu tools

**Works in this checkout.** `table`, `list`, `detail`, `text`, `document`, `record`, `metrics`, `series`, `activity`; controls; same-connector row opens; summary-only model reads; administrator-selected tool pages; an optional `unit` on a number field and `noun` on a table or list (D71, amended); a record's `subject`, the `tones` key `*`, and `beside` and `compact` on a field (D97). A view opens in the panel beside a conversation or a page, or as its tool's page, and a person can ask about a tool's page from the page ([D50](../../decisions/D50-the-conversation-is-the-column-and-the-panel-holds-what-it-is-about.md)). A tool's page is a table with a filter bar and an inspector ([D112](../../decisions/D112-the-interface-is-rebuilt-on-astryx-templates-a-queue-one-detail-shape-one-panel.md) item 6, board Tool): the title with the system's badge, then the view's search field and choice with the count of its rows; a row's own read (`view.open`) opens in the page's panel as the inspector, with the box under it, the address holding the selection, the row marked as the current one (`aria-current`, and a dot named "Visas bredvid" in the table), and ✕ or Esc giving the focus back to the row's name. A row that names a person or a unit still leads to that page by its name.

**Limits and pending work.** No connector-rendered app/iframe, series/sections view kinds or general page builder (a figure is an area's, D54, not a view kind). The catalogue is closed by [D100](../../decisions/D100-the-vision-is-narrowed-to-what-clew-can-keep-today.md); a read without a declared view is not drawn, and the default drawn from its output schema that D100 calls for is not built.

**Evidence.** [View contract](../../../packages/contracts/src/index.ts), [view rules](../../../packages/connectors/src/views.ts), [tests](../../../tests/unit/views.test.ts), [browser tests](../../../tests/a11y/todo.spec.ts), [a tool's page](../../../apps/web/src/pages/tool.tsx), [its scenarios](../../../tests/a11y/tools.spec.ts) (rewritten for D112 item 6, passed on 2026-11-12)

## Document and semantic catalogue

**Works in this checkout.** Shared PDF page/zoom/selectable text and text alternative, isolated DOCX preview, XLSX sheet/value preview and images; original download, attachment navigation, versioned record composition, typed metrics, line/bar charts with equivalent tables and source activity. Authenticated binary delivery verifies current scope, MIME, size, digest and versions. Signed review evidence is checked at new card, generic and job approvals; the finance fixture atomically rejects changed versions.

**Limits and pending work.** Markdown file previews deferred. Office previews are approximate and bounded; no OCR, PDF conversion, ranges or durable reading-state store. Legacy pending finance cards need a new scan after manifest refresh. Real-source validation and manual screen-reader checks remain required.

**Evidence.** [D79](../../decisions/D79-semantic-views-and-versioned-document-review.md), [guide](../../guides/document-and-semantic-views.md), [unit scenarios](../../../tests/unit/documents.test.ts), [browser scenarios](../../../tests/a11y/documents.spec.ts)

## Views, answers and small places

**Works in this checkout.** One header for every view kind, drawn by `DeclaredView`: the area's chip (the area that offers the capability, else its menu row), the source and the count in the view's noun, the controls or "Visa allt" at its end; on a tool page the title at level 1 comes first with the system's badge at the end of its line and the filter bar under it, the view's controls and the count (D112 item 6, in the one page header every surface shares, [D74](../../decisions/D74-one-page-header-for-every-surface.md)); a record's title at level 2. A number with a unit reads "12 platser"; a status is one badge whose word is its label for a yes/no, coloured only where the view gives a tone. Under the latest answer the view is a card with three rows and "3 av 7 rader". Search hits lead their meta line with the source's glyph and word, an old review date is a warning badge. Composer tokens, the person's chips and `@` rows carry their system's glyph; the review's drawer has the mark row and the counter badge; a silent system is a warning `Banner` at the top of every page, spoken once (D8).

**Limits and pending work.** A text view's own execute ("Jag har läst" under the text) is not built: a view has no execute and the receipt stays the card's. Astryx's table header and `MetadataList` labels keep Astryx's type. No signed-in pass on the development stack or screen-reader pass yet.

**Evidence.** [D71](../../decisions/D71-three-type-levels-and-an-area-mark-whose-colour-is-the-system.md), [view](../../../apps/web/src/components/view.tsx), [banner](../../../apps/web/src/components/source-banner.tsx), [unit tests](../../../tests/unit/views.test.ts), [labels](../../../tests/unit/panel-labels.test.ts), [browser evidence](../../../tests/a11y/views.spec.ts)

## Läget's figures

**Works in this checkout.** One tile per area whose connector answers a figure on `POST /clew/figure`, after the groups on Hem, in the areas' order (D54): the connector's label, tone, value, comparison, progress and `opens` (a same-connector read whose view needs no input, checked by the registry); a connector that does not answer is the registry's warning figure. Up to four figure calls run together within a shared two-second budget; current person authority and governance are checked after the batch, and remote requests are cancelled on expiry. `figureItems()` draws the tile (chip, tone in Clew's words, display-3 value, comparison or bar, the view it opens as a link to the panel; a sentence without a value; the silent tile; skeletons), the line in Sedan i går and the rail's word on Hem. An administrator switches a figure off per area on Områden ("Visa nyckeltalet", audited). The fixtures answer artboard 3's figures; the fixed `GET /api/figures` and its module are gone.

**Limits and pending work.** The line under an answer is the views' to mount; the panel has no tabs any more (D111), so the figure's word on a tab is gone. HME has no connector. No signed-in pass on the development stack or screen-reader pass yet.

**Evidence.** [D54](../../decisions/D54-figures-come-from-connectors-and-laget-draws-them.md), [mapping](../../../packages/ui/src/figure-items.ts), [tile](../../../packages/ui/src/figure.tsx), [registry tests](../../../tests/unit/connectors.test.ts), [mapping tests](../../../tests/unit/figure-items.test.ts), [browser evidence](../../../tests/a11y/structure.spec.ts)
