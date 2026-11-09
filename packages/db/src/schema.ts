import {
  pgTable,
  text,
  integer,
  bigint,
  jsonb,
  bigserial,
  boolean,
  timestamp,
  check,
  primaryKey,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { McpWatch } from '@clew/contracts';
import type {
  ConnectorAudience,
  ConnectorHealth,
  ExecutionSummary,
  MessageMeta,
  ProviderHealth,
  Receipt,
  ThreadAction,
  ThreadItem,
} from '@clew/contracts';

// Identity. Ported from startsidan: canonical person, explicit subject binding, server-side session with sealed tokens.
export const people = pgTable(
  'auth_person',
  {
    id: text('id').primaryKey(),
    organisationId: text('organisation_id').notNull(),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    // Provisioned identity (D68): the source's stable id, the name a login is matched on, and the work address Clew
    // needs to invite the person. Null on rows written before provisioning existed.
    externalId: text('external_id'),
    userName: text('user_name'),
    email: text('email'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Unique across the installation, because a login carries no organisation; `userName` without regard to case,
  // RFC 7643's default for it (Keycloak lowercases account names, Entra does not).
  t => [
    uniqueIndex('auth_person_external_id').on(t.externalId),
    uniqueIndex('auth_person_user_name').on(sql`lower(${t.userName})`),
  ],
);
export const identityBindings = pgTable(
  'auth_identity_binding',
  {
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
  },
  t => [primaryKey({ columns: [t.issuer, t.subject] }), uniqueIndex('auth_person_issuer').on(t.issuer, t.personId)],
);
export const accessGrants = pgTable(
  'auth_access_grant',
  {
    personId: text('person_id')
      .primaryKey()
      .references(() => people.id),
    unitId: text('unit_id').notNull(),
    unitLabel: text('unit_label').notNull(),
    role: text('role').$type<'manager' | 'employee'>().notNull(),
    capabilities: jsonb('capabilities').$type<string[]>().notNull(),
    version: integer('version').notNull().default(1),
  },
  t => [check('auth_grant_role', sql`${t.role} IN ('manager', 'employee')`)],
);
// What a provisioner pushes (D68) and what an administrator maps (D85). `auth_access_grant` above is the derived
// projection of these tables: the one active assignment (manager before employee, then the lowest unit id) and the
// capabilities the person's memberships give, written in the same transaction as the change that moves them; the
// development seed writes both until the derivation lands.
export const units = pgTable('auth_unit', {
  id: text('id').primaryKey(),
  organisationId: text('organisation_id').notNull(),
  label: text('label').notNull(),
});
export const assignments = pgTable(
  'auth_assignment',
  {
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
    unitId: text('unit_id')
      .notNull()
      .references(() => units.id),
    role: text('role').$type<'manager' | 'employee'>().notNull(),
  },
  t => [
    primaryKey({ columns: [t.personId, t.unitId] }),
    check('auth_assignment_role', sql`${t.role} IN ('manager', 'employee')`),
  ],
);
/**
 * A group as pushed: Clew's id (what a SCIM client addresses), the source's stable `externalId` when the client set one,
 * and its name as `label` (SCIM's `displayName`). Meaning comes from D68's keys in `externalId` or a mapping row; a group without an external id is a plain group.
 */
export const groups = pgTable(
  'auth_group',
  {
    id: text('id').primaryKey(),
    externalId: text('external_id'),
    label: text('label').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [uniqueIndex('auth_group_external_id').on(t.externalId)],
);
export const groupMembers = pgTable(
  'auth_group_member',
  {
    groupId: text('group_id')
      .notNull()
      .references(() => groups.id, { onDelete: 'cascade' }),
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
  },
  t => [primaryKey({ columns: [t.groupId, t.personId] }), index('auth_group_member_person').on(t.personId)],
);
/** A client that pushes people and groups (D68): the digest of its bearer token, never the token, and the organisation it fills. */
export const provisioners = pgTable(
  'auth_provisioner',
  {
    id: text('id').primaryKey(),
    organisationId: text('organisation_id').notNull(),
    label: text('label').notNull(),
    tokenDigest: text('token_digest').notNull(),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  t => [uniqueIndex('auth_provisioner_token_digest').on(t.tokenDigest)],
);
/**
 * D85: a group gives its members a capability. Keyed on the group's external id without a foreign key, so the row
 * outlives a group the source removes and applies again when the same group returns; the capability is one of
 * `CAPABILITIES` in `@clew/contracts`, checked where the row is written.
 */
export const groupCapabilities = pgTable(
  'auth_group_capability',
  {
    groupExternalId: text('group_external_id').notNull(),
    capability: text('capability').notNull(),
  },
  t => [primaryKey({ columns: [t.groupExternalId, t.capability] })],
);
export const loginTransactions = pgTable('auth_login_transaction', {
  digest: text('digest').primaryKey(),
  state: text('state').notNull(),
  nonce: text('nonce').notNull(),
  verifier: text('verifier').notNull(),
  returnTo: text('return_to').notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
});
export const sessions = pgTable(
  'auth_session',
  {
    digest: text('digest').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
    issuer: text('issuer').notNull(),
    subject: text('subject').notNull(),
    sid: text('sid'),
    clientId: text('client_id').notNull(),
    csrf: text('csrf').notNull(),
    tokens: text('tokens').notNull(),
    tokenExpiresAt: timestamp('token_expires_at', { withTimezone: true }).notNull(),
    idleExpiresAt: timestamp('idle_expires_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
  },
  t => [index('auth_session_sid').on(t.issuer, t.clientId, t.sid)],
);
export const authenticationAudit = pgTable('auth_audit', {
  id: bigserial('id', { mode: 'number' }).primaryKey(),
  actor: text('actor'),
  action: text('action').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
export const logoutReceipts = pgTable(
  'auth_logout_receipt',
  {
    issuer: text('issuer').notNull(),
    jti: text('jti').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  t => [primaryKey({ columns: [t.issuer, t.jti] })],
);

// Threads: the only unit of attention on the page. One row per thread, messages and proposals hang off it.
export const threads = pgTable(
  'thread',
  {
    sourceAuthorization: text('source_authorization'),
    execution: jsonb('execution').$type<ExecutionSummary | null>(),
    id: text('id').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
    kind: text('kind').$type<'pushed' | 'question'>().notNull(),
    topic: text('topic').notNull(),
    title: text('title').notNull(),
    state: text('state').$type<'open' | 'handled' | 'dismissed'>().notNull().default('open'),
    trigger: jsonb('trigger').$type<{ reason: string; source: string; at: string }>().notNull(),
    week: text('week'),
    // Generic cards (D1, D12): the connector, a lead sentence, rows with refs, action slots, waiting state and the receipt.
    connector: text('connector').notNull().default('calendar'),
    area: text('area').notNull().default('calendar'),
    summary: text('summary').notNull().default(''),
    items: jsonb('items').$type<ThreadItem[]>().notNull().default([]),
    actions: jsonb('actions').$type<ThreadAction[]>().notNull().default([]),
    waitingOn: text('waiting_on'),
    deadline: text('deadline'),
    receipt: jsonb('receipt').$type<Receipt | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    handledAt: timestamp('handled_at', { withTimezone: true }),
    // A reminder the person set brought the card back at this time (D17). Only the day it happened counts.
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    // "Inte nu" (D28): parked in the Inte nu pile until this time, or until something happens in the thread.
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
  },
  t => [
    index('thread_person_state').on(t.personId, t.state, t.createdAt),
    check('thread_kind', sql`${t.kind} IN ('pushed', 'question')`),
    // One open pushed thread per topic and person: the scan is idempotent even when two requests race.
    uniqueIndex('thread_open_topic')
      .on(t.personId, t.topic)
      .where(sql`${t.state} = 'open' AND ${t.kind} = 'pushed'`),
    check('thread_state', sql`${t.state} IN ('open', 'handled', 'dismissed')`),
  ],
);
export const threadMessages = pgTable(
  'thread_message',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    role: text('role').$type<'assistant' | 'user'>().notNull(),
    body: text('body').notNull(),
    // Conversation memory (D12): chips, refs, answer shape, view, draft, tool calls. Null for card messages.
    meta: jsonb('meta').$type<MessageMeta | null>(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // A turn writes its question and its answer at the same instant; the sequence keeps them in the order they were written.
    seq: bigserial('seq', { mode: 'number' }).notNull(),
  },
  t => [
    index('thread_message_thread').on(t.threadId, t.createdAt, t.seq),
    check('thread_message_role', sql`${t.role} IN ('assistant', 'user')`),
  ],
);
// A proposal is the assistant's suggestion; it becomes a calendar event only through the human decision endpoint.
export const proposals = pgTable(
  'proposal',
  {
    id: text('id').primaryKey(),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
    status: text('status')
      .$type<
        | 'proposed'
        | 'confirmed'
        | 'final'
        | 'accepted'
        | 'declined-by-invitee'
        | 'counter'
        | 'undone'
        | 'declined'
        | 'superseded'
      >()
      .notNull()
      .default('proposed'),
    participantEmail: text('participant_email').notNull(),
    participantName: text('participant_name').notNull(),
    start: timestamp('start', { withTimezone: true }).notNull(),
    end: timestamp('end', { withTimezone: true }).notNull(),
    eventUid: text('event_uid'),
    eventRef: text('event_ref'),
    eventRevision: text('event_revision'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    undoUntil: timestamp('undo_until', { withTimezone: true }),
    // Follow-ups to the invitee (D30): how many were sent and when the last one went.
    reminders: integer('reminders').notNull().default(0),
    remindedAt: timestamp('reminded_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [
    index('proposal_thread').on(t.threadId),
    index('proposal_person_status').on(t.personId, t.status),
    check(
      'proposal_status',
      sql`${t.status} IN ('proposed', 'confirmed', 'final', 'accepted', 'declined-by-invitee', 'counter', 'undone', 'declined', 'superseded')`,
    ),
    check('proposal_interval', sql`${t.end} > ${t.start}`),
  ],
);
// Every mutation writes its audit row in the same transaction. Metadata only: no event titles or participant names.
export const audit = pgTable(
  'audit',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),
    actor: text('actor').notNull(),
    action: text('action').notNull(),
    subject: text('subject').notNull(),
    details: jsonb('details').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [index('audit_subject').on(t.subject, t.createdAt)],
);
// Postgres-backed scheduler for v1: a nightly scan and a timer per undo window. Temporal comes with the second use case.
export const jobs = pgTable(
  'job',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull().default({}),
    runAt: timestamp('run_at', { withTimezone: true }).notNull(),
    status: text('status')
      .$type<'due' | 'running' | 'done' | 'failed' | 'temporal' | 'dispatched' | 'executing' | 'legacy-running'>()
      .notNull()
      .default('temporal'),
    dispatchAttempt: integer('dispatch_attempt').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    attempts: integer('attempts').notNull().default(0),
    lastError: text('last_error'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [
    index('job_due').on(t.status, t.runAt),
    check(
      'job_status',
      sql`${t.status} IN ('due', 'running', 'done', 'failed', 'temporal', 'dispatched', 'executing', 'legacy-running')`,
    ),
  ],
);

// Connectors registered by an administrator (D23). One row per connector service; the secret is a sealed envelope
// (auth-crypto, purpose `connector:secret:<id>`), the manifest is the last valid one so the page works while the
// service is down. A bundled connector (Clew's own process: people, the calendar, search; D61) gets a
// row at boot with `bundled` true and no url or secret, so an audience and the switches govern it the same way.
export type { ConnectorAudience, ConnectorHealth };
export const connectors = pgTable(
  'connector',
  {
    id: text('id').primaryKey(),
    bundled: boolean('bundled').notNull().default(false),
    url: text('url'),
    secret: text('secret'),
    secretChangedAt: timestamp('secret_changed_at', { withTimezone: true }).notNull().defaultNow(),
    state: text('state').$type<'draft' | 'enabled' | 'disabled'>().notNull().default('draft'),
    audience: jsonb('audience').$type<ConnectorAudience>().notNull().default({ mode: 'all' }),
    scanEnabled: boolean('scan_enabled').notNull().default(true),
    toolsEnabled: boolean('tools_enabled').notNull().default(true),
    // The one connector that gives Clew its shared header (D88), chosen by an administrator; the use case keeps it to one row.
    headerHolder: boolean('header_holder').notNull().default(false),
    // Per capability: the narrowing switches, and `menu: true` when its view is in the menu (D40).
    capabilities: jsonb('capabilities')
      .$type<Record<string, { enabled?: false; model?: false; menu?: true }>>()
      .notNull()
      .default({}),
    // Per area: `figure: false` when the administrator switched the area's figure off on Hem (D54).
    areas: jsonb('areas').$type<Record<string, { figure?: false }>>().notNull().default({}),
    manifest: jsonb('manifest').$type<unknown>(),
    manifestAt: timestamp('manifest_at', { withTimezone: true }),
    health: jsonb('health')
      .$type<ConnectorHealth>()
      .notNull()
      .default({ status: 'untested', at: '1970-01-01T00:00:00.000Z' }),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
    // The system's place in the registration order (D71): the lowest one free when the row was added, so its mark keeps
    // its hue when another system is removed. Null on a bundled row: Clew's own systems are the house and have no hue.
    ordinal: integer('ordinal'),
  },
  t => [
    check('connector_state', sql`${t.state} IN ('draft', 'enabled', 'disabled')`),
    check('connector_id', sql`${t.id} ~ '^[a-z][a-z0-9-]*$'`),
    // A remote connector has an address and a secret; a bundled one has neither.
    check('connector_remote', sql`${t.bundled} OR (${t.url} IS NOT NULL AND ${t.secret} IS NOT NULL)`),
  ],
);

// Model providers and models (D24). A provider is one OpenAI-compatible endpoint; its key is a sealed envelope
// (auth-crypto, purpose `provider:key:<id>`) or null for a local endpoint that needs none. A model is one id on that
// endpoint with a Swedish name, an audience of the connector's shape, an on/off state and the installation's default
// flag (at most one row, enforced by the partial unique index). `model_choice` is a person's own pick in the composer.
export type { ProviderHealth };
export const modelProviders = pgTable(
  'model_provider',
  {
    id: text('id').primaryKey(),
    title: text('title').notNull(),
    baseUrl: text('base_url').notNull(),
    apiKey: text('api_key'),
    keyChangedAt: timestamp('key_changed_at', { withTimezone: true }),
    health: jsonb('health')
      .$type<ProviderHealth>()
      .notNull()
      .default({ status: 'untested', at: '1970-01-01T00:00:00.000Z' }),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  t => [check('model_provider_id', sql`${t.id} ~ '^[a-z][a-z0-9-]*$'`)],
);
export const models = pgTable(
  'model',
  {
    id: text('id').primaryKey(),
    providerId: text('provider_id')
      .notNull()
      .references(() => modelProviders.id),
    model: text('model').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    state: text('state').$type<'enabled' | 'disabled'>().notNull().default('disabled'),
    audience: jsonb('audience').$type<ConnectorAudience>().notNull().default({ mode: 'all' }),
    isDefault: boolean('is_default').notNull().default(false),
    tools: boolean('tools').notNull().default(true),
    reasoning: text('reasoning').$type<'provider-default' | 'none'>().notNull().default('provider-default'),
    createdBy: text('created_by').notNull(),
    updatedBy: text('updated_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    version: integer('version').notNull().default(1),
  },
  t => [
    check('model_id', sql`${t.id} ~ '^[a-z][a-z0-9-]*$'`),
    check('model_state', sql`${t.state} IN ('enabled', 'disabled')`),
    check('model_reasoning', sql`${t.reasoning} IN ('provider-default', 'none')`),
    index('model_by_provider').on(t.providerId),
    // One default per installation: a second row with the flag is refused by the database, not only by the use case.
    uniqueIndex('model_one_default')
      .on(t.isDefault)
      .where(sql`${t.isDefault}`),
  ],
);
export const modelChoices = pgTable('model_choice', {
  personId: text('person_id')
    .primaryKey()
    .references(() => people.id, { onDelete: 'cascade' }),
  // A removed model takes every pick of it along; the person falls back to the default.
  modelId: text('model_id')
    .notNull()
    .references(() => models.id, { onDelete: 'cascade' }),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const connectorSigningKey = pgTable(
  'connector_signing_key',
  {
    id: text('id').primaryKey(),
    kid: text('kid').notNull(),
    sealed: text('sealed').notNull(),
    previous: jsonb('previous').$type<Array<{ key: Record<string, unknown>; until: string }>>().notNull().default([]),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [check('connector_signing_singleton', sql`${t.id} = 'installation'`)],
);

// Approved intent is durable before dispatch. Payload/result contain source data and are sealed by the adapter.
export const executions = pgTable(
  'execution',
  {
    presentation: jsonb('presentation').$type<{
      threadId: string;
      version: string;
      actionId: string;
      newTitle?: string;
    } | null>(),
    id: text('id').primaryKey(),
    decisionId: text('decision_id').notNull(),
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
    principal: text('principal').notNull(),
    unitId: text('unit_id').notNull(),
    authorizationVersion: text('authorization_version').notNull(),
    connector: text('connector').notNull(),
    operation: text('operation').notNull(),
    digest: text('digest').notNull(),
    payload: text('payload').notNull(),
    safety: jsonb('safety').notNull(),
    result: text('result'),
    compensates: text('compensates'),
    state: text('state').notNull().default('pending'),
    reason: text('reason'),
    attempt: integer('attempt').notNull().default(0),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    dispatchedAt: timestamp('dispatched_at', { withTimezone: true }),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
  },
  t => [
    uniqueIndex('execution_decision').on(t.personId, t.decisionId),
    index('execution_person').on(t.personId, t.createdAt),
    check('execution_state', sql`${t.state} IN ('pending', 'running', 'succeeded', 'partial', 'failed', 'unknown')`),
  ],
);
/** A job (D55): one approval over several steps, each its own execution row or a watch; `steps` is sealed like a payload. One row per (person, decision). */
export const executionJobs = pgTable(
  'execution_job',
  {
    id: text('id').primaryKey(),
    decisionId: text('decision_id').notNull(),
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
    principal: text('principal').notNull(),
    unitId: text('unit_id').notNull(),
    authorizationVersion: text('authorization_version').notNull(),
    digest: text('digest').notNull(),
    steps: text('steps').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  t => [
    uniqueIndex('execution_job_decision').on(t.personId, t.decisionId),
    index('execution_job_person').on(t.personId, t.createdAt),
  ],
);
/** An administrator's binding of a follower to a fact kind (D55): connector governance in the database (D23), default deny. */
export const followBindings = pgTable(
  'follow_binding',
  {
    id: text('id').primaryKey(),
    kind: text('kind').notNull(),
    capability: text('capability').notNull(),
    audience: jsonb('audience').$type<ConnectorAudience>().notNull(),
    within: text('within'),
    enabled: boolean('enabled').notNull().default(true),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  t => [index('follow_binding_kind').on(t.kind)],
);
export const dispatchOutbox = pgTable(
  'dispatch_outbox',
  {
    id: text('id').primaryKey(),
    executionId: text('execution_id')
      .notNull()
      .references(() => executions.id),
    attempt: integer('attempt').notNull().default(0),
    nextAt: timestamp('next_at', { withTimezone: true }).notNull(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    lastError: text('last_error'),
  },
  t => [index('dispatch_outbox_due').on(t.nextAt)],
);
/** A watch step's timer intent (D55 item 5, D47): the step's absolute check times and window's end, committed with the job and delivered once to the `jobWatch` workflow. The times are not approved content, so the row is plain. */
export const watchIntents = pgTable(
  'watch_intent',
  {
    id: text('id').primaryKey(),
    jobId: text('job_id')
      .notNull()
      .references(() => executionJobs.id),
    stepId: text('step_id').notNull(),
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
    generation: integer('generation').notNull().default(1),
    checks: jsonb('checks').$type<string[]>().notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    attempt: integer('attempt').notNull().default(0),
    nextAt: timestamp('next_at', { withTimezone: true }).notNull(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    deliveredAt: timestamp('delivered_at', { withTimezone: true }),
    lastError: text('last_error'),
  },
  t => [index('watch_intent_due').on(t.nextAt), index('watch_intent_job').on(t.jobId)],
);

// Transactional invalidation counters. They carry no source payload and are read by every BFF instance.
export const personChanges = pgTable('person_change', {
  personId: text('person_id').primaryKey(),
  content: bigint('content', { mode: 'number' }).notNull().default(0),
  policy: bigint('policy', { mode: 'number' }).notNull().default(0),
});
export const policyChanges = pgTable('policy_change', {
  id: text('id').primaryKey(),
  revision: bigint('revision', { mode: 'number' }).notNull().default(0),
});

// Desired timer state is also its coalesced outbox: acknowledgement is fenced by
// generation, state and delivery attempt. No source payload enters a workflow.
export const timerIntents = pgTable(
  'timer_intent',
  {
    id: text('id').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    generation: integer('generation').notNull(),
    unitId: text('unit_id').notNull(),
    authorizationVersion: text('authorization_version').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    state: text('state').notNull(),
    reason: text('reason'),
    deliveredGeneration: integer('delivered_generation'),
    deliveredState: text('delivered_state'),
    attempt: integer('attempt').notNull().default(0),
    nextAt: timestamp('next_at', { withTimezone: true }).notNull(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
  },
  t => [
    index('timer_intent_due').on(t.nextAt),
    check('timer_intent_state', sql`${t.state} IN ('active', 'cancelled', 'fired', 'blocked')`),
    uniqueIndex('timer_intent_slot').on(t.threadId, t.kind),
  ],
);

export const followupPolicies = pgTable(
  'followup_policy',
  {
    threadId: text('thread_id')
      .primaryKey()
      .references(() => threads.id, { onDelete: 'cascade' }),
    personId: text('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    unitId: text('unit_id').notNull(),
    authorizationVersion: text('authorization_version').notNull(),
    executionId: text('execution_id').notNull(),
    proposalIds: jsonb('proposal_ids').$type<string[]>().notNull(),
    maxReminders: integer('max_reminders').notNull(),
    afterWorkdays: integer('after_workdays').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    state: text('state').$type<'active' | 'blocked' | 'cancelled' | 'finished'>().notNull(),
    reason: text('reason'),
  },
  t => [check('followup_bounds', sql`${t.maxReminders} BETWEEN 1 AND 2 AND ${t.afterWorkdays} >= 2`)],
);

export const refreshRequests = pgTable(
  'refresh_request',
  {
    id: text('id').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    connector: text('connector').notNull(),
    assignment: text('assignment').notNull(),
    authorizationVersion: text('authorization_version').notNull(),
    state: text('state').notNull(),
    attempt: integer('attempt').notNull().default(0),
    requestedAt: timestamp('requested_at', { withTimezone: true }).notNull(),
    nextAt: timestamp('next_at', { withTimezone: true }).notNull(),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    lastSuccess: timestamp('last_success', { withTimezone: true }),
    observedAt: timestamp('observed_at', { withTimezone: true }),
    error: text('error'),
  },
  t => [index('refresh_due').on(t.nextAt)],
);
export const workOccurrences = pgTable(
  'work_occurrence',
  {
    id: text('id').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    connector: text('connector').notNull(),
    assignment: text('assignment').notNull(),
    sourceKey: text('source_key').notNull(),
    period: text('period').notNull(),
    revision: text('revision').notNull(),
    observedAt: timestamp('observed_at', { withTimezone: true }).notNull(),
    sourceState: text('source_state').notNull(),
    disposition: text('disposition').notNull(),
    threadId: text('thread_id').references(() => threads.id, { onDelete: 'set null' }),
    legacy: boolean('legacy').notNull(),
  },
  t => [index('occurrence_scope').on(t.personId, t.connector, t.assignment), index('occurrence_thread').on(t.threadId)],
);

export const attentionDays = pgTable('attention_day', {
  id: text('id').primaryKey(),
  personId: text('person_id')
    .notNull()
    .references(() => people.id, { onDelete: 'cascade' }),
  used: integer('used').notNull(),
  bucket: text('bucket').notNull(),
  dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
});

// MCP is a separate standards-based lane (D81). A registration currently binds one development identity.
export const mcpConnections = pgTable('mcp_connection', {
  id: text('id').primaryKey(),
  personId: text('person_id')
    .notNull()
    .references(() => people.id),
  url: text('url').notNull(),
  enabled: boolean('enabled').notNull().default(true),
  readTools: jsonb('read_tools').$type<string[]>().notNull(),
  writeTools: jsonb('write_tools').$type<string[]>().notNull(),
  watch: jsonb('watch').$type<McpWatch>().notNull(),
  lastKey: text('last_key'),
});
export const mcpDeliveries = pgTable('mcp_delivery', {
  id: text('id').primaryKey(),
  personId: text('person_id')
    .notNull()
    .references(() => people.id),
  connectionId: text('connection_id')
    .notNull()
    .references(() => mcpConnections.id),
  title: text('title').notNull(),
  text: text('text').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
  resolvedAt: timestamp('resolved_at', { withTimezone: true }),
});
export const mcpDecisions = pgTable(
  'mcp_decision',
  {
    id: text('id').notNull(),
    personId: text('person_id')
      .notNull()
      .references(() => people.id),
    connectionId: text('connection_id')
      .notNull()
      .references(() => mcpConnections.id),
    digest: text('digest').notNull(),
    state: text('state').$type<'unknown' | 'succeeded' | 'failed'>().notNull(),
    result: text('result'),
  },
  t => [primaryKey({ columns: [t.personId, t.id] })],
);
export const deliveries = pgTable(
  'attention_delivery',
  {
    id: text('id').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    kind: text('kind').$type<'automatic' | 'reminder'>().notNull(),
    batch: text('batch').notNull(),
    dueAt: timestamp('due_at', { withTimezone: true }).notNull(),
    state: text('state').$type<'waiting' | 'ready' | 'claimed'>().notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
  },
  t => [index('delivery_person_due').on(t.personId, t.dueAt)],
);
