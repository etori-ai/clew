import { afterAll } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { eq, like } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { postgresFollowBindingStore } from '../../apps/server/src/modules/jobs/adapters/postgres';
import { followBindingStoreContract } from '../follow-binding-store-contract';

/** The follow binding store contract on Postgres (D55). Run with `bun run test:db` inside the devcontainer. */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const prefixes: string[] = [];
afterAll(async () => {
  for (const p of prefixes) {
    await database()
      .delete(schema.followBindings)
      .where(like(schema.followBindings.id, p + '%'));
    await database()
      .delete(schema.audit)
      .where(like(schema.audit.subject, 'binding:' + p + '%'));
  }
});
followBindingStoreContract('postgres', async () => {
  const prefix = 'test-binding-' + randomUUID().slice(0, 8);
  prefixes.push(prefix);
  return {
    store: postgresFollowBindingStore(),
    prefix,
    async auditFor(subject) {
      return database()
        .select({ actor: schema.audit.actor, action: schema.audit.action, details: schema.audit.details })
        .from(schema.audit)
        .where(eq(schema.audit.subject, subject))
        .orderBy(schema.audit.id);
    },
  };
});
