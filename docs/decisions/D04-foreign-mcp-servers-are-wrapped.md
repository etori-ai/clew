# D4 · Foreign MCP servers are wrapped, not passed through

**Status:** accepted · **Date:** 2026-11-03 · **Area:** integrations

**Decision.** A vendor's MCP tools are their contract. Default is a Clew adapter implementing the Clew
capability by calling them. Passing a foreign tool straight to the model is a per-tool allowlist entry with
a `scope` rule, never automatic.

**Why.** Same reasoning as D1 and D2, applied to MCP instead of OpenAPI.
