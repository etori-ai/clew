# Sick leave from Qlik: what Qlik offers and how it fits the connector architecture · 2026-11-06

Status: exploration. Its recommendation for aggregates was not taken: [D82](../decisions/D82-sick-leave-statistics-come-through-an-absence-connector-that-reads-only-aggregates.md)
reads one aggregate with a service identity instead of impersonating each person, and `connectors/absence` is built
on it. The Qlik facts come from Qlik's documentation as read on 2026-11-06 (sources at the end) and were not tried
against a real Qlik installation. The Clew facts come from a checkout of `windows-dev-stack` based on `cdc6488`.

Read it beside [manager statistics and reading Qlik directly](2026-11-06-manager-statistics-from-qlik.md), written the
same day from the other end: how big-boss-board gets its sick-leave figures today, and which Qlik the municipality
runs. Corrections made when this file was added to the repository are marked *(corrected)*.

## The question

The organisation needs to fetch sick-leave absence from Qlik and show it in Clew. What does Qlik support, and how
should it follow Clew's connector architecture? The product owner first pictured a separate repository that fetches
from Qlik and pushes the data into a connector or into Clew.

## Short answer

- **The connector is the Qlik integration.** One service, in its own repository if the organisation wants, any
  language, its own container. It speaks Clew's connector protocol on one side and Qlik's Engine API on the other.
  There is no second "integration" that feeds a connector. Clew's code does not change; an administrator registers
  the connector's URL and secret under Administration › Anslutna system (D23).
- **Clew pulls; nothing is pushed into Clew.** When a person opens a view, Clew calls the connector with a signed
  assertion of who is asking (D44); the connector asks Qlik live, as that person; Qlik applies its own row-level
  security; the connector maps the answer to Clew's contract; Clew draws it and stores no rows. Scans are also
  Clew-initiated (Clew calls `/clew/scan` on a schedule). D19 (payload-free change notifications) is proposed, not
  built, and even it carries no data. This follows `docs/overview.md` (sources keep their records, avoid copying
  them into Clew) and `docs/vision.md` ("not a data warehouse").
- **Read Qlik through the Engine API as the named person**, so section access decides what each person sees.
  Qlik Cloud: OAuth M2M impersonation. Qlik Sense Enterprise on Windows: client certificate with `X-Qlik-User`,
  the ticket API, or a JWT virtual proxy.
- **Sick leave is health data** (GDPR art. 9, and secrecy under OSL for personnel matters): individual rows only for
  the person's own manager and only with a legal basis agreed with HR and the data protection officer; aggregates
  with a minimum group size; nothing copied into Clew; card text without names; the model gets a summary only.

## Where the product owner's picture still fits

