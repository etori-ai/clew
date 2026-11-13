# D79 · Semantic views and versioned document review

**Status:** accepted for implementation; amended 2026-11-12: a review's decisions outlive a reload, its evidence does not (see the amendment) · **Date:** 2026-11-08 · **Area:** integrations, ui, authorization

**Decision.** Extend the connector catalogue with document, record, metrics, series and activity views. The product owner authorised the full catalogue after the [research](../reviews/2026-11-08-connector-view-catalogue-and-document-previews.md), excluding Markdown file previews for now. Existing text views remain supported. Connectors supply semantic data; Clew owns all rendering and actions.

1. A document read returns a versioned record and its document descriptors. Original bytes use a separate authenticated binary exchange at the registered connector address. Metadata, content and downloads check current access. Bytes are bounded and verified before release; arbitrary source URLs are never fetched. The initial implementation buffers a bounded file before its final authority check rather than forwarding an unchecked stream.
2. PDF, DOCX, XLSX and image previews share a reader. PDF.js, docx-preview and read-excel-file are isolated behind Clew-owned rendering adapters. Originals remain downloadable. XLSX is a bounded data preview of stored values, without formula evaluation; DOCX is a preview, not a promise of Word-identical pagination. Markdown file rendering is deferred.
3. **Astryx exception:** its inspected catalogue has no PDF/DOCX document renderer or line/bar chart primitive. Permit document canvas/text layers, an isolated no-script DOCX frame and semantic SVG line/bar plots, with narrowly scoped styles for that content only. All surrounding layout, controls, tables, statuses, navigation and review surfaces use Astryx. A connector cannot provide executable markup, CSS, a chart configuration or an application iframe. External document resources and active content are blocked.
4. Record composition is bounded: facts, optional documents, line items, metrics, series and activity. It is not recursive layout composition. Every series has an equivalent table. Metrics state units, reporting period and data time; gaps are distinct from zero. Activity is source history, not a substitute for Clew's execution receipts.
5. An execute may declare a document review read. Clew issues integrity-protected review evidence bound to the person, authority, read and record/document versions. Every new approval, including generic execution and job approval, verifies that evidence. A repeated committed decision keeps its original intent. The source atomically checks the expected versions with its write. The finance fixture demonstrates that contract; real sources must implement equivalent conditional approval.
6. Review selections do not write to the source. The existing drawer/mobile sheet, human decision endpoint, execution ledger and receipt flow remain. Opening or selecting document content sends nothing to the model. No durable draft or document index is introduced.

**Compatibility.** The catalogue and optional binary route extend protocol 2. Old manifests and legacy image previews remain valid. Connectors choosing the new review contract must supply its required evidence and conditional-write semantics. Generated schemas and the checker describe the implemented shapes.

**Verification.** Contract/transport tests cover malformed metadata, bounded content and authority changes. Approval tests cover tampering, stale versions and committed retries. Browser tests exercise each view, document formats, keyboard operation and narrow layouts. Live source readiness and manual screen-reader conformance remain separate release checks.

**Extended 2026-11-08.** [D80](D80-recover-rejected-rows-without-replaying-confirmed-writes.md) adds optional record recovery metadata for bounded correction fields and a source-system link. Corrections retain the human execution, authorization and source revision boundaries; a fresh invoice approval still requires new review evidence.

**Amended 2026-11-12.** The review is a page of its own since 2026-11-12
([D73](D73-the-review-is-a-page-in-the-shell-with-an-address.md) as amended that day, under the product owner's rule
recorded the same day in [D116](D116-a-panel-is-a-peek-at-one-thing-a-list-is-a-page-and-every-view-has-an-address.md) that a task a person works through is a page with its own address). "Closing the review retains
card selections, not durable review evidence: reopening requires review again" now reads: the person's decisions are a
draft kept in the browser tab for the session, with the record and document revisions each approval was taken on; the
evidence is not kept. When the page no longer holds an approval's evidence (after a reload, or close to its expiry),
Skicka reads that row's documents again and sends the fresh evidence only if the revisions are those the approval was
taken on; otherwise the approval is taken back and the row must be reviewed again. A changed document still never
renews a decision, and the server's checks are unchanged.
