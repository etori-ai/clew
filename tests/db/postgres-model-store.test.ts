import { afterAll } from 'bun:test';
import { inArray, like, or } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import { postgresModelStore } from '../../apps/server/src/assistant/adapters/postgres';
import { modelStoreContract } from '../model-store-contract';

/** The model store contract against Postgres (D24, D25). `bun run test:db` inside the devcontainer. */
if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const run = Math.random().toString(36).slice(2, 8);
const prefix = `test-${run}-`;
const people: string[] = [];
afterAll(async () => {
  await database().delete(schema.audit).where(or(like(schema.audit.subject, `provider:${prefix}%`), like(schema.audit.subject, `model:${prefix}%`)));
  if (people.length) await database().delete(schema.people).where(inArray(schema.people.id, people));
  await database().delete(schema.models).where(like(schema.models.id, `${prefix}%`));
  await database().delete(schema.modelProviders).where(like(schema.modelProviders.id, `${prefix}%`));
  await closeDatabase();
});
let n = 0;
modelStoreContract('postgres', async () => ({
  store: postgresModelStore(),
  fresh: () => `${prefix}${++n}`,
  async person() { const id = `${prefix}person-${++n}`; await database().insert(schema.people).values({ id, organisationId: 'test', name: id }); people.push(id); return id; },
}));
