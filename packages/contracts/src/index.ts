import { Type, type Static, type TLiteral, type TSchema, type TSchemaOptions, type TUnion } from 'typebox';
import { Format } from 'typebox/format';
import { Settings } from 'typebox/system';
import { Value } from 'typebox/value';
import { DocumentReviewSchema, ReviewEvidenceSchema } from './presentation';
// Explicit exports keep these names visible to the Node ESM server through this package's CommonJS boundary.
export {
  MAX_DOCUMENT_BYTES,
  DocumentMediaSchema,
  DocumentSchema,
  DocumentBundleSchema,
  DocumentRequestSchema,
  ReviewEvidenceSchema,
  DocumentReviewSchema,
  ReviewRecoverySchema,
  MetricSchema,
  MetricsSchema,
  SeriesSchema,
  ActivitySchema,
  type DocumentDescriptor,
  type DocumentBundle,
  type DocumentRequest,
  type DocumentContent,
  type ReviewEvidence,
  type DocumentReview,
  type ReviewRecovery,
  type Metric,
  type Series,
  type Activity,
} from './presentation';

/** Identity as the browser may see it. Never carries tokens, bindings or grants. */
export interface SessionUser {
  id: string;
  name: string;
  unitId: string;
  unitLabel: string;
  role: 'manager' | 'employee';
}
/** In-process identity with a revalidation guard. Never serialised to the browser. */
export interface AuthenticatedContext extends SessionUser {
  organisationId: string;
  principal: { id: string; kind: 'person' };
  capabilities: string[];
  /** The external ids of the provisioned groups the person is in (D68): what a connector audience's `groups` match. Absent means none. */
  groups?: string[];
  /**
   * The person's provisioned `userName` (D68): the key another system knows them by, signed into a connector's actor
   * (D44, D97). Absent for a person provisioned without one. Never in `SessionUser`.
   */
  userName?: string;
  authorizationVersion: string;
  sessionBinding: string;
  expiresAt: string;
  authorize(): Promise<{ version: string }>;
  /** A token the IdP issued for `audience` by token exchange from this session (D26). Absent when no session is behind the context; undefined under a session without IdP tokens. */
  delegate?: (audience: string) => Promise<string | undefined>;
}
export const sessionUser = (c: SessionUser): SessionUser => ({
  id: c.id,
  name: c.name,
  unitId: c.unitId,
  unitLabel: c.unitLabel,
  role: c.role,
});

const object = <T extends Record<string, TSchema>>(properties: T, description?: string) =>
  Type.Object(properties, { additionalProperties: false, ...(description ? { description } : {}) });
/** `Type.Partial` and `Type.Omit` return a new object without the options of the one they were given, so a derived body says again that it is closed. */
const closed = { additionalProperties: false } as const;
/**
 * A union of literals drawn from a closed list, one `anyOf` branch per value. TypeBox reads a union's static type from a
 * tuple and `map` returns an array, so the list's member type is stated here.
 */
export const literals = <const V extends string | number>(values: readonly V[], options?: TSchemaOptions) =>
  Type.Union(
    values.map(value => Type.Literal(value)),
    options,
  ) as unknown as TUnion<[TLiteral<V>]>;
const instant = Type.String({ format: 'date-time', maxLength: 40 });
// TypeBox ships a `date-time` of its own (RFC 3339, lower-case `t` and an RFC 9557 suffix allowed). Clew's replaces it, so every schema with an instant is checked as it always was; Ajv (the routes) has its own.
Format.Set(
  'date-time',
  value =>
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value) &&
    !Number.isNaN(Date.parse(value)),
);
/** Whether a value fits a contract, checked with the `date-time` registered above. */
export const checkContract = <T extends TSchema>(schema: T, value: unknown): value is Static<T> =>
  Value.Check(schema, value);
/** One way a value fails a contract: where, as a JSON Pointer into the value (empty for the value itself), and why. */
export interface ContractProblem {
  path: string;
  message: string;
}
const pointerKey = (key: string) => key.replace(/~/g, '~0').replace(/\//g, '~1');
/** How many steps into the value a schema path takes: a property, an item or a record value is one, a union branch none. */
const valueDepth = (schemaPath: string) => {
  const steps = schemaPath.split('/').slice(1);
  let depth = 0;
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    if (step === 'properties' || step === 'patternProperties') (depth++, i++);
    else if (step === 'items' || step === 'additionalProperties') depth++;
    else if (step === 'anyOf') i++;
  }
  return depth;
};
const schemaAt = (schema: unknown, schemaPath: string) =>
  schemaPath
    .split('/')
    .slice(1)
    .reduce<unknown>(
      (at, step) => (at as Record<string, unknown> | undefined)?.[step.replace(/~1/g, '/').replace(/~0/g, '~')],
      schema,
    ) as { type?: string } | undefined;
/**
 * Every way a value fails a contract, in Clew's own words, so that what an administrator or a connector author reads
 * does not change with the validation library. A missing or an unexpected property is named at its own path, a value
 * that fits no branch of a union is one problem at the union, and a path is given one reason once. Empty when the value
 * passes. Every problem is listed (D60); a caller that names only the first passes `limit`, and the library then stops
 * looking early instead of walking a large body to its end.
 */
export function contractProblems(schema: TSchema, value: unknown, limit = Number.MAX_SAFE_INTEGER): ContractProblem[] {
  // TypeBox stops at `maxErrors`, eight unless told otherwise, and several of its errors can be one problem or none.
  // So the budget starts above the limit and grows until the limit is met or the library found nothing more.
  const { maxErrors } = Settings.Get();
  try {
    for (let budget = Math.min(Number.MAX_SAFE_INTEGER, Math.max(8, limit * 8)); ; budget *= 8) {
      Settings.Set({ maxErrors: budget });
      const errors = Value.Errors(schema, value);
      const cut = errors.length >= budget;
      // A type error may be followed by the literal's own, which replaces it: cut off there, it is not worded alone.
      const problems = worded(schema, cut && errors.at(-1)?.keyword === 'type' ? errors.slice(0, -1) : errors);
      if (!cut || problems.length >= limit) return problems.slice(0, limit);
    }
  } finally {
    Settings.Set({ maxErrors });
  }
}
function worded(schema: TSchema, errors: ReturnType<typeof Value.Errors>): ContractProblem[] {
  const literal = new Set(errors.filter(e => e.keyword === 'const').map(e => e.instancePath + ' ' + e.schemaPath));
  const problems: ContractProblem[] = [];
  const said = new Set<string>();
  const add = (path: string, message: string) => {
    if (said.has(path + ' ' + message)) return;
    said.add(path + ' ' + message);
    problems.push({ path, message });
  };
  for (const error of errors) {
    const { instancePath: path, schemaPath } = error;
    const branch = schemaPath.search(/\/anyOf\/\d+/);
    if (branch >= 0 || error.keyword === 'anyOf') {
      const union = branch >= 0 ? schemaPath.slice(0, branch) : schemaPath;
      const steps = path.split('/').slice(0, valueDepth(union) + 1);
      add(steps.join('/'), 'Expected union value');
      continue;
    }
    switch (error.keyword) {
      case 'required':
        for (const key of error.params.requiredProperties)
          add(`${path}/${pointerKey(key)}`, 'Expected required property');
        break;
      case 'additionalProperties':
        for (const key of error.params.additionalProperties) add(`${path}/${pointerKey(key)}`, 'Unexpected property');
        break;
      case 'boolean':
        // The schema `false` that closes an object: `additionalProperties` names the same property.
        if (!schemaPath.endsWith('/additionalProperties')) add(path, 'Unexpected value');
        break;
      case 'type':
        if (!literal.has(path + ' ' + schemaPath)) add(path, `Expected ${[error.params.type].flat().join(' or ')}`);
        break;
      case 'const': {
        const allowed = error.params.allowedValue;
        add(path, `Expected ${typeof allowed === 'string' ? `'${allowed}'` : String(allowed)}`);
        break;
      }
      case 'minLength':
        add(path, `Expected string length greater or equal to ${error.params.limit}`);
        break;
      case 'maxLength':
        add(path, `Expected string length less or equal to ${error.params.limit}`);
        break;
      case 'pattern':
        add(path, `Expected string to match '${error.params.pattern}'`);
        break;
      case 'format':
        add(path, `Expected string to match '${error.params.format}' format`);
        break;
      case 'minItems':
        add(path, `Expected array length to be greater or equal to ${error.params.limit}`);
        break;
      case 'maxItems':
        add(path, `Expected array length to be less or equal to ${error.params.limit}`);
        break;
      case 'uniqueItems':
        add(path, 'Expected array elements to be unique');
        break;
      case 'minimum':
      case 'maximum':
      case 'exclusiveMinimum': {
        const noun = schemaAt(schema, schemaPath)?.type === 'integer' ? 'integer' : 'number';
        const than = { minimum: 'greater or equal to', maximum: 'less or equal to', exclusiveMinimum: 'greater than' }[
          error.keyword
        ];
        add(path, `Expected ${noun} to be ${than} ${error.params.limit}`);
        break;
      }
      default:
        add(path, error.message);
    }
  }
  return problems;
}
const id = Type.String({ minLength: 1, maxLength: 80 });

/** A calendar occurrence as the browser sees it. Participant names stay inside the calendar surface. */
export const CalendarEventSchema = object({
  /**
   * The source's own handle for the occurrence, as its adapter names it: Nextcloud's is the base64 of the CalDAV path
   * and the recurrence, well over a hundred characters, so the short `id` of Clew's own rows does not fit it.
   */
  id: Type.String({ minLength: 1, maxLength: 1000 }),
  title: Type.String(),
  start: Type.String(),
  end: Type.String(),
  allDay: Type.Boolean(),
  mine: Type.Boolean(),
  room: Type.String(),
  participants: Type.Array(Type.String()),
  /** What a write needs (D11): the source's handle and its revision, whether the person may move or cancel it, and the organizer's name. */
  ref: Type.String(),
  revision: Type.String(),
  canCancel: Type.Boolean(),
  recurring: Type.Boolean(),
  organizer: Type.String(),
});
export type CalendarEvent = Static<typeof CalendarEventSchema>;

/**
 * A proposal's life (D13, D30): drawn, confirmed (invitation sent, undo open), final (undo closed), then what the invitee
 * answered: `accepted`, or `declined-by-invitee` (a counter-proposal, `counter`, is reserved for a source that can carry one).
 * `declined` is the manager's own no, `undone` a lost undo, `superseded` a redraw.
 */
export const ProposalStatus = Type.Union([
  Type.Literal('proposed'),
  Type.Literal('confirmed'),
  Type.Literal('final'),
  Type.Literal('accepted'),
  Type.Literal('declined-by-invitee'),
  Type.Literal('counter'),
  Type.Literal('undone'),
  Type.Literal('declined'),
  Type.Literal('superseded'),
]);
export type ProposalStatus = Static<typeof ProposalStatus>;
export const ProposalSchema = object({
  id: id,
  threadId: id,
  status: ProposalStatus,
  start: instant,
  end: instant,
  participant: object({ name: Type.String(), email: Type.String() }),
  eventRef: Type.Union([Type.String(), Type.Null()]),
  undoUntil: Type.Union([instant, Type.Null()]),
  /** Follow-ups sent to the invitee (D30): how many, and when the last one went. */
  reminders: Type.Integer(),
  remindedAt: Type.Union([instant, Type.Null()]),
});
export type Proposal = Static<typeof ProposalSchema>;

/** A room the calendar knows (D11): what a booking form offers and what the `calendar.rooms` read draws as a table. */
export const CalendarRoomSchema = object({
  ref: Type.String(),
  name: Type.String(),
  capacity: Type.Integer(),
  equipment: Type.Array(Type.String()),
});
export type CalendarRoom = Static<typeof CalendarRoomSchema>;
/** Today (`calendar.today`): the day's events and its free gaps. */
export const TodayViewSchema = object({
  date: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  events: Type.Array(CalendarEventSchema),
  gaps: Type.Array(object({ start: instant, end: instant })),
});
export type TodayView = Static<typeof TodayViewSchema>;
/** A week from a Monday with the person's live proposals; `calendar.week` answers it without the proposals. */
export const WeekViewSchema = object({
  from: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  events: Type.Array(CalendarEventSchema),
  proposals: Type.Array(ProposalSchema),
});
export type WeekView = Static<typeof WeekViewSchema>;
export const WeekEventsSchema = Type.Omit(WeekViewSchema, ['proposals'], closed);
/** One day with the person's live proposals: the side panel's day view and the dialog's day strip (D28). */
export const DayViewSchema = WeekViewSchema;
export type DayView = WeekView;
/** The four steps of an obligation (D30): drawn, sent, replies coming in, done. */
export const ObligationStepSchema = Type.Union([
  Type.Literal('forslag'),
  Type.Literal('inbjudningar'),
  Type.Literal('svar'),
  Type.Literal('klart'),
]);
export type ObligationStep = Static<typeof ObligationStepSchema>;
export const obligationSteps: readonly ObligationStep[] = ['forslag', 'inbjudningar', 'svar', 'klart'];
const sent = (s: ProposalStatus) => s === 'confirmed' || s === 'final';
const replied = (s: ProposalStatus) => s === 'accepted' || s === 'declined-by-invitee' || s === 'counter';
/** Where an obligation stands, from its proposals alone. */
export function obligationStep(proposals: Array<{ status: ProposalStatus }>): ObligationStep {
  if (proposals.some(p => p.status === 'proposed')) return 'forslag';
  const waiting = proposals.filter(p => sent(p.status)).length,
    answered = proposals.filter(p => replied(p.status)).length;
  if (waiting && !answered) return 'inbjudningar';
  if (waiting) return 'svar';
  return answered ? 'klart' : 'forslag';
}
/** The sum the Svar step shows: who said yes, who said no, who has not answered. */
export function replySummary(proposals: Array<{ status: ProposalStatus }>) {
  const accepted = proposals.filter(p => p.status === 'accepted').length,
    declined = proposals.filter(p => p.status === 'declined-by-invitee' || p.status === 'counter').length;
  const waiting = proposals.filter(p => sent(p.status)).length;
  return { accepted, declined, waiting, total: accepted + declined + waiting };
}

/** Something rendered on the page that the person can point at in the conversation (D12): a card, a row, an event, a proposal, a capability. */
export const ChipKind = Type.Union([
  Type.Literal('thread'),
  Type.Literal('item'),
  Type.Literal('event'),
  Type.Literal('proposal'),
  Type.Literal('capability'),
  Type.Literal('document'),
]);
export type ChipKind = Static<typeof ChipKind>;
export const ChipSchema = object({
  ref: Type.String({ minLength: 1, maxLength: 200, pattern: '^[a-z]+:[A-Za-z0-9:_.@-]+$' }),
  kind: ChipKind,
  label: Type.String({ maxLength: 200 }),
});
export type Chip = Static<typeof ChipSchema>;
/** Svar is a sentence or two, vy opens a view, forslag points at a proposal card, steg is a procedure as numbered steps (D26). */
export const AnswerShape = Type.Union([
  Type.Literal('svar'),
  Type.Literal('vy'),
  Type.Literal('forslag'),
  Type.Literal('steg'),
]);
export type AnswerShape = Static<typeof AnswerShape>;
/** A source the answer cites as `[n]` (D26): a ref the person can open or add to the conversation, never the text. */
export const SourceCitationSchema = object({
  n: Type.Integer({ minimum: 1 }),
  ref: Type.String({ maxLength: 260 }),
  label: Type.String(),
  source: Type.String(),
  link: Type.Optional(Type.String()),
  section: Type.Optional(Type.String()),
  owner: Type.Optional(Type.String()),
  reviewedAt: Type.Optional(instant),
  stale: Type.Union([Type.Boolean(), Type.Null()]),
});
export type SourceCitation = Static<typeof SourceCitationSchema>;
/** How the answer was produced: the model with read tools, the deterministic router, or the router because the configured model failed (D8). */
export const AssistantMode = Type.Union([Type.Literal('model'), Type.Literal('router'), Type.Literal('unavailable')]);
export type AssistantMode = Static<typeof AssistantMode>;
/** Which administered model produced an answer (D24): Clew's own id and the Swedish name the person chose it by. */
export const ModelRefSchema = object({ id: Type.String({ maxLength: 60 }), title: Type.String({ maxLength: 80 }) });
export type ModelRef = Static<typeof ModelRefSchema>;
/** A view the client can open in the side panel: a read capability and its input, rendered by Clew from the output. */
/** `declared` says the capability declares how it is drawn (D38), so the transcript may draw it under the answer without asking first. */
export const ViewRefSchema = object({
  capability: Type.String(),
  input: Type.Record(Type.String(), Type.Unknown()),
  title: Type.String(),
  source: Type.String(),
  declared: Type.Optional(Type.Boolean()),
});
export type ViewRef = Static<typeof ViewRefSchema>;

/**
 * The entities a source's rows can be about (D97): a closed list, as `CAPABILITIES` is. A new kind is a contract change
 * that comes with the core rule saying who may be asked about it. A source knows a person by their directory `userName`,
 * compared without regard to case (a person without one cannot be asked about), and Clew keeps the person's id (D119); a
 * unit's key is its unit id, on both sides.
 */
export const ENTITY_KINDS = ['person', 'unit'] as const;
export const EntityKind = literals(ENTITY_KINDS, {
  description:
    '`person`: a person in the directory, keyed on their provisioned `userName`. `unit`: a unit, keyed on its id.',
});
export type EntityKind = (typeof ENTITY_KINDS)[number];
export const isEntityKind = (value: string): value is EntityKind => (ENTITY_KINDS as readonly string[]).includes(value);
/**
 * The longest key an entity may be named by: a longer one names nobody. Counted as the schema counts it, in Unicode code
 * points (`[...key].length`), so the code beside the schema keeps every key the schema accepts.
 */
export const ENTITY_KEY_MAX = 256;
const entityKey = Type.String({
  minLength: 1,
  maxLength: ENTITY_KEY_MAX,
  description:
    "The entity's key. A source sends a person's `userName` and a unit's id. Clew resolves a user name as it arrives to the person of the reader's organisation who holds it then, and keeps that person's id (D119); a name nobody there holds names nobody.",
});
/** A row that names an entity (D97 item 6): a card row, a search hit or a view field may carry one, so it links to the entity. */
export const SubjectSchema = object(
  { entity: EntityKind, key: entityKey },
  "An entity a row names (D97): the web links the row to it. A source names a person by their `userName`, without regard to case, and a unit by its id. Clew resolves the user name as the row arrives, to whoever of the reader's organisation, active or not, holds it then, and keeps that person's id in its own records, so a later rename or reuse of the name moves nothing it kept (D119). A name nobody there holds names nobody: the row keeps its text and links nowhere. A reader only ever reaches an entity they may ask about.",
);
export type Subject = Static<typeof SubjectSchema>;
/**
 * A key as a source sends it, compared as Clew compares it there (D97): a person's user name without regard to case (RFC
 * 7643's default) and in its composed form (NFC, as a stored user name is), a unit's id exactly. Only for what arrives
 * from a source: Clew's own records key a person by the person's id (D119), compared exactly (`sameSubject`).
 */
