import { afterAll } from 'bun:test';
import { eq, inArray } from 'drizzle-orm';
import { closeDatabase, database, schema, type Transaction } from '../../packages/db/src/index';
import { readAudit } from '../../packages/db/src/threads';
import { postgresProposalStore } from '../../apps/server/src/modules/calendar/adapters/postgres';
import type { InvitationsTx } from '../../apps/server/src/modules/calendar/model';
import { proposalStoreContract } from '../proposal-store-contract';
import { forgetTestWorkflows, testDurable } from './durable';

/** The proposal store contract against Postgres (D25). `bun run test:db` inside the devcontainer. */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');
const created: string[] = [];
/**
 * The invitations port as the contract binds it: each call is one audit row written on the transaction the store hands
 * over, so it is kept or taken back with that transaction, as the talks module's writes are in composition.
 */
const invited = new Set<string>();
const recorded = (tx: Transaction): InvitationsTx => {
  const record = (op: string) => async (call: { invitationId: string; actor: string; at: string }) => {
    invited.add(call.invitationId);
    await tx.insert(schema.audit).values({
      actor: call.actor,
      action: op,
      subject: 'invitation:' + call.invitationId,
      createdAt: new Date(call.at),
      details: {},
    });
  };
  return {
    established: record('established'),
    observed: record('observed'),
    moved: record('moved'),
    ended: record('ended'),
  };
};
afterAll(async () => {
  if (invited.size)
    await database()
      .delete(schema.audit)
      .where(
        inArray(
          schema.audit.subject,
          [...invited].map(id => 'invitation:' + id),
        ),
      );
  if (created.length) {
    const owned = await database()
      .select({ id: schema.threads.id })
      .from(schema.threads)
      .where(inArray(schema.threads.personId, created));
    const ids = owned.map(r => r.id);
    if (ids.length) {
      await database()
        .delete(schema.audit)
        .where(
          inArray(
            schema.audit.subject,
            ids.map(id => 'thread:' + id),
          ),
        );
      await database()
        .delete(schema.jobs)
        .where(
          inArray(
            schema.jobs.id,
            ids.flatMap(id => ['undo-expiry:' + id, 'lost:' + id]),
          ),
        );
      await database().delete(schema.threads).where(inArray(schema.threads.id, ids));
    }
    await database().delete(schema.people).where(inArray(schema.people.id, created));
  }
  await forgetTestWorkflows();
  await closeDatabase();
});
proposalStoreContract('postgres', async () => {
  const run = Math.random().toString(36).slice(2, 8);
  const people: [string, string] = [`test-${run}-a`, `test-${run}-b`];
  await database()
    .insert(schema.people)
    .values(people.map(id => ({ id, organisationId: 'test', name: id })));
  created.push(...people);
  return {
    store: postgresProposalStore(testDurable, { invitations: recorded }),
    people,
    auditFor: async subject =>
      (await readAudit(subject)).map(r => ({
        actor: r.actor,
        action: r.action,
        subject: r.subject,
        at: r.createdAt.toISOString(),
        details: r.details,
      })),
    hasJob: async id =>
      (await database().select({ id: schema.jobs.id }).from(schema.jobs).where(eq(schema.jobs.id, id))).length > 0,
    told: async id => (await readAudit('invitation:' + id)).map(r => r.action),
    // A service desk's open card in the same table, cleaned up with the person's threads.
    foreignThread: async (personId, topic) => {
      const id = `foreign-${run}-${Math.random().toString(36).slice(2, 8)}`;
      await database()
        .insert(schema.threads)
        .values({
          id,
          personId,
          kind: 'pushed',
          topic,
          title: 'Beställning väntar',
          state: 'open',
          connector: 'sm',
          area: 'arenden',
          summary: 'En beställning väntar på beslut.',
          trigger: { reason: 'Ny beställning', source: 'Servicedesk', at: new Date().toISOString() },
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      return id;
    },
    foreignState: async id => ({
      thread: (
        await database()
          .select({ title: schema.threads.title, state: schema.threads.state, updatedAt: schema.threads.updatedAt })
          .from(schema.threads)
          .where(eq(schema.threads.id, id))
      )[0],
      messages: (await database().select().from(schema.threadMessages).where(eq(schema.threadMessages.threadId, id)))
        .length,
      proposals: (await database().select().from(schema.proposals).where(eq(schema.proposals.threadId, id))).length,
    }),
  };
});
