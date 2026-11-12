import { Type, type Static } from 'typebox';
import { COMPETENCE_CONNECTOR, type Actor, type Capability, type Connector, type ThreadDraft } from '@clew/connectors';
import {
  CompetenceAttentionInputSchema,
  CompetenceAttentionOutputSchema,
  CompetenceHoldingsInputSchema,
  CompetenceHoldingsOutputSchema,
  ENTITY_KEYS_MAX,
  type AuthenticatedContext,
  type CompetenceAttentionInput,
  type CompetenceHoldingsInput,
  type View,
  literals,
} from '@clew/contracts';
import { systemContext } from '../../system-context';
import { swedishDayAndMonth } from './domain';
import type { CompetenceUsecases } from './usecases';

/**
 * The competence module as Clew's built-in connector (D108 items 11 to 13): two reads with declared views and a third
 * about a person (D97), the area
 * whose figure says how much has run out among a manager's reports, and the scan that turns what needs a person into a
 * card. No read is a model tool, and neither view declares a `ref`, so no row can be added to a conversation as a chip.
 * Writes are use cases behind Clew's own routes, never capabilities. The use cases come built from composition (D25).
 */
export const COMPETENCE_SOURCE = 'Kompetens';
export const COMPETENCE_AREA = 'competence';
/** What has run out or runs out soon among the manager's reports: the figure and the manager's card open it. */
export const attentionView: View = {
  kind: 'table',
  title: 'name',
  noun: { one: 'intyg', other: 'intyg' },
  empty: 'Inget har gått ut och inget går ut inom 90 dagar.',
  fields: [
    { key: 'name', label: 'Namn' },
    { key: 'competence', label: 'Kompetens' },
    { key: 'status', label: 'Status', format: 'status', tones: { expired: 'alert', expiring: 'warn' } },
    { key: 'expiresOn', label: 'Giltigt till', format: 'date' },
  ],
};
/** One person's holdings: the reader's own with no input, a report's for their manager. */
export const holdingsView: View = {
  kind: 'list',
  title: 'competence',
  noun: { one: 'kompetens', other: 'kompetenser' },
  empty: 'Det finns inga registrerade kompetenser.',
  fields: [
    { key: 'competence', label: 'Kompetens' },
    { key: 'status', label: 'Status', format: 'status', tones: { expired: 'alert', expiring: 'warn' } },
    { key: 'expiresOn', label: 'Giltigt till', format: 'date' },
    { key: 'issuedOn', label: 'Utfärdat', format: 'date' },
    { key: 'area', label: 'Område' },
  ],
};
/**
 * The read about a person (D97): asked with a batch of user names, it answers one row per person the reader manages.
 * Clew places it from the declaration: a section on the opened person, a lens and a column on Personal when an
 * administrator chooses them, and a mark where the status warns. Never a model tool.
 */
const KeysSchema = Type.Object(
  { keys: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: ENTITY_KEYS_MAX }) },
  { additionalProperties: false },
);
type Keys = Static<typeof KeysSchema>;
/** Where a person stands, in the word a person reads; only what has run out or soon will has a tone. */
export const STANDING_WORDS = {
  expired: 'Utgånget',
  expiring: 'Går ut snart',
  valid: 'Giltigt',
  none: 'Inget registrerat',
} as const;
export const PersonCompetenceRowSchema = Type.Object(
  {
    key: Type.String({ minLength: 1, maxLength: 256 }),
    status: literals(Object.values(STANDING_WORDS)),
    due: Type.Optional(Type.String({ maxLength: 60 })),
    held: Type.String({ maxLength: 40 }),
  },
  { additionalProperties: false },
);
export const PersonCompetenceOutputSchema = Type.Object(
  { rows: Type.Array(PersonCompetenceRowSchema, { maxItems: ENTITY_KEYS_MAX }) },
  { additionalProperties: false },
);
/**
 * One person's competence in a row: the status as a badge, the one value where only one has room; beside it how many
 * have run out or soon will; then how many are registered. A row opens the person's holdings.
 */
export const personView: View = {
  kind: 'list',
  title: 'status',
  noun: { one: 'person', other: 'personer' },
  empty: 'Ingen av dem rapporterar till dig.',
  fields: [
    {
      key: 'status',
      label: 'Kompetens',
      format: 'status',
      tones: { [STANDING_WORDS.expired]: 'alert', [STANDING_WORDS.expiring]: 'warn' },
      compact: true,
    },
    { key: 'due', label: 'Att åtgärda', beside: true },
    { key: 'held', label: 'Registrerade' },
  ],
  open: { capability: COMPETENCE_CONNECTOR + '.holdings', title: 'Kompetenser', params: { person: 'key' } },
};
const dueWords = (expired: number, expiring: number) =>
  [...(expired ? [`${expired} har gått ut`] : []), ...(expiring ? [`${expiring} går ut inom 90 dagar`] : [])].join(
    ', ',
  );
/** The persona a use case takes, built from the person's current grant as the talks connector does. */
async function systemPersona(actor: Actor): Promise<AuthenticatedContext> {
  const persona = await systemContext(actor.id, 'connector:' + COMPETENCE_CONNECTOR);
  if (!persona) throw new Error('Okänd person.');
  return persona;
}
const plural = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;

