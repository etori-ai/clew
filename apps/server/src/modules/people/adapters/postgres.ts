import { eq } from 'drizzle-orm';
import { database, schema } from '@clew/db';
import type { UserReads } from '../ports';

/** Read the local user/grant tables; directory access is restricted to the actor's unit. */
export const postgresUserReads = (): UserReads => ({
  async capabilities(personId) {
    const [row] = await database()
      .select({ capabilities: schema.accessGrants.capabilities })
      .from(schema.accessGrants)
      .where(eq(schema.accessGrants.personId, personId));
    return row?.capabilities ?? [];
  },
  async directory(unitId) {
    return database()
      .select({ id: schema.people.id, name: schema.people.name, role: schema.accessGrants.role })
      .from(schema.people)
      .innerJoin(schema.accessGrants, eq(schema.accessGrants.personId, schema.people.id))
      .where(eq(schema.accessGrants.unitId, unitId));
  },
});
