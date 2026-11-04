# D15 · Postgres-backed scheduler in v1, Temporal later

**Status:** accepted · **Date:** 2026-11-03 · **Area:** platform

**Decision.** Scheduled work in v1 runs on one Postgres table, `job`, inside the BFF process: natural-key
job ids so scheduling is idempotent, jobs inserted in the same transaction as the mutation they belong
to, row-locked claims (`FOR UPDATE SKIP LOCKED`) so several server processes are safe, a 15-second poll.
Three job kinds exist: the nightly `scan-utvecklingssamtal` at 06:00 Europe/Stockholm, `undo-expiry`
per confirmation and `receipt-final` per receipt. There is no retry policy, no timeout, no signal and no
worker process. Temporal (MIT, self-hosted) replaces the scheduler when the push engine needs any of:
watches with conditions, multi-step obligations with waits, reconciliation of unknown outcomes with
backoff, or notification delivery beyond the page. Design and the migration path:
`docs/architecture/scheduled-work.md`.

**Why.** The first use case needs one nightly scan and two short timers. Temporal for that is a second
server, a second schema and a second operational dependency for every municipality that installs Clew.
Postgres is already there, and a row-locked job table gives the two properties that matter now:
idempotent scheduling in the mutation's transaction and no double execution across processes. The
capability layer keeps every effect idempotent and audited, so moving the three job kinds to workflows
later is bounded work and nothing in `packages/modules` changes.

**Replaces.** Nothing. Recorded in `HANDOVER.md` section 2 on 2026-11-03 ("Scheduled work") and in the
session-1 note "Temporal (not in v1)"; this file gives it a number.
