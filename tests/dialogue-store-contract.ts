import { describe, expect, test } from 'bun:test';
import type {
  ActivityRecord,
  AreaRecord,
  AssessmentRecord,
  DialogueStore,
} from '../apps/server/src/modules/dialogue/model';

/**
 * The dialogue store (D118): configuration, assessments, activities, the names it shows, erasure and export. One
 * suite, two adapters: `tests/unit/dialogue-store.test.ts` on memory, `tests/db/postgres-dialogue-store.test.ts` on
 * Postgres. The harness supplies the store with a card port that writes the minimum a card needs.
 */
export interface DialogueStoreHarness {
  store: DialogueStore;
  /** Prefixes every id the suite writes, the organisation's included, so runs never meet. */
  prefix: string;
  seedPerson(id: string, organisationId: string, name: string): Promise<void>;
  seedUnit(id: string, organisationId: string, label: string): Promise<void>;
  auditFor(subject: string): Promise<Array<{ actor: string; action: string }>>;
  /** The free-text columns as stored, where the adapter seals them (Postgres). */
  stored?: (activityId: string) => Promise<{ text: string; note: string | null }>;
  storedComment?: (assessmentId: string) => Promise<string | null>;
}
const T = '2026-11-13T08:00:00.000Z';
const T2 = '2026-11-13T09:00:00.000Z';
const area = (organisationId: string, key: string, ordinal: number, extra: Partial<AreaRecord> = {}): AreaRecord => ({
  organisationId,
  key,
  title: 'Område ' + key,
  kind: 'assessed',
  measure: null,
  info: null,
  dimensions: [],
  ordinal,
  ...extra,
});
const activity = (
  id: string,
  organisationId: string,
  unitId: string,
  extra: Partial<ActivityRecord> = {},
): ActivityRecord => ({
  id,
  organisationId,
  unitId,
  areaKey: 'ops',
  ownerId: null,
  text: 'Gör ' + id,
  dueOn: null,
  doneAt: null,
  doneBy: null,
  doneNote: null,
  createdBy: null,
  createdAt: T,
  updatedAt: T,
  threadId: null,
  ...extra,
});
const assessment = (
  id: string,
  organisationId: string,
  unitId: string,
  extra: Partial<AssessmentRecord> = {},
): AssessmentRecord => ({
  id,
  organisationId,
  unitId,
  areaKey: 'ops',
  dimension: '',
  tone: 'warn',
  comment: null,
  authorId: null,
  at: T,
  ...extra,
});

