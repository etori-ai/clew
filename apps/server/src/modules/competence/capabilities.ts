import { Type, type Static } from 'typebox';
import { COMPETENCE_CONNECTOR, type Actor, type Capability, type Connector, type ThreadDraft } from '@clew/connectors';
import {
  CompetenceAttentionInputSchema,
  CompetenceAttentionOutputSchema,
  CompetenceHoldingsInputSchema,
  CompetenceHoldingsOutputSchema,
  ENTITY_KEYS_MAX,
  INTEREST_WORD,
  SELF_RATED_WORD,
  type AuthenticatedContext,
  type CompetenceAttentionInput,
  type CompetenceAttentionOutput,
  type CompetenceHoldingsInput,
  type CompetenceHoldingsOutput,
  type View,
  type ViewField,
  literals,
} from '@clew/contracts';
import { systemContext } from '../../system-context';
import {
  APPROVAL_READ,
  confirmed,
  personStatus,
  swedishDayAndMonth,
  type CardIdentity,
  type MissingStanding,
} from './domain';
import type { CompetenceUsecases, UnitCoverageResult } from './usecases';

/**
 * The competence module as Clew's built-in connector (D108 items 6 and 11 to 13): two reads with declared views, a read
 * about a person and one about a unit (D97) with the table a unit's row opens, the area whose figure says how much has
 * run out or is missing among a manager's reports, and the scan that turns what needs a person into a card; and the read
 * an approval's card opens, a person's own registration that waits for the reader (item 7). Three reads are offered to the
 * model (D122 item 3), each read as the person who asks and nobody more: the reader's own holdings or a report's, what
 * needs doing among the reader's reports, and a unit's coverage in counts. What the model reads of them is derived from
 * their views as for every connector's read (`modelReading`): the views' labels, words and dates, no refs. The two reads about an entity stay closed, as the
 * loader holds every such read (D97 item 7), and so does the read behind an approval's card, which exists for that card
 * alone. No view declares a `ref`, so no row can be added to a conversation as a chip. Writes are use cases behind
 * Clew's own routes, never capabilities. The use cases come built from composition (D25).
 */
export const COMPETENCE_SOURCE = 'Kompetens';
export const COMPETENCE_AREA = 'competence';
/** Where a holding stands, as a badge's tone: what has run out or is missing alerts, what soon will warns. */
const statusTones = { expired: 'alert', missing: 'alert', expiring: 'warn' } as const;
/**
 * A copied row's source and when it was last read (D108 item 9), so the time of the read shows wherever a copied row is
 * listed; empty on a row registered in Clew.
 */
const copiedFields: ViewField[] = [
  { key: 'source', label: 'Källa' },
  { key: 'readAt', label: 'Inläst', format: 'instant', beside: true },
];
/**
 * What has run out, is missing or runs out soon among the manager's reports: the figure and the manager's card open it.
 * A missing row is a type required of the person that they hold nothing of that counts (D108 item 6), with no dates. A
 * skill's row (D120) says the level held, "Egen bedömning" beside it while no manager has confirmed it, and the least
 * level asked; the rows are kompetenser, since a skill is no certificate.
 */
export const attentionView: View = {
  kind: 'table',
  title: 'name',
  // The person a row names (D97 item 6): the name is the way to their page, and the user name is the key
  // `competence.holdings` takes as `person`, which is what the model reads beside the name.
  subject: { entity: 'person', key: 'userName' },
  noun: { one: 'kompetens', other: 'kompetenser' },
  empty: 'Inget saknas, inget har gått ut och inget går ut inom 90 dagar.',
  fields: [
    { key: 'name', label: 'Namn' },
    { key: 'competence', label: 'Kompetens' },
    { key: 'status', label: 'Status', format: 'status', tones: statusTones },
    { key: 'level', label: 'Nivå' },
    { key: 'assessment', label: 'Bedömning', format: 'status', tones: { [SELF_RATED_WORD]: 'none' }, beside: true },
    { key: 'required', label: 'Krävd nivå' },
    { key: 'expiresOn', label: 'Giltigt till', format: 'date' },
    ...copiedFields,
  ],
};
/**
 * One person's holdings: the reader's own with no input, a report's for their manager. A type required of the person
 * that they hold nothing of is a row with the status `missing` ("saknas"). A copied row whose type is not mapped is
 * listed under the source's label with the status `uncounted` ("räknas inte"), which has no tone. A skill (D120) says
 * its level, with "Egen bedömning" beside it while no manager has confirmed it and "Vill utveckla" where the person
 * wants to develop it, both neutral badges; a required skill it does not meet says the least level asked.
 */
