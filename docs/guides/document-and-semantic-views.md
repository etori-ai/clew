# Document and semantic views

Connectors declare data; Clew renders it consistently in conversation results, the side panel, tool pages and review. [D79](../decisions/D79-semantic-views-and-versioned-document-review.md) extends protocol 2 with five view kinds. Existing `table`, `list`, `detail` and `text` views remain valid. Markdown **file** previews are deferred; existing Markdown text views still work.

| Kind | Declaration | Payload |
| --- | --- | --- |
| `document` | `body` names an output property | `DocumentBundle`: record identity/revision and 1–20 document descriptors |
| `metrics` | `body` names an output property | `Metrics`: at most 12 measurements, each with numeric or null value, unit, period, data time and tone; optional target and comparison |
| `series` | `body` plus `chart: "line"` or `"bar"` | `Series`: at most 100 categories/times and six named actual/forecast/target series, with units, period and data time |
| `activity` | `body` names an output property | `Activity`: at most 100 source events with ids, timestamps, titles and optional detail/actor |
| `record` | `title`, `fields`, optional `document`, `metrics`, `series`, `activity`, `items` | Facts plus named semantic sections; one flat item table with at most 500 rows |

The complete types are published in [JSON Schema](../protocol/connector-protocol.schema.json) and [OpenAPI](../protocol/connector-protocol.openapi.json). The [manifest reference](../generated/manifest-reference.md) describes the declarations. Semantic payloads are validated even when a connector's own output schema is permissive. Document, metric, activity and series ids must be unique within their collection. Each series has one value per category; `null` means missing, never zero. A time axis uses strictly increasing parseable timestamps. Charts always have a labelled data table. Activity is source history, not Clew's decision audit or receipt.

## Original documents

Declare `documents: true` at the manifest root and a read with a `document` view, or a `record` containing a document section. For example:

```json
{
  "kind": "record",
  "title": "title",
  "fields": [{ "key": "supplier", "label": "Leverantör" }],
  "document": "document",
  "items": {
    "rows": "lines",
    "title": "text",
    "fields": [{ "key": "text", "label": "Specifikation" }]
  },
  "activity": "activity"
}
```

The read's `document` property has `ref`, `revision`, `title` and `documents`. Each descriptor has `id`, `revision`, `title`, `filename`, `mediaType`, `size`, `sha256` and `required`. Use opaque stable ids, an immutable content revision, exact byte length and lowercase SHA-256. Change the bundle revision whenever the underlying record, facts, required attachments or their versions change. Include the same `revision` on each scan item so preview/approval cannot combine old card facts with a newer document. A reused filename is not a version.

Implement `POST /clew/documents`. Its JSON body is `{ actor, request }`; `request` contains the metadata `capability` and its `input`, record `ref`/`revision`, document `document`/`documentRevision`. Verify Clew's assertion and transport key exactly as on a capability call. Authorize the actor against the record and document in the source. Refuse mismatched revisions with 409. Return the exact original bytes with matching `Content-Type` and `X-Clew-Document-Revision`. Never accept an arbitrary path or URL from the request.

Clew re-reads metadata under current access, buffers at most 25 MiB, validates length/MIME/revision/SHA-256, and checks current authority again before releasing bytes. The browser uses the same session-authorized route for preview and original download; there are no bearer file links or document bytes in model tools or stored conversations. Downloads use `private, no-store`, attachment disposition and no-sniff headers. This increment does not implement ranges, partial downloads, OCR, conversion services or a persistent document cache.

## Rendering and limits

| Format | Reader | Limits and fidelity |
| --- | --- | --- |
| PDF | PDF.js canvas, selectable text, page controls, fit/zoom and a reflowing page-text alternative | 25 MiB, at most 300 pages, bounded page canvas. No PDF scripts or interactive forms. Scanned pages may have no text. |
| DOCX | `docx-preview` in a no-script frame, fit/zoom, original download | 8 MiB preview. Inline document styles/images only; links inert, external resources and HTML chunks blocked. Pagination/fonts can differ from Word. |
| XLSX | Worker-parsed stored values, sheet selector, numbered rows and lettered columns | 8 MiB preview; at most 20 sheets, 500 rows and 50 columns per sheet, with a hard 20,000 displayed-cell budget across the workbook. Truncation is named. |
| PNG/JPEG/SVG | Image element and original download | 25 MiB. SVG is an image resource, never inserted as host HTML. |

Office archives are checked before parsing: at most 1,000 entries, 40 MiB expanded in total, 16 MiB per entry and a 200:1 expansion ratio. Actual decompression is checked against declared sizes. XLSX additionally rejects allocation-heavy sheets above 10,000 rows, 1,000 columns or 250,000 backing cells across the workbook; the worker is terminated after 15 seconds. These are preview budgets, not a promise to render every valid Office file. Larger or unsupported documents retain the authorized original download.

XLSX shows values, not an Excel reproduction: formulas are not evaluated, cached results may be stale/missing, and formatting, charts, merged cells and hidden-row presentation are not reproduced. Numeric strings are retained to avoid converting exact identifiers/decimals into rounded JavaScript numbers. Leading/interior empty coordinates remain in place. No sheet row is promoted to a business heading or action. PDF page/zoom/text mode and sheet choice are retained while switching attachments in the open reader, keyed to the exact version; no durable reading-state store is introduced.

