import { pino, type DestinationStream, type Logger } from 'pino';
import { trace } from '@opentelemetry/api';
import type { DLogger } from '@dbos-inc/dbos-sdk';

/** Drizzle's error for a statement that failed: the statement as `query` and what it was given as `params`. */
type FailedStatement = Error & { query: string; params: unknown[] };
const isFailedStatement = (value: unknown): value is FailedStatement =>
  value instanceof Error &&
  typeof (value as Partial<FailedStatement>).query === 'string' &&
  Array.isArray((value as Partial<FailedStatement>).params);
/** The failed statement an error is, or wraps as its cause: a wrapper may repeat the statement's message in its own. */
function failedStatement(error: unknown): FailedStatement | undefined {
  for (let e = error, depth = 0; e instanceof Error && depth < 10; e = e.cause, depth++)
    if (isFailedStatement(e)) return e;
  return undefined;
}
/**
 * The stack frames of a failed statement: what follows the stack's header, `<name>: <message>`. The header is cut off
 * by the message's length, not told apart from the frames line by line, because a value in the message may read like a
 * frame (a newline, indentation and `at `). A stack that does not begin with its message gives no frames.
 */
function framesOf(statement: FailedStatement) {
  const stack = statement.stack ?? '',
    header = `: ${statement.message}`,
    at = statement.message ? stack.indexOf(header) : -1;
  if (at < 0 || stack.slice(0, at).includes('\n')) return [];
  return stack
    .slice(at + header.length)
    .split('\n')
    .filter(line => /^\s+at /.test(line));
}
/**
 * What a failed statement may say outside the process: its type, the statement as written (column names and
 * placeholders), its stack frames, and the database's SQLSTATE and constraint. Its message and stack name every value it
 * was given, as `params` does, and the database's detail may repeat them: a person's name, e-mail, phone numbers or
 * employments, or the words an administrator searched for.
 */
function statementWithoutValues(statement: FailedStatement) {
  const cause = statement.cause as { code?: unknown; constraint_name?: unknown } | undefined;
  return {
    type: statement.constructor.name,
    query: statement.query,
    frames: framesOf(statement),
    code: typeof cause?.code === 'string' ? cause.code : undefined,
    constraint: typeof cause?.constraint_name === 'string' ? cause.constraint_name : undefined,
  };
}
/**
 * The logger's `err` serializer, which pino applies to the `error` key: a failed statement as `statementWithoutValues`
 * has it, under its type with the message "Failed query"; any other error as pino's standard serializer writes it.
 */
export function serializeError(error: unknown) {
  const statement = failedStatement(error);
  if (!statement) return pino.stdSerializers.err(error as Error);
  const { type, query, frames, code, constraint } = statementWithoutValues(statement);
  return {
    type,
    message: 'Failed query',
    query,
    stack: [`${type}: Failed query`, ...frames].join('\n'),
    ...(code || constraint ? { cause: { code, constraint } } : {}),
  };
}
/**
 * An error as a request's span records it when export is on (D91): a failed statement becomes an error of the same
 * name that says the statement and its SQLSTATE and keeps its stack frames; any other error is returned as it is.
 */
export function withoutValues(error: Error): Error {
  const statement = failedStatement(error);
  if (!statement) return error;
  const { type, query, frames, code } = statementWithoutValues(statement);
  const valueless = new Error(`Failed query${code ? ` (SQLSTATE ${code})` : ''}: ${query}`);
  valueless.name = type;
  valueless.stack = [`${type}: ${valueless.message}`, ...frames].join('\n');
  return valueless;
}
/**
 * The durable engine's activities, each throwing a failed statement as `withoutValues` has it (D91): DBOS writes a
 * failed step's stack into its retry warning, its message on the step's span and the error into its checkpoint, none
 * of which passes through the logger's serializer. Any other error, and every result, passes as it is.
 */
export function valuelessFailures<T extends object>(activities: T): T {
  const wrapped: Record<string, unknown> = {};
  for (const [name, run] of Object.entries(activities))
    wrapped[name] =
      typeof run === 'function'
        ? async (...args: unknown[]) => {
            try {
              return await run(...args);
            } catch (error) {
              throw error instanceof Error ? withoutValues(error) : error;
            }
          }
        : run;
  return wrapped as T;
}
/**
 * The one logger (D91): structured JSON lines on stdout, one record per event, the active trace's ids on every line so
 * a log line finds its trace. Composition hands use cases a `log` port made by `logPort`; nothing else in the server
 * writes to the console. `LOG_LEVEL` sets the floor (`info` by default; `debug` shows the engine's chatter).
 * `LOG_FORMAT=pretty` renders for a terminal in development; production keeps JSON for the collector. An error is
 * written by `serializeError`, so a failed statement leaves no value it was given in the line.
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
    serializers: { err: serializeError },
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
