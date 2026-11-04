import { Type } from '@sinclair/typebox';
import { eq } from 'drizzle-orm';
import type { Connector } from '@clew/connectors';
import { database, schema } from '@clew/db';

/**
 * People and permissions: a core connector (D3). The records are Clew's own (`auth_person`, `auth_access_grant`,
 * provisioned by SCIM later), so there is no adapter, no mock state and no scan. Every other connector's `scope`
 * reads the actor's role and unit from here; the mock integrations link their records by `personId`.
 */
export function peopleConnector(): Connector {
  return {
    id: 'people', kind: 'core', source: 'Startsidan',
    areas: [],
    capabilities: [
      { name: 'people.me', kind: 'read', title: 'Vem är jag?', model: true, description: 'Den inloggades roll, enhet och behörigheter i Startsidan.',
        input: Type.Object({}, { additionalProperties: false }), output: Type.Object({ id: Type.String(), name: Type.String(), role: Type.String(), unitId: Type.String(), unitLabel: Type.String(), capabilities: Type.Array(Type.String()) }),
        scope: () => true,
        run: async actor => {
          const [row] = await database().select({ capabilities: schema.accessGrants.capabilities }).from(schema.accessGrants).where(eq(schema.accessGrants.personId, actor.id));
          return { id: actor.id, name: actor.name, role: actor.role, unitId: actor.unitId, unitLabel: actor.unitLabel, capabilities: row?.capabilities ?? [] };
        } },
      { name: 'people.directory', kind: 'read', title: 'Vilka finns i Startsidan?', model: true, description: 'Provisionerade personer i den inloggades enhet, med roll. Inte HR-data; det finns i Heroma.',
        input: Type.Object({}, { additionalProperties: false }), output: Type.Object({ rows: Type.Array(Type.Object({ id: Type.String(), name: Type.String(), role: Type.String() })) }),
        scope: () => true,
        run: async actor => {
          const rows = await database().select({ id: schema.people.id, name: schema.people.name, role: schema.accessGrants.role }).from(schema.people)
            .innerJoin(schema.accessGrants, eq(schema.accessGrants.personId, schema.people.id)).where(eq(schema.accessGrants.unitId, actor.unitId));
          return { rows };
        } },
    ],
  };
}
