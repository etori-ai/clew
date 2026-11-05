import { eq } from 'drizzle-orm';
import { database, schema } from '@clew/db';

/** Persisted counters make reconnection and multiple servers harmless; notifications are only invalidation hints. */
export async function changesFor(personId: string) {
  const [[person], [policy]] = await Promise.all([
    database().select().from(schema.personChanges).where(eq(schema.personChanges.personId, personId)),
    database().select().from(schema.policyChanges).where(eq(schema.policyChanges.id, 'installation')),
  ]);
  return { revision: String(person?.content ?? 0), policy: `${policy?.revision ?? 0}:${person?.policy ?? 0}` };
}
