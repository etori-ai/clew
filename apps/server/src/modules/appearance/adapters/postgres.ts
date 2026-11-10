import { eq, sql } from 'drizzle-orm';
import { database, schema, type Database, type Transaction } from '@clew/db';
import { writeAudit } from '@clew/db/threads';
import { EMPTY_APPEARANCE, type AppearanceRecord, type AppearanceStore, type LogoImage } from '../ports';

/** The appearance store the server runs (D25, D98): one row over Drizzle. Held to the memory adapter by `tests/appearance-store-contract.ts`. */
const table = schema.installationAppearance;
/** The one row the server reads and writes. A test passes another name and removes its row afterwards. */
export const INSTALLATION_ROW = 'installation';
const image = (type: LogoImage['mediaType'] | null, data: string | null): LogoImage | null =>
  type && data ? { mediaType: type, bytes: new Uint8Array(Buffer.from(data, 'base64')) } : null;
const base64 = (value: LogoImage | null | undefined) => (value ? Buffer.from(value.bytes).toString('base64') : null);
function recordOf(row: typeof table.$inferSelect | undefined): AppearanceRecord {
  if (!row) return EMPTY_APPEARANCE;
  const light = image(row.logoLightType, row.logoLight);
  return {
    revision: row.revision,
    theme: row.theme,
    logo: light && row.logoAlt ? { alt: row.logoAlt, light, dark: image(row.logoDarkType, row.logoDark) } : null,
    updatedAt: row.updatedAt.toISOString(),
    updatedBy: row.updatedBy,
  };
}
const read = async (db: Database | Transaction, row: string) =>
  recordOf((await db.select().from(table).where(eq(table.id, row)))[0]);

export function postgresAppearanceStore(row = INSTALLATION_ROW): AppearanceStore {
  return {
    read: () => read(database(), row),
    transaction: fn =>
      database().transaction(async tx => {
        // The row may not exist yet, so the lock is on the installation's name, not on the row: two first saves still run in turn.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${'installation_appearance:' + row}))`);
        return fn({
          read: () => read(tx, row),
          async write(record) {
            const values = {
              revision: record.revision,
              theme: record.theme,
              logoAlt: record.logo?.alt ?? null,
              logoLightType: record.logo?.light.mediaType ?? null,
              logoLight: base64(record.logo?.light),
              logoDarkType: record.logo?.dark?.mediaType ?? null,
              logoDark: base64(record.logo?.dark),
              updatedBy: record.updatedBy ?? '',
              updatedAt: new Date(record.updatedAt ?? 0),
            };
            await tx
              .insert(table)
              .values({ id: row, ...values })
              .onConflictDoUpdate({ target: table.id, set: values });
          },
          audit: entry => writeAudit(tx, entry),
        });
      }),
  };
}
