import { FormatRegistry, Type, type Static } from '@sinclair/typebox';

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

const object = <T extends Record<string, import('@sinclair/typebox').TSchema>>(properties: T, description?: string) =>
  Type.Object(properties, { additionalProperties: false, ...(description ? { description } : {}) });
const instant = Type.String({ format: 'date-time', maxLength: 40 });
// TypeBox's own `Value.Check` knows no formats until one is registered; Ajv (the routes) has its own. One definition, here, so every schema with an instant checks the same way.
if (!FormatRegistry.Has('date-time'))
  FormatRegistry.Set(
    'date-time',
    value =>
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/.test(value) &&
      !Number.isNaN(Date.parse(value)),
  );
const id = Type.String({ minLength: 1, maxLength: 80 });

/** One figure in the fixed "Läget" row: a sentence with a comparison, never a bare KPI tile. */
export const FigureSchema = object({
  id: Type.Union([
    Type.Literal('korttidsfranvaro'),
    Type.Literal('budgetavvikelse'),
    Type.Literal('hme'),
    Type.Literal('utvecklingssamtal'),
  ]),
  label: Type.String(),
  value: Type.String(),
  comparison: Type.String(),
  tone: Type.Union([Type.Literal('ok'), Type.Literal('warn'), Type.Literal('alert')]),
  source: Type.String(),
  observedAt: instant,
  /** Optional progress towards a target, drawn as a bar in the tile. */
  progress: Type.Optional(object({ value: Type.Integer(), max: Type.Integer() })),
});
export type Figure = Static<typeof FigureSchema>;

/** A calendar occurrence as the browser sees it. Participant names stay inside the calendar surface. */
export const CalendarEventSchema = object({
  id: id,
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
export const ViewFieldSchema = object({
  key: { ...viewKey, description: 'The property of a record the field shows.' },
  label: { ...viewLabel, description: "Swedish. The column heading or the field's name." },
  format: Type.Optional(ViewFormat),
  tones: Type.Optional(
    Type.Record(Type.String({ maxLength: 40 }), ViewTone, {
      description: 'For `status`: the tone per value. A value without one is neutral.',
    }),
  ),
});
export type ViewField = Static<typeof ViewFieldSchema>;
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
    open: Type.Optional(ViewOpenSchema),
    input: Type.Optional(ViewInputSchema),
    empty: Type.Optional(
      Type.String({ minLength: 1, maxLength: 120, description: 'Swedish. Shown when there are no rows.' }),
    ),
    modelReads,
  });
export const ViewSchema = Type.Union(
  [
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
export type PanelViewSpec = View & { capability: string; connector: string; source: string; chip: boolean };

/**
 * A view as a tool in the menu (D40): one click away on every page, under Verktyg. Any read that declares a view and
 * opens without input can be one; an administrator chooses which, view by view. A connector may say what a view's row
 * is called and which of Clew's icons it carries; without that the row takes the capability's title and a plain icon. The same list of
 * icons serves an area (D41): the name a connector gives its area is drawn on the area's button under the box.
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
export const MenuIconSchema = Type.Union(
  MENU_ICONS.map(name => Type.Literal(name)),
  { description: "One of Clew's icons. The connector sends a name, never a drawing." },
);
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
  /** `view` is the read that shows this hit in the panel, when its source declares one (D38): a person's contact card, a case. */
  rows: Type.Array(
    object({
      ...SearchHitSchema.properties,
      stale: Type.Union([Type.Boolean(), Type.Null()]),
      connector: Type.String(),
      view: Type.Optional(ViewRefSchema),
    }),
  ),
  sources: Type.Array(SearchSourceSchema),
});
export type SearchResult = Static<typeof SearchResultSchema>;
/** A Clew-side action the conversation proposes; executed only after the person confirms, through the thread endpoints. */
export const ClewActionSchema = object({
  n: Type.Integer(),
  kind: Type.Union([Type.Literal('dismiss'), Type.Literal('snooze')]),
  threadId: id,
  label: Type.String(),
});
export type ClewAction = Static<typeof ClewActionSchema>;
/** A change the conversation made to a card as a draft. The card's own button executes; the conversation never touches a source. */
export const DraftSchema = object({
  kind: Type.Union([Type.Literal('select'), Type.Literal('replan')]),
  threadId: id,
  refs: Type.Optional(Type.Array(Type.String())),
  week: Type.Optional(Type.String()),
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
  label: Type.String(),
  detail: Type.String(),
  selectable: Type.Boolean(),
  selected: Type.Boolean(),
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
  /** Where a read capability renders: a side-panel view, or a link out to the source system. */
  target: Type.Optional(Type.Union([Type.Literal('panel'), Type.Literal('link')])),
  /** Fixed input merged with the selected item refs at execution time. */
  input: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  /** Whether the action takes the selected items as `refs`. */
  usesItems: Type.Optional(Type.Boolean()),
  confirm: Type.Optional(Type.String()),
  /**
   * The person reviews the items one at a time before this execute runs (D70): Clew opens the review flow from the
   * card's next step, and the write happens once, with the refs the person approved. Only on an execute with `usesItems`.
   */
  review: Type.Optional(Type.Literal('each')),
  /** A read capability of the same connector that takes `{ ref }` for one item and answers a `PreviewOutput` (D70). */
  preview: Type.Optional(Type.String()),
});
export type ThreadAction = Static<typeof ThreadActionSchema>;
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
  actions: Type.Array(ThreadActionSchema),
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
export const ConnectorAudienceSchema = Type.Union([
  object({ mode: Type.Literal('all') }),
  object({
    mode: Type.Literal('selected'),
    roles: Type.Optional(Type.Array(RoleSchema, { uniqueItems: true, maxItems: 2 })),
    units: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { uniqueItems: true, maxItems: 200 }),
    ),
    groups: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 80 }), { uniqueItems: true, maxItems: 200 }),
    ),
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
 * view that can be a tool.
 */
