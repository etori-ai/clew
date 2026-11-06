# Review: from mock connectors to real test sources · 2026-11-06

Reviewed revision: `a595b78`
Status: review and recommendation; no decision changed. The decision it calls for is listed at the end.

## Assessment

Clew has two different things called "mock" in the tree, and only one of them is a problem.

The four **bundled mock connectors** (`packages/connectors/src/mock/`: `hr`, `finance`, `incidents`, `kommunikation`,
with their made-up people, invoices and notices in `mock/data.ts`) run inside the server process, are registered in the
live registry at boot beside Clew's core connectors, keep their state in the `module_state` table and have a
development-only reset endpoint (`POST /api/mocks/reset`, `apps/server/src/modules/mocks/`). They are what a developer
sees on Hem today. They are also exactly what D21 says new integrations must not be: code loaded into Clew's process,
coupled to Clew's release, running with Clew's database credentials. They predate the connector protocol (session 4,
2026-11-03) and were kept because they were the only thing that filled the page. D52 made them vendor-neutral; it did
not make them connectors.

The four **standalone connectors** under `connectors/` are already the right shape: own container, protocol 2, no import
from the repository (the dependency cruiser enforces it). `hello` is the protocol demonstration and `telefonbok` the
search-and-views example; both feed the generated documentation (`scripts/docs.ts`, `scripts/docs-smoke.ts`).
`reference` is the fault-injecting durability fixture behind `bun run test:durability`. `eneo` is a real connector to a
real product, tested so far against recorded answers only. None of these is a dummy; they are documentation and test
harness, named as such, and they stay.

The dev stack is more real than the page suggests. Keycloak is a real IdP, Nextcloud a real CalDAV server, Temporal and
Postgres real. An Eneo development instance is running on this machine right now (`eneo_devcontainer-eneo-1`, API on
8123), and the Eneo checkout has the resource-server mode the connector needs
(`backend/src/eneo/authentication/oidc_resource_server.py`). The status page's open item "not yet run against a real
Eneo" can be closed without writing a line of connector code.

So the question is not "how do we mock better" but "what replaces the four in-process mocks as the thing that fills
the page, and where does it live". The answer this review recommends: a separate repository of **test sources**, each a
real system or a contract-faithful stand-in, each reached through a protocol connector, registered in a dev Clew the
way a municipality registers a vendor's connector. Clew's own repository then bundles only its core (`people`,
`calendar`, `search`), which is what D21 and D22 already claim.

## Basis and limits

Read: `docs/vision.md`, `docs/reference/status.md`, `docs/architecture/integration-paths.md`, D21, D22, D23, D35, D52,
D55, D57, the four connector READMEs, `apps/server/src/connectors/registry.ts`, the mock sources and tests, the
uncommitted draft of "From your own project, against a test installation" in `docs/guides/testing-and-deployment.md`,
and the 2026-11-04 SupportManagement review. Looked at: the Sundsvallskommun GitHub organisation (89 `api-service-*`
repositories, MIT), the local checkouts of `api-service-support-management` (`ae20c369`) and Eneo, and the containers
running on this machine. Nothing was run against Eneo or SupportManagement; their fitness below is read from source and
READMEs, and the effort estimates are estimates.

## What depends on the in-process mocks today

