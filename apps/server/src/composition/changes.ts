import { eq } from 'drizzle-orm';
import { database, schema } from '@clew/db';

/**
 * The installation-wide content counters (`content_change`) a person's stream folds in, each with the capability that
 * lets a person see what it counts, or none when everyone may (DE-L10). The change signals that move each are listed in
 * `changeSignals` of `@clew/db`'s schema. A reorganisation pushed by a provisioner moves `organisation`, which only those
 * who administer users see change; everyone else sees their own access change through their grant.
 */
const SHARED_CONTENT: ReadonlyArray<{ id: string; capability?: string }> = [
  // What everyone's pages draw: the talk rounds, the models to choose from, the competence catalogue and the follow-up
  // dialogue's areas and questions.
  { id: 'talk-round' },
  { id: 'models' },
  { id: 'competence-catalogue' },
  { id: 'dialogue-setup' },
  { id: 'connectors', capability: 'admin.connectors' },
  { id: 'competence-source', capability: 'admin.competence' },
  { id: 'boarding-layers', capability: 'admin.boarding' },
  { id: 'appearance', capability: 'admin.appearance' },
  { id: 'organisation', capability: 'admin.users' },
];

/**
 * Persisted counters make reconnection and multiple servers harmless; notifications are only invalidation hints. The
 * content revision is the person's own counter, then each shared counter they may see, so the browser hears a change to
 * either as one notice.
 */
export async function changesFor(person: { id: string; capabilities: readonly string[] }) {
  const shared = SHARED_CONTENT.filter(c => !c.capability || person.capabilities.includes(c.capability)).map(c => c.id);
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
