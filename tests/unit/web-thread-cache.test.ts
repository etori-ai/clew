import { describe, expect, test } from 'bun:test';
import { QueryClient, QueryObserver, focusManager, onlineManager } from '@tanstack/query-core';
import type { Proposal, Thread } from '@clew/contracts';
import { keys } from '../../apps/web/src/query-keys';
import { createQueryClient } from '../../apps/web/src/query-client';
import { LOGGED_READ, isLoggedQuery, isLoggedView } from '../../apps/web/src/logged-reads';
import {
  applyThread,
  changeNotices,
  invalidateStream,
  pickProposalThread,
  previewThread,
  upsertThread,
} from '../../apps/web/src/thread-cache';

const NOW = '2026-11-04T08:00:00.000Z';
const thread = (values: Partial<Thread> & Pick<Thread, 'id'>): Thread => ({
  title: values.id,
  kind: 'pushed',
  topic: values.id,
  state: 'open',
  trigger: { reason: 'Test', source: 'Test', at: NOW },
  createdAt: NOW,
  updatedAt: NOW,
  handledAt: null,
  messages: [],
  proposals: [],
  week: null,
  connector: 'finance',
  area: 'budget',
  summary: '',
  items: [],
  actions: [],
  waitingOn: null,
  deadline: null,
  receipt: null,
  remindedAt: null,
  snoozedUntil: null,
  ...values,
});
const proposal = (id: string): Proposal => ({
  id,
  threadId: 'samtal',
  status: 'proposed',
  start: '2026-11-09T09:00:00.000Z',
  end: '2026-11-09T09:45:00.000Z',
  participant: { name: 'Anna', email: 'anna@clew.test' },
  eventRef: null,
  undoUntil: null,
  reminders: 0,
  remindedAt: null,
});
const client = () => new QueryClient({ defaultOptions: { queries: { retry: false } } });
const list = (c: QueryClient) => (c.getQueryData(keys.threads) as { threads: Thread[] }).threads;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));

