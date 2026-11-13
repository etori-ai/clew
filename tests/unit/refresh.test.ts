import { Registry, openGovernance } from '../../packages/connectors/src';
import { threadAccess } from '../../apps/server/src/threads/access';
import { draft as storedDraft } from '../store-contract';
import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import type { AuthenticatedContext, ThreadItem } from '../../packages/contracts/src';
import type { ScanObservation, ThreadDraft } from '../../packages/connectors/src';
import { memoryRefreshStore } from '../../apps/server/src/threads/adapters/refresh-memory';
import { refreshUsecases } from '../../apps/server/src/threads/usecases/refresh';
import type { PersonKeys } from '../../apps/server/src/threads/model';
import type { UserRecord } from '../../apps/server/src/modules/people/domain';
import { memoryPersonKeys } from '../person-keys';

const actor = {
  id: 'a',
  role: 'manager',
  unitId: 'unit',
  authorizationVersion: 'v1',
  async authorize() {},
} as unknown as AuthenticatedContext;
const draft = (revision = '1', period = '2026'): ThreadDraft => ({
  topic: 'cases',
  area: 'work',
  title: 'Uppgift',
  summary: 'Gör klart',
  reason: 'Aktuell',
  actions: [],
  occurrences: [{ key: 'case:1', revision, period }],
});
/** `people`: whose a source's key is (D119); without it a row names nobody. */
function world(people?: PersonKeys) {
  let now = Date.parse('2026-11-05T12:00:00.000Z'),
    n = 0,
    allowed = true;
  let observation: ScanObservation = { drafts: [draft()] };
  const store = memoryRefreshStore(),
    clock = () => new Date(now),
    key = (x: unknown) => createHash('sha256').update(JSON.stringify(x)).digest('hex');
  const deps = {
    store,
    clock,
    key,
    ids: () => `thread${++n}`,
    current: async () => (allowed ? actor : undefined),
    sources: async () => ['source'],
    system: (id: string) => (id === 'source' ? 'Ärendesystemet' : id),
    scan: async () => observation,
    ...(people ? { people } : {}),
  };
  const uc = refreshUsecases(deps);
  return {
    store,
    uc,
    deps,
    clock,
    set: (drafts: ThreadDraft[], completeness: 'complete' | 'partial' | 'delta' = 'complete') => {
      observation = {
        drafts,
        observation: {
          scope: 'unit:manager',
          observedAt: clock().toISOString(),
          version: String(now),
          completeness,
          exhausted: true,
        },
      };
    },
    advance: () => {
      now += 60_001;
    },
    revoke: () => {
      allowed = false;
    },
  };
}
test("a scanned card's trigger names the system in words, the id stays on the thread and in the audit row", async () => {
  const w = world();
  w.set([draft()]);
  await w.uc.request(actor);
  await w.uc.tick();
  const thread = w.store.threads.dump()[0]!.thread;
  expect(thread).toMatchObject({ connector: 'source', trigger: { reason: 'Aktuell', source: 'Ärendesystemet' } });
  expect(w.store.threads.audit.find(a => a.action === 'thread.pushed')).toMatchObject({
    subject: `thread:${thread.id}`,
    details: { connector: 'source' },
  });
  w.advance();
  w.set([draft('2')]);
  await w.uc.tick();
  expect(w.store.threads.dump()[0]!.thread.trigger.source).toBe('Ärendesystemet');
});
/** A person of the memory directory, as SCIM provisioned them. */
const user = (id: string, userName: string | null, organisationId = 'org'): UserRecord => ({
  id,
  organisationId,
  externalId: null,
  userName,
  name: id,
  email: null,
  title: null,
  enabled: true,
  createdAt: '2026-11-01T00:00:00.000Z',
  updatedAt: '2026-11-01T00:00:00.000Z',
  phoneNumbers: [],
  employments: [],
});
const row = (ref: string, key: string, entity: 'person' | 'unit' = 'person') => ({
  ref,
  label: ref,
  detail: '',
  selectable: false,
  selected: false,
  subject: { entity, key },
});
test("a scanned row that names a person by user name is kept by the id of whoever of the reader's organisation holds it (D119)", async () => {
  const users = new Map(
    [
      user('a', 'chef'),
      user('p-erik', 'erik.sandstrom'),
      // Enabled or not, a holder is the holder: the card says who the source meant.
      { ...user('p-leaver', 'asa.oberg'), enabled: false },
      // The same user name in another organisation is somebody else's.
      user('p-outside', 'ute.person', 'other-org'),
    ].map(u => [u.id, u] as const),
  );
  const w = world(memoryPersonKeys({ users }));
  w.set([
    {
      ...draft(),
      items: [
        // The source's own spelling: compared without regard to case.
        row('erik', 'Erik.Sandstrom'),
        row('leaver', 'asa.oberg'),
        row('nobody', 'okand.person'),
        row('outside', 'ute.person'),
        row('unit', 'unit-1', 'unit'),
      ],
    },
  ]);
  await w.uc.request(actor);
  await w.uc.tick();
  const thread = w.store.threads.dump()[0]!.thread;
  expect(thread.items.map(i => [i.ref, i.subject])).toEqual([
    ['erik', { entity: 'person', key: 'p-erik' }],
    ['leaver', { entity: 'person', key: 'p-leaver' }],
    // A user name nobody of the reader's organisation holds names nobody: the row keeps its text and no subject.
    ['nobody', undefined],
    ['outside', undefined],
    ['unit', { entity: 'unit', key: 'unit-1' }],
  ]);
  // The index from entity to cards keeps the id, never the source's key.
  const naming = (key: string) => w.store.threads.threadsNaming('a', [{ entity: 'person', key }]);
  expect((await naming('p-erik')).map(r => r.thread.id)).toEqual([thread.id]);
  expect(await naming('Erik.Sandstrom')).toEqual([]);
  expect(await naming('erik.sandstrom')).toEqual([]);
  expect(await naming('p-outside')).toEqual([]);
});
test('without whose a key is, a scanned row names nobody (D119)', async () => {
  const w = world();
  w.set([{ ...draft(), items: [row('erik', 'erik.sandstrom'), row('unit', 'unit-1', 'unit')] }]);
  await w.uc.request(actor);
  await w.uc.tick();
  expect(w.store.threads.dump()[0]!.thread.items.map(i => i.subject)).toEqual([
    undefined,
    { entity: 'unit', key: 'unit-1' },
  ]);
});
/** A draft without occurrences of its own, which Clew revises by a digest of what the source wrote. */
const legacy = (topic: string, ...items: ThreadItem[]): ThreadDraft => {
  const { occurrences: _, ...rest } = draft();
  return { ...rest, topic, items };
};
test("a person renamed in Clew's directory alone is no change of the work: the rows are rewritten, and nothing reopens, wakes or is delivered again (D119)", async () => {
  const users = new Map([user('a', 'chef'), user('p-erik', 'erik.sandstrom')].map(u => [u.id, u] as const));
  const w = world(memoryPersonKeys({ users }));
  const drafts = ['open', 'snoozed', 'dismissed', 'receipted'].map(topic => legacy(topic, row('r1', 'erik.sandstrom')));
  w.set(drafts);
  await w.uc.request(actor);
  await w.uc.tick();
  const card = (topic: string) => w.store.threads.dump().find(x => x.thread.topic.startsWith(topic + ':'))!.thread;
  const until = '2026-11-07T07:00:00.000Z',
    snoozed = card('snoozed').id;
  await w.store.threads.transaction(async tx => {
    await tx.updateThread(snoozed, { snoozedUntil: until });
    await tx.scheduleTimer({
      id: `snooze:${snoozed}`,
      personId: 'a',
      threadId: snoozed,
      kind: 'snooze',
      unitId: 'unit',
      authorizationVersion: 'v1',
      dueAt: until,
      requestedAt: w.clock().toISOString(),
    });
    await tx.updateThread(card('dismissed').id, { state: 'dismissed' });
    await tx.updateThread(card('receipted').id, {
      state: 'handled',
      receipt: { at: w.clock().toISOString(), headline: 'Klart', rows: [], undoUntil: null, undoCapability: null },
    });
  });
  const revisions = w.store.dump().map(o => o.revision);
  // Erik is renamed in the directory; the source still names him by the name it knows, which now names nobody.
  users.get('p-erik')!.userName = 'erik.sand';
  w.advance();
  w.set(drafts);
  await w.uc.tick();
  expect(w.store.dump().map(o => o.revision)).toEqual(revisions);
  expect(card('open')).toMatchObject({ state: 'open', trigger: { reason: 'Aktuell' } });
  expect(card('snoozed')).toMatchObject({ state: 'open', snoozedUntil: until });
  expect([card('open'), card('snoozed')].map(t => t.items.map(i => i.subject))).toEqual([[undefined], [undefined]]);
  expect(await w.store.threads.readTimer(`snooze:${snoozed}`)).toMatchObject({ state: 'active' });
  expect(w.store.threads.cancelled).toEqual([]);
  expect(card('dismissed').state).toBe('dismissed');
  expect(w.store.threads.dump().filter(x => x.thread.topic.startsWith('receipted:'))).toHaveLength(1);
  expect(w.store.threads.audit.filter(a => a.action === 'thread.refreshed').map(a => [a.subject, a.details])).toEqual([
    [`thread:${card('open').id}`, { materialChange: false, connector: 'source' }],
    [`thread:${snoozed}`, { materialChange: false, connector: 'source' }],
  ]);
  // One word per card when it was pushed, and none since.
  expect(w.store.threads.deliveries).toHaveLength(4);
});
test('a source that names another person in a row has changed the work, and the card comes back (D119)', async () => {
  const users = new Map(
    [user('a', 'chef'), user('p-erik', 'erik.sandstrom'), user('p-anna', 'anna')].map(u => [u.id, u] as const),
  );
  const w = world(memoryPersonKeys({ users }));
  w.set([legacy('leave', row('r1', 'erik.sandstrom'))]);
  await w.uc.request(actor);
  await w.uc.tick();
  const id = w.store.threads.dump()[0]!.thread.id;
  await w.store.threads.transaction(tx => tx.updateThread(id, { state: 'dismissed' }));
  w.advance();
  w.set([legacy('leave', row('r1', 'anna'))]);
  await w.uc.tick();
  expect(w.store.threads.dump()[0]!.thread).toMatchObject({
    state: 'open',
    items: [{ ref: 'r1', subject: { entity: 'person', key: 'p-anna' } }],
    trigger: { reason: 'Källan har ändrat uppgiften. Aktuell' },
  });
  expect(w.store.threads.audit.filter(a => a.action === 'thread.refreshed').map(a => a.details)).toEqual([
    { materialChange: true, connector: 'source' },
  ]);
  expect(w.store.threads.deliveries).toHaveLength(2);
});
test('an unchanged card is not rewritten when its stored copy has another key order or lacks an absent property', async () => {
  const w = world();
  const action = { id: 'open', label: 'Öppna', capability: 'source.open', kind: 'read' };
  w.set([{ ...draft(), actions: [action] } as ThreadDraft]);
  await w.uc.request(actor);
  await w.uc.tick();
  // What a JSON column hands back: the same action, keys in its own order; the draft now also names an absent property.
  w.advance();
  w.set([
    {
      ...draft(),
      actions: [{ kind: 'read', capability: 'source.open', label: 'Öppna', id: 'open', input: undefined }],
    } as ThreadDraft,
  ]);
  await w.uc.tick();
  expect(w.store.threads.audit.filter(a => a.action === 'thread.refreshed')).toEqual([]);
  // A real difference is still written.
  w.advance();
  w.set([{ ...draft(), actions: [{ ...action, label: 'Visa' }] } as ThreadDraft]);
  await w.uc.tick();
  expect(w.store.threads.audit.filter(a => a.action === 'thread.refreshed')).toHaveLength(1);
});
test('dismissal suppresses unchanged work, a changed revision explains its return, and a new period is distinct', async () => {
  const w = world();
  w.set([draft()]);
  await w.uc.request(actor);
  await w.uc.tick();
  const first = w.store.threads.dump()[0]!.thread;
  await w.store.threads.transaction(tx => tx.updateThread(first.id, { state: 'dismissed' }));
  w.advance();
  w.set([draft()]);
  await w.uc.tick();
  expect(w.store.threads.dump()).toHaveLength(1);
  expect(w.store.dump()[0]).toMatchObject({ disposition: 'dismissed', sourceState: 'open' });
  w.advance();
  w.set([draft('2')]);
  await w.uc.tick();
  expect(w.store.threads.dump()[0]!.thread).toMatchObject({
    state: 'open',
    trigger: { reason: 'Källan har ändrat uppgiften. Aktuell' },
  });
  w.advance();
  w.set([draft('1', '2027')]);
  await w.uc.tick();
  expect(w.store.dump()).toHaveLength(2);
  expect(w.store.threads.dump()).toHaveLength(2);
  expect(w.store.dump().find(o => o.period === '2026')?.sourceState).toBe('resolved');
});
test('only an exhausted complete snapshot or an explicit tombstone resolves missing work', async () => {
  const w = world();
  w.set([draft()]);
  await w.uc.request(actor);
  await w.uc.tick();
  w.advance();
  w.set([], 'partial');
  await w.uc.tick();
  expect(w.store.dump()[0]?.sourceState).toBe('open');
  w.advance();
  w.set([], 'complete');
  await w.uc.tick();
  expect(w.store.dump()[0]?.sourceState).toBe('resolved');
  expect(w.store.threads.dump()[0]?.thread.state).toBe('handled');
  expect(w.store.threads.audit.some(a => a.action === 'work.resolved')).toBe(true);
});
test('a scan cannot overwrite an action accepted after its baseline was captured', async () => {
  const w = world();
  w.set([draft()]);
  await w.uc.request(actor);
  await w.uc.tick();
  w.advance();
  const job = (await w.store.claim(w.clock().toISOString(), w.clock().toISOString()))!,
    baseline = await w.store.baseline(job);
  const t = w.store.threads.dump()[0]!.thread;
  await w.store.threads.transaction(tx =>
    tx.updateThread(t.id, {
      state: 'handled',
      receipt: { at: w.clock().toISOString(), headline: 'Klart', rows: [], undoUntil: null, undoCapability: null },
    }),
  );
  await w.uc.finish(job, baseline, { drafts: [draft('2')] });
  expect(w.store.threads.dump()[0]!.thread).toMatchObject({ state: 'handled', receipt: { headline: 'Klart' } });
  expect(w.store.dump()[0]?.revision).toBe('1');
});
test('concurrent requests coalesce across worker instances; old leases and revoked assignments cannot commit', async () => {
  const w = world();
  await Promise.all([w.uc.request(actor), w.uc.request(actor)]);
  const jobs = await Promise.all([
    w.store.claim(w.clock().toISOString(), new Date(w.clock().getTime() + 1000).toISOString()),
    w.store.claim(w.clock().toISOString(), new Date(w.clock().getTime() + 1000).toISOString()),
  ]);
  expect(jobs.filter(Boolean)).toHaveLength(1);
  w.advance();
  const current = (await w.store.claim(w.clock().toISOString(), w.clock().toISOString()))!;
  await w.uc.finish(jobs.find(Boolean)!, {}, { drafts: [draft()] });
  expect(w.store.dump()).toEqual([]);
  await w.uc.finish(current, {}, undefined, 'authorization-required');
  expect(w.store.dump()).toEqual([]);
  expect((await w.store.statuses(actor.id))[0]?.state).toBe('blocked');
});
test('source reads are independent of requesting refresh and a revoked actor never scans', async () => {
  const w = world();
  let scanned = 0;
  const uc = refreshUsecases({
    ...w.deps,
    scan: async () => {
      scanned++;
      return new Promise<never>(() => {});
    },
  });
  await uc.request(actor);
  expect(scanned).toBe(0);
  w.revoke();
  await uc.tick();
  expect(scanned).toBe(0);
  expect((await w.store.statuses(actor.id))[0]?.error).toBe('authorization-required');
});

