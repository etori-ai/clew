# Connectors in this repository

Every folder here is one connector: an independent service that speaks the
[connector protocol](../docs/reference/connector-protocol.md) and depends on nothing else in the repository. Nothing in
`apps/` or `packages/` imports a connector, except the route that serves the protocol's examples
(`apps/server/src/routes/protocol.ts`). They are here for four different reasons, and this page says which is
which. To write one, start with [Create a connector](../docs/guides/creating-a-connector.md).

All of them use protocol 2. "Reads", "writes" and "proposes" count the capabilities in the manifest (`read`,
`execute`, `propose`); "scan" means the connector can report work that needs a person.

## A real product

| Folder | Id | Source | What it does | Capabilities | Where it runs |
|---|---|---|---|---|---|
| [nextcloud-approval](nextcloud-approval/README.md) | `nextcloud-approval` | Nextcloud | Files waiting for the person's approval in Nextcloud's Approval app. The first connector to a product that was not written for Clew (D101). | 3 reads, 2 writes, scan | Compose service on port 4052 in the `calendar` profile, against the development stack's own Nextcloud. Registered by hand. |
| [moodle](moodle/README.md) | `moodle` | Lärplattformen | The courses a person has completed and when, one course in detail with a link to it, and the badges they hold with their end, from Moodle LMS, read as one service account: a section on the opened person (D97) and the first source of the competence holdings profile (D108). | 4 reads | Compose service `moodle-connector` on port 4053 in the `moodle` profile, against the development stack's own Moodle. Registered by hand. |

## Written for a real system, not yet run against it

The project review of 2026-11-10 found that none of these had met its system. Each README says what is assumed.

| Folder | Id | Source | What it does | Capabilities | Where it runs |
|---|---|---|---|---|---|
| [supportmanagement](supportmanagement/README.md) | `sm` | Ärendesystemet | A person's errands, shown under "Mina ärenden". Acts as the person; the case system decides access (D35, D89). | 2 reads | Its own `compose.yaml`. Not in the development stack. |
| [qlik](qlik/README.md) | `qlik` | Qlik | Sick-leave rates per unit and month for managers, aggregates only (D82). | 3 reads | In the development stack on its made-up statistics (`QLIK_ADAPTER=fixture`), registered by `bun run dev:connectors`; its own `compose.yaml` runs it against Qlik. |
| [eneo](eneo/README.md) | `eneo` | Eneo | Eneo's retrieval over the person's knowledge bases as a search source (D14, D26). | 3 reads | Its own `compose.yaml`. Not in the development stack. |

## Examples for people who write connectors

| Folder | Id | Source | What it shows | Capabilities | Where it runs |
|---|---|---|---|---|---|
| [hello](hello/README.md) | `hello` | Hello | The smallest complete connector: a manifest, reads, a scan, a figure, a callback and toy receipts. State in memory. | 3 reads, 2 writes, scan | Its own `compose.yaml`. The guides are written against it. |
| [phonebook](phonebook/README.md) | `phonebook` | Telefonboken | A search source for people and declared views (D26, D38). The worked example of the [directory walkthrough](../docs/guides/example-custom-directory.md). | 5 reads | Its own `compose.yaml`. `bun run docs:check` runs a signed exchange against it. |
| [reference](reference/README.md) | `reference` | Testkälla | Durable writes done properly: operation keys, replay, stale revisions and lookup, on SQLite. A test fixture for the durability suite. | 2 reads, 2 writes, scan | Started by `bun run test:durability`. |

## Fixture systems of the development stack

Generic stand-ins for the systems a municipality has, with synthetic data and no vendor behind them (D52, D61). The
development stack runs each as its own compose service and `bun run dev:connectors` registers them. The unit suite runs
the first six in process through `tests/fixture-connectors.ts`.

| Folder | Id | Source | Stands in for | Capabilities | Port |
|---|---|---|---|---|---|
| [hr](hr/README.md) | `hr` | Personalsystemet | Absences, leave requests, delegations, shifts and the rehabilitation routine | 10 reads, 7 writes, 2 proposes, scan | 4040 |
| [finance](finance/README.md) | `finance` | Ekonomisystemet | Invoices to review and budget figures | 11 reads, 3 writes, scan | 4041 |
| [incidents](incidents/README.md) | `incidents` | Avvikelsesystemet | Deviations and incidents | 2 reads, 2 writes, scan | 4042 |
| [communication](communication/README.md) | `communication` | Kommunikation | Notices with read receipts ("Viktigt nu"), and the same notices as news (the news profile, D112) | 4 reads, 1 write, scan | 4043 |
| [timesheet](timesheet/README.md) | `timesheet` | Tidrapporteringen | Time reporting and staffing | 2 reads, 2 writes, 1 propose | 4044 |
| [payroll](payroll/README.md) | `payroll` | Lönesystemet | Payroll figures; Clew never writes here | 2 reads, 1 propose | 4046 |
| [intranet](intranet/README.md) | `intranet` | Intranätet | The content system that lists the shared header's places (D88) | 1 read, header | 4049 |
| [appraisals](appraisals/README.md) | `appraisals` | Samtalssystemet | A third-party system that answers the talks profile instead of Clew's own module (D96) | 4 reads | 4051, registered but not enabled |

## Generated manifests

`bun run docs:generate` writes a complete manifest for `hello`, `phonebook`, the six fixture systems, `appraisals` and
`moodle` to [docs/generated](../docs/generated/README.md). The other connectors are not in that list.

## Adding a folder here

A new connector gets a row in the section it belongs to, in the same change. A fixture never carries a vendor's name
(D52). A connector for a real system says in its README what has and has not been run against that system.
