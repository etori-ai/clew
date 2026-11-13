# D8 · Every action works without the model

**Status:** accepted, refined by D104 (2026-11-10, provisional: the model is the main way work gets done, a floor of core features holds without it, and the assistant may act alone within governed limits; nothing is built, so the rules below still bind what is built); the banner the shell drew under this record for a connected system that does not answer (D71 artboard 8) is replaced 2026-11-12 by [D116](D116-a-panel-is-a-peek-at-one-thing-a-list-is-a-page-and-every-view-has-an-address.md)'s amendment (said where the system's content is missing); the model's own banner stands · **Date:** 2026-11-03 · **Area:** product

**Decision.** The model is an accelerator, never a dependency. Every capability in the registry (D1) is
reachable through a deterministic path: a REST route the UI calls directly, a button in a thread, or a
standing action in an area ("Gör själv"). If the configured AI provider is down, slow or returns garbage,
the page still shows what needs you, every button still works, the scheduled scans still push threads, and
the composer degrades to a deterministic command box. Nothing that reads, proposes or executes may have the
model in its only path.

**What the model is used for.** Understanding free text in the composer and in replies, choosing which
capability to call and with what arguments, and writing the explanatory sentences in a thread. Each of
these has a fallback: the intent router in `apps/server/src/assistant.ts` plus typeahead over capability
names, the standing actions and thread buttons, and templated text ("Varför nu?" is built from the trigger
record, not generated).

**Where the line is.** Proposals are computed by deterministic code (the planner in `apps/server/src/planner.ts`
plans the week without a model). The human decision endpoint is deterministic and re-validates against
live sources. The model may call `read` and `propose` capabilities to draft a thread; it never calls
`execute`. So a provider outage removes convenience, never correctness.

**Degraded state is explicit.** The page shows a banner when the provider is unreachable, the composer
changes its placeholder and offers only deterministic completions, and buttons that need the model
("Svara" with free text) say so instead of failing silently. Audit rows record `assistant: 'unavailable'`
on threads created in that state. Design: canvas artboard "Mission control 4 · Utan modell".

**Why.** A municipality cannot have its start page stop because a vendor's API is down, and the open-source
constraint means the model is whatever an operator points at. Keeping every path deterministic also keeps
every path testable without a model, which the first use case already proved.

**Replaces.** Nothing. Makes explicit what HANDOVER item 1 ("keep the router as the fallback") implied.