export const foldSourceKey = (entity: EntityKind, key: string) =>
  entity === 'person' ? key.normalize('NFC').toLowerCase() : key;
/**
 * Whether two subjects of Clew's own records name the same entity (D119): a person by the person's id and a unit by its
 * id, both compared exactly. A source's key (a person's user name) is resolved to the id when it arrives.
 */
export const sameSubject = (a: Subject, b: Subject) => a.entity === b.entity && a.key === b.key;

/**
 * A declared view (D38): how a read capability's output is shown, said by the connector as data and drawn by Clew with
 * Astryx. A closed catalogue of kinds, fields with a Swedish label and a format, and nothing else: no layout, no
 * styling, no HTML. A capability without one is drawn by the generic panel rules, as before.
 */
const viewKey = Type.String({
  pattern: '^[A-Za-z][A-Za-z0-9]*$',
  maxLength: 40,
  description: "A property name in the capability's output (or input).",
});
const viewLabel = Type.String({ minLength: 1, maxLength: 60, description: 'Swedish. Shown to the person.' });
/** How a value is drawn: `phone` and `email` become links that call and write, `link` an http(s) link out, `status` a badge with a tone. */
export const ViewFormat = Type.Union(
  [
    Type.Literal('text'),
    Type.Literal('phone'),
    Type.Literal('email'),
    Type.Literal('link'),
    Type.Literal('date'),
    Type.Literal('instant'),
    Type.Literal('number'),
    Type.Literal('status'),
  ],
  {
    description:
      'How the value is drawn: `phone` and `email` become links that call and write, `link` an http(s) link out, `date` and `instant` are formatted in Swedish, `number` is aligned as one, `status` is a badge with a tone from `tones`. Default `text`.',
  },
);
export type ViewFormat = Static<typeof ViewFormat>;
export const ViewTone = Type.Union([
  Type.Literal('ok'),
  Type.Literal('warn'),
  Type.Literal('alert'),
  Type.Literal('none'),
]);
export type ViewTone = Static<typeof ViewTone>;
/** The key of `tones` that gives the tone of any other value that is present (D97): "2 försenade" warns, nothing does not. */
export const ANY_TONE = '*';
/** A word in its singular and plural (D71 amendment): "plats" and "platser", so one row reads "1 plats" and the rest "12 platser". */
export const ViewNounSchema = object(
  {
    one: Type.String({ minLength: 1, maxLength: 40, description: 'Swedish. The word after 1: "plats".' }),
    other: Type.String({
      minLength: 1,
      maxLength: 40,
      description: 'Swedish. The word after any other number: "platser".',
    }),
  },
  'A Swedish word in its singular and plural, drawn after a number.',
);
export type ViewNoun = Static<typeof ViewNounSchema>;
export const ViewFieldSchema = object({
  key: { ...viewKey, description: 'The property of a record the field shows.' },
  label: { ...viewLabel, description: "Swedish. The column heading or the field's name." },
  format: Type.Optional(ViewFormat),
  tones: Type.Optional(
    Type.Record(Type.String({ maxLength: 40 }), ViewTone, {
      description:
        'For `status`: the tone per value (a yes/no value is keyed `true` and `false`). The key `*` is the tone of any other value that is present, so a count such as "2 försenade" can warn while an absent value stays neutral (D97). A value without one is neutral; give a tone only to the value that needs the person.',
    }),
  ),
  unit: Type.Optional({
    ...ViewNounSchema,
    description:
      'For `number`: the unit drawn after the value, so a row reads "12 platser" and never "Platser: 12". Only where the unit alone says what the number is.',
  }),
  beside: Type.Optional(
    Type.Literal(true, {
      description:
        'Drawn in the same cell or on the same line as the field before it, under that field\'s label: a state and its time ("Bokat", "tors 12 nov kl. 09:00"), a count and what is late in it ("3 öppna", "2 försenade"). Never on the first field (D97).',
    }),
  ),
  compact: Type.Optional(
    Type.Literal(true, {
      description:
        'The row in one value ("tors 12 nov", "Inte bokat"): drawn where there is room for one value, a column on a list or a one-line summary, and left out where the whole row is drawn, a lens, a section or a detail. At most one field of a view (D97).',
    }),
  ),
});
export type ViewField = Static<typeof ViewFieldSchema>;
/**
 * The tone a field gives a value (D38, D97): the tone named for the value, else the `*` tone when the value is present
 * (not absent, null or empty), else `none`. The one reading of `tones`, for the browser and the server alike.
 */
export function fieldTone(field: Pick<ViewField, 'tones'>, value: unknown): ViewTone {
  const tones = field.tones;
  if (!tones) return 'none';
  const named = value === undefined || value === null ? undefined : tones[String(value)];
  if (named) return named;
  return value === undefined || value === null || value === '' ? 'none' : (tones[ANY_TONE] ?? 'none');
}
/** Whether a tone means the value needs the person (D97 item 2): what makes a mark on a row. */
export const needsPerson = (tone: ViewTone) => tone === 'warn' || tone === 'alert';
/** What the person may type or choose above the rows: each control is bound to one property of the capability's input, and a change reads the capability again. */
export const ViewInputSchema = object(
  {
    query: Type.Optional(
      object(
        {
          key: { ...viewKey, description: 'The input property the typed text is sent as.' },
          label: viewLabel,
          placeholder: Type.Optional(Type.String({ maxLength: 80, description: 'Swedish. Shown in the empty box.' })),
        },
        "A free-text box above the rows, bound to one property of the capability's input; typing reads the capability again.",
      ),
    ),
    filter: Type.Optional(
      object(
        {
          key: { ...viewKey, description: 'The input property the chosen value is sent as.' },
          label: viewLabel,
          options: Type.Array(
            object({
              value: Type.String({ minLength: 1, maxLength: 40, description: 'What is sent.' }),
              label: { ...viewLabel, description: 'Swedish. What the person reads.' },
            }),
            { minItems: 2, maxItems: 6, description: 'Two to six choices.' },
          ),
        },
        "A choice above the rows, bound to one property of the capability's input.",
      ),
    ),
  },
  "What the person may type or choose above the rows. Each control binds to one property of the capability's input, and a change reads the capability again.",
);
export type ViewInput = Static<typeof ViewInputSchema>;
/** A row opens another read of the same connector as a view: `params` maps that read's input properties to the row's. */
export const ViewOpenSchema = object(
  {
    capability: Type.String({ maxLength: 80, description: 'A read of the same connector, by full name.' }),
    title: { ...viewLabel, description: 'Swedish. The heading of what opens.' },
    params: Type.Record(
      Type.String({ maxLength: 40 }),
      { ...viewKey, description: 'The row property the value is taken from.' },
      {
        description:
          "The read's input property, mapped to the row property it is taken from. A row lacking a value does not open.",
      },
    ),
  },
  'A row opens another read of the same connector as a view (D35, D38).',
);
export type ViewOpen = Static<typeof ViewOpenSchema>;
/** A record names an entity (D97 item 6): the property holding its key, so the web links the row's title to the entity. */
export const RecordSubjectSchema = object(
  {
    entity: EntityKind,
    key: {
      ...viewKey,
      description:
        "The record property holding the entity's key, a string: a person's provisioned `userName`, a unit's id.",
    },
  },
  "The entity a record names (D97): the record property holding its key. Clew links the record's title to the entity for a reader who may open it, a person through the id of whoever of the reader's organisation holds the user name when the read is answered (D119); a record without the property, or whose user name nobody there holds, links nowhere.",
);
export type RecordSubject = Static<typeof RecordSubjectSchema>;
/**
 * What the model is handed when it calls the capability as a tool: the output, or only a summary (how many rows are
 * shown, never their content), so names and numbers reach the person through the view and neither the model nor the
 * stored conversation.
 */
const modelReads = Type.Optional(
  Type.Union([Type.Literal('output'), Type.Literal('summary')], {
    description:
      'What the model is handed when it calls the capability as a tool: the whole `output`, or a `summary` (how many rows are shown, never their content) so names and numbers reach the person through the view and neither the model nor the stored conversation. Default `output`.',
  }),
);
const rowsView = <K extends 'table' | 'list'>(kind: K) =>
  object({
    kind: Type.Literal(kind, {
      description:
        'What is drawn: `table` and `list` over an array of records, `detail` over one record, `text` over one Markdown string.',
    }),
    rows: Type.Optional({
      ...viewKey,
      description: 'The output property holding the array of records. Default `rows`.',
    }),
    title: {
      ...viewKey,
      description: 'The field that names a row; one of `fields`. A list shows it first, a detail as its heading.',
    },
    fields: Type.Array(ViewFieldSchema, {
      minItems: 1,
      maxItems: 12,
      description:
        'The columns of a table or the lines of a list: a record property, its Swedish label and how it is drawn.',
    }),
    ref: Type.Optional({
      ...viewKey,
      description:
        "The record property holding the connector's ref for the row, so a row can be added to the conversation as a chip. Without it rows cannot be chipped.",
    }),
    noun: Type.Optional({
      ...ViewNounSchema,
      description:
        'What a row is called, for the count in the view\'s header: "3 fakturor", "1 rum". Default "rad", "rader".',
    }),
    open: Type.Optional(ViewOpenSchema),
    subject: Type.Optional(RecordSubjectSchema),
    input: Type.Optional(ViewInputSchema),
    empty: Type.Optional(
      Type.String({ minLength: 1, maxLength: 120, description: 'Swedish. Shown when there are no rows.' }),
    ),
    modelReads,
  });
export const ViewSchema = Type.Union(
  [
    object({
      kind: Type.Literal('document', { description: 'Versioned original documents and attachments.' }),
      body: { ...viewKey, description: 'The output property holding the semantic payload for this view kind.' },
      modelReads,
    }),
    object({
      kind: Type.Literal('metrics', { description: 'Typed measurements, units, reporting periods and freshness.' }),
      body: viewKey,
      modelReads,
    }),
    object({
      kind: Type.Literal('activity', { description: 'Source events in chronological order.' }),
      body: viewKey,
      modelReads,
    }),
    object({
      kind: Type.Literal('series', { description: 'Comparable series drawn as a chart and a data table.' }),
      body: viewKey,
      chart: Type.Union([Type.Literal('line'), Type.Literal('bar')], {
        description: 'Line for trends, bar for category comparisons. Both include a data table.',
      }),
      modelReads,
    }),
    object({
      kind: Type.Literal('record', {
        description: 'A record with facts and bounded document, item, metric, series and activity sections.',
      }),
      title: viewKey,
      fields: Type.Array(ViewFieldSchema, {
        minItems: 1,
        maxItems: 24,
        description: 'Labelled facts in display order.',
      }),
      document: Type.Optional(viewKey),
      recovery: Type.Optional(viewKey),
      metrics: Type.Optional(viewKey),
      series: Type.Optional(viewKey),
      activity: Type.Optional(viewKey),
      items: Type.Optional(
        object(
          {
            rows: viewKey,
            title: viewKey,
            fields: Type.Array(ViewFieldSchema, {
              minItems: 1,
              maxItems: 12,
              description: 'The item fields in display order.',
            }),
          },
          'One flat item table, with at most 500 rows.',
        ),
      ),
      modelReads,
    }),
    rowsView('table'),
    rowsView('list'),
    object({
      kind: Type.Literal('detail', { description: 'One record, drawn as a list of labelled fields.' }),
      title: { ...viewKey, description: 'The property that names the record; drawn as the heading.' },
      fields: Type.Array(ViewFieldSchema, {
        minItems: 1,
        maxItems: 24,
        description: "The record's fields, in this order.",
      }),
      subject: Type.Optional(RecordSubjectSchema),
      modelReads,
    }),
    object({
      kind: Type.Literal('text', { description: 'One Markdown string.' }),
      body: { ...viewKey, description: 'The output property holding the Markdown.' },
      modelReads,
    }),
  ],
  {
    description:
      'How Clew draws the output: `table` and `list` over an array of records (`rows`, default "rows"; `title` names the field that names a row and is one of `fields`; `ref` the field holding the connector\'s ref), `detail` over one record, `text` over one Markdown string.',
  },
);
export type View = Static<typeof ViewSchema>;
const isViewRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
export const rowsKey = (view: View) =>
  view.kind === 'table' || view.kind === 'list' ? (view.rows ?? 'rows') : undefined;
/** The records a table or list draws, or undefined when the output does not hold them where the view says. */
export function viewRows(view: View, output: unknown): Record<string, unknown>[] | undefined {
  const key = rowsKey(view);
  if (!key || !isViewRecord(output) || !Array.isArray(output[key])) return undefined;
  return (output[key] as unknown[]).filter(isViewRecord);
}
/**
 * The keys a view's records name people by (`subject` on a person, D97 item 6), each once: a source's key, the user name,
 * which Clew resolves to the person's id before a name links to their page (D119, `PanelViewSpec.people`).
 */
export function subjectKeys(view: View, output: unknown): string[] {
  const subject = view.kind === 'table' || view.kind === 'list' || view.kind === 'detail' ? view.subject : undefined;
  if (subject?.entity !== 'person') return [];
  const records = view.kind === 'detail' ? (isViewRecord(output) ? [output] : []) : (viewRows(view, output) ?? []);
  return [
    ...new Set(
      records.flatMap(r => {
        const key = r[subject.key];
        return typeof key === 'string' && key ? [key] : [];
      }),
    ),
  ];
}
/**
 * The fields of a table or list that can mark a row (D97 item 2): those giving some value a `warn` or `alert` tone. A
 * read about an entity with one of them can mark the entity's row where an administrator chose the source.
 */
export const markFields = (view: View | undefined): ViewField[] =>
  view && (view.kind === 'table' || view.kind === 'list')
    ? view.fields.filter(f => Object.values(f.tones ?? {}).some(needsPerson))
    : [];
/** The view a row (or a search hit) opens: the declared read with its input taken from the row. Undefined when the row lacks a value the read needs. */
export function openRef(open: ViewOpen, row: Record<string, unknown>, source: string): ViewRef | undefined {
  const input: Record<string, unknown> = {};
  for (const [param, from] of Object.entries(open.params)) {
    const value = row[from];
    if (value === undefined || value === null || value === '') return undefined;
    input[param] = value;
  }
  return { capability: open.capability, input, title: open.title, source };
}
/** The declared view as the browser gets it beside the output: the declaration, whose it is, and whether a row can be added to the conversation. */
/**
 * `rowViews` is set for a view of Clew's own connectors only (the combined errand list, D35 item 4): each row may then
 * carry the view it opens (`view`, a ViewRef into the connector the row came from) and the output may name the systems
 * that did not answer (`unanswered`). A connector outside Clew never gets it, so its rows open only its own reads.
 */
export type PanelViewSpec = View & {
  capability: string;
  connector: string;
  source: string;
  chip: boolean;
  rowViews?: boolean;
  /**
   * The people the output's records name (`subject` on a person, D97 item 6), from the key on the record (the source's,
   * a user name) to Clew's key for the person, their id (D119), so a name links to `/people/<id>`. A key nobody of the
   * reader's organisation holds when the read is answered is absent, and its record links nowhere.
   */
  people?: Record<string, string>;
};

/**
 * A view as a tool in the menu (D40): one click away on every page, under Verktyg. Any read that declares a view and
 * opens without input can be one; an administrator chooses which, view by view. A connector may say what a view's row
 * is called and which of Clew's icons it carries; without that the row takes the capability's title and a plain icon. The same list of
 * icons serves an area (D41, D71): the area's icon marks its cards and views beside the area's name.
 */
export const MENU_ICONS = [
  'phone',
  'people',
  'book',
  'document',
  'chart',
  'search',
  'clock',
  'link',
  'calendar',
  'bell',
] as const;
export const MenuIconSchema = literals(MENU_ICONS, {
  description: "One of Clew's icons. The connector sends a name, never a drawing.",
});
export type MenuIcon = (typeof MENU_ICONS)[number];
export const MenuHintSchema = Type.Object(
  {
    label: Type.String({
      minLength: 1,
      maxLength: 24,
      description: 'Swedish. The row in the menu, the name of the tool: "Telefonbok".',
    }),
    icon: MenuIconSchema,
  },
  {
    additionalProperties: false,
    description:
      "How this capability's view is named and marked when an administrator puts it in Clew's menu under Verktyg (D40). Only on a read that declares a view and needs no input.",
  },
);
export type MenuHint = Static<typeof MenuHintSchema>;
/** A menu row as the browser gets it: a view an administrator put in the menu, only for a person who may call its read. */
export const MenuEntrySchema = object({
  connector: Type.String(),
  source: Type.String(),
  capability: Type.String(),
  title: Type.String(),
  label: Type.String(),
  icon: MenuIconSchema,
});
export type MenuEntry = Static<typeof MenuEntrySchema>;
/**
 * A connected system as the browser gets it for its mark (D71): the source's word and its place in the order the
 * administrator registered the systems, which gives the mark its hue. `ordinal` is null for Clew's own (the house).
 */
export const SystemMarkSchema = object({
  connector: Type.String(),
  source: Type.String(),
  ordinal: Type.Union([Type.Integer({ minimum: 1 }), Type.Null()]),
});
export type SystemMark = Static<typeof SystemMarkSchema>;
/**
 * The ordinal a newly registered system takes (D71): the lowest one no other system holds. A removed system frees its
 * place and its colour for the next one, and the others keep theirs.
 */
export const nextOrdinal = (taken: Iterable<number | null | undefined>) => {
  const held = new Set(taken);
  let n = 1;
  while (held.has(n)) n++;
  return n;
};

/** What a search can find (D26): a document or a passage of one, a person, a case, a room. */
export const SearchKind = Type.Union([
  Type.Literal('document'),
  Type.Literal('person'),
  Type.Literal('case'),
  Type.Literal('room'),
]);
export type SearchKind = Static<typeof SearchKind>;
/**
 * One thing a connector's `<id>.search` found (D26): found text with where it lives and who keeps it current. `ref` is
 * the connector's own id for it, stable, and what `<id>.fetch` takes back. Clew stores refs, never the text.
 */
