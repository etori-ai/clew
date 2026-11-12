import { describe, expect, test } from 'bun:test';
import type {
  CompetenceStore,
  HoldingCopy,
  HoldingRecord,
  PersonRef,
  PositionRecord,
  RequirementRecord,
  ShareTargetRecord,
  SourceRecord,
  TypeRecord,
  UnitRecord,
} from '../apps/server/src/modules/competence/model';

/**
 * The competence store (D108): the catalogue, holdings, the rows copied from sources and their mappings (item 9),
 * requirements and share targets and the directory they are read against (items 5 and 6), the people the domain names,
 * erasure and export. One suite, two adapters: `tests/unit/competence-store.test.ts` on memory,
 * `tests/db/postgres-competence-store.test.ts` on Postgres.
 */
export interface CompetenceStoreHarness {
  store: CompetenceStore;
  /** Prefixes every id the suite writes, the organisation's included, so runs never meet. */
  prefix: string;
  /** A person as provisioning would have written them. */
  seedPerson(person: PersonRef): Promise<void>;
  /** SCIM deactivates a person (D68): they stay. */
  deactivate(personId: string): Promise<void>;
  /** A connector's row, as an administrator's registration writes it: copied rows and mappings refer to it. */
  seedConnector(id: string): Promise<void>;
  /** The audit rows written about `subject`, oldest first. */
  auditFor(subject: string): Promise<Array<{ actor: string; action: string }>>;
  /** The ids of the workflow starts committed by this suite's store, each once. */
  enqueued(): Promise<string[]>;
  /** A position as a `position:` group writes it (D108 item 5). */
  seedPosition(position: PositionRecord): Promise<void>;
  /** The person holds the position, as their `position:` membership derives it. */
  holdPosition(personId: string, positionId: string): Promise<void>;
  /** A unit's row and, unless `pushed` is false, its `unit:` group with the unit above it (D99). */
  seedUnit(unit: Omit<UnitRecord, 'parentId'> & { parentId?: string | null; pushed?: boolean }): Promise<void>;
  /** The person is assigned to the unit. */
  place(personId: string, unitId: string): Promise<void>;
}
const T = '2026-11-10T08:00:00.000Z';
const T2 = '2026-11-10T09:00:00.000Z';
export const typeRow = (id: string, organisationId: string, extra: Partial<TypeRecord> = {}): TypeRecord => ({
  id,
  organisationId,
  name: 'Typ ' + id,
  area: 'Säkerhet',
  kind: 'certificate',
  validityMonths: null,
  archivedAt: null,
  createdBy: 'operator:test',
  createdAt: T,
  ...extra,
});
export const holdingRow = (
  id: string,
  personId: string,
  typeId: string,
  extra: Partial<HoldingRecord> = {},
): HoldingRecord => ({
  id,
  personId,
  typeId,
  issuedOn: '2025-01-15',
  expiresOn: null,
  evidence: 'manager',
  state: 'valid',
  registeredBy: null,
  createdAt: T,
  revokedAt: null,
  revokedBy: null,
  copy: null,
  decidedBy: null,
  decidedAt: null,
  threadId: null,
  ...extra,
});
/** A row copied from a source (D108 item 9): evidence `system`, nobody who registered it, the source's ids and label. */
export const copiedRow = (
  id: string,
  personId: string,
  typeId: string | null,
  copy: Partial<HoldingCopy> & Pick<HoldingCopy, 'connectorId' | 'sourceId'>,
  extra: Partial<HoldingRecord> = {},
): HoldingRecord => ({
  ...holdingRow(id, personId, typeId ?? '', { evidence: 'system' }),
  typeId,
  copy: { sourceType: 'course:1', sourceLabel: 'Brandskydd', readAt: T, ...copy },
  ...extra,
});
const blankSource = (connectorId: string, extra: Partial<SourceRecord> = {}): SourceRecord => ({
  connectorId,
  source: 'Lärplattformen',
  run: null,
  claimedAt: null,
  leaseUntil: null,
  startedAt: null,
  finishedAt: null,
  outcome: null,
  counts: null,
  ...extra,
});
const person = (id: string, organisationId: string, userName: string | null = 'u-' + id): PersonRef => ({
  id,
  organisationId,
  name: 'Name ' + id,
  userName,
});
const refused = async (run: () => Promise<unknown>) => {
  try {
    await run();
  } catch (error) {
    return error as Error;
  }
  return undefined;
};

