import { Type } from '@sinclair/typebox';
import { CapabilityError, SEARCH_CONNECTOR, type Connector } from '@clew/connectors';
import { SearchHitSchema, SearchKind, SearchResultSchema } from '@clew/contracts';
import { FetchInputSchema, SearchInputSchema, type FetchInput, type SearchInput } from './contracts';
import type { SearchUsecases } from './usecases';

/**
 * The composite search as a core connector (D26): `startsidan.search` is the one search tool the model sees and the
 * router's catch-all; `startsidan.openSource` turns a ref back into a link for a card's button. It owns the question
 * area, where the conversations already live. The use cases come built from `connectors/registry.ts`, over the registry
 * itself as the list of sources.
 */
/** The refs Clew hands out for found text: `<connector id>:<the connector's own ref>`; a chip prefixes `document:`. */
export const sourceRef = (connectorId: string, ref: string) => `${connectorId}:${ref}`;
export function parseSourceRef(value: string): { connectorId: string; ref: string } | undefined {
  const m = /^([a-z][a-z0-9-]*):([A-Za-z0-9:_.@-]+)$/.exec(value);
  return m ? { connectorId: m[1]!, ref: m[2]! } : undefined;
}
export function searchConnector(search: SearchUsecases): Connector {
  return {
    id: SEARCH_CONNECTOR, kind: 'core', source: 'Startsidan',
    areas: [{ id: 'fragor', title: 'Dina frågor', roles: ['manager', 'employee'], standing: [], schedules: [] }],
    capabilities: [
      { name: SEARCH_CONNECTOR + '.search', kind: 'read', title: 'Sök i rutiner och dokument', model: true,
        description: 'Söker i alla rutiner, dokument och register personen får se, i alla anslutna källor samtidigt. Använd när frågan handlar om hur något ska göras, vad som gäller eller var något står. Ange frågan som query.',
        input: SearchInputSchema, output: SearchResultSchema, scope: () => true, kinds: [...SearchKind.anyOf.map(k => k.const)],
        run: (actor, input: SearchInput, clew) => search.search(actor, input, clew.call) },
      { name: SEARCH_CONNECTOR + '.openSource', kind: 'read', title: 'Öppna källan', model: false,
        description: 'Länken till ett dokument som en tidigare sökning hittade.',
        input: Type.Object({ ref: Type.String({ minLength: 3, maxLength: 260 }) }, { additionalProperties: false }), output: Type.Object({ url: Type.String() }), scope: () => true,
        run: async (actor, input: { ref: string }, clew) => {
          const parsed = parseSourceRef(input.ref);
          const hit = parsed && await search.fetch(actor, parsed.connectorId, { ref: parsed.ref }, clew.call);
          if (!hit?.link) throw new CapabilityError('Källan går inte att öppna härifrån.');
          return { url: hit.link };
        } },
      { name: SEARCH_CONNECTOR + '.fetchSource', kind: 'read', title: 'Hämta ett avsnitt', model: false,
        description: 'Ett avsnitt som en tidigare sökning hittade, hämtat igen från sin källa.',
        input: FetchInputSchema, output: SearchHitSchema, scope: () => true,
        run: async (actor, input: FetchInput, clew) => {
          const parsed = parseSourceRef(input.ref);
          const hit = parsed && await search.fetch(actor, parsed.connectorId, { ref: parsed.ref }, clew.call);
          if (!hit) throw new CapabilityError('Avsnittet finns inte längre.');
          return hit;
        } },
    ],
  };
}
