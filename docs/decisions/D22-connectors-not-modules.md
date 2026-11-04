# D22 · Connectors, not modules: the word for an integration that a person, an operator or a vendor meets

**Status:** accepted · **Date:** 2026-11-04 · **Area:** integrations

**Decision.** The thing D21 calls a "module service" is a **connector** (Swedish, where a person reads it:
**anslutning**, plural **anslutningar**; the admin page is "Anslutna system"). A connector is a service that
implements the Clew connector protocol and contributes one source system to Clew: capabilities (its
actions), a scan (its triggers), areas and figures. The word applies everywhere outside the server's own
folder structure: the protocol (`docs/architecture/connector-protocol.md`,
`docs/protocol/connector-protocol.schema.json`), the package (`packages/connectors`), the reference service
(`connectors/hello`), the checker (`scripts/connector-check.ts`), the callback route
(`POST /api/connectors/call`), the registry type (`Connector` in place of `Module`), the connector field on
threads and areas (`thread.connector`, migration `0005`), the admin API (`/api/admin/connectors`),
`docs/architecture/working-across-connectors.md` and every guide. The label a card shows stays **källa**
(`source` in the manifest): "Källa: Heroma" names the system behind the connector, not the connector.

The word **module** keeps one meaning only: D20's bounded context in the server's code
(`apps/server/src/modules/<name>/`, the four kinds of file, the dependency rules). It is a code-organisation
word that no person, operator or vendor ever reads. The registry and the remote adapter move out of that
folder to `apps/server/src/connectors/`, since they are about connectors, not about one bounded context.
The mocks' state table keeps its name (`module_state`): it is the synthetic source systems' own storage.

**Why.** "Module" carried three meanings at once: Eneo's tenant feature modules (the municipality runs both
products, and an administrator will meet both admin pages), D20's code modules, and D21's integration
services. The third is the one an operator configures, a vendor builds and a data protection officer asks
about, so it needs a word of its own, and the one that is not shared with Eneo. "Integration" was the
obvious candidate and is the word the documentation uses for the activity, but Eneo also has
"Integrationer" (Confluence, SharePoint knowledge sources), and an integration is also the act, the
contract and the adapter, so the noun would stay ambiguous. "Source" (källa) fits the card and the admin's
question "vilka system är påkopplade?", but a derived connector (figures over other connectors) is not a
source, and "source system" is already the established phrase for the external system itself. "App" is
taken by D9 (MCP App views), "provider" by the adapter ports (D11), "plugin" and "extension" imply code
loaded into Clew's process, which D21 rules out. "Connector" is what the industry calls a packaged
integration with triggers and actions (Power Automate, Airbyte, Backstage), which is exactly a scan plus
capabilities; it is the word the startsidan use cases used (UC-MIKAEL-4, "the vendor ships a connector");
and in Swedish public-sector infrastructure systems *ansluter* to a platform (Ena, Säker digital
kommunikation), so "anslutning" and "anslutna system" need no explanation to a systemförvaltare.

The rename was cheap at this point and would have been expensive later: the D21 work was uncommitted,
`CLEW_MODULES` and the secret variables go away with D23 anyway, 15 files imported `@clew/modules`, 20
mentioned `/api/module`, and no third party had built against the protocol. The protocol version stays 1
because the shapes do not change; only names in documentation and the callback path do, and the hello
connector moved with them. Decided and carried out 2026-11-04 (session 14).

**Replaces.** The vocabulary of D21 and of `module-protocol.md`, `creating-an-external-module.md`,
`working-across-modules.md` and `modules/hello` (renamed, content otherwise unchanged; links in earlier
decisions point at the old names, as the log's history does). D20 is unchanged except that the registry
leaves `apps/server/src/modules/`. D3's three kinds (core, pass-through, derived) are unchanged and apply
to connectors.
