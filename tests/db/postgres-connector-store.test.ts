import { afterAll } from 'bun:test';
import { eq, inArray, like } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import { postgresConnectorStore } from '../../apps/server/src/connectors/adapters/postgres';
import { connectorStoreContract } from '../connector-store-contract';

/** The connector store contract against Postgres (D23, D25). `bun run test:db` inside the devcontainer. */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const run = Math.random().toString(36).slice(2, 8);
const person = `test-${run}-admin`;
const ids: string[] = [];
let created = false;
afterAll(async () => {
  if (ids.length) {
    await database()
      .delete(schema.audit)
      .where(
        inArray(
          schema.audit.subject,
          ids.map(id => 'connector:' + id),
        ),
      );
    await database().delete(schema.threads).where(inArray(schema.threads.connector, ids));
    await database().delete(schema.connectors).where(inArray(schema.connectors.id, ids));
  }
  if (created) await database().delete(schema.people).where(eq(schema.people.id, person));
  await database()
    .delete(schema.connectors)
    .where(like(schema.connectors.id, `test-${run}-%`));
  await closeDatabase();
});
connectorStoreContract('postgres', async () => {
  if (!created) {
    await database().insert(schema.people).values({ id: person, organisationId: 'test', name: person });
    created = true;
  }
  let n = 0;
  return {
    store: postgresConnectorStore(),
    fresh: () => {
      const id = `test-${run}-${++n}-${Math.random().toString(36).slice(2, 6)}`;
      ids.push(id);
      return id;
    },
    async openCardFrom(connector) {
      const id = crypto.randomUUID();
      await database()
        .insert(schema.threads)
        .values({
          id,
          personId: person,
          kind: 'pushed',
          topic: 'topic-' + id,
          title: 'Kort',
          state: 'open',
          connector,
          area: 'x',
          trigger: { reason: 'test', source: 'Hello', at: new Date().toISOString() },
        });
      return id;
    },
    async cardState(threadId) {
      const [row] = await database()
        .select({ state: schema.threads.state })
        .from(schema.threads)
        .where(eq(schema.threads.id, threadId));
      return row?.state;
    },
  };
});
