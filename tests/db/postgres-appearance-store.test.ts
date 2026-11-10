import { afterAll } from 'bun:test';
import { asc, eq, like } from 'drizzle-orm';
import { closeDatabase, database, schema } from '../../packages/db/src/index';
import { postgresAppearanceStore } from '../../apps/server/src/modules/appearance/adapters/postgres';
import { appearanceStoreContract } from '../appearance-store-contract';

/**
 * The appearance store contract against Postgres (D25, D97). `bun run test:db` inside the devcontainer. Each case
 * writes a row of its own beside the installation's, so the appearance a developer has saved is never touched.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const prefix = `test-${Math.random().toString(36).slice(2, 8)}-`;
afterAll(async () => {
  await database()
    .delete(schema.audit)
    .where(like(schema.audit.subject, `${prefix}%`));
  await database()
    .delete(schema.installationAppearance)
    .where(like(schema.installationAppearance.id, `${prefix}%`));
  await closeDatabase();
});
let n = 0;
appearanceStoreContract('postgres', async () => {
  const row = `${prefix}${++n}`;
  return {
    store: postgresAppearanceStore(row),
    subject: row,
    audit: async () =>
      (
        await database().select().from(schema.audit).where(eq(schema.audit.subject, row)).orderBy(asc(schema.audit.id))
      ).map(a => ({ actor: a.actor, action: a.action, subject: a.subject, details: a.details })),
  };
});
