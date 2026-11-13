import { Type, type Static } from 'typebox';
import { BOARDING_CONNECTOR, type Actor, type Capability, type Connector, type ThreadDraft } from '@clew/connectors';
import {
  BOARDING_EVENT_WORDS,
  BoardingPlanInputSchema,
  BoardingPlanOutputSchema,
  ENTITY_KEY_MAX,
  ENTITY_KEYS_MAX,
  literals,
  type AuthenticatedContext,
  type BoardingPlanInput,
  type View,
} from '@clew/contracts';
import { systemContext } from '../../system-context';
import { PERSON_STATUS, dayWords, progressWords, suggestionCard, swedishDayAndMonth, waitingWords } from './domain';
import type { BoardingUsecases, PersonStanding } from './usecases';

/**
 * The boarding module as Clew's built-in connector (D124): kind `core`, bundled and switched off until an
 * administrator switches it on. It answers two reads and suggests: `boarding.person`, where each of the reader's
 * reports stands (a section on the person's page, a lens and a column on Personal), `boarding.plan`, one plan with its
 * items (what an item's card opens, and the plan's page), and a scan that suggests an introduction for a report whose
 * employment starts soon. No read is a model tool, no view declares a `ref` (a title a manager typed is free text about
 * a person), and nothing here writes: an owned domain's own writes are routes, not ledger executions (D96). The use
 * cases come built from composition (D25).
 */
export const BOARDING_SOURCE = 'Clew';
export const BOARDING_AREA = 'boarding';
const KeysSchema = Type.Object(
  { keys: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: ENTITY_KEYS_MAX }) },
  { additionalProperties: false },
);
type Keys = Static<typeof KeysSchema>;
const STATUS_WORDS = Object.values(PERSON_STATUS);
export const PersonBoardingRowSchema = Type.Object(
  {
    key: Type.String({ minLength: 1, maxLength: 256 }),
    status: literals(STATUS_WORDS),
    event: Type.Optional(Type.String({ maxLength: 40 })),
    day: Type.Optional(Type.String({ maxLength: 40 })),
    progress: Type.Optional(Type.String({ maxLength: 40 })),
    waiting: Type.Optional(Type.String({ maxLength: 40 })),
    /** The open plan's id: what a row opens. Absent when there is no plan. */
    plan: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  },
  { additionalProperties: false },
);
export const PersonBoardingOutputSchema = Type.Object(
  { rows: Type.Array(PersonBoardingRowSchema, { maxItems: ENTITY_KEYS_MAX }) },
  { additionalProperties: false },
);
/**
 * Where a report stands (D97): the plan's state as a badge (an overdue item warns, a start no plan covers alerts, a
 * plan whose items are all done is done), the event and its day beside it, how many items are done, and how many wait
 * for the reader, warning. A row with a plan opens it in place; the way in to the plan's page is `about.page`.
 */
export const personBoardingView: View = {
  kind: 'list',
  title: 'status',
  noun: { one: 'person', other: 'personer' },
  empty: 'Ingen av dem har någon introduktion eller något avslut på gång.',
  fields: [
    {
      key: 'status',
      label: 'Introduktion och avslut',
      format: 'status',
      tones: {
        [PERSON_STATUS.overdue]: 'warn',
        [PERSON_STATUS.missing]: 'alert',
        [PERSON_STATUS.complete]: 'ok',
      },
    },
    { key: 'day', label: 'Dag', beside: true },
    { key: 'event', label: 'Plan' },
    { key: 'progress', label: 'Klara' },
    { key: 'waiting', label: 'Väntar på dig', format: 'status', tones: { '*': 'warn' }, beside: true },
  ],
  open: { capability: BOARDING_CONNECTOR + '.plan', title: 'Planen', params: { plan: 'plan' } },
};
/** One plan's items as a list: what the card's read unfolds into. The page groups the same rows by phase. */
export const planView: View = {
  kind: 'list',
  title: 'title',
  noun: { one: 'uppgift', other: 'uppgifter' },
  empty: 'Planen har inga uppgifter som du kan se.',
  fields: [
    { key: 'title', label: 'Uppgift' },
    { key: 'status', label: 'Status', format: 'status', tones: { Försenad: 'warn', Klar: 'ok' }, beside: true },
    { key: 'dueOn', label: 'Senast', format: 'date' },
    { key: 'phaseLabel', label: 'När' },
    { key: 'owner', label: 'Ansvarig' },
  ],
};

/** A row of `boarding.person` from where the person stands. */
export function personRow(s: PersonStanding): Static<typeof PersonBoardingRowSchema> {
  if (!s.plan)
    return {
      key: s.key,
      status: PERSON_STATUS.missing,
      event: BOARDING_EVENT_WORDS.introduction,
      ...(s.missingFrom ? { day: dayWords('introduction', s.missingFrom) } : {}),
    };
  const waiting = waitingWords(s.plan.waiting);
  return {
    key: s.key,
    status:
      s.plan.state === 'overdue'
        ? PERSON_STATUS.overdue
        : s.plan.state === 'complete'
          ? PERSON_STATUS.complete
          : PERSON_STATUS.open,
    event: BOARDING_EVENT_WORDS[s.plan.event],
    day: dayWords(s.plan.event, s.plan.anchorOn),
    progress: progressWords(s.plan.done, s.plan.total),
    ...(waiting ? { waiting } : {}),
    plan: s.plan.id,
  };
}

