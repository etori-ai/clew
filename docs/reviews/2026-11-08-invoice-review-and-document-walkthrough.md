# Invoice review with documents and attachments

Date: 2026-11-08

Status: proposed interaction and acceptance scenarios. The existing review overlay is retained; the general document contract, additional formats and version-bound review described here are not implemented.

Implementation outcome, 2026-11-08: PDF, DOCX and XLSX attachments, source/version-bound review and conditional fixture approval are now implemented under [D79](../decisions/D79-semantic-views-and-versioned-document-review.md). The [current guide](../guides/document-and-semantic-views.md) distinguishes supported behaviour from the exploratory scenarios below. Markdown file previews, a live source pilot, durable review drafts and manual document accessibility validation remain outside this increment.

**An employee should be able to inspect the invoice and its supporting material, make a decision on each invoice, and submit the selected decisions once.** The receipt must describe what the source actually confirmed. Reading an attachment never approves the invoice or sends its contents to a model.

The [connector view catalogue](2026-11-08-connector-view-catalogue-and-document-previews.md) explains the proposed document contract and the Eneo comparison. This walkthrough gives it one complete task.

## Example work

All names, references and amounts below are illustrative fixture data, not live invoices.

A manager has three invoices requiring review:

| Invoice | Facts | Supporting material | Intended review result |
| --- | --- | --- | --- |
| F-1042 | Kontorsvaror AB; 12 450 kr; due 2026-11-20 | Invoice PDF, DOCX purchase agreement, XLSX line specification | Ready to approve after inspection |
| F-1043 | Fastighetsservice AB; 8 200 kr; due 2026-11-23 | Invoice PDF and Markdown delivery note | Leave pending because the delivery note does not establish completed work |
| F-1044 | Utbildning AB; 3 600 kr; due 2026-11-25 | Invoice PDF | Skip for now |

The three invoices are source records. Clew tracks their review as one work item, presented by its card; attachments are documents associated with those records. This follows the [product vocabulary](../reference/vocabulary.md).

The fixture amounts are business facts from the invoice source. The browser does not derive approval amounts by summing cells in the XLSX preview. The record declares which documents are required evidence for approval; optional supporting documents remain inspectable.

The source remains responsible for the invoice, document revisions, approval eligibility and any reversal. Clew owns the review selection, approved intent, delivery and receipt.

## Entry and return

The employee can start with the card's “Granska 3” link. Reading an invoice from a tool table or search uses the same record/document view; it should offer a route to an existing review work item when one is authorised. Creating review work from an arbitrary read is additional preparation work, not an execute button embedded in a table.

Use the existing address `/cards/:threadId/review?step=<n>`. On desktop it opens the review drawer over Hem and the originating card. On mobile it opens a tall sheet above the card's sheet. Closing returns to the card and restores focus to “Granska 3”. These placements follow the latest [D73 amendments](../decisions/D73-the-review-is-a-page-in-the-shell-with-an-address.md).

The step address restores navigation, not evidence that a document was reviewed. A durable resume, if included, must save the chosen selections with their reviewed record/document revisions and revalidate them when reopened. The existing local selection handoff is not a durable reviewed-version store.

## Step one Inspect the first invoice

The initial attachment is the invoice PDF. The employee sees facts and source context without waiting for every supporting document to download.

| Region | Example Swedish content | Behaviour |
| --- | --- | --- |
| Header | “Granska 3 fakturor” and “1 av 3” | Names the task and position; close retains permitted draft selections |
| Source and facts | “Ekonomisystemet”; “F-1042”; “Kontorsvaror AB”; “12 450 kr”; “Förfaller 20 november” | The values are read from the authorised record |
| Document choice | “Faktura.pdf”, “Avtal.docx”, “Specifikation.xlsx” | Opens only the selected document, with its identity and revision |
| Document controls | “Sida 1 av 2”, “Förstora”, “Hämta original”, “Öppna i ekonomisystemet” | Clew-owned controls; source action appears only when permitted |
| Decision | “Attestera”, “Lämna kvar”, “Hoppa över” | Changes the review draft; does not write to the source |
| Navigation | “Föregående”, “Nästa” and the existing stepper | Moves between invoice rows without changing their decisions implicitly |