export const SearchHitSchema = object({
  ref: Type.String({ minLength: 1, maxLength: 200, pattern: '^[A-Za-z0-9:_.@-]+$' }),
  kind: SearchKind,
  /** Swedish or the document's own title. */
  label: Type.String({ minLength: 1, maxLength: 200 }),
  /** The passage that matched, or a summary; what the model reads and the person sees under the title. */
  snippet: Type.String({ maxLength: 1200 }),
  /** Where to open it, in the source system. */
  link: Type.Optional(Type.String({ maxLength: 1000 })),
  /** The source as shown to the person: "Eneo", "Intranätet". */
  source: Type.String({ minLength: 1, maxLength: 80 }),
  /** The heading of the passage inside the document, when the source knows it. */
  section: Type.Optional(Type.String({ maxLength: 200 })),
  /** Who keeps the document current: a role or a unit, never a person's name. */
  owner: Type.Optional(Type.String({ maxLength: 120 })),
  updatedAt: Type.Optional(instant),
  /** When the document was last reviewed, and how often the owner means to; the composite marks it stale from these. */
  reviewedAt: Type.Optional(instant),
  reviewIntervalDays: Type.Optional(Type.Integer({ minimum: 1, maximum: 3650 })),
  /** The source's own relevance, higher is better; only compared within one source. */
  score: Type.Optional(Type.Number()),
  /** The person or unit the hit is (D97 item 6): hits from several sources about the same one become one. */
  subject: Type.Optional(SubjectSchema),
});
export type SearchHit = Static<typeof SearchHitSchema>;
/** What `<id>.search` returns. */
export const SearchOutputSchema = object({ rows: Type.Array(SearchHitSchema, { maxItems: 50 }) });
export type SearchOutput = Static<typeof SearchOutputSchema>;
/** One source's part in a fan-out: it answered, it did not answer, or it did not answer in time. */
export const SearchSourceSchema = object({
  id: Type.String(),
  source: Type.String(),
  status: Type.Union([Type.Literal('ok'), Type.Literal('unavailable'), Type.Literal('timeout')]),
});
export type SearchSource = Static<typeof SearchSourceSchema>;
/** What the composite `clew.search` returns: merged hits, each marked stale or not (null when the source gives no date), and every source's status. */
export const SearchResultSchema = object({
  /**
   * `view` is the read that shows this hit in the panel, when its source declares one (D38): a person's contact card, a
   * case. `sources` is set on a hit that several sources found about the same entity (D97 item 6): every source that
   * answered for it, the hit's own first, in the order their hits came; the hit itself is the first one's.
   */
  rows: Type.Array(
    object({
      ...SearchHitSchema.properties,
      stale: Type.Union([Type.Boolean(), Type.Null()]),
      connector: Type.String(),
      view: Type.Optional(ViewRefSchema),
      sources: Type.Optional(Type.Array(object({ connector: Type.String(), source: Type.String() }), { minItems: 2 })),
    }),
  ),
  sources: Type.Array(SearchSourceSchema),
});
export type SearchResult = Static<typeof SearchResultSchema>;
/**
 * The shared state of an errand (D89): whose move it is, in words every case system can answer in, so that lists from
 * several systems are ordered together. The order here is the order a list is drawn in.
 */
export const ERRAND_STATES = ['waiting-on-me', 'new', 'active', 'waiting-on-others', 'closed'] as const;
export const ErrandState = literals(ERRAND_STATES, {
  description:
    '`waiting-on-me`: the person has to act. `new`: nobody has started. `active`: being handled. `waiting-on-others`: someone else has to act. `closed`: finished.',
});
export type ErrandState = (typeof ERRAND_STATES)[number];
/**
 * One errand as a case system's connector lists it (D35, D89): what Clew needs to list, order and make a card of, and
 * nothing that names a person. The free text and everything only one system has are in the connector's own view.
 */
export const ErrandRowSchema = object(
  {
    ref: Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: '^errand:[a-z][a-z0-9-]*:[A-Za-z0-9:_.-]+$',
      description:
        "`errand:<connector id>:<the system's own identity>`, stable. What `<id>.errand` takes back. Clew treats it as opaque.",
    }),
    label: Type.String({
      minLength: 1,
      maxLength: 200,
      description:
        'The errand number and the category or type display name. Never the title, a name or an account: it is the only errand text a card title or a conversation may carry.',
    }),
    state: ErrandState,
    status: Type.String({ minLength: 1, maxLength: 80, description: "Swedish. The system's own name for the status." }),
    waitingOn: Type.Optional(
      Type.String({ minLength: 1, maxLength: 80, description: 'Swedish. Who or what the errand waits on.' }),
    ),
    since: { ...instant, description: 'When the errand last changed.' },
    dueAt: Type.Optional({ ...instant, description: 'The deadline, where the system has one on the errand.' }),
    area: Type.String({
      minLength: 1,
      maxLength: 80,
      description:
        'Swedish. The business area or namespace, as a label. Clew never reads it for access: the case system decides what the person sees.',
    }),
    link: Type.Optional(Type.String({ maxLength: 1000, description: 'The errand in its own system.' })),
  },
  "One errand in a case system's list (D35, D89).",
);
export type ErrandRow = Static<typeof ErrandRowSchema>;
/** What `<id>.errands` returns. */
export const ErrandsOutputSchema = object(
  { rows: Type.Array(ErrandRowSchema, { maxItems: 500 }) },
  "What `<id>.errands` returns: the person's errands in this system, as the system lets them see them.",
);
export type ErrandsOutput = Static<typeof ErrandsOutputSchema>;
/** What `<id>.errands` and the composite `clew.errands` take: the errands assigned to the person or their group, or the ones the person reported. */
export const ErrandsInputSchema = object({
  view: Type.Optional(Type.Union([Type.Literal('assigned'), Type.Literal('reported')])),
});
export type ErrandsInput = Static<typeof ErrandsInputSchema>;
/**
 * What the composite `clew.errands` returns (D35 item 4): every system's rows in one list, each marked with the
 * connector it came from and the view that opens it there, and every system's part in the answer. `unanswered` names
 * the systems that did not answer, as a person reads them.
 */
export const ErrandsResultSchema = object({
  rows: Type.Array(
    object({
      ...ErrandRowSchema.properties,
      connector: Type.String(),
      system: Type.String(),
      view: Type.Optional(ViewRefSchema),
    }),
  ),
  systems: Type.Array(SearchSourceSchema),
  unanswered: Type.Array(Type.String()),
});
export type ErrandsResult = Static<typeof ErrandsResultSchema>;
/** A calendar day, `YYYY-MM-DD`, read in Swedish time: a round's dates, the day a talk was held, an action point's due date. */
const calendarDay = Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$', maxLength: 10 });
/** A user's account name as provisioned (SCIM `userName`, D68): what another system knows a person by, since it cannot know Clew's ids. */
const userName = Type.String({ minLength: 1, maxLength: 512 });
/** A link into the answering system. Absolute http(s) only, so a page can put it in an `href`. */
const sourceLink = Type.String({ maxLength: 1000, pattern: '^https?://[^\\s]+$' });
/**
 * Where one person stands in the round of development talks (D96 item 2): no talk yet, a talk in the calendar, or held.
 * The order here is the order a list is drawn in.
 */
export const TALK_STATES = ['missing', 'booked', 'held'] as const;
export const TalkState = literals(TALK_STATES, {
  description:
    '`missing`: no talk is booked or held. `booked`: a talk is in the calendar. `held`: the manager has marked it held.',
});
export type TalkState = (typeof TALK_STATES)[number];
/** The period in which every person on a unit is due a talk with the unit's manager (D96 item 1). */
export const TalkRoundSchema = object(
  {
    label: Type.String({ minLength: 1, maxLength: 120, description: 'Swedish. The round as a person reads it.' }),
    opensOn: { ...calendarDay, description: 'The first day of the round.' },
    dueOn: { ...calendarDay, description: 'The day every talk of the round is due.' },
  },
  'The open round of development talks (D96 item 1).',
);
export type TalkRound = Static<typeof TalkRoundSchema>;
/**
 * One person in the round as the answering system lists them for a manager (D96 items 2 and 8): who, where they stand
 * and how many action points are open. Keyed on the user name; nothing of the talk's content.
 */
export const TalkRowSchema = object(
  {
    ref: Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: '^talk:[a-z][a-z0-9-]*:[A-Za-z0-9:_.-]+$',
      description: "`talk:<connector id>:<the system's own identity>`, stable. Clew treats it as opaque.",
    }),
    userName: { ...userName, description: 'The employee the talk is with, by their provisioned user name.' },
    name: Type.String({ minLength: 1, maxLength: 512, description: "The employee's name." }),
    state: TalkState,
    at: Type.Optional(
      Type.Union([calendarDay, instant], {
        description:
          "When the talk is booked (an instant), or the day it was held (a date). Absent when missing, and for a booked talk whose time the reader may not see, such as one another of the person's managers booked.",
      }),
    ),
    openCommitments: Type.Integer({
      minimum: 0,
      description: 'How many action points with this employee are open, from this round and earlier ones.',
    }),
    link: Type.Optional({ ...sourceLink, description: 'The talk in its own system.' }),
  },
  'One person in the round of development talks (D96).',
);
export type TalkRow = Static<typeof TalkRowSchema>;
/** What `<id>.talks` takes: nothing; the round and the people are the answering system's for the reader. */
export const TalksInputSchema = object({});
export type TalksInput = Static<typeof TalksInputSchema>;
/** What `<id>.talks` returns. */
export const TalksOutputSchema = object(
  {
    round: Type.Union([TalkRoundSchema, Type.Null()], { description: 'The open round; null when none is open.' }),
    rows: Type.Array(TalkRowSchema, { maxItems: 500 }),
    bookedUnknown: Type.Optional(
      Type.Boolean({
        description:
          'True when the system could not tell who is booked (the calendar did not answer), so a `missing` row may be booked.',
      }),
    ),
  },
  'What `<id>.talks` returns: the open round and one row per person the reader manages a talk with.',
);
export type TalksOutput = Static<typeof TalksOutputSchema>;
/** Who an action point is for (D96 item 4): the employee the talk is with, or their manager. */
export const COMMITMENT_OWNERS = ['employee', 'manager'] as const;
export const CommitmentOwner = literals(COMMITMENT_OWNERS);
export type CommitmentOwner = (typeof COMMITMENT_OWNERS)[number];
/** The text of an action point: one short line, never in a card, an audit row or a model's context (D96 item 6). */
const commitmentText = Type.String({ minLength: 1, maxLength: 280 });
/**
 * One action point (åtgärdspunkt, D96 item 4) as the answering system lists it: a short line, an owner, a due date and
 * done or open, tied to the employee the talk is with. Open ones from earlier rounds are listed, marked `carried`.
 */
export const CommitmentRowSchema = object(
  {
    ref: Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: '^commitment:[a-z][a-z0-9-]*:[A-Za-z0-9:_.-]+$',
      description: "`commitment:<connector id>:<the system's own identity>`, stable. Clew treats it as opaque.",
    }),
    userName: { ...userName, description: 'The employee the talk is with, by their provisioned user name.' },
    name: Type.String({ minLength: 1, maxLength: 512, description: "That employee's name." }),
    owner: CommitmentOwner,
    mine: Type.Boolean({ description: 'The reader is the owner.' }),
    text: { ...commitmentText, description: 'The action point as written. Free text about a person.' },
    dueOn: { ...calendarDay, description: 'The day it is due.' },
    done: Type.Boolean(),
    doneAt: Type.Optional({ ...instant, description: 'When it was marked done.' }),
    carried: Type.Boolean({ description: 'From an earlier round and still open.' }),
    link: Type.Optional({ ...sourceLink, description: 'The action point in its own system.' }),
  },
  'One action point from a development talk (D96).',
);
export type CommitmentRow = Static<typeof CommitmentRowSchema>;
/**
 * What `<id>.commitments` takes: `person`, a user name, asks for that employee's action points, for a manager of their
 * unit; without it, the reader's: the ones the reader owns and the ones about the reader (D96 item 4: both see them).
 */
export const CommitmentsInputSchema = object({ person: Type.Optional(userName) });
export type CommitmentsInput = Static<typeof CommitmentsInputSchema>;
/** What `<id>.commitments` returns. */
export const CommitmentsOutputSchema = object(
  { rows: Type.Array(CommitmentRowSchema, { maxItems: 500 }) },
  'What `<id>.commitments` returns: the action points the reader may see, as the system lets them see them.',
);
export type CommitmentsOutput = Static<typeof CommitmentsOutputSchema>;
/**
 * What the composite `clew.talks` returns to Clew's own pages (D96 item 8): the one source's answer, checked against
 * the shape, each row mapped to a person on the reader's own units (`personId`), with whether Clew can write
 * (`writable`: the built-in module answered) and the answering system as a person reads it (`source`).
 */
export const TalksResultSchema = object({
  round: TalksOutputSchema.properties.round,
  rows: Type.Array(object({ ...TalkRowSchema.properties, personId: id }), { maxItems: 500 }),
  bookedUnknown: TalksOutputSchema.properties.bookedUnknown,
  writable: Type.Boolean(),
  source: Type.String(),
});
export type TalksResult = Static<typeof TalksResultSchema>;
/**
 * What the composite `clew.commitments` returns (D96 item 8): as `clew.talks`, each row with `personId` (the employee)
 * and, only when `writable` and the reader may mark it done or open it again, `id`: the built-in module's own id of the
 * action point, which its write routes take. The reader may change their own, and a manager's point about someone they
 * manage now whose owner no longer manages that person (Q12).
 */
export const CommitmentsResultSchema = object({
  rows: Type.Array(object({ ...CommitmentRowSchema.properties, personId: id, id: Type.Optional(id) }), {
    maxItems: 500,
  }),
  writable: Type.Boolean(),
  source: Type.String(),
});
export type CommitmentsResult = Static<typeof CommitmentsResultSchema>;
/** Marking a talk held (D96 item 2): the day it was held, today in Swedish time when absent. */
export const TalkHeldBodySchema = object({ heldOn: Type.Optional(calendarDay) });
export type TalkHeldBody = Static<typeof TalkHeldBodySchema>;
/** A manager adds an action point in a person's talk (D96 item 4). The text must not be blank, which the domain checks. */
export const CommitmentAddBodySchema = object({
  owner: CommitmentOwner,
  text: commitmentText,
  dueOn: calendarDay,
});
export type CommitmentAddBody = Static<typeof CommitmentAddBodySchema>;

/**
 * One piece of news as a news source's connector lists it (D112, amended 2026-11-11): what Hem's "Nyheter" and the
 * list "Alla nyheter" draw, and nothing else. A row either leaves Clew by its `link` or opens in Clew by the read its
 * view's `open` names (by convention `<id>.newsItem`). No body, no image, no author: Clew is not a news site (vision).
 */
export const NewsRowSchema = object(
  {
    ref: Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: '^[A-Za-z0-9:_.@-]+$',
      description: "The source's own id for the item, stable. What the read the view's `open` names takes back.",
    }),
    title: Type.String({ minLength: 1, maxLength: 200, description: 'Swedish. The headline as the source has it.' }),
    sender: Type.String({
      minLength: 1,
      maxLength: 80,
      description: 'Swedish. Who published it, as a reader knows the sender: a department, a unit or the newsroom.',
    }),
    publishedAt: { ...instant, description: 'When it was published.' },
    link: Type.Optional({
      ...sourceLink,
      description:
        "The item in its own system, opened in a new tab. Without it the row opens in Clew through the view's `open`.",
    }),
  },
  "One piece of news in a news source's list (D112).",
);
export type NewsRow = Static<typeof NewsRowSchema>;
/** What `<id>.news` and the composite `clew.news` take: nothing. The source lists what the person may read. */
export const NewsInputSchema = object({});
export type NewsInput = Static<typeof NewsInputSchema>;
/** What `<id>.news` returns. */
export const NewsOutputSchema = object(
  { rows: Type.Array(NewsRowSchema, { maxItems: 100 }) },
  'What `<id>.news` returns: the news the person may read in this source, newest first or in any order; Clew orders them.',
);
export type NewsOutput = Static<typeof NewsOutputSchema>;
/**
 * What the composite `clew.news` returns (D112, amended 2026-11-11): every source's rows in one list, newest first,
 * each marked with the connector it came from, the source as a person reads it (`system`) and the view that opens it
 * there when the source declares one. A source that did not answer contributes nothing and is not named.
 */
export const NewsResultSchema = object({
  rows: Type.Array(
    object({
      ...NewsRowSchema.properties,
      connector: Type.String(),
      system: Type.String(),
      view: Type.Optional(ViewRefSchema),
    }),
  ),
});
export type NewsResult = Static<typeof NewsResultSchema>;

/** The most keys Clew sends in one call to a read about an entity (D97 item 7); a longer list is split. */
export const ENTITY_KEYS_MAX = 200;
/** The most columns "Alla" shows for one entity kind across the installation (D97 item 4), chosen by an administrator. */
export const ENTITY_COLUMNS_MAX = 3;
/**
 * What a capability's rows concern (D97 item 1). A source says what, never where: Clew places it from the declaration.
 * `param` only on a propose or execute: the input property that takes the key.
 */
export const AboutSchema = object(
  {
    entity: EntityKind,
    param: Type.Optional({
      ...viewKey,
      description:
        'On a `propose` or `execute` only: the string property of the input that takes the key of the one entity it acts on. A read takes its keys in `keys` and declares none.',
    }),
  },
  "What the rows concern (D97). A `read` takes `{ keys }` (an array of at most 200 strings, required) and answers `rows` (or its view's rows), one per key it knows, each with a string `key` it was asked with; a key outside the caller's scope is answered as no row, never as a refusal. It declares a `table` or `list` view, is never a tool (`model: false`), and may answer `heading` and `note`, two strings beside the rows. A `propose` or `execute` names in `param` the input property that takes one key. Clew decides where it shows: an action in the entity's menu, a read as a section on the opened entity, a `warn` or `alert` tone as a mark on its row, a table or list as a lens an administrator may offer.",
);
export type About = Static<typeof AboutSchema>;
/**
 * A page of an owned domain where the person writes about one entity (D95, D96): a core connector's in-process `about`
 * may name one, never a remote manifest. `href` may hold `{key}` and `{id}`, which the web fills in. A path (`/staff?…`)
 * is a page of its own, a destination; a query alone (`?talk={id}`) is something that lies over the page the way in is
 * drawn on, its parameters added to that page's address with everything else in it kept (D111 rule 5).
 */
export const EntityPageSchema = object({
  title: Type.String({ minLength: 1, maxLength: 60 }),
  href: Type.String({ minLength: 1, maxLength: 200, pattern: '^[/?]' }),
});
export type EntityPage = Static<typeof EntityPageSchema>;
/** How one source answered for a list or a section: it answered, it did not, or not in time. */
const entityAnswer = Type.Union([Type.Literal('ok'), Type.Literal('unavailable'), Type.Literal('timeout')]);
/**
 * An entity as the browser gets it (D97). `key` is Clew's key (D119): a person's id, a unit's id; it is the address
 * (`/people/<key>`, `/units/<key>`) and what "Just nu" and a card's row name. `sourceKey` is the key a source knows the
 * entity by and answers its rows with (`row.key`): a person's `userName`, a unit's id. `detail` is one line ("Lärare
 * 4–6 · Bergsåkers skola") when known; `id` is Clew's own id, never sent to a connector.
 */
export const EntityRefSchema = object({
  kind: EntityKind,
  key: Type.String({ minLength: 1, maxLength: ENTITY_KEY_MAX }),
  sourceKey: entityKey,
  name: Type.String(),
  detail: Type.Optional(Type.String()),
  id: Type.Optional(id),
});
export type EntityRef = Static<typeof EntityRefSchema>;
/**
 * The source is Clew's own domain (D97): a core connector of Clew's, such as the talks module. A section and a lens's
 * fact line then name it "Clew", while a column's second line and the row menu's group keep its `source`.
 */