The fetching from Qlik can be scheduled *inside* the connector: it extracts from Qlik at night into its own store and
answers Clew from that snapshot. That makes it a `derived` connector ("a computed result or snapshot with a defined
purpose", `docs/overview.md`). Clew still pulls from the connector. The price: the extraction runs as a service
account, so Qlik's section access no longer applies and the connector must decide who sees what; and the connector's
repository then holds health data at rest, which needs its own data protection impact assessment. Recommended only
for aggregates with a minimum group size, and only if live reads prove too slow for Clew's ten-second call timeout.

## What Qlik offers

### Reading data (both platforms)

- **Engine API (QIX)**, JSON-RPC over WebSocket, is the only general way to read an app's calculated data. Open the
  app, create a session object with a hypercube (dimensions such as unit and month, measures such as the sick-leave
  rate), apply selections, page with `GetHyperCubeData`: at most **10,000 cells per call** across the requested pages
  (error 7009 above that); straight tables only, pivots use `GetHyperCubePivotData`.
- Data is only as fresh as the app's last reload (often nightly). The app's last reload time can be read and should
  be shown with the figures.

### Qlik Cloud (SaaS)

- Engine: `wss://<tenant>/app/<appId>` with `Authorization: Bearer <token>` in the handshake.
- **Reports API** (`POST /api/v1/reports`): XLSX/PDF/PPTX, asynchronous, 10 requests/min, no JSON. Not a data feed.
- **Data products over OData**: Premium/Enterprise tiers, API key, serves data-integration datasets rather than an
  analytics app's model; row-level security not documented. Not the right source here.
- **Qlik MCP server**, generally available since February 2026 (`https://<tenant>/api/ai/mcp`, OAuth scopes
  `user_default`, `mcp:execute`, about 94 tools such as `qlik_get_chart_data`). Built for AI assistants, metered
  (every five billable calls use one "question" of a monthly quota shared with Qlik Answers), 300 calls per user per
  minute. Not recommended as Clew's data feed; Clew's own model can use the connector's capabilities instead.
- REST rate limits: 1,000/min (tier 1) and 100/min (tier 2), per user per tenant over five minutes, 429 with
  `Retry-After`. Reloads up to three hours, up to ten scheduled reload tasks per app.

### Qlik Sense Enterprise on Windows (client-managed)

- Current release May 2026, supported until 2028-05-19.
- Engine directly at `wss://host:4747/app/` with client certificates and `X-Qlik-User: UserDirectory=…; UserId=…`, or
  through a virtual proxy `wss://host/<virtual-proxy>/app/`.
- Since November 2024 CSRF protection also covers WebSockets: a client through a virtual proxy needs a
  `qlik-csrf-token`, the session cookie and an allowed `Origin` (the non-browser steps are only documented in a
  community thread).
- **Five parallel sessions per user**, not configurable; the sixth gets "no access pass". No documented rate limits.
- The Repository Service (QRS) API is metadata and administration only. No official MCP server.

### QlikView

Still supported (12.110, until 2028-09-30) but has no server-side data API comparable to QIX; the usual way out is a
script `STORE` to CSV that the connector then reads (community source only).

### Authentication

| Method | Platform | Acts as a named person? | Notes |
|---|---|---|---|
| OAuth M2M (client credentials) | Cloud | No, a bot `qlikbot\<clientId>` | The bot has tenant-admin-equivalent rights |
| OAuth M2M impersonation | Cloud | **Yes** (`userId` or `subject`) | Grant `urn:qlik:oauth:user-impersonation`; token valid 6 h; the user must already exist in the tenant; groups are not refreshed |
| JWT IdP (`/login/jwt-session`) | Cloud | Yes | Cookie-based; Qlik calls it a fallback |
| API key | Cloud | Only its creator | Needs "Manage API Keys" since February 2026 |
| Certificates + `X-Qlik-User` | Windows | **Yes** (any user) | Server to server on port 4747; highly privileged |
| Ticket API | Windows | Yes | `POST /qps/<vp>/ticket` on port 4243 with a client certificate; ticket valid one minute |
| JWT virtual proxy | Windows | Yes | Subject to the WebSocket CSRF rule |
| Header authentication | Windows | Yes | Qlik: only behind a firewall or proxy, or in development |

### Section access (row-level security)

- Enforced by the engine for the identity that opened the session. Cloud matches `USERID` (the IdP subject),
  `USER.EMAIL` or `GROUP`; a user without a valid access level cannot open the app; `ADMIN` sees everything.
- A bot or service account must itself be listed in section access (community report); on Windows, scheduled reloads
  of an app with section access need `INTERNAL\SA_SCHEDULER`.
- A service account sees what its row grants, and the connector then owns authorization.

### Node libraries (npm metadata)

| Package | Version | Licence | Use |
|---|---|---|---|
| `enigma.js` | 2.15.0 | MIT | QIX (Engine) client, qlik-oss |
| `@qlik/api` | 2.22.0 | ISC | REST and QIX for Cloud and Windows (JWT, certificate/PFX); Node 20+; deps `ws`, `extend`, `lodash-es` (MIT) |
| `@qlik/embed-web-components` | 1.7.5 | ISC | UI embedding; not needed |
| `@qlik/sdk` | 0.28.0 | MIT | Deprecated |

All are OSI-licensed, so a connector built in this repository could use them (`CLAUDE.md`, "Open source, always");
check with `npm view <package>@<version> license` and record it in `HANDOVER.md` section 3 when pinning. Qlik itself
is proprietary; it is the source being integrated, like Microsoft 365, not a dependency Clew needs to run.

### Licensing to check with Qlik

Every person the connector impersonates is a Qlik user. On capacity-based Qlik Cloud tenants anyone who
authenticates counts as a Full User since February 2026. Whether one account may fetch data for people without a
Qlik licence ("multiplexing") is a question for Qlik.

## How it fits Clew

### Shape of the connector

Follow `connectors/phonebook` (no imports from the rest of the repository): `manifest.mjs` (the contract),
`connector.mjs` (reads, assertion check, HTTP errors), `qlik.mjs` (Qlik behind a port, one mapping function like
`toPerson`, plus a fixture adapter with made-up data for tests and demos), `server.mjs`. Check it with
`bun scripts/connector-check.ts <url> --secret …`; register it with an audience such as managers and HR (D23).

**Clew owns the contract (D1).** Capabilities describe sick leave, not Qlik, so the HR system or another BI tool can
fulfil the same contract later. The synthetic HR connector, `packages/connectors/src/mock/hr.ts`, already models the
patterns wanted: `hr.absenceOverview` (a table view with `modelReads: 'summary'`), `hr.absencePattern`, a scan for
the rehab rule whose card text names nobody, and an area figure. Suggested id `absence`, source label Qlik, kind
`passthrough` (Qlik computes; the connector maps), or `derived` if it keeps its own snapshot.

| Capability (suggested) | Shown as | State in Clew today |
|---|---|---|
| `absence.unitRates`: rate per unit, short and long, against the same period last year | Table view (D38) with a unit control | Available; can also be a menu tool (D40) |
| `absence.trend`: rate per month | Table view and a link to the Qlik sheet for the chart | Tables available; the `series` view kind is not built (D38) |
| Area figure, e.g. "Sjukfrånvaro 5,2 % · förra året 6,1 %" | Tile on Läget | Built: Läget draws connector figures (D54) |
| `absence.employees`: per employee, own manager only | Table with `modelReads: 'summary'` | Only with a legal basis |
| Scan: a card when a unit passes a threshold | Card in the stream | Available; individual patterns (rehab rule) are more sensitive |

### Authorization (D44, `docs/guides/authorization.md`)

Trust only the verified Clew assertion (`actor.id`, `unitId`, `role`); resolve the person's Qlik identity through a
verified mapping (e-mail, AD account or IdP subject), never from a display name; open the Qlik session as that person.
Clew's delegated user token (D26, RFC 8693) is not given to scans, figures or callbacks, so impersonation (Cloud) or
certificate/ticket (Windows) fits better than delegation. A service account with the connector filtering on
`actor.unitId` works technically but puts the protection of health data entirely on the connector's code.

### Practical limits

- Clew's remote transport times out a POST after ten seconds; opening a large Qlik app can take seconds. Keep
  sessions warm and cache aggregates briefly in memory (no personal data at rest).
- 10,000 cells per `GetHyperCubeData` call; five parallel sessions per user on Windows.
- Show the app's last reload time; for "who is away today" the HR or scheduling system is fresher than Qlik.
- The connector logs no request or response bodies.

## Open questions for the municipality

1. ~~Which platform~~ *(corrected)*: Qlik Sense Enterprise on Windows, on the municipality's own servers, per the
   companion review.
2. Which app holds sick leave, which fields and master measures exist, and is section access already in place?
3. How are people identified in Qlik, and how does that map to the Clew person (Keycloak subject, e-mail, AD)?
4. Who may see what, and the minimum group size for aggregates (HR and the data protection officer decide).
5. The Qlik licence model for the people the connector acts as.

## Next steps

1. Answer the open questions.
2. Write a decision for the absence contract and the authentication choice. *(corrected)* Done as D82 (first written as
   D63, renumbered because `main` had taken D63 meanwhile).
3. Build the connector with the fixture adapter first, run `connector-check.ts`, then add the Qlik adapter.
4. If Läget should show the figure, settle D54. *(corrected)* D54 is accepted and built.

## Could not verify

Limits on concurrent Engine WebSocket sessions in Qlik Cloud; whether direct certificate connections on port 4747
consume an access pass on Windows; whether multiplexing is allowed; that section access applies to the MCP and
Reports APIs (inferred because both run through the engine); licence use by impersonation tokens; the minimum reload
interval in Qlik Cloud; official documentation of a QlikView data API.

## Sources

- enigma.js and connecting from Node: https://qlik.dev/toolkits/enigma-js/
- GetHyperCubeData (May 2026): https://help.qlik.com/en-US/sense-developer/May2026/Subsystems/NetSDKAPIref/Content/Qlik.Engine.GenericObject.GetHyperCubeData.md
- Reports API: https://qlik.dev/apis/rest/reports/
- Data products over APIs: https://help.qlik.com/en-US/cloud-services/Subsystems/Hub/Content/Sense_Hub/DataIntegration/DataProducts/Consuming-data-products-through-apis.htm
- Qlik MCP server, general availability: https://www.qlik.com/us/news/company/press-room/press-releases/qlik-brings-agentic-analytics-to-general-availability-and-launches-mcp-server-for-third-party-assistants
- Connecting to the MCP server: https://help.qlik.com/en-US/cloud-services/Subsystems/Hub/Content/Sense_Hub/QlikMCP/Connecting-Qlik-MCP-server.htm
- MCP tools: https://help.qlik.com/en-US/cloud-services/Subsystems/Hub/Content/Sense_Hub/QlikMCP/Qlik-MCP-server-tools.htm
- Administering the MCP server: https://help.qlik.com/en-US/cloud-services/Subsystems/Hub/Content/Sense_Hub/QlikMCP/Administering-Qlik-MCP.htm
- REST rate limiting: https://qlik.dev/apis/rest/rate-limiting/
- Qlik Cloud specs and capacity: https://help.qlik.com/en-US/cloud-services/Subsystems/Hub/Content/Sense_Hub/Introduction/qcs-specs-capacity.htm
- OAuth and bot users: https://qlik.dev/authenticate/oauth/
- OAuth impersonation: https://qlik.dev/authenticate/oauth/implement-oauth-impersonation/ and https://qlik.dev/changelog/84-oauth-m2m-impersonation/
- JWT authorization (Cloud): https://qlik.dev/authenticate/jwt/implement-jwt-authorization/
- Authentication overview: https://qlik.dev/authenticate/
- Capacity-based user types (2026-01-15): https://community.qlik.com/t5/Support-Updates/Streamlining-user-types-in-Qlik-Cloud-capacity-based/ba-p/2540871
- Qlik Sense May 2026 client-managed: https://community.qlik.com/t5/Product-Innovation/Qlik-Sense-May-2026-Client-Managed-now-available/ba-p/2548365
- Connecting to the Engine API (May 2026): https://help.qlik.com/en-US/sense-developer/May2026/Subsystems/EngineAPI/Content/Sense_EngineAPI/GettingStarted/connecting-to-engine-api.htm
- WebSocket CSRF: https://community.qlik.com/t5/Official-Support-Articles/Qlik-Sense-Enterprise-on-Windows-Extended-WebSocket-CSRF/ta-p/2509211 and https://community.qlik.com/t5/Integration-Extension-APIs/Qlik-Sense-Nov-2025-WebSocket-connections-via-JWT-fail-with-403/m-p/2540147
- Sessions and access passes: https://help.qlik.com/de-DE/sense/April2018/Subsystems/PlanningQlikSenseDeployments/Content/Sense_Deployment/Qlik-license-usage.htm and https://community.qlik.com/t5/Official-Support-Articles/Troubleshoot-no-access-pass-or-too-many-sessions-active-in/ta-p/1712051
- Analyzer capacity: https://help.qlik.com/en-US/cloud-services/Subsystems/Hub/Content/Sense_Hub/Introduction/analyzer-capacity-consumption.htm
- QlikView lifecycle: https://community.qlik.com/t5/Product-Lifecycle/QlikView-Product-Lifecycle/ta-p/1826339
- QlikView data extraction (community): https://community.qlik.com/t5/QlikView-Integrations/How-to-extract-data-from-a-QV-app-deployed-on-QV-Server/td-p/1360359
- Ticket API: https://help.qlik.com/en-US/sense-developer/May2025/Subsystems/ProxyServiceAPI/Content/Sense_ProxyServiceAPI/ProxyServiceAPI-ProxyServiceAPI-Authentication-Ticket-Add.md
- Header authentication: https://help.qlik.com/en-US/sense-developer/May2025/Subsystems/Platform/Content/Sense_PlatformOverview/Examples/config-header-authentication.htm
- Section access (Cloud): https://help.qlik.com/en-US/cloud-services/Subsystems/Hub/Content/Sense_Hub/Scripting/Security/manage-security-with-section-access.htm
- Bot users and section access (community): https://community.qlik.com/t5/Qlik-Automate/Failed-to-reload-the-app-with-section-access-using-Platform/m-p/2487384
- `INTERNAL\SA_SCHEDULER`: https://community.qlik.com/t5/Official-Support-Articles/Internal-sa-scheduler-mandatory-to-reload-apps-with-section/ta-p/1715641
- `@qlik/api` with Qlik Sense Enterprise: https://cdn.jsdelivr.net/npm/@qlik/api@2.7.0/docs/examples/qlik-sense-enterprise.md
