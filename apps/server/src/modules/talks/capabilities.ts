import { Type, type Static } from 'typebox';
import { TALKS_CONNECTOR, type Actor, type Capability, type Connector } from '@clew/connectors';
import {
  CommitmentsInputSchema,
  CommitmentsOutputSchema,
  ENTITY_KEYS_MAX,
  TALK_STATES,
  TalksInputSchema,
  TalksOutputSchema,
  type AuthenticatedContext,
  type CommitmentsInput,
  type TalksInput,
  type View,
  literals,
} from '@clew/contracts';
import { systemContext } from '../../system-context';
import {
  TALK_STATE_WORDS,
  bookedWords,
  heldWords,
  missingWords,
  nextTalk,
  openWords,
  overdueWords,
  swedishDayAndMonth,
  swedishShortDay,
} from './domain';
import type { RoundHeading, TalkUsecases } from './usecases';

/**
 * The talks module as Clew's built-in connector (D96 items 7 to 9): it answers the talks profile, `talks.talks` and
 * `talks.commitments`, while an administrator keeps it enabled, and declares the area whose figure is the share of
 * talks held. One read is offered to the model (D122 item 3, D130 rule 4): the open round, `talks.talks`, which says
 * where each of the reader's reports stands and holds no text of a talk or an action point. The rest stay closed, each
 * for its reason: `talks.commitments`, since the text of an action point is free text about a person (D96 item 6; the
 * registry holds every system's action points from the model whatever a read declares); `talks.person` and
 * `talks.unit`, the two reads that say what their rows are about (D97), which the loader holds from the model (D97
 * item 7): the model reads the round row by row from `talks.talks` instead. Neither view declares a `ref`, so no row
 * can be added to a conversation as a chip. Writes are use cases behind Clew's own routes, never capabilities, so
 * nothing here is an action in a person's menu. The module logs no read, so the assistant's read of the round is
 * logged nowhere either (D122 item 6). The use cases come built from composition (D25).
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
  // A row is one of the manager's people, by user name (D97 item 6): the name links to the person.
  subject: { entity: 'person', key: 'userName' },
  // The same people's places in the round as `talks.person` answers them by key (D127): where an administrator offers
  // that lens on Personal, the figure on Hem leads to its tab, not to this read's page.
  byKey: TALKS_CONNECTOR + '.person',
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
/**
 * The reads about an entity (D97): the open round per person and per unit, asked with a batch of keys and answering one
 * row per key the reader manages. Clew places them from the declaration: a section on the opened person or unit, a lens
 * and a column on Personal when an administrator chooses them, and a mark where a value warns. Never a model tool.
 */
const KeysSchema = Type.Object(
  { keys: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: ENTITY_KEYS_MAX }) },
  { additionalProperties: false },
);
type Keys = Static<typeof KeysSchema>;
/** The round's label and due day beside the rows: the heading and the one line of fact over a list (D97). */
const headingSchema = {
  heading: Type.Optional(Type.String({ maxLength: 120 })),
  note: Type.Optional(Type.String({ maxLength: 200 })),
};
export const PersonTalkRowSchema = Type.Object(
  {
    key: Type.String({ minLength: 1, maxLength: 256 }),
    state: literals(TALK_STATES.map(s => TALK_STATE_WORDS[s])),
    at: Type.Optional(Type.String({ maxLength: 40 })),
    next: Type.String({ maxLength: 40 }),
    open: Type.String({ maxLength: 40 }),
    overdue: Type.Optional(Type.String({ maxLength: 40 })),
  },
  { additionalProperties: false },
);
export const PersonTalksOutputSchema = Type.Object(
  { ...headingSchema, rows: Type.Array(PersonTalkRowSchema, { maxItems: ENTITY_KEYS_MAX }) },
  { additionalProperties: false },
);
export const UnitTalksOutputSchema = Type.Object(
  {
    ...headingSchema,
    rows: Type.Array(
      Type.Object(
        {
          key: Type.String({ minLength: 1, maxLength: 256 }),
          held: Type.String({ maxLength: 40 }),
          missing: Type.Optional(Type.String({ maxLength: 40 })),
          booked: Type.Optional(Type.String({ maxLength: 40 })),
        },
        { additionalProperties: false },
      ),
      { maxItems: ENTITY_KEYS_MAX },
    ),
  },
  { additionalProperties: false },
);
/**
 * One person's place in the round (artboards A2, B and C): the state as a badge (only a missing talk warns, a held one
 * is done, a booked one is a neutral badge) with its time beside it, the next talk as one value where only one has room
 * (a column, a one-line summary; only "Inte bokat" warns, a date is plain), and the action points with the overdue ones
 * beside them, warning. A lens and a section draw two cells, "Samtal" and "Åtgärdspunkter" (D97). A row opens the
 * person's action points.
 */
