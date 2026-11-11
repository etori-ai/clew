# Implementation status: operations and models

One page of [implementation status](../status.md). Each entry says what works in this checkout, what limits it or is still to do, and where the code and tests that show it are.

## Observability

**Works in this checkout.** One `pino` logger on stdout (JSON, `scope`, `trace_id` on every line) behind the folders' `log` ports; `console.*` is gone from the server. With `OTEL_EXPORTER_OTLP_ENDPOINT` set, OpenTelemetry traces and metrics leave over OTLP/HTTP: a server span per request (`@hono/otel`), every outgoing `fetch`, DBOS workflows and steps on the same tracer, and the AI SDK's `gen_ai.*` spans for every model turn with content recording off. A model turn's provider, duration, steps, tokens, finish reason and trace id are in `MessageMeta.modelCall` and the turn's audit row; a fallback to the router carries its reason. The development stack runs `grafana/otel-lgtm` (Grafana on 3023).

**Limits and pending work.** No spans for Clew's own `postgres.js` queries; no OTLP log export from the process (a collector reads stdout); no administration page over audit rows; Grafana in the stack is anonymous; the GenAI conventions are at Development status and may rename attributes.

**Evidence.** [D91](../../decisions/D91-one-logger-opentelemetry-export-and-the-model-turn-in-the-audit-trail.md), [architecture](../../architecture/observability.md), [logger](../../../apps/server/src/logging.ts), [telemetry](../../../apps/server/src/telemetry.ts), [tests](../../../tests/unit/conversation.test.ts), [log tests](../../../tests/unit/logging.test.ts)

## Operations

**Works in this checkout.** Authorized aggregate reliability endpoint/CLI, conservative upgrades, synthetic backup/restore rehearsal and a separate real-stack CI lane.

**Limits and pending work.** Production thresholds, coordinated engine-state/source recovery, screen-reader verification and selected-source gates remain open.

**Evidence.** [Runbook](../../maintainers/reliability-operations.md), [CI](../../../.github/workflows/reliability.yml)

## Model configuration

**Works in this checkout.** Providers/models are administered in the product and database.

**Limits and pending work.** Old `AI_*` setup instructions are obsolete. Model independence remains the product requirement.

**Evidence.** [Model use cases](../../../apps/server/src/assistant/usecases/models.ts), [D24](../../decisions/D24-model-endpoints-are-administered-in-the-product.md)