/** The persona a use case takes, built from the person's current grant as the talks connector does. */
async function systemPersona(actor: Actor): Promise<AuthenticatedContext> {
  const persona = await systemContext(actor.id, 'connector:' + BOARDING_CONNECTOR);
  if (!persona) throw new Error('Okänd person.');
  return persona;
}

/** `persona` turns the registry's actor into a use-case persona; the unit tests hand in their own. */
export function boardingConnector(
  boarding: BoardingUsecases,
  persona: (actor: Actor) => Promise<AuthenticatedContext> = systemPersona,
): Connector {
  const plan: Capability<BoardingPlanInput> = {
    name: BOARDING_CONNECTOR + '.plan',
    kind: 'read',
    title: 'Plan',
    model: false,
    description:
      'En introduktion eller ett avslut med sina uppgifter: för chefen och den som planen gäller, och för den som har uppgifter i den.',
    input: BoardingPlanInputSchema,
    output: BoardingPlanOutputSchema,
    view: planView,
    // Whoever the plan concerns: the use case decides, since a plan named by its id is no person the registry
    // resolves (D117, as competence's approval read does).
    scope: () => true,
    run: async (actor, input) => boarding.plan(await persona(actor), input.plan),
  };
  const aboutPerson: Capability<Keys> = {
    name: BOARDING_CONNECTOR + '.person',
    kind: 'read',
    title: 'Introduktion och avslut',
    model: false,
    description:
      'Var varje person du är chef för står i sin introduktion eller sitt avslut: hur mycket som är klart, vad som väntar på dig och om en plan saknas inför en första dag.',
    input: KeysSchema,
    output: PersonBoardingOutputSchema,
    view: personBoardingView,
    // Whoever the server counts as having reports, not the session's role (D99): the use case answers for reports only.
    scope: () => true,
    // The plan's page for the person, by Clew's id: their plans, or starting one.
    about: { entity: 'person', page: { title: 'Öppna planen', href: '/boarding/{id}' } },
    // A manager's reports (D99): nobody else is asked about (D117).
    person: { admits: ['managed'] },
    run: async (actor, input) => ({
      rows: (await boarding.aboutPeople(await persona(actor), input.keys)).map(personRow),
    }),
  };
  return {
    id: BOARDING_CONNECTOR,
    kind: 'core',
    source: BOARDING_SOURCE,
    areas: [
      {
        id: BOARDING_AREA,
        title: 'Introduktion och avslut',
        roles: ['manager', 'employee'],
        standing: [],
        schedules: [],
      },
    ],
    capabilities: [plan as Capability, aboutPerson as Capability],
    /**
     * Clew suggests, the manager starts (D124): one card for each report whose employment starts within the
     * suggestion window with no introduction that covers it. The card names nobody in its title, summary or reason; the
     * person is its row's subject. Its read opens the person's place in boarding, where the manager starts the plan on
     * a day they confirm. Every card is one occurrence per person and start, so a card whose cause is gone (a plan was
     * started, the date passed or moved) is resolved at the next scan and a new start is a new card. The observation is
     * complete: it is the whole of the reader's reports, read now, and a read that fails throws, so the scan is never a
     * complete observation of nothing.
     */
    scan: async actor => {
      const { observedAt, suggestions } = await boarding.scanOf(await persona(actor));
      const drafts: ThreadDraft[] = suggestions.map(s => {
        const card = suggestionCard(s.personId, s.startOn);
        const key = s.userName && [...s.userName].length <= ENTITY_KEY_MAX ? s.userName : undefined;
        return {
          topic: card.topic,
          area: BOARDING_AREA,
          title: 'Förbered introduktionen',
          summary: `En medarbetare börjar ${swedishDayAndMonth(s.startOn)}. Starta introduktionen så att det som ska vara klart före första dagen hinns med.`,
          reason: 'Börjar snart',
          deadline: s.startOn,
          items: [
            {
              ref: `boarding:person:${s.personId}`,
              label: s.name,
              detail: dayWords('introduction', s.startOn),
              selectable: false,
              selected: false,
              ...(key ? { subject: { entity: 'person' as const, key } } : {}),
            },
          ],
          actions: key
            ? [
                {
                  id: 'prepare',
                  label: 'Visa introduktionen',
                  capability: aboutPerson.name,
                  kind: 'read' as const,
                  role: 'primary' as const,
                  target: 'panel' as const,
                  input: { keys: [key] },
                },
              ]
            : [],
          occurrences: [{ key: card.key, revision: card.revision, period: card.period }],
        };
      });
      return {
        drafts,
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