export const holdingsView: View = {
  kind: 'list',
  title: 'competence',
  noun: { one: 'kompetens', other: 'kompetenser' },
  empty: 'Det finns inga registrerade kompetenser.',
  fields: [
    { key: 'competence', label: 'Kompetens' },
    // A person's own registration that waits or was rejected (D108 item 7) is a state with a word of its own, drawn as
    // a neutral badge: it needs nobody to act on the row.
    {
      key: 'status',
      label: 'Status',
      format: 'status',
      tones: { ...statusTones, 'awaiting-approval': 'none', rejected: 'none' },
    },
    { key: 'level', label: 'Nivå' },
    { key: 'assessment', label: 'Bedömning', format: 'status', tones: { [SELF_RATED_WORD]: 'none' }, beside: true },
    { key: 'interest', label: 'Utveckling', format: 'status', tones: { [INTEREST_WORD]: 'none' }, beside: true },
    { key: 'required', label: 'Krävd nivå' },
    { key: 'expiresOn', label: 'Giltigt till', format: 'date' },
    { key: 'issuedOn', label: 'Utfärdat', format: 'date' },
    { key: 'area', label: 'Område' },
    ...copiedFields,
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
/**
 * Where a person stands, in the word a person reads, in order of precedence (`personStatus`): something has run out,
 * something required is missing, something runs out soon, all is valid, nothing is registered. Only the first three have
 * a tone, so only they can be a mark.
 */
export const STANDING_WORDS = {
  expired: 'Utgånget',
  missing: 'Saknas',
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
 * have run out, are missing or soon run out; then how many are registered. A row opens the person's holdings.
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
      tones: {
        [STANDING_WORDS.expired]: 'alert',
        [STANDING_WORDS.missing]: 'alert',
        [STANDING_WORDS.expiring]: 'warn',
      },
      compact: true,
    },
    { key: 'due', label: 'Att åtgärda', beside: true },
    { key: 'held', label: 'Registrerade' },
  ],
  open: { capability: COMPETENCE_CONNECTOR + '.holdings', title: 'Kompetenser', params: { person: 'key' } },
};
const dueWords = (expired: number, missing: number, expiring: number) =>
  [
    ...(expired ? [`${expired} har gått ut`] : []),
    ...(missing ? [`${missing} saknas`] : []),
    ...(expiring ? [`${expiring} går ut inom 90 dagar`] : []),
  ].join(', ');