| Dependent | What it uses | What happens when the mocks go |
|---|---|---|
| `apps/server/src/connectors/registry.ts` | Registers the four at boot with `uses: ['*']` | Bundled list shrinks to `calendar`, `people`, `search`; `bundledIds` and the boot rows follow |
| `apps/server/src/modules/mocks/`, `composition/index.ts`, `routes/api.ts` | `POST /api/mocks/reset` (`CLEW_POC` only) | Removed; a test source resets itself (its own endpoint or a container restart) |
| `module_state` table, `packages/db/src/state.ts` | The mocks' durable state | Table stays for migration history; nothing writes it; a later migration may drop it |
| `connector` rows `hr`, `finance`, `incidents`, `kommunikation` (`bundled = true`) | Boot reconciliation inserts them | A data migration deletes the four bundled rows; cards and audit rows are history and stay (same rule as `0027`) |
| Eight unit test files, about 120 tests (`connectors`, `threads`, `conversation`, `assistant`, `views`, `panel-labels`, `job-executions`, `connector-admin`) | The mocks as scenario fixtures over `memoryState()` | Fixtures move to `tests/fixtures/connectors/` and are trimmed to what the tests assert; the product no longer ships them |
| `tests/a11y/` | Nothing: the API is mocked in the browser from `tests/a11y/data.ts` | Unaffected. The source labels there ("Personalsystemet") are browser fixtures, not connectors |
| `scripts/modules-check.ts` | Live smoke against the mocks' cards | Already documented as historical (`testing.md`); retire it with the mocks |
| Documentation | `testing.md` ("real registry, mock connectors"), `connector-administration.md`, `integration-paths.md` (mock rows), `status.md`, D52 | Updated to name the test sources; D52 superseded by the decision below |
| Hem in development | The mocks' cards, areas and figures | Empty until the test sources are registered; the lab's compose and register script become the documented dev-data path |

Not in scope but adjacent: the synthetic calendar directory (`packages/calendar/src/accounts.ts`, gated by `CLEW_POC`),
`scripts/calendar-seed.ts` and the three Keycloak personas are dummy *data* about *real* systems. They stay until SCIM
or a directory connector gives the calendar its accounts; that is a decision of its own.

## What "real-mock" should mean

A test source is graded by how much of it is the real thing. Three tiers, in order of preference:

1. **Real product, local instance, synthetic data.** The source is the software a municipality runs, started from its
   own open-source image or devcontainer, loaded with made-up records. Failures are the product's failures. Eneo,
   Nextcloud and Keycloak are already here.
2. **Real contract, recorded stand-in.** The product cannot run locally (a dozen dependencies, a closed database, a
   licence), but its API is open: its OpenAPI document and recorded answers are served by a stub server. The dept44
   services publish both (`src/test/resources/api/openapi.yaml` and hundreds of WireMock mappings in
   `src/integration-test/resources/`). The connector written against the stub is the connector that ships.
3. **Kind-of-system fixture.** No open implementation and no open contract (an HR system without an API, finance behind
   a gateway). A small service that behaves the way such a system behaves, with fault switches, honest about being
   synthetic. This is what the four in-process mocks are, minus the protocol boundary.

Everything in tier 3 must sit behind the connector protocol and outside Clew's process, so that Clew cannot tell it
from a vendor's connector. That is the whole point: today the mocks are trusted code; the lab makes them untrusted
services and proves the protocol carries scans, areas, figures, views, facts and follows, execute and undo without
privileged access.

## Candidates

