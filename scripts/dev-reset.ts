/**
 * The Clew side of `bun run fixtures:reset`: the fixture connectors have been seeded again, so the cards they pushed
 * earlier are closed, audited as `fixtures.reset`. Runs inside the app container. The source side (forgetting the
 * connectors' own records) is `scripts/fixtures-reset.sh`, which restarts the services on empty volumes.
 */
import { resolve } from 'node:path';
import { and, eq, inArray } from 'drizzle-orm';
import { closeDatabase, database, schema } from '@clew/db';

try {
  process.loadEnvFile(resolve(import.meta.dir, '../apps/server/.env.local'));
} catch {
  /* settings may come from the environment */
}
const connectors = ['hr', 'finance', 'incidents', 'communication', 'timesheet', 'payroll'];
const at = new Date();
try {
  const closed = await database().transaction(async tx => {
    const rows = await tx
      .update(schema.threads)
      .set({ state: 'dismissed', handledAt: at, updatedAt: at })
      .where(and(inArray(schema.threads.connector, connectors), eq(schema.threads.state, 'open')))
      .returning({ id: schema.threads.id });
    await tx.insert(schema.audit).values({
      actor: 'bootstrap:fixtures',
      action: 'fixtures.reset',
      subject: 'connectors',
      details: { connectors, closed: rows.length },
      createdAt: at,
    });
    return rows.length;
  });
  console.log(
    `Closed ${closed} open card${closed === 1 ? '' : 's'} from the fixture connectors; the next scan starts from their fresh records.`,
  );
} finally {
  await closeDatabase();
}
