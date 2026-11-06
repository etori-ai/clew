# communication: a generic internal communication system, as a fixture connector

The municipality's notices and the person's read receipts ("Viktigt nu"), as the development stack and the unit suite
meet them. A kind of system, not a product (D52); the notices are made up. An independent Node service behind the
connector protocol that imports nothing from the rest of the repository (D21); the shape is [hr](../hr/README.md)'s,
with the same files, store, switches and environment (`PORT` is 4043, `FIXTURE_DB` defaults to
`./communication.sqlite`, there is no feed).

Everyone gets the area `important-now`: the notices as a list that says which still need the person's receipt, and one
card per notice that requires a receipt the person has not given. Its figure (D54) is what was published today, or
the sentence "Inget nytt sedan i går." `communication.acknowledge` registers the receipt for
the verified person only (after `FIXTURE_PERSON_MAP`), deduplicated by Clew's operation id and read back through
`communication.lookup` (D45). Receipts are the one record this system keeps about a person.

`tests/unit/communication-connector.test.ts` runs it over the protocol with the memory store.
