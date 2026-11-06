import { Type } from '@sinclair/typebox';
import type { Connector } from '@clew/connectors';
import type { UserReads } from './ports';

/**
 * Internal read capabilities over Clew's users and permissions (D62).
 * Identity and authorization live in the core, independently of these optional reads.
 * The stable people.* names reuse capability dispatch; this is not an administrable connector.
 */
export function userCapabilities(reads: UserReads): Connector {
  return {
    id: 'people',
    kind: 'core',
    source: 'Användare',
    areas: [],
    capabilities: [
      {
        name: 'people.me',
        kind: 'read',
        title: 'Vem är jag?',
        model: true,
        description: 'Den inloggades roll, enhet och behörigheter i Clew.',
        input: Type.Object({}, { additionalProperties: false }),
        output: Type.Object({
          id: Type.String(),
          name: Type.String(),
          role: Type.String(),
          unitId: Type.String(),
          unitLabel: Type.String(),
          capabilities: Type.Array(Type.String()),
        }),
        scope: () => true,
        run: async actor => {
          const capabilities = await reads.capabilities(actor.id);
          return {
            id: actor.id,
            name: actor.name,
            role: actor.role,
            unitId: actor.unitId,
            unitLabel: actor.unitLabel,
            capabilities,
          };
        },
      },
      {
        name: 'people.directory',
        kind: 'read',
        title: 'Vilka användare finns i min enhet?',
        model: true,
        description: 'Användare i den inloggades enhet, med roll. Inte HR-data; det finns i personalsystemet.',
        input: Type.Object({}, { additionalProperties: false }),
        output: Type.Object({
          rows: Type.Array(Type.Object({ id: Type.String(), name: Type.String(), role: Type.String() })),
        }),
        scope: () => true,
        run: async actor => {
          const rows = await reads.directory(actor.unitId);
          return { rows };
        },
      },
    ],
  };
}