export function dialogueStoreContract(name: string, make: () => Promise<DialogueStoreHarness>) {
  describe(`${name} dialogue store`, () => {
    async function world() {
      const h = await make();
      const p = h.prefix,
        org = p + '-org',
        [boss, chef] = [p + '-boss', p + '-chef'],
        [unit, other] = [p + '-unit', p + '-other'];
      await h.seedPerson(boss, org, 'Ingrid Holm');
      await h.seedPerson(chef, org, 'Hillevi Berg');
      await h.seedUnit(unit, org, 'Bergsåkers skola');
      await h.seedUnit(other, org, 'Hagaskolan');
      return { h, p, org, boss, chef, unit, other };
    }
    /** An activity with its card, as the use case adds one: the card first, since the row refers to it. */
    async function addWithCard(w: Awaited<ReturnType<typeof world>>, a: ActivityRecord) {
      await w.h.store.transaction(async tx => {
        if (a.threadId)
          await tx.workItems.open({
            threadId: a.threadId,
            personId: a.ownerId ?? w.boss,
            activityId: a.id,
            dueOn: a.dueOn,
            at: a.createdAt,
            subject: { entity: 'unit', key: a.unitId },
          });
        await tx.insertActivity(a);
      });
    }

    test('the configuration is replaced whole, per organisation, and read in order', async () => {
      const { h, org, p, unit } = await world();
      const otherOrg = p + '-org2';
      await h.store.transaction(async tx => {
        await tx.replaceConfig(
          org,
          [area(org, 'b', 1), area(org, 'a', 0, { dimensions: [{ key: 'x', title: 'X' }], info: 'Fakta' })],
          [
            {
              id: p + '-q2',
              organisationId: org,
              areaKey: 'a',
              unitId: unit,
              heading: null,
              text: 'Två',
              basedOn: 'Påstående',
              ordinal: 1,
            },
            {
              id: p + '-q1',
              organisationId: org,
              areaKey: 'a',
              unitId: null,
              heading: 'Rubrik',
              text: 'Ett',
              basedOn: null,
              ordinal: 0,
            },
          ],
        );
        await tx.replaceConfig(otherOrg, [area(otherOrg, 'z', 0)], []);
      });
      const read = await h.store.transaction(async tx => ({
        areas: await tx.areas(org),
        questions: await tx.questions(org),
        other: await tx.areas(otherOrg),
      }));
      expect(read.areas.map(a => [a.key, a.dimensions, a.info])).toEqual([
        ['a', [{ key: 'x', title: 'X' }], 'Fakta'],
        ['b', [], null],
      ]);
      expect(read.questions.map(q => [q.text, q.unitId, q.heading, q.basedOn])).toEqual([
        ['Ett', null, 'Rubrik', null],
        ['Två', unit, null, 'Påstående'],
      ]);
      expect(read.other.map(a => a.key)).toEqual(['z']);
      await h.store.transaction(tx => tx.replaceConfig(org, [area(org, 'c', 0)], []));
      const after = await h.store.transaction(async tx => [await tx.areas(org), await tx.questions(org)] as const);
      expect(after[0].map(a => a.key)).toEqual(['c']);
      expect(after[1]).toEqual([]);
    });

    test('assessments are read for the units asked, newest first, with the comment opened', async () => {
      const w = await world();
      const { h, p, org, unit, other, boss } = w;
      await h.store.transaction(async tx => {
        await tx.insertAssessment(assessment(p + '-a1', org, unit, { tone: 'alert', authorId: boss }));
        await tx.insertAssessment(
          assessment(p + '-a2', org, unit, { tone: 'ok', at: T2, comment: 'Bättre', dimension: 'x' }),
        );
        await tx.insertAssessment(assessment(p + '-a3', org, other));
      });
      const rows = await h.store.transaction(tx => tx.assessments(org, [unit]));
      expect(rows.map(a => [a.id, a.tone, a.comment, a.dimension, a.authorId, a.at])).toEqual([
        [p + '-a2', 'ok', 'Bättre', 'x', null, T2],
        [p + '-a1', 'alert', null, '', boss, T],
      ]);
      expect(await h.store.transaction(tx => tx.assessments(org, []))).toEqual([]);
      if (h.storedComment) {
        const stored = await h.storedComment(p + '-a2');
        expect(stored).not.toBeNull();
        expect(stored).not.toContain('Bättre');
        expect(await h.storedComment(p + '-a1')).toBeNull();
      }
    });

    test('an activity is inserted after its card, read, locked by id and by card, updated and deleted', async () => {
      const w = await world();
      const { h, p, org, unit, other, chef, boss } = w;
      const a = activity(p + '-x1', org, unit, {
        ownerId: chef,
        createdBy: boss,
        dueOn: '2026-12-01',
        threadId: p + '-t1',
      });
      await addWithCard(w, a);
      await addWithCard(w, activity(p + '-x2', org, other, { ownerId: chef, createdAt: T2, updatedAt: T2 }));
      expect(await h.store.transaction(tx => tx.activity(a.id))).toEqual(a);
      expect(await h.store.transaction(tx => tx.activityByThread(p + '-t1'))).toEqual(a);
      expect((await h.store.transaction(tx => tx.activities(org, [unit]))).map(r => r.id)).toEqual([a.id]);
      expect((await h.store.transaction(tx => tx.activitiesOwnedBy(chef))).map(r => r.id)).toEqual([a.id, p + '-x2']);
      await h.store.transaction(tx =>
        tx.updateActivity(a.id, {
          text: 'Ny text',
          dueOn: null,
          doneAt: T2,
          doneBy: chef,
          doneNote: 'Gick bra',
          updatedAt: T2,
        }),
      );
      expect(await h.store.transaction(tx => tx.activity(a.id))).toEqual({
        ...a,
        text: 'Ny text',
        dueOn: null,
        doneAt: T2,
        doneBy: chef,
        doneNote: 'Gick bra',
        updatedAt: T2,
      });
      if (h.stored) {
        const stored = await h.stored(a.id);
        expect(stored.text).not.toContain('Ny text');
        expect(stored.note).not.toContain('Gick bra');
      }
      // A done activity is no longer one the owner has open.
      expect((await h.store.transaction(tx => tx.activitiesOwnedBy(chef))).map(r => r.id)).toEqual([p + '-x2']);
      await h.store.transaction(tx => tx.updateActivity(a.id, { doneAt: null, doneBy: null, doneNote: null }));
      expect(await h.store.transaction(tx => tx.activity(a.id))).toMatchObject({ doneNote: null, doneAt: null });
      await h.store.transaction(tx => tx.deleteActivity(a.id));
      expect(await h.store.transaction(tx => tx.activity(a.id))).toBeUndefined();
    });

    test('the areas with an open activity are listed once each; a done activity does not count', async () => {
      const w = await world();
      const { h, p, org, unit, other } = w;
      await addWithCard(w, activity(p + '-o1', org, unit, { areaKey: 'b' }));
      await addWithCard(w, activity(p + '-o2', org, other, { areaKey: 'b' }));
      await addWithCard(w, activity(p + '-o3', org, unit, { areaKey: 'a' }));
      await addWithCard(w, activity(p + '-o4', org, unit, { areaKey: 'c', doneAt: T2 }));
      expect(await h.store.transaction(tx => tx.openAreaKeys(org))).toEqual(['a', 'b']);
      expect(await h.store.transaction(tx => tx.openAreaKeys(p + '-elsewhere'))).toEqual([]);
    });

    test('names and unit labels are found by id; an unknown id is absent', async () => {
      const { h, p, boss, unit } = await world();
      const read = await h.store.transaction(async tx => ({
        names: await tx.names([boss, p + '-nobody']),
        units: await tx.unitLabels([unit, p + '-none']),
        none: await tx.names([]),
      }));
      expect([...read.names]).toEqual([[boss, 'Ingrid Holm']]);
      expect([...read.units]).toEqual([[unit, 'Bergsåkers skola']]);
      expect(read.none.size).toBe(0);
    });

    test('a throw rolls the whole transaction back', async () => {
      const w = await world();
      const { h, p, org, unit } = w;
      await expect(
        h.store.transaction(async tx => {
          await tx.insertAssessment(assessment(p + '-r1', org, unit));
          throw new Error('stop');
        }),
      ).rejects.toThrow('stop');
      expect(await h.store.transaction(tx => tx.assessments(org, [unit]))).toEqual([]);
    });

    test('erasure clears the person from every row and returns the cards they owned; export holds everything', async () => {
      const w = await world();
      const { h, p, org, unit, chef, boss } = w;
      await addWithCard(w, activity(p + '-e1', org, unit, { ownerId: chef, createdBy: boss, threadId: p + '-t2' }));
      await addWithCard(
        w,
        activity(p + '-e2', org, unit, { ownerId: boss, createdBy: chef, doneBy: chef, doneAt: T2 }),
      );
      await h.store.transaction(async tx => {
        await tx.insertAssessment(assessment(p + '-e3', org, unit, { authorId: chef }));
        await tx.audit({ actor: 'operator:test', action: 'dialogue.test', subject: 'dialogue-test:' + p, at: T });
      });
      const erased = await h.store.transaction(tx => tx.erasePerson(chef));
      expect(erased).toEqual({ cleared: 3, threadIds: [p + '-t2'] });
      const rows = await h.store.transaction(tx => tx.activities(org, [unit]));
      expect(rows.map(r => [r.id, r.ownerId, r.createdBy, r.doneBy, r.threadId])).toEqual([
        [p + '-e1', null, boss, null, null],
        [p + '-e2', boss, null, null, null],
      ]);
      expect((await h.store.transaction(tx => tx.assessments(org, [unit])))[0]!.authorId).toBeNull();
      const doc = await h.store.transaction(tx => tx.exportOrganisation(org));
      expect([doc.areas.length, doc.questions.length, doc.assessments.length, doc.activities.length]).toEqual([
        0, 0, 1, 2,
      ]);
      expect(doc.activities[0]!.text).toBe('Gör ' + p + '-e1');
      expect(await h.auditFor('dialogue-test:' + p)).toEqual([{ actor: 'operator:test', action: 'dialogue.test' }]);
    });
  });
}
