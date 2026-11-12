# Connector view catalogue and document previews

Date: 2026-11-08

Status: research and proposed implementation scope. This does not add view kinds to protocol 2 or supersede an accepted decision.

Implementation outcome, 2026-11-08: the user subsequently authorised the full catalogue except Markdown file previews. [D79](../decisions/D79-semantic-views-and-versioned-document-review.md) accepts the implementation; [the current guide](../guides/document-and-semantic-views.md) and [status](../reference/status.md) describe the delivered scope, budgets and remaining live-source/manual validation. The research below retains its original proposals and sequencing.

**Build a reusable document view first, using invoice review to prove it.** Keep Clew's closed catalogue of semantic views, add explicit document representations, and retain Clew's existing approval and receipt flow. Extend metrics and series after the document journey reaches a real source.

The [invoice walkthrough](2026-11-08-invoice-review-and-document-walkthrough.md) applies this catalogue to a complete task. Policy reading and budget follow-up below test whether the same design works beyond invoices.

## Existing foundations

The relevant research already separates ownership: connectors supply business information, Clew renders it, and approved writes pass through the execution ledger. [D38](../decisions/D38-views-are-declared-by-connectors-and-drawn-by-clew.md) owns declared views, [D54](../decisions/D54-figures-come-from-connectors-and-laget-draws-them.md) owns area figures, and [D70](../decisions/D70-one-press-confirms-on-the-row-and-rows-with-a-document-are-reviewed-one-at-a-time.md) owns document review before a batch decision.

| Surface | Implemented in Clew at baseline 6c2f01a | Extension to explore |
| --- | --- | --- |
| Declared reads | `table`, `list`, `detail`, `text`; search and one choice filter; same-connector row opens | A document view and bounded record composition |
| Area figures | Label, tone, formatted value, comparison, progress and optional input-free drill-down | Typed measurements, explicit reporting periods and reusable metric presentation |
| Review preview | One base64 image or PDF per item, at most 4,000,000 base64 characters, approximately 3 MB decoded | Multiple documents, versions, separately fetched content and inline PDF viewing |
| Invoice fixture | SVG invoice generated from fixture records; PDF is supported by the shared contract but is download-only in the UI | Representative PDF, DOCX, Markdown and XLSX attachments |
| Review placement | Addressable desktop drawer and tall mobile sheet stacked over the card | Reuse these placements and keep review state above their layout |
| Cross-system jobs | Assembly, approval, execution and watches in the backend | User-facing approval and progress screens remain a separate development track |

