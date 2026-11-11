# D103 · The session that asked stands behind delegated work: an approved write, and a scan while the person is present

**Status:** provisional (2026-11-10; built and tested on the memory and Postgres adapters; accepted when the Approval loop of D101 has run signed in on the development stack with real exchanged tokens) · **Date:** 2026-11-10 · **Area:** identity, integrations

**Decision.** A connector that declares `delegation` acts as the person, with a token Clew obtains by RFC 8693
exchange from the person's signed-in session. Until now only a read made during a request could get that
token: a scan answered `authorization-required` and an approved write stopped at `needs-session`. Now the
session that asked may stand behind both, under these rules. Design and wording for integrators:
`docs/guides/authorization.md`, "Work the person's own session stands behind".

1. **What is kept is a reference, never a token.** An execution keeps the binding of the session that
   approved it (and, for a later read-back, of the session that asked to check it); a refresh request keeps
   the binding of the session that last asked. The Postgres adapters seal it. An exchanged token is still
   obtained per call, lives at most five minutes and is stored nowhere.
2. **The session must still be the person's.** Before every token the session is read again: it must be
   active, issued by the configured identity provider and client, and resolve to the same person as the
   work. Another person's session is never used. The current grant (unit, authorization version) is checked
   as before; the session adds a token, not authority. With no such session the old behaviour stands.
3. **A write needs no presence.** The approving session stands behind dispatch, replay and read-back of the
   write it approved for as long as it lives, because the approval is the person's own act. A later session
   of the same person may stand behind a read-back only, so that a lost write can be shown as what it is.
4. **A scan needs the person to be present.** The session stands behind a scan only while the person was
   active in it within `PRESENCE_MS`, fifteen minutes (`apps/server/src/threads/refresh-model.ts`), where
   activity is the sign-in or the page's own activity report. After that the scan answers
   `authorization-required`, the request is blocked, the connector is not called and existing cards are left
   alone; the person's next ask queues a fresh scan at once and shows no failure for the source in between.
   A scan nobody's session asked for (the nightly one) has no token, as before.
5. **The audit rows say which session stood behind a call** (`approving`, `checking`, or for a scan `true`
   or `idle`), never the binding.

**Why.** The first real integration (D101) calls Nextcloud as the person and holds no service credential,
which is the authorization model Clew should prefer: the source decides access. With the old rule that model
could show a list and nothing else, since a person reaches an action only from a card and cards come from
scans. Presence is required for scans because the refresh worker claims a completed request again every
minute and a session lives eight hours: without the bound, Clew would have read a source as the person every
minute for a working day with the page closed, which is more than D100's "work reaches a person through an
open page" promises and, against the real product, opens a session there on every call. Fifteen minutes is
about thirty times the page's activity-report interval.

**Not covered.** A write left at `needs-session` is not resumed when the person signs in again; it fails as
expired when next checked after a day. A job's watch step on such a connector still reads without a session.
Work in the background for a person who is away needs a credential the source issues, which is what the
second source in D101 is for.

**Replaces.** The limit recorded in `docs/architecture/overview.md` and the status matrix that scans and
durable writes never receive a delegated token. D45, D47, D75 and D86 are unchanged.
