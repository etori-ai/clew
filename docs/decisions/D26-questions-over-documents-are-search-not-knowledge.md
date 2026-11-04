# D26 · Questions answered from documents are a search fan-out with citations, not a knowledge module

**Status:** proposed · **Date:** 2026-11-04 · **Area:** product

**Decision.** When a person asks the composer something whose answer lives in a document ("brukaren har
ramlat men verkar oskadd, vad ska jag göra?"), Clew answers it through the same path as every other
question: the model, or the deterministic router, calls one `read` capability that searches the systems
where documents live, as the person, and the answer cites what came back. Clew builds no knowledge base,
no index and no document store; it holds refs and the audit row. Concretely:

1. **One output contract for found text**, in `@clew/contracts`: a `SearchHit` row with `ref`, `type`,
   `label`, `snippet`, `link`, `source`, `owner`, `reviewedAt` and a `stale` flag. Every connector's
   `<id>.search` read capability returns `{ rows: SearchHit[] }`, and a `<id>.fetch` read returns one hit
   by ref. The names are the convention `integration-paths.md` already states for the search fan-out.
2. **One composite search capability in Clew's core**, `startsidan.search` with input `{ query }`. It fans
   the query out to every `*.search` in the actor's scope, merges, marks rows stale from `reviewedAt` with a
   pure domain function, and returns partial results when a source is slow or down, each failure named.
   The model sees this one tool with `model: true`; the per-connector `*.search` capabilities stay
   reachable by REST and views but are not offered to the model. This is the composite mechanism of
   `docs/architecture/working-across-connectors.md`, and it is testable on the memory adapters with a fake
   search connector, without Eneo.
3. **The catch-all rule in the router** (D8): when no capability matches the question and `startsidan.search`
   is in scope, the router runs it with the question as `query` and renders the rows as a view. Without a
   model the person gets the hits and reads the routine; with a model the model reads the hits and writes
   the answer. Convenience is removed, correctness kept.
4. **A `document` chip kind** (D12): a hit shown in the side panel can be added to the conversation; the
   chip is resolved by `fetch` on the connector that returned it, so a follow-up such as "och om hen slagit
   i huvudet?" is asked about that passage, not guessed from history.
5. **A use case in the threads module** that turns an answer into a card: a thread with the cited refs as
   items, a link-out action, an optional deadline, and its audit row in the same transaction. It is a
   `propose`; the card's button does the work. The answer itself never executes anything.
6. **Prompt and answer shape.** For a document answer the system prompt names the document, its owner and
   its review date instead of a system and a clock time, forbids claims beyond the retrieved text, and writes
   citations as `[n]` indexed into the view's rows. The model path gets a budget for retrieval plus
   generation instead of one eight-second limit. A routine may be answered as numbered steps ("Steg"), a
   third answer shape beside Svar and Vy, when the source is a procedure.
7. **Eneo is one source in the fan-out** (D14): an `eneo` connector under `connectors/`, in its own
   container, with `eneo.search` and `eneo.fetch` over Eneo's retrieval, scoped to the person's spaces.
   Without Eneo the same slot is filled by the document system's own search (intranet, SharePoint) through
   a connector of the same shape; the answers get thinner, the contract and the UI do not change.

What is not built: a knowledge module, document ingestion, a vector store, a Clew-side copy of any
document, a change to the connector protocol, the database or the scheduler. The side panel's rows gain a
link-out and "Lägg till i samtalet", which D12 already requires of every rendered object.

**Why.** The vision draws the line: a capability a person would want without Clew existing belongs in
Eneo and reaches Clew through the `eneo` connector; retrieval over documents is the textbook case, and
"Clew is not a search index over other systems' content" is already a stated non-goal. The conversation
loop needs nothing new for follow-ups: a question thread keeps its memory, the model calls in-scope read
tools, the first tool result with rows becomes a view, and a row becomes a chip. The gaps are all at the
edges: no shared shape for found text, so neither a citation nor a link-out could rely on anything; one
tool per document system, so the model would pick badly; a router that runs a match with empty input, so
free text could never reach a search; no chip kind for a passage; no way to turn an answer into a card.

A composite search instead of per-system tools follows the search-fan-out row in `integration-paths.md`
("one query from the composer goes to every connector in the person's scope that declares a `search`
read capability"). Marking staleness in code rather than in the prompt follows D8 and UC-FATIMA-5, where
a care worker must see whether a routine is current and who owns it. The alternative of embedding an
Eneo assistant as a side-panel view hands the whole dialogue to Eneo and loses Clew's rules on the way:
the audit row per turn, no names of individuals, source and time on every answer, and the card as the
only path to action. It stays available for long sessions; the tool path comes first.

Open, and decided per item later: whether follow-up questions come from the model as a structured field
or from the document's headings deterministically; how old a source may be before the answer warns, a
fixed limit or the document's own review interval; what "Fråga ägaren" does; and whether the `eneo`
connector acts with the person's token or as a service that narrows to their spaces, which is where a
leak would come from and is the first question for the Eneo spike. Drawn as row 3 (artboards I to L) on
the canvas "Clew designutforskning · schemaläggning och uppmärksamhet".

**Replaces.** Nothing. Narrows D14's "`eneo.knowledge.search` as a `read` capability" to the connector
convention `eneo.search` plus `eneo.fetch` behind one composite tool, and adds "Steg" as a candidate
answer shape beside the Svar, Vy and Förslag of `docs/architecture/integrations.md`.
