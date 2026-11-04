# D2 · No OpenAPI-to-MCP conversion in the running system

**Status:** accepted · **Date:** 2026-11-03 · **Area:** integrations

**Decision.** Clew does not generate tools from external OpenAPI documents (the Open WebUI `mcpo` /
`openapi-servers` pattern) and does not expose a generated MCP surface from a foreign spec. A converter may
scaffold an adapter at dev time. Clew **publishes** OpenAPI for its own BFF, generated from TypeBox.

**Why.** Conversion makes the external system the author of the tool surface, which contradicts D1. Forty
narrow endpoints with generic descriptions also work badly for a model, and there is nowhere in a generated
surface to say "not a tool" or "scope to this unit".

**Replaces.** An option under consideration; nothing built.