The latest amendments to [D73](../decisions/D73-the-review-is-a-page-in-the-shell-with-an-address.md) and the review overlay (`review-overlay.tsx`, replaced on 2026-11-12 by the review's [page](../../apps/web/src/pages/review.tsx)) govern placement. Its original title describes a page that was subsequently replaced. The [implementation status](../reference/status.md) remains the current feature reference.

## What Eneo does

The comparison uses Eneo's primary SvelteKit application at commit `ccb7dccd5e8f66dea7f1f9652d742ec13849bc7a`, inspected through its development container. Its optional React beta is outside this comparison. These are code findings; rendering fidelity on real municipal documents still needs a browser evaluation.

### File previews

Eneo separates choosing a renderer, fetching original bytes, preparing content and displaying it. The shared panel can retain its state as the layout changes, cancel superseded downloads and keep a previously displayed version visible until its replacement is ready.

| Format | Eneo implementation | Consequence for Clew |
| --- | --- | --- |
| DOCX | Lazy-loaded `docx-preview` 0.4.1 parses the original bytes and creates document DOM in a host-created iframe. The frame excludes script execution; the host inserts styles and content, filters links, scales the pages and tracks selected passages. | Direct browser preview is a credible first option. Conversion to PDF need not be mandatory. Treat it as an approximate document rendering and retain the original. |
| PDF | Downloads the whole original into a PDF Blob, creates an object URL and opens the browser's native viewer in an iframe. Uses `navigator.pdfViewerEnabled` to choose an unsupported-viewer message and revokes object URLs on cleanup. | A small implementation, but controls and support depend on the browser. Eneo's application cannot reach text selections inside that native viewer. Consistent mobile reading and application-managed passage links need a separate evaluation. |
| Markdown | Reads a text prefix, then renders it with the shared Markdown token components and soft line breaks. HTML tokens render as code; links and image URLs pass scheme checks. | Use Clew's existing Astryx Markdown surface. Keep a file's identity and download separate from its rendered prose. Decide external-resource loading explicitly. |
| XLSX | Lazy-loads `read-excel-file/browser` 9.3.10, reads sheets into cell arrays and draws a read-only table with sheet tabs. Includes row/cell selection, keyboard navigation and explicit quotation with locators. | Reuse the concept of a sheet data preview. It does not reproduce workbook styling, charts or Excel editing. Do not present it as a fully faithful workbook view. |

Sources: [renderer selection][eneo-kind], [loader and limits][eneo-load], [DOCX renderer][eneo-docx], [PDF renderer][eneo-pdf], [content and quotations][eneo-content], [sheet viewer][eneo-table], [Markdown token mapping][eneo-markdown], [URL filtering][eneo-urls] and [locked dependencies][eneo-lock].

The loader checks declared original size against 25 MiB for DOCX, 50 MiB for PDF and 8 MiB for XLSX. Text uses an approximately 2 MiB prefix with a truncation notice. Tables retain leading rows, with a maximum of 500 rows and a width-dependent target of 20,000 cells; the minimum of 50 rows means the cell target is not a hard bound for unusually wide sheets. XLSX parsing happens before rows are capped. These are useful UX policies, not sufficient server-side resource limits for untrusted connector files. [Loader][eneo-load]

Eneo treats the first sheet row as column headings. Clew should preserve spreadsheet row numbers and column letters unless a source explicitly supplies a table schema. A title row, blank row or merged heading must not silently change a cell reference's meaning.

The parser reads stored formula results rather than recalculating formulas. Missing cached results and formula errors can appear as empty cells. Clew must label the preview as stored values and must not use a blank preview cell as evidence that a financial amount is zero. Exact identifiers and financial decimals also need preservation through parsing and display. [Parser documentation](https://github.com/catamphetamine/read-excel-file#formulas)

### Original files and extracted text are separate

Eneo's file preview resolves an original-download URL, not its processing representation. That matters because a DOCX, PDF or XLSX classified as text may have extracted text as its primary processing content. The URL service keeps separate caches for those representations. [Attachment URL service][eneo-attachment-urls]

Original-link creation checks access and availability. Redemption uses a token bound to the file, original representation and tenant, and checks the stored content; it is a bearer capability, not a fresh signed-in-person permission check. Its original route supports conditional revalidation, while the inspected file service permits byte ranges only for audio. Clew should adopt the distinction between original and derived content without assuming Eneo's download contract already supplies PDF range delivery or Clew's current-person revocation semantics. [Routes][eneo-file-router], [service][eneo-file-service]

Eneo also has a different knowledge-source preview: `BlobPreview` renders extracted text and source metadata, with a separate original download when available. That is a retrieval/source-reading experience, not the same as inspecting the exact original before a decision. [Knowledge preview][eneo-blob]

### What to reuse

Reuse the separation of content loading from rendering, lazy-loaded parsers, explicit unsupported/large/failed states, cancellation, focus return, and an explicit action for quoting selected content. Eneo's table tests cover keyboard movement, selection and quoting; its preview state tests cover replacement races and retaining the earlier document. [Table tests][eneo-table-tests], [preview tests][eneo-state-tests]

Adapt caching to Clew's sources: Eneo caches four previews by immutable file ID, whereas a connector record may change without changing its reference. Clew needs connector, document, revision and current authority in the reuse decision, plus invalidation on revocation and session changes.

Implement the interaction in Clew's React/Astryx stack. Eneo is a separate product with its own lifecycle and source ownership; this proposal introduces no Eneo runtime dependency.

## Proposed catalogue

Keep business views, file representations and actions as distinct concepts. A connector describes facts and relationships; it cannot supply a component tree, arbitrary HTML, JavaScript, chart configuration or layout instructions.

| Family | Semantic content | Clew presentation | Scope |
| --- | --- | --- | --- |
| List and table | Rows, labelled fields, stable references, read inputs and row-open targets | Responsive list/table, search, filtering, empty and partial results | Existing; improve pagination and typed money/units when a source requires them |
| Detail | One record's labelled facts | Metadata and readable values | Existing; reuse for invoice facts |
| Text | A Markdown body from a read | Astryx Markdown | Existing; also usable inside a document representation |
| Document | Document identity and available representations | Shared document reader, original download, source link, attachment navigation | First new general view |
| Metrics | Measurements with units, periods, comparison basis and freshness | Existing Läget family and compact measurements on a detail surface | Proposed shared semantics; no new configurable dashboard |
| Series | Time or category axis, named comparable series, units, gaps and source context | Initially line trends and bar comparisons, always with a data table | After document work; rendering exception needs a decision |
| Record composition | One record with named facts, line items and attachments | Clew-owned record template, consistently arranged by placement | Start with the invoice; do not begin with recursive `sections` |
| Activity history | Ordered source events with timestamps and permitted actor labels | Readable history with source provenance | Defer until a real case/invoice connector requires it |

An XLSX file remains a document with a sheet representation. A connector's invoice table remains business data with a declared schema. A sheet's arbitrary rows must not automatically acquire invoice actions.

The existing calendar family remains specialised. Maps, boards, diagrams, audio/video and editing are outside the first increment. Proposed input forms belong to preparation and approval flows, not a read view that executes directly. Source actions continue through Clew's human decision routes.

### Placements

| Placement | Behaviour |
| --- | --- |
| Conversation | Compact result or document reference, source and useful summary; open the full reader on demand. No automatic loading of every attachment. |
| Side panel | Read a record/document beside the page or conversation; keep attachment choice and reading position. |
| Tool page | More room for rows, filters and a composed record. Opening a document uses the same reader. |
| Review | Same record and reader inside the existing drawer/mobile sheet, with review decisions owned by the surrounding Clew flow. |
| Läget | One area figure under existing administrator visibility rules; drill into an authorised read. A document does not become an area tile merely because it has a preview. |

Closing the reader restores focus to its opener. Moving between placements keeps the record and document revision, not just a filename. A new revision must be named before it replaces the content under review.

## Document contract to settle

The following fields describe the proposed concepts, not a valid manifest or final wire schema.

| Concept | Information needed |
| --- | --- |
| Identity | Owning connector, business record reference, document reference, source revision, title, original filename and media type |
| Original | Availability, known byte size, authoritative source link where permitted; no credential-bearing source URL in the manifest |
| Representation | Stable representation ID, media type, originating revision, role such as original/derived preview/extracted text, completeness and availability |
| Location | PDF page; text passage locator; workbook sheet and cell/range coordinates, always qualified by document revision |
| Review evidence | The record revision and required document revisions presented for this decision |
| Access | Server-resolved person, source authority and authorised retrieval; declarations never grant access |
| Lifecycle | Loading, ready, partial, unsupported, unavailable, denied and changed; a retry or source/download path where allowed |

Prefer an original PDF when supplied. For DOCX, test direct browser rendering first; accept a source-provided PDF representation when it is tied to the same revision. Optional server conversion can follow if actual documents justify it. An extracted-text representation must identify itself and never silently replace an original in invoice review.

For XLSX, show sheets and original coordinates, with explicit preview bounds and stored-value semantics. Offer the original for formatting, formulas and further work. Markdown and plain text use host-rendered content. Images use the existing image/lightbox path. Unsupported formats retain useful metadata and authorised download/open-in-source actions.

### Delivery and authority

Move document bytes out of ordinary capability JSON. A read returns references; a Clew content endpoint resolves them through a verified connector exchange and streams the chosen representation. Define this binary connector exchange before implementation, including signed actor authority, byte/range limits, revision preconditions, cancellation and error mapping. Do not turn an arbitrary URL returned by a connector into an unrestricted server fetch.

Check current access before metadata, bytes, range requests, downloads and model extraction, and recheck after awaited source operations where results could outlive a revocation. Source-specific ACL changes need the revocation/revalidation mechanism required by [D75](../decisions/D75-source-snapshots-retain-the-authority-that-produced-them.md). Removing access can stop future reads and clear managed views; it cannot retract bytes already delivered to a browser.

Bound actual transfer size, expanded archive size, sheet/row/cell counts, parse time and memory. The filename is a hint; validate media and signatures before choosing a renderer. Avoid automatic external image/font fetches from documents. Keep temporary bytes and expiring URLs out of conversation history and logs.

The immutable-revision guarantee belongs at the source. Rechecking just before an action does not close the race between that check and the source write. The connector must enforce the expected revision atomically with the write or use an equivalent source-issued immutable approval token. If the source cannot support that guarantee, keep Clew's pilot read-only or send the approval to the source UI.

### Reading and asking are separate

Opening, scrolling or selecting content does not send it to a model. An explicit “Fråga om markeringen” action attaches a revision-qualified reference and, under the data-release policy, a bounded excerpt. The server reauthorises and resolves that reference before supplying context. A client-supplied quote cannot establish source truth or override instructions.

The initial document reader works without AI. Existing `modelReads: "summary"` is a useful boundary for declared views but does not by itself define document extraction, retention or release. Reuse Clew's search/source model where applicable; do not introduce a second document index.

## Figures and charts

Use a shared metric meaning for the area figure and its drill-down: stable metric ID, label, numeric value or explicit missing state, unit/currency, reporting period, organisational scope, source revision, source data time, Clew observation time and comparison basis. Targets and warning thresholds come from the source's business definition. A rising value is not inherently good or bad.

Preserve zero versus missing, a source outage versus an empty period, and percent versus percentage points. A trend declares whether values are actual, forecast or target, and whether periods are complete. Keep gaps visible; do not interpolate or sum incompatible series silently. Units and denominator definitions must match before comparisons are drawn.

Initially support a line for time series and bars for categorical comparisons. Every chart has a table with the same values and an equivalent route to detail; meaning never depends on colour or hovering. Bound points and series and let the source aggregate within its own access boundary.

The current figure's `value` and `comparison` are formatted strings and `opens` takes no input. Typed metrics and period-specific drill-down require deliberate schema changes and compatibility handling; a new chart cannot infer them reliably from those strings.

## Three journeys that test the catalogue

| Journey | What the employee does | What it proves |
| --- | --- | --- |
| Invoice review | Open pending invoices, inspect original and attachments, mark each row, submit once, read per-item outcomes | Documents, composition, version-bound approval and incomplete evidence |
| Policy reading | Search a policy, open a DOCX or Markdown document, follow an authorised passage, download the original or ask explicitly about a selection | The reader works independently of an approval flow and does not send content to the model on open |
| Budget follow-up | Open a Läget figure, read reporting period and freshness, inspect a trend/table and authorised underlying rows | Shared metric definitions, context-preserving drill-down and accessible chart alternatives |

For policy reading, an unavailable original must not be disguised as a complete document by extracted text. For budget follow-up, September data fetched today still says September. These journeys determine whether a new view is general enough to add.

## Renderer choices and Astryx

The inspected Astryx catalogue supplies Table, Markdown, Lightbox, Drawer, BottomSheet and document-tab/template compositions. Searches for PDF surfaced a thumbnail component, and chart searches surfaced theme helpers and compositions rather than a dedicated viewer/chart renderer. Read the relevant current component and layout documentation again when implementing.

| Candidate | Recommendation |
| --- | --- |
| Eneo-style native PDF viewer | Keep as a fallback or comparative prototype. It does not establish consistent mobile controls or application-controlled text selection. |
| PDF.js | Evaluate first for Clew's primary PDF reader, including text/annotation layers, keyboard interaction and mobile zoom. It is Apache-2.0; using it does not itself prove accessibility. [Project](https://mozilla.github.io/pdf.js/) |
| docx-preview | Evaluate for a host-owned, isolated DOCX preview. The project is Apache-2.0 and describes HTML fidelity limits; its documented stable entry point is `renderAsync`, whereas Eneo uses lower-level parsing/rendering functions. Keep that dependency behind one adapter. [Project](https://github.com/VolodymyrBaydalka/docxjs) |
| read-excel-file | Evaluate for bounded sheet data extraction, with precise values and source coordinates tested. MIT; a data reader rather than an Excel renderer. [Project](https://github.com/catamphetamine/read-excel-file) |
| Office conversion service | Defer until direct preview and source-provided representations fail representative cases. It introduces conversion jobs, storage and revision tracking. |

A host-controlled document canvas/frame is different from a connector supplying its own application. It still needs a narrowly scoped Astryx exception recorded in a decision before implementation: Clew owns the toolbar, navigation, access and actions; the renderer owns only document content. Constrain scripts, active content and external resource loading independently of visual isolation. This review does not grant the exception or select a dependency version.

## Development order and exit criteria

1. **Document contract and PDF invoice slice.** Resolve the binary exchange and renderer exception, build authorised original retrieval and one PDF/image review, and test revision-aware caching. Exit with the same document working from a record and review on desktop/mobile, without AI, including access loss and preview failure.
2. **Attachments and additional representations.** Add multiple attachments, DOCX, Markdown and XLSX against one shared document identity. Exit with explicit fallback/truncation states, retained sheet/page selection and representative fidelity/keyboard tests.
3. **One real integration and conditional approval.** Prove two users' different access, source ACL changes, document changes, read-back and recovery. If the source cannot make approval conditional on the reviewed version, the read pilot can finish while approval stays in the source.
4. **Metrics and series.** Extend the shared metric contract and deliver one budget drill-down with chart/table parity. Leave general composition and additional chart families until a source demonstrates the need.

Alongside this sequence, continue the already planned job approval/status UI and connector starter work as separate deliverables. Neither is a prerequisite for reading one invoice.

The implementation proposal should settle document/version ownership, content transport, renderer isolation, model release and conditional approval together. Generate schema/checker changes only after that proposal is accepted; retain the existing preview path for old connectors or explicitly negotiate the changed protocol.

## Evidence and verification

This research changes documentation only. Clew's contracts, renderer, fixture manifest, decisions and status were inspected; Eneo's primary frontend, original-file routes/service and relevant test source were inspected. No live municipal source or rendered Eneo browser session was used to establish fidelity. Library documentation was checked on 2026-11-08; no dependency was installed or pinned.

The research index and context inventory are generated from these files. Repository documentation generation, link validation and the existing signed-connector documentation smoke are the checks for this change.

[eneo-kind]: https://github.com/eneo-ai/eneo/blob/ccb7dccd5e8f66dea7f1f9652d742ec13849bc7a/frontend/apps/web/src/lib/features/file-preview/previewKind.ts
[eneo-load]: https://github.com/eneo-ai/eneo/blob/ccb7dccd5e8f66dea7f1f9652d742ec13849bc7a/frontend/apps/web/src/lib/features/file-preview/loadPreview.ts
[eneo-docx]: https://github.com/eneo-ai/eneo/blob/ccb7dccd5e8f66dea7f1f9652d742ec13849bc7a/frontend/apps/web/src/lib/features/file-preview/components/DocxPreview.svelte
[eneo-pdf]: https://github.com/eneo-ai/eneo/blob/ccb7dccd5e8f66dea7f1f9652d742ec13849bc7a/frontend/apps/web/src/lib/features/file-preview/components/PdfPreview.svelte
[eneo-content]: https://github.com/eneo-ai/eneo/blob/ccb7dccd5e8f66dea7f1f9652d742ec13849bc7a/frontend/apps/web/src/lib/features/file-preview/components/FilePreviewContent.svelte
[eneo-table]: https://github.com/eneo-ai/eneo/blob/ccb7dccd5e8f66dea7f1f9652d742ec13849bc7a/frontend/apps/web/src/lib/features/file-preview/components/TablePreview.svelte
[eneo-markdown]: https://github.com/eneo-ai/eneo/blob/ccb7dccd5e8f66dea7f1f9652d742ec13849bc7a/frontend/apps/web/src/lib/components/markdown/renderers/index.ts
[eneo-urls]: https://github.com/eneo-ai/eneo/blob/ccb7dccd5e8f66dea7f1f9652d742ec13849bc7a/frontend/apps/web/src/lib/components/markdown/sanitizeUrl.ts
[eneo-lock]: https://github.com/eneo-ai/eneo/blob/ccb7dccd5e8f66dea7f1f9652d742ec13849bc7a/frontend/bun.lock
[eneo-attachment-urls]: https://github.com/eneo-ai/eneo/blob/ccb7dccd5e8f66dea7f1f9652d742ec13849bc7a/frontend/apps/web/src/lib/features/attachments/AttachmentUrlService.svelte.ts
[eneo-file-router]: https://github.com/eneo-ai/eneo/blob/ccb7dccd5e8f66dea7f1f9652d742ec13849bc7a/backend/src/eneo/files/file_router.py
[eneo-file-service]: https://github.com/eneo-ai/eneo/blob/ccb7dccd5e8f66dea7f1f9652d742ec13849bc7a/backend/src/eneo/files/file_service.py
[eneo-blob]: https://github.com/eneo-ai/eneo/blob/ccb7dccd5e8f66dea7f1f9652d742ec13849bc7a/frontend/apps/web/src/lib/features/knowledge/components/BlobPreview.svelte
[eneo-table-tests]: https://github.com/eneo-ai/eneo/blob/ccb7dccd5e8f66dea7f1f9652d742ec13849bc7a/frontend/apps/web/src/lib/features/file-preview/components/TablePreview.svelte.test.ts
[eneo-state-tests]: https://github.com/eneo-ai/eneo/blob/ccb7dccd5e8f66dea7f1f9652d742ec13849bc7a/frontend/apps/web/src/lib/features/file-preview/FilePreview.test.ts
