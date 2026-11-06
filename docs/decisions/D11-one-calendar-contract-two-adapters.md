# D11 · One calendar contract, CalDAV and Microsoft 365 as adapters

**Status:** accepted, `microsoft365` adapter built against a local fake (D69) and bound to one development persona beside CalDAV (D69, amended), not yet run against a tenant · **Date:** 2026-11-03 · **Area:** integrations

**Decision.** `CalendarProvider` in `packages/calendar/src/model.ts` is Clew's calendar contract. Every
calendar system is an adapter behind it, selected per account by `CalendarCredential.kind` in
`packages/calendar/src/adapters.ts`. Two kinds are decided: `caldav` (the existing Nextcloud provider;
any CalDAV server with iCalendar scheduling) and `microsoft365` (Microsoft Graph, since Exchange Online
has no CalDAV endpoint and Exchange Web Services is disabled from October 2026 and removed April 2027).
Nothing above the factory knows which protocol a person's calendar speaks, so a mixed estate is supported.

**Why.** The dev stack runs Nextcloud; the municipality runs Microsoft 365. A single contract with two
adapters keeps the planner, the decision endpoint, the audit rows and the UI identical across both, and
makes the Graph adapter a package-local piece of work. Per-account selection rather than a global flag
because other municipalities and non-municipal users (persona Petra) may run either.

**Status.** The `caldav` adapter is the ported provider and is verified end to end. The `microsoft365`
adapter was a typed, unimplemented branch until [D69](D69-a-local-fake-of-microsoft-graph-tests-the-microsoft-365-adapter.md)
built it against a local fake. Running it for real needs an Entra tenant and settles how a delegated Graph
token reaches the BFF (Keycloak as broker with stored external tokens, or OIDC directly against Entra in
production); that question is item 10 in HANDOVER.

**Replaces.** The session-1 note "calendar as MCP, in-process first" is unchanged; D11 adds the adapter
axis under the same interface.
