import { pgTable, text, integer, jsonb, bigserial, boolean, timestamp, check, primaryKey, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { MessageMeta, Receipt, ThreadAction, ThreadItem } from '@clew/contracts';

// Identity. Ported from startsidan: canonical person, explicit subject binding, server-side session with sealed tokens.
export const people = pgTable('auth_person', {
  id: text('id').primaryKey(), organisationId: text('organisation_id').notNull(), name: text('name').notNull(),
  enabled: boolean('enabled').notNull().default(true),
});
export const identityBindings = pgTable('auth_identity_binding', {
  issuer: text('issuer').notNull(), subject: text('subject').notNull(),
  personId: text('person_id').notNull().references(() => people.id),
}, t => [primaryKey({ columns: [t.issuer, t.subject] }), uniqueIndex('auth_person_issuer').on(t.issuer, t.personId)]);
export const accessGrants = pgTable('auth_access_grant', {
  personId: text('person_id').primaryKey().references(() => people.id), unitId: text('unit_id').notNull(),
  unitLabel: text('unit_label').notNull(), role: text('role').$type<'manager' | 'employee'>().notNull(),
  capabilities: jsonb('capabilities').$type<string[]>().notNull(), version: integer('version').notNull().default(1),
}, t => [check('auth_grant_role', sql`${t.role} IN ('manager', 'employee')`)]);
export const loginTransactions = pgTable('auth_login_transaction', {
  digest: text('digest').primaryKey(), state: text('state').notNull(), nonce: text('nonce').notNull(),
  verifier: text('verifier').notNull(), returnTo: text('return_to').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
export const sessions = pgTable('auth_session', {
  digest: text('digest').primaryKey(), personId: text('person_id').notNull().references(() => people.id),
  issuer: text('issuer').notNull(), subject: text('subject').notNull(), sid: text('sid'),
  clientId: text('client_id').notNull(), csrf: text('csrf').notNull(), tokens: text('tokens').notNull(),
  tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }).notNull(),
  idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
}, t => [index('auth_session_sid').on(t.issuer, t.clientId, t.sid)]);
export const authenticationAudit = pgTable('auth_audit', {
  id: bigserial('id', { mode: 'number' }).primaryKey(), actor: text('actor'), action: text('action').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const logoutReceipts = pgTable('auth_logout_receipt', {
  issuer: text('issuer').notNull(), jti: text('jti').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
}, t => [primaryKey({ columns: [t.issuer, t.jti] })]);

// Threads: the only unit of attention on the page. One row per thread, messages and proposals hang off it.
export const threads = pgTable('thread', {
  id: text('id').primaryKey(), personId: text('person_id').notNull().references(() => people.id),
  kind: text('kind').$type<'pushed' | 'question'>().notNull(), topic: text('topic').notNull(), title: text('title').notNull(),
  state: text('state').$type<'open' | 'handled' | 'dismissed'>().notNull().default('open'),
  trigger: jsonb('trigger').$type<{ reason: string; source: string; at: string }>().notNull(),
  week: text('week'),
  // Generic cards (D1, D12): the module, a lead sentence, rows with refs, action slots, waiting state and the receipt.
  module: text('module').notNull().default('calendar'),
  area: text('area').notNull().default('kalender'),
  summary: text('summary').notNull().default(''),
  items: jsonb('items').$type<ThreadItem[]>().notNull().default([]),
  actions: jsonb('actions').$type<ThreadAction[]>().notNull().default([]),
  waitingOn: text('waiting_on'),
  deadline: text('deadline'),
  receipt: jsonb('receipt').$type<Receipt | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  handledAt: timestamp('handled_at', { withTimezone: true }),
}, t => [index('thread_person_state').on(t.personId, t.state, t.createdAt), check('thread_kind', sql`${t.kind} IN ('pushed', 'question')`),
  // One open pushed thread per topic and person: the scan is idempotent even when two requests race.
  uniqueIndex('thread_open_topic').on(t.personId, t.topic).where(sql`${t.state} = 'open' AND ${t.kind} = 'pushed'`),
  check('thread_state', sql`${t.state} IN ('open', 'handled', 'dismissed')`)]);
export const threadMessages = pgTable('thread_message', {
  id: text('id').primaryKey(), threadId: text('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
  role: text('role').$type<'assistant' | 'user'>().notNull(), body: text('body').notNull(),
  // Conversation memory (D12): chips, refs, answer shape, view, draft, tool calls. Null for card messages.
  meta: jsonb('meta').$type<MessageMeta | null>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('thread_message_thread').on(t.threadId, t.createdAt), check('thread_message_role', sql`${t.role} IN ('assistant', 'user')`)]);
// A proposal is the assistant's suggestion; it becomes a calendar event only through the human decision endpoint.
export const proposals = pgTable('proposal', {
  id: text('id').primaryKey(), threadId: text('thread_id').notNull().references(() => threads.id, { onDelete: 'cascade' }),
  personId: text('person_id').notNull().references(() => people.id),
  status: text('status').$type<'proposed' | 'confirmed' | 'final' | 'undone' | 'declined' | 'superseded'>().notNull().default('proposed'),
  participantEmail: text('participant_email').notNull(), participantName: text('participant_name').notNull(),
  start: timestamp('start', { withTimezone: true }).notNull(), end: timestamp('end', { withTimezone: true }).notNull(),
  eventUid: text('event_uid'), eventRef: text('event_ref'), eventRevision: text('event_revision'),
  confirmedAt: timestamp('confirmed_at', { withTimezone: true }), undoUntil: timestamp('undo_until', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('proposal_thread').on(t.threadId), index('proposal_person_status').on(t.personId, t.status),
  check('proposal_status', sql`${t.status} IN ('proposed', 'confirmed', 'final', 'undone', 'declined', 'superseded')`),
  check('proposal_interval', sql`${t.end} > ${t.start}`)]);
// Every mutation writes its audit row in the same transaction. Metadata only: no event titles or participant names.
export const audit = pgTable('audit', {
  id: bigserial('id', { mode: 'number' }).primaryKey(), actor: text('actor').notNull(), action: text('action').notNull(),
  subject: text('subject').notNull(), details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('audit_subject').on(t.subject, t.createdAt)]);
// Postgres-backed scheduler for v1: a nightly scan and a timer per undo window. Temporal comes with the second use case.
export const jobs = pgTable('job', {
  id: text('id').primaryKey(), kind: text('kind').notNull(), payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
  runAt: timestamp('run_at', { withTimezone: true }).notNull(), status: text('status').$type<'due' | 'running' | 'done' | 'failed'>().notNull().default('due'),
  attempts: integer('attempts').notNull().default(0), lastError: text('last_error'),
  startedAt: timestamp('started_at', { withTimezone: true }), finishedAt: timestamp('finished_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [index('job_due').on(t.status, t.runAt), check('job_status', sql`${t.status} IN ('due', 'running', 'done', 'failed')`)]);

// State of the mock integrations (Heroma, Raindance, Treserva, Kommunikation). This table *is* the synthetic source
// system, so that approvals and bookings survive a restart. Real adapters never write here.
export const moduleState = pgTable('module_state', {
  module: text('module').notNull(), key: text('key').notNull(),
  value: jsonb('value').$type<unknown>().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.module, t.key] })]);
