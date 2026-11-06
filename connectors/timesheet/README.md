# timesheet: a generic time-reporting system, as a fixture connector

The time and scheduling system of a municipality as the development stack and the unit suite meet it: the day's roster
and the follower that marks a day as absence when the HR system reports a sick leave (D55). A kind of system, not a
product (D52). An independent Node service behind the connector protocol that imports nothing from the rest of the
repository (D21); the shape is [hr](../hr/README.md)'s, with the same files, store, switches and environment (`PORT`
is 4044, `FIXTURE_DB` defaults to `./timesheet.sqlite`, there is no feed and no scan).

A manager of the unit gets the area `staffing` with `timesheet.today`, the day's shifts as a table with who is marked
absent. `timesheet.followAbsence` follows `hr:absence` with one execute step, `timesheet.markAbsence` for the day of the
fact, which is deduplicated by Clew's operation id and read back through `timesheet.lookup`; `timesheet.unmarkAbsence`
undoes it. The roster is the same ward the HR fixture schedules, generated for three weeks around the seed day, because
a municipality's HR and time systems share the roster, not because the two services share code.

`tests/unit/timesheet-connector.test.ts` runs it over the protocol with the memory store.