/** `persona` turns the registry's actor into a use-case persona; the unit tests hand in their own. */
export function competenceConnector(
  competence: CompetenceUsecases,
  persona: (actor: Actor) => Promise<AuthenticatedContext> = systemPersona,
): Connector {
  const attention: Capability<CompetenceAttentionInput> = {
    name: COMPETENCE_CONNECTOR + '.attention',
    kind: 'read',
    title: 'Intyg att åtgärda',
    model: false,
    description: 'Intyg och kompetenser som har gått ut eller går ut inom 90 dagar bland dem du är chef för.',
    input: CompetenceAttentionInputSchema,
    output: CompetenceAttentionOutputSchema,
    view: attentionView,
    scope: { roles: ['manager'] },
    run: async actor => competence.attention(await persona(actor)),
  };
  const holdings: Capability<CompetenceHoldingsInput> = {
    name: COMPETENCE_CONNECTOR + '.holdings',
    kind: 'read',
    title: 'Mina kompetenser',
    model: false,
    description: 'Registrerade intyg och kompetenser: dina egna, eller en persons du är chef för.',
    input: CompetenceHoldingsInputSchema,
    output: CompetenceHoldingsOutputSchema,
    view: holdingsView,
    scope: () => true,
    run: async (actor, input) => competence.holdings(await persona(actor), input),
  };
  const aboutPerson: Capability<Keys> = {
    name: COMPETENCE_CONNECTOR + '.person',
    kind: 'read',
    title: 'Kompetens',
    model: false,
    description:
      'Var varje person du är chef för står: om något intyg har gått ut eller går ut inom 90 dagar, och hur många som är registrerade.',
    input: KeysSchema,
    output: PersonCompetenceOutputSchema,
    view: personView,
    scope: { roles: ['manager'] },
    // A certificate is registered on Personal, in the dialog (D108 item 7): the section's second way in.
    about: { entity: 'person', page: { title: 'Registrera intyg', href: '/staff?register={id}' } },
    run: async (actor, input) => {
      const { rows } = await competence.aboutPeople(await persona(actor), input.keys);
      return {
        rows: rows.map(r => {
          const due = dueWords(r.expired, r.expiring);
          return {
            key: r.key,
            status: STANDING_WORDS[r.expired ? 'expired' : r.expiring ? 'expiring' : r.holdings ? 'valid' : 'none'],
            ...(due ? { due } : {}),
            held: r.holdings ? `${r.holdings} registrerade` : 'Inga',
          };
        }),
      };
    },
  };
  return {
    id: COMPETENCE_CONNECTOR,
    kind: 'core',
    source: COMPETENCE_SOURCE,
    areas: [
      {
        id: COMPETENCE_AREA,
        title: 'Kompetens',
        roles: ['manager', 'employee'],
        standing: [attention.name, holdings.name],
        schedules: [],
        // Läget's tile (D54): how much has run out among the manager's reports. Nobody managed: no figure. Nothing
        // due is said as a calm sentence, so the tile does not disappear the day the last certificate is renewed.
        figure: async actor => {
          if (actor.role !== 'manager') return null;
          const s = await competence.summary(await persona(actor));
          if (!s || !s.reports) return null;
          if (!s.expired && !s.expiring) return { label: 'Inga intyg går ut inom 90 dagar.', tone: 'ok' };
          return {
            label: s.expired ? 'Intyg som har gått ut' : 'Intyg som går ut inom 90 dagar',
            value: String(s.expired || s.expiring),
            ...(s.expired && s.expiring ? { comparison: `${s.expiring} till går ut inom 90 dagar` } : {}),
            tone: s.expired ? 'alert' : 'warn',
            opens: attention.name,
          };
        },
      },
    ],
    capabilities: [attention as Capability, holdings as Capability, aboutPerson as Capability],
    /**
     * What needs a person (D108 item 12), derived from the dates each time and never stored: the card goes when a
     * certificate is registered. A person gets one card per holding of their own, with its end date as the deadline.
     * A manager gets one card that counts their reports' holdings and names nobody: its rows are the read it opens.
     */
    scan: async actor => {
      const reader = await persona(actor);
      const drafts: ThreadDraft[] = [];
      for (const s of await competence.ownAttention(reader)) {
        const day = swedishDayAndMonth(s.end!);
        const expired = s.status === 'expired';
        drafts.push({
          topic: `${COMPETENCE_CONNECTOR}:holding:${s.holding.id}`,
          area: COMPETENCE_AREA,
          title: expired ? `${s.type.name} gick ut ${day}` : `${s.type.name} går ut ${day}`,
          summary: expired
            ? 'Intyget gäller inte längre. Prata med din chef om att förnya det.'
            : 'Intyget behöver förnyas innan det går ut. Prata med din chef om nästa tillfälle.',
          reason: expired ? 'Har gått ut' : 'Går ut inom 90 dagar',
          deadline: s.end,
          actions: [
            { id: 'open', label: 'Visa mina kompetenser', capability: holdings.name, kind: 'read', role: 'primary' },
          ],
        });
      }
      const s = actor.role === 'manager' ? await competence.summary(reader) : null;
      if (s && (s.expired || s.expiring)) {
        const parts = [
          ...(s.expired ? [`${plural(s.expired, 'intyg har', 'intyg har')} gått ut`] : []),
          ...(s.expiring ? [`${plural(s.expiring, 'intyg går', 'intyg går')} ut inom 90 dagar`] : []),
        ];
        drafts.push({
          topic: `${COMPETENCE_CONNECTOR}:attention`,
          area: COMPETENCE_AREA,
          title: 'Intyg att åtgärda bland dina medarbetare',
          summary: `${parts.join(' och ')}, hos ${plural(s.people, 'person', 'personer')}.`,
          reason: s.expired ? 'Intyg har gått ut' : 'Intyg går ut inom 90 dagar',
          actions: [{ id: 'open', label: 'Visa intygen', capability: attention.name, kind: 'read', role: 'primary' }],
        });
      }
      return drafts;
    },
  };
}