/** "a", "a och b", "a, b och c". */
const listWords = (parts: readonly string[]) =>
  parts.length < 2 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} och ${parts.at(-1)}`;
/**
 * A unit's coverage in a row (D108 items 6 and 8): how many of the reader's own reports on the unit's branch that
 * something is required of meet all of it, the ones who do not beside it, warning; then how many of the share targets
 * set on the unit are reached, the ones that are not beside them, warning. Counts only: a row names nobody. A row opens
 * the table per type and target.
 */
export const UnitCompetenceOutputSchema = Type.Object(
  {
    rows: Type.Array(
      Type.Object(
        {
          key: Type.String({ minLength: 1, maxLength: 256 }),
          covered: Type.String({ maxLength: 60 }),
          short: Type.Optional(Type.String({ maxLength: 40 })),
          targets: Type.Optional(Type.String({ maxLength: 60 })),
          below: Type.Optional(Type.String({ maxLength: 40 })),
        },
        { additionalProperties: false },
      ),
      { maxItems: ENTITY_KEYS_MAX },
    ),
  },
  { additionalProperties: false },
);
export const unitView: View = {
  kind: 'list',
  title: 'covered',
  noun: { one: 'enhet', other: 'enheter' },
  empty: 'Inga kompetenskrav gäller dina medarbetare på enheten.',
  fields: [
    { key: 'covered', label: 'Medarbetare som uppfyller kraven' },
    { key: 'short', label: 'Uppfyller inte', format: 'status', tones: { '*': 'warn' }, beside: true },
    { key: 'targets', label: 'Andelsmål' },
    { key: 'below', label: 'Under målet', format: 'status', tones: { '*': 'warn' }, beside: true },
  ],
  open: { capability: COMPETENCE_CONNECTOR + '.coverage', title: 'Kompetenstäckning', params: { unit: 'key' } },
};
/** What the table behind a unit's row takes: the unit, by id. */
export const CoverageInputSchema = Type.Object(
  { unit: Type.String({ minLength: 1, maxLength: 256 }) },
  { additionalProperties: false },
);
type CoverageInput = Static<typeof CoverageInputSchema>;
/** The words a coverage row says where it stands: met, not met, nobody to count, or too few to show. */
export const COVERAGE_WORDS = {
  met: 'Uppfyllt',
  short: 'Inte uppfyllt',
  none: 'Ingen att räkna',
  tooFew: 'För få för att visas',
} as const;
export const CoverageOutputSchema = Type.Object(
  {
    rows: Type.Array(
      Type.Object(
        {
          id: Type.String({ minLength: 1, maxLength: 120 }),
          competence: Type.String({ minLength: 1, maxLength: 120 }),
          goal: Type.String({ maxLength: 200 }),
          actual: Type.String({ maxLength: 60 }),
          state: literals(Object.values(COVERAGE_WORDS)),
        },
        { additionalProperties: false },
      ),
      { maxItems: 500 },
    ),
  },
  { additionalProperties: false },
);
/**
 * A unit's branch per required type and per share target set on the unit (D108 items 6 and 8): what is asked, of whom,
 * what is there, and whether it is met. A required type is counted over the reader's own reports, and its row says so;
 * a share target over everyone on the branch who holds its position, or not at all where too few of them are people the
 * reader does not know (`coverageOf`).
 */
export const coverageView: View = {
  kind: 'table',
  title: 'competence',
  noun: { one: 'krav', other: 'krav' },
  empty: 'Inga kompetenskrav gäller dina medarbetare på enheten.',
  fields: [
    { key: 'competence', label: 'Kompetens' },
    { key: 'goal', label: 'Vad som krävs' },
    { key: 'actual', label: 'Uppfyller' },
    {
      key: 'state',
      label: 'Läge',
      format: 'status',
      tones: { [COVERAGE_WORDS.met]: 'ok', [COVERAGE_WORDS.short]: 'warn' },
    },
  ],
};
const reportsWords = (n: number) => `${n} medarbetare`;
const cut = (text: string, max: number) => ([...text].length > max ? [...text].slice(0, max - 1).join('') + '…' : text);
/** The table's rows: the required types first, in the catalogue's order, then the share targets set on the unit. */
export function coverageRows(c: UnitCoverageResult) {
  return [
    ...c.requirements.map(r => ({
      id: 'requirement:' + r.type.id,
      competence: r.type.name,
      goal: `Krav för ${r.under} av dina medarbetare`,
      actual: `${r.meeting} av ${r.under}`,
      state: r.meeting === r.under ? COVERAGE_WORDS.met : COVERAGE_WORDS.short,
    })),
    ...c.targets.map(t => ({
      id: 'target:' + t.target.id,
      competence: t.type.name,
      goal: cut(`Minst ${t.target.minShare} % av alla på enheten med befattningen ${t.positionLabel}`, 200),
      actual: t.withheld
        ? '–'
        : t.share === null
          ? 'Ingen har befattningen'
          : `${t.share} %, ${t.meeting} av ${t.holders}`,
      state: t.withheld
        ? COVERAGE_WORDS.tooFew
        : t.met === null
          ? COVERAGE_WORDS.none
          : t.met
            ? COVERAGE_WORDS.met
            : COVERAGE_WORDS.short,
    })),
  ].slice(0, 500);
}
/** A unit's row: what is met of what is required of the reader's reports, and of the share targets, in counts only. */
function unitRow(c: UnitCoverageResult) {
  const short = c.under - c.meetingAll;
  const counted = c.targets.filter(t => t.met !== null);
  const below = counted.filter(t => !t.met).length;
  return {
    key: c.unitId,
    covered: c.under ? `${c.meetingAll} av ${reportsWords(c.under)}` : 'Inga krav på någon',
    ...(short ? { short: reportsWords(short) } : {}),
    ...(c.targets.length ? { targets: `${counted.length - below} av ${c.targets.length} nås` } : {}),
    ...(below ? { below: `${below} mål` } : {}),
  };
}
/** What the read behind an approval's card takes: the registration, by its holding's id. */
export const ApprovalInputSchema = Type.Object(
  { holding: Type.String({ minLength: 1, maxLength: 80 }) },
  { additionalProperties: false },
);
type ApprovalInput = Static<typeof ApprovalInputSchema>;
export const ApprovalOutputSchema = Type.Object(
  {
    rows: Type.Array(
      Type.Object(
        {
          name: Type.String({ minLength: 1, maxLength: 512 }),
          competence: Type.String({ minLength: 1, maxLength: 120 }),
          issuedOn: Type.String({ minLength: 10, maxLength: 10 }),
          expiresOn: Type.Optional(Type.String({ minLength: 10, maxLength: 10 })),
        },
        { additionalProperties: false },
      ),
      { maxItems: 1 },
    ),
  },
  { additionalProperties: false },
);
/**
 * A person's own registration that waits for the reader's decision (D108 item 7), as the one row of a table: who, which
 * competence, and its dates. It answers with rows, so a card's button that opens it leads to its page (D116), which the
 * web serves as the approval over the matrix, where the decision is made.
 */
export const approvalView: View = {
  kind: 'table',
  title: 'name',
  noun: { one: 'registrering', other: 'registreringar' },
  empty: 'Registreringen väntar inte på ditt beslut.',
  fields: [
    { key: 'name', label: 'Medarbetare' },
    { key: 'competence', label: 'Kompetens' },
    { key: 'issuedOn', label: 'Utfärdat', format: 'date' },
    { key: 'expiresOn', label: 'Giltigt till', format: 'date' },
  ],
};
/** The persona a use case takes, built from the person's current grant as the talks connector does. */
async function systemPersona(actor: Actor): Promise<AuthenticatedContext> {
  const persona = await systemContext(actor.id, 'connector:' + COMPETENCE_CONNECTOR);
  if (!persona) throw new Error('Okänd person.');
  return persona;
}
const plural = (n: number, one: string, other: string) => `${n} ${n === 1 ? one : other}`;
/**
 * What a person's card says of a required type they lack (D108 item 6). A skill (D120 item 4) says what would meet it:
 * their own rating, which waits for their manager to confirm it; a confirmed level that is not the one asked; or none
 * yet. A card names no particulars beyond the type in its title, as the certificate cards do, so no level is said: the
 * person's list says which is asked and which is held.
 */
export function missingSummary(s: MissingStanding): string {
  if (s.least === undefined)
    return 'Det här krävs i ditt arbete men finns inte registrerat för dig. Prata med din chef om hur du får det.';
  if (!s.held || s.held.level === null)
    return 'Det här krävs i ditt arbete. Lägg till färdigheten med din nivå, så kan din chef bekräfta den.';
  if (!confirmed(s.held))
    return 'Det här krävs i ditt arbete. Din egen bedömning räknas när din chef har bekräftat nivån.';
  return 'Det här krävs i ditt arbete på en högre nivå än den din chef har bekräftat. Prata med din chef om hur du kommer dit.';
}

/** `persona` turns the registry's actor into a use-case persona; the unit tests hand in their own. */
export function competenceConnector(
  competence: CompetenceUsecases,
  persona: (actor: Actor) => Promise<AuthenticatedContext> = systemPersona,
): Connector {
  // Offered to the model (D122 item 3): a manager's read of their own reports, the reports D99 gives them and nobody else.
  const attention: Capability<CompetenceAttentionInput, CompetenceAttentionOutput> = {
    name: COMPETENCE_CONNECTOR + '.attention',
    kind: 'read',
    title: 'Kompetenser att åtgärda',
    model: true,
    description:
      'Det som har gått ut, saknas eller går ut inom 90 dagar bland medarbetarna du är chef för, det som har gått ut först: medarbetarens namn, kompetensen, läget i ord och sista giltiga dag; för en färdighet nivån och den nivå som krävs. Tar ingen indata. Varje rad har medarbetarens användarnamn, som Mina kompetenser tar som person för att läsa allt medarbetaren har.',
    input: CompetenceAttentionInputSchema,
    output: CompetenceAttentionOutputSchema,
    view: attentionView,
    scope: { roles: ['manager'] },
    run: async actor => competence.attention(await persona(actor)),
  };
  // Offered to the model (D122 item 3): the reader's own holdings, or a report's. A call the assistant makes is never the
  // person's direct read, so the relation `registrar` is never resolved for it (D122 item 5), and a report's holdings
  // read by the assistant are logged as the assistant's (item 6).
  const holdings: Capability<CompetenceHoldingsInput, CompetenceHoldingsOutput> = {
    name: COMPETENCE_CONNECTOR + '.holdings',
    kind: 'read',
    title: 'Mina kompetenser',
    model: true,
    description:
      'Registrerade intyg, kompetenser och färdigheter med läget i dag (giltigt, går ut snart, utgånget, saknas) och vad som krävs: dina egna utan indata, eller en medarbetares du är chef för med medarbetarens användarnamn som person. Användarnamnet står vid en medarbetare du har nämnt och på varje rad i Kompetenser att åtgärda. Om någon annan svarar den inte. Varje kompetens har en rad som avgör läget: den med status giltigt, går ut snart, utgånget eller saknas, och dess Giltigt till är det som gäller. En rad som väntar på godkännande, är avvisad eller räknas inte avgör ingenting, även om den har samma namn.',
    input: CompetenceHoldingsInputSchema,
    output: CompetenceHoldingsOutputSchema,
    view: holdingsView,
    scope: () => true,
    // `person` is the reader or one of their reports (D117), or, for a reader who holds the relation `registrar` by
    // grant, anyone active of their organisation (D121 item 3: the one read in the repository that admits it, and the
    // registry tells no connector of it); without it the reader reads their own. Someone without a user name is named
    // by Clew's id, as the competence domain names them, as themself or a report only. Every read is logged (D121 item 5).
    person: { param: 'person', admits: ['self', 'managed', 'registrar'], ids: true },
    // What the registry resolved the person as (D117): the module reads someone as a registrar only when the registry
    // said so, which it does only on the person's own direct read (D121). Who made the call goes to the read log.
    run: async (actor, input, clew) =>
      competence.holdings(
        await persona(actor),
        input,
        input.person === undefined ? undefined : clew.about?.relations[input.person],
        clew.caller === 'assistant' ? 'assistant' : 'person',
      ),
  };
  const aboutPerson: Capability<Keys> = {
    name: COMPETENCE_CONNECTOR + '.person',
    kind: 'read',
    title: 'Kompetens',
    // A read about an entity, for Personal's column, lens and section: never a tool (D97 item 7, held by the loader).
    // What it counts, the model reads row by row from `competence.attention` and `competence.holdings`.
    model: false,
    description:
      'Var varje person du är chef för står: om något har gått ut, saknas eller går ut inom 90 dagar, och hur många kompetenser som är registrerade.',
    input: KeysSchema,
    output: PersonCompetenceOutputSchema,
    view: personView,
    scope: { roles: ['manager'] },
    // A certificate is registered on Personal, in the dialog (D108 item 7): the section's second way in.
    about: { entity: 'person', page: { title: 'Registrera intyg', href: '/staff?register={id}' } },
    // A manager's reports (D99), nobody else (D117).
    person: { admits: ['managed'] },
    run: async (actor, input) => {
      const { rows } = await competence.aboutPeople(await persona(actor), input.keys);
      return {
        rows: rows.map(r => {
          const due = dueWords(r.expired, r.missing, r.expiring);
          return {
            key: r.key,
            status: STANDING_WORDS[personStatus(r)],
            ...(due ? { due } : {}),
            held: r.holdings ? `${r.holdings} registrerade` : 'Inga',
          };
        }),
      };
    },
  };
  // Offered to the model (D122 item 3): counts over the reader's own reports on a unit they manage, naming nobody.
  const coverage: Capability<CoverageInput, { rows: ReturnType<typeof coverageRows> }> = {
    name: COMPETENCE_CONNECTOR + '.coverage',
    kind: 'read',
    title: 'Kompetenstäckning',
    model: true,
    description:
      'Hur många på en enhet du är chef för, och på enheterna under den, som uppfyller varje kompetenskrav, och hur andelsmålen nås: antal, inga namn. Ange enhetens id som unit; din egen enhets id är unitId i svaret från Vem är jag?.',
    input: CoverageInputSchema,
    output: CoverageOutputSchema,
    view: coverageView,
    scope: { roles: ['manager'] },
    // Only a unit the reader manages, counted over its branch (D99 item 5); the use case checks it, as Clew's own
    // domains do (D117), since a unit named in a plain input is not resolved by the registry.
    run: async (actor, input) => ({ rows: coverageRows(await competence.coverage(await persona(actor), input.unit)) }),
  };
  const aboutUnit: Capability<Keys> = {
    name: COMPETENCE_CONNECTOR + '.unit',
    kind: 'read',
    title: 'Kompetens',
    // A read about an entity, for a unit's page: never a tool (D97 item 7). `competence.coverage` is the model's.
    model: false,
    description:
      'Hur många på varje enhet du är chef för, och på enheterna under den, som uppfyller kompetenskraven, och hur många andelsmål som nås.',
    input: KeysSchema,
    output: UnitCompetenceOutputSchema,
    view: unitView,
    scope: { roles: ['manager'] },
    about: { entity: 'unit' },
    // Only the units the reader manages (D117); the counts are their branches' and name nobody (D99 item 5).
    unit: { admits: ['manages'] },
    run: async (actor, input) => ({
      rows: (await competence.aboutUnits(await persona(actor), input.keys)).map(unitRow),
    }),
  };
  const approval: Capability<ApprovalInput> = {
    name: APPROVAL_READ,
    kind: 'read',
    title: 'Intyg att granska',
    // The read behind an approval's card, which exists for that card's page alone: never a tool. What waits for the
    // reader's decision is on the matrix, and the model reads a report's waiting registration in `competence.holdings`.
    model: false,
    description: 'Ett intyg som en medarbetare har registrerat själv och som väntar på ditt beslut.',
    input: ApprovalInputSchema,
    output: ApprovalOutputSchema,
    view: approvalView,
    // Whoever the server counts as having reports, as the matrix is read: not the session's role, since a person whose
    // grant says employee may lead someone (D99). The use case refuses anyone the person does not report to.
    scope: () => true,
    // Only a registration of someone who reports to the reader now (D99 item 4); the use case checks it, as Clew's own
    // domains do (D117), since a holding named in a plain input is no person the registry resolves.
    run: async (actor, input) => {
      const a = await competence.approval(await persona(actor), input.holding);
      return {
        rows: [
          {
            name: a.name,
            competence: a.competence,
            issuedOn: a.issuedOn,
            ...(a.expiresOn ? { expiresOn: a.expiresOn } : {}),
          },
        ],
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
        // Läget's tile (D54): how much has run out or is missing among the manager's reports, then what soon runs out.
        // Nobody managed: no figure. Nothing due is said as a calm sentence, so the tile does not disappear the day the
        // last certificate is renewed.
        figure: async actor => {
          if (actor.role !== 'manager') return null;
          const s = await competence.summary(await persona(actor));
          if (!s || !s.reports) return null;
          if (!s.expired && !s.missing && !s.expiring)
            return { label: 'Inga kompetenser saknas eller går ut inom 90 dagar.', tone: 'ok' };
          const lacking = s.expired + s.missing;
          return {
            label: s.expired
              ? s.missing
                ? 'Kompetenser som har gått ut eller saknas'
                : 'Kompetenser som har gått ut'
              : s.missing
                ? 'Kompetenser som saknas'
                : 'Kompetenser som går ut inom 90 dagar',
            value: String(lacking || s.expiring),
            ...(lacking && s.expiring ? { comparison: `${s.expiring} till går ut inom 90 dagar` } : {}),
            tone: lacking ? 'alert' : 'warn',
            opens: attention.name,
          };
        },
      },
    ],
    capabilities: [
      attention as Capability,
      holdings as Capability,
      aboutPerson as Capability,
      aboutUnit as Capability,
      coverage as Capability,
      approval as Capability,
    ],
    /**
     * What needs a person (D108 item 12), derived from the dates and the requirements each time and never stored. A person
     * gets one card per competence of their own that has run out or soon will, with its end date as the deadline, and one
     * per required type they lack. A manager gets one card that counts their reports' and names nobody: its rows are the
     * read it opens.
     *
     * The scan is a complete observation of the person's scope (D47), and every card is one occurrence (`ownCard`,
     * `teamCard` in the domain): a card whose cause is gone (a certificate registered or renewed, a requirement removed,
     * a type archived) is resolved at the next scan; one whose cause stands is neither reopened nor duplicated; a cause
     * that comes back is a new period and so a new card. A person's card follows the person and the type, not a holding's
     * row, so a copied row read again under a new id keeps the card and its dismissal. The known limit: a requirement that
     * stops applying and applies again unchanged (a position or a unit gone and back under the same code or id) is the
     * same identity, so its card does not open again. The manager's card is one occurrence whose revision is its counts:
     * counts that change bring a handled card back, counts that stand do not. Whatever cannot be read throws, so the scan
     * is never a complete observation of nothing.
     */
    scan: async actor => {
      const { observedAt, own, team } = await competence.scanOf(await persona(actor), actor.role === 'manager');
      const drafts: ThreadDraft[] = [];
      const open = [
        { id: 'open', label: 'Visa mina kompetenser', capability: holdings.name, kind: 'read', role: 'primary' },
      ] as const;
      const occurrence = (card: CardIdentity) => [{ key: card.key, revision: card.revision, period: card.period }];
      for (const { standing: s, card } of own) {
        if (s.holding === null) {
          drafts.push({
            topic: card.topic,
            area: COMPETENCE_AREA,
            title: `${s.type.name} saknas`,
            summary: missingSummary(s),
            reason: 'Saknas',
            actions: [...open],
            occurrences: occurrence(card),
          });
          continue;
        }
        const day = swedishDayAndMonth(s.end!);
        const expired = s.status === 'expired';
        drafts.push({
          topic: card.topic,
          area: COMPETENCE_AREA,
          title: expired ? `${s.type.name} gick ut ${day}` : `${s.type.name} går ut ${day}`,
          summary: expired
            ? 'Intyget gäller inte längre. Prata med din chef om att förnya det.'
            : 'Intyget behöver förnyas innan det går ut. Prata med din chef om nästa tillfälle.',
          reason: expired ? 'Har gått ut' : 'Går ut inom 90 dagar',
          deadline: s.end,
          actions: [...open],
          occurrences: occurrence(card),
        });
      }
      if (team && (team.expired || team.missing || team.expiring)) {
        const parts = [
          ...(team.expired ? [`${plural(team.expired, 'kompetens har', 'kompetenser har')} gått ut`] : []),
          ...(team.missing ? [`${plural(team.missing, 'kompetens saknas', 'kompetenser saknas')}`] : []),
          ...(team.expiring ? [`${plural(team.expiring, 'kompetens går', 'kompetenser går')} ut inom 90 dagar`] : []),
        ];
        drafts.push({
          topic: team.card.topic,
          area: COMPETENCE_AREA,
          title: 'Kompetenser att åtgärda bland dina medarbetare',
          summary: `${listWords(parts)}, hos ${plural(team.people, 'person', 'personer')}.`,
          reason: team.expired
            ? 'Kompetenser har gått ut'
            : team.missing
              ? 'Kompetenser saknas'
              : 'Kompetenser går ut inom 90 dagar',
          actions: [
            { id: 'open', label: 'Visa kompetenserna', capability: attention.name, kind: 'read', role: 'primary' },
          ],
          occurrences: occurrence(team.card),
        });
      }
      return {
        drafts,
        observation: {
          scope: actor.unitId + ':' + actor.role,
          observedAt,
          version: observedAt,
          completeness: 'complete',
          exhausted: true,
        },
      };
    },
  };
}
