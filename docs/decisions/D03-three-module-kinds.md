# D3 · Three module kinds: core, pass-through, derived

**Status:** accepted · **Date:** 2026-11-03 · **Area:** integrations

**Decision.** Modules are sorted by who owns the data. Core (users, permissions, threads, audit, jobs) lives
in Clew's Postgres and has no provider interface. Pass-through (calendar, Heroma, Raindance) lives in the
external system; Clew stores refs, revisions and audit rows only, behind a provider interface, in-process
first and lifted to an MCP server when release cadence, network zone or ownership demands it. Derived
(figures, attention counter) is a snapshot computed from pass-through modules.

**Why.** The question "MCP or REST?" has different answers per kind. Naming the kinds settles it per module
instead of per conversation.
