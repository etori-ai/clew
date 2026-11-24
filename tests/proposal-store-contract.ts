import { describe, expect, test } from 'bun:test';
import type {
  AuditEntry,
  NewProposalThread,
  ProposalRecord,
  ProposalStore,
} from '../apps/server/src/modules/calendar/model';

/** The proposal store contract (D25): one suite, run against the memory adapter in the unit suite and against Postgres by `bun run test:db`. */
export interface ProposalStoreHarness {
  store: ProposalStore;
  people: [string, string];
  auditFor(subject: string): Promise<AuditEntry[]>;
  hasJob(id: string): Promise<boolean>;
  /**
   * What the store's invitations port was told about this invitation and kept (D132 item 3), oldest first: the harness
   * binds a port that records each call in the transaction it is given, as composition binds the talks module's.
   */
  told(invitationId: string): Promise<string[]>;
  /**
   * An open card of another connector, owned by the person and on the given topic: where cards share one table
   * (PostgreSQL) a row of it, where the store holds only its own (memory) an id it never made.
   */
  foreignThread(personId: string, topic: string): Promise<string>;
  /** What can be seen of that card from outside the store, to show a write addressed to it left it as it was. */
  foreignState(id: string): Promise<unknown>;
}
const T0 = '2026-11-04T06:00:00.000Z';
const plus = (iso: string, ms: number) => new Date(Date.parse(iso) + ms).toISOString();
const unique = () => Math.random().toString(36).slice(2, 10);
const draft = (personId: string, overrides: Partial<NewProposalThread> = {}): NewProposalThread => ({
  id: `t-${unique()}`,
  personId,
  topic: `utvecklingssamtal-${unique()}`,
  title: 'Planera utvecklingssamtal vecka 46',
  week: '2026-11-09',
  area: 'utvecklingssamtal',
  summary: 'Fyra förslag.',
  trigger: { reason: '4 samtal saknar tid', source: 'Nattlig genomgång 06:00', at: T0 },
  createdAt: T0,
  updatedAt: T0,
  ...overrides,
});
const proposal = (
  threadId: string,
  personId: string,
  name: string,
  overrides: Partial<ProposalRecord> = {},
): ProposalRecord => ({
  id: `p-${unique()}`,
  threadId,
  personId,
  status: 'proposed',
  participant: { personId: 'invitee-' + name.toLowerCase(), email: name.toLowerCase() + '@clew.test', name },
  start: '2026-11-09T08:00:00.000Z',
  end: '2026-11-09T09:00:00.000Z',
  eventUid: null,
  eventRef: null,
  eventRevision: null,
  confirmedAt: null,
  undoUntil: null,
  reminders: 0,
  remindedAt: null,
  ...overrides,
});

