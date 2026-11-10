import { TALKS_CONNECTOR, type Actor, type Capability, type Connector } from '@clew/connectors';
import {
  CommitmentsInputSchema,
  CommitmentsOutputSchema,
  TalksInputSchema,
  TalksOutputSchema,
  type AuthenticatedContext,
  type CommitmentsInput,
  type TalksInput,
  type View,
} from '@clew/contracts';
import { systemContext } from '../../system-context';
import { swedishDayAndMonth } from './domain';
import type { TalkUsecases } from './usecases';

/**
 * The talks module as Clew's built-in connector (D96 items 7 to 9): it answers the talks profile, `talks.talks` and
 * `talks.commitments`, while an administrator keeps it enabled, and declares the area whose figure is the share of
 * talks held. No read is a model tool, and neither view declares a `ref`, so no row can be added to a conversation as
 * a chip (item 6): the text of an action point is free text about a person. Writes are use cases behind Clew's own
 * routes, never capabilities. The use cases come built from composition (D25).
 */
export const TALKS_SOURCE = 'Utvecklingssamtal';
/** The manager's round, one row per person: the figure opens it. */
export const talksView: View = {
  kind: 'table',
  title: 'name',
  noun: { one: 'person', other: 'personer' },
  empty: 'Det finns ingen öppen omgång, eller ingen att hålla samtal med.',
  fields: [
    { key: 'name', label: 'Namn' },
    // Only the talk that is still missing needs the manager.
    { key: 'state', label: 'Samtal', format: 'status', tones: { missing: 'warn' } },
    { key: 'at', label: 'När' },
    { key: 'openCommitments', label: 'Öppna åtgärdspunkter', format: 'number' },
  ],
};
/** The reader's action points, the ones they own and the ones about them: what the owner's card opens with no input. */
export const commitmentsView: View = {
  kind: 'list',
  title: 'text',
  noun: { one: 'åtgärdspunkt', other: 'åtgärdspunkter' },
  empty: 'Du har inga åtgärdspunkter.',
  fields: [
    { key: 'text', label: 'Åtgärdspunkt' },
    { key: 'dueOn', label: 'Senast', format: 'date' },
    { key: 'done', label: 'Klar', format: 'status' },
    { key: 'name', label: 'Samtal med' },
  ],
};
/** The persona a use case takes, built from the person's current grant as the calendar's connector does. */
async function systemPersona(actor: Actor): Promise<AuthenticatedContext> {
  const persona = await systemContext(actor.id, 'connector:' + TALKS_CONNECTOR);
  if (!persona) throw new Error('Okänd person.');
  return persona;
}

/** `persona` turns the registry's actor into a use-case persona; the unit tests hand in their own. */
export function talksConnector(
  talks: TalkUsecases,
  persona: (actor: Actor) => Promise<AuthenticatedContext> = systemPersona,
): Connector {
  const round: Capability<TalksInput> = {
    name: TALKS_CONNECTOR + '.talks',
    kind: 'read',
    title: 'Utvecklingssamtal',
    model: false,
    description: 'Den öppna omgången av utvecklingssamtal och var varje person du är chef för står.',
    input: TalksInputSchema,
    output: TalksOutputSchema,
    view: talksView,
    scope: { roles: ['manager'] },
    run: async actor => talks.round(await persona(actor)),
  };
  const commitments: Capability<CommitmentsInput> = {
    name: TALKS_CONNECTOR + '.commitments',
    kind: 'read',
    title: 'Mina åtgärdspunkter',
    model: false,
    description: 'Åtgärdspunkter från utvecklingssamtal: dina egna, eller en persons du är chef för.',
    input: CommitmentsInputSchema,
    output: CommitmentsOutputSchema,
    view: commitmentsView,
    scope: () => true,
    run: async (actor, input) => talks.commitments(await persona(actor), input),
  };
  return {
    id: TALKS_CONNECTOR,
    kind: 'core',
    source: TALKS_SOURCE,
    areas: [
      {
        id: 'talks',
        title: 'Utvecklingssamtal',
        roles: ['manager', 'employee'],
        standing: [round.name],
        schedules: [],
        // Läget's tile (D54, D96 item 7): talks held out of everyone due one in the open round, for the manager. Nobody
        // due, no round or no unit managed: no figure. A throw is the registry's warning figure.
        figure: async actor => {
          if (actor.role !== 'manager') return null;
          const p = await talks.progress(await persona(actor));
          if (!p) return null;
          return {
            label: 'Utvecklingssamtal hållna',
            value: `${p.held} av ${p.due}`,
            comparison: `senast ${swedishDayAndMonth(p.round.dueOn)}`,
            progress: { value: p.held, max: p.due },
            tone: 'none',
            opens: round.name,
          };
        },
      },
    ],
    capabilities: [round as Capability, commitments as Capability],
  };
}
