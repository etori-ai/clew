import { describe, expect, test } from 'bun:test';
import type { AuditEntry, NewProposalThread, ProposalRecord, ProposalStore } from '../apps/server/src/modules/calendar/model';

/** The proposal store contract (D25): one suite, run against the memory adapter in the unit suite and against Postgres by `bun run test:db`. */
export interface ProposalStoreHarness {
  store: ProposalStore;
  people: [string, string];
  auditFor(subject: string): Promise<AuditEntry[]>;
  hasJob(id: string): Promise<boolean>;
}
const T0 = '2026-11-04T06:00:00.000Z';
const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const unique = () => Math.random().toString(36).slice(2, 10);
const draft = (personId: string, overrides: Partial<NewProposalThread> = {}): NewProposalThread => ({ id: `t-${unique()}`, personId, topic: `utvecklingssamtal-${unique()}`, title: 'Planera utvecklingssamtal vecka 46', week: '2026-11-09',
  area: 'utvecklingssamtal', summary: 'Fyra förslag.', trigger: { reason: '4 samtal saknar tid', source: 'Nattlig genomgång 06:00', at: T0 }, createdAt: T0, updatedAt: T0, ...overrides });
const proposal = (threadId: string, personId: string, name: string, overrides: Partial<ProposalRecord> = {}): ProposalRecord => ({ id: `p-${unique()}`, threadId, personId, status: 'proposed',
  participant: { email: name.toLowerCase() + '@clew.test', name }, start: '2026-11-09T08:00:00.000Z', end: '2026-11-09T09:00:00.000Z', eventUid: null, eventRef: null, eventRevision: null, confirmedAt: null, undoUntil: null, reminders: 0, remindedAt: null, ...overrides });

