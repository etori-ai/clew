# Observability

How Clew records what it does: the structured log, the traces and metrics it exports, what a model turn leaves behind,
and how that relates to the audit trail. Decided in [D91](../decisions/D91-one-logger-opentelemetry-export-and-the-model-turn-in-the-audit-trail.md);
the options weighed are in the [review of 2026-11-09](../reviews/2026-11-09-logging-tracing-and-audit-options.md).

## Three records, three jobs

| Record | Where it lives | What it is for | Guarantee |
|---|---|---|---|
| Audit row | `audit` table, PostgreSQL | Evidence: who did what to which subject, and for a model turn what it cost and where its trace is | Written in the same transaction as the change; commits or rolls back with it |
| Log line | stdout, JSON, one per event | Operations: what the process did and why something failed, with the trace it belongs to | Best effort; a collector ships it |
| Span and metric | OTLP to the operator's backend | Timing and structure: a request, the model's steps and tool calls, a workflow and its Postgres writes, as one trace | Best effort; off until an endpoint is configured |

Audit is never moved into the logging pipeline. A log line or a span may be dropped; an audit row may not.

## The log

`apps/server/src/logging.ts` makes the one `pino` logger. Every line carries `service: clew`, `scope` (the folder or
subsystem: `assistant`, `connectors`, `dbos`, `http`, `otel`, `process`, `scheduler` …), `level`, `time`, `message`,
and, while a span is active, `trace_id` and `span_id`. An error travels as `error` with its type, message and stack.

A failed statement is written differently, because drizzle's error for it names every value the statement was given in
its message and stack (a person's name, e-mail, phone numbers or employments, or the words an administrator searched
for), and the database's detail may repeat one. The logger's `err` serializer, `serializeError`, finds that error, or
one that wraps it as its cause, and writes only its `type`, `message: "Failed query"`, the `query` with its column
names and placeholders, a `stack` of its frames under the header `<type>: Failed query`, and, when the database gave
them, `cause: { code, constraint }` with the SQLSTATE and the constraint. The frames are what follows the stack's own
header, cut off by the message's length, because a value can contain a newline, indentation and `at ` and read like a
frame. Any other error is written as pino's standard serializer writes it.

