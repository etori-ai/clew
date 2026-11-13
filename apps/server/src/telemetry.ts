import { trace } from '@opentelemetry/api';

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
/** The active trace's id, for the records that must find their trace later (a turn's message and audit row). */
export const currentTraceId = (): string | undefined => {
  const span = trace.getActiveSpan();
  return span?.spanContext().traceId;
};
