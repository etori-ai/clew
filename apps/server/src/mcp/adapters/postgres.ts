import { database, schema } from '@clew/db';
import { and, desc, eq, inArray, isNull } from 'drizzle-orm';
import type { McpResult } from '@clew/contracts';
import type { McpStore } from '../ports';

export function postgresMcpStore(secrets: {
  seal(value: string, id: string): string;
  open(value: string, id: string): string;
}): McpStore {
  const { mcpConnections: connections, mcpDeliveries: deliveries, mcpDecisions: decisions, audit } = schema;
  return {
    registrations: personId =>
      database()
        .select()
        .from(connections)
        .where(personId ? eq(connections.personId, personId) : undefined),
    deliveries: async (personId, ids) =>
      !ids.length
        ? []
        : (
            await database()
              .select()
              .from(deliveries)
              .where(
                and(
                  eq(deliveries.personId, personId),
                  inArray(deliveries.connectionId, ids),
                  isNull(deliveries.resolvedAt),
                ),
              )
              .orderBy(desc(deliveries.createdAt))
              .limit(50)
          ).map(r => ({ ...r, createdAt: r.createdAt.toISOString() })),
    delivery: async (personId, connectionId, id) => {
      const [row] = await database()
        .select()
        .from(deliveries)
        .where(
          and(eq(deliveries.personId, personId), eq(deliveries.connectionId, connectionId), eq(deliveries.id, id)),
        );
      return row ? { ...row, createdAt: row.createdAt.toISOString() } : undefined;
    },
    decision: async (personId, id) => {
      const [r] = await database()
        .select()
        .from(decisions)
        .where(and(eq(decisions.personId, personId), eq(decisions.id, id)));
      return r
        ? { ...r, result: r.result ? (JSON.parse(secrets.open(r.result, personId + ':' + id)) as McpResult) : null }
        : undefined;
    },
    transaction: run =>
      database().transaction(async db =>
        run({
          observe: async (id, lastKey) => {
            await db.update(connections).set({ lastKey }).where(eq(connections.id, id));
          },
          deliver: async (personId, delivery) =>
            (
              await db
                .insert(deliveries)
                .values({ ...delivery, personId, createdAt: new Date(delivery.createdAt) })
                .onConflictDoNothing()
                .returning({ id: deliveries.id })
            ).length > 0,
          resolve: async (personId, connectionId, id, at) =>
            (
              await db
                .update(deliveries)
                .set({ resolvedAt: new Date(at) })
                .where(
                  and(
                    eq(deliveries.personId, personId),
                    eq(deliveries.connectionId, connectionId),
                    eq(deliveries.id, id),
                    isNull(deliveries.resolvedAt),
                  ),
                )
                .returning({ id: deliveries.id })
            ).length > 0,
          claim: async decision =>
            (
              await db
                .insert(decisions)
                .values({ ...decision, result: null })
                .onConflictDoNothing()
                .returning({ id: decisions.id })
            ).length > 0,
          finish: async decision => {
            await db
              .update(decisions)
              .set({
                state: decision.state,
                result: secrets.seal(JSON.stringify(decision.result), decision.personId + ':' + decision.id),
              })
              .where(and(eq(decisions.personId, decision.personId), eq(decisions.id, decision.id)));
          },
          audit: async (actor, action, subject) => {
            await db.insert(audit).values({ actor, action, subject });
          },
        }),
      ),
  };
}
