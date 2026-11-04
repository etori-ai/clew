# Clew · project instructions

Read `HANDOVER.md` first. It is the only context carried between sessions; update it at the end of every session. `docs/vision.md` says what Clew is and is not, and where the line to Eneo runs; check a new feature against it. Every settled decision gets a numbered file in `docs/decisions/` (follow `docs/decisions/README.md`); every review or comparison goes in `docs/reviews/`.

## Open source, always

Clew is an open source system that will be shared with other municipalities and governments to use as they will.

- Never add a closed-source dependency: no proprietary npm packages, SDKs, fonts, icon sets, container images or hosted services that the code cannot run without. Every dependency must carry an OSI-approved licence (MIT, Apache-2.0, BSD, ISC, MPL-2.0, AGPL/GPL for infrastructure components that stay separate processes).
- Check the licence before pinning anything: `npm view <package>@<version> license`, and the image or project licence for Docker services. Record the result in `HANDOVER.md` section 3.
- The AI model behind the question box must be reachable through an open protocol (the OpenAI-compatible provider is fine) and the system must work with an open-weight, self-hostable model. A closed model may be configured by an operator, but nothing in the repository may depend on one.
- No telemetry, licence keys, phone-home calls or vendor accounts required to build, run or test.
- Prefer standards over vendor APIs: OIDC, CalDAV, iCalendar, MCP, Web `Request`/`Response`.

## Working rules carried over from startsidan

- Swedish only where a person reads it in the product: UI text and API error messages shown in the UI. Everything else is English: identifiers, contracts, comments, console output, script and CLI output, infrastructure messages, thrown configuration errors, documentation. Swedish commit subjects.
- Bun with exact versions and a frozen lockfile as package manager, script runner and test runner. The server runtime is Node via `tsx` (D16, 2026-11-04; the Temporal worker needs Node). Temporal runs the durable timers (D17).
- Commands run inside the devcontainer: `docker exec -w /workspace clew-app-1 …` (see `README.md`).
- Server-side enforcement of identity and scope. No credentials, tokens or trusted identity context in the browser bundle.
- Every mutation writes its audit row in the same transaction. Assistant proposals are executed only through the human decision endpoint, which is not a tool.
- Astryx components and documented composition patterns only, strictly. No custom components, no custom CSS (styles.css holds the Astryx imports and body basics, nothing else), no second component system (no ai-elements, shadcn or Tailwind). Astryx's Chat family covers AI surfaces. Read `bunx astryx component <Name>` before using a component and `bunx astryx docs layout` before laying out a page. The week view is an Astryx Grid agenda, not a time grid.
- The design canvas (link in HANDOVER.md) is the reference for every screen. Compare against it before calling a screen done.
- WCAG 2.2 AA is a hard requirement, not a goal: Clew is built for the public sector. A UI change is not done until keyboard use, focus handling, status announcements and reflow at 320 px hold and `sh scripts/a11y.sh` passes. A new route, view or state gets a test in `tests/a11y`. CI runs the suite on code pushes and pull requests, but the current GitHub plan cannot block a merge on a red run. Passing the suite does not prove conformance; new flows also need a manual pass with a screen reader.
- Never add Claude as a co-author on commits.

## Backend structure (D20) and connectors (D21, D22)

Long form: `docs/architecture/backend-structure.md` and `docs/architecture/connector-protocol.md`. "Module" is D20's code word for a bounded context in the server; an integration that a person, an operator or a vendor meets is a **connector** (Swedish "anslutning"), never a module (D22). `bun run deps` (part of `bun run check`) fails the build on a violation; change `.dependency-cruiser.cjs` only together with the decision that changes a rule.

- One folder per module: core modules under `apps/server/src/modules/<name>/`, a domain with a port and adapters as `packages/<name>/`, a connector built here under `connectors/<name>/`. Nothing module-specific at the server root.
- Four kinds of file inside a module, imports flowing one way: `contracts` (schemas, types, errors; imports nothing of ours), `domain.ts` (pure functions: no I/O, no runtime library, no Node built-in), `usecases.ts` (one exported function per user action; the actor first, never a request; owns the scope check, the transaction and the audit row in it), `adapters/` (one system's protocol behind a port, chosen by a factory from configuration). Routes sit outside: parse, validate, call one use case, map errors to Swedish JSON; never `@clew/db`, never an adapter, never logic.
- A module never imports another module. In process it uses the `clew.call` handle that `run`, `scan` and `figure` receive; a connector posts to `/api/connectors/call`. Both re-check the other module's scope for the same actor and refuse `execute`. The registry (`apps/server/src/connectors/registry.ts`) is the only file that names connectors.
- Every new integration, the Clew team's or a third party's, is a connector: its own container behind the connector protocol (`packages/connectors/src/protocol.ts`, published as `docs/protocol/connector-protocol.schema.json`), loaded from `CLEW_CONNECTORS` and `CLEW_CONNECTOR_SECRET_<ID>` until D23 moves registration into the database, and passed through `bun scripts/connector-check.ts <url> --secret …` before it is wired in. `connectors/hello` is the reference and depends on nothing else in the repository. In-process `Connector` objects are for Clew's core only. Guide: `docs/guides/creating-an-external-connector.md`.
- Not tactical DDD: no aggregates, entities with behaviour, repositories or domain events. Functional TypeScript, TypeBox schemas, plain exported functions.