| Source | Tier | Why it is a good test | What it costs | Connector |
|---|---|---|---|---|
| **Eneo** (knowledge search, D14/D26) | 1 | The connector exists, the instance is running, resource-server mode exists in the checkout. Exercises RFC 8693 token exchange end to end, the one path no fixture can prove. Closes "not yet run against a real Eneo" in `status.md`. | Hours: set `OIDC_RESOURCE_SERVER_ENABLED`, issuer `http://keycloak.orb.local:8090/realms/clew`, audience `eneo`, tenant id in Eneo's `.env`; create `hillevi@clew.test` there with one space, one collection and a few documents; run `bun scripts/auth-exchange-check.ts`. | `connectors/eneo`, unchanged |
| **SupportManagement** (errands, D18/D35) | 1 or 2 | The first real domain the vision names, reviewed in depth on 2026-11-04, and the connector does not exist yet. Per-user access, `If-Match` versions, `GET …/access`, link-out: everything the ledger's re-validate, execute, read-back loop needs. MIT, Sundsvall's own, checkout at hand. | Tier 1 is days: Java 25, MariaDB, OpenSearch optional, twelve dependent services to stub (the repository's 296 WireMock mappings already describe them). Tier 2 is a day: WireMock or Prism over its `openapi.yaml` with a handful of recorded errands. Start at tier 2, keep tier 1 as the pilot's rehearsal. | New `sm` connector in the lab, built to the D35 errand profile; `clew.errands` composite in Clew follows |
| **api-service-checklist** (onboarding, UC-OMAR-1) | 1 or 2 | Small, MIT, a domain Clew's vision lists as a candidate to own one day; a check of the ladder "pass-through before core". Depends on Employee, MDViewer, Messaging, Templating, all stubbable. | A day at tier 2. | New `checklist` connector in the lab, later |
| **Open ePlatform** (e-services, feeds `sm-loader`) | 1 | Open source, runs in Docker, the citizen-facing side of errands. | Days; only worth it once `sm` is real. | Later |
| **The phone book / Metakatalogen** | 3 today | `telefonbok`'s HTTP adapter assumes a shape nobody has confirmed. The real step is a contract, not a stub. | Ask Sundsvall for the directory API's OpenAPI (the `Employee` service the dept44 stack uses); until then `telefonbok` stays the documentation example on its fixture. | `connectors/telefonbok`, unchanged |
| **HR, finance, incidents, kommunikation** | 3 | No open implementation, no open contract. Still needed: they carry the scenarios the canvas draws (rehab rule, leave decision, attest, deviation, notice receipt) and the job stress test (`facts`/`follows`). | Porting the four mocks to protocol connectors in the lab, a few days. The port is itself a test: whatever the mocks did that the protocol cannot express is a protocol gap to record. | Four lab connectors, ids unchanged so stored cards and tests keep their refs |

Order of value: Eneo first because it is nearly free and proves delegation; SupportManagement second because it is the
first real domain and the first real write; the four fixture connectors in parallel because they are what empties the
repository.

## The lab repository

One repository, provisionally `clew-test-sources` (the name is the product owner's call), MIT like the connectors here.

```
clew-test-sources/
  compose.yaml            # every source and connector, against a Clew reached at CLEW_URL
  register.sh             # connector-add for each, with the lab's transport secrets
  sources/
    support-management/   # tier 2 now: WireMock or Prism over the service's openapi.yaml and recorded errands; tier 1 later
    hr/ finance/ incidents/ kommunikation/   # tier 3 fixtures with fault switches, the way connectors/reference has them
  connectors/
    sm/ hr/ finance/ incidents/ kommunikation/ checklist/
  scenarios/              # the flows the canvas draws, as scripts: artboard J, the rehab rule, a notice receipt
```

Rules it follows, so it stays honest:

- It consumes the protocol **from the instance** (`/api/protocol/openapi.json`, D57), never from a checkout of Clew.
  That is the integrator path the draft guide describes, exercised by Clew's own team on every change.
- Every connector passes `connector-check` and the manifest dry run in its CI, against a Clew image or a dev instance.
- Fixture data is generic (D52) and resettable; a fault switch is process configuration, never an unauthenticated route
  (the `reference` rule).
- Nothing in Clew's repository names a lab connector. The dev README says "register the lab", nothing more.

What stays in Clew's repository: `hello` and `telefonbok` (documentation), `reference` (durability fixture), `eneo`
(a real connector the Clew team maintains), and in-test fixture connectors under `tests/fixtures/` for the unit suite.
A connector the Clew team ships for a real product (`eneo`, later `sm` when it leaves the lab) lives here under
`connectors/`, as `CLAUDE.md` says; a connector to a fixture does not.

## Recommended order of work

1. **Eneo for real** (no code): configure the running instance, create the persona and a collection, run the exchange
   check and a search from Hem, record the result in `status.md` and the acceptance matrix.
2. **Unbundle the mocks**: remove the four from `registry.ts`, delete `modules/mocks/` and `/api/mocks/reset`, move
   `packages/connectors/src/mock/` to `tests/fixtures/connectors/` (unchanged at first, so the suite stays green), add
   the data migration for the bundled rows, update `testing.md`, `connector-administration.md`,
   `integration-paths.md`, `status.md`, and record the decision. After this step Hem in development is empty until
   step 3 registers something, so step 3 lands close behind.
3. **The lab, first cut**: create the repository with `hr` ported to a protocol connector plus its fixture source and the
   compose/register pair; register it in the dev Clew and compare Hem with what the mock showed. Then the other three.
4. **SupportManagement at tier 2**, then the `sm` connector and `clew.errands`.
5. **Trim the in-test fixtures** to what each test asserts, and retire `scripts/modules-check.ts`.

## Decision to record

A numbered decision superseding D52's scope: *Clew bundles only its core connectors; every test source is a protocol
connector outside the repository.* It should name the lab repository, what stays in `connectors/` and why, the rule
that fixtures consume the protocol from the instance, and the fate of `module_state`. D52's naming rule (generic
systems, no vendor) carries over to the lab unchanged.

## Addendum, same day: keep it in the repository, and put real products behind the fixtures

The product owner asked three things after the first draft: whether the mocks can stay in this repository so a
developer can run everything locally without a second checkout; how to mock the systems Sundsvall has not yet given
access to more realistically; and whether open-source products with Docker images could stand in for them, the way
Nextcloud and Temporal already do.

### In the repository is fine. The boundary that matters is the process, not the repository

The separate repository bought one thing: proof that a connector can be built from the served protocol alone. The
dependency cruiser already proves most of that (`connectors-stand-alone`: nothing under `connectors/` imports `apps/` or
`packages/`), and D57's dry run can be a test here as easily as there. What must not survive is the in-process mock:
code in `packages/`, registered at boot, trusted with Clew's database. So the revised layout is:

```
connectors/hr/ finance/ incidents/ kommunikation/   # protocol connectors, Node, the hello shape; each with an adapter port:
                                                     #   fixture (own SQLite state, like reference) | <product> (Odoo, Zammad, …)
connectors/sm/                                       # the errand connector, against WireMock on SupportManagement's own OpenAPI
.devcontainer/compose.yaml, profile `sources`        # the products below, opt-in like the `calendar` profile
.devcontainer/compose.yaml, profile `connectors`     # the connectors as containers, CLEW_URL=http://app:3000
scripts/sources-register.ts                          # connector-add for each, run inside the app container
```

Two rules make it honest: a cruiser rule that `apps/` and `packages/` never import `connectors/` (the inverse of the
rule that exists), and the dev README's instruction is "start the profiles and register", never "the page comes with
cards". A lab repository stays an option for the day another municipality wants the fixtures without Clew's source.

### What "more realistically" means, concretely

The present mocks are unrealistic in ways that have nothing to do with their data:

1. **They run in Clew's process** with Clew's credentials. A real source is a network hop with its own identity.
2. **Their dates are absolute** (`2026-11-02`), so the scenarios go stale next month. A fixture generates relative to
   the clock it is given, or re-seeds on start.
3. **Their state is Clew's** (`module_state`). A real source keeps its own, survives its own restart, and can disagree
   with Clew's view. `connectors/reference` has the right shape: SQLite, one transaction per operation, idempotency by
   operation id, fault switches that fail after commit.
4. **They never fail.** No 401 on an expired credential, no 503, no latency, no pagination, no partial list, no version
   conflict on a write. Every one of these is a switch in the fixture and a free behaviour of a real product.
5. **Their identity is Clew's.** The person's id *is* the HR id. A real source has its own account ids and unit ids,
   which forces the mapping the phone book connector already has (`TELEFONBOK_UNIT_MAP`).
6. **Their API is Clew's contract.** A real product's API is nothing like the manifest; the connector has to translate.
   That translation, not the data, is where integration bugs live.

Points 1 to 5 are the fixture adapter, rewritten. Point 6 is what a real product behind the same connector adds.

### Open-source products that can stand in, with Docker images

Checked 2026-11-06 against the projects' own pages. All licences are OSI-approved and every product runs as a separate
process, so AGPL and GPL are acceptable under `CLAUDE.md`'s rule for infrastructure components.

| Mocked kind | Product | Image and store | Licence | What it gives the connector | What it cannot give |
|---|---|---|---|---|---|
| HR: absences, leave requests with approval, shifts | **Odoo Community** | `odoo` (Docker Official Image, maintained by Odoo; tags 18.0, 19.0, 20.0) + PostgreSQL | LGPL-3.0 | Employees, Time Off requests and their approve/refuse, attendances; XML-RPC/JSON-RPC `execute_kw` on every model, API keys per user | Delegations (keep in the fixture or add a custom field); Swedish HR semantics; the municipal HR system's actual model |
| Finance: supplier invoices to attest, budget | **Odoo Community**, the same instance | as above | LGPL-3.0 | Vendor bills (`account.move`) draft → posted, analytic accounts for cost centres and budget, the same API | The real attest flow behind the gateway |
| HR, second choice | **Frappe HR** | compose in `frappe/hrms` (MariaDB, Redis) | GPL-3.0 | Leave applications with multi-level approval, shifts, expense claims; REST API per doctype | Heavier stack, two more databases |
| Deviations and incidents; errands at tier 1 | **Zammad** | official `zammad/zammad-docker-compose` + PostgreSQL; Elasticsearch optional (`ELASTICSEARCH_ENABLED=false`) | AGPL-3.0 | Tickets with state, owner, group, priority, `pending_time`; groups ≈ SupportManagement's namespaces; REST API with per-user tokens and permissions, `X-Zammad-Suppress-Notifications` | Memory: several GB with Elasticsearch, keep it off; AGPL is fine out of process |
| Incidents, lighter | **GLPI** | `glpi/glpi` (official, weekly rebuilt) + MariaDB | GPL-3.0 (images repo MIT) | ITIL incidents, requests, problems; REST API with app token | ITIL vocabulary, not a municipal avvikelsesystem |
| Kommunikation: notices with a receipt | **Nextcloud**, already in the stack, with the `announcementcenter` app | the existing `clew-calendar` image, one more app | AGPL-3.0 | Announcements per group, Nextcloud's notifications API, mark-as-read as the receipt | Needs the app added to the image and the users already seeded there |
| Directory (Metakatalogen's role) | **lldap** | `lldap/lldap` | GPL-3.0 | Users under `ou=people`, groups with `memberOf`, custom attributes (title, phone, room, manager); Keycloak federates it, so one directory feeds login and the phone book | Not a full LDAP server; OpenLDAP if that bites |
| Case system on the real contract | **WireMock** | `wiremock/wiremock` (official) with SupportManagement's `openapi.yaml` and recorded errands | Apache-2.0 | The real API shape, stateful scenarios, response templating, injected faults; the `sm` connector written here is the one that meets the real service | No business logic: the real service's next state is whatever the scenario says |
| Knowledge | **Eneo**, running on this machine | the Eneo devcontainer | AGPL-3.0 | The real connector, real token exchange | — |
| Calendar | **Nextcloud**, running | `clew-calendar` | AGPL-3.0 | Real CalDAV, already the calendar adapter's source | — |

A connector written against Odoo or Zammad is not the connector that will meet Sundsvall's HR or case system; its
product adapter is throwaway. What is not throwaway: the manifest, the scan, the facts and follows, the views, the
execute and read-back loop, and every Clew-side bug that a real API's pagination, latency, conflicts and identity model
shakes out. Keep the product adapters small and the fixture adapter complete, so a scenario never depends on a product
being up.

### Revised order of work

1. **Eneo for real**, unchanged.
2. **Port the four mocks to `connectors/<id>/`** with the fixture adapter rewritten to the `reference` shape (own
   SQLite, relative dates, fault switches, own ids with a unit map), unbundle them from the registry, delete
   `modules/mocks/` and the reset route, add the `connectors` profile and `scripts/sources-register.ts`. Ids and
   capability names stay, so stored cards keep their refs. Record the decision.
3. **`sources` profile, first two products**: Odoo (HR and finance in one instance) and Zammad without Elasticsearch
   (incidents, later errands), each with a seed script and a product adapter in its connector.
4. **WireMock on SupportManagement's contract** and the `sm` connector; `clew.errands` in Clew.
5. **lldap behind Keycloak and the phone book**, when the directory question (Metakatalogen or a second source) is
   settled; Nextcloud announcements for kommunikation when the calendar image is next rebuilt.

## Outcome

Decided and built the same day as [D61](../decisions/D61-fixture-sources-are-independent-connectors.md): the six fixtures
are independent connector services under `connectors/`, the development stack runs and registers them, the unit suites run
them in-process over the protocol, and the in-process mocks, `module_state` and the reset route are gone. The first
products behind the fixtures (Odoo, Zammad, WireMock on SupportManagement's contract, lldap) and Eneo for real are the next
steps; the connectors' adapter port is where they plug in.
