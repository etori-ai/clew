import { and, eq } from 'drizzle-orm';
import type { AuthenticatedContext } from '@clew/contracts';
import { database, schema } from '@clew/db';
import { resetState } from '@clew/db/state';
import { writeAudit } from '@clew/db/threads';
import { InputError } from '../../context';
import { registry } from '../../connectors/registry';

/** Development only: forget every mock decision and close the mocks' open cards, so the next scan starts from the fixtures. */
export async function resetMocks(persona: AuthenticatedContext) {
  if (process.env.CLEW_POC !== 'true') throw new InputError('Bara i utvecklingsmiljön.');
  await resetState();
  const mockIds = registry.list().filter(m => m.kind === 'passthrough' && m.id !== 'calendar').map(m => m.id).concat('kommunikation');
  const now = new Date();
  await database().transaction(async tx => {
    for (const id of mockIds) await tx.update(schema.threads).set({ state: 'dismissed', handledAt: now, updatedAt: now }).where(and(eq(schema.threads.connector, id), eq(schema.threads.state, 'open')));
    await writeAudit(tx, { actor: persona.principal.id, action: 'mocks.reset', subject: 'module_state', details: { connectors: mockIds } });
  });
}
