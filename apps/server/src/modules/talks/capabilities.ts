import { Type, type Static } from 'typebox';
import { TALKS_CONNECTOR, type Actor, type Capability, type Connector, type ThreadDraft } from '@clew/connectors';
import {
  CommitmentsInputSchema,
  CommitmentsOutputSchema,
  ENTITY_KEYS_MAX,
  ENTITY_KEY_MAX,
  TALK_STATES,
  TalksInputSchema,
  TalksOutputSchema,
  type AuthenticatedContext,
  type CommitmentsInput,
  type TalksInput,
  type View,
  literals,
  stockholmDate,
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
  swedishSpan,
  talkRef,
} from './domain';
import type { RoundHeading, TalkNotice, TalkUsecases } from './usecases';

/**
 * The talks module as Clew's built-in connector (D96 items 7 to 9): it answers the talks profile, `talks.talks` and
 * `talks.commitments`, while an administrator keeps it enabled, and declares the area whose figure is the share of
 * talks held. No read is a model tool, and neither view declares a `ref`, so no row can be added to a conversation as
 * a chip (item 6): the text of an action point is free text about a person. Writes are use cases behind Clew's own
 * routes, never capabilities, so nothing here is an action in a person's menu. Two reads say what their rows are about
 * (D97): `talks.person` and `talks.unit`. The connector's scan asks for the cards that hang on a talk's booking (D133).
 * The use cases come built from composition (D25).
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
/** "Utvecklingssamtal 2026" over the list, "Senast lör 28 nov" under it. */
const headingOf = (round: RoundHeading | null) =>
  round ? { heading: round.label, note: `Senast ${swedishShortDay(round.dueOn)}` } : {};

/** The row of a card about a person's talk: never their name (vision principle 7); the person is the row's subject. */
const NOTICE_LABEL = 'Medarbetare';
/**
 * What a card the scan asks for says (D133, D134), as the manager reads it: that the meeting was moved or is gone, that
 * a booked talk is coming and they need to prepare, or that its time has passed and it is theirs to say whether it was
 * held. How they prepare is theirs: the card leads to the talk, where the action points from last time are.
 */
function noticeWords(notice: TalkNotice): Pick<ThreadDraft, 'title' | 'summary' | 'reason'> {
  const stands = swedishSpan(notice.booking);
  if (notice.kind === 'prepare')
    return {
      title: 'Förbered utvecklingssamtalet',
      summary: `Ett utvecklingssamtal är bokat ${stands}. Öppna samtalet för att se åtgärdspunkterna från förra gången.`,
      reason: 'Bokat samtal',
    };
  if (notice.kind === 'held')
    return {
      title: 'Hölls utvecklingssamtalet?',
      summary: `Tiden för samtalet var ${stands}. Markera det som hållet, eller ta bort tiden om det inte blev av.`,
      reason: 'Tiden har passerat',
    };
  return notice.calendar === 'gone'
    ? {
        title: 'Mötet för ett utvecklingssamtal finns inte längre i kalendern',
        summary: `Samtalet i Clew står kvar på ${stands}. Öppna samtalet och välj om tiden ska stå kvar.`,
        reason: 'Borttaget i kalendern',
      }
    : {
        title: 'Mötet för ett utvecklingssamtal har flyttats i kalendern',
        summary: `Mötet ligger nu ${swedishSpan(notice.calendar)}. Samtalet i Clew står kvar på ${stands}. Öppna samtalet och välj vilken tid som gäller.`,
        reason: 'Flyttat i kalendern',
      };
}
/**
 * A card the scan asks for (D133, D134). It names nobody in its title, summary, reason or row: the person is the row's
 * subject, by user name, which the stream keeps as their id (`keyedDrafts`), and the input of the read the card opens,
 * the person's place in the round, from which the talk opens, by Clew's id (D122: Clew is the source). A reminder to
 * prepare is due the day of the talk. `open` names the two reads a card may open.
 */
function noticeDraft(notice: TalkNotice, open: { person: string; round: string }): ThreadDraft {
  const key = notice.userName && [...notice.userName].length <= ENTITY_KEY_MAX ? notice.userName : undefined;
  return {
    topic: notice.card.topic,
    area: 'talks',
    ...noticeWords(notice),
    ...(notice.kind === 'prepare' ? { deadline: stockholmDate(notice.booking.start) } : {}),
    items: [
      {
        ref: talkRef(notice.personId),
        label: NOTICE_LABEL,
        detail: swedishSpan(notice.booking),
        selectable: false,
        selected: false,
        ...(key ? { subject: { entity: 'person' as const, key } } : {}),
      },
    ],
    // A person provisioned without a user name cannot be a row's subject or be asked about (D97): their card opens the
    // round, where the manager finds the talk by its time.
    actions: [
      key
        ? {
            id: 'open',
            label: 'Visa samtalet',
            capability: open.person,
            kind: 'read' as const,
            role: 'primary' as const,
            target: 'panel' as const,
            input: { keys: [notice.personId] },
          }
        : {
            id: 'open',
            label: 'Visa omgången',
            capability: open.round,
            kind: 'read' as const,
            role: 'primary' as const,
            target: 'panel' as const,
          },
    ],
    occurrences: [{ key: notice.card.key, revision: notice.card.revision, period: notice.card.period }],
  };
}

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
    // `person` is one of the reader's reports (D117); without it the reader reads their own. A report without a user name
    // is named by Clew's id, as the talks domain names them.
    person: { param: 'person', admits: ['managed'], ids: true },
    run: async (actor, input) => talks.commitments(await persona(actor), input),
  };
  const aboutPerson: Capability<Keys> = {
    name: TALKS_CONNECTOR + '.person',
    kind: 'read',
    title: 'Utvecklingssamtal',
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
    // The round lists a manager's reports (D99): nobody else is asked about (D117). A card of the scan names the person
    // by Clew's id (D122), which the registry gives the read as the user name.
    person: { admits: ['managed'], ids: true },
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
    /**
     * The cards that hang on a talk's booking (D133, D134), derived from the talk's own record and the clock each time
     * and never stored: a meeting moved in the calendar or gone from it, a booked talk that is coming, and one whose time
     * has passed, for the manager whose booking it is. Every card is one occurrence
     * per person and round, so a card whose cause is gone (the manager settled it, or the calendar agrees again) is
     * resolved at the next scan, and one whose difference changed comes back. The observation is complete: the whole of
     * the reader's people, read now, and a read that fails throws, so the scan is never a complete observation of
     * nothing.
     */
    scan: async actor => {
      const { observedAt, notices } = await talks.scanOf(await persona(actor));
      return {
        drafts: notices.map(n => noticeDraft(n, { person: aboutPerson.name, round: round.name })),
        observation: {
          scope: actor.unitId + ':' + actor.role,
          observedAt,
          version: observedAt,
          completeness: 'complete' as const,
          exhausted: true,
        },
      };
    },
  };
}
