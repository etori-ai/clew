import { eq } from 'drizzle-orm';
import type { Capability } from '@clew/contracts';
import { database, schema } from '@clew/db';

/**
 * The installation-wide content counters a person's stream folds in, by the capability that lets them see what each
 * counts (WD-L8): a competence source's read, which Administration › Kompetens › Källor draws, for `admin.competence`.
 */
const SHARED_CONTENT: ReadonlyArray<{ id: string; capability: Capability }> = [
  { id: 'competence-source', capability: 'admin.competence' },
];

/**
 * Persisted counters make reconnection and multiple servers harmless; notifications are only invalidation hints. The
 * content revision is the person's own counter, then each shared counter they may see, so the browser hears a change to
 * either as one notice.
 */
export async function changesFor(person: { id: string; capabilities: readonly string[] }) {
  const shared = SHARED_CONTENT.filter(c => person.capabilities.includes(c.capability)).map(c => c.id);
  const [[own], [policy], counters] = await Promise.all([
    database().select().from(schema.personChanges).where(eq(schema.personChanges.personId, person.id)),
    database().select().from(schema.policyChanges).where(eq(schema.policyChanges.id, 'installation')),
    shared.length
      ? database().select().from(schema.contentChanges)
      : Promise.resolve([] as Array<{ id: string; revision: number }>),
  ]);
  const revision = [own?.content ?? 0, ...shared.map(id => counters.find(c => c.id === id)?.revision ?? 0)].join(':');
  return { revision, policy: `${policy?.revision ?? 0}:${own?.policy ?? 0}` };
}
