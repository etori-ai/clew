import { Type, type Static } from 'typebox';
import { DIALOGUE_CONNECTOR, type Actor, type Capability, type Connector } from '@clew/connectors';
import { ENTITY_KEYS_MAX, type AuthenticatedContext, type View } from '@clew/contracts';
import { systemContext } from '../../system-context';
import { TONE_WORDS, openWords, overdueWords } from './domain';
import type { DialogueUsecases } from './usecases';

/**
 * The follow-up dialogue as Clew's built-in connector (D118 item 8). It answers two reads: `dialogue.unit`, the
 * dialogue of a unit in short, which Clew places as a section on the unit's page (first, since the source sorts first
 * among Clew's own) and as a column on Dialogstöd's overview; and `dialogue.activities`, the reader's own open
 * activities, which the owner's card opens. No read is a model tool and no view declares a `ref`, so no activity can be
 * added to a conversation as a chip: its text is free text about a unit's work. Writes are use cases behind Clew's own
 * routes, never capabilities. The use cases come built from composition (D25).
 */
export const DIALOGUE_SOURCE = 'Uppföljningsdialog';
const KeysSchema = Type.Object(
  { keys: Type.Array(Type.String({ minLength: 1, maxLength: 256 }), { maxItems: ENTITY_KEYS_MAX }) },
  { additionalProperties: false },
);
type Keys = Static<typeof KeysSchema>;
export const UnitDialogueOutputSchema = Type.Object(
  {
    rows: Type.Array(
      Type.Object(
        {
          key: Type.String({ minLength: 1, maxLength: 256 }),
          open: Type.Optional(Type.String({ maxLength: 40 })),
          alert: Type.Optional(Type.String({ maxLength: 4000 })),
          warn: Type.Optional(Type.String({ maxLength: 4000 })),
          state: Type.Optional(Type.String({ maxLength: 40 })),
          overdue: Type.Optional(Type.String({ maxLength: 40 })),
        },
        { additionalProperties: false },
      ),
      { maxItems: ENTITY_KEYS_MAX },
    ),
  },
  { additionalProperties: false },
);
const EmptySchema = Type.Object({}, { additionalProperties: false });
export const MyActivitiesOutputSchema = Type.Object(
  {
    rows: Type.Array(
      Type.Object(
        {
          text: Type.String({ maxLength: 4000 }),
          unit: Type.String({ maxLength: 200 }),
          area: Type.String({ maxLength: 120 }),
          dueOn: Type.Optional(Type.String({ maxLength: 10 })),
          due: Type.String({ maxLength: 40 }),
        },
        { additionalProperties: false },
      ),
      { maxItems: 500 },
    ),
  },
  { additionalProperties: false },
);
/**
 * One unit's dialogue in short: its open activities as the value, and as the state the areas that need action
 * ("Åtgärd krävs: Verksamhet") or watching ("Bevaka: Digital transformation"), so a reader knows which area to open; the
 * word is always in the value, never the colour alone. With nothing to act on or watch the state is "Bra", or "Inte
 * bedömd" until an area is assessed, so the section (the way into the drawer) and the cell on Dialogstöd still say
 * something. A unit with nothing open has no value, so the unit's page draws no key-figure tile for it.
 */
export const NOT_ASSESSED = 'Inte bedömd';
export const unitDialogueView: View = {
  kind: 'list',
  title: 'open',
  noun: { one: 'enhet', other: 'enheter' },
  empty: 'Uppföljningsdialogen har inget om enheten än.',
  fields: [
    { key: 'open', label: 'Aktiviteter' },
    // The first state with a value is the cell's badge: action before watching before the calm states.
    { key: 'alert', label: 'Läge', format: 'status', tones: { '*': 'alert' } },
    { key: 'warn', label: 'Läge', format: 'status', tones: { '*': 'warn' } },
    {
      key: 'state',
      label: 'Läge',
      format: 'status',
      tones: { [TONE_WORDS.ok]: 'ok', [NOT_ASSESSED]: 'none' },
    },
    { key: 'overdue', label: 'Försenade', format: 'status', tones: { '*': 'warn' }, beside: true },
  ],
};
/** The reader's open activities, the ones they own: what the owner's card opens with no input. */
export const myActivitiesView: View = {
  kind: 'list',
  title: 'text',
  noun: { one: 'aktivitet', other: 'aktiviteter' },
  empty: 'Du har inga öppna aktiviteter.',
  fields: [
    { key: 'text', label: 'Aktivitet' },
    { key: 'unit', label: 'Enhet' },
    { key: 'area', label: 'Område' },
    { key: 'due', label: 'Klart senast' },
  ],
};
/** "12 mars", or "Inget datum" for an activity without one (D49: an undated card says so). */
const dueWords = (dueOn: string | null) =>
  dueOn
    ? new Intl.DateTimeFormat('sv-SE', { timeZone: 'UTC', day: 'numeric', month: 'long' }).format(
        new Date(dueOn + 'T12:00:00Z'),
      )
    : 'Inget datum';

