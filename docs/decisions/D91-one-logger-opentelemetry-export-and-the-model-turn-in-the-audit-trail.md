# D91 · One logger, OpenTelemetry export, and the model turn in the audit trail

**Status:** accepted, built 2026-11-09 on `main` · **Date:** 2026-11-09 · **Area:** platform

**Decision.** Clew observes itself through three layers, one wire protocol and no vendor in the repository.

1. **One logger.** `pino` (MIT) in `apps/server/src/logging.ts` is the only thing in the server that writes to the
   console: structured JSON lines on stdout, one record per event, with `service`, `scope`, `level`, `time`, and the
   active OpenTelemetry trace's `trace_id` and `span_id` on every line. Use cases keep the `log` port their folder
   declares (`(message, ...details) => void`); composition binds it with `logPort(scope, level)`, so a use case never
   knows the logger exists. DBOS's own logging is routed through `dbosLogger` into the same stream, its engine chatter
   at `debug`. `LOG_LEVEL` sets the floor (`info`), `LOG_FORMAT=pretty` renders for a terminal in development, with
   `pino-pretty` as a development dependency. `console.*` is gone from `apps/server/src`, and a process-level handler
   records unhandled rejections and ends the process on an uncaught exception after flushing telemetry.
2. **One tracer, OTLP out.** `apps/server/src/telemetry.ts` is the first import of `main.ts`. When
   `OTEL_EXPORTER_OTLP_ENDPOINT` is set it starts `@opentelemetry/sdk-node` with the OTLP/HTTP trace and metric
   exporters and the undici instrumentation (every outgoing `fetch`: connectors, CalDAV, OIDC, the model endpoint);
   `@hono/otel` adds one server span per request with the path alone as its URL (the sign-in callback's query carries
   the authorization code); DBOS joins the global tracer provider (`tracingEnabled`, `otelAttributeFormat: 'semconv'`)
   so a reminder's workflow, its steps and the Postgres writes under it are one trace. The resource is
   `service.name=clew`, `service.version` from `CLEW_RELEASE`, `service.instance.id` from `CLEW_EXECUTOR_ID` (the
   durable engine's name for the instance). Unset, nothing leaves the process: no endpoint is ever a default.
3. **Model turns on the GenAI conventions, content off.** `registerTelemetry(new OpenTelemetry())` from `@ai-sdk/otel`
   (Apache-2.0) at startup; every `streamText` in `assistant/model.ts` carries `telemetry.functionId =
   'assistant.turn'` and emits `invoke_agent`, `step`, `chat` and `execute_tool` spans with `gen_ai.operation.name`,
   `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`,
   `gen_ai.response.finish_reasons` and the `gen_ai.client.inference.duration` metric. **Inputs and outputs are not
   recorded** (`recordInputs`/`recordOutputs` false) unless an operator sets `CLEW_MODEL_TELEMETRY_CONTENT=true` for
   a stack of their own: the system prompt names the person and their unit, tool results carry staff data, and the
   audit rule is metadata only.

**Audit stays in Postgres and gets the model turn.** The `audit` table and the in-transaction rule are unchanged:
telemetry is operational and best effort, audit is evidence and commits with the change. What was missing was the
model side of the evidence. `MessageMeta.modelCall` (`packages/contracts`, `ModelCallSchema`) records the provider,
the wall time by the deps' clock, the step count, input and output tokens, the finish reason and the trace id the
`trace` port hands out; the same record goes into the turn's audit row (`conversation.asked` / `conversation.replied`),
so an administrator can go from an answer to its audit row to its trace. When a configured model fails and the router
answers (D8), `MessageMeta.fallbackReason` and the audit row carry the wire's words, cut to 200 characters. Never the
prompt, never the answer: `tests/unit/conversation.test.ts` asserts the record and that the audit row holds no text.

**Development stack.** `.devcontainer/compose.yaml` runs `grafana/otel-lgtm` (Grafana, Tempo, Loki, Prometheus in one
container, AGPL-3.0 as a separate process, which the open-source rule allows) as the `otel` service; the app exports to
`http://otel:4318` and Grafana is published on `127.0.0.1:3023` (anonymous admin, development only). Production
operators point `OTEL_EXPORTER_OTLP_ENDPOINT` at their own Collector or backend; a Collector collecting stdout is how
logs reach a backend, Clew does not ship them itself.

**Why.** The review [logging, tracing and audit options](../reviews/2026-11-09-logging-tracing-and-audit-options.md)
(2026-11-09) found `console.*` in 25 places, no correlation, no record of what a model turn cost or why a fallback
happened, and DBOS tracing switched off, while every library in the stack had a first-party OpenTelemetry hook: the AI
SDK 7 ships `@ai-sdk/otel`, DBOS joins a global provider, Hono has `@hono/otel`. OpenTelemetry is the one open protocol
every self-hostable backend reads (Grafana LGTM, SigNoz, Jaeger, HyperDX, Langfuse through its OTLP endpoint), so the
repository commits to OTLP and to nothing else. Not chosen: OpenLLMetry and OpenInference (a second vocabulary over the
AI SDK's own), `@opentelemetry/instrumentation-pg` (Clew's queries run through `postgres.js`, which has no
instrumentation; DBOS's `pg` queries are inside its own spans), a logs exporter in the process (stdout plus a Collector
is the standard shape), Arize Phoenix (Elastic License 2.0) and Sentry self-hosted (Functional Source License). Every
package added is Apache-2.0 or MIT (`npm view … license`, recorded in HANDOVER.md section 3). The GenAI semantic
conventions are at Development status in their own repository with no tagged release: Clew's own records
(`modelCall`) use Clew's names, and a rename in the conventions touches only the exporter side.

**Known gaps.** No span for Clew's own Postgres queries (`postgres.js`); no OTLP log export from the process; no
administration page over the audit rows (the ports return them); the development stack's Grafana is anonymous. The
`experimental_telemetry` option of the AI SDK is not used; `telemetry` is the current name.

**Replaces.** `DBOS_LOG_LEVEL` (D85's runtime configuration): the engine's level is the logger's. Nothing else; D45/D47
and the audit rule in CLAUDE.md stand.
