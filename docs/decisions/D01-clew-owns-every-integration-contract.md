# D1 · Clew owns every integration contract

**Status:** accepted · **Date:** 2026-11-03 · **Area:** integrations

**Decision.** The model's tool surface and the UI's view shapes are defined by Clew-owned capability
descriptors in `packages/contracts`. Adapters translate to the external protocol. External systems never
define the contract. Design: `docs/architecture/integrations.md`.

**Why.** The guardrails (human decision endpoint is not a tool, every source scoped before joining, no raw
access for the model) need a place to live. A Clew-owned descriptor with `kind`, `scope` and `model`
fields gives them one. It also keeps the model's tools at domain granularity instead of REST granularity.

**Replaces.** Nothing; generalises the `CalendarProvider` interface decision from session 1.
