import { Type, type Static } from '@sinclair/typebox';

/** Identity as the browser may see it. Never carries tokens, bindings or grants. */
export interface SessionUser { id: string; name: string; unitId: string; unitLabel: string; role: 'manager' | 'employee'; }
/** In-process identity with a revalidation guard. Never serialised to the browser. */
export interface AuthenticatedContext extends SessionUser {
  organisationId: string;
  principal: { id: string; kind: 'person' };
  capabilities: string[];
  authorizationVersion: string;
  sessionBinding: string;
  expiresAt: string;
  authorize(): Promise<{ version: string }>;
}
export const sessionUser = (c: SessionUser): SessionUser => ({ id: c.id, name: c.name, unitId: c.unitId, unitLabel: c.unitLabel, role: c.role });

const object = <T extends Record<string, import('@sinclair/typebox').TSchema>>(properties: T) => Type.Object(properties, { additionalProperties: false });
const instant = Type.String({ format: 'date-time', maxLength: 40 });
const id = Type.String({ minLength: 1, maxLength: 80 });

/** One figure in the fixed "Läget" row: a sentence with a comparison, never a bare KPI tile. */
export const FigureSchema = object({
  id: Type.Union([Type.Literal('korttidsfranvaro'), Type.Literal('budgetavvikelse'), Type.Literal('hme'), Type.Literal('utvecklingssamtal')]),
  label: Type.String(), value: Type.String(), comparison: Type.String(),
  tone: Type.Union([Type.Literal('ok'), Type.Literal('warn'), Type.Literal('alert')]),
  source: Type.String(), observedAt: instant,
  /** Optional progress towards a target, drawn as a bar in the tile. */
  progress: Type.Optional(object({ value: Type.Integer(), max: Type.Integer() })),
});
export type Figure = Static<typeof FigureSchema>;

/** A calendar occurrence as the browser sees it. Participant names stay inside the calendar surface. */
export const CalendarEventSchema = object({
  id: id, title: Type.String(), start: Type.String(), end: Type.String(), allDay: Type.Boolean(),
  mine: Type.Boolean(), room: Type.String(), participants: Type.Array(Type.String()),
});
export type CalendarEvent = Static<typeof CalendarEventSchema>;

export const ProposalStatus = Type.Union([Type.Literal('proposed'), Type.Literal('confirmed'), Type.Literal('final'), Type.Literal('undone'), Type.Literal('declined'), Type.Literal('superseded')]);
export type ProposalStatus = Static<typeof ProposalStatus>;
export const ProposalSchema = object({
  id: id, threadId: id, status: ProposalStatus, start: instant, end: instant,
  participant: object({ name: Type.String(), email: Type.String() }),
  eventRef: Type.Union([Type.String(), Type.Null()]), undoUntil: Type.Union([instant, Type.Null()]),
});
export type Proposal = Static<typeof ProposalSchema>;

export const ThreadMessageSchema = object({
  id: id, role: Type.Union([Type.Literal('assistant'), Type.Literal('user')]), body: Type.String(), createdAt: instant,
});
export type ThreadMessage = Static<typeof ThreadMessageSchema>;
/** A row inside a card: an object with a ref the person can tick, point at or add to the conversation (D12). */
export const ThreadItemSchema = object({
  ref: Type.String({ minLength: 1, maxLength: 200 }), label: Type.String(), detail: Type.String(),
  selectable: Type.Boolean(), selected: Type.Boolean(),
});
export type ThreadItem = Static<typeof ThreadItemSchema>;
/** One action slot on a card (thread action contract). Modules contribute actions, never layout. */
export const ActionRole = Type.Union([Type.Literal('primary'), Type.Literal('secondary'), Type.Literal('overflow')]);
export const ThreadActionSchema = object({
  id: id, label: Type.String(), capability: Type.String(),
  kind: Type.Union([Type.Literal('read'), Type.Literal('propose'), Type.Literal('execute')]),
  role: ActionRole,
  /** Where a read capability renders: a side-panel view, or a link out to the source system. */
  target: Type.Optional(Type.Union([Type.Literal('panel'), Type.Literal('link')])),
  /** Fixed input merged with the selected item refs at execution time. */
  input: Type.Optional(Type.Record(Type.String(), Type.Unknown())),
  /** Whether the action takes the selected items as `refs`. */
  usesItems: Type.Optional(Type.Boolean()),
  confirm: Type.Optional(Type.String()),
});
export type ThreadAction = Static<typeof ThreadActionSchema>;
/** What the source system answered, row by row, read back after an execute. Green only on a read-back. */
export const ReceiptRowSchema = object({
  ref: Type.String(), label: Type.String(),
  outcome: Type.Union([Type.Literal('done'), Type.Literal('unknown'), Type.Literal('failed'), Type.Literal('skipped')]),
  detail: Type.String(),
});
export const ReceiptSchema = object({ at: instant, headline: Type.String(), rows: Type.Array(ReceiptRowSchema), undoUntil: Type.Union([instant, Type.Null()]), undoCapability: Type.Union([Type.String(), Type.Null()]) });
export type Receipt = Static<typeof ReceiptSchema>;
export type ReceiptRow = Static<typeof ReceiptRowSchema>;

