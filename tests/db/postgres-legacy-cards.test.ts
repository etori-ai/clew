import { afterAll, expect, test } from 'bun:test';
import { randomBytes, randomUUID } from 'node:crypto';
import { eq, inArray, like } from 'drizzle-orm';
import { database, schema } from '../../packages/db/src/index';
import { postgresRefreshStore } from '../../apps/server/src/threads/adapters/refresh-postgres';
import { legacyCardsUsecases } from '../../apps/server/src/threads/usecases/legacy-cards';
import { openSecret, sealSecret } from '../../apps/server/src/auth-crypto';
import { draft } from '../store-contract';
import { testDurable } from './durable';

/**
 * The reset of a connector's topic-only cards (D47) on Postgres: the open occurrences of one connector read across
 * people and locked, a card whose open occurrences are all topic-only resolved and handled with its audit row, and every
 * other card and connector left as it is. Run with `bun run test:db` inside the devcontainer.
 */
process.env.MASTER_KEY ??= randomBytes(32).toString('base64');
const p = 'legacy-cards-' + randomUUID().slice(0, 8);
const connector = p + '-connector';
afterAll(async () => {
  const db = database();
  await db.delete(schema.audit).where(like(schema.audit.subject, 'thread:' + p + '%'));
  await db.delete(schema.workOccurrences).where(like(schema.workOccurrences.id, p + '%'));
  await db.delete(schema.threads).where(like(schema.threads.id, p + '%'));
  await db.delete(schema.people).where(like(schema.people.id, p + '%'));
});

test('a reset resolves and handles the open topic-only cards of one connector, and leaves everything else', async () => {
  const store = postgresRefreshStore({ durable: testDurable, sealer: { seal: sealSecret, open: openSecret } });
  const db = database();
  const at = '2026-11-12T08:00:00.000Z';
  for (const person of ['anna', 'bo'])
    await db.insert(schema.people).values({ id: `${p}-${person}`, organisationId: p, name: 'Synthetic' });
  const occurrence = (
    id: string,
    personId: string,
    threadId: string,
    extra: { legacy?: boolean; connector?: string } = {},
  ) => ({
    id: `${p}-${id}`,
    personId: `${p}-${personId}`,
    connector: extra.connector ?? connector,
    assignment: 'u1:employee',
    sourceKey: 'topic-' + id,
    period: 'legacy',
    revision: 'r1',
    observedAt: at,
    sourceState: 'open' as const,
    disposition: 'visible' as const,
    threadId: `${p}-${threadId}`,
    legacy: extra.legacy ?? true,
  });
  await store.transaction(async tx => {
    // Anna's card is topic-only work; Bo's carries work under a current identity too; another connector's card is not
    // this reset's; a dismissed card is left as it is.
    for (const [thread, person, state, other] of [
      ['t-anna', 'anna', 'open', connector],
      ['t-bo', 'bo', 'open', connector],
      ['t-other', 'anna', 'open', p + '-elsewhere'],
      ['t-dismissed', 'bo', 'dismissed', connector],
    ] as const)
      await tx.insertThread(draft(`${p}-${person}`, { id: `${p}-${thread}`, connector: other, state }));
    await tx.saveOccurrence(occurrence('o1', 'anna', 't-anna'));
    await tx.saveOccurrence(occurrence('o2', 'bo', 't-bo'));
    await tx.saveOccurrence(occurrence('o3', 'bo', 't-bo', { legacy: false }));
    await tx.saveOccurrence(occurrence('o4', 'anna', 't-other', { connector: p + '-elsewhere' }));
    await tx.saveOccurrence(occurrence('o5', 'bo', 't-dismissed'));
  });
  expect((await store.transaction(tx => tx.openOccurrences(connector))).map(o => o.id)).toEqual([
    `${p}-o1`,
    `${p}-o2`,
    `${p}-o3`,
    `${p}-o5`,
  ]);
  const reset = legacyCardsUsecases({ store, clock: () => new Date(at) });
  expect(await reset.reset(connector, 'operator:cli', { confirm: false })).toEqual({
    cards: 1,
    occurrences: 1,
    skipped: 0,
    left: 2,
  });
  expect(await reset.reset(connector, 'operator:cli', { confirm: true })).toEqual({
    cards: 1,
    occurrences: 1,
    skipped: 0,
    left: 2,
  });
  const threads = await db
    .select({ id: schema.threads.id, state: schema.threads.state })
    .from(schema.threads)
    .where(like(schema.threads.id, p + '%'))
    .orderBy(schema.threads.id);
  expect(threads).toEqual([
    { id: `${p}-t-anna`, state: 'handled' },
    { id: `${p}-t-bo`, state: 'open' },
    { id: `${p}-t-dismissed`, state: 'dismissed' },
    { id: `${p}-t-other`, state: 'open' },
  ]);
  const occurrences = await db
    .select({ id: schema.workOccurrences.id, state: schema.workOccurrences.sourceState })
    .from(schema.workOccurrences)
    .where(like(schema.workOccurrences.id, p + '%'))
    .orderBy(schema.workOccurrences.id);
  expect(occurrences.filter(o => o.state === 'resolved').map(o => o.id)).toEqual([`${p}-o1`]);
  const audits = await db
    .select({ actor: schema.audit.actor, action: schema.audit.action, details: schema.audit.details })
    .from(schema.audit)
    .where(inArray(schema.audit.subject, [`thread:${p}-t-anna`]));
  expect(audits).toEqual([
    {
      actor: 'operator:cli',
      action: 'thread.source_resolved',
      details: { connector, reason: 'legacy-reset', occurrences: 1 },
    },
  ]);
  expect(
    (
      await db
        .select()
        .from(schema.threads)
        .where(eq(schema.threads.id, `${p}-t-anna`))
    )[0]?.handledAt,
  ).not.toBeNull();
});
