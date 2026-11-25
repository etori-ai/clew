import { afterAll, beforeAll, expect, test } from 'bun:test';
import { sql } from 'drizzle-orm';
import { database } from '../../packages/db/src/index';
import { listThreads } from '../../packages/db/src/threads';
import { postgresAttention } from '../../apps/server/src/threads/adapters/attention-postgres';
import { postgresRefreshStore } from '../../apps/server/src/threads/adapters/refresh-postgres';
import { postgresProvisionStore } from '../../apps/server/src/modules/people/adapters/postgres';
import { testDurable } from './durable';
import { upgradeDatabase, type UpgradeDatabase } from './upgrade';

/**
 * DE-L12: the reads every visit of the stream and every attention tick make are each served by an index of their own,
 * and a partial index or a prefix range serves a read only while the statement's text implies the index's condition,
 * which a later edit can quietly break. Each read is taken as its adapter sends it (the client's `debug` hook, on the
 * suite's database, where it finds nothing) and explained on a database of the test's own, migrated, filled and
 * analysed, as a generic plan (its parameters stay parameters, as a prepared statement's do) with sequential scans
 * disabled, so a statement no index of its own can serve shows as another index or a scan of the table. Run with
 * `bun run test:db` inside the devcontainer.
 */
if (!process.env.DATABASE_URL)
  throw new Error('DATABASE_URL is not set. Run `bun run test:db` inside the devcontainer.');

let c: UpgradeDatabase;
beforeAll(async () => {
  c = await upgradeDatabase();
  await c.migrate();
  // Two hundred people in twenty organisations, each with a hundred cards of which one in fifty is open work, a
  // hundred deliveries mostly claimed, ten refresh requests, and twenty-five groups, half of them units.
  await c.db.execute(sql`
    insert into auth_person (id, organisation_id, name, user_name)
    select 'person-' || n, 'org-' || (n % 20), 'Person ' || n, 'person.' || n from generate_series(1, 200) as n`);
  await c.db.execute(sql`
    insert into thread (id, person_id, kind, topic, title, state, trigger, execution, created_at, updated_at)
    select 'thread-' || n, 'person-' || (n % 200 + 1), case when n % 10 = 0 then 'question' else 'pushed' end,
           'topic-' || n, 'Kort ' || n, case when n % 50 = 1 then 'open' else 'handled' end,
           '{"reason":"test","source":"test","at":"2026-11-01T00:00:00Z"}'::jsonb,
           case when n % 97 = 0 then '{"state":"pending"}'::jsonb end,
           now() - n * interval '1 minute', now() - n * interval '1 minute'
      from generate_series(1, 20000) as n`);
  await c.db.execute(sql`
    insert into attention_delivery (id, person_id, thread_id, kind, batch, due_at, state, created_at)
    select 'delivery-' || n, 'person-' || (n % 200 + 1), 'thread-' || n, 'automatic', 'batch-' || (n / 5),
           now() - n * interval '1 minute', case n % 100 when 0 then 'ready' when 1 then 'waiting' else 'claimed' end, now()
      from generate_series(1, 20000) as n`);
  await c.db.execute(sql`
    insert into refresh_request (id, person_id, connector, assignment, authorization_version, state, requested_at, next_at)
    select 'refresh-' || n, 'person-' || (n % 200 + 1), 'connector-' || (n / 200), 'assignment', 'v1', 'idle', now(), now()
      from generate_series(1, 2000) as n`);
  await c.db.execute(sql`
    insert into auth_group (id, organisation_id, external_id, label)
    select 'group-' || n, 'org-' || (n % 20), case when n % 2 = 0 then 'unit:' || n else 'position:' || n end, 'Grupp ' || n
      from generate_series(1, 5000) as n`);
  await c.db.execute(sql`analyze`);
}, 60_000);
afterAll(async () => {
  await c?.drop();
});