const own = Type.Optional(Type.Literal(true));
/** A read about an entity kind as a lens or a section (D97): whose it is, the connector's Swedish `source`, its view, and, for Clew's own domain, the page where the person writes. */
export const EntitySourceSchema = object({
  capability: Type.String(),
  connector: Type.String(),
  source: Type.String(),
  title: Type.String(),
  view: ViewSchema,
  page: Type.Optional(EntityPageSchema),
  own,
});
export type EntitySource = Static<typeof EntitySourceSchema>;
/** One column on "Alla" (D97 item 4): one field of a source's view, chosen by an administrator. */
export const EntityColumnSchema = object({
  capability: Type.String(),
  source: Type.String(),
  title: Type.String(),
  field: ViewFieldSchema,
  own,
});
export type EntityColumn = Static<typeof EntityColumnSchema>;
/**
 * What a write asks the person for (D112 item 10): a closed list of kinds, each naming one property of the capability's
 * own input. Clew draws them as the first step of the action's dialog and merges the answers into the input the source
 * receives; the source never draws a form.
 */
export const ASK_KINDS = ['meeting', 'text', 'long-text', 'date', 'choice'] as const;
export type AskKind = (typeof ASK_KINDS)[number];
/** The most asks one capability declares. */
export const ASKS_MAX = 6;
const ASK_PROPERTY = '^[A-Za-z][A-Za-z0-9_]*$';
const askFields = {
  property: Type.String({
    pattern: ASK_PROPERTY,
    maxLength: 80,
    description:
      "The input property the person's answer fills: one of the input schema's `properties`, of a type the kind takes.",
  }),
  label: Type.String({ minLength: 1, maxLength: 80, description: 'Swedish. The field\'s label: "När", "Plats".' }),
  required: Type.Boolean({
    description:
      'Whether the person must answer before the last step. `true` whenever the input schema requires the property; an optional answer left empty is not sent.',
  }),
};
const askKind = <const K extends AskKind>(kind: K, description: string) => Type.Literal(kind, { description });
export const AskSchema = Type.Union(
  [
    object({
      kind: askKind(
        'meeting',
        'a meeting time, in a `string` property (format `date-time` when it declares one) that takes the start as an ISO 8601 instant. Clew suggests three free times from the person\'s own calendar, offers "Annan tid" and draws the chosen day.',
      ),
      ...askFields,
      durationMinutes: Type.Integer({
        minimum: 5,
        maximum: 480,
        description: 'For `meeting`: how long the meeting is, in minutes. Clew looks for free times this long.',
      }),
    }),
    object({
      kind: askKind('text', 'one line of text, in a `string` property without `enum` or `format`.'),
      ...askFields,
    }),
    object({
      kind: askKind('long-text', 'a paragraph such as a message, in a `string` property without `enum` or `format`.'),
      ...askFields,
    }),
    object({
      kind: askKind(
        'date',
        'a calendar day as `YYYY-MM-DD`, in a `string` property (format `date` when it declares one).',
      ),
      ...askFields,
    }),
    object({
      kind: askKind('choice', "one of the property's `enum` values, each named in `options`."),
      ...askFields,
      options: Type.Array(
        object({
          value: Type.String({ minLength: 1, maxLength: 80, description: "One of the property's `enum` values." }),
          label: Type.String({ minLength: 1, maxLength: 80, description: 'Swedish. What the person reads.' }),
        }),
        {
          minItems: 2,
          maxItems: 8,
          description: "For `choice`: every value of the property's `enum` once, with its Swedish label, in order.",
        },
      ),
    }),
  ],
  { description: 'One thing a propose or an execute asks the person for, naming one property of its input.' },
);
export type Ask = Static<typeof AskSchema>;
/**
 * The values a person gave for an action's asks (D112 item 10), by input property: an instant for a meeting, a day for a
 * date, an `enum` value for a choice, the text for the rest. Only the asked properties; Clew refuses anything else.
 */
export const AskValuesSchema = Type.Record(
  Type.String({ pattern: ASK_PROPERTY, maxLength: 80 }),
  Type.String({ maxLength: 4000 }),
  { maxProperties: ASKS_MAX, additionalProperties: false },
);
export type AskValues = Static<typeof AskValuesSchema>;
/** One thing a write will do (D112 item 10), as an `effect` read says it before anything is written. */
export const EffectRowSchema = object(
  {
    label: Type.String({
      minLength: 1,
      maxLength: 200,
      description: 'Swedish. What will be written: "Omtankesamtalet registreras".',
    }),
    detail: Type.Optional(
      Type.String({ maxLength: 400, description: 'Swedish. One line more: on what, with what values.' }),
    ),
    source: Type.Optional(
      Type.String({
        minLength: 1,
        maxLength: 80,
        description:
          'Swedish. The system it is written in, as cards name a system ("Kalendern"), when it is not the connector\'s own `source`.',
      }),
    ),
  },
  'One thing the write will do, in one system.',
);
export type EffectRow = Static<typeof EffectRowSchema>;
export const EffectOutputSchema = object(
  {
    rows: Type.Array(EffectRowSchema, { minItems: 1, maxItems: 10 }),
    undoMinutes: Type.Optional(
      Type.Integer({
        minimum: 1,
        maximum: 1440,
        description:
          'How long the person can undo the write when the source lets them: "Du kan ångra bokningen i 10 minuter." Absent, Clew promises no undo.',
      }),
    ),
  },
  'What an `effect` read answers (D112 item 10): for exactly the input the execute would get, what it will write where, without writing anything. Drawn as "Det här händer", the dialog\'s last step.',
);
export type EffectOutput = Static<typeof EffectOutputSchema>;
/** `POST /api/threads/:id/effect` and `POST /api/entities/:kind/:key/effect`: the effect read's answer and whose it is. */
export const EffectPreviewSchema = object({
  ...EffectOutputSchema.properties,
  source: Type.String({ description: "The connector's `source`: the system of every row that names none." }),
});
export type EffectPreview = Static<typeof EffectPreviewSchema>;
/**
 * What a propose or an execute draws on its way (D112 item 10), resolved from the registered declaration on every read,
 * never from a draft: what it asks the person, whether "Det här händer" comes from an `effect` read, and the capability's
 * own description for when it does not. The web draws the dialog from it; a write without asks whose result can be
 * undone stays one press.
 */
export const ActionPathSchema = object({
  asks: Type.Array(AskSchema, {
    maxItems: ASKS_MAX,
    description:
      "What the person fills in, in the declared order. A property the action's own input, its rows or the entity already gives is left out.",
  }),
  effect: Type.Boolean({
    description: 'The capability declares an `effect` read: "Det här händer" is its answer for the filled-in input.',
  }),
  description: Type.String({ description: 'The capability\'s own description: "Det här händer" without an effect.' }),
});
export type ActionPath = Static<typeof ActionPathSchema>;
/** An action about an entity (D97): it shows in the entity's menu and runs through the human decision as every propose and execute does. */
export const EntityActionSchema = object({
  capability: Type.String(),
  connector: Type.String(),
  source: Type.String(),
  title: Type.String(),
  kind: Type.Union([Type.Literal('propose'), Type.Literal('execute')]),
  param: Type.String(),
  own,
  /** The way to the decision (D112 item 10); the entity's key is its `param` and never asked. */
  path: Type.Optional(ActionPathSchema),
});
export type EntityAction = Static<typeof EntityActionSchema>;
/** `GET /api/entities/:kind`: the entities the reader may ask about, in groups (for a person, one per unit the reader manages), with the administrator's columns and lenses and the actions. */
/**
 * "Just nu" on the list (D97 item 5): for one entity, how many of the reader's cards that name it wait for the reader's
 * decision (`act`) or are Clew's proposals (`proposals`), and the card when there is exactly one of those, so "1 att agera
 * på" opens it. An entity without such a card is absent.
 */
export const EntityAttentionSchema = object({
  /** Clew's key of the entity (`EntityRef.key`): a person's id, a unit's id. */
  key: Type.String({ minLength: 1, maxLength: ENTITY_KEY_MAX }),
  act: Type.Integer({ minimum: 0 }),
  proposals: Type.Integer({ minimum: 0 }),
  threadId: Type.Optional(id),
});
export type EntityAttention = Static<typeof EntityAttentionSchema>;
export const EntityListSchema = object({
  kind: EntityKind,
  groups: Type.Array(object({ id: Type.String(), label: Type.String(), entities: Type.Array(EntityRefSchema) })),
  columns: Type.Array(EntityColumnSchema, { maxItems: ENTITY_COLUMNS_MAX }),
  lenses: Type.Array(EntitySourceSchema),
  actions: Type.Array(EntityActionSchema),
  attention: Type.Array(EntityAttentionSchema),
});
export type EntityList = Static<typeof EntityListSchema>;
/**
 * `GET /api/entities/:kind/rows?capability=`: one source over every entity the reader may ask about. Each row carries
 * `key`, the source's key of its entity (`EntityRef.sourceKey`); an entity without a row is absent.
 */
