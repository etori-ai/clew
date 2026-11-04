# D21 · Every integration is a module service behind the Clew module protocol

**Status:** accepted · **Date:** 2026-11-04 · **Area:** integrations

**Decision.** An integration, whether the Clew team or a third party writes it, is its own HTTP service that
implements the Clew module protocol (`packages/modules/src/protocol.ts`, published as
`docs/protocol/module-protocol.schema.json`, described in `docs/architecture/module-protocol.md`): a
manifest, a call route per capability, a scan route and a figure route. A running Clew learns about it from
two environment variables (`CLEW_MODULES=<id>=<url>` and `CLEW_MODULE_SECRET_<ID>`), fetches the manifest at
start-up and registers it next to the bundled modules; nothing in Clew's code or image changes. Clew signs a
short-lived assertion per call that names the acting person; the module verifies it and may send it back to
`POST /api/module/call` to use other modules' reads and proposals as that person. The module services the
Clew team writes live under `modules/<name>/` in this repository with their own Dockerfile and depend on
nothing else in the repository (enforced by `dependency-cruiser`); `modules/hello` is the reference and is
the first one. In-process `Module` objects remain for Clew's own core (people, threads) and for the calendar
until it is lifted; new integrations are not written in-process. A module written in any language passes
`bun scripts/module-check.ts <url> --secret <secret>` before it is wired in.

**Why.** Clew is shipped as container images to other municipalities and governments, and most integrations
will not pass through this repository: a municipality with its own case system, a vendor, another team.
"Sideloading" code into Clew's process was already rejected (`integration-paths.md`: no connector host that
loads plugins at start-up) because it couples every integration to Clew's release and runs foreign code with
Clew's database credentials. A separate service with a JSON protocol needs no SDK, no shared language and no
rebuild of Clew, and the same path for Clew's own integrations means the path is exercised on every one of
them instead of once, late, by an outsider. The protocol carries the same descriptors the registry already
used (D1, D3, D8), so REST, model tools and cards derive from a remote module exactly as from a bundled one,
and the audit, scope and validation path is unchanged. Using MCP as the transport was considered and kept
for what it is good at (surface 3a, Clew as an MCP server for agents; foreign MCP servers wrapped, D4): it has
no notion of scope rules, areas, scans or receipts, and its tool list is flat, so it would have needed a Clew
dialect on top.

**Replaces.** The "Clew-owned MCP server, `apps/mcp-<name>`" hosting shape in D3 and in
`capability-surfaces.md` (3b) and `integration-paths.md`: an adapter that must run out of process is a
module service, not an MCP server. The generic HTTP adapter that `creating-a-connector.md` section 2
promised for "native fulfilment" is this transport. D3's three module kinds, D10's order (the system fulfils
Clew's contract first) and D11's calendar contract are unchanged.
