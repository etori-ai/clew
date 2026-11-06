# incidents: a generic deviation system, as a fixture connector

The deviation and incident system of a municipality as the development stack and the unit suite meet it: the open
deviations of a unit with what each waits on, a report anyone files, and its withdrawal. A kind of system, not a product
(D52); the incident is made up. An independent Node service behind the connector protocol that imports nothing from the
rest of the repository (D21); the shape is [hr](../hr/README.md)'s, with the same files, store, switches and environment
(`PORT` is 4042, `FIXTURE_DB` defaults to `./incidents.sqlite`, there is no feed).

A manager of the unit gets the area `work-environment`: the deviations as a list, the figure "n öppna avvikelser", and
a card per deviation waiting on someone (the safety representative) and per report filed through Clew. An employee the
system knows by person id sees their own reports and the deviations they reported, followed under the HR system's area
`my-shift` as before the port. `incidents.report` and `incidents.withdraw` are deduplicated by Clew's operation id and
read back through `incidents.lookup` (D45); a report's ref is `incidents:dev:<year>-<n>`.

`tests/unit/incidents-connector.test.ts` runs it over the protocol with the memory store.