test('source snapshots keep their original authority across transfers, role changes and history reads', async () => {
  const store = memoryRefreshStore();
  const registry = new Registry()
    .register({ id: 'source', kind: 'passthrough', source: 'Source', areas: [], capabilities: [] })
    .govern('source', openGovernance());
  let current = { ...actor },
    time = Date.parse('2026-11-07T12:00:00Z'),
    n = 0,
    empty = false;
  const uc = refreshUsecases({
    store,
    clock: () => new Date(time),
    ids: () => `authority-${++n}`,
    key: value => createHash('sha256').update(JSON.stringify(value)).digest('hex'),
    current: async () => current,
    sources: async () => ['source'],
    system: () => 'Source',
    scan: async p => ({
      drafts: empty
        ? []
        : [{ ...draft(), title: `Work for ${p.unitId}`, summary: `Content for ${p.authorizationVersion}` }],
      observation: {
        scope: p.unitId + ':' + p.role,
        observedAt: new Date(time).toISOString(),
        version: String(time),
        completeness: 'complete',
        exhausted: true,
      },
    }),
  });
  const access = threadAccess(store.threads, registry);
  await uc.request(current);
  await uc.tick();
  const original = (await access.list(current, new Date(time).toISOString()))[0]!;
  expect(original.sourceAuthorization).toBe('v1');
  current = { ...current, unitId: 'other-unit', authorizationVersion: 'v2' };
  empty = true;
  time++;
  await uc.request(current);
  await uc.tick();
  expect(await access.list(current, new Date(time).toISOString())).toEqual([]);
  expect(await access.read(current, original.id)).toBeUndefined();
  // A new positive observation creates new history; it never adopts the old projection.
  empty = false;
  time += 60_001;
  await uc.request(current);
  await uc.tick();
  await uc.tick();
  const transferred = (await access.list(current, new Date(time).toISOString()))[0]!;
  expect(transferred.id).not.toBe(original.id);
  expect(transferred.sourceAuthorization).toBe('v2');
  expect(JSON.stringify(transferred)).not.toContain('Content for v1');
  // Same assignment with a new grant version is also a new authorization boundary.
  current = { ...current, authorizationVersion: 'v3' };
  time++;
  expect(await access.read(current, transferred.id)).toBeUndefined();
  await uc.request(current);
  await uc.tick();
  const renewed = (await access.list(current, new Date(time).toISOString()))[0]!;
  expect(renewed.id).not.toBe(transferred.id);
  expect(renewed.sourceAuthorization).toBe('v3');
  await store.threads.transaction(tx => tx.updateThread(renewed.id, { state: 'handled' }));
  current = { ...current, role: 'employee', authorizationVersion: 'v4' };
  expect(await access.list(current, new Date(time).toISOString())).toEqual([]);
  expect(await access.read(current, renewed.id)).toBeUndefined();
  expect(await store.threads.readThread(current.id, original.id)).toBeDefined();
});