export function proposalStoreContract(name: string, make: () => Promise<ProposalStoreHarness>) {
  describe(`${name} proposal store`, () => {
    test('a proposal thread is read back with its records, and the contract view leaves superseded ones out', async () => {
      const { store, people: [a, b] } = await make();
      const t = draft(a);
      const anna = proposal(t.id, a, 'Anna'), erik = proposal(t.id, a, 'Erik', { status: 'superseded', start: '2026-11-10T08:00:00.000Z', end: '2026-11-10T09:00:00.000Z' });
      expect(await store.transaction(async tx => { const ok = await tx.insertThread(t); await tx.insertProposals([anna, erik]); await tx.updateThread(t.id, { items: [{ ref: 'proposal:' + anna.id, label: 'Anna', detail: 'mån', selectable: true, selected: true }] }); return ok; })).toBe(true);
      const read = (await store.readThread(a, t.id))!;
      expect(read.thread).toMatchObject({ id: t.id, kind: 'pushed', state: 'open', topic: t.topic, title: t.title, week: '2026-11-09', connector: 'calendar', area: 'utvecklingssamtal', createdAt: T0, trigger: t.trigger, messages: [] });
      expect(read.thread.items.map(i => i.ref)).toEqual(['proposal:' + anna.id]);
      expect(read.thread.proposals).toEqual([{ id: anna.id, threadId: t.id, status: 'proposed', start: anna.start, end: anna.end, participant: anna.participant, eventRef: null, undoUntil: null, reminders: 0, remindedAt: null }]);
      expect(read.proposals.map(p => p.id).sort()).toEqual([anna.id, erik.id].sort());
      expect(await store.readThread(b, t.id)).toBeUndefined();
      expect((await store.readThreadById(t.id))?.thread.id).toBe(t.id);
      expect((await store.openThread(a, t.topic))?.thread.id).toBe(t.id);
      expect(await store.transaction(tx => tx.insertThread(draft(a, { topic: t.topic })))).toBe(false);
    });
    test('active proposals are the proposed, confirmed and final ones of a person across threads', async () => {
      const { store, people: [a, b] } = await make();
      const t1 = draft(a), t2 = draft(a), other = draft(b);
      const mine = ['proposed', 'confirmed', 'final', 'declined', 'undone', 'superseded'].map((status, i) => proposal(i % 2 ? t1.id : t2.id, a, 'P' + i, { status: status as ProposalRecord['status'] }));
      await store.transaction(async tx => { for (const t of [t1, t2, other]) await tx.insertThread(t); await tx.insertProposals([...mine, proposal(other.id, b, 'Q')]); });
      expect((await store.activeProposals(a)).map(p => p.status).sort()).toEqual(['confirmed', 'final', 'proposed']);
    });
    test('a transition patches every proposal in a status and names them; a patch by id changes only those', async () => {
      const { store, people: [a] } = await make();
      const t = draft(a);
      const p1 = proposal(t.id, a, 'A'), p2 = proposal(t.id, a, 'B'), p3 = proposal(t.id, a, 'C', { status: 'confirmed' });
      await store.transaction(async tx => { await tx.insertThread(t); await tx.insertProposals([p1, p2, p3]); });
      const changed = await store.transaction(tx => tx.transition(t.id, 'proposed', { status: 'superseded' }));
      expect(changed.sort()).toEqual([p1.id, p2.id].sort());
      await store.transaction(tx => tx.updateProposals([p3.id], { status: 'final', eventUid: 'clew-samtal-' + p3.id, eventRef: 'memory:x', eventRevision: 'r1', confirmedAt: plus(T0, 1000), undoUntil: plus(T0, 600_000) }));
      const read = (await store.readThread(a, t.id))!;
      expect(read.proposals.find(p => p.id === p3.id)).toMatchObject({ status: 'final', eventUid: 'clew-samtal-' + p3.id, eventRef: 'memory:x', eventRevision: 'r1', confirmedAt: plus(T0, 1000), undoUntil: plus(T0, 600_000) });
      expect(read.proposals.filter(p => p.status === 'superseded').length).toBe(2);
      await store.transaction(tx => tx.updateProposals([p3.id], { eventUid: null, eventRef: null, eventRevision: null, confirmedAt: null, undoUntil: null }));
      expect((await store.readThread(a, t.id))!.proposals.find(p => p.id === p3.id)).toMatchObject({ eventUid: null, eventRef: null, confirmedAt: null, undoUntil: null });
      expect(await store.transaction(tx => tx.transition(t.id, 'proposed', { status: 'declined' }))).toEqual([]);
      // A moved proposal (D28) keeps everything but its time.
      await store.transaction(tx => tx.updateProposals([p1.id], { start: '2026-11-11T13:00:00.000Z', end: '2026-11-11T14:00:00.000Z' }));
      expect((await store.readThread(a, t.id))!.proposals.find(p => p.id === p1.id)).toMatchObject({ status: 'superseded', participant: p1.participant, start: '2026-11-11T13:00:00.000Z', end: '2026-11-11T14:00:00.000Z' });
    });
    test('messages, the thread patch, the audit row and the job commit together and roll back together', async () => {
      const { store, people: [a], auditFor, hasJob } = await make();
      const t = draft(a);
      const p = proposal(t.id, a, 'Anna');
      await store.transaction(async tx => { await tx.insertThread(t); await tx.insertProposals([p]); });
      const entry = { actor: 'person:' + a, action: 'proposals.confirmed', subject: 'thread:' + t.id, at: plus(T0, 1000), details: { proposals: [p.id] } };
      await store.transaction(async tx => {
        await tx.updateProposals([p.id], { status: 'confirmed' });
        await tx.updateThread(t.id, { state: 'handled', handledAt: plus(T0, 1000), updatedAt: plus(T0, 1000) });
        await tx.addMessage(t.id, { role: 'user', body: 'Bekräftade 1 tider', at: plus(T0, 1000) });
        await tx.writeAudit(entry);
        await tx.scheduleJob({ id: 'undo-expiry:' + t.id, kind: 'undo-expiry', runAt: plus(T0, 600_000), payload: { threadId: t.id } });
      });
      const read = (await store.readThread(a, t.id))!;
      expect(read.thread).toMatchObject({ state: 'handled', handledAt: plus(T0, 1000), updatedAt: plus(T0, 1000) });
      expect(read.thread.messages.map(m => [m.role, m.body, m.createdAt])).toEqual([['user', 'Bekräftade 1 tider', plus(T0, 1000)]]);
      expect((await auditFor('thread:' + t.id)).map(({ actor, action, subject, at, details }) => ({ actor, action, subject, at, details }))).toEqual([entry]);
      expect(await hasJob('undo-expiry:' + t.id)).toBe(true);
      await expect(store.transaction(async tx => {
        await tx.transition(t.id, 'confirmed', { status: 'final' });
        await tx.updateThread(t.id, { state: 'open' });
        await tx.writeAudit({ ...entry, action: 'proposals.final' });
        await tx.scheduleJob({ id: 'lost:' + t.id, kind: 'undo-expiry', runAt: plus(T0, 1) });
        throw new Error('after the audit row');
      })).rejects.toThrow('after the audit row');
      const after = (await store.readThread(a, t.id))!;
      expect(after.thread.state).toBe('handled');
      expect(after.proposals[0]!.status).toBe('confirmed');
      expect((await auditFor('thread:' + t.id)).map(e => e.action)).toEqual(['proposals.confirmed']);
      expect(await hasJob('lost:' + t.id)).toBe(false);
    });
  });
}
