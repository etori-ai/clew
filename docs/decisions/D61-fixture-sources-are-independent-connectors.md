# D61 · Fixture sources are independent connectors in the development stack; Clew bundles only its core

**Status:** accepted, built 2026-11-06 · **Date:** 2026-11-06 · **Area:** integrations, platform

**Decision.** Clew's process bundles only its core connectors: `people`, `calendar` and `search`. Every other system a
developer or a test meets is a connector of its own behind the connector protocol (D21), registered and governed in the
database like a vendor's (D23). That includes the development fixtures: the generic HR, economy, deviation,
communication, time-reporting and payroll systems that used to be TypeScript objects in `packages/connectors/src/mock/`,
registered at boot with Clew's database credentials and their state in Clew's `module_state` table.

1. **Six fixture connectors under `connectors/`**: `hr`, `finance`, `incidents`, `communication`, `timesheet` and
   `payroll`. Each is an independent Node service in the shape the phone book set (`manifest.mjs` for the contract,
   `connector.mjs` for the handlers and the HTTP boundary, its own copy of `verification.mjs`), with its records
   generated relative to the day it was seeded (`fixture.mjs`), its store behind a port (`state.mjs`: `node:sqlite` in
   the service, memory in tests), and the realism a fixture that always answers never shows: every write deduplicated by
   Clew's operation id and read back through the connector's own lookup (D45), `FIXTURE_FAULT` switches for a source
   that is unavailable, slow, unauthorized, in conflict or crashing after its commit, and id maps for a source whose
   person and unit ids are not Clew's. They import nothing from the repository (the cruiser rule
   `connectors-stand-alone`), and nothing in `apps/` or `packages/` imports them (the new rule
   `clew-does-not-import-connectors`, with the served protocol's documentation examples as the one exception, D60).
2. **The systems talk to each other outside Clew.** Payroll imports the HR fixture's sick reports from a feed the HR
   service serves outside the protocol, behind a key, and applies its night rule: a report dated before today has
   arrived, one made today is pending whatever Clew asks (D55 item 8). Nothing of one fixture's state is read through
   Clew or shared in code.
3. **The development stack ships the whole chain.** `.devcontainer/compose.yaml` runs the six as services from the
   workspace on Node's image, each with its SQLite on a volume; the BFF listens on every interface of the app container
   so they can fetch its public keys; `bun run dev:connectors` registers and enables them and binds the followers of
   `hr:absence`, and `postCreateCommand` runs it after the migrations, so Hem has cards after "Reopen in Container".
   `bun run fixtures:reset` seeds them again from today and closes the cards they had pushed, audited as
   `fixtures.reset`; `POST /api/mocks/reset` and `scripts/modules-check.ts` are gone.
4. **The unit suites run the services.** `tests/fixture-connectors.ts` builds the six in-process on their memory
   stores behind an ephemeral signing authority and registers them through `remoteConnector`, the way the BFF reaches the
   containers. The scenario tests for the stream, the conversation, the assistant, the views, the panel labels, connector
   administration and the job across systems use what ships in `connectors/`, not a copy of it. One Node test opens the
   HR fixture on a SQLite file, writes, reopens the file and finds the write, then boots `server.mjs`.
5. **Identifiers are English (D43), area ids included.** `kommunikation` is `communication`, `telefonbok` is
   `phonebook`, the calendar's area `kalender` is `calendar`, and the fixtures' areas are `employees`, `my-shift`,
   `budget`, `work-environment`, `important-now`, `staffing` and `payroll`. What a person reads stays Swedish: the
   sources ("Personalsystemet", "Kommunikation", "Telefonboken") and the area titles. D52's rule that a fixture is a
   kind of system, never a vendor, carries over to the connectors as it was.
6. **Migrations `0030` and `0031`.** `0030` renames the stored ids (connector rows with their manifest and capability
   keys, threads, message meta, executions, refresh requests, work occurrences, the area column's default); a renamed
   remote connector needs its secret set again, because the seal is bound to the id. `0031` drops `module_state` and
   deletes the six bundled rows, which `dev-connectors` recreates as remote rows under the same ids, so cards, executions,
   bindings and audit rows keep their references.

**Why.** D21 says new integrations are never in-process, and D22 and D23 built the whole governance of connectors around
rows, audiences and a protocol; the six mocks were the one exception, kept because they were the only thing that filled
the page. That made the development stack a poorer test of Clew than the product itself: trusted code with database
credentials, absolute dates that went stale within a month, state in Clew's own table, no failure a real source
shows, and an identity model that was Clew's. The product owner asked on 2026-11-06 for a development stack a
developer can run from "Reopen in Container", for a more realistic test than mocks give, and for no dummy connectors or
data in Clew's code; `docs/reviews/2026-11-06-from-mock-connectors-to-real-test-sources.md` weighs the options, among
them a separate repository, which was set aside because the boundary that matters is the process, not the checkout, and
a developer should not need a second one. Real products behind the fixtures (Odoo, Zammad, WireMock on
SupportManagement's own OpenAPI, lldap) are the next step the review names; the fixture connectors' adapter port is where
they plug in.

**Cost.** Six services in the stack instead of none, a `node:26` image pull, and the same boundary code repeated in six
`connector.mjs` files, since a connector carries its own verifier and HTTP boundary by design. The development page is
empty until `dev:connectors` has run, which the devcontainer does on creation. Tests that used a mock's in-code identity
scope now see the connector's declarative roles plus its own narrowing over the transport.

**Replaces.** D52's location of the mocks in `packages/connectors/src/mock/` and its exceptions for the names
`kommunikation` and `telefonbok`; the "mocks until they are lifted" clauses in D22 and D23's administration design; the
open item 12 of the session-1 list in `HANDOVER.md`. D52's naming rule stands.