test('legacy source cards fail closed and a fresh scan cannot adopt their old messages', async () => {
  const w = world();
  const old = storedDraft(actor.id, {
    id: 'legacy',
    connector: 'source',
    topic: 'cases',
    sourceAuthorization: undefined,
  });
  await w.store.threads.transaction(async tx => {
    await tx.insertThread(old);
    await tx.addMessage(old.id, {
      role: 'assistant',
      body: 'Unverified old source content',
      at: w.clock().toISOString(),
    });
  });
  const registry = new Registry()
    .register({ id: 'source', kind: 'passthrough', source: 'Source', areas: [], capabilities: [] })
    .govern('source', openGovernance());
  const access = threadAccess(w.store.threads, registry);
  expect(await access.read(actor, old.id)).toBeUndefined();
  w.set([draft()]);
  await w.uc.request(actor);
  await w.uc.tick();
  const visible = await access.list(actor, w.clock().toISOString());
  expect(visible).toHaveLength(1);
  expect(visible[0]!.id).not.toBe(old.id);
  expect(JSON.stringify(visible)).not.toContain('Unverified old source content');
});

test('a changed authority cannot create another approval for an occurrence with an unknown execution', async () => {
  const w = world();
  w.set([draft()]);
  await w.uc.request(actor);
  await w.uc.tick();
  const old = w.store.threads.dump()[0]!.thread;
  await w.store.threads.transaction(tx =>
    tx.updateThread(old.id, { execution: { id: 'uncertain', state: 'unknown' } } as never),
  );
  const renewed = { ...actor, authorizationVersion: 'v2' };
  const uc = refreshUsecases({ ...w.deps, current: async () => renewed });
  await uc.request(renewed);
  await uc.tick();
  expect(w.store.threads.dump()).toHaveLength(1);
  expect(w.store.threads.dump()[0]!.thread.execution?.id).toBe('uncertain');
});