export const EntityRowsSchema = object({
  capability: Type.String(),
  status: entityAnswer,
  rows: Type.Array(Type.Record(Type.String(), Type.Unknown())),
  heading: Type.Optional(Type.String()),
  note: Type.Optional(Type.String()),
});
export type EntityRows = Static<typeof EntityRowsSchema>;
/** A card of the reader's whose rows name the entity: "Behöver dig" on the opened entity (D97 item 5). */
export const EntityCardSchema = object({
  threadId: id,
  title: Type.String(),
  source: Type.String(),
  kind: Type.Union([Type.Literal('act'), Type.Literal('proposal'), Type.Literal('fyi')]),
});
export type EntityCard = Static<typeof EntityCardSchema>;
/** Employment data is descriptive. Unit memberships remain the authority for access. */
export const SCIM_EMPLOYMENT_SCHEMA = 'urn:clew:params:scim:schemas:extension:employment:2.0:User';
const DirectoryPhoneSchema = object({ type: Type.String(), value: Type.String() });
export type DirectoryPhone = Static<typeof DirectoryPhoneSchema>;
export const EmploymentSchema = object({
  unitId: Type.String(),
  title: Type.Optional(Type.String()),
  employmentType: Type.Optional(Type.String()),
  startDate: Type.Optional(Type.String({ format: 'date', maxLength: 10 })),
  employmentPercentage: Type.Optional(Type.Number({ minimum: 0, maximum: 100 })),
});
export type Employment = Static<typeof EmploymentSchema>;
const PersonProfileSchema = object({
  email: Type.Union([Type.String(), Type.Null()]),
  phoneNumbers: Type.Array(DirectoryPhoneSchema),
  /** `unitLabel` is absent when the unit has been removed since the directory sent the employment. */
  employments: Type.Array(object({ ...EmploymentSchema.properties, unitLabel: Type.Optional(Type.String()) })),
  title: Type.Union([Type.String(), Type.Null()]),
});
export type PersonProfile = Static<typeof PersonProfileSchema>;
/** `GET /api/entities/:kind/:key`: the opened entity, how the reader stands to it, its actions, one section per source and the cards about it. */
export const EntityDetailSchema = object({
  profile: Type.Optional(PersonProfileSchema),
  entity: object({
    ...EntityRefSchema.properties,
    /**
     * A person's unit: the reader's own for the reader, the unit the reader manages that the person is placed on, else
     * the person's own, also for someone who reports to the reader from below (D99). `opens` when the reader may open
     * the unit's page (`/units/<id>`): a unit they manage or belong to.
     */
    unit: Type.Optional(object({ id: Type.String(), label: Type.String(), opens: Type.Optional(Type.Literal(true)) })),
  }),
  relation: Type.Union([
    Type.Literal('managed'),
    Type.Literal('self'),
    Type.Literal('colleague'),
    Type.Literal('member'),
  ]),
  actions: Type.Array(EntityActionSchema),
  sections: Type.Array(EntitySourceSchema),
  cards: Type.Array(EntityCardSchema),
});
export type EntityDetail = Static<typeof EntityDetailSchema>;
/** `GET /api/entities/:kind/:key/section?capability=`: one source's answer for one entity. */
export const EntitySectionSchema = object({
  capability: Type.String(),
  status: entityAnswer,
  row: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type EntitySection = Static<typeof EntitySectionSchema>;
/**
 * `POST /api/entities/:kind/:key/actions`: start one of the entity's actions (D97, D8), named as `EntityAction.capability`.
 * `values` answers a propose's asks (D112): the propose drafts with them. An execute's asks are answered when the person
 * decides on its work item (`ActInput.values`), never here.
 */
export const EntityActionInputSchema = object({
  capability: Type.String({ minLength: 3, maxLength: 120 }),
  values: Type.Optional(AskValuesSchema),
});
export type EntityActionInput = Static<typeof EntityActionInputSchema>;
/** `POST /api/entities/:kind/:key/effect`: what the action would write for the entity with these answers (D112). */
export const EntityEffectInputSchema = object({
  capability: Type.String({ minLength: 3, maxLength: 120 }),
  values: Type.Optional(AskValuesSchema),
});
export type EntityEffectInput = Static<typeof EntityEffectInputSchema>;
/**
 * What starting an action about an entity gave: the card the person decides on, opened as Hem opens a card. The same
 * request while that card is open gives the same card; nothing has reached a source's write.
 */
export const EntityActionStartedSchema = object({ threadId: id });
export type EntityActionStarted = Static<typeof EntityActionStartedSchema>;
/**
 * What a competence type is (D108 item 2). A closed list: a certificate and a competence are one record, a holding, and
 * the kind says which the type is.
 */
export const COMPETENCE_KINDS = ['certificate', 'degree', 'course', 'authorisation'] as const;
export const CompetenceKind = literals(COMPETENCE_KINDS, {
  description:
    '`certificate`: a certificate with an issuer. `degree`: an examination. `course`: a completed course. `authorisation`: a right to perform a task, such as a delegation.',
});
export type CompetenceKind = (typeof COMPETENCE_KINDS)[number];
/**
 * Where a holding stands on a day (D108 item 4), computed when read and never stored. The order here is the order a
 * list is drawn in: what needs a person first.
 */
export const COMPETENCE_STATUSES = ['expired', 'expiring', 'valid'] as const;
export const CompetenceStatus = literals(COMPETENCE_STATUSES, {
  description:
    '`expired`: the end date has passed. `expiring`: it ends within 90 days. `valid`: it ends later, or never.',
});
export type CompetenceStatus = (typeof COMPETENCE_STATUSES)[number];
/** How a holding is attested (D108 items 7 and 9): read from a system, registered by a manager, or the person's own word. */
export const COMPETENCE_EVIDENCE = ['system', 'manager', 'self'] as const;
export type CompetenceEvidence = (typeof COMPETENCE_EVIDENCE)[number];
const competenceName = Type.String({ minLength: 1, maxLength: 120 });
const competenceArea = Type.String({ minLength: 1, maxLength: 80 });
const validityMonths = Type.Integer({ minimum: 1, maximum: 600 });
/** One row of the catalogue (D108 item 2) as the administration and the registration form list it. */
export const CompetenceTypeSchema = object(
  {
    id: id,
    name: { ...competenceName, description: 'Swedish. The type as a person reads it: "Heta arbeten".' },
    area: { ...competenceArea, description: 'Swedish. The group the type is listed under: "Säkerhet".' },
    kind: CompetenceKind,
    validityMonths: Type.Optional({
      ...validityMonths,
      description: "The employer's rule: a holding ends this many months after it was issued. Absent: no rule.",
    }),
    archived: Type.Boolean({ description: 'An archived type takes no new holdings; the ones it has stay.' }),
  },
  'A competence type in the catalogue (D108).',
);
export type CompetenceType = Static<typeof CompetenceTypeSchema>;
export const CompetenceTypesOutputSchema = object({ rows: Type.Array(CompetenceTypeSchema, { maxItems: 2000 }) });
export type CompetenceTypesOutput = Static<typeof CompetenceTypesOutputSchema>;
/** One holding as a read lists it (D108): who, what, since when, until when and where it stands today. */
export const CompetenceHoldingRowSchema = object(
  {
    ref: Type.String({
      minLength: 1,
      maxLength: 200,
      pattern: '^holding:[a-z][a-z0-9-]*:[A-Za-z0-9:_.-]+$',
      description: "`holding:<connector id>:<the system's own identity>`, stable. Clew treats it as opaque.",
    }),
    userName: { ...userName, description: 'The person who holds it, by their provisioned user name.' },
    name: Type.String({ minLength: 1, maxLength: 512, description: "The person's name." }),
    competence: { ...competenceName, description: "The type's name." },
    area: competenceArea,
    kind: CompetenceKind,
    issuedOn: { ...calendarDay, description: 'The day it was issued.' },
    expiresOn: Type.Optional({
      ...calendarDay,
      description: "The last day it is valid: the issuer's date, else the employer's rule. Absent: it does not end.",
    }),
    status: CompetenceStatus,
    evidence: literals(COMPETENCE_EVIDENCE),
  },
  'One holding of one person (D108).',
);
export type CompetenceHoldingRow = Static<typeof CompetenceHoldingRowSchema>;
/** What `competence.holdings` takes: a person the reader manages, by user name (or id when they have none); absent for the reader's own. */
export const CompetenceHoldingsInputSchema = object({ person: Type.Optional(userName) });
export type CompetenceHoldingsInput = Static<typeof CompetenceHoldingsInputSchema>;
export const CompetenceHoldingsOutputSchema = object(
  { rows: Type.Array(CompetenceHoldingRowSchema, { maxItems: 500 }) },
  'The holdings of one person: for each type the one that decides its status, what needs the person first.',
);
export type CompetenceHoldingsOutput = Static<typeof CompetenceHoldingsOutputSchema>;
/** What `competence.attention` takes: nothing; the people are the reader's reports. */
export const CompetenceAttentionInputSchema = object({});
export type CompetenceAttentionInput = Static<typeof CompetenceAttentionInputSchema>;
export const CompetenceAttentionOutputSchema = object(
  { rows: Type.Array(CompetenceHoldingRowSchema, { maxItems: 500 }) },
  "What has expired or expires within 90 days among the reader's reports (D108 item 11), the expired first.",
);
export type CompetenceAttentionOutput = Static<typeof CompetenceAttentionOutputSchema>;
/** An administrator adds a type to the catalogue (D108 item 2). */
export const CompetenceTypeBodySchema = object({
  name: competenceName,
  area: competenceArea,
  kind: CompetenceKind,
  validityMonths: Type.Optional(Type.Union([validityMonths, Type.Null()])),
});
export type CompetenceTypeBody = Static<typeof CompetenceTypeBodySchema>;
/** A change of a type: what is absent is kept; `validityMonths: null` removes the employer's rule. */
export const CompetenceTypePatchSchema = object({
  name: Type.Optional(competenceName),
  area: Type.Optional(competenceArea),
  kind: Type.Optional(CompetenceKind),
  validityMonths: Type.Optional(Type.Union([validityMonths, Type.Null()])),
});
export type CompetenceTypePatch = Static<typeof CompetenceTypePatchSchema>;
/** What a change of a type's validity would do to the holdings counted from it (D108 item 3), before it is confirmed. */
export interface CompetenceValidityImpact {
  /** Holdings that end by the rule: the ones with no date of the issuer's. */
  holdings: number;
  expiredBefore: number;
  expiredAfter: number;
}
/** A manager registers a certificate for a person who reports to them (D108 item 7). */
export const CompetenceHoldingBodySchema = object({
  typeId: id,
  issuedOn: calendarDay,
  expiresOn: Type.Optional(calendarDay),
});
export type CompetenceHoldingBody = Static<typeof CompetenceHoldingBodySchema>;
/** A Clew-side action the conversation proposes; executed only after the person confirms, through the thread endpoints. */
export const ClewActionSchema = object({
  n: Type.Integer(),
  kind: Type.Union([Type.Literal('dismiss'), Type.Literal('snooze')]),
  threadId: id,
  label: Type.String(),
});
export type ClewAction = Static<typeof ClewActionSchema>;
/**
 * A change the conversation made to a card as a draft. The card's own button executes; the conversation never touches a
 * source. `action` (D112 item 8) is one of the work item's actions filled in by the assistant: which action and the
 * values for what it asks, checked against the asks when drafted and again when the person sends. It is kept in the
 * conversation only, and the person opens it in the action's own dialog; nothing is executed from it.
 */
export const DraftSchema = object({
  kind: Type.Union([Type.Literal('select'), Type.Literal('replan'), Type.Literal('action')]),
  threadId: id,
  refs: Type.Optional(Type.Array(Type.String())),
  week: Type.Optional(Type.String()),
  actionId: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
  values: Type.Optional(AskValuesSchema),
});
export type Draft = Static<typeof DraftSchema>;
/** A verb about one chipped object, derived from its actions and Clew's standard actions, never from the model. */
export const VerbSchema = object({
  id: Type.String(),
  label: Type.String(),
  kind: Type.Union([
    Type.Literal('dismiss'),
    Type.Literal('snooze'),
    Type.Literal('why'),
    Type.Literal('primary'),
    Type.Literal('replan'),
  ]),
  threadId: id,
  refs: Type.Optional(Type.Array(Type.String())),
  week: Type.Optional(Type.String()),
});
export type Verb = Static<typeof VerbSchema>;
/**
 * What one model turn cost and where its trace is (D91): the provider, the wall time, the steps, the tokens, how the
 * model stopped and the OpenTelemetry trace id when the turn was traced. Metadata only: never the prompt or the answer.
 */
export const ModelCallSchema = object({
  providerId: Type.String({ maxLength: 60 }),
  durationMs: Type.Integer({ minimum: 0 }),
  steps: Type.Optional(Type.Integer({ minimum: 0 })),
  inputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
  outputTokens: Type.Optional(Type.Integer({ minimum: 0 })),
  finishReason: Type.Optional(Type.String({ maxLength: 40 })),
  traceId: Type.Optional(Type.String({ maxLength: 32 })),
});
export type ModelCall = Static<typeof ModelCallSchema>;
/** Per-message memory of a conversation: what was pointed at, what came back, and how it was produced. */
export const MessageMetaSchema = object({
  access: Type.Optional(
    object({
      connectors: Type.Array(Type.String()),
      capabilities: Type.Array(Type.String()),
      authorizationVersion: Type.Optional(Type.String()),
    }),
  ),
  chips: Type.Optional(Type.Array(ChipSchema)),
  refs: Type.Optional(Type.Array(Type.String())),
  shape: Type.Optional(AnswerShape),
  view: Type.Optional(ViewRefSchema),
  draft: Type.Optional(DraftSchema),
  toolCalls: Type.Optional(Type.Array(object({ capability: Type.String(), input: Type.Unknown() }))),
  assistant: Type.Optional(AssistantMode),
  source: Type.Optional(Type.String()),
  /** The sources a document answer cites (D26), numbered as `[n]` in the body; refs only. */
  sources: Type.Optional(Type.Array(SourceCitationSchema, { maxItems: 10 })),
  followUps: Type.Optional(Type.Array(Type.String(), { maxItems: 3 })),
  /** The open cards an answer is about (D34, the canvas's H1): the transcript draws them in the turn, live, from the same cache as the page. */
  cards: Type.Optional(Type.Array(id, { maxItems: 3 })),
  /** The model that wrote this answer (D24); absent when the router answered. */
  model: Type.Optional(ModelRefSchema),
  /** The model turn's cost and trace (D91); absent when the router answered. */
  modelCall: Type.Optional(ModelCallSchema),
  /** Why the router answered although a model is configured (D8): the failure in the wire's own words, cut short. */
  fallbackReason: Type.Optional(Type.String({ maxLength: 200 })),
});
export type MessageMeta = Static<typeof MessageMetaSchema>;
export const ThreadMessageSchema = object({
  id: id,
  role: Type.Union([Type.Literal('assistant'), Type.Literal('user')]),
  body: Type.String(),
  createdAt: instant,
  meta: Type.Optional(MessageMetaSchema),
});
export type ThreadMessage = Static<typeof ThreadMessageSchema>;
/** A row inside a card: an object with a ref the person can tick, point at or add to the conversation (D12). */
export const ThreadItemSchema = object({
  ref: Type.String({ minLength: 1, maxLength: 200 }),
  revision: Type.Optional(
    Type.String({
      minLength: 1,
      maxLength: 200,
      description:
        'The source record/document-bundle revision represented by this item. Versioned review must match it.',
    }),
  ),
  label: Type.String(),
  detail: Type.String(),
  selectable: Type.Boolean(),
  selected: Type.Boolean(),
  subject: Type.Optional({
    ...SubjectSchema,
    description:
      "The person or unit the row is about (D97 item 6): the web links the row to it, and the card shows on that entity for its owner. A key, never a name: a person's `userName`, a unit's id; the row's text stays the source's. Clew resolves a user name as the row arrives to whoever of the reader's organisation holds it then and keeps that person's id, so a later rename or reuse of the name moves nothing on the card (D119); a name nobody there holds names nobody.",
  }),
});
export type ThreadItem = Static<typeof ThreadItemSchema>;
/** One action slot on a card (thread action contract). Connectors contribute actions, never layout. */
export const ActionRole = Type.Union([Type.Literal('primary'), Type.Literal('secondary'), Type.Literal('overflow')]);
export const ThreadActionSchema = object({
  id: id,
  label: Type.String(),
  capability: Type.String(),
  kind: Type.Union([Type.Literal('read'), Type.Literal('propose'), Type.Literal('execute')]),
  role: ActionRole,
  /** Where a read's answer goes (D111): unfolded inside the card, or a link out to the source system in a new tab. */
  target: Type.Optional(
    Type.Union([Type.Literal('panel'), Type.Literal('link')], {
      description:
        "For a `read`: absent or `panel` unfolds the read's answer inside the card, under its buttons (a `table` view opens in the card's place in the panel); `link` marks the button as leaving Clew and opens the `url` the read answers in a new tab (D111 rule 8). Ignored on a propose or execute.",
    }),
  ),
  /** Fixed input merged with the selected item refs at execution time. */
  input: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  /** Whether the action takes the selected items as `refs`. */
  usesItems: Type.Optional(Type.Boolean()),
  confirm: Type.Optional(
    Type.String({
      description:
        'Swedish. Asked in a dialog over the card before the action runs, with "Avbryt" and the action\'s own label as the buttons: up to the first "?" is the question, the rest says what follows from yes ("Avvisa filen? Ditt beslut gäller för alla som kan godkänna den.").',
    }),
  ),
  /**
   * The person reviews the items one at a time before this execute runs (D70): Clew opens the review flow from the
   * card's next step, and the write happens once, with the refs the person approved. Only on an execute with `usesItems`.
   */
  review: Type.Optional(Type.Literal('each')),
  /** A read capability of the same connector that takes `{ ref }` for one item and answers a `PreviewOutput` (D70). */
  preview: Type.Optional(Type.String()),
  /**
   * The action is the person's read receipt (D112, amended 2026-11-11): the work item asks the person to acknowledge
   * that they have read something published. Only on an execute, at most one per item. While such an item is open, Hem
   * lifts the most urgent one above its blocks with this action as its button.
   */
  acknowledgement: Type.Optional(
    object(
      { publishedAt: { ...instant, description: 'When what the person acknowledges was published.' } },
      'The action is the read receipt for something published, which Hem lifts until it is given (D112).',
    ),
  ),
});
export type ThreadAction = Static<typeof ThreadActionSchema>;
/**
 * A card action as the API answers it: the draft's action and, for a propose or an execute of the card's own connector,
 * its `path` (D112 item 10), resolved from the registered manifest on every read. A draft cannot carry a path.
 */
export const CardActionSchema = object({
  ...ThreadActionSchema.properties,
  path: Type.Optional(ActionPathSchema),
});
export type CardAction = Static<typeof CardActionSchema>;
/** One item's document, as a review flow shows it beside the decision (D70): an image is drawn, a PDF is offered as a file. */
export const PreviewMediaType = Type.Union([
  Type.Literal('image/svg+xml'),
  Type.Literal('image/png'),
  Type.Literal('image/jpeg'),
  Type.Literal('application/pdf'),
]);
export const PreviewOutputSchema = object(
  {
    title: Type.String({ minLength: 1, maxLength: 200, description: 'Swedish. Names the document.' }),
    mediaType: PreviewMediaType,
    data: Type.String({
      pattern: '^[A-Za-z0-9+/]*={0,2}$',
      maxLength: 4_000_000,
      description: 'The document, base64. At most 3 MB decoded.',
    }),
  },
  "What a `preview` read answers for one item (D70): the item's document as base64, with its media type.",
);
export type PreviewOutput = Static<typeof PreviewOutputSchema>;
export const ReviewPreviewSchema = Type.Union([PreviewOutputSchema, DocumentReviewSchema]);
export type ReviewPreview = Static<typeof ReviewPreviewSchema>;
/** What the source system answered, row by row, read back after an execute. Green only on a read-back. */
export const ReceiptRowSchema = object({
  ref: Type.String(),
  label: Type.String(),
  source: Type.Optional(object({ ref: Type.String(), revision: Type.String(), uid: Type.Optional(Type.String()) })),
  outcome: Type.Union([Type.Literal('done'), Type.Literal('unknown'), Type.Literal('failed'), Type.Literal('skipped')]),
  detail: Type.String(),
});
export const ReceiptSchema = object({
  at: instant,
  headline: Type.String(),
  rows: Type.Array(ReceiptRowSchema),
  undoUntil: Type.Union([instant, Type.Null()]),
  undoCapability: Type.Union([Type.String(), Type.Null()]),
  undoInput: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
});
export type Receipt = Static<typeof ReceiptSchema>;
export type ReceiptRow = Static<typeof ReceiptRowSchema>;

export const ThreadKind = Type.Union([Type.Literal('pushed'), Type.Literal('question')]);
export const ThreadState = Type.Union([Type.Literal('open'), Type.Literal('handled'), Type.Literal('dismissed')]);
/**
 * Why dispatch did not send a started action (D119): the user name it was decided with no longer names the person it is
 * about, renamed or given to someone else since, so the person decides again.
 */
export const SUBJECT_CHANGED = 'subject-changed';
export const ExecutionSummarySchema = object({
  id,
  decisionId: Type.String(),
  operation: Type.String(),
  state: Type.Union([
    Type.Literal('pending'),
    Type.Literal('running'),
    Type.Literal('succeeded'),
    Type.Literal('partial'),
    Type.Literal('failed'),
    Type.Literal('unknown'),
  ]),
  reason: Type.Union([Type.String(), Type.Null()]),
  compensates: Type.Union([Type.String(), Type.Null()]),
});
export type ExecutionSummary = Static<typeof ExecutionSummarySchema>;
/** Every thread answers "varför ser jag detta?" with trigger, source and time. */
export const ThreadSchema = object({
  /** Clew authority under which source content was projected; absent legacy snapshots are not trusted. */
  sourceAuthorization: Type.Optional(Type.String()),
  id: id,
  kind: ThreadKind,
  topic: Type.String(),
  title: Type.String(),
  state: ThreadState,
  trigger: object({ reason: Type.String(), source: Type.String(), at: instant }),
  createdAt: instant,
  updatedAt: instant,
  handledAt: Type.Union([instant, Type.Null()]),
  messages: Type.Array(ThreadMessageSchema),
  proposals: Type.Array(ProposalSchema),
  /** Target week (Monday) for proposal threads. */
  week: Type.Union([Type.String(), Type.Null()]),
  /** The connector (area) the thread belongs to. `calendar` for proposal threads, `clew` for questions. */
  connector: Type.String(),
  area: Type.String(),
  /** One sentence the card leads with. */
  summary: Type.String(),
  items: Type.Array(ThreadItemSchema),
  /**
   * The entities a card of Clew's own is about while none of its rows may name them (D97 item 6, D96 item 6): an action
   * point's card is about the employee of the talk. Never drawn on the card and never read by the assistant; it only
   * places the card under "Behöver dig" on that entity for its owner.
   */
  subjects: Type.Optional(Type.Array(SubjectSchema, { maxItems: 20 })),
  actions: Type.Array(CardActionSchema),
  /** Set when the thread waits on someone else: it is listed under "Pågår utan dig" and never notifies. */
  waitingOn: Type.Union([Type.String(), Type.Null()]),
  deadline: Type.Union([Type.String(), Type.Null()]),
  receipt: Type.Union([ReceiptSchema, Type.Null()]),
  execution: Type.Optional(Type.Union([ExecutionSummarySchema, Type.Null()])),
  timers: Type.Optional(
    Type.Array(
      object({
        kind: Type.Union([Type.Literal('reminder'), Type.Literal('snooze')]),
        dueAt: instant,
        state: Type.Union([Type.Literal('queued'), Type.Literal('scheduled'), Type.Literal('blocked')]),
      }),
    ),
  ),
  /** When a reminder the person set brought the card back (D17). Counts for that day: the card sorts first, marked "Påminnelse". */
  remindedAt: Type.Union([instant, Type.Null()]),
  /** "Inte nu" (D28): the card sits in the Inte nu pile until this instant, or until something happens in the thread. */
  snoozedUntil: Type.Union([instant, Type.Null()]),
});
export type Thread = Static<typeof ThreadSchema>;
export const unresolvedExecution = (t: Pick<Thread, 'execution'>) =>
  !!t.execution && ['pending', 'running', 'unknown', 'partial', 'failed'].includes(t.execution.state);

/**
 * What happened to a work item, as its "Händelser" lists it (D112 item 4): read from the audit rows the item's own
 * mutations wrote, nothing else. Who did it is the person (`you`) or Clew on its own (`clew`); a row anyone else wrote is
 * left out, so no other person is ever named. No text of a model turn, no source content: what the person reads beside
 * it (the receipt, the action's label) comes from the item they may already see.
 */
export const ItemEventKindSchema = Type.Union([
  /** The item came: from a source, from an answer, as a new try after rejected rows, or started by the person. */
  Type.Literal('created'),
  /** The source changed the item's rows, title or day. */
  Type.Literal('updated'),
  Type.Literal('snoozed'),
  Type.Literal('woken'),
  Type.Literal('reminder-set'),
  Type.Literal('reminder-cancelled'),
  Type.Literal('reminded'),
  /** A reminder the person set could not be kept, because their access changed. */
  Type.Literal('reminder-stopped'),
  Type.Literal('dismissed'),
  Type.Literal('reopened'),
  /** The person decided one of the item's writes; the durable ledger carries it to the source (D45). */
  Type.Literal('decided'),
  /** The person asked to undo the decision. */
  Type.Literal('undo-decided'),
  /** The source answered a decision or its undo: `outcome` says how. */
  Type.Literal('answered'),
  /** The time to undo ran out; the receipt stands. */
  Type.Literal('undo-closed'),
  /** The source no longer lists the item as open. */
  Type.Literal('resolved'),
]);
export type ItemEventKind = Static<typeof ItemEventKindSchema>;
export const ItemEventSchema = object(
  {
    at: instant,
    by: Type.Union([Type.Literal('you'), Type.Literal('clew')]),
    kind: ItemEventKindSchema,
    /** `snoozed` and `reminder-set`: when the item comes back. */
    until: Type.Optional(instant),
    /** `woken`: the time came, or the source changed the item. */
    reason: Type.Optional(Type.Union([Type.Literal('time'), Type.Literal('changed')])),
    /** `decided`: the label of the action decided on, as the item names it now; absent when the item no longer has it. */
    action: Type.Optional(Type.String({ maxLength: 200 })),
    /** `answered`: what the source answered. */
    outcome: Type.Optional(
      Type.Union([Type.Literal('succeeded'), Type.Literal('partial'), Type.Literal('failed'), Type.Literal('unknown')]),
    ),
    /** `decided`, `undo-decided` and `answered`: the decision in the ledger, so an answer is matched to its receipt. */
    execution: Type.Optional(id),
  },
  "One thing that happened to a work item (D112 item 4): who, what and when, from the item's audit rows.",
);
export type ItemEvent = Static<typeof ItemEventSchema>;
export const ItemEventsSchema = object({ events: Type.Array(ItemEventSchema) });
export type ItemEvents = Static<typeof ItemEventsSchema>;

/**
 * Attention level of an open card (design canvas "Clew uppmärksamhet", 2026-11-04). Colour on the page follows this
 * level, never the category: `urgent` within three days, `soon` within thirty, `later` beyond that, `notice` without a deadline.
 */
export const AttentionLevelSchema = Type.Union([
  Type.Literal('now'),
  Type.Literal('urgent'),
  Type.Literal('soon'),
  Type.Literal('later'),
  Type.Literal('notice'),
]);
export type AttentionLevel = Static<typeof AttentionLevelSchema>;
/** `now` is a card the person asked to be reminded about today: it sorts above every deadline. */
export const attentionLevels: readonly AttentionLevel[] = ['now', 'urgent', 'soon', 'later', 'notice'];
/** The calendar date in Stockholm of an instant, as an ISO date. */
export const stockholmDate = (instant: string) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm' }).format(new Date(instant));
/** Whole days from `today` to `date`, both ISO dates; negative when the date has passed. */
export function daysUntil(date: string, today: string): number {
  const utc = (d: string) => Date.UTC(Number(d.slice(0, 4)), Number(d.slice(5, 7)) - 1, Number(d.slice(8, 10)));
  return Math.round((utc(date) - utc(today)) / 86_400_000);
}
export function attentionLevel(
  thread: { deadline: string | null; remindedAt?: string | null },
  today: string,
): AttentionLevel {
  if (thread.remindedAt && stockholmDate(thread.remindedAt) === today) return 'now';
  if (!thread.deadline) return 'notice';
  const days = daysUntil(thread.deadline.slice(0, 10), today);
  return days <= 3 ? 'urgent' : days <= 30 ? 'soon' : 'later';
}
/** The highest level in a list, or null when the list is empty. */
export const worstLevel = (levels: AttentionLevel[]): AttentionLevel | null =>
  levels.length ? attentionLevels[Math.min(...levels.map(l => attentionLevels.indexOf(l)))]! : null;

/** The stream's groups (D28): `nu` is due today, overdue or reminded today; `senare` has a deadline ahead; `notice` has none. */
export const StreamGroupSchema = Type.Union([Type.Literal('nu'), Type.Literal('senare'), Type.Literal('notice')]);
export type StreamGroup = Static<typeof StreamGroupSchema>;
export function streamGroup(
  thread: { deadline: string | null; remindedAt?: string | null },
  today: string,
): StreamGroup {
  if (thread.remindedAt && stockholmDate(thread.remindedAt) === today) return 'nu';
  if (!thread.deadline) return 'notice';
  return daysUntil(thread.deadline.slice(0, 10), today) <= 0 ? 'nu' : 'senare';
}
/**
 * The kinds the page feeds (D34): a requirement (a ladder, a day where one exists, the next step as the primary button),
 * a proposal from the assistant (a soft button, "nej tack" is an answer) and an event (one sentence, no button, gone when
 * read). A figure is Läget and never a thread. Derived from the thread, never stored: proposals or a proposing primary
 * action make a proposal, a deadline or a primary action makes a requirement, the rest is for information.
 */
export const CardKindSchema = Type.Union([Type.Literal('krav'), Type.Literal('forslag'), Type.Literal('handelse')]);
export type CardKind = Static<typeof CardKindSchema>;
export function cardKind(thread: {
  deadline: string | null;
  proposals: readonly unknown[];
  actions: readonly { kind: 'read' | 'propose' | 'execute'; role: 'primary' | 'secondary' | 'overflow' }[];
}): CardKind {
  if (thread.proposals.length > 0) return 'forslag';
  const primary = thread.actions.find(a => a.role === 'primary');
  if (primary?.kind === 'propose' && !thread.deadline) return 'forslag';
  if (thread.deadline || primary) return 'krav';
  return 'handelse';
}
/** A snoozed card is one whose `snoozedUntil` is still ahead of `now`; a passed time counts as awake until the sweep clears it. */
export const isSnoozed = (thread: { snoozedUntil: string | null }, now: string) =>
  !!thread.snoozedUntil && Date.parse(thread.snoozedUntil) > Date.parse(now);
const swedish = (options: Intl.DateTimeFormatOptions) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'UTC', ...options });
/** The day word a Senare row carries in place of a colour (D28): "i morgon", the weekday within six days, else the date. */
export function dayWord(date: string, today: string): string {
  const days = daysUntil(date, today);
  if (days <= 0) return 'i dag';
  if (days === 1) return 'i morgon';
  const noon = new Date(date + 'T12:00:00Z');
  return (
    days < 7 ? swedish({ weekday: 'short' }).format(noon) : swedish({ day: 'numeric', month: 'short' }).format(noon)
  )
    .replace(/\.$/, '')
    .replace('.', '');
}
/** Stockholm wall-clock time of an instant, HH:MM. */
export const stockholmClock = (instant: string) =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', hour: '2-digit', minute: '2-digit' }).format(
    new Date(instant),
  );
