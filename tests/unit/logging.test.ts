import { describe, expect, test } from 'bun:test';
import { Writable } from 'node:stream';
import { createLogger, logPort, valuelessFailures, withoutValues } from '../../apps/server/src/logging';

/**
 * The `log` port (D91) is what composition binds to the logger: `(message, ...details)`. One JSON line per call with
 * its scope, level and service; an error among the details keeps its type, message and stack; other details travel
 * as data. The logger under test writes to memory, so the suite needs no stdout and no exporter.
 */
function capture() {
  const lines: Record<string, unknown>[] = [];
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).split('\n').filter(Boolean)) lines.push(JSON.parse(line));
      callback();
    },
  });
  const logger = createLogger({ level: 'debug' }, sink);
  return { lines, port: (scope: string, level: 'info' | 'error') => logPort(scope, level, logger) };
}

describe('the log port on the structured logger (D91)', () => {
  test('a message with no detail is one JSON line with its scope, level, service and time', () => {
    const { lines, port } = capture();
    port('connectors', 'info')('connector hr registered');
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      level: 'info',
      scope: 'connectors',
      service: 'clew',
      message: 'connector hr registered',
    });
    expect(typeof lines[0]!.time).toBe('string');
    // No span is active in the suite, so no trace ids are claimed.
    expect(lines[0]).not.toHaveProperty('trace_id');
  });
  test('an error detail keeps its type, message and stack; a plain detail travels as data', () => {
    const { lines, port } = capture();
    const failure = new Error('ECONNREFUSED');
    port('dbos', 'error')('durable heartbeat failed', failure);
    port('assistant', 'error')('assistant: model unavailable, falling back to the router:', 'timeout');
    expect(lines[0]).toMatchObject({
      level: 'error',
      scope: 'dbos',
      message: 'durable heartbeat failed',
      error: { type: 'Error', message: 'ECONNREFUSED' },
    });
    expect((lines[0]!.error as { stack: string }).stack).toContain('ECONNREFUSED');
    expect(lines[1]).toMatchObject({ scope: 'assistant', detail: 'timeout' });
  });
  test('several details are kept as a list', () => {
    const { lines, port } = capture();
    port('scheduler', 'info')('adopted', 2, 'executor-a');
    expect(lines[0]).toMatchObject({ details: [2, 'executor-a'] });
  });
});

/** The driver's error, as postgres.js builds it: its detail may repeat what the statement was given. */
class PostgresError extends Error {}
/** Drizzle's error for a failed statement, as drizzle-orm 0.45 builds it; the unit suite does not load the library. */
class DrizzleQueryError extends Error {
  constructor(
    public query: string,
    public params: unknown[],
    public override cause?: Error,
  ) {
    super(`Failed query: ${query}\nparams: ${params}`);
  }
}
const query = 'update "auth_person" set "name" = $1, "email" = $2, "phone_numbers" = $3 where "auth_person"."id" = $4';
const values = ['Anna Lindqvist', 'anna.lindqvist@kommun.example', '[{"value":"+46 70 123 45 67"}]', 'p-1'];
const failed = () =>
  new DrizzleQueryError(
    query,
    values,
    Object.assign(new PostgresError('duplicate key value violates unique constraint "auth_person_user_name"'), {
      code: '23505',
      constraint_name: 'auth_person_user_name',
      detail: 'Key (lower(user_name))=(anna.lindqvist@kommun.example) already exists.',
    }),
  );
const leaks = (text: string) => ['Anna Lindqvist', 'anna.lindqvist', '+46 70 123 45 67'].filter(v => text.includes(v));

describe('a failed statement in a log line or a span (D91)', () => {
  test('keeps its type, the statement, its stack frames and the SQLSTATE and constraint, and none of its values', () => {
    const { lines, port } = capture();
    const error = failed();
    expect(leaks(error.message + error.stack + JSON.stringify(error))).not.toEqual([]);
    port('scim', 'error')('scim: the request failed unexpectedly', error);
    expect(leaks(JSON.stringify(lines))).toEqual([]);
    expect(lines[0]!.error).toEqual({
      type: 'DrizzleQueryError',
      message: 'Failed query',
      query,
      stack: expect.stringMatching(/^DrizzleQueryError: Failed query\n\s+at /),
      cause: { code: '23505', constraint: 'auth_person_user_name' },
    });
  });
  test('a statement wrapped in another error is written the same way, since the wrapper may repeat its message', () => {
    const { lines, port } = capture();
    const inner = failed();
    port('threads', 'error')('scan failed', new Error('scan failed: ' + inner.message, { cause: inner }));
    expect(leaks(JSON.stringify(lines))).toEqual([]);
    expect(lines[0]!.error).toMatchObject({ type: 'DrizzleQueryError', message: 'Failed query', query });
  });
  test('the error a span records says the statement and its SQLSTATE, and any other error is left as it is', () => {
    const valueless = withoutValues(failed());
    expect(leaks(valueless.message + valueless.stack)).toEqual([]);
    expect(valueless.name).toBe('DrizzleQueryError');
    expect(valueless.message).toBe(`Failed query (SQLSTATE 23505): ${query}`);
    expect(valueless.stack).toMatch(/^DrizzleQueryError: Failed query \(SQLSTATE 23505\): .*\n\s+at /);
    const other = new Error('ECONNREFUSED');
    expect(withoutValues(other)).toBe(other);
  });
  test('an activity of the durable engine throws a failed statement without its values, and any other error or result as it is', async () => {
    const other = new Error('ECONNREFUSED');
    const activities = valuelessFailures({
      fails: async (): Promise<string> => {
        throw failed();
      },
      refuses: async (): Promise<string> => {
        throw other;
      },
      answers: async (id: string) => 'done:' + id,
    });
    const thrown = await activities.fails().catch((error: Error) => error);
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe(`Failed query (SQLSTATE 23505): ${query}`);
    expect(leaks((thrown as Error).message + (thrown as Error).stack)).toEqual([]);
    expect(await activities.refuses().catch((error: Error) => error)).toBe(other);
    expect(await activities.answers('j-1')).toBe('done:j-1');
  });
});
