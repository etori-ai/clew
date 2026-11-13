import {
  pgTable,
  text,
  integer,
  bigint,
  jsonb,
  bigserial,
  boolean,
  date,
  timestamp,
  check,
  primaryKey,
  index,
  uniqueIndex,
  foreignKey,
  type AnyPgColumn,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type {
  CompetenceSearchStatus,
  CompetenceSearchWindow,
  ConnectorAudience,
  DirectoryPhone,
  Employment,
  InstallationTheme,
  LogoMediaType,
  ConnectorHealth,
  ExecutionSummary,
  MessageMeta,
  ProviderHealth,
  Receipt,
  Subject,
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
    phoneNumbers: jsonb('phone_numbers').$type<DirectoryPhone[]>().notNull().default([]),
    employments: jsonb('employments').$type<Employment[]>().notNull().default([]),
    // D110: what the source calls the person's work, SCIM's `title`. Optional, shown and searched, never read for
    // authority.
    title: text('title'),
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
    // D121: the relations to people the person's memberships give by grant (`RELATION_GRANTS`), apart from the
    // capabilities (D118); derived with them.
    relations: jsonb('relations')
      .$type<string[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
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
 * A group as pushed: Clew's id (what a SCIM client addresses), the organisation of the provisioner that pushed it (a
 * client reads and writes its own organisation's groups only), the source's stable `externalId` when the client set
 * one (unique across the installation, since D68's keys are shared vocabulary), and its name as `label` (SCIM's
 * `displayName`). Meaning comes from D68's keys in `externalId` or a mapping row; a group without an external id is a
 * plain group. A `unit:` group is a node of the organisation tree (D99): `parentUnitId` is the unit id of the node above
 * it, null on a root and on every group that is not a `unit:` group. It names a unit id, not a row, because the parent
 * is another pushed group; the SCIM use case checks that it exists, under the tree's lock.
 */
export const groups = pgTable(
  'auth_group',
  {
    id: text('id').primaryKey(),
    organisationId: text('organisation_id').notNull(),
    externalId: text('external_id'),
    label: text('label').notNull(),
    parentUnitId: text('parent_unit_id'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [uniqueIndex('auth_group_external_id').on(t.externalId), index('auth_group_parent_unit').on(t.parentUnitId)],
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
/**
 * D108 item 5: a position of the organisation, a code and a label and nothing else, as a `position:<code>` group pushes
 * it; the label is the group's name. The row follows its group: written when the group is, removed when the group is
 * removed or takes another key. The code is unique within the organisation, and since a group's key is unique across
 * the installation, one organisation holds a code at a time. `id` is the store's own, for what refers to a position.
 */
export const positions = pgTable(
  'auth_position',
  {
    id: text('id').primaryKey(),
    organisationId: text('organisation_id').notNull(),
    code: text('code').notNull(),
    label: text('label').notNull(),
  },
  t => [uniqueIndex('auth_position_code').on(t.organisationId, t.code)],
);
/**
 * D108 item 5: who holds which position, derived from the person's `position:` memberships in the same transaction as
 * the change that moves them. Tied to the person, not to a placement on a unit; goes with the person or the position.
 */
export const personPositions = pgTable(
  'auth_person_position',
  {
    personId: text('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    positionId: text('position_id')
      .notNull()
      .references(() => positions.id, { onDelete: 'cascade' }),
  },
  t => [primaryKey({ columns: [t.personId, t.positionId] }), index('auth_person_position_position').on(t.positionId)],
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
    /** The last time the provisioner authenticated, written at most once a minute: how an operator sees that pushes arrive. */
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }),
    /** A rotated-out token's digest, which still authenticates until `previousValidUntil`, so a client switches without a gap. */
    previousTokenDigest: text('previous_token_digest'),
    previousValidUntil: timestamp('previous_valid_until', { withTimezone: true }),
  },
  t => [uniqueIndex('auth_provisioner_token_digest').on(t.tokenDigest)],
);
/**
 * D85: a group gives its members a capability. Keyed on the group's external id without a foreign key, so the row
 * outlives a group the source removes and applies again when the same group returns; the capability is one of
 * `CAPABILITIES` in `@clew/contracts`, checked where the row is written. The row belongs to the organisation whose
 * administrator wrote it and applies to that organisation's groups alone (D101): a row left behind by a group that is
 * gone is not picked up by another organisation's group that takes the same id.
 */
export const groupCapabilities = pgTable(
  'auth_group_capability',
  {
    organisationId: text('organisation_id').notNull(),
    groupExternalId: text('group_external_id').notNull(),
    capability: text('capability').notNull(),
  },
  t => [primaryKey({ columns: [t.organisationId, t.groupExternalId, t.capability] })],
);
/**
 * D121: a group gives its members a relation to people by grant (`RELATION_GRANTS` in `@clew/contracts`, today only
 * `registrar`), as a group gives a capability above and kept apart from it, since a capability is no relation to a
 * person (D118). The same rules as `auth_group_capability`: keyed on the group's external id without a foreign key, the
 * relation checked where the row is written, the row its organisation's alone.
 */
export const groupRelations = pgTable(
  'auth_group_relation',
  {
    organisationId: text('organisation_id').notNull(),
    groupExternalId: text('group_external_id').notNull(),
    relation: text('relation').notNull(),
  },
  // Named: the name Postgres would make is longer than its 63 characters and would be cut.
  t => [primaryKey({ name: 'auth_group_relation_pk', columns: [t.organisationId, t.groupExternalId, t.relation] })],
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
    // The entities a card of Clew's own is about while no row may name them (D97 item 6): never drawn, never read by the assistant.
    subjects: jsonb('subjects').$type<Subject[]>().notNull().default([]),
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
    // The cards of one approval in the competence module (D108 item 7), one per manager, are found by their shared topic
    // whatever stream they are in; the index holds that module's cards alone.
    index('thread_competence_topic')
      .on(t.topic)
      .where(sql`${t.connector} = 'competence'`),
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
// The index from entity to cards (D97 item 6): one row per thread and entity its rows (or the thread itself) name, with
// the key as Clew compares it (a person's in lower case). Written by the thread store in the transaction that writes the
// thread's items, gone with the thread. `person_id` is the thread's owner, so "my cards about Anna" is one index lookup.
export const threadSubjects = pgTable(
  'thread_subject',
  {
    threadId: text('thread_id')
      .notNull()
      .references(() => threads.id, { onDelete: 'cascade' }),
    personId: text('person_id').notNull(),
    entity: text('entity').$type<Subject['entity']>().notNull(),
    key: text('key').notNull(),
  },
  t => [
    primaryKey({ columns: [t.threadId, t.entity, t.key] }),
    index('thread_subject_owner').on(t.personId, t.entity, t.key),
    index('thread_subject_entity').on(t.entity, t.key),
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
// The scheduler's jobs (D15): a nightly scan and a timer per undo window. The durable engine runs them since D85; the
// status value `temporal` is the engine owner's historical name (see jobs.ts).
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
    // The person's own signed-in sessions behind a write on a connector that acts as them (D26), sealed by the adapter:
    // the one that approved it (dispatch, replay, read-back) and the one that last asked to check it (read-back only).
    approvingSession: text('approving_session'),
    checkingSession: text('checking_session'),
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
    // The signed-in session that last asked for this refresh, sealed by the adapter: what a scan of a connector that acts
    // as the person runs with while it is active (D26). Null when no session asked since the last request without one.
    session: text('session'),
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

// The installation's appearance (D98): one row for the whole installation, `installation`, absent until an
// administrator saves; the store contract's Postgres run writes rows of its own beside it and removes them. The
// theme is the normalised colours of an uploaded theme file, never the file; a logo image is its bytes in base64, at
// most 256 kB each, served from Clew's own origin. `revision` rises with every save and is what a browser's cached copy
// and a logo's address are compared by.
export const installationAppearance = pgTable(
  'installation_appearance',
  {
    id: text('id').primaryKey(),
    revision: integer('revision').notNull(),
    theme: jsonb('theme').$type<InstallationTheme>(),
    logoAlt: text('logo_alt'),
    logoLightType: text('logo_light_type').$type<LogoMediaType>(),
    logoLight: text('logo_light'),
    logoDarkType: text('logo_dark_type').$type<LogoMediaType>(),
    logoDark: text('logo_dark'),
    updatedBy: text('updated_by').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  t => [
    check(
      'installation_appearance_logo',
      sql`(${t.logoLight} IS NULL) = (${t.logoAlt} IS NULL) AND (${t.logoLight} IS NULL) = (${t.logoLightType} IS NULL) AND (${t.logoDark} IS NULL) = (${t.logoDarkType} IS NULL) AND (${t.logoDark} IS NULL OR ${t.logoLight} IS NOT NULL)`,
    ),
  ],
);
// Talks (D96): Clew's first owned domain. A round is the period in which everyone on a unit is due a talk with the
// unit's manager, one open per organisation; who is in it is computed from the assignments when it is read. Booked is
// never stored here (it is the calendar's). Dates are calendar days in Swedish time, read and written as `YYYY-MM-DD`.
export const talkRounds = pgTable(
  'talk_round',
  {
    id: text('id').primaryKey(),
    organisationId: text('organisation_id').notNull(),
    kind: text('kind').$type<'development'>().notNull(),
    label: text('label').notNull(),
    opensOn: date('opens_on', { mode: 'string' }).notNull(),
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    // An actor string (`operator:cli`, the seed's), not a person: an operator opens a round.
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp('closed_at', { withTimezone: true }),
  },
  t => [
    check('talk_round_kind', sql`${t.kind} IN ('development')`),
    check('talk_round_period', sql`${t.dueOn} >= ${t.opensOn}`),
    uniqueIndex('talk_round_open')
      .on(t.organisationId, t.kind)
      .where(sql`${t.closedAt} IS NULL`),
  ],
);
/** One employee's talk in a round: held is Clew's own record, marked by the manager and undone by clearing it. */
export const talks = pgTable(
  'talk',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => talkRounds.id),
    employeeId: text('employee_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    heldOn: date('held_on', { mode: 'string' }),
    heldBy: text('held_by').references(() => people.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [uniqueIndex('talk_round_employee').on(t.roundId, t.employeeId)],
);
/**
 * An action point (åtgärdspunkt, D96 items 4-6): a line about the employee, an owner who is the employee or the
 * manager, a due date, done or open. The text is a sealed envelope (purpose `talk:commitment:<id>`), never plain. Its
 * owner's card is `thread_id`; erasing the owner removes the card and nulls the pointer. Person columns other than the
 * employee are nulled by erasure, so the row stays with the employee it is about.
 */
export const talkCommitments = pgTable(
  'talk_commitment',
  {
    id: text('id').primaryKey(),
    roundId: text('round_id')
      .notNull()
      .references(() => talkRounds.id),
    employeeId: text('employee_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    ownerRole: text('owner_role').$type<'employee' | 'manager'>().notNull(),
    ownerId: text('owner_id').references(() => people.id, { onDelete: 'set null' }),
    textSealed: text('text_sealed').notNull(),
    dueOn: date('due_on', { mode: 'string' }).notNull(),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneBy: text('done_by').references(() => people.id, { onDelete: 'set null' }),
    createdBy: text('created_by').references(() => people.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    threadId: text('thread_id').references(() => threads.id, { onDelete: 'set null' }),
  },
  t => [
    check('talk_commitment_owner_role', sql`${t.ownerRole} IN ('employee', 'manager')`),
    index('talk_commitment_employee').on(t.employeeId),
    // The `due` timer knows only the card; erasing a card nulls its pointer.
    index('talk_commitment_thread').on(t.threadId),
    index('talk_commitment_owner_open')
      .on(t.ownerId)
      .where(sql`${t.doneAt} IS NULL`),
  ],
);
// The follow-up dialogue (D118): a manager's dialogue per unit. Areas, dimensions and questions are an organisation's
// configuration, replaced whole by an operator; assessments and activities are Clew's own records, kept when the
// configuration or the unit tree changes, so a unit is a key here, not a reference (a reorganisation drops no record).
export const dialogueAreas = pgTable(
  'dialogue_area',
  {
    organisationId: text('organisation_id').notNull(),
    key: text('key').notNull(),
    title: text('title').notNull(),
    kind: text('kind').$type<'measured' | 'assessed'>().notNull(),
    measure: text('measure'),
    info: text('info'),
    dimensions: jsonb('dimensions').$type<Array<{ key: string; title: string }>>().notNull().default([]),
    ordinal: integer('ordinal').notNull(),
  },
  t => [
    primaryKey({ columns: [t.organisationId, t.key] }),
    check('dialogue_area_kind', sql`${t.kind} IN ('measured', 'assessed')`),
  ],
);
/** A question of an area; `unit_id` set shows it on that unit only, in place of the area's general questions. */
export const dialogueQuestions = pgTable(
  'dialogue_question',
  {
    id: text('id').primaryKey(),
    organisationId: text('organisation_id').notNull(),
    areaKey: text('area_key').notNull(),
    unitId: text('unit_id'),
    heading: text('heading'),
    text: text('text').notNull(),
    basedOn: text('based_on'),
    ordinal: integer('ordinal').notNull(),
  },
  t => [index('dialogue_question_area').on(t.organisationId, t.areaKey)],
);
/**
 * An assessment (D118 item 6): append-only, the newest per unit, area and dimension counts. `dimension` is '' for an
 * area assessed as a whole. The comment is a sealed envelope (purpose `dialogue:assessment:<id>`) or null.
 */
export const dialogueAssessments = pgTable(
  'dialogue_assessment',
  {
    id: text('id').primaryKey(),
    organisationId: text('organisation_id').notNull(),
    unitId: text('unit_id').notNull(),
    areaKey: text('area_key').notNull(),
    dimension: text('dimension').notNull().default(''),
    tone: text('tone').$type<'ok' | 'warn' | 'alert'>().notNull(),
    commentSealed: text('comment_sealed'),
    authorId: text('author_id').references(() => people.id, { onDelete: 'set null' }),
    at: timestamp('at', { withTimezone: true }).notNull(),
  },
  t => [
    check('dialogue_assessment_tone', sql`${t.tone} IN ('ok', 'warn', 'alert')`),
    index('dialogue_assessment_unit').on(t.unitId, t.areaKey, t.dimension, t.at),
  ],
);
/**
 * An activity (D118 items 4, 5, 7, 9): a line of work in a unit's area, owned by a person whose card it is. The text and
 * the done note are sealed envelopes (purposes `dialogue:activity:<id>` and `dialogue:note:<id>`). The due date is
 * optional; only a dated activity has a timer.
 */
export const dialogueActivities = pgTable(
  'dialogue_activity',
  {
    id: text('id').primaryKey(),
    organisationId: text('organisation_id').notNull(),
    unitId: text('unit_id').notNull(),
    areaKey: text('area_key').notNull(),
    ownerId: text('owner_id').references(() => people.id, { onDelete: 'set null' }),
    textSealed: text('text_sealed').notNull(),
    dueOn: date('due_on', { mode: 'string' }),
    doneAt: timestamp('done_at', { withTimezone: true }),
    doneBy: text('done_by').references(() => people.id, { onDelete: 'set null' }),
    doneNoteSealed: text('done_note_sealed'),
    createdBy: text('created_by').references(() => people.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
    threadId: text('thread_id').references(() => threads.id, { onDelete: 'set null' }),
  },
  t => [
    index('dialogue_activity_unit').on(t.unitId),
    index('dialogue_activity_thread').on(t.threadId),
    index('dialogue_activity_owner_open')
      .on(t.ownerId)
      .where(sql`${t.doneAt} IS NULL`),
  ],
);
/**
 * The catalogue of competence types (D108 item 2): rows per installation, never an enumeration in code. Archived, never
 * deleted; one name per organisation among the types that are not archived, without regard to case. A type imported
 * from a file keeps the address it came with (`source_uri`, D120 item 7), one per organisation, so an import is
 * idempotent on it. A type merged into another (`merged_into`) is archived and stays, so the address and the history of
 * what it was are kept; a merge is not undone.
 */
export const competenceTypes = pgTable(
  'competence_type',
  {
    id: text('id').primaryKey(),
    organisationId: text('organisation_id').notNull(),
    name: text('name').notNull(),
    area: text('area').notNull(),
    kind: text('kind').$type<'certificate' | 'degree' | 'course' | 'authorisation' | 'skill'>().notNull(),
    // The employer's rule (item 3): months from the issue date. Null: no rule, and always on a skill (D120 item 1).
    validityMonths: integer('validity_months'),
    archivedAt: timestamp('archived_at', { withTimezone: true }),
    // An actor string (a person's principal id, `operator:cli`), not a person.
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    // The address an imported type came with, such as an ESCO concept's URI (D120 item 7). Null: added by hand.
    sourceUri: text('source_uri'),
    // The type this one was merged into (D108 item 2).
    mergedInto: text('merged_into').references((): AnyPgColumn => competenceTypes.id),
  },
  t => [
    check('competence_type_kind', sql`${t.kind} IN ('certificate', 'degree', 'course', 'authorisation', 'skill')`),
    check('competence_type_validity', sql`${t.validityMonths} IS NULL OR ${t.validityMonths} BETWEEN 1 AND 600`),
    // A skill never ends (D120 item 1): no employer's rule.
    check('competence_type_skill', sql`${t.kind} <> 'skill' OR ${t.validityMonths} IS NULL`),
    // A merged type is archived, and never merged into itself.
    check(
      'competence_type_merged',
      sql`${t.mergedInto} IS NULL OR (${t.archivedAt} IS NOT NULL AND ${t.mergedInto} <> ${t.id})`,
    ),
    uniqueIndex('competence_type_name')
      .on(t.organisationId, sql`lower(${t.name})`)
      .where(sql`${t.archivedAt} IS NULL`),
    uniqueIndex('competence_type_source_uri')
      .on(t.organisationId, t.sourceUri)
      .where(sql`${t.sourceUri} IS NOT NULL`),
  ],
);
/**
 * What one person holds of one type (D108 item 1): a competence and a certificate are the same record. Where it stands
 * is computed when read and never stored (item 4). `expires_on` is the issuer's own date only (item 3). The person's
 * rows go with the person; the people who registered, revoked or decided a row are nulled by erasure.
 *
 * A row the person registered themselves (item 7) has evidence `self`: `pending` until the manager they report to
 * decides it, then `valid` or `rejected`, with who decided (`decided_by`, the manager's attestation) and when
 * (`decided_at`). Only such a row is pending or rejected, and only it is decided. `thread_id` is its approval's key: each
 * manager's card is the thread `<thread_id>:<manager id>` with the topic `competence:approval:<thread_id>`, found by that
 * topic, so it is no reference. One pending registration per person and type.
 *
 * A row copied from a source (item 9) carries the connector, the source's own row id, type id and label, and when it
 * was last read; it has no `registered_by`, its evidence is `system`, and its `type_id` is empty while no administrator
 * has mapped the source's type. Unique on the connector and the source's row id, so a read can be repeated. It refers to
 * the source's row in `competence_source`, which the copy writes before any row, and goes with it, so with the
 * connector's row when an administrator removes the connector.
 */
export const competenceHoldings = pgTable(
  'competence_holding',
  {
    id: text('id').primaryKey(),
    personId: text('person_id')
      .notNull()
      .references(() => people.id, { onDelete: 'cascade' }),
    typeId: text('type_id').references(() => competenceTypes.id),
    issuedOn: date('issued_on', { mode: 'string' }).notNull(),
    expiresOn: date('expires_on', { mode: 'string' }),
    evidence: text('evidence').$type<'system' | 'manager' | 'self'>().notNull(),
    state: text('state').$type<'pending' | 'valid' | 'rejected' | 'revoked'>().notNull(),
    registeredBy: text('registered_by').references(() => people.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    revokedAt: timestamp('revoked_at', { withTimezone: true }),
    revokedBy: text('revoked_by').references(() => people.id, { onDelete: 'set null' }),
    // Through the source's row, not the connector's (`competence_holding_source_fk` below).
    connectorId: text('connector_id'),
    sourceId: text('source_id'),
    sourceType: text('source_type'),
    sourceLabel: text('source_label'),
    readAt: timestamp('read_at', { withTimezone: true }),
    // A person's own registration (item 7): the manager who decided it and when, and its approval's cards.
    decidedBy: text('decided_by').references(() => people.id, { onDelete: 'set null' }),
    decidedAt: timestamp('decided_at', { withTimezone: true }),
    threadId: text('thread_id'),
    // A skill (D120): the level it is held at (1 to 3), whether the person wants to develop it, and the manager who
    // confirmed the level and when. Null `validated_at` on a skill: the person's own rating alone.
    level: integer('level'),
    interest: boolean('interest').notNull().default(false),
    validatedBy: text('validated_by').references(() => people.id, { onDelete: 'set null' }),
    validatedAt: timestamp('validated_at', { withTimezone: true }),
    // When a skill's level was last set by a rating, the person's own or a manager's registration: the moment its
    // current rating began, which tells one spell of a required skill not met from the next (D108 item 12).
    ratedAt: timestamp('rated_at', { withTimezone: true }),
  },
  t => [
    check('competence_holding_evidence', sql`${t.evidence} IN ('system', 'manager', 'self')`),
    check('competence_holding_state', sql`${t.state} IN ('pending', 'valid', 'rejected', 'revoked')`),
    check('competence_holding_period', sql`${t.expiresOn} IS NULL OR ${t.expiresOn} >= ${t.issuedOn}`),
    // Only a person's own registration waits or is rejected.
    check('competence_holding_own', sql`${t.state} NOT IN ('pending', 'rejected') OR ${t.evidence} = 'self'`),
    // A person's own registration of a certificate is decided exactly when it no longer waits; nothing else is decided
    // or has cards, a skill included (D120: it is stored at once and confirmed, not approved). A decision keeps its time
    // when its manager is erased.
    check(
      'competence_holding_decided',
      sql`(${t.decidedBy} IS NULL OR ${t.decidedAt} IS NOT NULL) AND (${t.threadId} IS NULL OR ${t.evidence} = 'self') AND CASE WHEN ${t.level} IS NOT NULL THEN ${t.decidedAt} IS NULL WHEN ${t.evidence} = 'self' THEN (${t.state} = 'pending') = (${t.decidedAt} IS NULL) ELSE ${t.decidedAt} IS NULL END`,
    ),
    // A skill (D120 item 1) is held at one of three levels and has no end date, no source, no approval: it is valid or
    // revoked, registered in Clew by the person or a manager. That a level goes with a type of kind `skill` alone is the
    // use case's to keep, since the kind lives on the type.
    check(
      'competence_holding_skill',
      sql`${t.level} IS NULL OR (${t.level} BETWEEN 1 AND 3 AND ${t.expiresOn} IS NULL AND ${t.connectorId} IS NULL AND ${t.evidence} <> 'system' AND ${t.threadId} IS NULL AND ${t.state} IN ('valid', 'revoked'))`,
    ),
    // Only a skill is confirmed or carries an interest mark. A confirmation keeps its time when its manager is erased,
    // as a decision does, so a confirmed level never turns back into the person's own rating.
    // A skill always has the moment its level was rated; nothing else has one.
    check('competence_holding_rated', sql`(${t.level} IS NULL) = (${t.ratedAt} IS NULL)`),
    check(
      'competence_holding_validated',
      sql`(${t.validatedBy} IS NULL OR ${t.validatedAt} IS NOT NULL) AND (${t.validatedAt} IS NULL OR ${t.level} IS NOT NULL) AND (NOT ${t.interest} OR ${t.level} IS NOT NULL)`,
    ),
    // One registration of a type waiting per person: a second is refused until the first is decided or taken back.
    uniqueIndex('competence_holding_pending')
      .on(t.personId, t.typeId)
      .where(sql`${t.state} = 'pending'`),
    // One skill of a type per person (D120 item 1): rating it again changes that row. A revoked one stays as it was
    // and does not count.
    uniqueIndex('competence_holding_one_skill')
      .on(t.personId, t.typeId)
      .where(sql`${t.level} IS NOT NULL AND ${t.state} = 'valid'`),
    // A copied row has every column of its source and nobody who registered it; a row registered in Clew has none.
    check(
      'competence_holding_copy',
      sql`(${t.connectorId} IS NULL AND ${t.sourceId} IS NULL AND ${t.sourceType} IS NULL AND ${t.sourceLabel} IS NULL AND ${t.readAt} IS NULL) OR (${t.connectorId} IS NOT NULL AND ${t.sourceId} IS NOT NULL AND ${t.sourceType} IS NOT NULL AND ${t.sourceLabel} IS NOT NULL AND ${t.readAt} IS NOT NULL AND ${t.evidence} = 'system' AND ${t.registeredBy} IS NULL)`,
    ),
    // Only a copied row may wait for its type: a holding registered in Clew always names one.
    check('competence_holding_typed', sql`${t.typeId} IS NOT NULL OR ${t.connectorId} IS NOT NULL`),
    // A copied row refers to its source's row, not the connector's: removing the connector deletes the source's row
    // first, which a read's write holds while it writes, and only then the copied rows, so a removal waits for the write
    // and never deadlocks with it. Named, since the name Postgres would make is longer than its 63 characters.
    foreignKey({
      name: 'competence_holding_source_fk',
      columns: [t.connectorId],
      foreignColumns: [competenceSources.connectorId],
    }).onDelete('cascade'),
    index('competence_holding_person').on(t.personId),
    index('competence_holding_type').on(t.typeId),
    uniqueIndex('competence_holding_source')
      .on(t.connectorId, t.sourceId)
      .where(sql`${t.connectorId} IS NOT NULL`),
    index('competence_holding_source_type').on(t.connectorId, t.sourceType),
  ],
);
/**
 * A source's type mapped to the catalogue (D108 item 9), per organisation, since a type belongs to one: kept by
 * `admin.competence`. A copied row takes its type from here when it is read and when the mapping changes. `mapped_by`
 * is an actor string, as `competence_type.created_by` is. Gone with the connector's row.
 */
export const competenceSourceMappings = pgTable(
  'competence_source_mapping',
  {
    connectorId: text('connector_id')
      .notNull()
      .references(() => connectors.id, { onDelete: 'cascade' }),
    organisationId: text('organisation_id').notNull(),
    sourceType: text('source_type').notNull(),
    typeId: text('type_id')
      .notNull()
      .references(() => competenceTypes.id),
    mappedBy: text('mapped_by').notNull(),
    mappedAt: timestamp('mapped_at', { withTimezone: true }).notNull().defaultNow(),
  },
  // Named: the name Postgres would make is longer than its 63 characters and would be cut.
  t => [primaryKey({ name: 'competence_source_mapping_pk', columns: [t.connectorId, t.organisationId, t.sourceType] })],
);
/**
 * Each source the copy reads (D108 item 9): the read under way, if any, as a lease so two runs never read one source
 * at once (`run`, `claimed_at`, `lease_until`), and the last read that finished (`started_at` to `finished_at`, its
 * outcome and its counts, never a name or a key). Gone with the connector's row.
 */
export const competenceSources = pgTable(
  'competence_source',
  {
    connectorId: text('connector_id')
      .primaryKey()
      .references(() => connectors.id, { onDelete: 'cascade' }),
    source: text('source').notNull(),
    run: text('run'),
    claimedAt: timestamp('claimed_at', { withTimezone: true }),
    leaseUntil: timestamp('lease_until', { withTimezone: true }),
    startedAt: timestamp('started_at', { withTimezone: true }),
    finishedAt: timestamp('finished_at', { withTimezone: true }),
    outcome: text('outcome').$type<'complete' | 'partial' | 'failed'>(),
    // `{ unmatched, total, organisations }`: counts only, the whole read's and each organisation's (D108 item 9).
    counts: jsonb('counts').$type<Record<string, unknown>>(),
  },
  t => [
    check('competence_source_outcome', sql`${t.outcome} IS NULL OR ${t.outcome} IN ('complete', 'partial', 'failed')`),
    check(
      'competence_source_claim',
      sql`(${t.run} IS NULL) = (${t.claimedAt} IS NULL) AND (${t.run} IS NULL) = (${t.leaseUntil} IS NULL)`,
    ),
    check(
      'competence_source_last_read',
      sql`(${t.outcome} IS NULL) = (${t.startedAt} IS NULL) AND (${t.outcome} IS NULL) = (${t.finishedAt} IS NULL) AND (${t.outcome} IS NULL) = (${t.counts} IS NULL)`,
    ),
  ],
);
/**
 * What is required of whom (D108 item 6): a catalogue type and exactly one of a position (everyone who holds it, by the
 * position's code in the organisation), a unit (everyone placed on it, by the unit's id from its `unit:` key) or one
 * person. A position and a unit are named by what the provisioner calls them, not by a row: neither refers to
 * `auth_position` or `auth_unit`, so a position group removed and pushed again under the same code, or a unit nobody is
 * placed on, keeps its requirements; one whose position or unit is gone counts towards nothing until it comes back.
 * Kept by `admin.competence` for a position or a unit and by the manager a person reports to for that person (D118).
 * One requirement per type and target. `min_level` is the least level a confirmed skill must be held at (D120 item 4),
 * set on a requirement of a skill and on nothing else, which the use case keeps since the kind lives on the type.
 * `created_by` is an actor string, as `competence_type.created_by` is, emptied when that person is erased. Goes with
 * its type and its person.
 */
export const competenceRequirements = pgTable(
  'competence_requirement',
  {
    id: text('id').primaryKey(),
    organisationId: text('organisation_id').notNull(),
    typeId: text('type_id')
      .notNull()
      .references(() => competenceTypes.id, { onDelete: 'cascade' }),
    positionCode: text('position_code'),
    unitId: text('unit_id'),
    personId: text('person_id').references(() => people.id, { onDelete: 'cascade' }),
    minLevel: integer('min_level'),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [
    check('competence_requirement_target', sql`num_nonnulls(${t.positionCode}, ${t.unitId}, ${t.personId}) = 1`),
    check('competence_requirement_level', sql`${t.minLevel} IS NULL OR ${t.minLevel} BETWEEN 1 AND 3`),
    uniqueIndex('competence_requirement_position')
      .on(t.typeId, t.positionCode)
      .where(sql`${t.positionCode} IS NOT NULL`),
    uniqueIndex('competence_requirement_unit')
      .on(t.typeId, t.unitId)
      .where(sql`${t.unitId} IS NOT NULL`),
    uniqueIndex('competence_requirement_person')
      .on(t.typeId, t.personId)
      .where(sql`${t.personId} IS NOT NULL`),
    index('competence_requirement_organisation').on(t.organisationId),
  ],
);
/**
 * A share target (D108 item 6): of the people who hold a position (by its code), at least `min_share` percent hold a
 * type, on a unit's branch (by the unit's id) or, with no unit, across the whole organisation. Kept by
 * `admin.competence`; it names no person. One target per type, position and unit (or the organisation). Like a
 * requirement it names a position and a unit by their keys, not their rows, and goes with its type only.
 */
export const competenceShareTargets = pgTable(
  'competence_share_target',
  {
    id: text('id').primaryKey(),
    organisationId: text('organisation_id').notNull(),
    typeId: text('type_id')
      .notNull()
      .references(() => competenceTypes.id, { onDelete: 'cascade' }),
    positionCode: text('position_code').notNull(),
    unitId: text('unit_id'),
    minShare: integer('min_share').notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  t => [
    check('competence_share_target_share', sql`${t.minShare} BETWEEN 1 AND 100`),
    uniqueIndex('competence_share_target_unit')
      .on(t.typeId, t.positionCode, t.unitId)
      .where(sql`${t.unitId} IS NOT NULL`),
    uniqueIndex('competence_share_target_organisation')
      .on(t.organisationId, t.typeId, t.positionCode)
      .where(sql`${t.unitId} IS NULL`),
  ],
);
/**
 * The read log of the competence domain (D108 item 15, D121 item 5): one row per read of competence about people, kept
 * apart from the audit table since a read changes nothing. A search across the organisation and its export (`type_ids`,
 * the first also in `type_id`, with the least level and the unit narrowed to), or one person's holdings opened
 * (`person_id`); who read, as which
 * relation, by whom (the person, or the assistant for them, D122 item 6), when and how many rows the read returned. Ids
 * and counts only: never a name and never content. Written in
 * the transaction that reads what it records, so a read whose row cannot be written answers nothing. No foreign keys:
 * a row stays what it was when the type or the person it names changes, and erasure leaves it (D108 item 14 erases a
 * person's holdings; who read them is not theirs to erase, and how long a row is kept is open, D121).
 */
export const competenceReadLog = pgTable(
  'competence_read_log',
  {
    id: text('id').primaryKey(),
    organisationId: text('organisation_id').notNull(),
    readerId: text('reader_id').notNull(),
    relation: text('relation').$type<'self' | 'managed' | 'registrar'>().notNull(),
    // Who made the read (D122 item 6): the person, or the assistant reading for them. Rows from before are the person's.
    caller: text('caller').$type<'person' | 'assistant'>().notNull().default('person'),
    kind: text('kind').$type<'search' | 'person' | 'export'>().notNull(),
    typeId: text('type_id'),
    // Every type a search or its file asked for, in the order chosen, `type_id` first (a search may ask for up to five
    // that a person must all hold); empty where `type_id` is null. Rows from before migration 0068 hold their one type.
    typeIds: text('type_ids')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    minLevel: integer('min_level'),
    unitId: text('unit_id'),
    personId: text('person_id'),
    // The filters a search or its file narrowed by (migration 0070): the statuses asked for, in the contract's order
    // (`COMPETENCE_SEARCH_STATUSES`), empty for every status; and the validity window in days, null for none. Rows from
    // before narrowed by neither. The order is not kept: it discloses nothing.
    status: text('status')
      .array()
      .$type<CompetenceSearchStatus[]>()
      .notNull()
      .default(sql`'{}'::text[]`),
    until: integer('until').$type<CompetenceSearchWindow>(),
    rows: integer('rows').notNull(),
    readAt: timestamp('read_at', { withTimezone: true }).notNull(),
  },
  t => [
    check('competence_read_log_relation', sql`${t.relation} IN ('self', 'managed', 'registrar')`),
    // The types asked for begin with `type_id`, and there are none where it is none. `coalesce`: an empty list's first
    // element is NULL, and a check that comes to NULL holds, so without it a row naming a type and no list would pass
    // (migration 0069 corrects 0068).
    check(
      'competence_read_log_types',
      sql`CASE WHEN ${t.typeId} IS NULL THEN cardinality(${t.typeIds}) = 0 ELSE coalesce(${t.typeIds}[1] = ${t.typeId}, false) END`,
    ),
    // The assistant reads one person's holdings as their manager, never as a registrar and never a search or a file
    // (D122 item 5): a row that says otherwise is refused, and the read with it.
    check(
      'competence_read_log_caller',
      sql`${t.caller} = 'person' OR (${t.caller} = 'assistant' AND ${t.kind} = 'person' AND ${t.relation} = 'managed')`,
    ),
    check('competence_read_log_kind', sql`${t.kind} IN ('search', 'person', 'export')`),
    // A person opened names whom and no type. A search and its file are a registrar's and name the type and nobody; a
    // manager's matrix as a file is the one other export, naming neither (it holds several types).
    check(
      'competence_read_log_subject',
      sql`CASE WHEN ${t.kind} = 'person' THEN ${t.personId} IS NOT NULL AND ${t.typeId} IS NULL AND ${t.minLevel} IS NULL AND ${t.unitId} IS NULL WHEN ${t.relation} = 'registrar' THEN ${t.typeId} IS NOT NULL AND ${t.personId} IS NULL ELSE ${t.kind} = 'export' AND ${t.relation} = 'managed' AND ${t.typeId} IS NULL AND ${t.personId} IS NULL AND ${t.minLevel} IS NULL AND ${t.unitId} IS NULL END`,
    ),
    check('competence_read_log_level', sql`${t.minLevel} IS NULL OR ${t.minLevel} BETWEEN 1 AND 3`),
    // The statuses are one of the closed list's subsets, each once and in its order, so a list can neither carry an
    // unknown code, a NULL element nor a repeat; the window is one of the closed list's or none. Compared as whole
    // values with no NULL on the way (the lesson of 0069: a check that comes to NULL holds).
    check(
      'competence_read_log_status',
      sql`${t.status} IN ('{}'::text[], '{valid}'::text[], '{expiring}'::text[], '{expired}'::text[], '{valid,expiring}'::text[], '{valid,expired}'::text[], '{expiring,expired}'::text[], '{valid,expiring,expired}'::text[])`,
    ),
    check('competence_read_log_until', sql`${t.until} IS NULL OR ${t.until} IN (30, 90, 180)`),
    // Only a registrar's search or file narrows by them: one person opened and a manager's matrix as a file never do.
    check(
      'competence_read_log_filters',
      sql`(cardinality(${t.status}) = 0 AND ${t.until} IS NULL) OR (${t.relation} = 'registrar' AND ${t.kind} IN ('search', 'export'))`,
    ),
    check('competence_read_log_rows', sql`${t.rows} >= 0`),
    index('competence_read_log_organisation').on(t.organisationId, t.readAt),
    index('competence_read_log_person').on(t.personId),
    index('competence_read_log_reader').on(t.readerId),
  ],
);
/**
 * How long the competence of a person the directory has deactivated is kept (D108 item 14; D120 "Open": the timer
 * starts only when an operator has set the period): one row per organisation, written by an operator with
 * `scripts/competence-retention.ts` and audited. No row, no period: nothing is scheduled and nothing is erased. At least
 * one day, so a typo cannot erase at once, and at most ten years. `set_by` is an actor string.
 */
export const competenceRetention = pgTable(
  'competence_retention',
  {
    organisationId: text('organisation_id').primaryKey(),
    days: integer('days').notNull(),
    setBy: text('set_by').notNull(),
    setAt: timestamp('set_at', { withTimezone: true }).notNull(),
  },
  t => [check('competence_retention_days', sql`${t.days} BETWEEN 1 AND 3650`)],
);
/**
 * The erasure of one person's competence after they left (D108 item 14): a row per person the directory has
 * deactivated, written in the SCIM transaction that deactivates or activates them (the people module's leavers port,
 * bound in composition), by the hourly sweep that reconciles it with the directory and erases what is due, and by an
 * erasure by hand. `inactive` from the deactivation until the person is active again (`cancelled`) or erased
 * (`erased`). `inactive_since` is when the directory deactivated them or, for a deactivation Clew did not record (one
 * from before this table, or one whose port failed), when the sweep found it: the period counts from it. When the
 * erasure falls due is never stored: it follows from `inactive_since` and the organisation's period as it stands
 * (`competence_retention`), so a change of the period moves no row. The generation grows with every deactivation, so
 * an erasure planned for an earlier spell does nothing. No foreign key, as `competence_read_log` has none: a write here
 * takes no lock on `auth_person`, which the SCIM transaction holds while it tells the port. Kept after the erasure (ids
 * and times, no content), since a later deactivation of the same person takes the next generation.
 */
export const competenceErasures = pgTable(
  'competence_erasure',
  {
    personId: text('person_id').primaryKey(),
    organisationId: text('organisation_id').notNull(),
    state: text('state').$type<'inactive' | 'cancelled' | 'erased'>().notNull(),
    inactiveSince: timestamp('inactive_since', { withTimezone: true }),
    generation: integer('generation').notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull(),
  },
  t => [
    check('competence_erasure_state', sql`${t.state} IN ('inactive', 'cancelled', 'erased')`),
    check('competence_erasure_since', sql`${t.state} <> 'inactive' OR ${t.inactiveSince} IS NOT NULL`),
    check('competence_erasure_generation', sql`${t.generation} >= 0`),
    index('competence_erasure_organisation').on(t.organisationId, t.state),
    index('competence_erasure_inactive')
      .on(t.inactiveSince)
      .where(sql`${t.state} = 'inactive'`),
  ],
);
