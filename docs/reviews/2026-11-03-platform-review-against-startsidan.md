# Platform review against startsidan

**Date:** 2026-11-03 · **Kind:** platform review · **Led to:** [D10](../decisions/D10-integrations-fulfil-clews-api-first.md), [D11](../decisions/D11-one-calendar-contract-two-adapters.md), `HANDOVER.md` next step 10

**Question asked.** "Review the project and its direction now compared to the initial startsidan project.
Will the technical platform we have decided on be a long-term good solution? Consider third-party
integrations; are there any hard blockers that we will not be able to solve?"

**Basis.** The Clew repository as of session 3 (commit `aba4d15` plus uncommitted session-2 work), the
startsidan repository at `~/code/startsidan` (docs 02, 04, 09, 43 and the ADRs), and the public sources
listed at the end. Written by the assistant in the session, kept as delivered apart from this header and
the outcome section.

## Outcome

- D10 and D11 were decided the same afternoon: integrations fulfil Clew's API first with adapters as the
  fallback, and the calendar is one contract with `caldav` and `microsoft365` adapters selected per account.
  `packages/calendar/src/adapters.ts` was added.
- Next step 10 in `HANDOVER.md` covers the Graph adapter and the Entra token path.
- Still open from "What I would do next": rewording D5 so the municipality's IdP is the production
  authorization server, the dept44 and WSO2 section in `docs/architecture/integrations.md` (partly covered
  by the "Who meets the contract" paragraph), and the SCIM question for IT.

## The review as delivered

**Verdict:** the platform itself is a sound long-term choice and I found no hard blocker in the stack. The real risks sit in three integration assumptions that the code and docs currently gloss over. None of them is unsolvable, but two of them change where effort goes next.

## How Clew compares with startsidan

Clew kept the parts of startsidan that had proven themselves and dropped the parts that were carrying weight for a product shape you no longer want. Kept: Postgres with Drizzle, Keycloak OIDC with an opaque session, TypeBox contracts, the Vercel AI SDK against an OpenAI-compatible endpoint, Astryx, and the calendar provider interface. Dropped: Next.js, Puck and Studio, NATS, the event fan-out, the query DSL, DuckDB and the Java connector host. That is the right cut. A chat-first page with pushed threads needs a scheduler and adapters, not a page builder and a federated query engine.

The new choices hold up:

- **Hono on Bun** uses only web-standard Request and Response, so the AI SDK, a future MCP SDK and a later move to another runtime need no adapters. Both are MIT.
- **Capability descriptors** with `kind`, `scope` and `model` are the right place to make the guardrails structural. They also fit Sundsvall's existing API landscape better than startsidan's connector SDK did, see below.
- **Model optional** is the correct posture for an open-source product that any municipality will point at their own model.

Two platform risks to keep an eye on, neither a blocker:

- **Astryx is still beta.** Public sources through September 2026 still call it beta, and the repo pins a 0.7.x release. "Strictly Astryx, no custom components" is a bet on a pre-1.0 library from Meta. Keep every Astryx import behind `packages/ui` so a breaking release is a one-package fix.
- **Bun as server runtime** is fine, but verify `openid-client` and the row-locked scheduler under Bun before item 6 in the handover is marked done, as D7 already says.

## The three integration assumptions that need attention

**1. Production calendars are Microsoft 365, which has no CalDAV.** The dev stack uses Nextcloud over CalDAV, and the startsidan docs name M365 and Entra ID as the customer's systems. Exchange Online exposes no supported CalDAV endpoint, and Exchange Web Services is being disabled from October 2026 with final removal in April 2027, so the only durable path is Microsoft Graph. The provider interface in `packages/calendar/src/model.ts` maps onto Graph cleanly, including free/busy through getSchedule. The hard part is identity: a Graph call for Hillevi needs an Entra-issued token for Hillevi, not a Keycloak token. That means either Keycloak as a broker in front of Entra with stored external tokens and external-to-internal exchange, or Clew running OIDC directly against Entra in production. Decision D5 currently says Keycloak is the only authorization server. That wording should become "the municipality's IdP, with Keycloak for dev and as broker", or the first real deployment will contradict the decision log. Using Graph is allowed under the open-source rule: it is a customer system reached through OAuth and REST, and startsidan's licence audit already made that call.

**2. Heroma has no usable API, and Raindance is reached through Sundsvall's own services.** Sundsvall's public GitHub organisation shows how the municipality integrates these systems today: a repository of RPA activities for Heroma, and Java services on the dept44 framework that preprocess, cache and send invoices against Raindance, plus a data warehouse reader for aggregate domains. All of it is MIT and sits behind a WSO2 API gateway with API keys. The consequences for Clew:

- The `service` auth mode with the `scope` rule will be the normal case, not the exception. User delegation will be rare outside M365. The integrations doc should say so.
- Heroma write-backs, such as leave approvals and attest, are either RPA or link-out in version 1. The architecture already allows a pass-through module that stores refs and audit only and sends the person into the source system. Decide now that the first Heroma module is read plus link-out, so the thread action contract is designed around it.
- The "Läget" figures for absence and budget most likely come from the data warehouse reader, not from Heroma or Raindance directly. That is a derived module in D3 terms and fits well.
- D2 is validated by this landscape: the dept44 services publish OpenAPI, so an adapter can be scaffolded from it at dev time while Clew keeps the contract.

**3. The cross-domain identity design is not buildable yet, and may never be needed.** ID-JAG and the MCP enterprise-managed authorization extension are well documented in D5, with the honest note that Keycloak only accepts them experimentally and does not issue them. Everything Clew needs in the next year is token exchange inside one trust domain plus the three adapter auth modes. Keep the extension as a documented target and build nothing on it.

## What I would do next

1. Spike a Graph calendar adapter as the second `CalendarProvider` and settle how a user's Entra token reaches the BFF. This is the largest unknown and it gates the first real deployment.
2. Reword D5 to name the municipality's IdP as the production authorization server.
3. Add a short section to `docs/architecture/integrations.md` on Sundsvall's dept44 and WSO2 landscape, naming `service` mode as the default and Heroma as read plus link-out.
4. Check with IT whether the Entra tenant allows outbound SCIM to a self-hosted endpoint. If not, group membership comes through OIDC claims or the data warehouse, which Clew's role derivation already allows.

The only thing I would call a potential hard stop is a use case that requires writing into Heroma from Clew. That is a product-scope limit set by the vendor, not a platform limit, and the link-out design absorbs it.

Sources: [Microsoft Graph calendar APIs](https://learn.microsoft.com/hr-hr/exchange/client-developer/exchange-web-services/office-365-rest-apis-for-mail-calendars-and-contacts), [Nylas calendar API comparison](https://cli.nylas.com/guides/calendar-api-comparison), [EWS retirement notice](https://uwaterloo.ca/science-computing/news/retirement-exchange-web-services-ews-october-1-2026), [Petri on EWS shutdown](https://petri.com/microsoft-exchange-web-services-2026/), [Sundsvalls kommun on GitHub](https://github.com/Sundsvallskommun), [api-service-activity-feed](https://github.com/Sundsvallskommun/api-service-activity-feed), [web-app-draken-admin and WSO2](https://github.com/Sundsvallskommun/web-app-draken-admin), [Keycloak ExchangeExternalToken](https://www.keycloak.org/docs-api/26.4.7/javadocs/org/keycloak/broker/provider/ExchangeExternalToken.html), [InfoQ on Astryx](https://infoq.com/news/2026/09/meta-astryx-design-system), [OpenReplay first look at Astryx](https://blog.openreplay.com/first-look-astryx-meta-design-system/).
