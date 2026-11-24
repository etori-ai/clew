import { eq, sql } from 'drizzle-orm';
import { database, schema } from '@clew/db';
import { SHARED_CONTENT, counterSequence } from '../shared-content';

/**
 * Persisted counters make reconnection and multiple servers harmless; notifications are only invalidation hints. The
 * content revision is the person's own counter, then each shared counter they may see (`SHARED_CONTENT`), so the
 * browser hears a change to either as one notice. A shared counter is a sequence, read as its `last_value`: `nextval`
 * takes no lock a transaction holds, so the writers of one counter never wait for each other (DE-L10). A sequence is
 * not transactional (D46): a transaction that rolls back after its signal fired has moved its counter, which costs the
 * readers a read that finds nothing new, and the counter moves when the signal fires at commit, the moment before the
 * commit can be read, so a stream that reads it in that moment may have its browser read what was there before; the
 * browser reads the change at its next notice, or when the page is opened again or regains focus.
 */
export async function changesFor(person: { id: string; capabilities: readonly string[] }) {
  const shared = SHARED_CONTENT.filter(c => !('capability' in c) || person.capabilities.includes(c.capability)).map(
    c => c.id,
  );
  const [[own], [policy], counters] = await Promise.all([
    database().select().from(schema.personChanges).where(eq(schema.personChanges.personId, person.id)),
    database().select().from(schema.policyChanges).where(eq(schema.policyChanges.id, 'installation')),
    shared.length
      ? database().execute<{ id: string; revision: string | number }>(
          sql.join(
            shared.map(
              id =>
                sql`select ${id}::text as id, case when is_called then last_value else 0 end as revision from ${sql.identifier(counterSequence(id))}`,
            ),
            sql` union all `,
          ),
        )
      : Promise.resolve([] as Array<{ id: string; revision: number }>),
  ]);
  const revision = [
    own?.content ?? 0,
    ...shared.map(id => Number(counters.find(c => c.id === id)?.revision ?? 0)),
  ].join(':');
  return { revision, policy: `${policy?.revision ?? 0}:${own?.policy ?? 0}` };
}
