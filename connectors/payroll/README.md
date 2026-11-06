# payroll: a generic payroll system, as a fixture connector

The payroll system of a municipality as the development stack and the unit suite meet it. Clew never writes here:
payroll reads the HR system itself, once a night, so Clew only watches that a sick report shows up and says so when it
does not (D55 item 8). A kind of system, not a product (D52). An independent Node service behind the connector protocol
that imports nothing from the rest of the repository (D21); the shape is [hr](../hr/README.md)'s without writes (`PORT`
is 4046; there is no store to speak of, no scan and no figure).

A manager of the unit gets the area `payroll` with `payroll.absences`, the sick reports the nightly import has brought
over, as a table. `payroll.absenceStatus` is the read a watch repeats: `registered` once the report for that person and
day has been imported, `pending` until then. `payroll.followAbsence` follows `hr:absence` with that one watch step,
within a day.

## The import

The service reads the HR fixture's feed, `GET /fixture/absences` behind `FIXTURE_FEED_KEY`, outside the Clew protocol:
one system reading another's records, the way payroll reads HR in a municipality. A report dated before today counts as
imported; a report made today stays `pending` until the window ends, however often Clew asks. When the feed is down the
reads answer 503 rather than inventing a status.

| Variable                | Meaning                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| `CLEW_CONNECTOR_SECRET` | The transport key shared with Clew, 16 characters or more. Required          |
| `CLEW_URL`              | The trusted Clew base URL, for the public keys that verify assertions. Required |
| `PORT`                  | Default 4046                                                                 |
| `HR_FEED_URL`           | The HR fixture's feed, `http://hr:4040/fixture/absences` in the stack. Required |
| `FIXTURE_FEED_KEY`      | The key the HR fixture expects on the feed                                   |
| `FIXTURE_TODAY`         | A fixed day (`YYYY-MM-DD`) instead of the clock                               |
| `FIXTURE_FAULT`         | `unavailable`, `slow` or `unauthorized`                                        |
| `FIXTURE_UNIT_MAP`      | JSON object, Clew unit id to the payroll system's unit id                      |

`tests/unit/payroll-connector.test.ts` runs it over the protocol with an in-process feed from the HR fixture.

Payroll keeps its own synthetic employee directory in `fixture.mjs`. Reads and watches use the verified actor’s mapped unit; unknown or out-of-unit person refs are refused. Feed rows outside that directory are never returned.
