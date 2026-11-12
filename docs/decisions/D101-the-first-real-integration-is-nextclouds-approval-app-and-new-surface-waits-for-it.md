# D101 · The first real integration is Nextcloud's Approval app, and new surface waits until its loop works

**Status:** provisional (product owner, 2026-11-10; the connector is built and the loop has run signed in as one person on the development stack, the remaining conditions are in the implementation status; amended 2026-11-11: the second build as an MCP server and the comparison of the two builds are dropped from the freeze; 2026-11-12: the product owner lifted the freeze on new surface of item 4, with the manual screen-reader pass still not made) · **Date:** 2026-11-10 · **Area:** product, integrations

**Decision.**

1. **The first source that was not written for Clew is the Approval app of the Nextcloud instance the
   development stack already runs** (`.devcontainer/calendar/`). No municipal system is within reach, so an
   open-source product with made-up data stands in. The loop: a person signs in through Keycloak, sees the
   files that wait for their approval, approves or rejects one through Clew's human decision endpoint, and
   gets a receipt read back from the product. The connector calls the product as the person, with the
   identity provider's token (`user_oidc`'s bearer validation), and holds no service credential for reads
   or writes.
2. **The loop is built both ways and compared**, as D100 item 2 asks: once as a connector on protocol 2,
   once as an MCP server that carries Clew's additions (kind, the read that lists pending work, the read
   that confirms a write, a view hint) as optional metadata, reached through the gateway in
   `apps/server/src/mcp/`. Both are adapters written here in front of the same API. Consuming a vendor's own
   unmodified MCP service is not tested by this source; it waits for the second.
3. **The second source is Frappe HR**, a manager approving a leave application. It is the one compared
   product whose free edition has per-user authorization with refresh tokens and a first-party MCP server,
   so it is where work in the background as the person, and a vendor's own MCP service, are tested. It is
   not started before the first loop is done.
4. **New surface is frozen until the first loop works.** No new owned domain, entity kind, view kind,
   presentation field, administration page or destination in the rail. Allowed: fixes, the schema-drawn
   default view (D100 item 3), and whatever the integration itself needs. The jobs interface, the talks
   record and vendor OAuth in the MCP lane are parked as they stand; the status matrix already says what
   each lacks. D95 is not changed by this, but no further owned domain is started while the freeze holds.
5. **The freeze lifts when all of this is true and written in `docs/reference/status.md`:** the loop works
   signed in on the development stack in both builds; two people see different pending files and a person
   whose access was taken away sees none; a rejected or lost write is shown as what it is; the flow has had
   one manual pass with a screen reader; and the comparison of the two builds is a review in
   `docs/reviews/`.

**Amended 2026-11-11 (product owner): the second build is dropped.** Item 2's MCP server was to be reached
through the gateway in `apps/server/src/mcp/`. That gateway left the code the same day with the external MCP
lane ([closing note](../reviews/2026-11-11-external-mcp-chat-services-exploration.md)), because external MCP
servers are not a use case now. Asked whether the freeze should still wait for the MCP build, the product
owner dropped it. The loop is built once, as a connector on protocol 2. Item 5 now reads: the freeze lifts
when the loop works signed in on the development stack; two people see different pending files and a person
whose access was taken away sees none; a rejected or lost write is shown as what it is; and the flow has had
one manual pass with a screen reader; all of it written in `docs/reference/status.md`. No comparison of two
builds is required. Item 3 keeps Frappe HR as the second source, for work in the background as the person;
the test of a vendor's own MCP service there is not planned while Clew has no MCP lane. Which wire format a
connector speaks stays an open question in `docs/vision.md` and in D100 item 2, without a date and without a
gate.

**Why.** The review `docs/reviews/2026-11-10-project-review-and-alternative-paths.md` found that the
fixtures, the protocol, the tests and the reviews form a closed loop, and that two earlier reviews had
already asked for one real integration while the project kept widening. The comparison
`docs/reviews/2026-11-10-an-open-source-product-as-the-first-real-integration.md` recommended Frappe HR
first; the product owner chose Nextcloud first because it is already in the stack and costs least to start.
What that order gives up is named there: files, not HR or finance work; no work in the background, since the
identity provider's token lives only as long as the session; and no vendor MCP service to compare with.
What it gains is that the cheapest source meets the known gap first: `docs/architecture/overview.md` records
that a durable write on a connector that declares delegation stops at `needs-session`, so the first approved
write through this connector is expected to stop there, and making a delegated write work for a signed-in
person is part of this work, not a surprise in it. A list that can only be read while the person is signed in
is also the plainest test of "live reads first" (path C of the review).

The freeze is the review's second recommendation. It has a written end so that it is a gate and not a mood.

**Replaces.** Nothing. It names the pilot that `docs/reference/reliability-acceptance.md` leaves open, for
the development stack only; a pilot with a municipality's system and real people is still open.
