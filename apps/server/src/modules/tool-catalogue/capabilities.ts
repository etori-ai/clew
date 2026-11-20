import { Type } from 'typebox';
import { SEARCH_CONNECTOR, menuRowOf, type Actor, type Capability, type Connector } from '@clew/connectors';
import type { MenuEntry, View } from '@clew/contracts';
import { toolRows } from './domain';

/**
 * Alla verktyg as part of Clew's core connector (D135 rule 4): `clew.tools` is the page's tiles as a read, so the
 * assistant asked beside the page, or anywhere, can answer "var attesterar jag en faktura?" with the tool's name and a
 * link to its page. As the errand list is (D89), the registry joins it with the composite search under the core
 * connector's id and hands it the person's menu (`menu`, D40) and Clew's own lists they have (`own`), so this module
 * knows neither the registry nor any other module. It reads nothing from a source and writes nothing.
 */
export const TOOLS_CAPABILITY = SEARCH_CONNECTOR + '.tools';
const TOOLS_MAX = 500;
const ToolsInputSchema = Type.Object({}, { additionalProperties: false });
export const ToolsOutputSchema = Type.Object(
  {
    rows: Type.Array(
      Type.Object(
        {
          name: Type.String({ maxLength: 512 }),
          what: Type.Optional(Type.String({ maxLength: 512 })),
          system: Type.String({ maxLength: 512 }),
          address: Type.String({ maxLength: 1024 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: TOOLS_MAX },
    ),
  },
  { additionalProperties: false },
);
/**
 * The tools as a list: the name first, what it is, its system and its address in Clew. The address is plain text, not
 * a link field, since the model reads no link (`modelReading`) and writes the address into its answer as one.
 */
export const toolsView: View = {
  kind: 'list',
  title: 'name',
  noun: { one: 'verktyg', other: 'verktyg' },
  empty: 'Du har inga verktyg än. En administratör väljer vilka vyer från de anslutna systemen som är verktyg.',
  fields: [
    { key: 'name', label: 'Verktyg' },
    { key: 'what', label: 'Vad det är' },
    { key: 'system', label: 'System' },
    { key: 'address', label: 'Adress i Clew' },
  ],
};

/** One of Clew's own lists the person may call, as the registry finds it (`Registry.allowed`). */
export interface OwnList {
  connector: Pick<Connector, 'id' | 'source'>;
  capability: Capability;
}
/** An own list as a menu row: under the name and icon it declares for the menu, as the page's `toolsOf` names it. */
export function ownEntries(lists: readonly OwnList[]): MenuEntry[] {
  return lists.flatMap(({ connector, capability }) => {
    const row = menuRowOf(capability);
    return row
      ? [
          {
            connector: connector.id,
            source: connector.source,
            capability: capability.name,
            title: capability.title,
            label: row.label,
            icon: row.icon,
          },
        ]
      : [];
  });
}

export function toolCatalogueCapabilities(deps: {
  /** The person's menu rows (`Registry.menu`): the views an administrator placed that they may call. */
  menu: (actor: Actor) => readonly MenuEntry[];
  /**
   * Clew's own lists the person may call (D126 rule 8: Mina ärenden, Mina beställningar): what Alla verktyg lists
   * whether or not an administrator placed them in the menu.
   */
  own: (actor: Actor) => readonly OwnList[];
}): Pick<Connector, 'capabilities'> {
  const tools: Capability<Record<string, never>> = {
    name: TOOLS_CAPABILITY,
    kind: 'read',
    title: 'Alla verktyg',
    model: true,
    description:
      'Verktygen som personen har i Clew, så som Alla verktyg listar dem: verktygets namn, vad det är, vilket system det hör till och dess adress i Clew. Använd det när personen frågar var något görs eller finns, till exempel var hen attesterar fakturor, och länka då till verktyget med dess adress som [verktygets namn](adressen). Hitta aldrig på en adress som inte står här. Tar ingen indata.',
    input: ToolsInputSchema,
    output: ToolsOutputSchema,
    view: toolsView,
    scope: () => true,
    page: '/tools',
    run: async actor => ({ rows: toolRows(deps.menu(actor), ownEntries(deps.own(actor))).slice(0, TOOLS_MAX) }),
  };
  return { capabilities: [tools as Capability] };
}