export const personTalksView: View = {
  kind: 'list',
  title: 'state',
  noun: { one: 'person', other: 'personer' },
  empty: 'Ingen av dem är med i den öppna omgången.',
  fields: [
    { key: 'state', label: 'Samtal', format: 'status', tones: { Saknas: 'warn', Bokat: 'none', Hållet: 'ok' } },
    { key: 'at', label: 'När', format: 'instant', beside: true },
    { key: 'next', label: 'Nästa samtal', format: 'status', tones: { 'Inte bokat': 'warn' }, compact: true },
    { key: 'open', label: 'Åtgärdspunkter' },
    { key: 'overdue', label: 'Försenade', format: 'status', tones: { '*': 'warn' }, beside: true },
  ],
  open: { capability: TALKS_CONNECTOR + '.commitments', title: 'Åtgärdspunkter', params: { person: 'key' } },
};
/** One unit's round (artboard E): held of everyone due, the missing ones warning, and how many are booked. */
export const unitTalksView: View = {
  kind: 'list',
  title: 'held',
  noun: { one: 'enhet', other: 'enheter' },
  empty: 'Ingen på enheten är med i den öppna omgången.',
  fields: [
    { key: 'held', label: 'Hållna' },
    { key: 'missing', label: 'Saknas', format: 'status', tones: { '*': 'warn' } },
    { key: 'booked', label: 'Bokade' },
  ],
};
/** "Utvecklingssamtal 2026" over the list, "Senast lör 28 nov" under it; that the calendar did not answer is said there too. */
const headingOf = (round: RoundHeading | null) =>
  round
    ? {
        heading: round.label,
        note:
          `Senast ${swedishShortDay(round.dueOn)}` +
          (round.bookedUnknown ? ' · kalendern svarade inte, så bokade samtal kan saknas' : ''),
      }
    : {};

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
    // Offered to the model (D122 item 3): where each report stands, nothing a talk or an action point says.
    model: true,
    description:
      'Den öppna omgången av utvecklingssamtal och var varje medarbetare du är chef för står i den: namnet, om samtalet saknas, är bokat eller är hållet, när det är bokat eller hölls, och hur många åtgärdspunkter med medarbetaren som är öppna. Inget om vad som sades eller vad åtgärdspunkterna gäller. Tar ingen indata. Svarar med inga rader när ingen omgång är öppen. Varje rad har medarbetarens användarnamn.',
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
    // Closed to the model (D96 item 6): an action point's text is free text about a person. The registry holds every
    // system's action points from the model whatever this says.
    model: false,
    description: 'Åtgärdspunkter från utvecklingssamtal: dina egna, eller en persons du är chef för.',
    input: CommitmentsInputSchema,
    output: CommitmentsOutputSchema,
    view: commitmentsView,
    scope: () => true,
    // `person` is one of the reader's reports (D117); without it the reader reads their own. A report without a user name
    // is named by Clew's id, as the talks domain names them.
    person: { param: 'person', admits: ['managed'], ids: true },
    run: async (actor, input) => talks.commitments(await persona(actor), input),
  };
  const aboutPerson: Capability<Keys> = {
    name: TALKS_CONNECTOR + '.person',
    kind: 'read',
    title: 'Utvecklingssamtal',
    // A read about an entity: never a tool (D97 item 7, held by the loader). The model reads `talks.talks` instead.
    model: false,
    description:
      'Var varje person du är chef för står i den öppna omgången av utvecklingssamtal: saknas, bokat eller hållet, och hur många åtgärdspunkter som är öppna och försenade.',
    input: KeysSchema,
    output: PersonTalksOutputSchema,
    view: personTalksView,
    scope: { roles: ['manager'] },
    // The person's talk is written in the talk drawer (D96 item 7), the section's second way in. A query alone: the drawer
    // lies over whichever page the way in is drawn on, Personal or the person's own (D111 rule 5).
    about: { entity: 'person', page: { title: 'Öppna samtalet', href: '?talk={id}' } },
    // The round lists a manager's reports (D99): nobody else is asked about (D117).
    person: { admits: ['managed'] },
    run: async (actor, input) => {
      const { round, rows } = await talks.aboutPeople(await persona(actor), input.keys);
      return {
        ...headingOf(round),
        rows: rows.map(r => {
          const overdue = overdueWords(r.overdue);
          return {
            key: r.key,
            state: TALK_STATE_WORDS[r.state],
            ...(r.at ? { at: r.at } : {}),
            next: nextTalk(r.state, r.at),
            open: openWords(r.open),
            ...(overdue ? { overdue } : {}),
          };
        }),
      };
    },
  };
  const aboutUnit: Capability<Keys> = {
    name: TALKS_CONNECTOR + '.unit',
    kind: 'read',
    title: 'Utvecklingssamtal',
    // A read about an entity: never a tool (D97 item 7, held by the loader).
    model: false,
    description: 'Hur många på varje enhet du är chef för som har haft sitt utvecklingssamtal i den öppna omgången.',
    input: KeysSchema,
    output: UnitTalksOutputSchema,
    view: unitTalksView,
    scope: { roles: ['manager'] },
    // Every person's place in the round is the lens on Personal (D97 item 3).
    about: { entity: 'unit', page: { title: 'Visa i Personal', href: '/staff?show=' + aboutPerson.name } },
    // Only the units the reader manages are counted (D117).
    unit: { admits: ['manages'] },
    run: async (actor, input) => {
      const { round, rows } = await talks.aboutUnits(await persona(actor), input.keys);
      return {
        ...headingOf(round),
        rows: rows.map(r => {
          const missing = missingWords(r.missing),
            booked = bookedWords(r.booked);
          return {
            key: r.key,
            held: heldWords(r.held, r.due),
            ...(missing ? { missing } : {}),
            ...(booked ? { booked } : {}),
          };
        }),
      };
    },
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
    capabilities: [round as Capability, commitments as Capability, aboutPerson as Capability, aboutUnit as Capability],
  };
}
