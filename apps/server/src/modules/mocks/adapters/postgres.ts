import { and, eq, inArray } from 'drizzle-orm';
import { database, schema } from '@clew/db';
import { resetState } from '@clew/db/state';
import type { MockResetStore } from '../model';

export function postgresMockResetStore(): MockResetStore {
  return {
    resetState: () => resetState(),
    transaction: fn =>
      database().transaction(tx =>
        fn({
          async dismissOpenThreadsOf(connectorIds, at) {
            if (!connectorIds.length) return;
            await tx
              .update(schema.threads)
              .set({ state: 'dismissed', handledAt: new Date(at), updatedAt: new Date(at) })
              .where(and(inArray(schema.threads.connector, connectorIds), eq(schema.threads.state, 'open')));
          },
          async writeAudit(entry) {
            await tx.insert(schema.audit).values({
              actor: entry.actor,
              action: entry.action,
              subject: entry.subject,
              details: entry.details ?? {},
              createdAt: new Date(entry.at),
            });
          },
        }),
      ),
  };
}
