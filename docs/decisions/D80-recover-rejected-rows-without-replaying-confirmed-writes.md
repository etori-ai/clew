# D80 · Recover rejected rows without replaying confirmed writes

**Status:** accepted, implemented · **Date:** 2026-11-08 · **Area:** integrations, ui, authorization

**Decision.** A submitted review remains addressable and viewable, including each row's result and current source documents. It never silently becomes an editable copy of the previous decision. A definitive rejection can start one new review card containing only rejected rows. The new card has a deterministic identity derived from the original execution, so repeated clicks return the same attempt even after it completes. The original receipt remains intact. Each later failed attempt can itself start a new review. Unknown outcomes must be reconciled, never force-saved.

Record views may declare a bounded recovery section: labelled text fields and their current values, a same-connector correction capability, and an optional same-connector read capability returning a source-system link. Users prefer editing in Clew when the connector supports it, falling back to the source otherwise. A correction uses the existing human execution endpoint, immutable decision identity, source revision check, authorization, audit and outbox. It does not replace the invoice decision. Pending or unknown correction results stay pending; only confirmed success reloads the documents. The next approval requires fresh review evidence.

The UI uses shared Astryx completion feedback for confirmed results and generic successful saves. Partial and unknown receipts retain warning/error states. Reduced motion is static. Receipt notices keep undo failures visible and offer undo only while the source outcome and time window permit it. Status checks retain their controls and focus throughout the request.

**Why.** The product owner's local test exposed a toast that swallowed undo errors, status controls that flickered, an inaccessible completed review and an imperceptible review-only success cue. The finance fixture deliberately returns one unknown row; this is evidence for uncertainty handling, not permission to duplicate the write. Separate retry cards preserve successful effects and undo provenance without rewriting execution history.

**Replaces.** Amends D70 and D73 completion/review behavior and extends D79's record catalogue. All source-write, authority, audit and version-review boundaries remain in force. The feedback is composed from Astryx controls and its existing entry animation; no custom animation or CSS is introduced.
