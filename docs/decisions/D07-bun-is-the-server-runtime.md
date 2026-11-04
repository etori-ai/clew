# D7 · Bun is the server runtime

**Status:** superseded by D16 (2026-11-04) · **Date:** 2026-11-03 · **Area:** platform

**Decision.** `apps/server` runs on Bun (`bun --watch` in dev, `bun run` in the container), not on Node with
`tsx`. Hono serves through Bun's native server instead of `@hono/node-server`. Bun stays the package manager
and script runner as before. Node 24 remains in the image only as a toolchain dependency for tools that need
it (Vite, drizzle-kit, the Astryx CLI) until each is verified under Bun.

**Why.** One runtime for scripts, tests and the server. Bun runs TypeScript directly, which removes the
reason `tsx` was chosen (Node's type stripping needed `.ts` import extensions and no parameter properties).
Hono was picked in part because the same code runs on Bun without adapters.

**Replaces.** The session-1 decision "Node 24 LTS, run with tsx". Switching is a next step in HANDOVER:
change the dev and start scripts, replace `@hono/node-server` in `apps/server/src/main.ts`, and verify
`postgres`, `openid-client` and the scheduler under Bun.