export function competenceStoreContract(name: string, make: () => Promise<CompetenceStoreHarness>) {
  describe(`${name} competence store`, () => {
    /** An organisation with a manager and two employees. */
    async function world() {
      const h = await make();
      const p = h.prefix,
        org = p + '-org',
        [boss, anna, bo] = [p + '-boss', p + '-anna', p + '-bo'];
      for (const id of [boss, anna, bo]) await h.seedPerson(person(id, org));
      return { ...h, p, org, boss, anna, bo };
    }

    test('the catalogue is listed by area and name in Swedish order, archived types only when asked for', async () => {
      const w = await world();
      await w.store.transaction(async tx => {
        await tx.insertType(typeRow(w.p + '-t1', w.org, { name: 'Ögonskydd', area: 'Säkerhet' }));
        await tx.insertType(typeRow(w.p + '-t2', w.org, { name: 'Arbete på väg', area: 'Säkerhet' }));
        await tx.insertType(typeRow(w.p + '-t3', w.org, { name: 'HLR', area: 'Akut' }));
        await tx.insertType(typeRow(w.p + '-t4', w.org, { name: 'Äldre kurs', area: 'Akut', archivedAt: T2 }));
        await tx.insertType(typeRow(w.p + '-other', w.p + '-org2', { name: 'Annan organisation' }));
      });
      const names = async (archived?: boolean) =>
        (await w.store.transaction(tx => tx.types(w.org, archived === undefined ? undefined : { archived }))).map(
          t => t.name,
        );
      expect(await names()).toEqual(['HLR', 'Arbete på väg', 'Ögonskydd']);
      expect(await names(true)).toEqual(['HLR', 'Äldre kurs', 'Arbete på väg', 'Ögonskydd']);
      const one = await w.store.transaction(tx => tx.type(w.p + '-t3'));
      expect(one).toEqual(typeRow(w.p + '-t3', w.org, { name: 'HLR', area: 'Akut' }));
      expect(await w.store.transaction(tx => tx.type(w.p + '-none'))).toBeUndefined();
      const some = await w.store.transaction(tx => tx.typesById([w.p + '-t4', w.p + '-none', w.p + '-t1']));
      expect(some.map(t => t.id).sort()).toEqual([w.p + '-t1', w.p + '-t4']);
    });

    test('a name is taken once per organisation among the types that are not archived, without regard to case', async () => {
      const w = await world();
      await w.store.transaction(tx => tx.insertType(typeRow(w.p + '-t1', w.org, { name: 'Heta arbeten' })));
      const again = await refused(() =>
        w.store.transaction(tx => tx.insertType(typeRow(w.p + '-t2', w.org, { name: 'HETA ARBETEN' }))),
      );
      expect(again?.name).toBe('TypeNameTaken');
      // Another organisation may use the name, and so may this one once the first is archived.
      await w.store.transaction(tx => tx.insertType(typeRow(w.p + '-t3', w.p + '-org2', { name: 'Heta arbeten' })));
      await w.store.transaction(tx => tx.updateType(w.p + '-t1', { archivedAt: T2 }));
      await w.store.transaction(tx => tx.insertType(typeRow(w.p + '-t2', w.org, { name: 'Heta arbeten' })));
      // A change that would take a name in use is refused the same way and leaves the row as it was.
      await w.store.transaction(tx => tx.insertType(typeRow(w.p + '-t4', w.org, { name: 'Fallskydd' })));
      const renamed = await refused(() =>
        w.store.transaction(tx => tx.updateType(w.p + '-t4', { name: 'heta arbeten' })),
      );
      expect(renamed?.name).toBe('TypeNameTaken');
      expect((await w.store.transaction(tx => tx.type(w.p + '-t4')))?.name).toBe('Fallskydd');
    });

    test('a change of a type keeps what the patch does not name, and null removes the validity', async () => {
      const w = await world();
      await w.store.transaction(tx => tx.insertType(typeRow(w.p + '-t1', w.org, { name: 'HLR', validityMonths: 24 })));
      await w.store.transaction(tx => tx.updateType(w.p + '-t1', { area: 'Akut', kind: 'course' }));
      expect(await w.store.transaction(tx => tx.type(w.p + '-t1'))).toEqual(
        typeRow(w.p + '-t1', w.org, { name: 'HLR', area: 'Akut', kind: 'course', validityMonths: 24 }),
      );
      await w.store.transaction(tx => tx.updateType(w.p + '-t1', { validityMonths: null }));
      expect((await w.store.transaction(tx => tx.type(w.p + '-t1')))?.validityMonths).toBeNull();
      // An unknown id changes nothing and is no error.
      await w.store.transaction(tx => tx.updateType(w.p + '-none', { name: 'X' }));
    });

    test('holdings are read by person and by type, oldest first, whatever their state', async () => {
      const w = await world();
      await w.store.transaction(async tx => {
        await tx.insertType(typeRow(w.p + '-t1', w.org));
        await tx.insertType(typeRow(w.p + '-t2', w.org));
        await tx.insertHolding(
          holdingRow(w.p + '-h2', w.anna, w.p + '-t1', { createdAt: T2, expiresOn: '2027-01-15' }),
        );
        await tx.insertHolding(holdingRow(w.p + '-h1', w.anna, w.p + '-t2', { registeredBy: w.boss }));
        await tx.insertHolding(
          holdingRow(w.p + '-h3', w.bo, w.p + '-t1', { state: 'revoked', revokedAt: T2, revokedBy: w.boss }),
        );
      });
      const ofAnna = await w.store.transaction(tx => tx.holdingsOf([w.anna]));
      expect(ofAnna).toEqual([
        holdingRow(w.p + '-h1', w.anna, w.p + '-t2', { registeredBy: w.boss }),
        holdingRow(w.p + '-h2', w.anna, w.p + '-t1', { createdAt: T2, expiresOn: '2027-01-15' }),
      ]);
      expect((await w.store.transaction(tx => tx.holdingsOf([w.anna, w.bo]))).map(h => h.id)).toEqual([
        w.p + '-h1',
        w.p + '-h3',
        w.p + '-h2',
      ]);
      expect(await w.store.transaction(tx => tx.holdingsOf([]))).toEqual([]);
      expect((await w.store.transaction(tx => tx.holdingsOfType(w.p + '-t1'))).map(h => h.id)).toEqual([
        w.p + '-h3',
        w.p + '-h2',
      ]);
      expect((await w.store.transaction(tx => tx.holding(w.p + '-h3')))?.state).toBe('revoked');
      expect(await w.store.transaction(tx => tx.holding(w.p + '-none'))).toBeUndefined();
    });

    test('a holding refers to its type and its person, and a revocation is a change of the row', async () => {
      const w = await world();
      await w.store.transaction(tx => tx.insertType(typeRow(w.p + '-t1', w.org)));
      expect(
        await refused(() =>
          w.store.transaction(tx => tx.insertHolding(holdingRow(w.p + '-h1', w.anna, w.p + '-none'))),
        ),
      ).toBeDefined();
      expect(
        await refused(() =>
          w.store.transaction(tx => tx.insertHolding(holdingRow(w.p + '-h1', w.p + '-nobody', w.p + '-t1'))),
        ),
      ).toBeDefined();
      await w.store.transaction(tx => tx.insertHolding(holdingRow(w.p + '-h1', w.anna, w.p + '-t1')));
      await w.store.transaction(tx =>
        tx.updateHolding(w.p + '-h1', { state: 'revoked', revokedAt: T2, revokedBy: w.boss }),
      );
      expect(await w.store.transaction(tx => tx.holding(w.p + '-h1'))).toEqual(
        holdingRow(w.p + '-h1', w.anna, w.p + '-t1', { state: 'revoked', revokedAt: T2, revokedBy: w.boss }),
      );
    });

    test('a transaction that throws leaves nothing behind, the audit row included', async () => {
      const w = await world();
      const subject = 'competence-type:' + w.p + '-t1';
      await refused(() =>
        w.store.transaction(async tx => {
          await tx.insertType(typeRow(w.p + '-t1', w.org));
          await tx.audit({ actor: 'operator:test', action: 'competence.type_added', subject, at: T });
          throw new Error('stop');
        }),
      );
      expect(await w.store.transaction(tx => tx.type(w.p + '-t1'))).toBeUndefined();
      expect(await w.auditFor(subject)).toEqual([]);
      await w.store.transaction(async tx => {
        await tx.insertType(typeRow(w.p + '-t1', w.org));
        await tx.audit({ actor: 'operator:test', action: 'competence.type_added', subject, at: T });
      });
      expect(await w.auditFor(subject)).toEqual([{ actor: 'operator:test', action: 'competence.type_added' }]);
    });

    test('the people the domain names: an unknown id is absent, a person without a user name has null', async () => {
      const w = await world();
      await w.seedPerson(person(w.p + '-cia', w.org, null));
      const found = await w.store.transaction(tx => tx.persons([w.anna, w.p + '-cia', w.p + '-nobody']));
      expect(found.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
        person(w.anna, w.org),
        person(w.p + '-cia', w.org, null),
      ]);
      expect(await w.store.transaction(tx => tx.persons([]))).toEqual([]);
    });

    test("erasure removes the person's holdings and their id from the holdings they registered or revoked", async () => {
      const w = await world();
      await w.store.transaction(async tx => {
        await tx.insertType(typeRow(w.p + '-t1', w.org));
        await tx.insertHolding(holdingRow(w.p + '-h1', w.anna, w.p + '-t1', { registeredBy: w.boss }));
        await tx.insertHolding(holdingRow(w.p + '-h2', w.anna, w.p + '-t1', { createdAt: T2 }));
        await tx.insertHolding(
          holdingRow(w.p + '-h3', w.bo, w.p + '-t1', {
            registeredBy: w.anna,
            state: 'revoked',
            revokedAt: T2,
            revokedBy: w.anna,
          }),
        );
        await tx.insertHolding(holdingRow(w.p + '-h4', w.bo, w.p + '-t1', { registeredBy: w.boss, createdAt: T2 }));
      });
      expect(await w.store.transaction(tx => tx.erasePerson(w.anna))).toEqual({
        holdings: 2,
        cleared: 1,
        requirements: 0,
        threadIds: [],
      });
      expect(await w.store.transaction(tx => tx.holdingsOf([w.anna]))).toEqual([]);
      expect(await w.store.transaction(tx => tx.holdingsOf([w.bo]))).toEqual([
        holdingRow(w.p + '-h3', w.bo, w.p + '-t1', {
          registeredBy: null,
          state: 'revoked',
          revokedAt: T2,
          revokedBy: null,
        }),
        holdingRow(w.p + '-h4', w.bo, w.p + '-t1', { registeredBy: w.boss, createdAt: T2 }),
      ]);
      // Erasing again finds nothing.
      expect(await w.store.transaction(tx => tx.erasePerson(w.anna))).toEqual({
        holdings: 0,
        cleared: 0,
        requirements: 0,
        threadIds: [],
      });
    });

    /** A person's own registration (D108 item 7) as Anna makes it: pending, evidence `self`, with an approval's key. */
    const own = (w: { p: string; anna: string }, id: string, typeId: string, extra: Partial<HoldingRecord> = {}) =>
      holdingRow(w.p + '-' + id, w.anna, w.p + '-' + typeId, {
        evidence: 'self',
        state: 'pending',
        registeredBy: w.anna,
        threadId: w.p + '-a-' + id,
        ...extra,
      });

    test("a person's own registration waits once per type, is decided with who and when, and is removed when taken back", async () => {
      const w = await world();
      await w.store.transaction(async tx => {
        await tx.insertType(typeRow(w.p + '-t1', w.org));
        await tx.insertType(typeRow(w.p + '-t2', w.org));
        await tx.insertHolding(own(w, 'h1', 't1'));
      });
      expect(await w.store.transaction(tx => tx.holding(w.p + '-h1'))).toEqual(own(w, 'h1', 't1'));
      // A second of the same type waiting for the same person is refused; another type, or another person, is not.
      const again = await refused(() => w.store.transaction(tx => tx.insertHolding(own(w, 'h2', 't1'))));
      expect(again?.name).toBe('PendingTaken');
      await w.store.transaction(tx => tx.insertHolding(own(w, 'h3', 't2')));
      await w.store.transaction(tx =>
        tx.insertHolding(own(w, 'h4', 't1', { personId: w.bo, registeredBy: w.bo, threadId: w.p + '-a-h4' })),
      );
      // Decided: who and when; then a new one of the same type may wait.
      await w.store.transaction(tx =>
        tx.updateHolding(w.p + '-h1', { state: 'valid', decidedBy: w.boss, decidedAt: T2 }),
      );
      expect(await w.store.transaction(tx => tx.holding(w.p + '-h1'))).toEqual(
        own(w, 'h1', 't1', { state: 'valid', decidedBy: w.boss, decidedAt: T2 }),
      );
      await w.store.transaction(tx => tx.insertHolding(own(w, 'h5', 't1')));
      await w.store.transaction(tx =>
        tx.updateHolding(w.p + '-h5', { state: 'rejected', decidedBy: w.boss, decidedAt: T2 }),
      );
      expect((await w.store.transaction(tx => tx.holding(w.p + '-h5')))?.state).toBe('rejected');
      // Taken back: the row goes. A copied row is never removed this way.
      await w.store.transaction(tx => tx.deleteHolding(w.p + '-h3'));
      expect(await w.store.transaction(tx => tx.holding(w.p + '-h3'))).toBeUndefined();
      expect((await w.store.transaction(tx => tx.holdingsOf([w.anna]))).map(h => h.id)).toEqual([
        w.p + '-h1',
        w.p + '-h5',
      ]);
    });

    test("only a person's own registration waits, is rejected or decided, or carries an approval's key", async () => {
      const w = await world();
      await w.store.transaction(tx => tx.insertType(typeRow(w.p + '-t1', w.org)));
      for (const row of [
        // A manager's registration never waits or is rejected, and is never decided.
        holdingRow(w.p + '-x1', w.anna, w.p + '-t1', { state: 'pending' }),
        holdingRow(w.p + '-x2', w.anna, w.p + '-t1', { state: 'rejected' }),
        holdingRow(w.p + '-x3', w.anna, w.p + '-t1', { decidedBy: w.boss, decidedAt: T2 }),
        holdingRow(w.p + '-x4', w.anna, w.p + '-t1', { threadId: w.p + '-a' }),
        // The person's own is decided exactly when it no longer waits, and a decider has a time.
        own(w, 'x5', 't1', { decidedBy: w.boss, decidedAt: T2 }),
        own(w, 'x6', 't1', { state: 'valid' }),
        own(w, 'x7', 't1', { state: 'rejected', decidedBy: w.boss }),
      ])
        expect(await refused(() => w.store.transaction(tx => tx.insertHolding(row)))).toBeDefined();
      expect(await w.store.transaction(tx => tx.holdingsOf([w.anna]))).toEqual([]);
      // A decision kept after its manager is gone (erasure nulls the decider) stands.
      await w.store.transaction(tx =>
        tx.insertHolding(own(w, 'h1', 't1', { state: 'valid', decidedBy: null, decidedAt: T2 })),
      );
      expect((await w.store.transaction(tx => tx.holding(w.p + '-h1')))?.decidedAt).toBe(T2);
    });

    test("erasure takes a person's own registrations with their approval keys, and their id off what they decided", async () => {
      const w = await world();
      await w.store.transaction(async tx => {
        await tx.insertType(typeRow(w.p + '-t1', w.org));
        await tx.insertType(typeRow(w.p + '-t2', w.org));
        await tx.insertHolding(own(w, 'h1', 't1'));
        await tx.insertHolding(own(w, 'h2', 't2', { state: 'valid', decidedBy: w.boss, decidedAt: T2 }));
        await tx.insertHolding(
          own(w, 'h3', 't1', {
            personId: w.bo,
            registeredBy: w.bo,
            threadId: w.p + '-a-h3',
            state: 'rejected',
            decidedBy: w.anna,
            decidedAt: T2,
          }),
        );
      });
      expect(await w.store.transaction(tx => tx.erasePerson(w.anna))).toEqual({
        holdings: 2,
        cleared: 1,
        requirements: 0,
        threadIds: [w.p + '-a-h1', w.p + '-a-h2'],
      });
      expect(await w.store.transaction(tx => tx.holding(w.p + '-h3'))).toMatchObject({
        state: 'rejected',
        decidedBy: null,
        decidedAt: T2,
      });
    });

    test('the export is one organisation: every type, archived included, and every holding of them', async () => {
      const w = await world();
      await w.seedPerson(person(w.p + '-dan', w.p + '-org2'));
      await w.store.transaction(async tx => {
        await tx.insertType(typeRow(w.p + '-t1', w.org));
        await tx.insertType(typeRow(w.p + '-t2', w.org, { createdAt: T2, archivedAt: T2 }));
        await tx.insertType(typeRow(w.p + '-t9', w.p + '-org2'));
        await tx.insertHolding(holdingRow(w.p + '-h1', w.anna, w.p + '-t2'));
        await tx.insertHolding(
          holdingRow(w.p + '-h2', w.bo, w.p + '-t1', { createdAt: T2, state: 'revoked', revokedAt: T2 }),
        );
        await tx.insertHolding(holdingRow(w.p + '-h9', w.p + '-dan', w.p + '-t9'));
      });
      const exported = await w.store.transaction(tx => tx.exportOrganisation(w.org));
      expect(exported.types.map(t => t.id)).toEqual([w.p + '-t1', w.p + '-t2']);
      expect(exported.holdings.map(h => h.id)).toEqual([w.p + '-h1', w.p + '-h2']);
      expect(await w.store.transaction(tx => tx.exportOrganisation(w.p + '-empty'))).toEqual({
        types: [],
        holdings: [],
        mappings: [],
        requirements: [],
        shareTargets: [],
      });
    });

    describe('rows copied from a source (D108 item 9)', () => {
      const T3 = '2026-11-11T04:00:00.000Z';
      /** The world, a catalogue type and a connector whose rows the suite copies. */
      /** A connector and its source's row, which a copied row refers to (the copy writes it before any row). */
      async function sourced(h: CompetenceStoreHarness, id: string) {
        await h.seedConnector(id);
        await h.store.transaction(tx => tx.putSource(blankSource(id)));
      }
      async function copying({ source = true } = {}) {
        const w = await world();
        const lms = w.p + '-lms';
        if (source) await sourced(w, lms);
        else await w.seedConnector(lms);
        await w.store.transaction(tx => tx.insertType(typeRow(w.p + '-t1', w.org)));
        return { ...w, lms };
      }

      test('a copied row is written and replaced by its id, read by its connector, and may wait for its type', async () => {
        const w = await copying();
        const mapped = copiedRow(w.p + '-c1', w.anna, w.p + '-t1', { connectorId: w.lms, sourceId: 'course:1:user:1' });
        const waiting = copiedRow(w.p + '-c2', w.bo, null, {
          connectorId: w.lms,
          sourceId: 'badge:4:user:2',
          sourceType: 'badge:4',
          sourceLabel: 'HLR-instruktör',
        });
        await w.store.transaction(async tx => {
          await tx.putCopied([mapped, waiting]);
          await tx.insertHolding(holdingRow(w.p + '-h1', w.anna, w.p + '-t1'));
        });
        expect(await w.store.transaction(tx => tx.copiedFrom(w.lms))).toEqual([mapped, waiting]);
        expect(await w.store.transaction(tx => tx.copiedFrom(w.p + '-other'))).toEqual([]);
        // Replaced by its id: the person, the type, the dates, the state and the source's words may change.
        const changed = {
          ...waiting,
          typeId: w.p + '-t1',
          expiresOn: '2027-01-15',
          state: 'revoked' as const,
          revokedAt: T3,
        };
        await w.store.transaction(tx =>
          tx.putCopied([{ ...changed, copy: { ...changed.copy!, sourceLabel: 'HLR-instr.' } }]),
        );
        expect(await w.store.transaction(tx => tx.holding(w.p + '-c2'))).toEqual({
          ...changed,
          copy: { ...changed.copy!, sourceLabel: 'HLR-instr.' },
        });
        // Read with the person's holdings too, registered and copied alike.
        expect((await w.store.transaction(tx => tx.holdingsOf([w.anna]))).map(h => h.id).sort()).toEqual(
          [w.p + '-c1', w.p + '-h1'].sort(),
        );
      });

      test("a copied row refers to its source's row", async () => {
        const w = await copying();
        const unread = w.p + '-hr';
        await w.seedConnector(unread);
        expect(
          await refused(() =>
            w.store.transaction(tx =>
              tx.putCopied([copiedRow(w.p + '-c1', w.anna, null, { connectorId: unread, sourceId: 's1' })]),
            ),
          ),
        ).toBeDefined();
      });

      test('one source row is copied once, and only a copied row may lack a type', async () => {
        const w = await copying();
        await w.store.transaction(tx =>
          tx.putCopied([copiedRow(w.p + '-c1', w.anna, null, { connectorId: w.lms, sourceId: 's1' })]),
        );
        expect(
          await refused(() =>
            w.store.transaction(tx =>
              tx.putCopied([copiedRow(w.p + '-c9', w.bo, null, { connectorId: w.lms, sourceId: 's1' })]),
            ),
          ),
        ).toBeDefined();
        expect(
          await refused(() =>
            w.store.transaction(tx =>
              tx.insertHolding({ ...holdingRow(w.p + '-h1', w.anna, w.p + '-t1'), typeId: null }),
            ),
          ),
        ).toBeDefined();
        expect((await w.store.transaction(tx => tx.copiedFrom(w.lms))).map(h => h.id)).toEqual([w.p + '-c1']);
      });

      test('a repeated read moves only the time it was read', async () => {
        const w = await copying();
        const row = copiedRow(w.p + '-c1', w.anna, w.p + '-t1', { connectorId: w.lms, sourceId: 's1' });
        const other = copiedRow(w.p + '-c2', w.bo, w.p + '-t1', { connectorId: w.lms, sourceId: 's2' });
        await w.store.transaction(tx => tx.putCopied([row, other]));
        await w.store.transaction(tx => tx.touchCopied(w.lms, ['s1', 'unknown'], T3));
        expect(await w.store.transaction(tx => tx.copiedFrom(w.lms))).toEqual([
          { ...row, copy: { ...row.copy!, readAt: T3 } },
          other,
        ]);
        await w.store.transaction(tx => tx.touchCopied(w.lms, [], T3));
      });

      test("a mapping re-types the organisation's copied rows of one source type, whatever their state", async () => {
        const w = await copying();
        await w.seedPerson(person(w.p + '-dan', w.p + '-org2'));
        await w.store.transaction(tx =>
          tx.putCopied([
            copiedRow(w.p + '-c1', w.anna, null, { connectorId: w.lms, sourceId: 's1' }),
            copiedRow(
              w.p + '-c2',
              w.bo,
              null,
              { connectorId: w.lms, sourceId: 's2' },
              { state: 'revoked', revokedAt: T2 },
            ),
            copiedRow(w.p + '-c3', w.bo, null, { connectorId: w.lms, sourceId: 's3', sourceType: 'course:2' }),
            copiedRow(w.p + '-c4', w.p + '-dan', null, { connectorId: w.lms, sourceId: 's4' }),
          ]),
        );
        expect(await w.store.transaction(tx => tx.retypeCopied(w.lms, w.org, 'course:1', w.p + '-t1'))).toBe(2);
        const typed = async () =>
          Object.fromEntries((await w.store.transaction(tx => tx.copiedFrom(w.lms))).map(h => [h.id, h.typeId]));
        expect(await typed()).toEqual({
          [w.p + '-c1']: w.p + '-t1',
          [w.p + '-c2']: w.p + '-t1',
          [w.p + '-c3']: null,
          [w.p + '-c4']: null,
        });
        expect(await w.store.transaction(tx => tx.retypeCopied(w.lms, w.org, 'course:1', null))).toBe(2);
        expect((await typed())[w.p + '-c1']).toBeNull();
      });

      test("a source's types count the organisation's active people's rows that are not revoked, with the label read last", async () => {
        const w = await copying();
        await w.seedPerson(person(w.p + '-cia', w.org));
        await w.seedPerson(person(w.p + '-dan', w.p + '-org2'));
        await w.store.transaction(tx =>
          tx.putCopied([
            copiedRow(w.p + '-c1', w.anna, null, { connectorId: w.lms, sourceId: 's1', sourceLabel: 'Brandskydd' }),
            copiedRow(w.p + '-c2', w.bo, null, {
              connectorId: w.lms,
              sourceId: 's2',
              sourceLabel: 'Brandskydd, grund',
              readAt: T3,
            }),
            copiedRow(
              w.p + '-c3',
              w.bo,
              null,
              { connectorId: w.lms, sourceId: 's3' },
              { state: 'revoked', revokedAt: T2 },
            ),
            copiedRow(w.p + '-c4', w.p + '-cia', null, { connectorId: w.lms, sourceId: 's4' }),
            copiedRow(w.p + '-c5', w.p + '-dan', null, { connectorId: w.lms, sourceId: 's5' }),
            copiedRow(w.p + '-c6', w.anna, w.p + '-t1', {
              connectorId: w.lms,
              sourceId: 's6',
              sourceType: 'badge:4',
              sourceLabel: 'HLR-instruktör',
            }),
          ]),
        );
        await w.deactivate(w.p + '-cia');
        expect(await w.store.transaction(tx => tx.sourceTypes(w.org))).toEqual([
          { connectorId: w.lms, sourceType: 'badge:4', label: 'HLR-instruktör', holdings: 1 },
          { connectorId: w.lms, sourceType: 'course:1', label: 'Brandskydd, grund', holdings: 2 },
        ]);
        expect(await w.store.transaction(tx => tx.sourceTypes(w.p + '-empty'))).toEqual([]);
      });

      test('a mapping is one per connector, organisation and source type; written again it is replaced', async () => {
        const w = await copying();
        await w.store.transaction(tx => tx.insertType(typeRow(w.p + '-t2', w.org)));
        const mapping = {
          connectorId: w.lms,
          organisationId: w.org,
          sourceType: 'course:1',
          typeId: w.p + '-t1',
          mappedBy: 'person:ada',
          mappedAt: T,
        };
        await w.store.transaction(async tx => {
          await tx.putMapping(mapping);
          await tx.putMapping({ ...mapping, sourceType: 'course:2' });
          await tx.putMapping({ ...mapping, organisationId: w.p + '-org2' });
        });
        await w.store.transaction(tx => tx.putMapping({ ...mapping, typeId: w.p + '-t2', mappedAt: T2 }));
        const ofOrg = await w.store.transaction(tx => tx.mappings(w.org));
        expect(ofOrg.sort((a, b) => a.sourceType.localeCompare(b.sourceType))).toEqual([
          { ...mapping, typeId: w.p + '-t2', mappedAt: T2 },
          { ...mapping, sourceType: 'course:2' },
        ]);
        expect(await w.store.transaction(tx => tx.mappings(w.org, w.p + '-other'))).toEqual([]);
        expect(await w.store.transaction(tx => tx.mappingsOf(w.lms))).toHaveLength(3);
        expect(await w.store.transaction(tx => tx.removeMapping(w.lms, w.org, 'course:2'))).toBe(true);
        expect(await w.store.transaction(tx => tx.removeMapping(w.lms, w.org, 'course:2'))).toBe(false);
        expect(await w.store.transaction(tx => tx.mappings(w.org, w.lms))).toHaveLength(1);
      });

      test("a source's record holds its lease and its last read, and is replaced as a whole", async () => {
        const w = await copying({ source: false });
        expect(await w.store.transaction(tx => tx.source(w.lms))).toBeUndefined();
        const claimed = blankSource(w.lms, { run: 'r1', claimedAt: T, leaseUntil: T2 });
        await w.store.transaction(tx => tx.putSource(claimed));
        expect(await w.store.transaction(tx => tx.source(w.lms))).toEqual(claimed);
        const total = { read: 3, stored: 2, unchanged: 1, invalid: 0, unmapped: 1, revoked: 0, outside: 1, removed: 0 };
        const counts = { unmatched: 1, total, organisations: { [w.org]: { ...total, read: 2 } } };
        const done = blankSource(w.lms, { startedAt: T, finishedAt: T2, outcome: 'complete', counts });
        await w.store.transaction(tx => tx.putSource(done));
        expect((await w.store.transaction(tx => tx.sources())).filter(s => s.connectorId === w.lms)).toEqual([done]);
      });

      test("a connector's copied rows are listed by person and deleted by id, and only its own", async () => {
        const w = await copying();
        const other = w.p + '-hr';
        await sourced(w, other);
        await w.store.transaction(tx =>
          tx.putCopied([
            copiedRow(w.p + '-c1', w.anna, null, { connectorId: w.lms, sourceId: 's1' }),
            copiedRow(w.p + '-c2', w.anna, null, { connectorId: w.lms, sourceId: 's2' }),
            copiedRow(w.p + '-c3', w.bo, null, { connectorId: w.lms, sourceId: 's3' }),
            copiedRow(w.p + '-c4', w.bo, null, { connectorId: other, sourceId: 's1' }),
          ]),
        );
        expect((await w.store.transaction(tx => tx.copiedPeople(w.lms))).sort()).toEqual([w.anna, w.bo].sort());
        expect(await w.store.transaction(tx => tx.copiedPeople(w.p + '-none'))).toEqual([]);
        // Another connector's row is not deleted by this one's id list.
        expect(
          await w.store.transaction(tx => tx.removeCopied(w.lms, [w.p + '-c1', w.p + '-c2', w.p + '-c4', w.p + '-x'])),
        ).toBe(2);
        expect((await w.store.transaction(tx => tx.copiedFrom(w.lms))).map(h => h.id)).toEqual([w.p + '-c3']);
        expect((await w.store.transaction(tx => tx.copiedFrom(other))).map(h => h.id)).toEqual([w.p + '-c4']);
        expect(await w.store.transaction(tx => tx.removeCopied(w.lms, []))).toBe(0);
      });

      test('the people not deactivated are told from the rest', async () => {
        const w = await copying();
        await w.deactivate(w.bo);
        const active = await w.store.transaction(tx => tx.activeIds([w.anna, w.bo, w.p + '-nobody', w.anna]));
        expect([...active]).toEqual([w.anna]);
        expect([...(await w.store.transaction(tx => tx.activeIds([])))]).toEqual([]);
      });

      test('forgetting a source removes its copied rows, its mappings and its record, and nothing else', async () => {
        const w = await copying();
        const other = w.p + '-hr';
        await sourced(w, other);
        await w.store.transaction(async tx => {
          await tx.putCopied([
            copiedRow(w.p + '-c1', w.anna, w.p + '-t1', { connectorId: w.lms, sourceId: 's1' }),
            copiedRow(w.p + '-c2', w.bo, null, { connectorId: w.lms, sourceId: 's2' }),
            copiedRow(w.p + '-c3', w.bo, null, { connectorId: other, sourceId: 's1' }),
          ]);
          await tx.insertHolding(holdingRow(w.p + '-h1', w.anna, w.p + '-t1'));
          const mapping = {
            organisationId: w.org,
            sourceType: 'course:1',
            typeId: w.p + '-t1',
            mappedBy: 'x',
            mappedAt: T,
          };
          await tx.putMapping({ connectorId: w.lms, ...mapping });
          await tx.putMapping({ connectorId: other, ...mapping });
          await tx.putSource(blankSource(w.lms));
        });
        expect(await w.store.transaction(tx => tx.forgetSource(w.lms))).toEqual({ holdings: 2, mappings: 1 });
        expect(await w.store.transaction(tx => tx.copiedFrom(w.lms))).toEqual([]);
        expect(await w.store.transaction(tx => tx.source(w.lms))).toBeUndefined();
        expect((await w.store.transaction(tx => tx.copiedFrom(other))).map(h => h.id)).toEqual([w.p + '-c3']);
        expect(await w.store.transaction(tx => tx.mappingsOf(other))).toHaveLength(1);
        expect((await w.store.transaction(tx => tx.holdingsOf([w.anna]))).map(h => h.id)).toEqual([w.p + '-h1']);
        expect(await w.store.transaction(tx => tx.forgetSource(w.lms))).toEqual({ holdings: 0, mappings: 0 });
      });

      test('the active people are found by user name without regard to case', async () => {
        const w = await copying();
        await w.seedPerson(person(w.p + '-cia', w.org, 'Cia.' + w.p));
        await w.seedPerson(person(w.p + '-eve', w.org, null));
        await w.deactivate(w.bo);
        const found = await w.store.transaction(tx =>
          tx.activeByUserName(['U-' + w.anna.toUpperCase(), 'cia.' + w.p, 'u-' + w.bo, 'nobody']),
        );
        expect(found.map(p => p.id).sort()).toEqual([w.anna, w.p + '-cia'].sort());
        expect(await w.store.transaction(tx => tx.activeByUserName([]))).toEqual([]);
      });

      test('erasure takes copied rows with the person, and the export carries copied rows and mappings', async () => {
        const w = await copying();
        await w.store.transaction(async tx => {
          await tx.putCopied([
            copiedRow(w.p + '-c1', w.anna, null, { connectorId: w.lms, sourceId: 's1' }),
            copiedRow(w.p + '-c2', w.bo, w.p + '-t1', { connectorId: w.lms, sourceId: 's2' }, { createdAt: T2 }),
          ]);
          await tx.putMapping({
            connectorId: w.lms,
            organisationId: w.org,
            sourceType: 'course:1',
            typeId: w.p + '-t1',
            mappedBy: 'x',
            mappedAt: T,
          });
        });
        const exported = await w.store.transaction(tx => tx.exportOrganisation(w.org));
        expect(exported.holdings.map(h => [h.id, h.copy?.sourceId ?? null])).toEqual([
          [w.p + '-c1', 's1'],
          [w.p + '-c2', 's2'],
        ]);
        expect(exported.mappings.map(m => m.sourceType)).toEqual(['course:1']);
        expect(await w.store.transaction(tx => tx.erasePerson(w.anna))).toEqual({
          holdings: 1,
          cleared: 0,
          requirements: 0,
          threadIds: [],
        });
        expect((await w.store.transaction(tx => tx.copiedFrom(w.lms))).map(h => h.id)).toEqual([w.p + '-c2']);
      });

      test('a workflow start commits with its transaction, once per id, and goes when it rolls back', async () => {
        const w = await copying();
        const start = (id: string) => ({ workflow: 'competenceCopy', id, input: { run: id, dueAt: T } });
        await w.store.transaction(async tx => {
          await tx.enqueue(start(w.p + '-day1'));
          await tx.enqueue(start(w.p + '-day1'));
        });
        await w.store.transaction(tx => tx.enqueue(start(w.p + '-day1')));
        await refused(() =>
          w.store.transaction(async tx => {
            await tx.enqueue(start(w.p + '-gone'));
            throw new Error('stop');
          }),
        );
        expect((await w.enqueued()).filter(id => id.startsWith(w.p))).toEqual([w.p + '-day1']);
      });
    });

    describe('requirements and share targets (D108 item 6)', () => {
      /**
       * The world with two positions (and one of another organisation under the same code), a tree of a root and two
       * units under it, a unit no group names, a type, and the people placed: Anna on A holding the first position, Bo
       * on B holding both, the manager on the root, a deactivated person on A, and a person of another organisation.
       */
      async function organised() {
        const w = await world();
        const pos = (id: string, label: string, organisationId = w.org): PositionRecord => ({
          id: w.p + '-' + id,
          organisationId,
          code: id,
          label,
        });
        const [usk, ssk, other] = [
          pos('usk', 'Undersköterska'),
          pos('ssk', 'Sjuksköterska'),
          pos('usk', 'Undersköterska', w.p + '-org2'),
        ];
        other.id = w.p + '-usk2';
        for (const p of [usk, ssk, other]) await w.seedPosition(p);
        const unit = (id: string, label: string, parentId: string | null, pushed = true) => ({
          id: w.p + '-' + id,
          organisationId: w.org,
          label,
          parentId: parentId === null ? null : w.p + '-' + parentId,
          pushed,
        });
        const [root, a, b, alone] = [
          unit('root', 'Äldreomsorg', null),
          unit('a', 'Hemtjänst A', 'root'),
          unit('b', 'Hemtjänst B', 'root'),
          unit('alone', 'Bemanning', null, false),
        ];
        for (const u of [root, a, b, alone]) await w.seedUnit(u);
        const [cia, eve] = [w.p + '-cia', w.p + '-eve'];
        await w.seedPerson(person(cia, w.org));
        await w.seedPerson(person(eve, w.p + '-org2'));
        await w.place(w.anna, a.id);
        await w.place(w.bo, b.id);
        await w.place(w.boss, root.id);
        await w.place(cia, a.id);
        await w.place(eve, a.id);
        await w.deactivate(cia);
        await w.holdPosition(w.anna, usk.id);
        await w.holdPosition(w.bo, usk.id);
        await w.holdPosition(w.bo, ssk.id);
        await w.holdPosition(eve, other.id);
        await w.store.transaction(async tx => {
          await tx.insertType(typeRow(w.p + '-t1', w.org));
          await tx.insertType(typeRow(w.p + '-t2', w.org, { name: 'Typ två' }));
        });
        return { ...w, usk, ssk, other, root, a, b, alone, cia, eve };
      }
      const requirementRow = (
        id: string,
        organisationId: string,
        typeId: string,
        target: Partial<Pick<RequirementRecord, 'positionCode' | 'unitId' | 'personId'>>,
        extra: Partial<RequirementRecord> = {},
      ): RequirementRecord => ({
        id,
        organisationId,
        typeId,
        positionCode: null,
        unitId: null,
        personId: null,
        minLevel: null,
        createdBy: 'person:ada',
        createdAt: T,
        ...target,
        ...extra,
      });
      const targetRow = (
        id: string,
        organisationId: string,
        typeId: string,
        positionCode: string,
        extra: Partial<ShareTargetRecord> = {},
      ): ShareTargetRecord => ({
        id,
        organisationId,
        typeId,
        positionCode,
        unitId: null,
        minShare: 30,
        createdBy: 'person:ada',
        createdAt: T,
        ...extra,
      });

      test('the directory as requirements read it: positions, the tree by name, who is placed and holds what, per organisation', async () => {
        const w = await organised();
        expect(await w.store.transaction(tx => tx.positions(w.org))).toEqual([w.ssk, w.usk]);
        // The tree is the pushed groups, a node nobody is placed on included; a unit no group names is not in it.
        const node = (u: typeof w.a) => ({ id: u.id, organisationId: w.org, label: u.label, parentId: u.parentId });
        expect(await w.store.transaction(tx => tx.units(w.org))).toEqual([node(w.a), node(w.b), node(w.root)]);
        expect(await w.store.transaction(tx => tx.units(w.p + '-org2'))).toEqual([]);
        // The active people of the organisation placed on any of the units, each once: the deactivated one is not, and
        // neither is a person of another organisation placed on the same unit id.
        expect(await w.store.transaction(tx => tx.placedOn(w.org, [w.a.id, w.b.id, w.a.id]))).toEqual(
          [w.anna, w.bo].sort(),
        );
        expect(await w.store.transaction(tx => tx.placedOn(w.p + '-org2', [w.a.id]))).toEqual([w.eve]);
        expect(await w.store.transaction(tx => tx.placedOn(w.org, []))).toEqual([]);
        const places = await w.store.transaction(tx =>
          tx.placesOf(w.org, [w.bo, w.anna, w.p + '-nobody', w.boss, w.eve]),
        );
        expect(places.sort((x, y) => x.personId.localeCompare(y.personId))).toEqual(
          [
            { personId: w.anna, unitIds: [w.a.id], positionCodes: ['usk'] },
            { personId: w.bo, unitIds: [w.b.id], positionCodes: ['ssk', 'usk'] },
            { personId: w.boss, unitIds: [w.root.id], positionCodes: [] },
          ].sort((x, y) => x.personId.localeCompare(y.personId)),
        );
        // Who holds a position, by code: the active people of the organisation, never another's under the same code.
        expect(await w.store.transaction(tx => tx.positionHolders(w.org, ['usk', 'none']))).toEqual(
          [
            { personId: w.anna, code: 'usk' },
            { personId: w.bo, code: 'usk' },
          ].sort((x, y) => x.personId.localeCompare(y.personId)),
        );
        expect(await w.store.transaction(tx => tx.positionHolders(w.org, []))).toEqual([]);
      });

      test('a requirement names one of a position by code, a unit by id or a person, once per type and target, oldest first', async () => {
        const w = await organised();
        const onPosition = requirementRow(w.p + '-r1', w.org, w.p + '-t1', { positionCode: 'usk' });
        const onUnit = requirementRow(w.p + '-r2', w.org, w.p + '-t1', { unitId: w.a.id }, { createdAt: T2 });
        const onPerson = requirementRow(w.p + '-r3', w.org, w.p + '-t1', { personId: w.anna }, { minLevel: 2 });
        await w.store.transaction(async tx => {
          await tx.insertRequirement(onPosition);
          await tx.insertRequirement(onUnit);
          await tx.insertRequirement(onPerson);
        });
        expect(await w.store.transaction(tx => tx.requirements(w.org))).toEqual([onPosition, onPerson, onUnit]);
        expect(await w.store.transaction(tx => tx.requirements(w.p + '-org2'))).toEqual([]);
        expect(await w.store.transaction(tx => tx.requirement(onPerson.id))).toEqual(onPerson);
        // The same type on the same target again is refused by name; another type on it, or the type elsewhere, is not.
        for (const again of [
          requirementRow(w.p + '-r4', w.org, w.p + '-t1', { positionCode: 'usk' }),
          requirementRow(w.p + '-r4', w.org, w.p + '-t1', { unitId: w.a.id }),
          requirementRow(w.p + '-r4', w.org, w.p + '-t1', { personId: w.anna }),
        ])
          expect((await refused(() => w.store.transaction(tx => tx.insertRequirement(again))))?.name).toBe(
            'RequirementTaken',
          );
        // A position and a unit are keys, not rows: a code or a unit nobody has yet is stored, and counts for nobody.
        await w.store.transaction(async tx => {
          await tx.insertRequirement(requirementRow(w.p + '-r5', w.org, w.p + '-t2', { positionCode: 'usk' }));
          await tx.insertRequirement(requirementRow(w.p + '-r6', w.org, w.p + '-t1', { positionCode: 'tolk' }));
          await tx.insertRequirement(requirementRow(w.p + '-r7', w.org, w.p + '-t1', { unitId: w.p + '-later' }));
        });
        // Exactly one target, a known type and person, and a level of 1 to 3.
        for (const wrong of [
          requirementRow(w.p + '-r8', w.org, w.p + '-t2', { positionCode: 'ssk', unitId: w.a.id }),
          requirementRow(w.p + '-r8', w.org, w.p + '-t2', {}),
          requirementRow(w.p + '-r8', w.org, w.p + '-t2', { personId: w.p + '-nobody' }),
          requirementRow(w.p + '-r8', w.org, w.p + '-none', { unitId: w.b.id }),
          requirementRow(w.p + '-r8', w.org, w.p + '-t2', { unitId: w.b.id }, { minLevel: 4 }),
        ])
          expect(await refused(() => w.store.transaction(tx => tx.insertRequirement(wrong)))).toBeDefined();
        expect(await w.store.transaction(tx => tx.requirements(w.org))).toHaveLength(6);
        expect(await w.store.transaction(tx => tx.removeRequirement(onUnit.id))).toBe(true);
        expect(await w.store.transaction(tx => tx.removeRequirement(onUnit.id))).toBe(false);
        expect(await w.store.transaction(tx => tx.requirement(onUnit.id))).toBeUndefined();
      });

      test('a share target is one per type, position and unit, or per type and position across the organisation', async () => {
        const w = await organised();
        const everywhere = targetRow(w.p + '-s1', w.org, w.p + '-t1', 'usk');
        const onA = targetRow(w.p + '-s2', w.org, w.p + '-t1', 'usk', { unitId: w.a.id, minShare: 50 });
        await w.store.transaction(async tx => {
          await tx.insertShareTarget(onA);
          await tx.insertShareTarget(everywhere);
        });
        expect(await w.store.transaction(tx => tx.shareTargets(w.org))).toEqual(
          [onA, everywhere].sort((x, y) => x.id.localeCompare(y.id)),
        );
        expect(await w.store.transaction(tx => tx.shareTarget(onA.id))).toEqual(onA);
        for (const again of [
          targetRow(w.p + '-s3', w.org, w.p + '-t1', 'usk', { minShare: 80 }),
          targetRow(w.p + '-s3', w.org, w.p + '-t1', 'usk', { unitId: w.a.id }),
        ])
          expect((await refused(() => w.store.transaction(tx => tx.insertShareTarget(again))))?.name).toBe(
            'ShareTargetTaken',
          );
        await w.store.transaction(tx =>
          tx.insertShareTarget(targetRow(w.p + '-s4', w.org, w.p + '-t1', 'usk', { unitId: w.b.id })),
        );
        for (const wrong of [
          targetRow(w.p + '-s5', w.org, w.p + '-t2', 'usk', { minShare: 0 }),
          targetRow(w.p + '-s5', w.org, w.p + '-t2', 'usk', { minShare: 101 }),
          targetRow(w.p + '-s5', w.org, w.p + '-none', 'usk'),
        ])
          expect(await refused(() => w.store.transaction(tx => tx.insertShareTarget(wrong)))).toBeDefined();
        expect(await w.store.transaction(tx => tx.removeShareTarget(onA.id))).toBe(true);
        expect(await w.store.transaction(tx => tx.removeShareTarget(onA.id))).toBe(false);
        expect((await w.store.transaction(tx => tx.shareTargets(w.org))).map(t => t.id)).toEqual([
          everywhere.id,
          w.p + '-s4',
        ]);
      });

      test('erasure takes the requirements set on the person alone and their name off what they set; the export lists both', async () => {
        const w = await organised();
        const onAnna = requirementRow(w.p + '-r1', w.org, w.p + '-t1', { personId: w.anna });
        const onPosition = requirementRow(
          w.p + '-r2',
          w.org,
          w.p + '-t1',
          { positionCode: 'usk' },
          { createdAt: T2, createdBy: 'person:' + w.anna },
        );
        const target = targetRow(w.p + '-s1', w.org, w.p + '-t1', 'usk', { createdBy: 'person:' + w.anna });
        await w.store.transaction(async tx => {
          await tx.insertRequirement(onAnna);
          await tx.insertRequirement(onPosition);
          await tx.insertRequirement(requirementRow(w.p + '-r3', w.org, w.p + '-t2', { personId: w.bo }));
          await tx.insertShareTarget(target);
        });
        const exported = await w.store.transaction(tx => tx.exportOrganisation(w.org));
        expect(exported.requirements.map(r => r.id)).toEqual([w.p + '-r1', w.p + '-r3', w.p + '-r2']);
        expect(exported.shareTargets).toEqual([target]);
        expect(await w.store.transaction(tx => tx.erasePerson(w.anna))).toEqual({
          holdings: 0,
          cleared: 2,
          requirements: 1,
          threadIds: [],
        });
        expect(await w.store.transaction(tx => tx.requirements(w.org))).toEqual([
          requirementRow(w.p + '-r3', w.org, w.p + '-t2', { personId: w.bo }),
          { ...onPosition, createdBy: null },
        ]);
        expect(await w.store.transaction(tx => tx.shareTarget(target.id))).toEqual({ ...target, createdBy: null });
      });
    });
  });
}
