import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { pino } from 'pino';
import type { AuthenticatedContext } from '@clew/contracts';
import { requestSpans, spanAddress } from '../src/request-spans';
import { failure, type Env } from '../src/context';
import { logger } from '../src/logging';
import { entityRoutes } from '../src/routes/entities';

/** Drizzle's error for a failed statement, as drizzle-orm 0.45 builds it, with the driver's error as its cause. */
class DrizzleQueryError extends Error {
  constructor(
    public query: string,
    public params: unknown[],
    public override cause?: Error,
  ) {
    super(`Failed query: ${query}\nparams: ${params}`);
  }
}
interface RecordedSpan {
  attributes: Record<string, unknown>;
  exceptions: Error[];
}
/** A tracer that keeps what each server span records, in place of the exporter (D91). */
function recordingTracer() {
  const spans: RecordedSpan[] = [];
  const tracer = {
    startActiveSpan(...args: unknown[]) {
      const options = args[1] as { attributes: Record<string, unknown> };
      const span = {
        attributes: { ...options.attributes },
        exceptions: [] as Error[],
        setAttribute(key: string, value: unknown) {
          this.attributes[key] = value;
          return this;
        },
        recordException(error: Error) {
          this.exceptions.push(error);
        },
        setStatus() {
          return this;
        },
        updateName() {
          return this;
        },
        end() {},
      };
      spans.push(span);
      return (args.at(-1) as (s: typeof span) => unknown)(span);
    },
  };
  return { spans, tracer: tracer as never };
}

test('a request span records the path alone, with an entity key as :key (D91)', () => {
  assert.equal(
    spanAddress('http://clew.test/api/entities/person/anna.lindqvist%40kommun.example'),
    '/api/entities/person/:key',
  );
  assert.equal(
    spanAddress('http://clew.test/api/entities/person/anna/section?capability=hr.absence'),
    '/api/entities/person/:key/section',
  );
  assert.equal(spanAddress('http://clew.test/api/entities/unit/u-12/actions'), '/api/entities/unit/:key/actions');
  assert.equal(spanAddress('http://clew.test/api/entities/person/anna/effect'), '/api/entities/person/:key/effect');
  assert.equal(spanAddress('http://clew.test/api/entities/person'), '/api/entities/person');
  assert.equal(spanAddress('http://clew.test/api/auth/callback?code=secret&state=s'), '/api/auth/callback');
  assert.equal(spanAddress('http://clew.test/api/staff'), '/api/staff');
});

test('a statement that fails on a person’s page or in a search leaves no user name and no value it was given on the request’s span or in its log line (D91)', async t => {
  const userName = 'anna.lindqvist@kommun.example',
    words = 'Anna Lindqvist';
  const lockTimeout = (value: string) =>
    new DrizzleQueryError(
      'select "id", "name" from "auth_person" where lower("user_name") = lower($1)',
      [value],
      Object.assign(new Error('canceling statement due to lock timeout'), { code: '55P03' }),
    );
  // What the server's logger writes, line by line, in place of stdout.
  const lines: Array<Record<string, unknown>> = [];
  const stream = (logger as unknown as Record<symbol, { write(line: string): boolean }>)[pino.symbols.streamSym]!;
  t.mock.method(stream, 'write', (line: string) => {
    lines.push(JSON.parse(line));
    return true;
  });
  const { spans, tracer } = recordingTracer();
  const persona = { id: 'p-1', name: 'Hillevi' } as AuthenticatedContext;
  const fail = async (): Promise<never> => {
    throw lockTimeout(userName);
  };
  // Mounted as main.ts mounts them: the span first, the entities with their own error mapping, a route without one.
  const app = new Hono<Env>();
  app.use(requestSpans({ tracer }));
  app.route(
    '/api/entities',
    entityRoutes({
      entities: { list: fail, rows: fail, detail: fail, section: fail },
      guard: async (c, next) => {
        c.set('session', { context: persona } as never);
        await next();
      },
    }),
  );
  app.post('/api/admin/users/search', async () => {
    throw lockTimeout(words);
  });
  app.onError((error, c) => failure(c, error));

  const page = await app.request('http://clew.test/api/entities/person/' + encodeURIComponent(userName));
  const search = await app.request('http://clew.test/api/admin/users/search', {
    method: 'POST',
    body: JSON.stringify({ query: words }),
  });
  assert.deepEqual([page.status, search.status], [503, 503]);
  const leaks = (value: unknown) =>
    [userName, encodeURIComponent(userName), words].filter(v => JSON.stringify(value).includes(v));
  assert.deepEqual(
    spans.map(s => [s.attributes['url.full'], s.attributes['http.route']]),
    [
      ['/api/entities/person/:key', '/api/entities/:kind/:key'],
      ['/api/admin/users/search', '/api/admin/users/search'],
    ],
  );
  for (const span of spans) {
    assert.equal(span.exceptions.length, 1);
    const [exception] = span.exceptions;
    assert.equal(exception!.name, 'DrizzleQueryError');
    assert.match(exception!.message, /^Failed query \(SQLSTATE 55P03\): select "id", "name" from "auth_person"/);
    assert.deepEqual(leaks([span.attributes, exception!.message, exception!.stack]), []);
  }
  const failures = lines.filter(l => l.message === 'request failed');
  assert.deepEqual(
    failures.map(l => [l.scope, l.method, l.route, 'path' in l]),
    [
      ['http', 'GET', '/api/entities/:kind/:key', false],
      ['http', 'POST', '/api/admin/users/search', false],
    ],
  );
  for (const line of failures) {
    assert.deepEqual(leaks(line), []);
    assert.deepEqual(line.error, {
      type: 'DrizzleQueryError',
      message: 'Failed query',
      query: 'select "id", "name" from "auth_person" where lower("user_name") = lower($1)',
      stack: (line.error as { stack: string }).stack,
      cause: { code: '55P03' },
    });
  }
});
