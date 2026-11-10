# D100 · The vision is narrowed to what Clew can keep today: the open page, adapters as the norm, a closed view catalogue

**Status:** accepted (product owner, 2026-11-10); the schema-drawn default view is not built · **Date:** 2026-11-10 · **Area:** product, integrations, ui

**Decision.** Four places where `docs/vision.md` promised more than the product does, or said the opposite of
what it does, are settled. The vision page carries the new wording.

1. **The promise is to the person who opens Clew.** Work reaches a person through an open page, at a desk or
   on a phone. Delivery outside the browser (a push notification, e-mail, an installed app) is deferred and
   is listed among the vision's open questions. Until it exists, the personas on a shift
   (`docs/personas.md`) test that every page works on a phone; they are not a claim that Clew reaches them
   there. No delivery channel is to be built before this is reopened.
2. **An adapter is the normal way a system meets Clew's contract.** D1 stands: Clew owns what the model and
   the interface see. D10's fixed order (ask the system's owner to implement Clew's API first, write an
   adapter only when they will not) is dropped. An adapter written by the Clew team, a municipality or an
   integrator is the expected case; a vendor that implements the contract itself is welcome. A vendor's
   standard MCP service is accepted as it is in the chat lane (D81). Whether a connector speaks Clew's own
   protocol (D21) or MCP with Clew's additions as optional metadata is not decided here: it is decided from
   one adapter, to a product that was not written for Clew, built both ways and compared.
3. **The view catalogue is closed, and a read without a view is drawn from its output schema.** The view
   kinds and presentation fields in `packages/contracts` and `packages/connectors/src/views.ts` are the
   catalogue as it stands on this date. A new kind or field needs two sources that were not written for
   Clew to need it, and a numbered decision; a fixture under `connectors/` does not count as such a source.
   A `read` capability that declares no view is to be drawn by Clew from its output schema: a table for an
   array of objects, a record for an object, with labels from the schema's titles. Today such a read is not
   drawn at all (the browser gets no `view` from `GET /api/cap/:name`); the default is the next piece of
   view work and the only one allowed until a source asks for more.
4. **The shared header is not authorship.** "Not an intranet" means Clew authors and hosts no editorial
   content. Drawing the installation's header from a connector (D88) stays inside that line.

"A source not written for Clew" in items 2 and 3 means a product with its own data model, API and access
rules, built by someone else. An open-source product run locally with synthetic data counts; the fixtures in
this repository do not.

**Why.** The review `docs/reviews/2026-11-10-project-review-and-alternative-paths.md` found the vision
contradicting the product in these places. For delivery, the honest choices were to build a channel or to
say that there is none; the product owner chose to say so and defer. For the contract, no vendor will
implement a protocol that one installation uses, while vendors in this field do publish MCP services
(`docs/reviews/2026-11-08-mcp-services-and-provider-compatibility.md`), so the public-standard stance of D10
described a situation that does not exist; the wire format is left open because nothing has yet been
integrated that could show which one costs less. For views, nine kinds and a dozen presentation fields grew
in a week from fixtures the same team wrote, which is how a page language grows without anyone deciding to
build one; a default drawn from the schema lets a new source be useful before it has declared anything, and
the two-source rule makes the next addition answer to something outside the repository.

Owned domains (D95, D96) were part of the same question and are **not** settled here. The product owner's
answer was that no real system is within reach and that an open-source product should stand in as the first
real integration; D95 stays as recorded until that exists.

**Replaces.** D10's order of work (its status is amended). Vision principle 2 and two bullets of "What Clew
is not" are reworded. D1, D4, D21, D38, D81 and D88 are unchanged.
