import { describe, expect, test } from 'bun:test';
import type {
  CommitmentRecord,
  PersonRef,
  RoundRecord,
  TalkRecord,
  TalkStore,
} from '../apps/server/src/modules/talks/model';

/**
 * The talks store (D96): rounds, talks and action points, the people the domain names, erasure and export. One suite,
 * two adapters: `tests/unit/talk-store.test.ts` on memory, `tests/db/postgres-talk-store.test.ts` on Postgres. The
 * harness supplies the store with a card port that writes the minimum a card needs, and the people.
 */
export interface TalkStoreHarness {
  store: TalkStore;
  /** Prefixes every id the suite writes, the organisation's included, so runs never meet. */
  prefix: string;
  /** A person as provisioning would have written them. */
  seedPerson(person: PersonRef): Promise<void>;
  /** The audit rows written about `subject`, oldest first. */
  auditFor(subject: string): Promise<Array<{ actor: string; action: string }>>;
  /** The text column as stored, where the adapter seals it (Postgres); absent for an adapter that does not. */
  storedText?: (commitmentId: string) => Promise<string>;
  /** How many texts the sealer has opened so far, where there is one. */
  opened?: () => number;
}
const T = '2026-11-10T08:00:00.000Z';
export const roundRow = (id: string, organisationId: string, extra: Partial<RoundRecord> = {}): RoundRecord => ({
  id,
  organisationId,
  kind: 'development',
  label: 'Utvecklingssamtal hösten 2026',
  opensOn: '2026-10-01',
  dueOn: '2026-11-28',
  createdBy: 'operator:test',
  createdAt: T,
  closedAt: null,
  ...extra,
});
export const talkRow = (
  id: string,
  roundId: string,
  employeeId: string,
  extra: Partial<TalkRecord> = {},
): TalkRecord => ({
  id,
  roundId,
  employeeId,
  heldOn: null,
  heldBy: null,
  createdAt: T,
  updatedAt: T,
  ...extra,
});
export const commitmentRow = (
  id: string,
  roundId: string,
  employeeId: string,
  extra: Partial<CommitmentRecord> = {},
): CommitmentRecord => ({
  id,
  roundId,
  employeeId,
  ownerRole: 'employee',
  ownerId: employeeId,
  text: 'Gå kursen i ' + id,
  dueOn: '2026-12-15',
  doneAt: null,
  doneBy: null,
  createdBy: null,
  createdAt: T,
  threadId: null,
  ...extra,
});
const person = (id: string, organisationId: string, userName: string | null = 'u-' + id): PersonRef => ({
  id,
  organisationId,
  name: 'Name ' + id,
  userName,
});