A sign-in through the identity provider that fails, and a logout from the identity provider that Clew refuses, write
one line with scope `auth`: `sign-in could not start` (`error`: the identity provider or the database cannot be
reached, or sign-in is not configured), `sign-in failed at the callback`, `back-channel logout refused` and
`front-channel logout refused` (`warn`). A sign-out from Clew that fails (`POST /api/auth/logout`) answers 403 or 503
and writes no line, and neither does a development sign-in that fails. Each of the four lines carries a `failure`
object, never the error: its `name`, its `code` (openid-client's, jose's, the network's, PostgreSQL's SQLSTATE or
Clew's own), the `oauthError` the provider answered with, the HTTP `status`, and the `message` of the error and of its
`cause`, at most 300 characters each. A code is printable ASCII, at most 64 characters. The message of a failed
statement and of PostgreSQL's own answer is left out, since either can quote a value, and so is the provider's
`error_description`, which can name the account; a failed claim check carries the ID token's claims in its cause, so
the cause itself is never written. A token refresh that the provider cannot answer logs `token refresh failed;
sessions are kept and delegation waits` (`warn`) with its `code` and `status`, at most once a minute, and a failed
token exchange logs `token exchange failed` (`error`) with its audience, at most once a minute per audience
([identity](identity.md#browser-to-clew)).

Use cases do not import the logger. Each folder declares a `log` port in its `model.ts` or `ports.ts`
(`(message: string, ...details: unknown[]) => void`), and `apps/server/src/composition/` binds it with
`logPort(scope, level)`. The unit suite passes its own function and asserts what was said.

DBOS's logging goes through `dbosLogger` in the same file: the engine's `info` lines are its own chatter and come out
at `debug`, warnings and errors keep their level, and its span attributes come along as `dbos` when tracing is on.
The engine writes a failed step's stack into its retry warning, the step's message on the step's span and the error
into its checkpoint, and none of these passes through the serializer. So `dbos/activities.ts` binds every live activity
through `valuelessFailures`, which throws a failed statement as `withoutValues` has it: an error of the same type whose
message is `Failed query (SQLSTATE <code>): <statement>` and whose stack keeps the frames. Any other error, and every
result, passes as it is.

| Variable | Default | Effect |
|---|---|---|
| `LOG_LEVEL` | `info` | The floor: `debug` shows every engine line and the probes |
| `LOG_FORMAT` | JSON | `pretty` renders for a terminal (development stack); production keeps JSON |

Nothing in `apps/server/src` writes to the console. A process-level handler logs unhandled rejections and ends the
process after an uncaught exception, once telemetry is flushed, so the container runtime restarts it.

## Traces and metrics

`main.ts` imports `apps/server/src/server-telemetry.ts` first so outgoing request instrumentation is in place before
application modules load. When `OTEL_EXPORTER_OTLP_ENDPOINT` is set, the server starts the OpenTelemetry Node SDK
with OTLP/HTTP exporters for traces and metrics. Shared modules and operator scripts can read telemetry settings
and the active trace ID through `telemetry.ts` without starting an exporter.

What is instrumented:

- **Requests**: `@hono/otel` opens one server span per request, named by method and route, and the
  `http.server.request.duration` metric. `requestSpans` in `apps/server/src/request-spans.ts` is mounted first, and
  only when export is on. The span's URL (`url.full`) is the path alone, because the sign-in callback's query carries
  the authorization code and a view's input may name a person, and in it the segment after `/api/entities/<kind>/` is
  written `:key` (`spanAddress`), because an address can carry a person's user name. The route template is on the span
  as `http.route`. An unexpected failure reaches `failure()` in `apps/server/src/context.ts`, which answers 503, logs
  `request failed` with scope `http`, the `method` and the `route` template, never the path, and replaces the error the
  span records with `withoutValues(error)`: a failed statement becomes an error of the same type that says the
  statement and its SQLSTATE, and any other error stays as it is.
- **Outgoing calls**: the undici instrumentation spans every `fetch`: connectors, the CalDAV server, the identity
  provider, the model endpoint.
- **The durable engine**: DBOS emits a span per workflow and step on the same tracer provider, in the `dbos.*`
  semantic-convention names, so a reminder's workflow and the writes under it are one trace with the request that
  started it.
- **Model turns**: the AI SDK's `@ai-sdk/otel` integration emits `invoke_agent assistant.turn`, `step`,
  `chat {model}` and `execute_tool {tool}` spans with the GenAI semantic conventions (`gen_ai.operation.name`,
  `gen_ai.provider.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`,
  `gen_ai.response.finish_reasons`) and the `gen_ai.client.inference.duration` metric.

The resource names the instance: `service.name=clew`, `service.version` from `CLEW_RELEASE`, `service.instance.id`
from `CLEW_EXECUTOR_ID` (the same name the durable engine uses), else the host name.

| Variable | Default | Effect |
|---|---|---|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | unset | Where traces and metrics go, OTLP/HTTP (`http://otel:4318` in the development stack) |
| `CLEW_MODEL_TELEMETRY_CONTENT` | unset | `true` puts prompts, completions and tool arguments on the model spans. Development stacks only |
| `CLEW_RELEASE`, `CLEW_EXECUTOR_ID` | unset, host name | The resource's version and instance id |

The standard `OTEL_*` variables of the OpenTelemetry SDK (headers, protocol, sampler) work as documented upstream.

### Content is off

The model spans record no prompt, completion or tool arguments unless an operator sets
`CLEW_MODEL_TELEMETRY_CONTENT=true`. The system prompt names the person and their unit, tool results carry staff
data, and the audit rule is metadata only; the same rule holds for telemetry. Token counts, durations, model and
provider names, finish reasons and tool names are always recorded.

### Known gaps

Clew's own Postgres queries run through `postgres.js`, which has no OpenTelemetry instrumentation, so they appear as
time inside the use case's span, not as spans of their own. Log lines are not exported over OTLP from the process; a
collector reading stdout is the expected shape. The GenAI semantic conventions are still at Development status and
their attribute names may change; Clew's own records use Clew's names.

Only drizzle's error for a failed statement loses its values: in the serializer, in the error a request's span
records, and in the engine's steps. Any other error keeps its message and stack, and a line that a library writes as
text, such as one of the durable engine's own, is passed on as it is. The tests are
`tests/unit/logging.test.ts`, `tests/db/postgres-error-logging.test.ts`, `apps/server/tests/request-spans.test.ts` and
`apps/server/tests/failed-step-runtime.test.ts` ([testing](testing.md)).

## What a model turn leaves behind

Beside the message and the audit row every turn writes, a turn the model answered records
`MessageMeta.modelCall` ([contracts](../../packages/contracts/src/index.ts), `ModelCallSchema`):

| Field | Meaning |
|---|---|
| `providerId` | The administered provider (D24) |
| `durationMs` | Wall time of the model call by the deps' clock |
| `steps` | Model steps in the turn (at most four) |
| `inputTokens`, `outputTokens` | The wire's usage report, when the provider gives one |
| `finishReason` | How the model stopped |
| `traceId` | The OpenTelemetry trace, when the turn was traced |

The same record is in the audit row's `details.modelCall`, so a reader goes from an answer in a conversation to its
audit row to its trace in the backend. When a configured model fails and the router answers (D8),
`MessageMeta.fallbackReason` and `details.fallbackReason` carry the wire's words, cut to 200 characters. Never the
text of the prompt or the answer: the message body holds the answer, nothing else does.

## Development stack

`.devcontainer/compose.yaml` runs `grafana/otel-lgtm` as the `otel` service: Grafana, Tempo (traces), Loki (logs) and
Prometheus (metrics) in one container, AGPL-3.0 as a separate process. The app exports to `http://otel:4318`;
Grafana is at `http://localhost:3023` (anonymous administrator, development only). Explore › Tempo shows a request's
trace with the model's steps and tool calls under it; Explore › Prometheus has `gen_ai_client_inference_duration` and
`http_server_request_duration`. Logs stay on the container's stdout in the development stack.

## Backends an operator may run

The application speaks OTLP and nothing else. Any backend that receives OTLP fits: Grafana Tempo, Loki and Mimir
(AGPL-3.0), SigNoz (MIT core), Jaeger (Apache-2.0, traces only), HyperDX (MIT), OpenObserve (AGPL-3.0), and Langfuse
(MIT core) through its OTLP endpoint for a prompt-and-tool view of the model spans. An OpenTelemetry Collector between
Clew and the backend is the usual place to fan out, to collect stdout as logs, and to set retention and redaction
policy. Choose with the [open-source rule](../../CLAUDE.md) in mind: Arize Phoenix (Elastic License 2.0) and Sentry
self-hosted (Functional Source License) are not OSI-licensed.
