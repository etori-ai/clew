# D45 · Approved intent precedes source dispatch

**Status:** accepted, generic card path implemented; calendar migration pending · **Date:** 2026-11-05 · **Area:** platform

**Decision.** PostgreSQL owns the exact human-approved operation, encrypted input, authorization snapshot and immutable decision identity. Approval, audit, visible card state and dispatch outbox commit in one physical transaction. Temporal receives an execution ID and may dispatch only that saved intent. A duplicate decision with different input is rejected.

An execution distinguishes pending, running, succeeded, partial, failed and unknown. Losing a reply does not establish failure. Recovery reads back by the original operation key before considering replay. Only an explicit source deduplication contract, within its retention window, permits replay; conditional or manual sources retain uncertainty when read-back cannot establish an outcome. Current authority is checked before source access. Session-only delegation leaves a visible blocked execution.

Compensation is a separately approved execution linked to its original. The original receipt remains until compensation succeeds. Approval lifetime is 24 hours; source contracts can further restrict replay. Necessary input and result data are sealed with the installation master key. This is not a production retention policy; that belongs to the selected-source gate.

**Why.** [The review](../reviews/2026-11-05-architecture-against-vision.md) found source effects preceding durable local evidence. Leases alone cannot prevent duplicate remote effects. The ledger, stable source keys and explicit reconciliation preserve evidence across concurrent requests, response loss and restarts. The independent SQLite reference connector and PostgreSQL/Temporal runtime test prove this path with synthetic data.

**Replaces.** Narrows the earlier [scheduled-work design](../architecture/scheduled-work.md): a worker may execute an already approved bounded intent, while models and callbacks still cannot approve or execute discretionary writes. D20 and D25 remain. Generic card decisions use the new boundary; existing calendar writes and follow-ups remain pending migration and must not be described as covered.
