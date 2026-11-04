# D16 · Node is the server runtime; Bun stays the toolchain

**Status:** accepted · **Date:** 2026-11-04 · **Area:** platform

**Decision.** `apps/server` runs on Node (the devcontainer's Node 26, `tsx watch` in dev, `tsx` in the
container) through `@hono/node-server`. Bun remains the package manager, the script runner and the unit
test runner (`bun install`, `bun run`, `bun test`), with exact versions and a frozen lockfile as before.
The switch to Bun as server runtime decided in D7 is not made.

**Why.** Temporal's TypeScript worker runs on Node only: it depends on Node-API native modules and
`worker_threads`, and other runtimes are untested by its maintainers. With Temporal adopted for the
durable timers (D17) and the worker running inside the BFF process, the server runtime has to be Node.
The server already ran on Node via `tsx` (the D7 switch was pending), so nothing changes in the code;
the decision records that it stays so. Hono and the AI SDK are web-standard and would run on either.

**Replaces.** D7 (Bun is the server runtime), which is marked superseded. Bun's other roles from D7 and
the session-1 decisions are unchanged.