/** The statements a read sends on the suite's database, as its client hands them to the server. */
async function sent(read: () => Promise<unknown>): Promise<string[]> {
  const options = database().$client.options;
  const before = options.debug;
  const texts: string[] = [];
  options.debug = (_connection, text) => void texts.push(text);
  try {
    await read();
  } finally {
    options.debug = before;
  }
  return texts;
}
interface PlanNode {
  'Node Type': string;
  'Relation Name'?: string;
  'Index Name'?: string;
  'Index Cond'?: string;
  Plans?: PlanNode[];
}
const planNodes = (node: PlanNode): PlanNode[] => [node, ...(node.Plans ?? []).flatMap(planNodes)];
/**
 * The indexes the generic plan of `statement` reads on the test's database, with sequential scans disabled, whether it
 * still scans the whole of `table`, and the conditions it looks the index up by. Each statement here reads one table,
 * so every index named is one of its.
 */
async function scans(statement: string, table: string) {
  const [row] = await c.db.$client.begin(async q => {
    await q.unsafe('set local enable_seqscan = off');
    return q.unsafe('explain (generic_plan, format json) ' + statement).simple();
  });
  const explained = row!['QUERY PLAN'];
  const nodes = planNodes((typeof explained === 'string' ? JSON.parse(explained) : explained)[0].Plan as PlanNode);
  return {
    indexes: [...new Set(nodes.flatMap(n => n['Index Name'] ?? []))],
    wholeTable: nodes.some(n => n['Node Type'] === 'Seq Scan' && n['Relation Name'] === table),
    lookedUpBy: nodes.flatMap(n => n['Index Cond'] ?? []).join(' '),
  };
}
const through = (index: string) => ({ indexes: [index], wholeTable: false, lookedUpBy: expect.any(String) });
/** The one statement among `texts` that reads `table` and matches `also`. */
function statement(texts: string[], table: string, also: (text: string) => boolean = () => true) {
  const found = texts.filter(t => t.includes(`"${table}"`) && also(t));
  expect(found).toHaveLength(1);
  return found[0]!;
}

test("a person's unresolved work is read through `thread_unresolved`", async () => {
  const texts = await sent(() => listThreads('person-none', new Date('2026-11-24T08:00:00Z')));
  // The work, not the bounded history that reads every other card of the person.
  const work = statement(texts, 'thread', t => !/\bnot\s*\(/i.test(t));
  expect(await scans(work, 'thread')).toEqual(through('thread_unresolved'));
  // The control: with the kind a parameter, the planner cannot see that the read's condition is the index's.
  expect((await scans(work.replace("'pushed'", '$2'), 'thread')).indexes).not.toContain('thread_unresolved');
});

test("a person's deliveries ready to show are read through `delivery_person_state`", async () => {
  const texts = await sent(() => postgresAttention().pending('person-none', '2026-11-24T08:00:00.000Z'));
  expect(await scans(statement(texts, 'attention_delivery'), 'attention_delivery')).toEqual(
    through('delivery_person_state'),
  );
});

test("a batch's release finds its deliveries through `delivery_batch`", async () => {
  const texts = await sent(() => postgresAttention().release('batch-none', '2026-11-24T08:00:00.000Z'));
  const release = statement(texts, 'attention_delivery', t => /^update/i.test(t));
  expect(await scans(release, 'attention_delivery')).toEqual(through('delivery_batch'));
});

test("a person's refresh statuses are read through `refresh_person`", async () => {
  const store = postgresRefreshStore({ durable: testDurable, sealer: { seal: v => v, open: v => v } });
  const texts = await sent(() => store.statuses('person-none'));
  expect(await scans(statement(texts, 'refresh_request'), 'refresh_request')).toEqual(through('refresh_person'));
});

test("an organisation's tree is read as a range of `auth_group_organisation_key`", async () => {
  const texts = await sent(() => postgresProvisionStore().transaction(tx => tx.unitTree('org-none')));
  const tree = statement(texts, 'auth_group');
  const read = await scans(tree, 'auth_group');
  expect(read).toEqual(through('auth_group_organisation_key'));
  // The key's prefix bounds the lookup, not only the organisation: `like 'unit:%'` is read as a range of the key.
  expect(read.lookedUpBy).toContain('external_id ~>=~');
  // The control: with the prefix a parameter, the index is read for the whole organisation and the key is a filter.
  expect((await scans(tree.replace("'unit:%'", '$2'), 'auth_group')).lookedUpBy).not.toContain('external_id');
});
