# A Sitevision connector: the header, search and pages from the intranet's CMS · 2026-11-09

**Date:** 2026-11-09 · **Asked by:** the product owner ("the header links should come from an external system like
SharePoint. This will probably be part of a Sitevision connector") · **Outcome:** exploration, input to a later
decision; nothing built. Written against the tree where an administrator explicitly chooses which connector holds the
header (the switch "Ger sidhuvudet" on the connector's page, `Governance.header`), not D88's "first registered".

Two kinds of evidence are kept apart below. **Verified** means tried on 2026-11-09 against the test site
`https://dse-sundsvall.sitevision-cloud.se/` from the built-in browser pane, **anonymously**: the pane was not signed
in there (the start page redirects to `/system/login`, a local username/password form), and no sign-in was attempted,
so everything a signed-in user would see (the REST console, the start page's children, group-restricted sections) is
unverified. **Documentation** means developer.sitevision.se or help.sitevision.se as read the same day (sources at the
end). Both can differ from the municipality's installation and version.

## The question

Sitevision is the CMS behind the intranet. D87 built a browser-side Sitevision menu source
(`packages/site-header/src/sources/sitevision.ts`) and D88 made the header a connector's read capability answering
`SiteHeaderOutput`. What would a real `connectors/sitevision` do, with which identity, and what else of Sitevision
belongs in Clew: search, page content, documents, scans or figures?

## Short answer

- **Build the header first, as a pass-through connector in its own container**, `sitevision.header` over the Model
  REST API's `headless` endpoint on the start page (`sv:sitePage`), one level down for the places and one more for
  each place's own pages, absolute addresses from `URI` resolved against a configured public origin. The API shape is
  verified; the start page's listing is not (it needs a signed-in caller on the test site).
- **Identity is the open question, not the API.** Sitevision's REST API runs as whoever the HTTP session is and
  returns what that caller may READ (verified: anonymous gets the login page's properties and a 403 on the site
  node). A service identity gives every person the same menu; "a manager sees one section more" needs the person's
  own identity against Sitevision, and the only documented way to carry an external token into Sitevision is its
  JSON Web Token login module (licensed, "typically passed on by a load balancer or proxy"), which is unverified
  for API calls. Start with a service identity and the public plus common sections; make delegation a phase with
  Sitevision in the room.
- **Search second** (`sitevision.search` and `sitevision.fetch` over the index's `search` endpoint, D26), **page
  content as a `text` view** from `headless` with `textPortletFormat=MARKDOWN`, **files as documents (D79) last**.
  Nothing of Sitevision is a scan or a figure.

## What Sitevision offers

### The Model REST API (verified and documentation)

| Point | Status | What was found |
|---|---|---|
| URL pattern | documentation | `<origin>/rest-api/<api version>/<model version>/<path or id>/<method>`; API version is always `1`; model `0` is the offline (editor) tree, `1` the online tree with published content only. Identifier-based addresses are preferred (faster, no name collisions). |
| Enabled for external callers | verified | `GET /rest-api/1/1/4.19ba380619d66299af1e822/properties` answers 200 JSON anonymously on the test site. The API is off by default and switched on per site under Site settings; since 2022.11.1.1 it can be restricted to named users or groups. |
| What a page carries | verified | The login page (`4.19ba…e822`, `sv:page`) answers `displayName` ("Login"), `URI` (`/system/login`), `URL` (`http://dse-sundsvall.sitevision-cloud.se/system/login`), `visibleInMenus`, `published`, `publishDate`, `lastPublishDate`, `robotsIndex`, `locale`, `template`, `shortId`, `jcr:uuid`, `usePathName`, `resourcePriority`. |
| `URL` versus `URI` | verified | `URL` came back with `http://` on a site served over `https://`: it is the address Sitevision knows itself by, exactly D87 item 5's point. `URI` plus a configured public origin is the only safe address. |
| `headless` | verified | `GET …/<id>/headless` without parameters answers `{ properties, nodes, contentNodes }`: the node's own properties, each child as `{ id, type, name, path, properties }` with the same page properties, and the page's text content as `{ type: 'text', name, properties: { textContent } }`. The default `excludes` already removes `sv:pageContent`, rating and metadata repositories. |
| Array parameters on a GET | verified, negative | `properties=["displayName"]` (JSON string, D87's `sitevisionHeadlessUrl`), `properties=a&properties=b`, `properties[]=a` and `properties=a,b` all fail: 500 `ClassCastException: java.lang.String cannot be cast to java.util.List` or Tomcat 400. Scalars (`limit=5`) work. `?json=` and `?input=` are accepted and ignored. How the REST console encodes the documented JSON input is behind the sign-in (`/rest-api/doc` redirects to the login page). Until that is known, **the connector calls `headless` and `nodes` without array parameters and filters types and properties itself**; D87's source would get a 500 on this instance. |
| Permissions follow the caller | verified | `…/2.19ba…e81f/nodes`, `/properties` and `/headless` (the site node) answer 403 `{"type":"forbidden","message":"FORBIDDEN: User Anonymous is not allowed"}`; the offline model answers 401 "Offline data operation requires authentication". Documentation: "the same as in the editor and the Public API"; `headless` and `nodes` require READ on the node. |
| `search` | documentation; verified only that it is not a page method | A GET on an index node (`sv:nodeIndex` or `sv:applicationIndex` under `sv:indexRepository`) with `query` (Solr), `filterQuery`, `fields`, `sortFields`, `skip`, `limit` (1–500 since 2022.10.2). Hits are filtered to what the caller may READ. On a page node it answers 404 "Method not supported for object". The index node's id was not readable anonymously. |
| Page text as Markdown | documentation | `headless` and `contentNodes` take `textPortletFormat=PLAIN\|JSON\|MARKDOWN` (MARKDOWN since 2025.07.1). |
| Other endpoints | documentation | 46 in all, among them `Properties`, `Nodes`, `ContentNodes`, `Search`, `SemanticIndex` (external entries with `acl_allow` of `anonymous`, `authenticated` or a group; needs WRITE and MANAGE_AI), `McpServerCustomModule` (Sitevision hosts MCP server addons; needs the `mcp` feature). Server-side code uses the `RestApi` utility without HTTP. |

### Identity and authentication (documentation; nothing could be verified without credentials)

- **No API-token scheme is documented** for the Model REST API. Access is the HTTP session of a user signed in
  through the site's login modules, with the user's READ permissions. D87's script sends HTTP Basic (`--as-user`);
  whether this site accepts Basic on `/rest-api/` is unverified.
- **Login modules** (help.sitevision.se): LDAP, System login, Secure cookie, SAML 2, OpenID Connect (licence),
  JSON Web Token (licence; a signed JWT "typically passed on by a load balancer or proxy"), CAS, MobilityGuard,
  OpenID, Swedish e-identity. Developer guides show OpenID Connect against Azure AD, Google and Auth0 (2019). The test
  site shows a local username/password form; which modules it runs is not visible.
- **Service users** are a panel for extensions (a directory user a RESTApp or WebApp may run as), not a credential an
  external caller presents. **`sv:oauth2Configuration`** is Sitevision as an OAuth2 *client* towards other systems
  (the intranet-search integration answers 401 with a login link when its OAuth2 session has expired), not a way to
  authenticate API callers. **System users** (System, Anonymous, Indexer, Validator, Extractor) are internal.
- **Can an IdP access token be used against Sitevision?** Not documented. The one candidate is the JWT login module:
  if it can be configured to trust the municipality's IdP keys and to read a bearer header on API requests, a token
  Clew obtains by RFC 8693 exchange (D26) for a Sitevision audience could sign the person in per request. Licence,
  configuration and whether the module applies to `/rest-api/` are all open; this is a question for Sitevision.

### Sitevision Cloud versus on-premises (documentation)

Sitevision Cloud is operated by Sitevision alone in Nordic data centres (ISO/IEC 27001:2022, automatic upgrades,
SLA tiers); the test site is on `*.sitevision-cloud.se` and its REST API is reachable over the public internet
(verified). IP allow-lists and network options are not documented. An on-premises Sitevision serves the same API on
the municipality's own network; the connector then runs where it can reach both Clew and Sitevision. Either way the
same `SITEVISION_BASE` configuration applies, and the municipality's intranet may also sit behind a reverse proxy on
a different public name, which is why `URL` cannot be trusted.

## Mapping onto Clew

### 1. The header capability

`sitevision.header`, a `read` with empty input and `SiteHeaderOutput` as output, declared as `header: { capability }`
and chosen by the administrator. The connector asks `headless` on the configured start page (the `sv:sitePage`; its
children are the sections), keeps `sv:page` and `sv:structurePage` with `visibleInMenus !== false` (and, if the
instance exposes it, `published`), then `headless` once per section for its own pages (one level, at most 20 per the
schema; the schema allows 12 places). The place "Start" is Clew's own (`/`, with its pages as the fixture has them)
and is configured, not read from Sitevision. Site name and logo: the site's `displayName` is not readable anonymously
and the logo is a template asset, so both are configuration (`SITEVISION_SITE_NAME`, `SITEVISION_LOGO_URL`), with the
build's branding as fallback (D37/D38). Ids are the Sitevision node ids lowercased to the schema's `[a-z0-9-]`.

| Listing as | Who sees what | Audit | Falls short |
|---|---|---|---|
| **A. Anonymous** | The public sections only, the same for everyone | Clew's row names the person; Sitevision sees nobody | On this test site the start page itself is not public, so the header would be empty |
| **B. A service identity** (a Sitevision read user, Basic or a kept session cookie) | What that user may read, the same for every person; the connector may hide sections by Clew's `role` but that duplicates Sitevision's rules | Clew's row names the person; Sitevision's log shows one user | "A manager sees one section more" is lost unless the service user is in every group, which shows restricted sections to everyone |
| **C. Delegation** (D26: the exchanged token presented to Sitevision's JWT module) | Sitevision's own listing per person | Both sides name the person | Unverified end to end; licence; absent in sessions without an IdP token, so the connector answers `denied` and Clew draws its default |
| **D. Per-person listing by a Sitevision-side RESTApp** run as a service user | The RESTApp evaluates the person's groups itself | As B | Code inside Sitevision, a second place to maintain, and the RESTApp still needs to know who asks |

Recommendation: **B for the first phase**, with the connector declaring in its README that the header is the common
menu and Sitevision enforces page access on click; **C as the phase that makes the header per person**, started only
after Sitevision confirms the JWT module (or another mechanism) accepts a bearer token on `/rest-api/`. A is right
only for an installation whose intranet start page is public. D is not Clew's way (D21: the connector owns its
system's protocol, not code inside it).

### 2. Search, page content and documents

- **`sitevision.search`** (`kinds: ['document']`) over the index's `search` method: `query` from the person's words,
  `fields` the name, URI, a summary field and `lastPublishDate`, `limit` 20, hits mapped to `SearchHit` with
  `ref` = node id, `link` = `URI` on the public origin, `source` "Intranätet", `updatedAt` from the publish date,
  `owner` from a metadata field when the site keeps one. **`sitevision.fetch`** takes the ref back and answers one hit
  from `properties`. Both as the same identity as the header; with B the hits are the service user's, so the
  composite's "as the person" (D26) holds only with C. The search index node id is configuration
  (`SITEVISION_INDEX_NODE`).
- **Page content as a `text` view**: `sitevision.page` with `{ ref }` reads `headless` with
  `textPortletFormat=MARKDOWN` and joins the text content nodes into one Markdown body (D38's `text` view; D79
  excluded Markdown *file* previews, not text views). A search hit's `view` opens it in the panel (D38). Links inside
  the Markdown must be rewritten to absolute addresses on the public origin.
- **Files as documents (D79)**: `sv:file` nodes under a page or the file repository, bytes fetched by the connector
  from the file's address with its own credential and answered through `POST /clew/documents`, bounded and versioned
  by `lastPublishDate`. Worth a phase only if the intranet's routines live as PDF and DOCX, which is likely in a
  municipality; the metadata for descriptors is in `properties`.

### 3. Scan, card or figure: no

A scan reports occurrences that a person should act on (D45/D47); a figure is a fact about an area the person owns
(D54). Intranet pages are neither: nothing is outstanding and nothing is the person's to close. "Tre nya nyheter"
from `sv:article` is attention without an action and would compete with the cards (the "no summary copy" rule). If
news belongs anywhere it is a `list` view a person opens, not a tile.

### 4. Identity and audit

Clew signs who asks (D44) and the connector verifies it; what Sitevision sees is the connector's credential. With B
Clew's audit row names the person and the capability while Sitevision's own log shows one service user for every
request; the connector should log the Clew actor id beside each upstream call so the two logs can be joined. With C
both logs name the person and the token is forwarded, never stored (authorization guide). The connector must answer
`denied` when delegation is declared and no token arrives (scans, figures, callbacks, sessions without an IdP token).

### 5. Caching and failure

The header is asked on every page load (D88, "not verified and open"). The connector keeps the header in memory per
identity: one entry for B, one per actor id for C, `SITEVISION_CACHE_SECONDS` (default 300) with stale-while-
revalidate, so a slow or failed Sitevision answers the last good menu within a bounded age and `unavailable` (503)
after it. Clew already draws its default (site name and Start) on a refusal or failure and reports it through
`onRefused`; a registry cache per person remains the step D88 left open. Timeouts stay inside the remote transport's
ten seconds: two `headless` levels are a handful of requests, run concurrently per section.

### 6. Addresses

Absolute addresses from `URI` resolved against `SITEVISION_PUBLIC_ORIGIN` (default `SITEVISION_BASE`), never `URL`
(verified `http://` on an `https://` site). Addresses on Clew's origin only for Clew's own places (Start). Hidden
pages (`visibleInMenus === false`) left out; the login page and other `/system/` pages filtered by `URI` prefix.

### 7. Deployment and configuration

`connectors/sitevision`: `manifest.mjs`, `connector.mjs`, `sitevision.mjs` (the API behind a port), `server.mjs`,
the shared `verification.mjs`, a `Dockerfile` on `node:26.13.0-bookworm-slim` (MIT), no dependency beyond Node and
nothing imported from the repository (D61 rule for connectors). Environment: `CLEW_CONNECTOR_SECRET`, `CLEW_URL`,
`PORT`, `SITEVISION_BASE`, `SITEVISION_PUBLIC_ORIGIN`, `SITEVISION_START_NODE`, `SITEVISION_INDEX_NODE`,
`SITEVISION_AUTH` (`anonymous` | `basic` | `delegated`), `SITEVISION_USER` and `SITEVISION_PASSWORD` from a secrets
store, `SITEVISION_SITE_NAME`, `SITEVISION_LOGO_URL`, `SITEVISION_CACHE_SECONDS`, `SITEVISION_ADAPTER`
(`fixture` | `api`, as qlik does). Registered by an administrator (D23) after `bun scripts/connector-check.ts <url>
--secret …`, which asks the header as both roles and reports the count of places. The fixture adapter serves the
proof of concept's tree so the development stack can run it in place of `connectors/intranet`.

### 8. Phases and tests

| Phase | Delivers | Needs first |
|---|---|---|
| 0. Verify signed in | The start page's node id and children on the test site; how the console encodes array parameters; whether Basic is accepted on `/rest-api/`; one group-restricted section as a manager | A test user from the product owner; a signed-in pane or an operator running `site-menu.ts --list --as-user` |
| 1. Header | `sitevision.header` with identity B, fixture adapter, README, check | Phase 0's node id and credential form |
| 2. Search | `sitevision.search`, `sitevision.fetch`, `sitevision.page` text view | The index node id; the summary field the site indexes |
| 3. Documents | `documents: true`, file descriptors and bytes | Which file types the intranet keeps as routines |
| 4. Per person | `delegation: { audience }`, identity C | Sitevision's answer on the JWT module and a Keycloak client for the audience |

Tests like `tests/unit/qlik-connector.test.ts`: the connector run in process through `remoteConnector` and the
`Registry` with a **fake Sitevision behind `fetch`**, answering `headless`, `properties` and `search` from a recorded
tree (the shapes above, including an `http://` `URL`, a hidden page, a 403 on the site node and a 500 on an array
parameter). Cases: the header's shape and order, hidden and `/system/` pages left out, absolute addresses from `URI`,
403 to `denied`, timeout to `unavailable`, the cache's age and revalidation, the delegated token forwarded and never
logged, `denied` when delegation is declared and the token absent, and the manifest through `checkConnector`. A later
live pass against the test site is recorded in the connector's README, not assumed.

## Recommendation

Build `connectors/sitevision` with the header first, as a service identity, over `headless` without array
parameters; keep Start and the site's identity in configuration; `URI` plus a configured public origin for every
address. Treat the per-person header as a separate phase that depends on Sitevision confirming how an external
bearer token signs a request in; do not promise "a manager sees one section more" from Sitevision before that. Add
search and the text view when the index node and its fields are known; documents after. Replace D87's
`sitevisionHeadlessUrl` encoding once phase 0 shows what the instance accepts.

## Not settled

Whether this site accepts HTTP Basic on `/rest-api/`; the console's encoding of array parameters; whether the JWT
login module can carry an exchanged IdP token for API requests (and its licence); the start page's node id and
whether its listing differs by group on the test site; which Solr fields the intranet's index exposes for a summary;
whether the embed on the intranet (`<site-header>`, D87) should keep its own source or read from this connector
through Clew; a registry cache per person (D88); and whether Sitevision's own MCP server addons (D81's external lane)
would make a native search capability unnecessary for AI-enabled chat.

## Sources

Read on 2026-11-09. Live probes: anonymous `GET` requests from the browser pane to
`https://dse-sundsvall.sitevision-cloud.se/` (`/`, `/robots.txt`, `/sitemap.xml`, `/rest-api/doc`,
`/rest-api/1/1/{2.19ba380619d66299af1e81f,4.19ba380619d66299af1e822,12.19ba380619d66299af1e871}/{properties,nodes,headless,search}`,
`/rest-api/1/0/4.19ba380619d66299af1e822/properties`).

- https://developer.sitevision.se/docs/rest-api/model-rest-api (URL pattern, models, activation, permissions, console)
- https://developer.sitevision.se/docs/rest-api/model-rest-api/endpoints (the endpoint list)
- https://developer.sitevision.se/docs/rest-api/model-rest-api/endpoints/headless (parameters, defaults, response, `textPortletFormat`)
- https://developer.sitevision.se/docs/rest-api/model-rest-api/endpoints/nodes (parameters, READ and MANAGE_USERS rules)
- https://developer.sitevision.se/docs/rest-api/model-rest-api/endpoints/search (index nodes, Solr parameters, hit filtering)
- https://developer.sitevision.se/docs/rest-api/model-rest-api/endpoints/semanticindex and …/mcpservercustommodule
- https://developer.sitevision.se/docs/public-api/node-types/node-types/2024-09-19-svsitepage (`URI`, `URL`, `visibleInMenus`, `published`)
- https://developer.sitevision.se/docs/public-api/node-types/node-types/2025-01-13-svsystemuser
- https://developer.sitevision.se/docs/public-api/faq/faq/2024-09-26-can-i-access-the-rest-api-from-a-script-or-webapp-restapp and the `RestApi` apidoc
- https://developer.sitevision.se/archives/release-notes/release-notes/2022-12-20-release-notes-sitevision-2022-11-1-1 (restriction to users and groups)
- https://developer.sitevision.se/archives/developer-news/developer-news/2020-10-22-the-importance-of-using-a-proper-rest-api-url
- https://developer.sitevision.se/docs/search/intranet-search-integrations (a RESTApp's `GET /search`, OAuth2 401 with a login link)
- https://help.sitevision.se/en/siteRestApiSettingsHelp.html (the REST-API panel, CORS domains)
- https://help.sitevision.se/en/siteLoginModuleHelp.html (login modules, including OpenID Connect and JSON Web Token)
- https://help.sitevision.se/en/siteServiceUsersConfigurationHelp.html (service users for extensions; from search results)
- https://developer.sitevision.se/archives/tips-and-tricks/tips-and-tricks/2019-10-08-using-openid-connect-with-microsoft-azure-ad (from search results)
- https://sitevision.net/sv/en/startpage/features/cloud (Sitevision Cloud)