export function proposalStoreContract(name: string, make: () => Promise<ProposalStoreHarness>) {
  describe(`${name} proposal store`, () => {
    test('a card of another connector is not the store’s, even on the same topic: no read, no lock, no latest or open thread (DE-L6)', async () => {
      const { store, people, foreignThread } = await make();
      const topic = `utvecklingssamtal-${unique()}`;
      const id = await foreignThread(people[0], topic);
      expect(await store.readThread(people[0], id)).toBeUndefined();
      expect(await store.readThreadById(id)).toBeUndefined();
      expect(await store.latestThread(people[0], topic)).toBeUndefined();
      expect(await store.openThread(people[0], topic)).toBeUndefined();
      expect(await store.transaction(tx => tx.lockThread(people[0], id))).toBeUndefined();
    });
    test('a write addressed to another connector’s card leaves it as it was (DE-L6)', async () => {
      const { store, people, foreignThread, foreignState } = await make();
      const id = await foreignThread(people[0], `utvecklingssamtal-${unique()}`);
      const before = await foreignState(id);
      await store.transaction(async tx => {
        await tx.updateThread(id, { title: 'Planera utvecklingssamtal', state: 'handled', updatedAt: plus(T0, 1) });
        expect(await tx.transition(id, 'proposed', { status: 'superseded' })).toEqual([]);
      });
      await expect(
        store.transaction(tx => tx.addMessage(id, { role: 'assistant', body: 'Nya tider', at: T0 })),
      ).rejects.toThrow();
      await expect(store.transaction(tx => tx.insertProposals([proposal(id, people[0], 'Anna')]))).rejects.toThrow();
      expect(await foreignState(id)).toEqual(before);
      expect(await store.readThreadById(id)).toBeUndefined();
    });
    test('a proposal thread is read back with its records, and the contract view leaves superseded ones out', async () => {
      const {
        store,
        people: [a, b],
      } = await make();
      const t = draft(a);
      const anna = proposal(t.id, a, 'Anna'),
        erik = proposal(t.id, a, 'Erik', {
          status: 'superseded',
          start: '2026-11-10T08:00:00.000Z',
          end: '2026-11-10T09:00:00.000Z',
        });
      expect(
        await store.transaction(async tx => {
          const ok = await tx.insertThread(t);
          await tx.insertProposals([anna, erik]);
          await tx.updateThread(t.id, {
            items: [{ ref: 'proposal:' + anna.id, label: 'Anna', detail: 'mån', selectable: true, selected: true }],
          });
          return ok;
        }),
      ).toBe(true);
      const read = (await store.readThread(a, t.id))!;
      expect(read.thread).toMatchObject({
        id: t.id,
        kind: 'pushed',
        state: 'open',
        topic: t.topic,
        title: t.title,
        week: '2026-11-09',
        connector: 'calendar',
        area: 'utvecklingssamtal',
        createdAt: T0,
        trigger: t.trigger,
        messages: [],
      });
      expect(read.thread.items.map(i => i.ref)).toEqual(['proposal:' + anna.id]);
      expect(read.thread.proposals).toEqual([
        {
          id: anna.id,
          threadId: t.id,
          status: 'proposed',
          start: anna.start,
          end: anna.end,
          // The contract view names the invitee as the page draws them; the record keeps their id (N3).
          participant: { email: anna.participant.email, name: anna.participant.name },
          eventRef: null,
          undoUntil: null,
          reminders: 0,
          remindedAt: null,
        },
      ]);
      expect(read.proposals.map(p => p.id).sort()).toEqual([anna.id, erik.id].sort());
      expect(read.proposals.find(p => p.id === anna.id)?.participant).toEqual({
        personId: 'invitee-anna',
        email: 'anna@clew.test',
        name: 'Anna',
      });
      expect(await store.readThread(b, t.id)).toBeUndefined();
      expect((await store.readThreadById(t.id))?.thread.id).toBe(t.id);
      expect((await store.openThread(a, t.topic))?.thread.id).toBe(t.id);
      expect(await store.transaction(tx => tx.insertThread(draft(a, { topic: t.topic })))).toBe(false);
    });
    test('active proposals are the proposed, confirmed and final ones of a person across threads', async () => {
      const {
        store,
        people: [a, b],
      } = await make();
      const t1 = draft(a),
        t2 = draft(a),
        other = draft(b);
      const mine = ['proposed', 'confirmed', 'final', 'declined', 'undone', 'superseded'].map((status, i) =>
        proposal(i % 2 ? t1.id : t2.id, a, 'P' + i, { status: status as ProposalRecord['status'] }),
      );
      await store.transaction(async tx => {
        for (const t of [t1, t2, other]) await tx.insertThread(t);
        await tx.insertProposals([...mine, proposal(other.id, b, 'Q')]);
      });
      expect((await store.activeProposals(a)).map(p => p.status).sort()).toEqual(['confirmed', 'final', 'proposed']);
    });
    test('booked proposals are the confirmed, final and accepted ones that invite these people by id, whoever owns them (M1, N3)', async () => {
      const {
        store,
        people: [a, b],
      } = await make();
      const t1 = draft(a),
        t2 = draft(b);
      const anna = 'invitee-' + unique(),
        erik = 'invitee-' + unique(),
        other = 'invitee-' + unique();
      // All of them at one address: the person is found by id, never by an address that may have changed.
      const invite = (threadId: string, owner: string, personId: string, status: ProposalRecord['status']) =>
        proposal(threadId, owner, 'Anna', { status, participant: { personId, email: 'anna@clew.test', name: 'Anna' } });
      const booked = [
        invite(t1.id, a, anna, 'confirmed'),
        invite(t2.id, b, anna, 'final'),
        invite(t2.id, b, erik, 'accepted'),
      ];
      await store.transaction(async tx => {
        await tx.insertThread(t1);
        await tx.insertThread(t2);
        await tx.insertProposals([
          ...booked,
          ...(['proposed', 'declined', 'undone', 'superseded', 'declined-by-invitee', 'counter'] as const).map(status =>
            invite(t1.id, a, erik, status),
          ),
          invite(t1.id, a, other, 'confirmed'),
        ]);
      });
      const read = await store.bookedProposals([anna, erik]);
      expect(read.map(p => p.id).sort()).toEqual(booked.map(p => p.id).sort());
      expect(read.find(p => p.id === booked[1]!.id)).toEqual(booked[1]!);
      expect(await store.bookedProposals([])).toEqual([]);
    });
    test('a transition patches every proposal in a status and names them; a patch by id changes only those', async () => {
      const {
        store,
        people: [a],
      } = await make();
      const t = draft(a);
      const p1 = proposal(t.id, a, 'A'),
        p2 = proposal(t.id, a, 'B'),
        p3 = proposal(t.id, a, 'C', { status: 'confirmed' });
      await store.transaction(async tx => {
        await tx.insertThread(t);
        await tx.insertProposals([p1, p2, p3]);
      });
      const changed = await store.transaction(tx => tx.transition(t.id, 'proposed', { status: 'superseded' }));
      expect(changed.sort()).toEqual([p1.id, p2.id].sort());
      await store.transaction(tx =>
        tx.updateProposals([p3.id], {
          status: 'final',
          eventUid: 'clew-samtal-' + p3.id,
          eventRef: 'memory:x',
          eventRevision: 'r1',
          confirmedAt: plus(T0, 1000),
          undoUntil: plus(T0, 600_000),
        }),
      );
      const read = (await store.readThread(a, t.id))!;
      expect(read.proposals.find(p => p.id === p3.id)).toMatchObject({
        status: 'final',
        eventUid: 'clew-samtal-' + p3.id,
        eventRef: 'memory:x',
        eventRevision: 'r1',
        confirmedAt: plus(T0, 1000),
        undoUntil: plus(T0, 600_000),
      });
      expect(read.proposals.filter(p => p.status === 'superseded').length).toBe(2);
      await store.transaction(tx =>
        tx.updateProposals([p3.id], {
          eventUid: null,
          eventRef: null,
          eventRevision: null,
          confirmedAt: null,
          undoUntil: null,
        }),
      );
      expect((await store.readThread(a, t.id))!.proposals.find(p => p.id === p3.id)).toMatchObject({
        eventUid: null,
        eventRef: null,
        confirmedAt: null,
        undoUntil: null,
      });
      expect(await store.transaction(tx => tx.transition(t.id, 'proposed', { status: 'declined' }))).toEqual([]);
      // A moved proposal (D28) keeps everything but its time.
      await store.transaction(tx =>
        tx.updateProposals([p1.id], { start: '2026-11-11T13:00:00.000Z', end: '2026-11-11T14:00:00.000Z' }),
      );
      expect((await store.readThread(a, t.id))!.proposals.find(p => p.id === p1.id)).toMatchObject({
        status: 'superseded',
        participant: p1.participant,
        start: '2026-11-11T13:00:00.000Z',
        end: '2026-11-11T14:00:00.000Z',
      });
    });
    test('a thread patch writes the trigger counted again, its source and time kept (M1)', async () => {
      const {
        store,
        people: [a],
      } = await make();
      const t = draft(a);
      await store.transaction(async tx => {
        await tx.insertThread(t);
      });
      await store.transaction(tx =>
        tx.updateThread(t.id, { trigger: { ...t.trigger, reason: '3 samtal saknar tid' }, updatedAt: plus(T0, 1000) }),
      );
      expect((await store.readThread(a, t.id))!.thread).toMatchObject({
        trigger: { reason: '3 samtal saknar tid', source: 'Nattlig genomgång 06:00', at: T0 },
        updatedAt: plus(T0, 1000),
        summary: t.summary,
      });
    });
    test('messages, the thread patch, the audit row and the job commit together and roll back together', async () => {
      const {
        store,
        people: [a],
        auditFor,
        hasJob,
      } = await make();
      const t = draft(a);
      const p = proposal(t.id, a, 'Anna');
      await store.transaction(async tx => {
        await tx.insertThread(t);
        await tx.insertProposals([p]);
      });
      const entry = {
        actor: 'person:' + a,
        action: 'proposals.confirmed',
        subject: 'thread:' + t.id,
        at: plus(T0, 1000),
        details: { proposals: [p.id] },
      };
      await store.transaction(async tx => {
        await tx.updateProposals([p.id], { status: 'confirmed' });
        await tx.updateThread(t.id, { state: 'handled', handledAt: plus(T0, 1000), updatedAt: plus(T0, 1000) });
        await tx.addMessage(t.id, { role: 'user', body: 'Bekräftade 1 tider', at: plus(T0, 1000) });
        await tx.writeAudit(entry);
        await tx.scheduleJob({
          id: 'undo-expiry:' + t.id,
          kind: 'undo-expiry',
          runAt: plus(T0, 600_000),
          payload: { threadId: t.id },
        });
      });
      const read = (await store.readThread(a, t.id))!;
      expect(read.thread).toMatchObject({ state: 'handled', handledAt: plus(T0, 1000), updatedAt: plus(T0, 1000) });
      expect(read.thread.messages.map(m => [m.role, m.body, m.createdAt])).toEqual([
        ['user', 'Bekräftade 1 tider', plus(T0, 1000)],
      ]);
      expect(
        (await auditFor('thread:' + t.id)).map(({ actor, action, subject, at, details }) => ({
          actor,
          action,
          subject,
          at,
          details,
        })),
      ).toEqual([entry]);
      expect(await hasJob('undo-expiry:' + t.id)).toBe(true);
      await expect(
        store.transaction(async tx => {
          await tx.transition(t.id, 'confirmed', { status: 'final' });
          await tx.updateThread(t.id, { state: 'open' });
          await tx.writeAudit({ ...entry, action: 'proposals.final' });
          await tx.scheduleJob({ id: 'lost:' + t.id, kind: 'undo-expiry', runAt: plus(T0, 1) });
          throw new Error('after the audit row');
        }),
      ).rejects.toThrow('after the audit row');
      const after = (await store.readThread(a, t.id))!;
      expect(after.thread.state).toBe('handled');
      expect(after.proposals[0]!.status).toBe('confirmed');
      expect((await auditFor('thread:' + t.id)).map(e => e.action)).toEqual(['proposals.confirmed']);
      expect(await hasJob('lost:' + t.id)).toBe(false);
    });

    test('what the store is told of an invitation reaches the port inside the transaction: it is kept with the commit and taken back with a rollback (D132, D133)', async () => {
      const {
        store,
        people: [a],
        told,
      } = await make();
      const id = `inv-${unique()}`;
      await store.transaction(async tx => {
        await tx.invitations.established({
          actor: 'system:execution',
          invitationId: id,
          managerId: a,
          employeeId: 'invitee-anna',
          start: T0,
          end: plus(T0, 3_600_000),
          at: T0,
        });
        await tx.invitations.observed({ actor: 'assistant:scan', invitationId: id, event: null, at: T0 });
        await tx.invitations.moved({
          actor: 'person:' + a,
          invitationId: id,
          start: plus(T0, 86_400_000),
          end: plus(T0, 90_000_000),
          at: T0,
        });
      });
      expect(await told(id)).toEqual(['established', 'observed', 'moved']);
      // The port's own writes belong to the transaction: one that fails afterwards leaves nothing of them.
      await expect(
        store.transaction(async tx => {
          await tx.invitations.ended({ actor: 'person:' + a, invitationId: id, why: 'cancelled', at: T0 });
          throw new Error('after the port was told');
        }),
      ).rejects.toThrow('after the port was told');
      expect(await told(id)).toEqual(['established', 'observed', 'moved']);
      await store.transaction(tx =>
        tx.invitations.ended({
          actor: 'person:' + a,
          invitationId: id,
          why: 'cancelled',
          at: T0,
          keep: { managerId: a },
        }),
      );
      expect(await told(id)).toEqual(['established', 'observed', 'moved', 'ended']);
      expect(await told(`inv-${unique()}`)).toEqual([]);
    });

    test('the cards that name an invitee are found by structure whoever owns them, and the invitations to them are cleared of the name and the address and kept (D123)', async () => {
      const {
        store,
        people: [a, b],
        foreignThread,
      } = await make();
      const invitee = 'invitee-' + unique(),
        other = 'invitee-' + unique();
      const her = { personId: invitee, name: 'Anna Berg', email: 'anna.berg@clew.test' };
      const unplaced = (personId: string, label: string) => ({
        ref: 'unplaced:' + personId,
        label,
        detail: 'Ingen gemensam tid',
        selectable: false,
        selected: false,
      });
      // a's card invites her twice, once with an address since changed and since withdrawn, and invites another; b's
      // card could not place her; a's second card names only the other person, and b's second only by a label that
      // happens to be her name, which is no structure.
      const [sent, invited, rowed, theirs, named] = [draft(a), draft(a), draft(b), draft(a), draft(b)];
      const first = proposal(sent.id, a, 'Anna', { participant: her, status: 'confirmed' }),
        second = proposal(sent.id, a, 'Anna', {
          participant: { ...her, email: 'Old.Anna@clew.test' },
          status: 'superseded',
          start: '2026-11-10T08:00:00.000Z',
          end: '2026-11-10T09:00:00.000Z',
        }),
        others = proposal(invited.id, a, 'Bo', {
          participant: { personId: other, name: 'Bo Ek', email: 'bo@clew.test' },
        });
      await store.transaction(async tx => {
        for (const t of [sent, invited, rowed, theirs, named]) expect(await tx.insertThread(t)).toBe(true);
        await tx.insertProposals([first, second, others]);
        await tx.updateThread(rowed.id, { items: [unplaced(invitee, 'Anna Berg'), unplaced(other, 'Bo Ek')] });
        await tx.updateThread(theirs.id, { items: [unplaced(other, 'Bo Ek')] });
        await tx.updateThread(named.id, { items: [unplaced(other, 'Anna Berg')] });
      });
      // Another connector's card is never the store's, whatever it holds.
      await foreignThread(a, `utvecklingssamtal-${unique()}`);
      const byId = (x: { id: string }, y: { id: string }) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0);
      expect(await store.transaction(tx => tx.inviteeCards(invitee))).toEqual(
        [
          { id: sent.id, personId: a },
          { id: rowed.id, personId: b },
        ].sort(byId),
      );
      expect(await store.transaction(tx => tx.inviteeCards(other))).toEqual(
        [
          { id: invited.id, personId: a },
          { id: rowed.id, personId: b },
          { id: theirs.id, personId: a },
          { id: named.id, personId: b },
        ].sort(byId),
      );
      expect(await store.transaction(tx => tx.inviteeCards('invitee-' + unique()))).toEqual([]);
      const participants = async () =>
        (await store.readThread(a, sent.id))!.proposals.map(p => [p.id, p.status, p.participant]);
      // Cleared in a transaction that fails afterwards, nothing is cleared.
      await expect(
        store.transaction(async tx => {
          expect(await tx.clearInvitee(invitee)).toBe(2);
          throw new Error('after the clearing');
        }),
      ).rejects.toThrow('after the clearing');
      expect(await participants()).toEqual([
        [first.id, 'confirmed', her],
        [second.id, 'superseded', { ...her, email: 'Old.Anna@clew.test' }],
      ]);
      // Every invitation to her, whatever its status, keeps its row and its status and names her by id alone.
      expect(await store.transaction(tx => tx.clearInvitee(invitee))).toBe(2);
      expect(await participants()).toEqual([
        [first.id, 'confirmed', { personId: invitee, name: '', email: '' }],
        [second.id, 'superseded', { personId: invitee, name: '', email: '' }],
      ]);
      expect((await store.readThread(a, invited.id))!.proposals[0]!.participant).toEqual(others.participant);
      // Once more, nothing is left to clear; nor is there for an id nobody invited.
      expect(await store.transaction(async tx => [await tx.clearInvitee(invitee), await tx.clearInvitee(a)])).toEqual([
        0, 0,
      ]);
      // The rows stay on the cards: clearing the invitations is not the card's change.
      expect((await store.readThread(b, rowed.id))!.thread.items.map(i => i.ref)).toEqual([
        'unplaced:' + invitee,
        'unplaced:' + other,
      ]);
    });
  });
}