describe('the stream cache (D33)', () => {
  test('a known thread is replaced in place, a new one goes first', () => {
    const a = thread({ id: 'a' }),
      b = thread({ id: 'b' });
    expect(upsertThread([a, b], { ...b, title: 'B2' }).map(t => t.title)).toEqual(['a', 'B2']);
    expect(upsertThread([a, b], thread({ id: 'c' })).map(t => t.id)).toEqual(['c', 'a', 'b']);
  });
  test('applyThread writes the list and the single entry and re-reads the counts beside them', async () => {
    const c = client();
    const a = thread({ id: 'a' });
    c.setQueryData(keys.threads, { threads: [a] });
    c.setQueryData(keys.areas, { areas: [] });
    c.setQueryData(keys.attention, { budget: 3 });
    c.setQueryData(keys.calendar('2026-11-09'), { events: [] });
    await applyThread(c, { ...a, state: 'dismissed' });
    expect(list(c)[0]?.state).toBe('dismissed');
    expect((c.getQueryData(keys.thread('a')) as Thread).state).toBe('dismissed');
    expect(c.getQueryState(keys.areas)?.isInvalidated).toBe(true);
    expect(c.getQueryState(keys.attention)?.isInvalidated).toBe(true);
    // A thread without proposals draws nothing in a calendar: the loaded weeks stay as they are.
    expect(c.getQueryState(keys.calendar('2026-11-09'))?.isInvalidated).toBe(false);
  });
  test('a thread with proposals re-reads every loaded week', async () => {
    const c = client();
    c.setQueryData(keys.calendar('2026-11-09'), { events: [] });
    c.setQueryData(keys.calendar('2026-11-16'), { events: [] });
    await applyThread(c, thread({ id: 'samtal', proposals: [proposal('p1')] }));
    expect(c.getQueryState(keys.calendar('2026-11-09'))?.isInvalidated).toBe(true);
    expect(c.getQueryState(keys.calendar('2026-11-16'))?.isInvalidated).toBe(true);
  });
  test('without a loaded list nothing is written to it', async () => {
    const c = client();
    await applyThread(c, thread({ id: 'a' }));
    expect(c.getQueryData(keys.threads)).toBeUndefined();
    expect((c.getQueryData(keys.thread('a')) as Thread).id).toBe('a');
  });
  test('a list refetch that left before the mutation cannot put the old thread back', async () => {
    const c = client();
    const old = thread({ id: 'a' });
    c.setQueryData(keys.threads, { threads: [old] });
    let answerLate!: (value: { threads: Thread[] }) => void;
    const late = new Promise<{ threads: Thread[] }>(resolve => {
      answerLate = resolve;
    });
    const refetch = c.query({ queryKey: keys.threads, queryFn: () => late, staleTime: 0 });
    await tick();
    expect(c.getQueryState(keys.threads)?.fetchStatus).toBe('fetching');
    await applyThread(c, { ...old, state: 'handled' });
    expect(c.getQueryState(keys.threads)?.fetchStatus).toBe('idle');
    expect(list(c)[0]?.state).toBe('handled');
    // A cancelled fetch settles with the data in the cache and its late answer is dropped on the floor.
    answerLate({ threads: [old] });
    await refetch;
    await tick();
    expect(list(c)[0]?.state).toBe('handled');
  });
  test('invalidateStream marks the list and the counter', () => {
    const c = client();
    c.setQueryData(keys.threads, { threads: [] });
    c.setQueryData(keys.attention, { budget: 3 });
    c.setQueryData(keys.areas, { areas: [] });
    invalidateStream(c);
    expect(c.getQueryState(keys.threads)?.isInvalidated).toBe(true);
    expect(c.getQueryState(keys.attention)?.isInvalidated).toBe(true);
    expect(c.getQueryState(keys.areas)?.isInvalidated).toBe(false);
  });
  test('a preview is drawn without re-reading anything, and a failed request puts the old thread back', async () => {
    const c = client();
    const a = thread({ id: 'a' });
    c.setQueryData(keys.threads, { threads: [a] });
    c.setQueryData(keys.areas, { areas: [] });
    const restore = await previewThread(c, { ...a, state: 'dismissed' });
    expect(list(c)[0]?.state).toBe('dismissed');
    expect((c.getQueryData(keys.thread('a')) as Thread).state).toBe('dismissed');
    expect(c.getQueryState(keys.areas)?.isInvalidated).toBe(false);
    restore();
    expect(list(c)[0]?.state).toBe('open');
    // The single entry did not exist before the preview, so it is gone again rather than left as the preview.
    expect(c.getQueryData(keys.thread('a'))).toBeUndefined();
  });
  test('an answer that landed on top of a preview stays when the preview is taken back', async () => {
    const c = client();
    const a = thread({ id: 'a' });
    c.setQueryData(keys.threads, { threads: [a] });
    const restore = await previewThread(c, { ...a, state: 'dismissed' });
    await tick();
    await applyThread(c, { ...a, state: 'handled' });
    restore();
    expect(list(c)[0]?.state).toBe('handled');
    expect((c.getQueryData(keys.thread('a')) as Thread).state).toBe('handled');
  });
  test('a change notice waits for the mutation in flight and invalidates once it has settled', async () => {
    const c = client();
    c.setQueryData(keys.threads, { threads: [] });
    c.setQueryData(keys.areas, { areas: [] });
    const notices = changeNotices(c);
    const previewKey = keys.preview('invoice-card', 'invoice', 'revision-1');
    const documentKey = keys.document({ ref: 'invoice', revision: 'revision-1' });
    c.setQueryData(previewKey, { revision: 'revision-1' });
    c.setQueryData(documentKey, new ArrayBuffer(4));
    notices.arrived();
    expect(c.getQueryState(keys.threads)?.isInvalidated).toBe(true);
    expect(c.getQueryState(previewKey)?.isInvalidated).toBe(false);
    expect(c.getQueryState(documentKey)?.isInvalidated).toBe(false);
    c.setQueryData(keys.threads, { threads: [] });
    let answer!: () => void;
    const pending = c
      .getMutationCache()
      .build(c, { mutationFn: () => new Promise<void>(resolve => (answer = resolve)) })
      .execute(undefined);
    await tick();
    notices.arrived();
    expect(c.getQueryState(keys.threads)?.isInvalidated).toBe(false);
    answer();
    await pending;
    await tick();
    expect(c.getQueryState(keys.threads)?.isInvalidated).toBe(true);
    expect(c.getQueryState(keys.areas)?.isInvalidated).toBe(true);
    expect(c.getQueryState(previewKey)?.isInvalidated).toBe(false);
    expect(c.getQueryState(documentKey)?.isInvalidated).toBe(false);
    notices.stop();
  });
  test('a revision the tab has already seen is no notice: the first one and a reconnect that repeats it', () => {
    const c = client();
    c.setQueryData(keys.threads, { threads: [] });
    const notices = changeNotices(c);
    // The stream's first word after the page's own first reads.
    notices.arrived('7');
    expect(c.getQueryState(keys.threads)?.isInvalidated).toBe(false);
    // The tab was hidden and shown again: the new connection repeats the revision.
    notices.arrived('7');
    expect(c.getQueryState(keys.threads)?.isInvalidated).toBe(false);
    // Something was committed.
    notices.arrived('8');
    expect(c.getQueryState(keys.threads)?.isInvalidated).toBe(true);
    c.setQueryData(keys.threads, { threads: [] });
    notices.arrived('8');
    expect(c.getQueryState(keys.threads)?.isInvalidated).toBe(false);
    notices.stop();
  });
  test('the calendar page picks the open proposal thread, else the latest one, else none', () => {
    const handled = thread({ id: 'old', topic: 'utvecklingssamtal', state: 'handled' });
    const open = thread({ id: 'new', topic: 'utvecklingssamtal' });
    expect(pickProposalThread([thread({ id: 'x' }), handled, open])?.id).toBe('new');
    expect(pickProposalThread([thread({ id: 'x' }), handled])?.id).toBe('old');
    expect(pickProposalThread([thread({ id: 'x' })])).toBeNull();
  });
});