export function talkStoreContract(name: string, make: () => Promise<TalkStoreHarness>) {
  describe(`${name} talk store`, () => {
    /** An organisation with a manager and two employees, and its open round. */
    async function world() {
      const h = await make();
      const p = h.prefix,
        org = p + '-org',
        [boss, anna, bo] = [p + '-boss', p + '-anna', p + '-bo'];
      for (const id of [boss, anna, bo]) await h.seedPerson(person(id, org));
      await h.store.transaction(tx => tx.insertRound(roundRow(p + '-r1', org)));
      return { ...h, p, org, boss, anna, bo, round: p + '-r1' };
    }
    /** Opens the card, then inserts the action point that refers to it, as the use case does. */
    const addWithCard = async (h: TalkStoreHarness, c: CommitmentRecord, threadId: string) =>
      h.store.transaction(async tx => {
        await tx.workItems.open({
          threadId,
          personId: c.ownerId!,
          commitmentId: c.id,
          dueOn: c.dueOn,
          at: c.createdAt,
          subject: { entity: 'person', key: c.employeeId },
        });
        await tx.insertCommitment({ ...c, threadId });
      });

    test('one open round per organisation: a second is refused until the first is closed, and only the open one is current', async () => {
      const w = await world();
      expect((await w.store.transaction(tx => tx.currentRound(w.org)))?.id).toBe(w.round);
      expect(await w.store.transaction(tx => tx.currentRound(w.org + '-elsewhere'))).toBeUndefined();
      await expect(w.store.transaction(tx => tx.insertRound(roundRow(w.p + '-r2', w.org)))).rejects.toThrow();
      await w.store.transaction(async tx => {
        await tx.closeRound(w.round, '2026-11-11T08:00:00.000Z');
        await tx.insertRound(roundRow(w.p + '-r2', w.org, { createdAt: '2026-11-11T08:00:00.000Z' }));
      });
      const current = await w.store.transaction(tx => tx.currentRound(w.org));
      expect(current).toEqual(roundRow(w.p + '-r2', w.org, { createdAt: '2026-11-11T08:00:00.000Z' }));
      // A closed round may sit beside the open one.
      await w.store.transaction(tx =>
        tx.insertRound(roundRow(w.p + '-r0', w.org, { closedAt: '2026-01-01T00:00:00.000Z' })),
      );
      expect((await w.store.transaction(tx => tx.currentRound(w.org)))?.id).toBe(w.p + '-r2');
    });

    test('a talk is held and the hold undone by one row per round and employee, which keeps its own id', async () => {
      const w = await world();
      await w.store.transaction(tx =>
        tx.saveTalk(talkRow(w.p + '-t1', w.round, w.anna, { heldOn: '2026-11-05', heldBy: w.boss })),
      );
      expect(await w.store.transaction(tx => tx.talk(w.round, w.anna))).toEqual(
        talkRow(w.p + '-t1', w.round, w.anna, { heldOn: '2026-11-05', heldBy: w.boss }),
      );
      // A second save for the same employee updates the row and ignores the new id.
      await w.store.transaction(tx =>
        tx.saveTalk(
          talkRow(w.p + '-t2', w.round, w.anna, {
            heldOn: null,
            heldBy: null,
            createdAt: '2026-11-12T08:00:00.000Z',
            updatedAt: '2026-11-12T08:00:00.000Z',
          }),
        ),
      );
      const undone = await w.store.transaction(tx => tx.talk(w.round, w.anna));
      expect(undone).toEqual(talkRow(w.p + '-t1', w.round, w.anna, { updatedAt: '2026-11-12T08:00:00.000Z' }));
      expect(await w.store.transaction(tx => tx.talk(w.round, w.bo))).toBeUndefined();
      expect((await w.store.transaction(tx => tx.talks(w.round, [w.anna, w.bo]))).map(t => t.id)).toEqual([
        w.p + '-t1',
      ]);
      expect(await w.store.transaction(tx => tx.talks(w.round, []))).toEqual([]);
    });

    test('action points: the round shows its own and the open ones of earlier rounds; owned ones the same way; open counts from any round', async () => {
      const w = await world();
      const old = w.p + '-r0';
      await w.store.transaction(tx =>
        tx.insertRound(
          roundRow(old, w.org, { closedAt: '2026-06-01T00:00:00.000Z', createdAt: '2026-01-01T00:00:00.000Z' }),
        ),
      );
      const rows = [
        commitmentRow(w.p + '-c1', old, w.anna, { createdAt: '2026-02-01T00:00:00.000Z' }), // carried
        commitmentRow(w.p + '-c2', old, w.anna, {
          createdAt: '2026-02-02T00:00:00.000Z',
          doneAt: '2026-03-01T00:00:00.000Z',
          doneBy: w.anna,
        }), // done long ago: not shown
        commitmentRow(w.p + '-c3', w.round, w.anna, {
          ownerRole: 'manager',
          ownerId: w.boss,
          createdBy: w.boss,
          createdAt: '2026-11-10T09:00:00.000Z',
        }),
        commitmentRow(w.p + '-c4', w.round, w.anna, {
          createdAt: '2026-11-10T10:00:00.000Z',
          doneAt: '2026-11-11T00:00:00.000Z',
          doneBy: w.anna,
        }), // done in this round: shown
        commitmentRow(w.p + '-c5', w.round, w.bo, { createdAt: '2026-11-10T11:00:00.000Z' }),
      ];
      await w.store.transaction(async tx => {
        for (const c of rows) await tx.insertCommitment(c);
      });
      const ids = (cs: CommitmentRecord[]) => cs.map(c => c.id.slice(w.p.length + 1));
      expect(ids(await w.store.transaction(tx => tx.commitmentsAbout([w.anna], w.round)))).toEqual(['c1', 'c3', 'c4']);
      expect(ids(await w.store.transaction(tx => tx.commitmentsAbout([w.anna, w.bo], null)))).toEqual([
        'c1',
        'c3',
        'c5',
      ]);
      expect(await w.store.transaction(tx => tx.commitmentsAbout([], w.round))).toEqual([]);
      expect(ids(await w.store.transaction(tx => tx.commitmentsOwnedBy(w.anna, w.round)))).toEqual(['c1', 'c4']);
      expect(ids(await w.store.transaction(tx => tx.commitmentsOwnedBy(w.boss, w.round)))).toEqual(['c3']);
      const counts = await w.store.transaction(tx => tx.openCounts([w.anna, w.bo, w.boss]));
      expect([...counts.entries()].sort()).toEqual([
        [w.anna, 2],
        [w.bo, 1],
      ]);
      expect((await w.store.transaction(tx => tx.openCounts([]))).size).toBe(0);
      expect(await w.store.transaction(tx => tx.commitment(w.p + '-c3'))).toEqual(rows[2]!);
      expect(await w.store.transaction(tx => tx.commitment(w.p + '-none'))).toBeUndefined();
    });

    test('an action point is updated by field, found by its card, and its text round-trips while the stored column is not the text', async () => {
      const w = await world();
      const c = commitmentRow(w.p + '-c1', w.round, w.anna, { text: 'Läsa på om arbetsmiljö, å ä ö' });
      await addWithCard(w, c, w.p + '-th1');
      const opened = w.opened?.() ?? 0;
      await w.store.transaction(tx => tx.openCounts([w.anna]));
      if (w.opened) expect(w.opened()).toBe(opened);
      if (w.storedText) {
        const stored = await w.storedText(c.id);
        expect(stored).not.toBe(c.text);
        expect(stored).not.toContain('arbetsmiljö');
      }
      expect((await w.store.transaction(tx => tx.commitmentByThread(w.p + '-th1')))?.text).toBe(c.text);
      expect(await w.store.transaction(tx => tx.commitmentByThread(w.p + '-th-none'))).toBeUndefined();
      await w.store.transaction(tx =>
        tx.updateCommitment(c.id, { doneAt: '2026-11-12T08:00:00.000Z', doneBy: w.anna }),
      );
      expect(await w.store.transaction(tx => tx.commitment(c.id))).toEqual({
        ...c,
        threadId: w.p + '-th1',
        doneAt: '2026-11-12T08:00:00.000Z',
        doneBy: w.anna,
      });
      await w.store.transaction(tx => tx.updateCommitment(c.id, { doneAt: null, doneBy: null }));
      expect((await w.store.transaction(tx => tx.commitment(c.id)))?.doneAt).toBeNull();
      // An action point cannot refer to a card that was never opened.
      await expect(
        w.store.transaction(tx =>
          tx.insertCommitment(commitmentRow(w.p + '-c2', w.round, w.anna, { threadId: w.p + '-th-unknown' })),
        ),
      ).rejects.toThrow();
    });

    test('persons are named as the domain needs them; an unknown id is absent', async () => {
      const w = await world();
      const nameless = w.p + '-nameless';
      await w.seedPerson(person(nameless, w.org, null));
      const found = await w.store.transaction(tx => tx.persons([w.anna, nameless, w.p + '-unknown']));
      expect(found.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
        person(w.anna, w.org),
        person(nameless, w.org, null),
      ]);
      expect(await w.store.transaction(tx => tx.persons([]))).toEqual([]);
    });

    test('erasing a person removes their talks and the action points about them, clears them from the rest, and names the cards', async () => {
      const w = await world();
      await w.store.transaction(async tx => {
        await tx.saveTalk(talkRow(w.p + '-t-anna', w.round, w.anna, { heldOn: '2026-11-05', heldBy: w.boss }));
        await tx.saveTalk(talkRow(w.p + '-t-bo', w.round, w.bo, { heldOn: '2026-11-06', heldBy: w.boss }));
      });
      // About Anna, owned by her and by the manager: removed with both cards.
      await addWithCard(w, commitmentRow(w.p + '-c1', w.round, w.anna), w.p + '-th1');
      await addWithCard(
        w,
        commitmentRow(w.p + '-c2', w.round, w.anna, { ownerRole: 'manager', ownerId: w.boss, createdBy: w.boss }),
        w.p + '-th2',
      );
      // About Bo, owned by the manager, added and done by the manager: the manager is cleared from it.
      await addWithCard(
        w,
        commitmentRow(w.p + '-c3', w.round, w.bo, {
          ownerRole: 'manager',
          ownerId: w.boss,
          createdBy: w.boss,
          doneAt: '2026-11-12T08:00:00.000Z',
          doneBy: w.boss,
        }),
        w.p + '-th3',
      );
      // About Bo, his own, untouched by the manager.
      await addWithCard(w, commitmentRow(w.p + '-c4', w.round, w.bo), w.p + '-th4');

      const anna = await w.store.transaction(tx => tx.erasePerson(w.anna));
      expect(anna).toEqual({ talks: 1, commitments: 2, cleared: 0, threadIds: [w.p + '-th1', w.p + '-th2'].sort() });
      expect(await w.store.transaction(tx => tx.commitmentsAbout([w.anna], null))).toEqual([]);
      expect(await w.store.transaction(tx => tx.talk(w.round, w.anna))).toBeUndefined();

      const boss = await w.store.transaction(tx => tx.erasePerson(w.boss));
      expect(boss).toEqual({ talks: 0, commitments: 0, cleared: 2, threadIds: [w.p + '-th3'] });
      expect((await w.store.transaction(tx => tx.talk(w.round, w.bo)))?.heldBy).toBeNull();
      expect((await w.store.transaction(tx => tx.talk(w.round, w.bo)))?.heldOn).toBe('2026-11-06');
      const c3 = await w.store.transaction(tx => tx.commitment(w.p + '-c3'));
      expect(c3).toMatchObject({ ownerId: null, createdBy: null, doneBy: null, threadId: null, employeeId: w.bo });
      expect(await w.store.transaction(tx => tx.commitment(w.p + '-c4'))).toMatchObject({
        ownerId: w.bo,
        threadId: w.p + '-th4',
      });
      expect(await w.store.transaction(tx => tx.erasePerson(w.p + '-nobody'))).toEqual({
        talks: 0,
        commitments: 0,
        cleared: 0,
        threadIds: [],
      });
    });

    test('the export holds every round of the organisation, open and closed, with its talks and action points, text opened', async () => {
      const w = await world();
      const old = roundRow(w.p + '-r0', w.org, {
        closedAt: '2026-06-01T00:00:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
      await w.store.transaction(async tx => {
        await tx.insertRound(old);
        await tx.insertRound(roundRow(w.p + '-other', w.org + '-elsewhere'));
        await tx.saveTalk(talkRow(w.p + '-t1', w.round, w.anna, { heldOn: '2026-11-05', heldBy: w.boss }));
        await tx.insertCommitment(
          commitmentRow(w.p + '-c1', old.id, w.anna, { createdAt: '2026-02-01T00:00:00.000Z' }),
        );
        await tx.insertCommitment(commitmentRow(w.p + '-c2', w.round, w.bo));
      });
      const exported = await w.store.transaction(tx => tx.exportOrganisation(w.org));
      expect(exported.rounds.map(r => r.id)).toEqual([old.id, w.round]);
      expect(exported.rounds[0]).toEqual(old);
      expect(exported.talks).toEqual([talkRow(w.p + '-t1', w.round, w.anna, { heldOn: '2026-11-05', heldBy: w.boss })]);
      expect(exported.commitments).toEqual([
        commitmentRow(w.p + '-c1', old.id, w.anna, { createdAt: '2026-02-01T00:00:00.000Z' }),
        commitmentRow(w.p + '-c2', w.round, w.bo),
      ]);
      expect(await w.store.transaction(tx => tx.exportOrganisation(w.org + '-none'))).toEqual({
        rounds: [],
        talks: [],
        commitments: [],
      });
    });

    test('a throw inside the transaction leaves nothing behind: rows, cards and audit', async () => {
      const w = await world();
      const subject = 'commitment:' + w.p + '-c1';
      await expect(
        w.store.transaction(async tx => {
          await tx.saveTalk(talkRow(w.p + '-t1', w.round, w.anna, { heldOn: '2026-11-05', heldBy: w.boss }));
          await tx.workItems.open({
            threadId: w.p + '-th1',
            personId: w.anna,
            commitmentId: w.p + '-c1',
            dueOn: '2026-12-15',
            at: T,
            subject: { entity: 'person', key: w.anna },
          });
          await tx.insertCommitment(commitmentRow(w.p + '-c1', w.round, w.anna, { threadId: w.p + '-th1' }));
          await tx.closeRound(w.round, T);
          await tx.audit({ actor: 'person:' + w.boss, action: 'talks.commitment_added', subject, at: T });
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      await w.store.transaction(async tx => {
        expect(await tx.talk(w.round, w.anna)).toBeUndefined();
        expect(await tx.commitment(w.p + '-c1')).toBeUndefined();
        expect(await tx.commitmentByThread(w.p + '-th1')).toBeUndefined();
        expect((await tx.currentRound(w.org))?.id).toBe(w.round);
      });
      expect(await w.auditFor(subject)).toEqual([]);
      // The same writes without the throw commit, the audit row included.
      await w.store.transaction(tx =>
        tx.audit({ actor: 'person:' + w.boss, action: 'talks.commitment_added', subject, at: T }),
      );
      expect(await w.auditFor(subject)).toEqual([{ actor: 'person:' + w.boss, action: 'talks.commitment_added' }]);
    });
  });
}