export const ThreadKind = Type.Union([Type.Literal('pushed'), Type.Literal('question')]);
export const ThreadState = Type.Union([Type.Literal('open'), Type.Literal('handled'), Type.Literal('dismissed')]);
/** Every thread answers "varför ser jag detta?" with trigger, source and time. */
export const ThreadSchema = object({
  id: id, kind: ThreadKind, topic: Type.String(), title: Type.String(), state: ThreadState,
  trigger: object({ reason: Type.String(), source: Type.String(), at: instant }),
  createdAt: instant, updatedAt: instant, handledAt: Type.Union([instant, Type.Null()]),
  messages: Type.Array(ThreadMessageSchema), proposals: Type.Array(ProposalSchema),
  /** Target week (Monday) for proposal threads. */
  week: Type.Union([Type.String(), Type.Null()]),
  /** The module (area) the thread belongs to. `calendar` for proposal threads, `startsidan` for questions. */
  module: Type.String(),
  area: Type.String(),
  /** One sentence the card leads with. */
  summary: Type.String(),
  items: Type.Array(ThreadItemSchema),
  actions: Type.Array(ThreadActionSchema),
  /** Set when the thread waits on someone else: it is listed under "Pågår utan dig" and never notifies. */
  waitingOn: Type.Union([Type.String(), Type.Null()]),
  deadline: Type.Union([Type.String(), Type.Null()]),
  receipt: Type.Union([ReceiptSchema, Type.Null()]),
});
export type Thread = Static<typeof ThreadSchema>;

/** An area in the sidebar: a lens on one module for one role (D3). Configuration, not code. */
export const AreaSchema = object({
  id: Type.String(), title: Type.String(), module: Type.String(), source: Type.String(),
  figure: Type.Union([object({ label: Type.String(), tone: Type.Union([Type.Literal('ok'), Type.Literal('warn'), Type.Literal('alert'), Type.Literal('none')]) }), Type.Null()]),
  needsYou: Type.Integer(), waiting: Type.Integer(),
  /** "Gör själv": capabilities the person may start without a thread. */
  standing: Type.Array(object({ capability: Type.String(), label: Type.String(), kind: Type.Union([Type.Literal('read'), Type.Literal('propose'), Type.Literal('execute')]) })),
  schedules: Type.Array(object({ label: Type.String(), when: Type.String() })),
});
export type Area = Static<typeof AreaSchema>;
export const ActInput = object({ actionId: id, refs: Type.Optional(Type.Array(Type.String({ maxLength: 200 }), { maxItems: 50 })) });
export type ActInput = Static<typeof ActInput>;

export const AttentionSchema = object({ used: Type.Integer(), budget: Type.Integer(), bundledUntil: Type.Union([Type.String(), Type.Null()]) });
export type Attention = Static<typeof AttentionSchema>;

/** Browser inputs. Everything is validated again on the server before it touches a source. */
export const AskInput = object({ question: Type.String({ minLength: 1, maxLength: 400, pattern: '^[^\\r\\n]+$' }) });
export const ReplyInput = object({ body: Type.String({ minLength: 1, maxLength: 400, pattern: '^[^\\r\\n]+$' }) });
export const ConfirmInput = object({ proposalIds: Type.Array(id, { minItems: 1, maxItems: 12, uniqueItems: true }) });
export const ReplanInput = object({ week: Type.String({ pattern: '^\\d{4}-\\d{2}-\\d{2}$' }) });
export type AskInput = Static<typeof AskInput>; export type ReplyInput = Static<typeof ReplyInput>;
export type ConfirmInput = Static<typeof ConfirmInput>; export type ReplanInput = Static<typeof ReplanInput>;

export interface TodayView { date: string; events: CalendarEvent[]; gaps: { start: string; end: string }[]; }
export interface WeekView { from: string; events: CalendarEvent[]; proposals: Proposal[]; }