/** The instant of a Stockholm wall-clock time (HH:MM) on an ISO date, from Intl alone so the contracts stay dependency-free. */
export function stockholmInstant(date: string, time: string): string {
  const [hour = 0, minute = 0] = time.split(':').map(Number);
  const guess = Date.UTC(
    Number(date.slice(0, 4)),
    Number(date.slice(5, 7)) - 1,
    Number(date.slice(8, 10)),
    hour,
    minute,
  );
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Stockholm',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
      .formatToParts(new Date(guess))
      .map(p => [p.type, p.value]),
  );
  const asUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
  );
  return new Date(guess - (asUtc - guess)).toISOString();
}
/** An ISO date moved by whole days. */
export const shiftDate = (date: string, days: number) =>
  new Date(Date.UTC(Number(date.slice(0, 4)), Number(date.slice(5, 7)) - 1, Number(date.slice(8, 10)) + days))
    .toISOString()
    .slice(0, 10);
/** The next occurrence of a Stockholm wall-clock time strictly after `now`: today if still ahead, else tomorrow. */
export function nextStockholmTime(now: string, time: string): string {
  const today = stockholmDate(now);
  const candidate = stockholmInstant(today, time);
  return Date.parse(candidate) > Date.parse(now) ? candidate : stockholmInstant(shiftDate(today, 1), time);
}
/** "mån 10 nov 06:00" for an instant, in Stockholm. */
export const stockholmDayClock = (instant: string) =>
  `${new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Stockholm', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(instant)).replace(/\./g, '')} ${stockholmClock(instant)}`;
/** When a snoozed card comes back, in the person's words: "i morgon 06:00", "kl 13:00" today, "fre 09:00" this week, else the date. */
export function snoozeWhen(until: string, now: string): string {
  const today = stockholmDate(now),
    date = stockholmDate(until),
    word = dayWord(date, today);
  return word === 'i dag' ? `kl ${stockholmClock(until)}` : `${word} ${stockholmClock(until)}`;
}

/** A snooze or reminder preset (D29): its name, the instant it lands on and the detail shown beside the name. */
export const SnoozePresetSchema = object({
  id: Type.String(),
  label: Type.String(),
  at: instant,
  detail: Type.String(),
});
export type SnoozePreset = Static<typeof SnoozePresetSchema>;
/** "Inte nu" and "Påminn mig" take a preset, free text in Swedish, or an instant; nothing means the next review. */
export const SnoozeInput = Type.Partial(
  object({
    preset: Type.String({ minLength: 1, maxLength: 40 }),
    text: Type.String({ minLength: 1, maxLength: 80 }),
    until: instant,
  }),
  closed,
);
export type SnoozeInput = Static<typeof SnoozeInput>;
export const MAX_SNOOZE_DAYS = 30;
const stockholmWeekday = (date: string) => new Date(date + 'T12:00:00Z').getUTCDay();
/** The next Monday after today, as an ISO date. */
const nextMonday = (today: string) => shiftDate(today, (8 - stockholmWeekday(today)) % 7 || 7);
/**
 * The presets with their resolved times (D29): an hour, after lunch, the next review, next week, and when the person is
 * back from their next meeting today. Pure: the clock and today's meetings come in.
 */
export function snoozePresets(now: string, events: Array<{ title: string; end: string }> = []): SnoozePreset[] {
  const today = stockholmDate(now);
  const hour = new Date(Date.parse(now) + 3600_000).toISOString();
  const lunch = nextStockholmTime(now, '13:00');
  const tomorrow = stockholmInstant(shiftDate(today, 1), dayRhythm.review);
  const monday = stockholmInstant(nextMonday(today), dayRhythm.review);
  const meeting = events
    .filter(e => Date.parse(e.end) > Date.parse(now) && stockholmDate(e.end) === today)
    .sort((a, b) => a.end.localeCompare(b.end))[0];
  return [
    { id: 'hour', label: 'Om en timme', at: hour, detail: stockholmClock(hour) },
    {
      id: 'lunch',
      label: 'Efter lunch',
      at: lunch,
      detail: stockholmDate(lunch) === today ? stockholmClock(lunch) : `i morgon ${stockholmClock(lunch)}`,
    },
    { id: 'tomorrow', label: 'I morgon', at: tomorrow, detail: `${dayRhythm.review} · i genomgången` },
    { id: 'week', label: 'Nästa vecka', at: monday, detail: stockholmDayClock(monday) },
    ...(meeting
      ? [
          {
            id: 'meeting',
            label: `När jag är tillbaka från ${meeting.title}`,
            at: meeting.end,
            detail: `${stockholmClock(meeting.end)} · från kalendern`,
          },
        ]
      : []),
  ];
}
const numberWords: Record<string, number> = {
  en: 1,
  ett: 1,
  två: 2,
  tre: 3,
  fyra: 4,
  fem: 5,
  sex: 6,
  sju: 7,
  åtta: 8,
  nio: 9,
  tio: 10,
  femton: 15,
  tjugo: 20,
  trettio: 30,
};
const weekdayNames = ['söndag', 'måndag', 'tisdag', 'onsdag', 'torsdag', 'fredag', 'lördag'];
const clockOf = (hour: string | undefined, minute: string | undefined, fallback: string) =>
  hour ? `${hour.padStart(2, '0')}:${(minute ?? '00').padStart(2, '0')}` : fallback;
/**
 * A bounded Swedish time grammar (D29): "om 20 min", "om en timme", "efter lunch", "i morgon", "i morgon kl 9",
 * "fredag kl 9", "på måndag", "nästa vecka", "kl 14", "14:30". Anything else is null; nothing is guessed.
 */
export function parseSwedishTime(text: string, now: string): string | null {
  const q = text.trim().toLowerCase().replace(/\s+/g, ' ');
  const today = stockholmDate(now);
  const ahead = (date: string, time: string) => {
    const at = stockholmInstant(date, time);
    return Date.parse(at) > Date.parse(now) ? at : null;
  };
  let m: RegExpMatchArray | null;
  if ((m = q.match(/^om (\d+|[a-zåäö]+) ?(min|minut|minuter|tim|timme|timmar|h|dag|dagar|vecka|veckor)$/))) {
    const n = /^\d+$/.test(m[1]!) ? Number(m[1]) : numberWords[m[1]!];
    if (!n) return null;
    const unit = m[2]!.startsWith('min')
      ? 60_000
      : m[2]!.startsWith('tim') || m[2] === 'h'
        ? 3600_000
        : m[2]!.startsWith('dag')
          ? 86_400_000
          : 7 * 86_400_000;
    return new Date(Date.parse(now) + n * unit).toISOString();
  }
  if (q === 'efter lunch') return nextStockholmTime(now, '13:00');
  if (q === 'i kväll' || q === 'ikväll') return ahead(today, dayRhythm.quiet);
  if (q === 'nästa vecka') return stockholmInstant(nextMonday(today), dayRhythm.review);
  if ((m = q.match(/^(?:i ?morgon|imorgon)(?: kl\.? ?(\d{1,2})(?:[:.](\d{2}))?)?$/)))
    return stockholmInstant(shiftDate(today, 1), clockOf(m[1], m[2], dayRhythm.review));
  if (
    (m = q.match(/^(?:på )?(måndag|tisdag|onsdag|torsdag|fredag|lördag|söndag)(?: kl\.? ?(\d{1,2})(?:[:.](\d{2}))?)?$/))
  ) {
    const target = weekdayNames.indexOf(m[1]!),
      days = (target - stockholmWeekday(today) + 7) % 7;
    const time = clockOf(m[2], m[3], dayRhythm.review);
    return days === 0
      ? (ahead(today, time) ?? stockholmInstant(shiftDate(today, 7), time))
      : stockholmInstant(shiftDate(today, days), time);
  }
  if ((m = q.match(/^(?:kl\.? ?)?(\d{1,2})(?:[:.](\d{2}))?$/))) {
    const hour = Number(m[1]),
      minute = Number(m[2] ?? '0');
    if (hour > 23 || minute > 59) return null;
    return nextStockholmTime(now, clockOf(m[1], m[2], '00:00'));
  }
  return null;
}

/**
 * Who an administrator lets a connector reach (D23). `all` is every signed-in person; `selected` matches a person whose
 * role is in `roles`, or whose unit is in `units`, or who belongs to a group in `groups` (groups arrive with SCIM and
 * match nothing until then). Any-of across the three lists.
 */
export const RoleSchema = Type.Union([Type.Literal('manager'), Type.Literal('employee')]);
export type Role = Static<typeof RoleSchema>;
/**
 * The grant capabilities Clew enforces (D85), a closed list kept in `scim-group-key.ts` beside the group keys, which the
 * example provisioner and its check read without loading TypeBox. Named one by one, as the theme file's exports are.
 */
export { CAPABILITIES, isCapability, type Capability } from './scim-group-key';
import { CAPABILITIES, type Capability } from './scim-group-key';
export const CapabilitySchema = literals(CAPABILITIES);
/** Administration › Användare (D62, D68, D85): a provisioned person as the page lists them. No token, no subject. */
export interface UserAdminRow {
  id: string;
  name: string;
  userName: string | null;
  externalId: string | null;
  email: string | null;
  /** D110, D114: what the person is called at work: the titles of their employments, or the core title; null without one. */
  title: string | null;
  enabled: boolean;
  /** An identity binding exists, so the person has signed in (or was bound by the development seed). */
  bound: boolean;
  assignments: Array<{ unitId: string; unitLabel: string; role: Role }>;
  /** The assignment the person acts as, from the grant projection; null when the person has no unit. */
  active: { unitId: string; unitLabel: string; role: Role } | null;
  capabilities: string[];
}
/** Personal (D94): a person on a unit the signed-in manager manages, as the page lists them. No token, no subject. */
export interface StaffPerson {
  id: string;
  name: string;
  userName: string | null;
  email: string | null;
  /**
   * The person's role on this unit, not their active one. For a person who reports here from a unit below (D99), the
   * role they hold there: `manager` when they lead one of those units.
   */
  role: Role;
  enabled: boolean;
  /**
   * D99: set for a person who is not assigned to this unit but reports to its manager through the tree: the units
   * below it that they lead, or are placed on where nobody leads, by label in Swedish order. Absent for a person
   * assigned to the unit itself.
   */
  below?: Array<{ unitId: string; unitLabel: string; role: Role }>;
}
export interface StaffUnit {
  unitId: string;
  unitLabel: string;
  /**
   * The manager's reports through this unit (D99), by name in Swedish order: everyone assigned to the unit except the
   * manager reading, then the managers of the nearest units below that have one, and the people placed on a unit
   * below that nobody leads. Never the people those managers lead.
   */
  people: StaffPerson[];
}
/** The units the manager manages, by label in Swedish order; the server refuses anyone who manages none. */
export interface StaffOverview {
  units: StaffUnit[];
}
/**
 * Administration › Organisation (D99): one node of the organisation tree as the provisioner pushed it. Deactivated
 * people are counted nowhere here.
 */
export interface OrganisationUnit {
  unitId: string;
  unitLabel: string;
  /** The unit above, null on a root. */
  parentId: string | null;
  /** The people who lead the unit, by name in Swedish order. */
  managers: Array<{ id: string; name: string }>;
  /** How many people are assigned to the unit itself, its managers included. */
  placed: number;
  /** How many people are assigned to the unit or to a unit below it, each person once. */
  branch: number;
  /** Who the people placed here report to: the unit's own managers, the managers of a unit above, or nobody. */
  line: 'own' | 'above' | 'none';
  /** False when people are assigned to the unit but no `unit:` group names it, so it has no name and no place. */
  pushed: boolean;
}
export interface OrganisationOverview {
  /** Every unit, by label in Swedish order; the tree is `parentId`. */
  units: OrganisationUnit[];
  /** People who are provisioned and active but placed on no unit, so they can do nothing (D68). */
  unplaced: number;
}
/** The people assigned to one unit, by name in Swedish order, as the tree shows them beside a selected unit. */
export interface OrganisationUnitPeople {
  unitId: string;
  unitLabel: string;
  people: StaffPerson[];
  /**
   * Who reports to the unit's managers from the units below it (D99 item 4), each with `below`, by name in Swedish
   * order: the managers of the nearest units that have one, and the people placed on a unit below that nobody leads.
   * Empty for a unit nobody leads, since the line passes through it.
   */
  reports: StaffPerson[];
}
/** D85: one group gives one capability. `groupLabel` is the group's name while the group is provisioned, null when only this row remains. */
export interface GroupCapability {
  groupExternalId: string;
  groupLabel: string | null;
  capability: Capability;
}
export interface UsersAdminOverview {
  /** Each row is named by its own group, whichever groups `groups` holds. */
  groupCapabilities: GroupCapability[];
  /**
   * The organisation's groups with an external id, by name in Swedish order, at most the first 10 000: what the group
   * picker offers before anything is typed and finds at once. It asks the server for the others
   * (`POST /api/admin/users/groups/search`), so every group can be chosen however many the catalogue pushes.
   */
  groups: Array<{ id: string; label: string }>;
  capabilities: Capability[];
  /**
   * The organisation's units as the people list offers them to narrow by (D100): the nodes of the tree (D99), by label
   * in Swedish order. `parentLabel` tells two units with one name apart; null on a root.
   */
  units: Array<{ id: string; label: string; parentLabel: string | null }>;
  /**
   * The clients that push people into this organisation (D68) and when each was last heard from. `silent` is the
   * server's reading of that time: never seen, or not for two days, where a reconciliation is due daily (D109).
   */
  provisioners: ProvisionerAdminRow[];
}
/**
 * D107: one client that pushes people into the organisation, as Administration › Användare lists it. `id` is what the
 * audit names it by. `previousValidUntil` is set while the key that was replaced last still answers. Never the key.
 */
export interface ProvisionerAdminRow {
  id: string;
  label: string;
  lastSeenAt: string | null;
  silent: boolean;
  previousValidUntil: string | null;
}
/** D107: the name a provisioner is issued under, as `scripts/provisioner-token.ts` takes it. */
export const PROVISIONER_ID_PATTERN = '^[a-z0-9][a-z0-9-]{1,63}$';
export const PROVISIONER_LABEL_MAX = 120;
/**
 * D107: what a provisioner's label may hold: one line of text, without a control character (Unicode's Cc: U+0000 to
 * U+001F and U+007F to U+009F). A NUL in particular cannot be stored, so a label with one is refused before it reaches
 * the store.
 */
export const PROVISIONER_LABEL_PATTERN = '^[^\\u0000-\\u001f\\u007f-\\u009f]*$';
/** D107: how long the key that is replaced may still answer, in hours; 0 ends it at once. */
export const PROVISIONER_GRACE_HOURS = [24, 168, 0] as const;
export const ProvisionerIssueInput = Type.Object(
  {
    id: Type.String({ pattern: PROVISIONER_ID_PATTERN }),
    label: Type.String({ minLength: 1, maxLength: PROVISIONER_LABEL_MAX, pattern: PROVISIONER_LABEL_PATTERN }),
  },
  { additionalProperties: false },
);
export type ProvisionerIssueInputType = Static<typeof ProvisionerIssueInput>;
export const ProvisionerRotateInput = Type.Object(
  { graceHours: literals(PROVISIONER_GRACE_HOURS) },
  { additionalProperties: false },
);
export type ProvisionerRotateInputType = Static<typeof ProvisionerRotateInput>;
/**
 * D107: the answer to issuing or rotating a provisioner's key. `token` is the key itself, in this answer and nowhere
 * else: Clew keeps its digest and cannot show it again.
 */
export interface ProvisionerKeyIssued {
  /** The provisioner the key is for; its row is in `overview`. */
  id: string;
  token: string;
  /** Where the provisioner sends the key: the address the SCIM server answers at, as the server knows it. */
  address: string;
  overview: UsersAdminOverview;
  /**
   * Only on a rotation that ended a key early: until when the key replaced before this one would still have answered.
   * Clew keeps one replaced key (D107 item 5), so a rotation inside a grace period ends the key replaced earlier at
   * once, whatever period is chosen.
   */
  endedEarlier?: string;
}
/**
 * D100: what a person's row says about their access, as the people list narrows by it. `disabled` is a deactivated
 * person; of the others, `no-access` has no unit and so no grant (D68), and the two remaining say whether an identity
 * binding exists. The words are addresses (D43), so English.
 */