## Review before a human decision

An execute that requires document review declares `review: "finance.record"`, naming a same-connector document read taking `{ ref }`. Its input accepts `refs` and `reviews`. A card uses `review: "each"`, `usesItems: true` and the same read as `preview`.

The card preview route returns `{ kind: "documents", capability, bundle, evidence }`. Other human clients may read `GET /api/documents/review?capability=…&ref=…`. Evidence contains the record and document versions, expiry and a Clew-issued integrity proof bound to the person, unit, authority and read. Echo it as `reviews` with the chosen `refs` when approving. Evidence lasts two hours. It identifies the authorized material supplied for review; it cannot prove that a human read or understood it.

Clew verifies fresh metadata and evidence before every new card, generic execution or job approval. Exact replays of a committed decision retain their original payload and receipt. The source must **atomically compare expected record/document versions with its write**; checking them only in a prior read is insufficient. Keep operation-id deduplication ahead of version comparison so a successful replay returns its recorded result. Return undo input containing only confirmed records, without the review proof.

Required documents must render before the UI enables approval. A failure has retry and an explicit reload of the metadata; changing a document does not silently renew a prior decision. Neither selection nor preview writes to the source.

The review is a page of its own, `/items/<threadId>/review?step=<n>`, reached from the card's `Granska N` and from each row under its "Dokument" (an overlay over the page until 2026-11-12, [D73](../decisions/D73-the-review-is-a-page-in-the-shell-with-an-address.md) as amended). The person's decisions are a draft kept in the browser tab for the session, per card: a reload, Back and Forward, or leaving the page and coming back keep them, and the card then offers `Fortsätt granska`. The draft holds each row's decision and, for an approval, the record and document revisions it was taken on; it never holds the review evidence. When the page no longer has the evidence of an approval (after a reload, or once it is close to expiry), Skicka reads that row's documents again and sends the fresh evidence only if the revisions are the ones the approval was taken on; otherwise the approval is taken back and the person is asked to review the row again. The draft is cleared on Skicka, when the card's reviewed rows change, and when the session ends.

The independent [finance fixture](../../connectors/finance/) demonstrates original PDF/DOCX/XLSX, record composition, metrics, both chart types, activity, conditional approval and undo. Its trend is explicitly synthetic. Existing development registrations need a manifest refresh and source restart after updating this fixture; pre-existing pending invoice cards need a fresh scan to adopt the versioned preview. Legacy image preview contracts remain supported for other connectors.

## Reopen, correct and retry

Submitted reviews remain available from the card and from **Klart**, including after the undo window closes. The receipt retains the original decision; documents are read from the source's current version. A definitive rejection offers **Granska avvisade igen**, creating one new review of only rejected rows. Repeated requests return the same retry card, including after that retry completes. Pending or unknown writes must be checked first. They cannot be force-saved.

A record view can name a `recovery` output property containing:

```json
{
  "correction": {
    "capability": "finance.correct",
    "label": "Spara rättelse",
    "fields": [{ "key": "order", "label": "Beställningsnummer", "value": "", "required": true, "maxLength": 80 }]
  },
  "source": { "capability": "finance.open", "label": "Öppna i ekonomisystemet" }
}
```

Both entries are optional. The first version supports up to 12 bounded text fields. Correction capabilities must be authorized executes of the same connector, accepting `{ ref, revision, changes }`; source links must be authorized reads of that connector, accepting `{ ref }` and returning an HTTP(S) `url`. A correction is a separate human-approved execution with normal audit, deduplication, dispatch and read-back. The source must reject stale revisions and fields outside its input schema. Only confirmed correction success reloads the documents, clears prior selections/evidence for that row, and permits fresh review. A missing correction form falls back to the source link.

The finance fixture supports correcting an order number. Its delayed invoice resolves to a missing-order rejection on lookup; after correction, a newly reviewed attempt succeeds. `FIXTURE_FAULT=rejected` supplies the rejection immediately for tests. The source-system URL is a synthetic placeholder in this fixture. [D80](../decisions/D80-recover-rejected-rows-without-replaying-confirmed-writes.md) records the recovery and shared completion behavior.

## Evidence and remaining validation

[Unit scenarios](../../tests/unit/documents.test.ts) cover source/actor boundaries, changed versions, byte substitution, descriptor replacement, revoked access, evidence tampering/expiry, approval audit and replay. [Browser scenarios](../../tests/a11y/documents.spec.ts) exercise the actual renderers, charts/data tables, attachments, failed-load approval gating and 320 px review. The [review suite](../../tests/a11y/review.spec.ts) checks the page: keyboard decisions through 3 and 12 rows, a changed decision, Skicka with its receipt, a rejected row and its retry, a reload and a way out and back keeping the decisions, Back with the focus on the control that led there, the old addresses, the phone and 320 px.

The no-script DOCX frame cannot host axe's cross-frame messaging: its surrounding controls are audited and rendered frame text is asserted separately. Real municipal-file fidelity, screen-reader behaviour inside documents and a live source's conditional-write semantics still require validation before production release.
