# finance: a generic economy system, as a fixture connector

The economy system of a municipality as the development stack and the unit suite meet it: the invoices a manager
attests for their cost centre and the budget position with its largest driver. A kind of system, not a product (D52);
the suppliers and amounts are made up. An independent Node service behind the connector protocol that imports nothing
from the rest of the repository (D21); the shape is [hr](../hr/README.md)'s, with the same files, store, switches and
environment (`PORT` is 4041, `FIXTURE_DB` defaults to `./finance.sqlite`, there is no feed).

A manager whose unit has a cost centre (`unit-skola` → `KS-4410`, after `FIXTURE_UNIT_MAP`) gets the area `budget`:
the invoices as a table, the budget position as a detail, the figure "Förbrukat av ramen n %" with a bar towards the period's frame, opening the budget (D54), and one card from the scan,
"Attestera n fakturor", whose items are the invoices with the ones matching an order preselected. A manager of a unit
without a cost centre gets empty answers. One invoice always answers `unknown` on attest, so the unknown outcome and
its later read-back are exercised end to end; `finance.approve` and `finance.unapprove` are deduplicated by Clew's
operation id and read back through `finance.lookup` (D45). `finance.open` gives the link into the system.

`tests/unit/finance-connector.test.ts` runs it over the protocol with the memory store.