export const USER_STATUSES = ['signed-in', 'not-signed-in', 'no-access', 'disabled'] as const;
export type UserStatus = (typeof USER_STATUSES)[number];
/** D100: how many people a page of the list may hold; the first is the default. */
export const USERS_PAGE_SIZES = [25, 50, 100] as const;
/**
 * The most characters a key pushed over SCIM may hold (D68): a user's or a group's `externalId`, and so a unit id, which
 * is what follows `unit:` in its group's key. It is the SCIM server's limit for every text attribute it stores. The
 * administration fields that name such a key take it, so that an administrator can name every key SCIM stored: an
 * audience's units and groups, a group-capability row, the people list's unit and a preview's unit (A6). An entity's
 * key is shorter (`ENTITY_KEY_MAX`, D97): a unit whose id is longer than that is stored and may be named in those
 * fields, but is never offered as an entity.
 */
export const PROVISIONED_KEY_LENGTH = 512;
/**
 * D100: the most a question about the people may hold. The page holds what it sends to the same limits, so that
 * nothing a person types or an address names is refused as a malformed request.
 */
export const USERS_QUERY_LIMITS = { text: 200, unitId: PROVISIONED_KEY_LENGTH, page: 1_000_000 } as const;
/**
 * D100: one page of Administration › Användare, asked for in a request body so that a searched name is never part of
 * an address. Every part narrows the list further. `text` is words matched without regard to case against the name,
 * the title, the user name, the e-mail and the titles of the person's employments (D110, D114), each word in one of
 * them. `unitId` is a unit with everything below it in the tree. `role` is a role on some unit, and with `unitId` on
 * one of those units.
 */
export const UsersAdminQuery = Type.Object(
  {
    text: Type.Optional(Type.String({ maxLength: USERS_QUERY_LIMITS.text })),
    unitId: Type.Optional(Type.String({ minLength: 1, maxLength: USERS_QUERY_LIMITS.unitId })),
    role: Type.Optional(RoleSchema),
    status: Type.Optional(literals(USER_STATUSES)),
    capability: Type.Optional(CapabilitySchema),
    page: Type.Optional(Type.Integer({ minimum: 1, maximum: USERS_QUERY_LIMITS.page })),
    pageSize: Type.Optional(literals(USERS_PAGE_SIZES)),
  },
  { additionalProperties: false },
);
export type UsersAdminQueryType = Static<typeof UsersAdminQuery>;
/** D100: one page of the people list, by name in Swedish order. */
export interface UsersAdminPage {
  rows: UserAdminRow[];
  /** How many people the query matches, across every page. */
  total: number;
  /** How many people the organisation has, whatever the query. */
  all: number;
  /** The page that was read, 1-based: the one asked for, or the last one when the list has become shorter than that. */
  page: number;
  pageSize: number;
}
/** A unit id or a group's key as an administrator names one: any key SCIM stored (A6). */
const provisionedKey = Type.String({ minLength: 1, maxLength: PROVISIONED_KEY_LENGTH });
export const GroupCapabilityInput = Type.Object(
  { groupExternalId: provisionedKey, capability: CapabilitySchema },
  { additionalProperties: false },
);
export type GroupCapabilityInputType = Static<typeof GroupCapabilityInput>;
/** How many groups one search of the group picker on Administration › Användare answers with. */
export const GROUP_SEARCH_LIMIT = 10;
/**
 * The group picker on Administration › Användare asks the server for the organisation's groups whose name or external
 * id holds every word of `text`, without regard to case; in a body, as the people list asks (D100), and no longer than
 * the people list's search text.
 */
export const GroupSearchInput = Type.Object(
  { text: Type.String({ maxLength: USERS_QUERY_LIMITS.text }) },
  { additionalProperties: false },
);
export type GroupSearchInputType = Static<typeof GroupSearchInput>;
/** The answer to a search of the group picker: at most `GROUP_SEARCH_LIMIT` groups, by name in Swedish order. */
export interface GroupSearchResult {
  groups: UsersAdminOverview['groups'];
}
export const ConnectorAudienceSchema = Type.Union([
  object({ mode: Type.Literal('all') }),
  object({
    mode: Type.Literal('selected'),
    roles: Type.Optional(Type.Array(RoleSchema, { uniqueItems: true, maxItems: 2 })),
    units: Type.Optional(Type.Array(provisionedKey, { uniqueItems: true, maxItems: 200 })),
    groups: Type.Optional(Type.Array(provisionedKey, { uniqueItems: true, maxItems: 200 })),
  }),
]);
export type ConnectorAudience = Static<typeof ConnectorAudienceSchema>;
export const ConnectorStateSchema = Type.Union([
  Type.Literal('draft'),
  Type.Literal('enabled'),
  Type.Literal('disabled'),
]);
export type ConnectorState = Static<typeof ConnectorStateSchema>;
export const ConnectorHealthSchema = object({
  status: Type.Union([
    Type.Literal('ok'),
    Type.Literal('unreachable'),
    Type.Literal('manifest-invalid'),
    Type.Literal('secret-rejected'),
    Type.Literal('untested'),
  ]),
  at: Type.String(),
  detail: Type.Optional(Type.String()),
});
export type ConnectorHealth = Static<typeof ConnectorHealthSchema>;
/** An administrator's per-capability switch. Narrowing only: `false` is the only value, so nothing can be switched on past the manifest. */
export const CapabilitySwitchSchema = object({
  enabled: Type.Optional(Type.Literal(false)),
  model: Type.Optional(Type.Literal(false)),
});
/**
 * What is stored per capability: the two narrowing switches, and `menu: true` when the administrator put the capability's
 * view in the menu (D40). The menu is a place, not access, so it is the one value that is switched on, and only for a
 * view that can be a tool. A read about an entity has two more places an administrator chooses (D97): `lens: true`
 * offers it under Visa on the entity's list, and `column` names the one field of its view shown on "Alla".
 */
export const CapabilityOverrideSchema = object({
  enabled: Type.Optional(Type.Literal(false)),
  model: Type.Optional(Type.Literal(false)),
  menu: Type.Optional(Type.Literal(true)),
  lens: Type.Optional(Type.Literal(true)),
  column: Type.Optional({ ...viewKey, description: 'The key of the field of the view shown as a column on "Alla".' }),
});
export type CapabilityOverride = Static<typeof CapabilityOverrideSchema>;
/** What is stored per area of a connector (D54): `figure: false` when the administrator switched its figure off on Hem. Narrowing only. */
export const AreaOverrideSchema = object({ figure: Type.Optional(Type.Literal(false)) });
export type AreaOverride = Static<typeof AreaOverrideSchema>;
const connectorId = Type.String({ pattern: '^[a-z][a-z0-9-]*$', minLength: 1, maxLength: 40 });
const connectorUrl = Type.String({ pattern: '^https?://[^\\s]+$', minLength: 8, maxLength: 500 });
const connectorSecret = Type.String({ minLength: 16, maxLength: 500 });
/** Administration inputs (D23). Validated again on the server; a secret never comes back out. */
export const AddConnectorInput = object({ id: connectorId, url: connectorUrl, secret: connectorSecret });
export type AddConnectorInput = Static<typeof AddConnectorInput>;
export const ConnectorPatchInput = Type.Partial(
  object({
    state: ConnectorStateSchema,
    audience: ConnectorAudienceSchema,
    scanEnabled: Type.Boolean(),
    toolsEnabled: Type.Boolean(),
    /** The shared header (D88): true makes this connector the one that gives it, taking it from the previous holder; false gives it up. */
    header: Type.Boolean(),
    capabilities: Type.Record(Type.String({ maxLength: 80 }), CapabilitySwitchSchema),
    url: connectorUrl,
    /** Views in the menu (D40), by capability name: true puts the view under Verktyg, false takes it out. */
    menu: Type.Record(Type.String({ maxLength: 80 }), Type.Boolean()),
    /** Lenses on an entity's list (D97), by capability name: true offers the read under Visa, false takes it out. */
    lens: Type.Record(Type.String({ maxLength: 80 }), Type.Boolean()),
    /** Columns on "Alla" (D97), by capability name: the key of the view field shown, null takes the column out. */
    column: Type.Record(Type.String({ maxLength: 80 }), Type.Union([viewKey, Type.Null()])),
    /** Figures on Hem (D54), by area id: false switches the area's figure off for the connector's audience, true back on. */
    figures: Type.Record(Type.String({ maxLength: 80 }), Type.Boolean()),
  }),
  closed,
);
export type ConnectorPatchInput = Static<typeof ConnectorPatchInput>;
export const RotateSecretInput = object({ secret: connectorSecret });
export type RotateSecretInput = Static<typeof RotateSecretInput>;
export const RefreshManifestInput = object({ apply: Type.Optional(Type.Boolean()) });
export type RefreshManifestInput = Static<typeof RefreshManifestInput>;
export const PreviewQuery = object({
  role: RoleSchema,
  unitId: Type.Optional(Type.String({ maxLength: PROVISIONED_KEY_LENGTH })),
});
export type PreviewQuery = Static<typeof PreviewQuery>;
export type CheckLevel = 'ok' | 'warn' | 'fail';
/** One line of a check's log: the conformance check's English lines for the CLI, a provider test's Swedish ones for the page. */
export interface CheckFinding {
  level: CheckLevel;
  text: string;
}
/** Where a row of the conformance check belongs on the page (D44). */
export type CheckGroup = 'connection' | 'capabilities' | 'surfaces';
/** One row of the conformance check as an administrator reads it (D44): Swedish, and never an answer from the service. */
export interface CheckItem {
  level: CheckLevel;
  group: CheckGroup;
  label: string;
  description?: string;
  capability?: string;
}
export interface CheckReport {
  ok: boolean;
  items: CheckItem[];
}
/** What the administrator sees of a capability: the manifest's facts plus the effective switches. */
export interface ConnectorCapabilityView {
  name: string;
  kind: 'read' | 'propose' | 'execute';
  title: string;
  description: string;
  model: boolean;
  roles: Role[] | null;
  enabled: boolean;
  tool: boolean;
  /** The row this capability's view would be in the menu (D40) and whether it is there; null when it cannot be a tool (not a read with a view that opens without input). */
  menu: { label: string; icon: MenuIcon; on: boolean } | null;
  /** The entity kind its rows concern (D97); absent when it declares no `about`. */
  about?: EntityKind;
  /** A read about an entity offered under Visa on the entity's list (D97 item 3) and whether it is; absent when it cannot be a lens. */
  lens?: { on: boolean };
  /**
   * A read about an entity as a column on "Alla" (D97 item 4): the fields of its view it may give and the one shown, null
   * for none; absent when it cannot give a column. At most `ENTITY_COLUMNS_MAX` are shown for one entity kind across the
   * installation, which the server enforces.
   */
  column?: { fields: Array<{ key: string; label: string }>; on: string | null };
}
export interface ConnectorAreaView {
  id: string;
  title: string;
  roles: Role[];
  standing: string[];
  /** The connector declares a figure for the area. */
  figure: boolean;
  /** "Visa nyckeltalet" (D54): the figure is drawn on Hem; false when the administrator switched it off. */
  figureShown: boolean;
  /** The area's icon from the manifest (D41), drawn in its chip on the Områden tab (D71). */
  icon?: MenuIcon;
}
export interface ConnectorSummary {
  id: string;
  bundled: boolean;
  source: string;
  kind: 'core' | 'passthrough' | 'derived' | null;
  /** The system's place in the registration order, which gives its mark the hue (D71); null for Clew's own. */
  ordinal: number | null;
  url: string | null;
  state: ConnectorState;
  health: ConnectorHealth;
  audience: ConnectorAudience;
  scanEnabled: boolean;
  toolsEnabled: boolean;
  /** The connector that gives Clew its shared header (D88): at most one row holds it. */
  header: boolean;
  /** Registered in the live registry right now (a remote draft with no manifest is not). */
  registered: boolean;
  counts: { capabilities: number; execute: number; tools: number };
  manifestAt: string | null;
  secretChangedAt: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface AuditEntryView {
  at: string;
  actor: string;
  action: string;
  details: Record<string, unknown>;
}
export interface ConnectorDetail extends ConnectorSummary {
  protocol: number | null;
  scan: boolean;
  /** The read the manifest names as the header's source (D88), or null when the connector cannot give one. */
  headerCapability: string | null;
  createdBy: string;
  updatedBy: string;
  capabilities: ConnectorCapabilityView[];
  areas: ConnectorAreaView[];
  history: AuditEntryView[];
}
/** The structural preview: what a person with this role and unit would get from one connector. No data, no call to the service. */
export interface ConnectorPreview {
  role: Role;
  unitId: string | null;
  visible: boolean;
  areas: Array<{ id: string; title: string; standing: string[] }>;
  tools: string[];
  /** The labels of the menu rows this person gets (D40). */ menu: string[];
}
export interface ManifestDiff {
  added: string[];
  removed: string[];
  changed: string[];
  areasAdded: string[];
  areasRemoved: string[];
  same: boolean;
}

/**
 * Model administration (D24): providers (an OpenAI-compatible endpoint with a sealed key) and the models under them,
 * each with the connector's audience shape, an on/off state, a default flag and a tools switch. A key is never
 * returned; the views say only whether there is one and when it changed.
 */
export const ProviderHealthSchema = object({
  status: Type.Union([
    Type.Literal('ok'),
    Type.Literal('unreachable'),
    Type.Literal('key-rejected'),
    Type.Literal('untested'),
  ]),
  at: Type.String(),
  detail: Type.Optional(Type.String()),
});
export type ProviderHealth = Static<typeof ProviderHealthSchema>;
export const ModelStateSchema = Type.Union([Type.Literal('enabled'), Type.Literal('disabled')]);
export type ModelState = Static<typeof ModelStateSchema>;
/**
 * What a call says about reasoning (D84). `provider-default` says nothing, so an endpoint that does not know the field
 * never sees it; `none` asks the model not to reason, for a model that refuses tools while it does. "Testa" settles it;
 * nobody sets it by hand.
 */
export type ModelReasoning = 'provider-default' | 'none';
const adminSlug = Type.String({ pattern: '^[a-z][a-z0-9-]*$', minLength: 1, maxLength: 60 });
const endpointUrl = Type.String({ pattern: '^https?://[^\\s]+$', minLength: 8, maxLength: 500 });
/** Empty means no key: a local endpoint may need none. */
const providerKey = Type.String({ maxLength: 1000 });
const adminTitle = Type.String({ minLength: 1, maxLength: 80, pattern: '^[^\\r\\n]+$' });
const adminDescription = Type.String({ maxLength: 200, pattern: '^[^\\r\\n]*$' });
/** The id the endpoint knows the model by, sent as `model` in every request. */
const wireModel = Type.String({ minLength: 1, maxLength: 200, pattern: '^[^\\s]+$' });
export const AddProviderInput = object({
  id: adminSlug,
  title: adminTitle,
  baseUrl: endpointUrl,
  apiKey: Type.Optional(providerKey),
});
export type AddProviderInput = Static<typeof AddProviderInput>;
export const ProviderPatchInput = Type.Partial(object({ title: adminTitle, baseUrl: endpointUrl }), closed);
export type ProviderPatchInput = Static<typeof ProviderPatchInput>;
export const ProviderKeyInput = object({ apiKey: providerKey });
export type ProviderKeyInput = Static<typeof ProviderKeyInput>;
export const AddModelInput = object({
  providerId: adminSlug,
  model: wireModel,
  title: Type.Optional(adminTitle),
  description: Type.Optional(adminDescription),
  tools: Type.Optional(Type.Boolean()),
});
export type AddModelInput = Static<typeof AddModelInput>;
export const ModelPatchInput = Type.Partial(
  object({
    title: adminTitle,
    description: adminDescription,
    model: wireModel,
    state: ModelStateSchema,
    audience: ConnectorAudienceSchema,
    isDefault: Type.Boolean(),
    tools: Type.Boolean(),
  }),
  closed,
);
export type ModelPatchInput = Static<typeof ModelPatchInput>;
/** The person's own pick in the composer; null goes back to the default. */
export const ModelChoiceInput = object({ modelId: Type.Union([adminSlug, Type.Null()]) });
export type ModelChoiceInput = Static<typeof ModelChoiceInput>;
export interface ProviderSummary {
  id: string;
  title: string;
  baseUrl: string;
  hasKey: boolean;
  keyChangedAt: string | null;
  health: ProviderHealth;
  /** How many models are added under it, and how many of them are on. */
  models: number;
  enabledModels: number;
  createdAt: string;
  updatedAt: string;
}
export interface ProviderDetail extends ProviderSummary {
  createdBy: string;
  updatedBy: string;
  history: AuditEntryView[];
}
export interface ModelSummary {
  id: string;
  providerId: string;
  providerTitle: string;
  model: string;
  title: string;
  description: string;
  state: ModelState;
  audience: ConnectorAudience;
  isDefault: boolean;
  tools: boolean;
  reasoning: ModelReasoning;
  /** The provider's health: a model answers when its endpoint does. */
  health: ProviderHealth;
  createdAt: string;
  updatedAt: string;
}
export interface ModelDetail extends ModelSummary {
  createdBy: string;
  updatedBy: string;
  history: AuditEntryView[];
}
/** "Testa": what the endpoint said, the model ids it lists (when it answers `GET /models`), and the health recorded. */
export interface ProviderTestReport {
  ok: boolean;
  findings: CheckFinding[];
  models: string[];
  health: ProviderHealth;
}

/** A figure's tone (D54): the connector sends it, Clew says it in its own words (Lugnt, Bevaka, Behöver dig) or not at all. */
export const FigureToneSchema = Type.Union([
  Type.Literal('ok'),
  Type.Literal('warn'),
  Type.Literal('alert'),
  Type.Literal('none'),
]);
export type FigureTone = Static<typeof FigureToneSchema>;
/**
 * An area's figure as the browser gets it (D54): the connector's answer, with `opens` resolved to the read it names when
 * the person may call it, and the time Clew read it. Without a value the label is a sentence. A connector that did not
 * answer is the registry's one warning figure (`unavailable`, D8), never an empty tile.
 */
export const AreaFigureSchema = object({
  label: Type.String({ maxLength: 120 }),
  tone: FigureToneSchema,
  value: Type.Optional(Type.String({ maxLength: 40 })),
  comparison: Type.Optional(Type.String({ maxLength: 160 })),
  progress: Type.Optional(object({ value: Type.Number({ minimum: 0 }), max: Type.Number({ exclusiveMinimum: 0 }) })),
  opens: Type.Optional(object({ capability: Type.String(), title: Type.String() })),
  unavailable: Type.Optional(Type.Literal(true)),
  observedAt: Type.Optional(instant),
});
export type AreaFigure = Static<typeof AreaFigureSchema>;
/** An area: a lens on one connector for one role (D3), a choice in Hem's area filter. Configuration, not code. */
export const AreaSchema = object({
  id: Type.String(),
  title: Type.String(),
  connector: Type.String(),
  source: Type.String(),
  /** The icon the connector named for the area (D41), from Clew's list; drawn in the area's mark on its cards and views (D71). */
  icon: Type.Optional(MenuIconSchema),
  /** The area's figure (D54): what its connector answered, null when it answered none or the administrator switched it off. */
  figure: Type.Union([AreaFigureSchema, Type.Null()]),
  needsYou: Type.Integer(),
  waiting: Type.Integer(),
  /** The highest attention level among the open cards that need the person; the sidebar count takes its colour from it. */
  urgency: Type.Union([AttentionLevelSchema, Type.Null()]),
  /** The area's standing capabilities: a propose or execute is suggested under "Menar du" as the person types in Hem's box. */
  standing: Type.Array(
    object({
      capability: Type.String(),
      label: Type.String(),
      kind: Type.Union([Type.Literal('read'), Type.Literal('propose'), Type.Literal('execute')]),
    }),
  ),
  schedules: Type.Array(object({ label: Type.String(), when: Type.String() })),
});
export type Area = Static<typeof AreaSchema>;
export const ActInput = object({
  actionId: id,
  refs: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 50 })),
  reviews: Type.Optional(Type.Array(ReviewEvidenceSchema, { maxItems: 50 })),
  /** The person's answers to the action's asks (D112 item 10): the asked properties only, merged into the input. */
  values: Type.Optional(AskValuesSchema),
});
export type ActInput = Static<typeof ActInput>;
/** `POST /api/threads/:id/effect`: what the action would write with these rows and answers; nothing is written (D112). */
export const EffectInput = object({
  actionId: id,
  refs: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 50 })),
  values: Type.Optional(AskValuesSchema),
});
export type EffectInput = Static<typeof EffectInput>;
/**
 * `GET /api/asks/times`: for an ask of kind `meeting`, three free times of the ask's length in the person's own calendar
 * (D112 item 10), and the person's day when `date` is asked for, so the dialog can draw it. Nobody else's calendar is
 * read and nothing is written to a calendar.
 */
