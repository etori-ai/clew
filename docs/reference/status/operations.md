# Implementation status: operations and models

One page of [implementation status](../status.md). Each entry says what works in this checkout, what limits it or is still to do, and where the code and tests that show it are.

## Observability

**Works in this checkout.** One `pino` logger on stdout (JSON, `scope`, `trace_id` on every line) behind the folders' `log` ports; `console.*` is gone from the server. With `OTEL_EXPORTER_OTLP_ENDPOINT` set, OpenTelemetry traces and metrics leave over OTLP/HTTP: a server span per request (`@hono/otel`), every outgoing `fetch`, DBOS workflows and steps on the same tracer, and the AI SDK's `gen_ai.*` spans for every model turn with content recording off. A model turn's provider, duration, steps, tokens, finish reason and trace id are in `MessageMeta.modelCall` and the turn's audit row; a fallback to the router carries its reason. A failed statement is logged as its type, the statement with its placeholders, its stack frames and the database's SQLSTATE and constraint, under "Failed query", never with the values it was given: in the log line, in the error the request's span records and in the durable engine's retry warning and step span. A request span records the path without its query and with `:key` in place of an entity's key (the segment after `/api/entities/<kind>/`), and a failed request's log line names its route template (`route`), not its path. The sign-in's log lines are in [Sign-in and sessions](identity.md#sign-in-and-sessions). The development stack runs `grafana/otel-lgtm` (Grafana on 3023).

**Limits and pending work.** No spans for Clew's own `postgres.js` queries; no OTLP log export from the process (a collector reads stdout); no administration page over audit rows; Grafana in the stack is anonymous; the GenAI conventions are at Development status and may rename attributes.

**Evidence.** [D91](../../decisions/D91-one-logger-opentelemetry-export-and-the-model-turn-in-the-audit-trail.md), [architecture](../../architecture/observability.md), [logger](../../../apps/server/src/logging.ts), [telemetry](../../../apps/server/src/server-telemetry.ts), [request spans](../../../apps/server/src/request-spans.ts), [tests](../../../tests/unit/conversation.test.ts), [log tests](../../../tests/unit/logging.test.ts), [failed statements on PostgreSQL](../../../tests/db/postgres-error-logging.test.ts), [span tests](../../../apps/server/tests/request-spans.test.ts), [a failed step on the engine](../../../apps/server/tests/failed-step-runtime.test.ts)

## Operations

**Works in this checkout.** Authorized aggregate reliability endpoint/CLI, conservative upgrades, synthetic backup/restore rehearsal and a separate real-stack CI lane. `/api/ready` answers 503 unless startup has finished and the database answers within a second. The server empties expired sign-in data itself every night ([Sign-in and sessions](identity.md#sign-in-and-sessions)). The operator's scripts for one person run in the app container, name the person by id and are audited with the actor `operator:cli`: `identity-rebind` moves or releases a sign-in binding, and `subject-erase`, `talks-erase`, `competence-erase` and, last, `person-erase` erase a leaver ([A leaver's record and its erasure](identity.md#a-leavers-record-and-its-erasure)).

**Limits and pending work.** Production thresholds, coordinated engine-state/source recovery, screen-reader verification and selected-source gates remain open.

**Evidence.** [Runbook](../../maintainers/reliability-operations.md), [operations guide](../../guides/provisioning-for-operations.md), [CI](../../../.github/workflows/reliability.yml)

## Model configuration

**Works in this checkout.** Providers/models are administered in the product and database. A model's audience that names a provisioned group offers the model to its members ([Users and identity](identity.md#users-and-identity)). `scripts/models-check.ts` checks a model end to end on the development stack: it refuses to run unless `CLEW_POC=true` or `--confirm` is given, switches its throwaway model on for its own throwaway unit only and checks that a person outside that unit is not offered it, and its clean-up deletes only the audit rows whose actor is its own run's person.

**Limits and pending work.** Old `AI_*` setup instructions are obsolete. Model independence remains the product requirement. A models-check run killed before its clean-up leaves the model, its provider, their audit rows and a person in organisation `check` behind.

**Evidence.** [Model use cases](../../../apps/server/src/assistant/usecases/models.ts), [D24](../../decisions/D24-model-endpoints-are-administered-in-the-product.md), [models check](../../../scripts/models-check.ts), [its refusal](../../../tests/unit/models-check.test.ts), [its clean-up on PostgreSQL](../../../tests/db/models-check.test.ts)