export const CapabilityOverrideSchema = object({
  enabled: Type.Optional(Type.Literal(false)),
  model: Type.Optional(Type.Literal(false)),
  menu: Type.Optional(Type.Literal(true)),
});
export type CapabilityOverride = Static<typeof CapabilityOverrideSchema>;
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
    capabilities: Type.Record(Type.String({ maxLength: 80 }), CapabilitySwitchSchema),
    url: connectorUrl,
    /** Views in the menu (D40), by capability name: true puts the view under Verktyg, false takes it out. */
    menu: Type.Record(Type.String({ maxLength: 80 }), Type.Boolean()),
  }),
);
export type ConnectorPatchInput = Static<typeof ConnectorPatchInput>;
export const RotateSecretInput = object({ secret: connectorSecret });
export type RotateSecretInput = Static<typeof RotateSecretInput>;
export const RefreshManifestInput = object({ apply: Type.Optional(Type.Boolean()) });
export type RefreshManifestInput = Static<typeof RefreshManifestInput>;
export const PreviewQuery = object({ role: RoleSchema, unitId: Type.Optional(Type.String({ maxLength: 80 })) });
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
}
export interface ConnectorAreaView {
  id: string;
  title: string;
  roles: Role[];
  standing: string[];
  figure: boolean;
}
export interface ConnectorSummary {
  id: string;
  bundled: boolean;
  source: string;
  kind: 'core' | 'passthrough' | 'derived' | null;
  url: string | null;
  state: ConnectorState;
  health: ConnectorHealth;
  audience: ConnectorAudience;
  scanEnabled: boolean;
  toolsEnabled: boolean;
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
export const ProviderPatchInput = Type.Partial(object({ title: adminTitle, baseUrl: endpointUrl }));
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

/** An area in the sidebar: a lens on one connector for one role (D3). Configuration, not code. */
export const AreaSchema = object({
  id: Type.String(),
  title: Type.String(),
  connector: Type.String(),
  source: Type.String(),
  /** The icon the connector named for the area (D41), from Clew's list; drawn on the area's button under the box. */
  icon: Type.Optional(MenuIconSchema),
  figure: Type.Union([
    object({
      label: Type.String(),
      tone: Type.Union([Type.Literal('ok'), Type.Literal('warn'), Type.Literal('alert'), Type.Literal('none')]),
    }),
    Type.Null(),
  ]),
  needsYou: Type.Integer(),
  waiting: Type.Integer(),
  /** The highest attention level among the open cards that need the person; the sidebar count takes its colour from it. */
  urgency: Type.Union([AttentionLevelSchema, Type.Null()]),
  /** "Gör själv": capabilities the person may start without a thread. */
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
});
export type ActInput = Static<typeof ActInput>;

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
      kind: Type.Union([Type.Literal('select'), Type.Literal('replan')]),
      threadId: id,
      refs: Type.Optional(Type.Array(Type.String())),
      week: Type.Optional(Type.String()),
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
export interface CalendarRoom {
  ref: string;
  name: string;
  capacity: number;
  equipment: string[];
}
export type AvailabilityState = 'free' | 'busy' | 'unknown';
export interface AvailabilityResult {
  mine: AvailabilityState;
  participants: Array<{ email: string; name: string; state: AvailabilityState }>;
  room: { ref: string; name: string; state: AvailabilityState } | null;
}

export interface TodayView {
  date: string;
  events: CalendarEvent[];
  gaps: { start: string; end: string }[];
}
export interface WeekView {
  from: string;
  events: CalendarEvent[];
  proposals: Proposal[];
}
/** One day with the person's live proposals: the side panel's day view and the dialog's day strip (D28). */
export type DayView = WeekView;

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
