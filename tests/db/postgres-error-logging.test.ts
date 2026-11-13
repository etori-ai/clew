import { afterAll, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { Writable } from 'node:stream';
import { eq, like } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src';
import { createLogger, logPort, withoutValues } from '../../apps/server/src/logging';

/**
 * A statement that fails on PostgreSQL (D91). Drizzle's error names every value the statement was given in its message
 * and its stack, and the database's detail may repeat one; the server's log line and the error a request's span records
 * keep the statement, its SQLSTATE and its constraint, and none of the values. Run with `bun run test:db`.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const prefix = 'test-error-log-' + randomUUID();
afterAll(async () => {
  await database()
    .delete(schema.people)
    .where(like(schema.people.id, prefix + '%'));
});
const userName = `anna.lindqvist.${prefix}@kommun.example`,
  name = 'Anna Lindqvist',
  phone = '+46 70 123 45 67';
/** The values in a text, in any letters. */
const leaks = (text: string) => [userName, name, phone].filter(v => text.toLowerCase().includes(v.toLowerCase()));
function capture() {
  const lines: Array<Record<string, unknown>> = [];
  const sink = new Writable({
    write(chunk, _encoding, callback) {
      for (const line of String(chunk).split('\n').filter(Boolean)) lines.push(JSON.parse(line));
      callback();
    },
  });
  return { lines, log: logPort('scim', 'error', createLogger({}, sink)) };
}
const failure = (statement: Promise<unknown>) =>
  statement.then(
    () => {
      throw new Error('the statement was expected to fail');
    },
    (error: Error) => error,
  );
const person = (id: string, user: string) => ({
  id: prefix + id,
  organisationId: 'test',
  name,
  externalId: prefix + id,
  userName: user,
  email: userName,
  phoneNumbers: [{ value: phone, type: 'work' }],
});

test('a statement a unique index refuses gives a log line with the statement, SQLSTATE and constraint, and no value', async () => {
  await database().insert(schema.people).values(person('-anna', userName));
  // The same user name in other letters: refused by `auth_person_user_name`, and the detail repeats it.
  const error = await failure(database().insert(schema.people).values(person('-twin', userName.toUpperCase())));
  const cause = error.cause as { code?: string; constraint_name?: string; detail?: string };
  expect([cause.code, cause.constraint_name]).toEqual(['23505', 'auth_person_user_name']);
  expect(leaks(error.message + error.stack)).toEqual([userName, name, phone]);
  expect(leaks(String(cause.detail))).not.toEqual([]);

  const { lines, log } = capture();
  log('scim: the request failed unexpectedly', error);
  expect(leaks(JSON.stringify(lines))).toEqual([]);
  const logged = lines[0]!.error as Record<string, unknown>;
  expect(logged).toEqual({
    type: 'DrizzleQueryError',
    message: 'Failed query',
    query: expect.stringMatching(/^insert into "auth_person" \(.*"user_name".*\) values \(\$1, .*\$\d+.*\)/),
    stack: expect.stringMatching(/^DrizzleQueryError: Failed query\n\s+at /),
    cause: { code: '23505', constraint: 'auth_person_user_name' },
  });
  expect(logged.query).toBe((error as Error & { query: string }).query);

  const recorded = withoutValues(error);
  expect(recorded.message).toBe(`Failed query (SQLSTATE 23505): ${logged.query}`);
  expect(leaks(recorded.message + recorded.stack)).toEqual([]);
});

test('a value the database cannot store gives a log line with the statement and SQLSTATE, and no value', async () => {
  // PostgreSQL's text cannot hold a NUL character: a lookup by a user name with one in it fails as invalid data.
  const error = await failure(
    database()
      .select()
      .from(schema.people)
      .where(eq(schema.people.userName, name + '\u0000' + userName)),
  );
  expect((error.cause as { code?: string }).code).toBe('22021');
  expect(leaks(error.message + error.stack)).not.toEqual([]);

  const { lines, log } = capture();
  log('people: lookup failed', error);
  expect(leaks(JSON.stringify(lines))).toEqual([]);
  expect(lines[0]!.error).toEqual({
    type: 'DrizzleQueryError',
    message: 'Failed query',
    query: expect.stringMatching(/^select .* from "auth_person" where "auth_person"\."user_name" = \$1$/),
    stack: expect.stringMatching(/^DrizzleQueryError: Failed query\n\s+at /),
    cause: { code: '22021' },
  });
});
