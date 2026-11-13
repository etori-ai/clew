import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';
import type { AboutRead } from '../../packages/connectors/src/index';
import type { AuthenticatedContext } from '../../packages/contracts/src/index';
import { database, schema } from '../../packages/db/src/index';
import { postgresProvisionStore } from '../../apps/server/src/modules/people/adapters/postgres';
import { staffUsecases } from '../../apps/server/src/modules/people/usecases';
import { entityUsecases } from '../../apps/server/src/modules/entities/usecases';
import { entityActionUsecases } from '../../apps/server/src/modules/entities/actions';
import { entityRoutes } from '../../apps/server/src/routes/entities';

/**
 * A person's address on PostgreSQL (D97, D116, K3 of the 2026-11-12 review): the entities routes over the people module's
 * real directory. A person is opened by their id; a user name is no address; and a key with a NUL names nobody, so every
 * person route answers its 404 instead of the 503 PostgreSQL's refusal to compare a NUL used to give. Run with
 * `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');

const run = 'test-keys-' + randomUUID().slice(0, 8);
const organisationId = run;
const reader = `${run}-reader`,
  colleague = `${run}-colleague`;
const colleagueName = `Kollega.${run}`;
beforeAll(async () => {
  await database()
    .insert(schema.people)
    .values([
      { id: reader, organisationId, name: 'Hillevi Berg', userName: `hillevi.${run}` },
      { id: colleague, organisationId, name: 'Anna Lindqvist', userName: colleagueName },
    ]);
});
afterAll(async () => {
  await database()
    .delete(schema.people)
    .where(inArray(schema.people.id, [reader, colleague]));
});

const persona = {
  id: reader,
  name: 'Hillevi Berg',
  unitId: '',
  unitLabel: '',
  role: 'employee',
  organisationId,
  principal: { id: 'person:' + reader, kind: 'person' },
  capabilities: [],
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v1' }),
} as unknown as AuthenticatedContext;
/** A read about a person the reader may call, so that a section's address reaches the key before anything is asked. */
const absence = { name: 'hr.absence', title: 'Frånvaro' } as AboutRead;
const asked: unknown[] = [];

function stack() {
  const entities = entityUsecases({
    directory: staffUsecases({ store: postgresProvisionStore() }),
    sources: { reads: async () => [absence], actions: async () => [] },
    read: async (_p, capability, input) => {
      asked.push([capability, input]);
      return { rows: [] };
    },
    cards: async () => [],
  });
  const actions = entityActionUsecases({
    open: entities.detail,
    start: async () => {
      throw new Error('nothing may start');
    },
    effect: async () => {
      throw new Error('nothing may be read');
    },
    clock: () => new Date('2026-11-12T08:00:00.000Z'),
  });
  const routes = entityRoutes({
    entities,
    actions,
    guard: async (c, next) => {
      c.set('session', { context: persona } as never);
      await next();
    },
  });
  const request = (path: string, body?: unknown) =>
    routes.request(
      'http://clew.test' + path,
      body === undefined
        ? {}
        : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) },
    );
  return { request };
}

describe("a person's address on PostgreSQL (D116, K3)", () => {
  test('the id opens the person, who is asked about by their user name; the user name is no address', async () => {
    const { request } = stack();
    const opened = await request('/person/' + colleague);
    expect(opened.status).toBe(200);
    expect(await opened.json()).toMatchObject({
      entity: { kind: 'person', key: colleague, sourceKey: colleagueName, id: colleague },
      relation: 'colleague',
    });
    for (const key of [colleagueName, colleagueName.toLowerCase()])
      expect([key, (await request('/person/' + encodeURIComponent(key))).status]).toEqual([key, 404]);
  });
  test('a key with a NUL is the 404 of an address nobody has, on the detail, section, action and effect routes', async () => {
    const { request } = stack();
    asked.length = 0;
    for (const key of [colleague + '%00', '%00' + colleague, '%00', colleagueName + '%00']) {
      for (const [path, body] of [
        [`/person/${key}`, undefined],
        [`/person/${key}/section?capability=hr.absence`, undefined],
        [`/person/${key}/actions`, { capability: 'hr.flag' }],
        [`/person/${key}/effect`, { capability: 'hr.flag' }],
        [`/unit/${key}`, undefined],
      ] as const) {
        const answer = await request(path, body);
        expect([path, answer.status]).toEqual([path, 404]);
        expect(await answer.json()).toEqual({ error: 'Okänd adress.' });
      }
    }
    // Nothing was asked about anyone: the key named nobody before a source was called.
    expect(asked).toEqual([]);
  });
});
