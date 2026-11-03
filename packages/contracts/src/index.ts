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
});
export type Thread = Static<typeof ThreadSchema>;

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