test('legacy cards with an uncertain action are retained without creating a second approval', async () => {
  const w = world();
  const old = storedDraft(actor.id, {
    id: 'legacy-uncertain',
    connector: 'source',
    topic: 'cases',
    sourceAuthorization: undefined,
  });
  await w.store.threads.transaction(async tx => {
    await tx.insertThread(old);
    await tx.updateThread(old.id, { execution: { id: 'uncertain', state: 'unknown' } } as never);
  });
  w.set([draft()]);
  await w.uc.request(actor);
  await w.uc.tick();
  expect(w.store.threads.dump()).toHaveLength(1);
  expect(w.store.threads.dump()[0]!.thread.execution?.id).toBe('uncertain');
});

test('renewed authority preserves dismissal of an unchanged source occurrence', async () => {
  const w = world();
  w.set([draft()]);
  await w.uc.request(actor);
  await w.uc.tick();
  const old = w.store.threads.dump()[0]!.thread;
  await w.store.threads.transaction(tx => tx.updateThread(old.id, { state: 'dismissed' }));
  const renewed = { ...actor, authorizationVersion: 'v2' };
  const uc = refreshUsecases({ ...w.deps, current: async () => renewed });
  await uc.request(renewed);
  await uc.tick();
  expect(w.store.threads.dump()).toHaveLength(1);
  expect(w.store.threads.dump()[0]!.thread.state).toBe('dismissed');
});