On desktop, the document and invoice facts/decision occupy the existing two-column review composition. On mobile they stack with the document first, using the existing sheet and focus behaviour. A wider document can open a reading surface that returns to the same step, document, page/sheet and draft selection. Do not stack an independent modal for every attachment.

“Förstora” changes available reading space, not record identity or approval state. At narrow widths, the surrounding controls reflow; a genuinely two-dimensional sheet may scroll horizontally inside a labelled region. Page zoom and spreadsheet navigation must remain usable without dragging.

### The attachments

1. **Invoice PDF.** Show the source's original, page navigation and a readable text layer when available. An image-only scan remains an image-only scan; extracted text or OCR, if offered, is labelled separately.
2. **DOCX agreement.** Show a host-rendered preview with “Förhandsvisning av Word-dokument” and an original download. If the source supplies a PDF representation of the same revision, offer it without disguising conversion as the original. Tracked changes, pagination and fonts belong in the fidelity evaluation.
3. **XLSX specification.** Show sheet choices, original row/column coordinates and stored cell values. Label truncation and do not recalculate formulas. A missing formula result is not zero. The employee can select a cell or row and explicitly ask about it later.
4. **Markdown delivery note on the next invoice.** Render headings, lists, tables and code through the same host Markdown components. Preserve its document title, revision and original-download route. Raw HTML is not a connector UI.

Switching attachments does not reset the invoice's review mark. New source content must not silently replace the document under inspection.

## Step two Mark each invoice

After inspecting F-1042, the employee chooses “Attestera”. Clew records a draft selection associated with the record revision and the required documents' revisions. The mark means selected for submission; it does not claim the source has approved anything.

For F-1043, “Lämna kvar” means intentionally leaving the invoice pending. It is not rejection, return-to-supplier or a source comment. If a real integration needs rejection with a reason, add that as a distinct proposed action and approval flow.

For F-1044, “Hoppa över” advances without a review decision. On returning, it remains “Inte bedömd än”. Both skipped and left-pending invoices are excluded from the approval batch, while the summary explains their different meanings.

Clew does not infer that a person read every page from scrolling. The source can require evidence availability, and the UI can require an explicit review choice; neither proves human comprehension.

## Step three Check and submit

The final step shows the consequence before the write:

| Group | Swedish example |
| --- | --- |
| Selected | “1 faktura att attestera · 12 450 kr” followed by F-1042 |
| Intentionally pending | “1 lämnas kvar” followed by F-1043 |
| Not assessed | “1 inte bedömd” followed by F-1044 |
| Primary action | “Attestera 1 faktura” |

Totals are summed only across compatible currencies and authoritative invoice amounts. Mixed currencies receive separate totals. The selected rows and amounts are visible without reopening the documents.

Before accepting approval, the server rechecks current person/source authority, eligibility and the revision-bound review record. It resolves the selected references itself; browser-submitted amounts or revision labels are not trusted. The accepted intent, audit and dispatch record commit through the existing decision/execution path.

At execution, the source must enforce the same expected record/document version atomically with the write, or honour an equivalent immutable approval token. If something changed after review, the affected invoice returns to review with “Underlaget har ändrats. Granska fakturan igen.” A new preflight read alone cannot guarantee this.

Once approval is committed, the user follows that decision's existing identifier through recovery. A timeout, repeated click or reloaded page must not create a fresh approval. [Actions and receipts](../guides/actions-and-receipts.md)

## Step four Read the result

The existing card receipt remains the result surface. It shows each submitted invoice's source-confirmed outcome and offers undo only when the source supports it.

| Outcome | What the person sees |
| --- | --- |
| Source confirms approval | “Attesterad” for that invoice, with source/time |
| Dispatch is pending | A pending state; no completed checkmark |
| Source rejects because the version changed | The invoice needs renewed review; no silent substitution of the newer version |
| Source write may have happened but read-back is unavailable | An uncertain result and the established recovery path; no instruction to submit again |
| One invoice succeeds and another fails | Per-invoice outcomes; no claim that the whole batch succeeded |
| Undo succeeds | The source-confirmed reversal, linked to the original decision |

Left-pending and skipped invoices remain work that needs handling under the existing occurrence rules. They do not receive a successful receipt merely because another invoice was submitted.

## Behaviour under interruptions