/** The persona a use case takes, built from the person's current grant as the other built-in connectors do. */
async function systemPersona(actor: Actor): Promise<AuthenticatedContext> {
  const persona = await systemContext(actor.id, 'connector:' + DIALOGUE_CONNECTOR);
  if (!persona) throw new Error('Okänd person.');
  return persona;
}

/** `persona` turns the registry's actor into a use-case persona; the unit tests hand in their own. */
export function dialogueConnector(
  dialogue: DialogueUsecases,
  persona: (actor: Actor) => Promise<AuthenticatedContext> = systemPersona,
): Connector {
  const aboutUnit: Capability<Keys> = {
    name: DIALOGUE_CONNECTOR + '.unit',
    kind: 'read',
    title: 'Uppföljningsdialog',
    model: false,
    description:
      'Uppföljningsdialogen för varje enhet du följer upp: hur många aktiviteter som är öppna och försenade, och vilka bedömda områden som kräver åtgärd eller bevakas.',
    input: KeysSchema,
    output: UnitDialogueOutputSchema,
    view: unitDialogueView,
    scope: { roles: ['manager'] },
    // The dialogue itself is written in the dialogue drawer over the unit's page (D118 item 8, D111 rule 5).
    about: { entity: 'unit', page: { title: 'Öppna dialogen', href: '?dialog={key}' } },
    // The units a manager follows up (D117, both records): those they manage and those below them; never one they are
    // only placed on.
    unit: { admits: ['manages', 'below'] },
    run: async (actor, input) => {
      const rows = await dialogue.aboutUnits(await persona(actor), input.keys);
      return {
        rows: rows.map(r => {
          const overdue = overdueWords(r.overdue);
          return {
            key: r.key,
            ...(r.open ? { open: openWords(r.open) } : {}),
            ...(r.alert.length ? { alert: `${TONE_WORDS.alert}: ${r.alert.join(', ')}` } : {}),
            ...(r.warn.length ? { warn: `${TONE_WORDS.warn}: ${r.warn.join(', ')}` } : {}),
            ...(r.alert.length || r.warn.length ? {} : { state: r.assessed ? TONE_WORDS.ok : NOT_ASSESSED }),
            ...(overdue ? { overdue } : {}),
          };
        }),
      };
    },
  };
  const mine: Capability<Record<string, never>> = {
    name: DIALOGUE_CONNECTOR + '.activities',
    kind: 'read',
    title: 'Mina aktiviteter',
    model: false,
    description: 'Dina öppna aktiviteter från uppföljningsdialogen, med enheten och området de gäller.',
    input: EmptySchema,
    output: MyActivitiesOutputSchema,
    view: myActivitiesView,
    scope: () => true,
    run: async actor => ({
      rows: (await dialogue.mine(await persona(actor))).map(a => ({
        text: a.text,
        unit: a.unit,
        area: a.area,
        ...(a.dueOn ? { dueOn: a.dueOn } : {}),
        due: dueWords(a.dueOn),
      })),
    }),
  };
  return {
    id: DIALOGUE_CONNECTOR,
    kind: 'core',
    source: DIALOGUE_SOURCE,
    areas: [],
    capabilities: [aboutUnit as Capability, mine as Capability],
  };
}
