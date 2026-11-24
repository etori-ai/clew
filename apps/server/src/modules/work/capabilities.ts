import { Type } from 'typebox';
import { SEARCH_CONNECTOR, type Actor, type Capability, type Connector } from '@clew/connectors';
import { stockholmDate, type Thread } from '@clew/contracts';
import { PILES, workList, type Pile, type WorkResult } from './domain';

/**
 * A person's work items as part of Clew's core connector (the product owner, 2026-11-16): `clew.work` is Att göra as a
 * read, so the assistant can answer "vad har jag att göra?" and Att göra's "Fråga Clew" can send the pile as one
 * reference, not a chip per card. It reads the items as they are when it is asked; an answer says what it read, how
 * much and when. Each item is its title, system, state and last day, and what it is about in the source's own
 * sentence, except an item about a person or a unit, which is listed without that sentence (D97 item 7, D115).
 * Its rows are worked through on Att göra, the page it declares.
 *
 * `list` is the stream's own read boundary (`threadAccess`), handed in at composition: what the person may see of
 * their items today, and nothing else. `forModel` is the registry's model switch (D122 item 4): the model's own read
 * (`Clew.forModel`) leaves out an item whose system the administrator has closed to the assistant, and says how many.
 */
export const WORK_CAPABILITY = SEARCH_CONNECTOR + '.work';
const object = <T extends Record<string, Type.TSchema>>(properties: T) =>
  Type.Object(properties, { additionalProperties: false });
const WorkInputSchema = object({
  pile: Type.Optional(
    Type.Union(
      PILES.map(p => Type.Literal(p)),
      {
        description:
          '`needs-you` (default): what waits for the person. `waiting`: what the person has decided or handed on and waits for someone else.',
      },
    ),
  ),
});
const WorkResultSchema = object({
  pile: Type.String(),
  total: Type.Number(),
  rows: Type.Array(
    object({
      ref: Type.String(),
      label: Type.String(),
      system: Type.String(),
      connector: Type.String(),
      state: Type.String(),
      deadline: Type.Optional(Type.String()),
      late: Type.Optional(Type.String()),
      fact: Type.Optional(Type.String()),
    }),
  ),
  withheld: Type.Optional(Type.Integer({ minimum: 1 })),
});

export function workCapabilities(deps: {
  list: (actor: Actor, now: string) => Promise<Thread[]>;
  clock: () => Date;
  forModel?: (connectorId: string) => boolean;
}): Pick<Connector, 'capabilities'> {
  const work: Capability<{ pile?: Pile }> = {
    name: WORK_CAPABILITY,
    kind: 'read',
    title: 'Att göra',
    model: true,
    description:
      'Personens egna ärenden under Att göra, som de ser ut nu: det som behöver personen (förvalt) eller det som väntar på andra. För varje ärende: titel, system, läge, sista dag, om det är försenat och vad det gäller. De mest brådskande först. Använd det när personen frågar vad de har att göra, vad som är försenat eller vad som väntar. Står withheld i svaret är så många ärenden inte med, eftersom de kommer från system som du inte får läsa: säg att de finns under Att göra.',
    input: WorkInputSchema,
    output: WorkResultSchema,
    scope: () => true,
    page: '/todo',
    view: {
      kind: 'list',
      title: 'label',
      ref: 'ref',
      noun: { one: 'ärende', other: 'ärenden' },
      empty: 'Inget här just nu.',
      fields: [
        { key: 'label', label: 'Ärende' },
        { key: 'late', label: 'Försenat', format: 'status', tones: { försenad: 'alert' } },
        { key: 'deadline', label: 'Senast', format: 'date' },
        { key: 'system', label: 'System' },
        { key: 'fact', label: 'Gäller' },
        { key: 'state', label: 'Läge' },
      ],
    },
    run: async (actor, input, clew): Promise<WorkResult> => {
      const now = deps.clock().toISOString();
      const open = clew.forModel && deps.forModel ? (t: Thread) => deps.forModel!(t.connector) : undefined;
      return workList(await deps.list(actor, now), input.pile ?? 'needs-you', now, stockholmDate(now), open);
    },
  };
  return { capabilities: [work as Capability] };
}
