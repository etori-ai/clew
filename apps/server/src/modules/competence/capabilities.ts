import { COMPETENCE_CONNECTOR, type Actor, type Capability, type Connector, type ThreadDraft } from '@clew/connectors';
import {
  AboutInputSchema,
  CompetenceAttentionInputSchema,
  CompetenceAttentionOutputSchema,
  CompetenceHoldingsInputSchema,
  CompetenceHoldingsOutputSchema,
  CompetenceStandingOutputSchema,
  type AboutInput,
  type AuthenticatedContext,
  type CompetenceAttentionInput,
  type CompetenceHoldingsInput,
  type View,
} from '@clew/contracts';
import { systemContext } from '../../system-context';
import { swedishDayAndMonth } from './domain';
import type { CompetenceUsecases } from './usecases';

/**
 * The competence module as Clew's built-in connector (D101 items 11 to 13): two reads with declared views and a third
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
 * Where one person stands, the read about a person (D97): Clew draws it as a section when the person is opened and as
 * a mark on their row where the status has a tone; the row opens the person's holdings.
 */
export const standingView: View = {
  kind: 'list',
  title: 'status',
  noun: { one: 'person', other: 'personer' },
  empty: 'Inga registrerade kompetenser.',
  fields: [
    { key: 'status', label: 'Status', format: 'status', tones: { expired: 'alert', expiring: 'warn' } },
    { key: 'expired', label: 'Har gått ut', format: 'number' },
    { key: 'expiring', label: 'Går ut inom 90 dagar', format: 'number' },
    { key: 'holdings', label: 'Registrerade', format: 'number' },
  ],
  open: { capability: COMPETENCE_CONNECTOR + '.holdings', title: 'Kompetenser', params: { person: 'person' } },
};
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
  const standing: Capability<AboutInput> = {
    name: COMPETENCE_CONNECTOR + '.standing',
    kind: 'read',
    title: 'Kompetens',
    model: false,
    description: 'Var en person står: om något intyg har gått ut eller går ut inom 90 dagar.',
    input: AboutInputSchema,
    output: CompetenceStandingOutputSchema,
    view: standingView,
    about: 'person',
    scope: () => true,
    run: async (actor, input) => competence.standing(await persona(actor), input.keys),
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
    capabilities: [attention as Capability, holdings as Capability, standing as Capability],
    /**
     * What needs a person (D101 item 12), derived from the dates each time and never stored: the card goes when a
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