export const MeetingTimesSchema = object({
  durationMinutes: Type.Integer({ minimum: 5, maximum: 480 }),
  /** Free times in the window, earliest first, at most one a day where possible; empty when the calendar cannot be read or nothing is free. */
  slots: Type.Array(object({ start: instant, end: instant }), { maxItems: 3 }),
  /** The person's own day for `date`: the calendar family's day view (events and live proposals). */
  day: Type.Optional(DayViewSchema),
});
export type MeetingTimes = Static<typeof MeetingTimesSchema>;

/** The day's rhythm (D28): the review, the bundles and the quiet hours as Stockholm wall-clock times that the scheduler and the page both read. */
export const dayRhythm = { review: '06:00', bundles: ['12:00', '16:00'], quiet: '17:00', graceMinutes: 15 } as const;
/**
 * One point on the day track: what it is, when (HH:MM Stockholm), whether it has passed, and the cards it pushed. A scan
 * pushes its cards in one go, so a point is a moment, never a card: `count` says how many cards the moment brought and,
 * for an interruption, `title` names the first. Pushes within `dayRhythm.graceMinutes` of the review or a bundle belong to it.
 */
export const RhythmPointSchema = object({
  kind: Type.Union([
    Type.Literal('review'),
    Type.Literal('interruption'),
    Type.Literal('bundle'),
    Type.Literal('quiet'),
  ]),
  at: Type.String(),
  state: Type.Union([Type.Literal('done'), Type.Literal('next'), Type.Literal('later')]),
  title: Type.Optional(Type.String()),
  count: Type.Optional(Type.Integer()),
});
export type RhythmPoint = Static<typeof RhythmPointSchema>;
export const AttentionSchema = object({
  used: Type.Integer(),
  budget: Type.Integer(),
  bundledUntil: Type.Union([Type.String(), Type.Null()]),
  rhythm: Type.Array(RhythmPointSchema),
});
export type Attention = Static<typeof AttentionSchema>;

/** The composer's input: text plus the chips the person attached (D12). `conversationId` continues an earlier conversation. */
export const ConversationInput = object({
  text: Type.String({ minLength: 1, maxLength: 400, pattern: '^[^\\r\\n]+$' }),
  chips: Type.Optional(Type.Array(ChipSchema, { maxItems: 8 })),
  conversationId: Type.Optional(id),
});
export type ConversationInput = Static<typeof ConversationInput>;
/** One turn's answer: its shape, where it came from, and what it produced for the page. */
export const ConversationResponseSchema = object({
  conversationId: id,
  thread: ThreadSchema,
  shape: AnswerShape,
  assistant: AssistantMode,
  answer: object({ body: Type.String(), source: Type.String(), at: instant }),
  view: Type.Optional(ViewRefSchema),
  forslag: Type.Optional(object({ threadId: id })),
  draft: Type.Optional(
    object({
      kind: Type.Union([Type.Literal('select'), Type.Literal('replan'), Type.Literal('action')]),
      threadId: id,
      refs: Type.Optional(Type.Array(Type.String())),
      week: Type.Optional(Type.String()),
      actionId: Type.Optional(Type.String({ minLength: 1, maxLength: 120 })),
      values: Type.Optional(AskValuesSchema),
      thread: ThreadSchema,
    }),
  ),
  clewActions: Type.Array(ClewActionSchema),
  verbs: Type.Optional(Type.Array(VerbSchema)),
  followUps: Type.Array(Type.String()),
  sources: Type.Optional(Type.Array(SourceCitationSchema, { maxItems: 10 })),
  model: Type.Optional(ModelRefSchema),
});
export type ConversationResponse = Static<typeof ConversationResponseSchema>;
/**
 * A capability the turn reads while the person waits (D36): which system, what it asks, and how long it took. Shown
 * live under the question; the turn's audit row still names the tools once the answer is written.
 */
export const TurnStepSchema = object({
  id: Type.String(),
  capability: Type.String(),
  title: Type.String(),
  source: Type.String(),
  status: Type.Union([Type.Literal('running'), Type.Literal('complete'), Type.Literal('error')]),
  ms: Type.Optional(Type.Integer({ minimum: 0 })),
});
export type TurnStep = Static<typeof TurnStepSchema>;
/** What a turn tells while it runs (D36): a step, or the model's text so far as a delta; `reset` starts the text over (a new model step, the router taking over). */
export const TurnEventSchema = Type.Union([
  object({ type: Type.Literal('step'), step: TurnStepSchema }),
  object({ type: Type.Literal('text'), delta: Type.String(), reset: Type.Optional(Type.Boolean()) }),
]);
export type TurnEvent = Static<typeof TurnEventSchema>;
/** One server-sent event of `POST /api/conversation/stream` (D36): the turn's events, then the finished turn or the Swedish error. */
export const ConversationEventSchema = Type.Union([
  TurnEventSchema,
  object({ type: Type.Literal('done'), response: ConversationResponseSchema }),
  object({ type: Type.Literal('error'), message: Type.String() }),
]);
export type ConversationEvent = Static<typeof ConversationEventSchema>;
/** An object the `@` menu can offer: what is visible on the page first, then everything in scope. */
export const ObjectSchema = object({
  ref: Type.String(),
  kind: ChipKind,
  label: Type.String(),
  detail: Type.String(),
  threadId: Type.Optional(id),
  visible: Type.Boolean(),
});
export type ClewObject = Static<typeof ObjectSchema>;
/** What the row offers when it gets focus: questions with their source, things to do, earlier conversations. */
export const CompletionsSchema = object({
  completions: Type.Array(Type.String()),
  ask: Type.Array(object({ text: Type.String(), capability: Type.String(), source: Type.String() })),
  do: Type.Array(
    object({ text: Type.String(), capability: Type.String(), source: Type.String(), kind: Type.String() }),
  ),
  recent: Type.Array(object({ conversationId: id, title: Type.String(), at: instant })),
});
export type Completions = Static<typeof CompletionsSchema>;
/** One model a person may pick in the composer (D24): its name, what it is good for, and whether it is the installation's default. */
export const ModelChoiceSchema = object({
  id: Type.String(),
  title: Type.String(),
  description: Type.String(),
  isDefault: Type.Boolean(),
});
export type ModelChoice = Static<typeof ModelChoiceSchema>;
/**
 * The model behind the box, for one person (D8, D24): `configured` when they have any model at all, `available` while
 * its endpoint answers, `model` its name for the D8 banner, `current` the one their next question uses and `choices`
 * every model they may pick, the default first.
 */
export const AssistantStatusSchema = object({
  configured: Type.Boolean(),
  available: Type.Boolean(),
  model: Type.Union([Type.String(), Type.Null()]),
  checkedAt: Type.Union([instant, Type.Null()]),
  current: Type.Union([ModelChoiceSchema, Type.Null()]),
  choices: Type.Array(ModelChoiceSchema),
});
export type AssistantStatus = Static<typeof AssistantStatusSchema>;

/** Browser inputs. Everything is validated again on the server before it touches a source. */
export const AskInput = object({ question: Type.String({ minLength: 1, maxLength: 400, pattern: '^[^\\r\\n]+$' }) });
export const ReplyInput = object({ body: Type.String({ minLength: 1, maxLength: 400, pattern: '^[^\\r\\n]+$' }) });
export const ConfirmInput = object({ proposalIds: Type.Array(id, { minItems: 1, maxItems: 12, uniqueItems: true }) });
export const ReplanInput = object({ week: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }) });
export type AskInput = Static<typeof AskInput>;
export type ReplyInput = Static<typeof ReplyInput>;
export type ConfirmInput = Static<typeof ConfirmInput>;
export type ReplanInput = Static<typeof ReplanInput>;
/** A person's own booking and changes to it (D28): one event, one call, re-validated by the use case before the calendar is written. */
const email = Type.String({ format: 'email', maxLength: 200 });
export const CreateEventInput = object({
  decisionId: Type.String({ minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9:_.-]+$' }),
  title: Type.String({ minLength: 1, maxLength: 200, pattern: '^[^\\r\\n]+$' }),
  start: instant,
  end: instant,
  participants: Type.Array(email, { maxItems: 8, uniqueItems: true }),
  room: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
});
export const RescheduleEventInput = object({
  decisionId: Type.String({ minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9:_.-]+$' }),
  ref: Type.String({ minLength: 1, maxLength: 400 }),
  revision: Type.String({ minLength: 1, maxLength: 200 }),
  start: instant,
  end: instant,
});
export const CancelEventInput = object({
  decisionId: Type.String({ minLength: 1, maxLength: 100, pattern: '^[A-Za-z0-9:_.-]+$' }),
  ref: Type.String({ minLength: 1, maxLength: 400 }),
  revision: Type.String({ minLength: 1, maxLength: 200 }),
});
export const MoveProposalInput = object({ start: instant, end: instant });
export const AvailabilityInput = object({
  start: instant,
  end: instant,
  participants: Type.Array(email, { maxItems: 8, uniqueItems: true }),
  room: Type.Optional(Type.String({ minLength: 1, maxLength: 400 })),
});
export const DayInput = object({ date: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }) });
export type CreateEventInput = Static<typeof CreateEventInput>;
export type RescheduleEventInput = Static<typeof RescheduleEventInput>;
export type CancelEventInput = Static<typeof CancelEventInput>;
export type MoveProposalInput = Static<typeof MoveProposalInput>;
export type AvailabilityInput = Static<typeof AvailabilityInput>;
export type DayInput = Static<typeof DayInput>;
/** Who and what a booking form can offer: the unit's members and the rooms the calendar knows. */
export interface CalendarMember {
  name: string;
  email: string;
}
export type AvailabilityState = 'free' | 'busy' | 'unknown';
export interface AvailabilityResult {
  mine: AvailabilityState;
  participants: Array<{ email: string; name: string; state: AvailabilityState }>;
  room: { ref: string; name: string; state: AvailabilityState } | null;
}

/**
 * The connector manifest field by field (D60, item 5): what `GET /api/protocol/manifest-reference.json` answers and the
 * page at `/protocol/manifest` draws. Built from the manifest schema in `@clew/connectors`; the browser only reads it.
 */
export interface ReferenceRule {
  id: string;
  title: string;
  text: string;
  /** The field paths the rule binds together. */
  fields: string[];
  decision?: string;
  /** Where Clew applies it: when the manifest is loaded, when the connector is registered, in the conformance check, or on each call. */
  enforced: 'loader' | 'registry' | 'check' | 'call';
}
export interface ReferenceField {
  /** The heading's element id. */
  id: string;
  /** `capabilities[].view.fields[].key`: a dot per object, `[]` per array. */
  path: string;
  depth: number;
  required: boolean;
  type: string;
  description: string;
  constraints: string[];
  /** Present only in these variants of a union, such as `table` and `list` of a view. */
  variants?: string[];
  example?: unknown;
  rules: ReferenceRule[];
}
export interface ReferenceRecipe {
  id: string;
  title: string;
  text: string;
  example: unknown;
  /** The same example authored in TypeScript with TypeBox, generated from `example`, when it holds a schema. */ typebox?: string;
}
export interface ReferenceSection {
  id: string;
  title: string;
  paths: string[];
}
export interface ManifestReference {
  protocol: number;
  accepted: number[];
  sections: ReferenceSection[];
  fields: ReferenceField[];
  rules: ReferenceRule[];
  recipes: ReferenceRecipe[];
}
/**
 * The shared header (D87, D88): what a connector answers from its `header` capability and what the web app draws above
 * its rail. The menu has the shape `@clew/site-header` reads (`SiteMenu`): the site's name and address, then the places
 * in the band; a place's `children` are the row under the band while the place is current. An address is a path on
 * Clew's origin (`/calendar`) or an http(s) address (the intranet's sections). Ids are stable keys a host marks the
 * current place by. The logo, when the connector has one, is an https address or a path on Clew's origin.
 */
const siteLabel = Type.String({ minLength: 1, maxLength: 60, pattern: '^[^\\r\\n]+$' });
const siteHref = Type.String({ minLength: 1, maxLength: 500, pattern: '^(/(?!/)[^\\s\\\\]*|https?://[^\\s\\\\]+)$' });
const siteId = Type.String({ minLength: 1, maxLength: 60, pattern: '^[a-z0-9][a-z0-9-]*$' });
/**
 * What a place or a page is to Clew beyond the band (D112, amended 2026-11-11): `toolbox` is the intranet's page of
 * tools, which Hem links to under Verktygslådan as "Fler verktyg på intranätet". The installation marks it in its
 * content system; without a marked page Hem draws no such link.
 */
export const SITE_PURPOSES = ['toolbox'] as const;
const sitePurpose = Type.Optional(
  literals(SITE_PURPOSES, {
    description:
      '`toolbox`: the page that lists the intranet\'s tools. Hem links to it under Verktygslådan as "Fler verktyg på intranätet", in a new tab. At most one is used: the first in the band\'s order.',
  }),
);
export const SiteMenuLinkSchema = object({ id: siteId, label: siteLabel, href: siteHref, purpose: sitePurpose });
export type SiteMenuLink = Static<typeof SiteMenuLinkSchema>;
export const SiteMenuPlaceSchema = object({
  id: siteId,
  label: siteLabel,
  href: siteHref,
  children: Type.Optional(Type.Array(SiteMenuLinkSchema, { maxItems: 20 })),
  purpose: sitePurpose,
});
export type SiteMenuPlace = Static<typeof SiteMenuPlaceSchema>;
export const SiteHeaderOutputSchema = object(
  {
    site: object({ name: siteLabel, href: siteHref }),
    items: Type.Array(SiteMenuPlaceSchema, { minItems: 1, maxItems: 12 }),
    logo: Type.Optional(
      object({
        src: Type.String({ minLength: 1, maxLength: 500, pattern: '^(/(?!/)[^\\s\\\\]*|https://[^\\s\\\\]+)$' }),
        alt: siteLabel,
      }),
    ),
  },
  "What a connector's header capability answers (D88): the site's name and address, the places with their own pages, and the logo when the system has one. Clew validates it and draws it on every page for the people in the connector's audience.",
);
export type SiteHeaderOutput = Static<typeof SiteHeaderOutputSchema>;
/** What `GET /api/header` answers a signed-in person: the header their connector gives them, or Clew's default with Start alone. */
export interface SiteHeaderView {
  menu: { version: 1; site: { name: string; href: string }; items: SiteMenuPlace[] };
  logo: { src: string; alt: string } | null;
  /** The connector the header came from, or null for the default. */
  source: { id: string; label: string } | null;
}

// Named one by one: the server runs under Node through tsx, where a star re-export's names are not visible to an importer.
export {
  LOGO_ALT_MAX,
  LOGO_MAX_BYTES,
  LOGO_MEDIA_TYPES,
  THEME_BASE_COLORS,
  THEME_COLOR_TOKENS,
  THEME_CONTRAST_PAIRS,
  THEME_FILE_MAX_BYTES,
  THEME_NAME_MAX,
  checkThemeContrast,
  contrastRatio,
  isThemeHex,
  parseThemeFile,
  themeFileOf,
  themeFileSchema,
  themeFromAccent,
  type InstallationTheme,
  type LogoMediaType,
  type ThemeColorPair,
  type ThemeColorToken,
  type ThemeColors,
  type ThemeFileResult,
  type ThemeMode,
  type ThemeProblem,
} from './theme-file';
import type { InstallationTheme, ThemeProblem } from './theme-file';
/**
 * The installation's appearance (D98) as every browser reads it before a person has signed in: the theme, or null for
 * Astryx Neutral, and the logo's addresses on Clew's own origin, or null for none. `revision` changes with every save,
 * so a cached copy is recognised as old and a logo's address is new when its image is.
 */
export interface InstallationAppearance {
  revision: number;
  theme: InstallationTheme | null;
  logo: { src: string; darkSrc?: string; alt: string } | null;
}
/** Administration › Utseende: the same appearance with who saved it and when. */
export interface AppearanceAdminView extends InstallationAppearance {
  updatedAt: string | null;
  updatedBy: string | null;
}
/** A refused theme file names every problem found, for the page to list under the upload (D98). */
export interface ThemeRefusal {
  error: string;
  problems: ThemeProblem[];
}
/** The parsed theme file itself; `parseThemeFile` is the validation, so the schema only bounds the envelope. */
export const AppearanceThemeInput = Type.Object({ file: Type.Unknown() }, { additionalProperties: false });
export type AppearanceThemeInputType = Static<typeof AppearanceThemeInput>;
const LogoImageInput = Type.Object(
  {
    mediaType: Type.Union([Type.Literal('image/png'), Type.Literal('image/svg+xml')]),
    /** The image's bytes in base64. */
    data: Type.String({ minLength: 1, maxLength: 360_000, pattern: '^[A-Za-z0-9+/]+={0,2}$' }),
  },
  { additionalProperties: false },
);
/**
 * A save of the logo. `light` left out keeps the stored image and only the name changes; `dark` left out keeps the
 * stored dark variant and `null` removes it.
 */
export const AppearanceLogoInput = Type.Object(
  {
    alt: Type.String({ minLength: 1, maxLength: 120, pattern: '\\S' }),
    light: Type.Optional(LogoImageInput),
    dark: Type.Optional(Type.Union([LogoImageInput, Type.Null()])),
  },
  { additionalProperties: false },
);
export type AppearanceLogoInputType = Static<typeof AppearanceLogoInput>;
