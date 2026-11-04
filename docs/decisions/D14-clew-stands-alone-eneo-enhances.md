# D14 · Clew stands alone; Eneo enhances it through an optional module

**Status:** accepted · **Date:** 2026-11-04 · **Area:** product

**Decision.** Clew is a standalone system. It runs, builds and tests with no Eneo installation present and
nothing in the repository depends on Eneo: no import, no build-time call, no required endpoint. The AI
that manipulates Clew (the composer, thread replies, choosing capabilities, drafting cards) is Clew's own,
against any OpenAI-compatible endpoint, and is optional (D8). Eneo's products (knowledge bases and
retrieval, operator-built assistants, apps and services, model administration and classifications) reach
Clew through one optional `eneo` module that registers like any other pass-through module and degrades
to the standard fallback when Eneo is disabled or unreachable. In the other direction Clew may be
registered in Eneo as an external MCP tool source; every call runs as the user under a release policy,
and `execute` capabilities are never exposed. The full who-does-what table is in `docs/vision.md`.

**Why.** A municipality must be able to run its start page without a second large system, and another
municipality may run Eneo, a different platform or none. Coupling Clew's agent loop to Eneo's API would
make every assistant change a two-system release and put a second failure domain in front of every
question. Rebuilding knowledge management or an assistant builder inside Clew would be a second Eneo.
Keeping the line at "about Clew" versus "a product on its own" gives each new AI ask one home.
The analysis was done for startsidan (doc 19, 2026-09-15) and confirmed there by ADR-094; Clew inherits it.

**Replaces.** Nothing. Carries the startsidan line over to Clew and makes it a numbered decision. The
unverified facts about Eneo's API (tool passthrough, knowledge search as an operation, per-user MCP
credentials) are listed in `docs/vision.md` and do not change the decision, only the size of the module.
