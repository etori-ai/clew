import { eq } from 'drizzle-orm';
import { database, schema } from '@clew/db';
import type { FollowBinding } from '../contracts';
import type { FollowBindingStore } from '../model';

const { followBindings: table, audit } = schema;
type Row = typeof table.$inferSelect;
const fromRow = (r: Row): FollowBinding => ({
  id: r.id,
  kind: r.kind,
  capability: r.capability,
  audience: r.audience,
  ...(r.within ? { within: r.within } : {}),
  enabled: r.enabled,
  createdAt: r.createdAt.toISOString(),
  updatedAt: r.updatedAt.toISOString(),
});
const toRow = (b: FollowBinding): typeof table.$inferInsert => ({
  id: b.id,
  kind: b.kind,
  capability: b.capability,
  audience: b.audience,
  within: b.within ?? null,
  enabled: b.enabled,
  createdAt: new Date(b.createdAt),
  updatedAt: new Date(b.updatedAt),
});
/** An administrator's bindings (D55) live in Clew's database like every other connector governance (D23). */
export function postgresFollowBindingStore(): FollowBindingStore {
  return {
    async list(kind) {
      const rows = await (
        kind ? database().select().from(table).where(eq(table.kind, kind)) : database().select().from(table)
      ).orderBy(table.createdAt, table.id);
      return rows.map(fromRow);
    },
    async read(id) {
      const [r] = await database().select().from(table).where(eq(table.id, id));
      return r ? fromRow(r) : undefined;
    },
    transaction: fn =>
      database().transaction(tx =>
        fn({
          async upsert(b) {
            const row = toRow(b);
            await tx
              .insert(table)
              .values(row)
              .onConflictDoUpdate({
                target: table.id,
                set: {
                  kind: row.kind,
                  capability: row.capability,
                  audience: row.audience,
                  within: row.within,
                  enabled: row.enabled,
                  updatedAt: row.updatedAt,
                },
              });
          },
          async remove(id) {
            await tx.delete(table).where(eq(table.id, id));
          },
          async audit(e) {
            await tx.insert(audit).values({
              actor: e.actor,
              action: e.action,
              subject: e.subject,
              createdAt: new Date(e.at),
              details: e.details ?? {},
            });
          },
        }),
      ),
  };
}