| Situation | Required behaviour |
| --- | --- |
| Preview is loading | Keep the invoice facts and document title visible; announce loading without moving focus repeatedly |
| Required document cannot be fetched | Explain the failure and offer retry/open in source; do not offer a normal approval based on missing required evidence |
| The format is unsupported or rendering fails | Keep an authorised original download/source link. Read-only browsing can continue; approval follows an explicit evidence policy, never silently assumes the preview was reviewed |
| Preview is partial | Show what is omitted. A partial preview cannot satisfy a requirement to inspect the complete supporting document |
| Optional attachment fails | Identify that attachment; preserve the rest of the review. The source's evidence policy determines whether submission is possible |
| Access is revoked | Stop new reads and approval, clear the managed preview/draft context and show an access message without retaining sensitive labels unnecessarily |
| Source changes invoice or required attachments | Invalidate the affected draft selection and explain what changed; unaffected invoices retain their valid selections |
| The employee changes attachment quickly | Cancel superseded work and prevent a late answer from replacing the newly selected document |
| The viewport changes | Keep the step, selection and document position while drawer/sheet layout changes |
| The employee closes before submitting | Return to the card; make no source write |
| Reload/resume | Revalidate access and revisions before restoring a reviewed selection; absent durable review state means review again |
| Connection fails after submission | Recover the committed decision through its identifier and receipt, not a second intent |

Downloading an original for external inspection can be a valid review path only if the source's policy explicitly allows it and the original remains bound to the same reviewed revision. The pilot should first prove inline PDF review and leave unsupported mandatory evidence to the source system.

## Asking about a document

The optional “Fråga om markeringen” action adds an explicit, revision-qualified document or cell reference to the composer. The server authorises and resolves it under the model release policy. Merely opening the document or selecting a row sends nothing.

A question about a DOCX clause or XLSX row returns to the same document location when the employee opens its citation. If the document has changed, say so instead of highlighting a similar passage in the wrong version. PDF passage quoting is conditional on the chosen viewer; Eneo's native PDF frame does not provide that application-level selection.

AI can help explain the evidence or prepare a proposal. The final invoice decision still belongs to the employee and the ordinary human decision endpoint.

## Acceptance scenarios for the first build

1. A manager opens the same two-page invoice PDF from a record and from “Granska”, reads it with keyboard controls, and downloads the authorised original.
2. At 320 CSS pixels and at desktop width, controls remain reachable; focus enters and leaves the existing review surfaces correctly. A screen-reader pass checks status messages and reading order as well as automated accessibility checks.
3. Selecting a DOCX or XLSX attachment retains the current invoice, and returning restores the previous page or sheet. Markdown uses safe host rendering.
4. A workbook fixture includes multiple sheets, leading empty rows, a non-header first row, a long identifier, precise decimals, missing cached formula results and a truncated preview. Coordinates and meanings remain explicit.
5. Two users with disjoint source access cannot read each other's metadata, originals, previews or cached results. Revocation during retrieval and before submission denies the affected operation.
6. Changing an invoice or required document after “Attestera” prevents approval against the newer content, including a change between preflight and source execution.
7. F-1042 is submitted once; F-1043 and F-1044 remain pending. A duplicate submit/reload uses the original decision and creates no duplicate source action.
8. Lost-response and partial-success scenarios produce truthful per-item receipts, and undo appears only where supported.
9. A file exceeding transfer/parse limits, a malformed file and a late cancelled response fail locally without replacing another document or blocking navigation.
10. With no model configured, listing, reading, review, approval and receipts work. Opening a document does not populate model input or conversation history with its bytes.

## Implementation seams and decisions

Extend the existing [contract](../../packages/contracts/src/index.ts), [connector protocol](../../packages/connectors/src/protocol.ts), [finance fixture](../../connectors/finance/manifest.mjs) and review overlay (`review-overlay.tsx`, replaced on 2026-11-12 by the review's [page](../../apps/web/src/pages/review.tsx)). Keep a shared document reader independent of review decisions. Add server-owned review evidence and source revision preconditions to the approved-intent path rather than treating the renderer's state as authority.

The first implementation decision should settle the binary retrieval contract, review evidence/version binding, fallback policy and narrow Astryx renderer exception. The catalogue supplies candidates; this walkthrough does not prescribe a final endpoint shape or introduce a general page builder.

Start with the smallest end-to-end slice: one original PDF, one required record revision, one review, one conditional source action and one truthful receipt. Additional attachment formats then exercise the same contract.
