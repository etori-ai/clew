# D46 · Browser updates use committed revisions

**Status:** accepted, browser invalidation implemented; durable attention pending · **Date:** 2026-11-05 · **Area:** platform

**Decision.** An authenticated server-sent event stream carries only per-person content and authorization revisions. PostgreSQL updates those revisions with business mutations; deferred triggers acquire revision locks at commit to avoid reversing business row lock order. Every server reads the same counters. No source names or payloads travel in the channel.

TanStack Query remains the read cache. Events and reconnects invalidate reads. Authorization changes also clear retained query and component state, then recheck the session. Hidden tabs suspend the stream and reconnect on visibility/network recovery. Explicit session denial ends the session; transient connection or database failure allows reconnection. The browser does not poll.

**Why.** A durable server mutation must reach an already-open page. Persisted revisions tolerate missed events and multiple server instances without treating an in-process event bus as authoritative. This preserves D33's cache architecture.

**Replaces.** Extends [D33](D33-browser-reads-go-through-one-query-cache.md). It does not implement D19's proposed connector CloudEvents endpoint, durable attention admission, timer generations, or a guaranteed delivery deadline. Those remain explicit work in the [implementation plan](../architecture/reliability-and-authorization-plan.md).
