# D4 · Foreign MCP servers are wrapped, not passed through

**Status:** accepted · **Date:** 2026-11-03 · **Area:** integrations

**Scope update, 2026-11-08.** This remains the native connector rule. [D81](D81-mcp-apps-extend-ai-chat-with-provider-owned-interactions.md) adds a separate standard MCP service path for AI-enabled chat, without a Clew manifest; currently a prototype, not a production host.

**Decision.** A vendor's MCP tools are their contract. Default is a Clew adapter implementing the Clew
capability by calling them. Passing a foreign tool straight to the model is a per-tool allowlist entry with
a `scope` rule, never automatic.

**Why.** Same reasoning as D1 and D2, applied to MCP instead of OpenAPI.