describe('a read the server logs is read when the reader asks, and no more (D121 item 5)', () => {
  /** A query observed as a page observes it, with the session's own defaults; how often its read was made. */
  async function observed(c: QueryClient, key: readonly unknown[], options: object) {
    let reads = 0;
    const observer = new QueryObserver(c, {
      queryKey: key,
      queryFn: async () => ({ read: ++reads }),
      ...options,
    });
    const stop = observer.subscribe(() => undefined);
    await tick();
    return { reads: () => reads, stop };
  }
  test('a search and another person’s holdings are not read again by a notice, the tab shown, the network back or age', async () => {
    const c = createQueryClient();
    const search = await observed(c, ['competence-search', { typeId: 't-hlr', page: 1, pageSize: 25 }], LOGGED_READ);
    const holdings = await observed(c, keys.view('competence.holdings', '{"person":"anna"}'), LOGGED_READ);
    // An ordinary view beside them, which every one of these does read again.
    const ordinary = await observed(c, keys.view('phonebook.directory', null), {});
    expect([search.reads(), holdings.reads(), ordinary.reads()]).toEqual([1, 1, 1]);
    const notices = changeNotices(c);
    notices.arrived('1');
    notices.arrived('2');
    await tick();
    expect([search.reads(), holdings.reads()]).toEqual([1, 1]);
    expect(ordinary.reads()).toBe(2);
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
    await tick();
    expect([search.reads(), holdings.reads()]).toEqual([1, 1]);
    // Nor is it marked to be read again when next shown: it stays what was read.
    for (const key of [
      ['competence-search', { typeId: 't-hlr', page: 1, pageSize: 25 }],
      keys.view('competence.holdings', '{"person":"anna"}'),
    ]) {
      expect(c.getQueryState(key)?.isInvalidated).toBe(false);
      expect(c.getQueryCache().find({ queryKey: key })?.isStale()).toBe(false);
    }
    for (const o of [search, holdings, ordinary]) o.stop();
    notices.stop();
    focusManager.setFocused(undefined);
  });
  test('which view reads are logged: one person’s holdings named by `person`; the reader’s own page names nobody', () => {
    expect(LOGGED_READ).toMatchObject({
      staleTime: Infinity,
      refetchOnWindowFocus: false,
      refetchOnReconnect: false,
      retry: false,
    });
    expect(isLoggedView('competence.holdings', '{"person":"anna"}')).toBe(true);
    expect(isLoggedView('competence.holdings', null)).toBe(false);
    expect(isLoggedView('competence.holdings', '{}')).toBe(false);
    expect(isLoggedView('competence.attention', '{"person":"anna"}')).toBe(false);
    expect(isLoggedView('competence.holdings', '{not json')).toBe(false);
    expect(isLoggedQuery({ meta: LOGGED_READ.meta })).toBe(true);
    expect(isLoggedQuery({ meta: undefined })).toBe(false);
  });
});
