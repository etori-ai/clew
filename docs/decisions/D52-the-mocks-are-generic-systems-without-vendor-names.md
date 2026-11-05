# D52 · The mocks are generic systems; nothing in the repository names a vendor

**Status:** accepted · **Date:** 2026-11-05 · **Area:** integrations

**Decision.** The bundled mock connectors in `packages/connectors/src/mock/` stand for kinds of municipal
systems, not products. Their ids are English role names and their `source` labels are the Swedish words a
person would use for the kind of system: `hr` is "Personalsystemet" (absences, leave, delegations, shifts),
`finance` is "Ekonomisystemet" (invoices, budget), `incidents` is "Avvikelsesystemet" (deviations and
incidents), and `kommunikation` stays as it is. Refs, topics and capability names follow the id
(`hr:emp:1001`, `finance.invoices`, `incidents.report`). Synthetic suppliers, people and units in
`mock/data.ts` and in the test fixtures are made up too; a real company, product or vendor name is not used
as example data anywhere in code, tests, scripts or the current documentation (`docs/architecture/`,
`docs/reference/`, `docs/guides/`, the generated protocol documents). Where a document must speak of a real
system a municipality runs, it names the kind of system ("an HR system without an API") and not the
product. Migration `0027_generic_mock_connectors` renames the ids in every table that carries them so an
existing installation keeps its cards, state and executions; audit rows are history and stay as written.

**Why.** Clew is open source and will be run by other municipalities and governments. A mock named after
one vendor's product reads as an endorsement, suggests Clew depends on that product, and makes a demo at
another municipality, which runs a different product for the same job, look foreign. The mocks were named
after the systems one municipality happened to run in 2026; that is a fact about one installation, not a
property of Clew. The product owner asked on 2026-11-05 that no specific provider be named. English ids
follow the rule that identifiers are English and `source` the rule that what a person reads is Swedish;
`kommunikation` and `telefonbok` predate the rule and are kept so links and tests stay stable.

**Replaces.** The vendor-named mocks (`heroma`, `raindance`, `treserva`) built in session 4 (HANDOVER.md,
2026-11-03). Decisions, reviews and session notes written before this one keep the names they used: they are
historical records and are not evidence of what the repository ships now.
