import { Type, type Static } from '@sinclair/typebox';
import type { Actor } from '@clew/modules';

/** First read contract (D18). Source codes stay source-owned; labels come from its metadata. */
export const ErrandRefSchema = Type.String({ pattern: '^errand:[a-z]+:[0-9]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$', maxLength: 200 });
const instant = Type.String({ format: 'date-time' });
const nullableText = Type.Union([Type.String(), Type.Null()]);
export const ErrandSummarySchema = Type.Object({
  ref: ErrandRefSchema,
  errandNumber: Type.String(),
  category: Type.String(),
  type: Type.String(),
  status: Type.Object({ code: Type.String(), label: Type.String(), closed: Type.Boolean() }),
  phase: nullableText,
  relationships: Type.Array(Type.Union([Type.Literal('handler'), Type.Literal('reporter')])),
  waitingOn: nullableText,
  suspendedUntil: Type.Union([instant, Type.Null()]),
  /** A deadline belongs to a named task, never to the whole errand by assumption. */
  deadlines: Type.Array(Type.Object({ ref: Type.String(), label: Type.String(), dueAt: instant })),
  unreadEvents: Type.Array(Type.Object({ id: Type.String(), label: Type.String(), at: instant })),
  /** Opaque source revision, not a Clew timestamp. */
  version: Type.String(),
}, { additionalProperties: false });
export type ErrandSummary = Static<typeof ErrandSummarySchema>;

/** Live detail only. Free text must not enter a thread draft or model tool. */
export const ErrandDetailSchema = Type.Object({
  ...ErrandSummarySchema.properties,
  title: Type.String(),
  description: Type.String(),
  lastCommunication: Type.Union([Type.Object({
    channel: Type.String(), direction: Type.Union([Type.Literal('inbound'), Type.Literal('outbound')]),
    body: Type.String(), at: instant,
  }), Type.Null()]),
}, { additionalProperties: false });
export type ErrandDetail = Static<typeof ErrandDetailSchema>;
export interface ErrandAccess { read: boolean; acknowledge: boolean; }

/** One source installation, read as the actor on every operation. Further mutations wait for a real source. */
export interface ErrandProvider {
  readonly source: string;
  available(actor: Actor): boolean;
  mine(actor: Actor): Promise<ErrandSummary[]>;
  reported(actor: Actor): Promise<ErrandSummary[]>;
  get(actor: Actor, ref: string): Promise<ErrandDetail>;
  access(actor: Actor, ref: string): Promise<ErrandAccess>;
  /** Acknowledge these events only; this does not complete or change the errand. */
  acknowledge(actor: Actor, ref: string, eventIds: string[]): Promise<void>;
}
