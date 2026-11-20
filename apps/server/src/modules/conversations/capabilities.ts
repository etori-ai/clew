import { Type } from 'typebox';
import { SEARCH_CONNECTOR, type Actor, type Capability, type Connector } from '@clew/connectors';
import type { Thread, View } from '@clew/contracts';
import { CONVERSATIONS_MAX, conversationList, type ConversationList } from './domain';

/**
 * Alla samtal as part of Clew's core connector (D135 rule 4): `clew.conversations` lists the person's own
 * conversations, so the assistant asked beside Alla samtal can say which one was about what and lead to it. Each is its
 * title, what it was asked beside, when it was last continued and its address; never what was said in it. As
 * `clew.work` is, it reads the person's threads through the stream's own read boundary, handed in at composition
 * (`list`), so nobody else's conversation can be among them.
 */
export const CONVERSATIONS_CAPABILITY = SEARCH_CONNECTOR + '.conversations';
const ConversationsInputSchema = Type.Object({}, { additionalProperties: false });
export const ConversationsOutputSchema = Type.Object(
  {
    total: Type.Integer({ minimum: 0 }),
    omitted: Type.Optional(Type.Integer({ minimum: 1 })),
    rows: Type.Array(
      Type.Object(
        {
          title: Type.String(),
          about: Type.Optional(Type.String({ maxLength: 200 })),
          lastAt: Type.String({ format: 'date-time' }),
          address: Type.String({ maxLength: 200 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: CONVERSATIONS_MAX },
    ),
  },
  { additionalProperties: false },
);
/** The conversations as a list: the title first, what it is about, when it was last continued and its address. */
export const conversationsView: View = {
  kind: 'list',
  title: 'title',
  noun: { one: 'samtal', other: 'samtal' },
  empty: 'Du har inga samtal än.',
  fields: [
    { key: 'title', label: 'Samtal' },
    { key: 'about', label: 'Gäller' },
    { key: 'lastAt', label: 'Senast', format: 'instant' },
    { key: 'address', label: 'Adress i Clew' },
  ],
};

export function conversationCapabilities(deps: {
  /** The person's own threads as the stream's read boundary lets them see them now (`threadAccess`). */
  list: (actor: Actor, now: string) => Promise<Thread[]>;
  clock: () => Date;
}): Pick<Connector, 'capabilities'> {
  const conversations: Capability<Record<string, never>, ConversationList> = {
    name: CONVERSATIONS_CAPABILITY,
    kind: 'read',
    title: 'Alla samtal',
    model: true,
    description: `Personens egna samtal med assistenten, det senast fortsatta först: samtalets rubrik, vad det gäller när det ställdes bredvid en sida, när det senast fortsattes och dess adress i Clew. Aldrig vad som sades i samtalet. Högst ${CONVERSATIONS_MAX} samtal; omitted säger hur många fler det finns. Länka till ett samtal med dess adress som [rubriken](adressen). Tar ingen indata.`,
    input: ConversationsInputSchema,
    output: ConversationsOutputSchema,
    view: conversationsView,
    scope: () => true,
    page: '/conversations',
    run: async actor => conversationList(await deps.list(actor, deps.clock().toISOString())),
  };
  return { capabilities: [conversations as Capability] };
}
