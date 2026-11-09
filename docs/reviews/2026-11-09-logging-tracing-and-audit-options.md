# Logging, tracing and audit: what fits Clew (2026-11-09)

An investigation, not a decision. The product owner asked what to use for good logging and tracking of model
requests, for error logging, and for audit of the system in general, expecting something OpenTelemetry-compatible.
This review records what Clew has today, what the de facto libraries are, their licences, and a recommended shape.
A decision follows when the owner picks.

## 1. What Clew has today

- **Audit is already a system of record.** `audit` (actor, action, subject, details, created_at; "metadata only: no
  event titles or participant names") is written in the same transaction as every mutation (CLAUDE.md, D45/D47),
  `auth_audit` records sign-in actions, and every store port (`threads`, `connectors`, `assistant` models, `mcp`,
  calendar) exposes the audit rows of a subject. This is the right design for audit and must not move into a logging
  pipeline: logs are best effort, audit rows commit or roll back with the change.
- **Logging is `console.*` in 25 places** in `apps/server/src`, unstructured, with no request id, no correlation and
  no level discipline. Use cases already take a `log` port in `deps` (composition passes `console.log` or
  `console.error`), so a real logger slots in at `apps/server/src/composition/index.ts` without touching use cases.
- **Errors**: Hono `app.onError` maps known errors to Swedish JSON (`failure` in `main.ts`); unknown errors are
  `console.error`ed in two routes. No process-level `unhandledRejection`/`uncaughtException` handler, no error
  tracker.
- **Model calls** go through one function, `createGenerator` in `apps/server/src/assistant/model.ts`, on the Vercel
  AI SDK 7 (`ai` 7.0.162, `@ai-sdk/openai-compatible`). What a turn records today is `MessageMeta.model` (id and
  title) and `toolCalls` (capability and input). Not recorded anywhere: token usage, latency, finish reason, step
  count, provider id, the error behind a `ModelUnavailable` fallback (one log line), or anything that links the
  message to a trace.
- **DBOS Transact** (`@dbos-inc/dbos-sdk` 5.4.0) runs with `logLevel: 'warn'` to the console and no tracing. DBOS
  generates OpenTelemetry spans for every workflow and step when asked to.
- No observability service in `.devcontainer/compose.yaml`.

## 2. Libraries and licences (checked 2026-11-09 with `npm view … license` and the repositories' LICENSE files)

Application side, all OSI licences:

| Package | Version | Licence | Role |
| --- | --- | --- | --- |
| `@opentelemetry/api` | 1.10.0 | Apache-2.0 | the API every library emits on |
| `@opentelemetry/sdk-node` | 0.301.0 | Apache-2.0 | one SDK bootstrap: tracer, meter and logger providers |
| `@opentelemetry/exporter-trace-otlp-http`, `exporter-logs-otlp-http`, `exporter-metrics-otlp-http` | 0.301.0 | Apache-2.0 | OTLP over HTTP to whatever the operator runs |
| `@opentelemetry/instrumentation-pg` | 0.78.0 | Apache-2.0 | spans for every Postgres query (Drizzle sits on `pg`) |
| `@opentelemetry/instrumentation-undici` | 0.35.0 | Apache-2.0 | spans for outgoing `fetch`: connectors, CalDAV, OIDC, the model endpoint |
| `@hono/otel` | 1.3.0 | MIT | server span per request, with route and status |
| `@ai-sdk/otel` | 1.0.166 | Apache-2.0 | the AI SDK's OpenTelemetry integration: `gen_ai.*` spans and a duration metric |
| `@dbos-inc/otel` | 5.4.0 | MIT | DBOS's own OTLP exporter; not needed when DBOS joins the global provider |
| `pino` | 10.4.0 | MIT | structured JSON logging, the de facto Node logger |
| `pino-opentelemetry-transport` | 4.0.2 | MIT | ships pino records as OTLP logs (alternative: stdout, collected by the Collector) |
| `@opentelemetry/semantic-conventions` | 1.45.0 | Apache-2.0 | attribute names |

Backends (the operator's choice; the repository only speaks OTLP and may ship one in the development compose):

| Backend | Licence | Note |
| --- | --- | --- |
| OpenTelemetry Collector (contrib) | Apache-2.0 | the fan-out point: one OTLP in, any number of backends out |
| Grafana Tempo, Loki, Grafana (the `grafana/otel-lgtm` image bundles them with Prometheus) | AGPL-3.0 | separate processes, so allowed by CLAUDE.md; one container for traces, logs and metrics in development |
| Jaeger | Apache-2.0 | traces only, lightest |
| SigNoz | MIT core, `ee/` under its own licence | traces, logs and metrics in one UI on ClickHouse; reads `gen_ai.*` |
| HyperDX (ClickStack) | MIT | same shape as SigNoz |
| Langfuse | MIT core, `ee/` under its own licence; owned by ClickHouse Inc. since 2026 | the LLM-specific UI (prompt/trace/cost/eval); ingests OTLP at `/api/public/otel`, understands `gen_ai.*` and the AI SDK's spans; six services to self-host; its audit log and RBAC are enterprise features |
| OpenObserve | AGPL-3.0 | single binary, all three signals |
| Arize Phoenix | Elastic License 2.0 | **excluded**: not OSI, forbids offering it as a service |
| Sentry self-hosted | Functional Source License | **excluded** as a dependency; GlitchTip (MIT) speaks the Sentry protocol if an error tracker is ever wanted (`@sentry/node` is MIT) |

Not chosen on the application side: `@traceloop/node-server-sdk` (Apache-2.0, OpenLLMetry) and
`@arizeai/openinference-vercel` (Apache-2.0), both of which instrument the AI SDK from the outside; since AI SDK 7
ships its own `gen_ai.*` integration they add a second vocabulary for nothing. `@vercel/otel` is for Next.js.

## 3. The standards situation

- OTLP and the OpenTelemetry SDKs are stable. Traces, metrics and logs all travel on it.
- The **GenAI semantic conventions** (`gen_ai.operation.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`,
  `gen_ai.input.messages`, `execute_tool`, `invoke_agent` …) moved in June 2026 to
  `open-telemetry/semantic-conventions-genai` and are still at Development status, with no tagged release. Every
  backend above reads them, the AI SDK emits them, and attribute names may still be renamed. Pin versions and expect
  one rename pass; do not build Clew's own reporting on the raw attribute names.
- DBOS has `otelAttributeFormat: 'semconv'` (`dbos.operation.workflow_id` and friends) beside its legacy names.

## 4. Recommended shape

Three layers, one wire protocol, no vendor in the repository.

1. **One logger.** `pino` behind the existing `log` port, created once in composition, JSON to stdout, levels from
   `LOG_LEVEL`. A pino `mixin` adds `trace_id` and `span_id` from the active OpenTelemetry span, so a log line finds its
   trace. `console.*` goes; `DBOS.setConfig({ logger })` routes DBOS's own logging into the same logger. A
   process-level handler logs unhandled rejections and exits on uncaught exceptions. Stdout is collected by the
   Collector in production; in development `pino-pretty` (MIT) or the Collector's log view.
2. **One tracer, OTLP out.** `@opentelemetry/sdk-node` started before anything else in `main.ts` (a separate
   `telemetry.ts` imported first), exporting to `OTEL_EXPORTER_OTLP_ENDPOINT`, off when unset. Instrumentation: `pg`,
   `undici`, `@hono/otel`. DBOS joins the global provider with `tracingEnabled: true` and `otelAttributeFormat:
   'semconv'`, so a reminder's workflow, its steps and the Postgres writes are one trace. The resource carries
   `service.name=clew`, `service.version=CLEW_RELEASE` and `service.instance.id=CLEW_EXECUTOR_ID`.
3. **Model calls on the GenAI conventions.** `registerTelemetry(new OpenTelemetry())` from `@ai-sdk/otel` once at
   startup, so every `streamText` emits `invoke_agent`, `step`, `chat` and `execute_tool` spans with model, provider,
   tokens, finish reasons and the `gen_ai.client.inference.duration` metric. **Inputs and outputs are recorded by
   default and must be turned off** (`recordInputs: false`, `recordOutputs: false`): the system prompt names the
   person and their unit, tool results carry staff data, and Clew's own audit rule is metadata only. An operator may
   turn content recording on for a development stack, never by default. The person's identity on a span is the
   pseudonymous actor id Clew already uses in `audit.actor`, nothing else.

**Audit stays in Postgres and gets the model turn.** The `audit` table and the in-transaction rule are kept as they
are; telemetry is operational, audit is evidence. What is missing is the model side of the evidence: a turn's
`MessageMeta` (or a `model_call` row written in the turn's transaction) should record provider id, model id, input and
output tokens, duration, step count, finish reason, whether the router took over and why, and the `trace_id`, so an
administrator can go from an answer in a conversation to its audit row to its trace. That is a contract change in
`packages/contracts` and a use-case change with its scenario test, not a logging change. An administration read of
the audit rows (per person, per connector, per model) is a product question for a later decision; the ports already
return them.

**Development stack.** One extra service in `.devcontainer/compose.yaml`: either `grafana/otel-lgtm` (one container,
all three signals, AGPL as a separate process) or SigNoz. Langfuse is the better screen for prompts and tool calls
but is six services and only pays off once content recording is wanted in a lab; it can be fed later from the same
Collector without touching the application. Production operators point `OTEL_EXPORTER_OTLP_ENDPOINT` at whatever
they run.

**Privacy and retention** are the operator's and the backend's: no personal data in span attributes or log lines by
default (the same words as the audit table), retention set in the backend, and the development stack's data never
leaves the machine. No telemetry leaves an installation unless an operator configures an endpoint, which keeps the
"no phone-home" rule.

## 5. What a decision would have to settle

- The logger (pino) and the removal of `console.*` from `apps/server/src`, with `log` as the only port.
- OTel bootstrap, the three instrumentations, DBOS on the global provider, `@ai-sdk/otel` with content recording off.
- The model-turn record in `MessageMeta` or its own table, with the scenario test asserting it beside the audit row.
- The development backend (otel-lgtm or SigNoz) and the environment variables that switch export on.
- The purity rules: `telemetry.ts` is composition, not a use case; `bun run deps` and `bun run purity` must still pass
  with `@opentelemetry/api` allowed in adapters and composition only.
