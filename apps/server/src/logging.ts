import { pino, type DestinationStream, type Logger } from 'pino';
import { trace } from '@opentelemetry/api';
import type { DLogger } from '@dbos-inc/dbos-sdk';

/**
 * The one logger (D91): structured JSON lines on stdout, one record per event, the active trace's ids on every line so
 * a log line finds its trace. Composition hands use cases a `log` port made by `logPort`; nothing else in the server
 * writes to the console. `LOG_LEVEL` sets the floor (`info` by default; `debug` shows the engine's chatter).
 * `LOG_FORMAT=pretty` renders for a terminal in development; production keeps JSON for the collector.
 */
export interface LoggerOptions {
  level?: string;
  pretty?: boolean;
}
export function createLogger(options: LoggerOptions = {}, destination?: DestinationStream): Logger {
  const config = {
    level: options.level ?? 'info',
    base: { service: 'clew' },
    messageKey: 'message',
    errorKey: 'error',
    formatters: { level: (label: string) => ({ level: label }) },
    timestamp: pino.stdTimeFunctions.isoTime,
    mixin() {
      const span = trace.getActiveSpan();
      if (!span) return {};
      const { traceId, spanId } = span.spanContext();
      return { trace_id: traceId, span_id: spanId };
    },
  };
  if (destination) return pino(config, destination);
  // The transport is a worker thread; `pino-pretty` is a development dependency, absent from a production image.
  return pino(
    options.pretty
      ? { ...config, transport: { target: 'pino-pretty', options: { colorize: true, messageKey: 'message' } } }
      : config,
  );
}
export const logger: Logger = createLogger({
  ...(process.env.LOG_LEVEL ? { level: process.env.LOG_LEVEL } : {}),
  pretty: process.env.LOG_FORMAT === 'pretty',
});
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
/** What a use case says about a detail: an error keeps its stack, one other detail is `detail`, several are `details`. */
export const describeDetails = (details: unknown[]) => {
  const error = details.find(d => d instanceof Error);
  const rest = details.filter(d => !(d instanceof Error));
  return {
    ...(error ? { error } : {}),
    ...(rest.length === 1 ? { detail: rest[0] } : rest.length ? { details: rest } : {}),
  };
};
/**
 * The `log` port a use case folder declares (`(message, ...details) => void`), bound to one level and the folder's
 * name, so a line says where it came from without the use case knowing about the logger.
 */
export const logPort =
  (scope: string, level: LogLevel = 'info', target: Logger = logger) =>
  (message: string, ...details: unknown[]) =>
    target[level]({ scope, ...describeDetails(details) }, message);
/**
 * DBOS's own logging routed into the same stream. Its `info` lines are engine chatter (launches, recoveries) and go
 * out at `debug`; warnings and errors keep their level. The engine's span attributes, when tracing is on, come along as
 * `dbos`.
 */
export const dbosLogger: DLogger = {
  debug: (entry, metadata) => logger.debug({ scope: 'dbos', dbos: metadata?.span?.attributes }, String(entry)),
  info: (entry, metadata) => logger.debug({ scope: 'dbos', dbos: metadata?.span?.attributes }, String(entry)),
  warn: (entry, metadata) => logger.warn({ scope: 'dbos', dbos: metadata?.span?.attributes }, String(entry)),
  error: (entry, metadata) =>
    logger.error(
      {
        scope: 'dbos',
        dbos: metadata?.span?.attributes,
        error: metadata?.error instanceof Error ? metadata.error : undefined,
        stack: metadata?.stack,
      },
      String(entry),
    ),
};
