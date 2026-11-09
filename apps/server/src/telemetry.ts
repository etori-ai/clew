import { hostname } from 'node:os';
import { diag, DiagLogLevel, trace, type DiagLogger } from '@opentelemetry/api';
import { NodeSDK } from '@opentelemetry/sdk-node';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { UndiciInstrumentation } from '@opentelemetry/instrumentation-undici';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
  ATTR_SERVICE_INSTANCE_ID,
} from '@opentelemetry/semantic-conventions/incubating';
import { registerTelemetry } from 'ai';
import { OpenTelemetry } from '@ai-sdk/otel';
import { logger } from './logging';

/**
 * OpenTelemetry (D91): traces and metrics over OTLP/HTTP to whatever the operator runs, on when
 * `OTEL_EXPORTER_OTLP_ENDPOINT` is set and off otherwise, so nothing leaves an installation that nobody configured.
 * Must be imported before anything that makes requests: the undici instrumentation patches `fetch` at load.
 *
 *  - Resource: `service.name=clew`, `service.version` from `CLEW_RELEASE`, `service.instance.id` from
 *    `CLEW_EXECUTOR_ID` (the same name the durable engine uses), else the host name.
 *  - Instrumentation: outgoing `fetch` (connectors, CalDAV, OIDC, the model endpoint); the Hono server span is
 *    added in main.ts; DBOS joins the global tracer provider in dbos/runtime.ts.
 *  - The AI SDK's integration emits `gen_ai.*` spans (`invoke_agent`, `step`, `chat`, `execute_tool`) and the
 *    `gen_ai.client.inference.duration` metric for every model turn. Prompt and completion content is recorded only
 *    when an operator sets `CLEW_MODEL_TELEMETRY_CONTENT=true`: the system prompt names the person and tool results
 *    carry staff data, and the audit rule is metadata only.
 */
export interface TelemetrySettings {
  /** Export is configured; spans and metrics leave the process. */
  enabled: boolean;
  endpoint?: string;
  /** Prompts, completions and tool arguments go on the model spans. Never by default. */
  recordModelContent: boolean;
}
const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
export const telemetry: TelemetrySettings = {
  enabled: !!endpoint,
  ...(endpoint ? { endpoint } : {}),
  recordModelContent: process.env.CLEW_MODEL_TELEMETRY_CONTENT === 'true',
};
const diagLogger: DiagLogger = {
  verbose: () => undefined,
  debug: () => undefined,
  info: () => undefined,
  warn: message => logger.warn({ scope: 'otel' }, String(message)),
  error: message => logger.error({ scope: 'otel' }, String(message)),
};
let sdk: NodeSDK | undefined;
if (telemetry.enabled) {
  diag.setLogger(diagLogger, DiagLogLevel.WARN);
  sdk = new NodeSDK({
    // The resource is named here; the host and process detectors add nothing an operator needs and warn on an empty host id.
    autoDetectResources: false,
    resource: resourceFromAttributes({
      [ATTR_SERVICE_NAME]: 'clew',
      ...(process.env.CLEW_RELEASE ? { [ATTR_SERVICE_VERSION]: process.env.CLEW_RELEASE } : {}),
      [ATTR_SERVICE_INSTANCE_ID]: process.env.CLEW_EXECUTOR_ID ?? hostname(),
    }),
    traceExporter: new OTLPTraceExporter(),
    metricReaders: [new PeriodicExportingMetricReader({ exporter: new OTLPMetricExporter() })],
    instrumentations: [new UndiciInstrumentation()],
  });
  sdk.start();
  registerTelemetry(new OpenTelemetry({ agentSpanName: 'functionId' }));
  logger.info({ scope: 'otel', endpoint, recordModelContent: telemetry.recordModelContent }, 'telemetry exporting');
}
/** The active trace's id, for the records that must find their trace later (a turn's message and audit row). */
export const currentTraceId = (): string | undefined => {
  const span = trace.getActiveSpan();
  return span?.spanContext().traceId;
};
/** Flush what is buffered; called on shutdown. */
export const shutdownTelemetry = () => sdk?.shutdown() ?? Promise.resolve();
