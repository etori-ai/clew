# D82 · Sick-leave statistics come through an absence connector that reads only aggregates

**Status:** proposed 2026-11-06 (first written as D63, renumbered 2026-11-09 because `main` had taken D63 meanwhile), amended 2026-11-09 (the connector is the Qlik connector, see below); connector built with a fixture and a Qlik Engine adapter tested against a fake engine; not run against a real Qlik, the minimum group size and the Qlik object not yet agreed · **Date:** 2026-11-06 · **Area:** integrations

**Decision.** A manager's sick-leave figures come from `connectors/qlik`, the Qlik connector: a pass-through connector
in its own container behind the connector protocol (D21, D22), registered by an administrator (D23). When it is
registered and enabled, Clew shows what it reads from Qlik; sick leave is the first of it.

1. **The capabilities describe sick leave in Clew's words, not Qlik's fields (D1).** `qlik.sickLeaveByUnit` (the latest closed month per
   unit: total, short-term and long-term rate in percent, the same month a year earlier, the change, the headcount) and
   `qlik.sickLeaveTrend` (twelve months for one unit, newest first), both `read`, both `table` views (D38), a unit row
   opening its trend. The area `sick-leave` ("Sjukfrånvaro", icon `chart`) is for managers and answers a figure (item 7).
   Qlik's field names stay in configuration and `engine.mjs`; if sick leave later comes from another system, that
   system's connector answers the same shapes.
2. **Aggregates only.** No capability returns a person, a name or a period of absence. A per-employee view
   (`absence.employees` in the exploration) is out until HR and the data protection officer have agreed a legal basis,
   and then needs its own decision. The rehab-rule card stays with the HR system (the synthetic `hr` connector
   shows the pattern).
3. **A group below the minimum is held back in the connector**, before anything leaves it: a row whose headcount is
   below `QLIK_MIN_GROUP` (default 5) or unknown carries no rates, only a note, in the table and in every month of
   the trend. The headcount is therefore a required measure. The default is a placeholder: HR and the data protection
   officer set the value before the connector is switched on.
4. **Qlik is read through the Engine API (QIX) with one service identity, not as each person.** `engine.mjs` opens the
   app over a WebSocket, builds one session hypercube from configuration (`QLIK_SICK_LEAVE_CUBE`: the unit and month fields, the
   measures as expressions or master measures), pages it within Qlik's 10,000-cell limit and closes. The token is a
   bearer for a Qlik Sense Enterprise JWT virtual proxy or a Qlik Cloud OAuth token. The identity's section access must
   reach nothing but the aggregate (`docs/architecture/integration-paths.md`: aggregates over personal data are made
   inside the source's trust boundary, never by reading rows with a service account). The connector, not Qlik, then
   decides which units a person sees: `QLIK_UNIT_MAP` maps a Clew unit id to the source's unit names, a unit
   without an entry sees nothing, and the role is checked again on the verified assertion (D44).
5. **Nothing is stored.** The connector keeps the aggregates in memory for `QLIK_CACHE_SECONDS` (default 300) so a
   page of views opens the source once. It returns the app's last reload time as `updated`. It logs no request or
   response bodies and passes on no source error text.
6. **The model reads the aggregates** (`modelReads` left at `output`). They hold no person once the minimum group
   applies, and a manager asking "hur ser sjukfrånvaron ut?" is the question the box is for.
7. **Läget draws the figure (D54).** The area answers `label` "Sjukfrånvaro", `value` "5,3 %", a `comparison` with the
   month and last year ("oktober 2026 · 5,5 % i fjol, −0,2") and `opens: qlik.sickLeaveByUnit`, so the tile links to the
   table of units. A trend chart waits for D38's `series` kind; until then the trend is a table. The tone is `none`
   unless the operator sets `QLIK_SICK_LEAVE_WARN_ABOVE`, then `warn` at or above it and `ok` below: a threshold is the
   organisation's rule, not the connector's.

**Amended 2026-11-09.** First built as `connectors/absence`, a statistics connector whose contract did not name Qlik.
The product owner renamed it the Qlik connector: a person meets Qlik as one system, as they meet the HR system in
`connectors/hr`, and more of what Qlik holds can come through the same registration. The connector id is `qlik`, the
capabilities `qlik.sickLeaveByUnit` and `qlik.sickLeaveTrend`, the area `sick-leave`, the settings `QLIK_*` with
sick-leave-specific ones prefixed `QLIK_SICK_LEAVE_`, the engine adapter `engine.mjs` (`QLIK_ADAPTER=engine`). Items 1 to
7 hold as amended; a registration under the id `absence` is removed and the connector registered again as `qlik`.

**Why.** Two reviews of 2026-11-06: [manager statistics and reading Qlik directly](../reviews/2026-11-06-manager-statistics-from-qlik.md)
(the municipality runs Qlik Sense Enterprise on Windows; today's feed is an aggregated CSV through a file share) and
[sick leave from Qlik](../reviews/2026-11-06-sick-leave-from-qlik.md) (what Qlik offers, how each platform
authenticates). Weighed and left:

- **Reading Qlik as each person** (certificates with `X-Qlik-User` or a ticket on Windows, OAuth impersonation in Qlik
  Cloud), so that section access decides. It is the right shape for rows about people, which this decision does not
  allow. For an aggregate that is the same for every manager of a unit, it costs a highly privileged certificate or a
  Qlik user per manager, and Clew's delegated token is not given to figures (D26), so the figure could not be shown.
- **The file feed** (`kpidata_*` on a share, read by a derived connector). It keeps working and needs no Qlik identity,
  but it carries the share's fragility and gives a day-old snapshot whose transport nobody in Clew owns. It remains
  the fallback if no service identity can be agreed; the contract above does not change.
- **A nightly snapshot inside the connector** (`derived`). Only needed if live reads are too slow for the ten-second
  call timeout; it would keep health aggregates at rest outside Qlik and need its own impact assessment.
- **Qlik's MCP server and Reports API.** Metered and built for assistants, or files without a data feed. Clew's model
  uses the connector's reads instead.

**Cost.** Unverified until a real Qlik is reached: the unit and month field names and the master measures in the
Kommun app; whether the app holds closed months or only the current state (the existing review's history point);
whether the JWT virtual proxy accepts a WebSocket from Node with only a bearer, given Qlik's WebSocket CSRF rule since
November 2024; which licence the service user takes. Client certificates on port 4747 are not built: Node's built-in
WebSocket takes headers but no client certificate without another dependency. A Qlik Cloud OAuth token expires after
six hours, and `QLIK_TOKEN` is static; a renewing token source (the adapter takes a function) is not built.

**Replaces.** Nothing. The exploration's suggestion to impersonate each person is not taken for aggregates.
