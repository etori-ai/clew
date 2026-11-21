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
 * administrator switches it on. It answers three reads and suggests: `boarding.person`, where each of the reader's
 * reports stands (a section on the person's page, a lens and a column on Personal), `boarding.plans`, the same rows for
 * every report with the report's name (what the assistant reads beside Introduktion och avslut), `boarding.plan`, one
 * plan with its items (what an item's card opens, and the plan's page), and a scan that suggests an introduction for a
 * report whose employment starts soon. `boarding.plans` and `boarding.plan` are offered to the model (D122 item 3,
 * D141 rule 4), read as the person and nobody more; `boarding.person` is a read about an entity and stays closed, as
 * the loader holds every such read (D97 item 7). No view declares a `ref` (a title a manager typed is free text about a
 * person), the module logs no read, so the assistant's reads are logged nowhere either (D122 item 6), and nothing here
 * writes: an owned domain's own writes are routes, not ledger executions (D96). The use cases come built from
 * composition (D25).
 */
export const BOARDING_SOURCE = 'Clew';
/** The suggestion card's row: who it is about, without a name (the subject carries the person). */
export const NEW_HIRE_LABEL = 'Ny medarbetare';
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
/** The most reports `boarding.plans` lists. */
const PLANS_MAX = 500;
export const ReportBoardingRowSchema = Type.Object(
  {
    name: Type.String({ maxLength: 512 }),
    userName: Type.String({ minLength: 1, maxLength: 256 }),
    status: literals(STATUS_WORDS),
    event: Type.Optional(Type.String({ maxLength: 40 })),
    day: Type.Optional(Type.String({ maxLength: 40 })),
    progress: Type.Optional(Type.String({ maxLength: 40 })),
    waiting: Type.Optional(Type.String({ maxLength: 40 })),
    /** The open plan's id, which `boarding.plan` takes as `plan`. Absent when there is no plan. */
    plan: Type.Optional(Type.String({ minLength: 1, maxLength: 80 })),
  },
  { additionalProperties: false },
);
export const ReportsBoardingOutputSchema = Type.Object(
  {
    rows: Type.Array(ReportBoardingRowSchema, { maxItems: PLANS_MAX }),
    /** How many reports with a plan or a missing one there are beyond the rows given. */
    omitted: Type.Optional(Type.Integer({ minimum: 1 })),
  },
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
/**
 * Where every report stands (Introduktion och avslut, D141 rule 4): the report's name, then the same words as
 * `boarding.person`, and the plan's id, the one handle `boarding.plan` takes, drawn last so the model reads it too. A row
 * names its person (`subject`), and `boarding.person` answers the same rows asked by key (D127).
 */
export const reportsBoardingView: View = {
  kind: 'list',
  title: 'name',
  noun: { one: 'person', other: 'personer' },
  empty: 'Ingen av dina medarbetare har någon introduktion eller något avslut på gång.',
  fields: [
    { key: 'name', label: 'Namn' },
    ...(personBoardingView.kind === 'list' ? personBoardingView.fields : []),
    { key: 'plan', label: 'Planens id' },
  ],
  subject: { entity: 'person', key: 'userName' },
  byKey: BOARDING_CONNECTOR + '.person',
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
    // Offered to the model (D122 item 3): one plan as the person may read it, every item for its manager and the person
    // it concerns, only their own items for anyone else with items in it.
    model: true,
    description:
      'En introduktion eller ett avslut med sina uppgifter: varje uppgift, om den är klar, försenad eller att göra, sista dag, när i planen den ligger och vem som ansvarar för den. Ange planens id som plan; id:t står på raden för medarbetaren i Introduktion och avslut för dina medarbetare. Chefen och den som planen gäller läser alla uppgifter, den som har uppgifter i planen bara sina egna. Om någon annans plan svarar den inte.',
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
  // Offered to the model (D122 item 3, D141 rule 4): what Introduktion och avslut shows of the reader's reports, and
  // nobody else's. The model reads the rows here, since `boarding.person` takes keys and is never a tool.
  const plans: Capability<Record<string, never>> = {
    name: BOARDING_CONNECTOR + '.plans',
    kind: 'read',
    title: 'Introduktion och avslut för dina medarbetare',
    model: true,
    description:
      'Var varje medarbetare du är chef för står i sin introduktion eller sitt avslut: namnet, planens läge (pågår, försenad, klar, eller plan saknas inför en första dag), dagen planen gäller, hur många uppgifter som är klara och hur många som väntar på dig, och planens id. Bara medarbetare med en plan eller en som saknas finns med. Tar ingen indata. Svarar med inga rader för den som inte är chef. Varje rad har medarbetarens användarnamn; planens id tar Plan som plan.',
    input: Type.Object({}, { additionalProperties: false }),
    output: ReportsBoardingOutputSchema,
    view: reportsBoardingView,
    // Whoever the server counts as having reports, as `boarding.person` (D99): the use case answers for reports only.
    scope: () => true,
    run: async actor => {
      const rows = await boarding.reportStandings(await persona(actor));
      return {
        rows: rows.slice(0, PLANS_MAX).map(s => {
          const { key, ...row } = personRow(s);
          return { name: s.name, userName: key, ...row };
        }),
        ...(rows.length > PLANS_MAX ? { omitted: rows.length - PLANS_MAX } : {}),
      };
    },
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
    capabilities: [plan as Capability, aboutPerson as Capability, plans as Capability],
    /**
     * Clew suggests, the manager starts (D124): one card for each report whose employment starts within the
     * suggestion window with no introduction that covers it. The card names nobody, in its title, summary, reason or
     * row ("Ny medarbetare"); the person is the row's subject, by user name, and the read's input. Its read opens the person's place in boarding, where the manager starts the plan on
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
              // Never the name (vision principle 7): a card's rows reach the model when it is chipped, and erasure
              // finds a person by subject, not by a label. The person is the row's subject; the page finds them by it.
              label: NEW_HIRE_LABEL,
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
