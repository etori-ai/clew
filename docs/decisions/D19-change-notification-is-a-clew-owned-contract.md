# D19 · Change notification is a Clew-owned contract: payload-free CloudEvents over HTTP

**Status:** proposed · **Date:** 2026-11-04 · **Area:** integrations

**Decision.** How a source tells Clew that something changed is a Clew-owned contract (D1), the one every
source is asked to fulfil first (D10) and the one adapters translate foreign notifications into (D4). The
contract:

- **Envelope.** CloudEvents 1.0, JSON, delivered over the HTTP binding to one Clew ingest route,
  `POST /api/events/<source>`. `source` names the installation and adapter (`sm:2281:KC`), `type` is a Clew
  name (`se.clew.errand.changed`, `se.clew.calendar.changed`), `subject` is the object ref, `id` is the
  source's own event id so a retry never mints a second event.
- **Payload-free.** `data` carries the ref, the source revision, the kind of change, the acting identity
  where the source already exposes it, and the observed time. Never a title, a body, a name or a
  participant. Consumers re-read under the user's own authorization.
- **Idempotent and ordered per key.** At-least-once delivery from the source; Clew de-duplicates on
  (`source`, `id`), drops revisions not newer than the last seen for the ref, and stores the event row in
  the Postgres event log with digests only.
- **Authenticated per source.** One registration per source installation with a shared secret; the
  request carries an id, a timestamp and an HMAC-SHA256 signature over timestamp and body as the Standard
  Webhooks specification lays them out, with a five-minute replay window. The event never carries a user
  credential and never grants one.
- **An event is a trigger, not a card.** An accepted event runs the owning module's `scan` for the persons
  the ref concerns, or signals a Temporal workflow waiting on that ref (D17). Cards are still drawn by
  deterministic scan code (D8).
- **Polling remains the fallback.** A source that cannot push gets the scan cadence. Push improves latency;
  it never carries correctness.
- **Foreign notifications are translated.** Microsoft Graph change notifications, SupportManagement's
  subscriber channel and any vendor webhook arrive at the adapter's own route and are mapped to the envelope
  there. Nothing foreign reaches the event log.

What this is not: a message broker between systems (NATS stays removed; this is one HTTP route and a
Postgres table), and not Clew's outbound events. Emitting the same envelope when a decision is taken, for
Eneo or for source systems, is a later decision.

**Why.** Change notification has been an open row in `integration-paths.md` since the startsidan event
fan-out POC (doc 33) proved the payload-free CloudEvents shape and its request-only guarantee. Three sources
now need it: errands (D18; SupportManagement has outbox, retry and channel dispatch but no webhook channel,
and one meeting this contract is a change any consumer benefits from), Microsoft 365 (Graph subscriptions
are webhooks regardless of what Clew does), and the person's own watches on Temporal, which without a
standard event are all polls. Standardising the contract once lets D10 say the same thing to every source
and keeps the model, the UI and the event log free of REST granularity. CloudEvents (CNCF) and Standard
Webhooks are open specifications, which the open-source rule requires.

**Replaces.** The "open" status of the Change notification row in `integration-paths.md`, which becomes
"proposed (D19)". Nothing else.
