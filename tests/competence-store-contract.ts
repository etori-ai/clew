import { describe, expect, test } from 'bun:test';
import type {
  CompetenceStore,
  HoldingCopy,
  HoldingRecord,
  PersonRef,
  ErasureRecord,
  PositionRecord,
  ReadLogEntry,
  ReadLogQuery,
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
  /** The workflows the store cancelled after a commit (D86), in order. */
  cancelled(): Promise<string[]>;
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
  sourceUri: null,
  mergedInto: null,
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
  level: null,
  interest: false,
  validatedBy: null,
  validatedAt: null,
  ratedAt: null,
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

    test('an import inserts what may be inserted and leaves out what is taken, never refusing (D120 item 7)', async () => {
      const w = await world();
      const uri = (n: number) => `http://data.europa.eu/esco/skill/${w.p}-${n}`;
      const imported = [
        typeRow(w.p + '-i1', w.org, { name: 'leda ett team', kind: 'skill', sourceUri: uri(1) }),
        typeRow(w.p + '-i2', w.org, { name: 'använda kalkylprogram', kind: 'skill', sourceUri: uri(2) }),
      ];
      expect(await w.store.transaction(tx => tx.insertTypes(imported))).toEqual([w.p + '-i1', w.p + '-i2']);
      expect(await w.store.transaction(tx => tx.typesById(imported.map(t => t.id)))).toEqual(
        expect.arrayContaining(imported),
      );
      // An archived type keeps its address; a name in use is taken without regard to case; and a row of the batch takes
      // what a later one would have. Each is left out, the rest inserted.
      await w.store.transaction(tx => tx.updateType(w.p + '-i1', { archivedAt: T2 }));
      const inserted = await w.store.transaction(tx =>
        tx.insertTypes([
          typeRow(w.p + '-i3', w.org, { name: 'Ny', sourceUri: uri(3) }),
          typeRow(w.p + '-i4', w.org, { name: 'Teamledning', sourceUri: uri(1) }),
          typeRow(w.p + '-i5', w.org, { name: 'ANVÄNDA KALKYLPROGRAM' }),
          typeRow(w.p + '-i6', w.org, { name: 'Dubbel' }),
          typeRow(w.p + '-i7', w.org, { name: 'dubbel' }),
          typeRow(w.p + '-i8', w.org, { name: 'Tredje', sourceUri: uri(3) }),
        ]),
      );
      expect(inserted).toEqual([w.p + '-i3', w.p + '-i6']);
      expect(
        (await w.store.transaction(tx => tx.typesById([4, 5, 7, 8].map(i => `${w.p}-i${i}`)))).map(t => t.id),
      ).toEqual([]);
      // Another organisation keeps the same address; types without one are many; and the count is every type.
      await w.store.transaction(tx =>
        tx.insertTypes([
          typeRow(w.p + '-o1', w.p + '-org2', { name: 'leda ett team', sourceUri: uri(1) }),
          typeRow(w.p + '-n1', w.org, { name: 'Utan adress 1' }),
          typeRow(w.p + '-n2', w.org, { name: 'Utan adress 2' }),
        ]),
      );
      expect(await w.store.transaction(tx => tx.insertTypes([]))).toEqual([]);
      expect(await w.store.transaction(tx => tx.countTypes(w.org))).toBe(6);
      // The catalogue's lock is held for the transaction and asks nothing of the rows.
      await w.store.transaction(async tx => {
        await tx.lockCatalogue(w.org);
        await tx.lockCatalogue(w.org);
      });
    });

    test('a merge locks every source and the holdings of both types in order, and counts what each write did (D108 item 2)', async () => {
      const w = await world();
      const [c1, c2] = [w.p + '-src-b', w.p + '-src-a'];
      for (const c of [c1, c2]) await w.seedConnector(c);
      await w.store.transaction(async tx => {
        for (const c of [c1, c2]) await tx.putSource(blankSource(c));
        await tx.insertType(typeRow(w.p + '-t1', w.org, { name: 'Ett' }));
        await tx.insertType(typeRow(w.p + '-t2', w.org, { name: 'Två' }));
        await tx.insertType(typeRow(w.p + '-t3', w.org, { name: 'Tre' }));
        await tx.insertHolding(holdingRow(w.p + '-h2', w.anna, w.p + '-t2'));
        await tx.insertHolding(holdingRow(w.p + '-h1', w.bo, w.p + '-t1'));
        await tx.insertHolding(holdingRow(w.p + '-h3', w.anna, w.p + '-t3'));
        for (const [connectorId, sourceType] of [
          [c1, 'course:1'],
          [c2, 'course:2'],
        ] as const)
          await tx.putMapping({
            connectorId,
            organisationId: w.org,
            sourceType,
            typeId: w.p + '-t1',
            mappedBy: 'person:ada',
            mappedAt: T,
          });
      });
      await w.store.transaction(async tx => {
        expect((await tx.lockSources()).filter(id => id.startsWith(w.p))).toEqual([c2, c1]);
        const locked = await tx.lockHoldingsOfTypes([w.p + '-t2', w.p + '-t1']);
        expect(locked.map(h => h.id)).toEqual([w.p + '-h1', w.p + '-h2']);
        expect(await tx.retypeMappings(w.org, w.p + '-t1', w.p + '-t2')).toBe(2);
        expect(await tx.retypeMappings(w.org, w.p + '-t1', w.p + '-t2')).toBe(0);
        expect(await tx.updateHolding(w.p + '-h1', { interest: false })).toBe(true);
        expect(await tx.updateHolding(w.p + '-none', { state: 'revoked', revokedAt: T2, revokedBy: null })).toBe(false);
      });
      const mapped = await w.store.transaction(tx => tx.mappings(w.org));
      expect(mapped.map(m => [m.sourceType, m.typeId, m.mappedBy, m.mappedAt]).sort()).toEqual([
        ['course:1', w.p + '-t2', 'person:ada', T],
        ['course:2', w.p + '-t2', 'person:ada', T],
      ]);
    });

    test('a merged type is archived, refers to the type it went into, and is never merged into itself (D108 item 2)', async () => {
      const w = await world();
      await w.store.transaction(async tx => {
        await tx.insertType(typeRow(w.p + '-t1', w.org, { name: 'Truckkort' }));
        await tx.insertType(typeRow(w.p + '-t2', w.org, { name: 'Truckförarbevis' }));
      });
      for (const wrong of [
        { mergedInto: w.p + '-t2' },
        { mergedInto: w.p + '-t1', archivedAt: T2 },
        { mergedInto: w.p + '-none', archivedAt: T2 },
      ])
        expect(await refused(() => w.store.transaction(tx => tx.updateType(w.p + '-t1', wrong)))).toBeDefined();
      await w.store.transaction(tx => tx.updateType(w.p + '-t1', { archivedAt: T2, mergedInto: w.p + '-t2' }));
      expect(await w.store.transaction(tx => tx.type(w.p + '-t1'))).toEqual(
        typeRow(w.p + '-t1', w.org, { name: 'Truckkort', archivedAt: T2, mergedInto: w.p + '-t2' }),
      );
      const exported = await w.store.transaction(tx => tx.exportOrganisation(w.org));
      expect(exported.types.map(t => [t.id, t.mergedInto, t.sourceUri])).toEqual([
        [w.p + '-t1', w.p + '-t2', null],
        [w.p + '-t2', null, null],
      ]);
    });

    test('holdings are re-pointed to another type whatever their state; one pending and one skill per person and type still hold', async () => {
      const w = await world();
      await w.store.transaction(async tx => {
        await tx.insertType(typeRow(w.p + '-t1', w.org));
        await tx.insertType(typeRow(w.p + '-t2', w.org, { name: 'Typ två' }));
        await tx.insertType(typeRow(w.p + '-s1', w.org, { name: 'Färdighet ett', kind: 'skill' }));
        await tx.insertType(typeRow(w.p + '-s2', w.org, { name: 'Färdighet två', kind: 'skill' }));
        await tx.insertHolding(holdingRow(w.p + '-h1', w.anna, w.p + '-t1'));
        await tx.insertHolding(
          holdingRow(w.p + '-h2', w.anna, w.p + '-t1', { state: 'revoked', revokedAt: T2, revokedBy: w.boss }),
        );
        await tx.insertHolding(
          holdingRow(w.p + '-h3', w.bo, w.p + '-t1', {
            evidence: 'self',
            state: 'pending',
            registeredBy: w.bo,
            threadId: w.p + '-a1',
          }),
        );
        await tx.insertHolding(
          holdingRow(w.p + '-h4', w.bo, w.p + '-t2', {
            evidence: 'self',
            state: 'pending',
            registeredBy: w.bo,
            threadId: w.p + '-a2',
          }),
        );
        await tx.insertHolding(holdingRow(w.p + '-k1', w.anna, w.p + '-s1', { level: 2, ratedAt: T }));
        await tx.insertHolding(holdingRow(w.p + '-k2', w.anna, w.p + '-s2', { level: 1, ratedAt: T }));
      });
      expect(await w.store.transaction(tx => tx.retypeHoldings([w.p + '-h1', w.p + '-h2'], w.p + '-t2'))).toBe(2);
      expect((await w.store.transaction(tx => tx.holdingsOfType(w.p + '-t2'))).map(h => h.id).sort()).toEqual(
        [w.p + '-h1', w.p + '-h2', w.p + '-h4'].sort(),
      );
      // A second registration of a type waiting for the person, and a second skill that counts, are refused.
      expect(
        (await refused(() => w.store.transaction(tx => tx.retypeHoldings([w.p + '-h3'], w.p + '-t2'))))?.name,
      ).toBe('PendingTaken');
      expect(
        (await refused(() => w.store.transaction(tx => tx.retypeHoldings([w.p + '-k1'], w.p + '-s2'))))?.name,
      ).toBe('SkillTaken');
      // Set aside first, the skill moves; an unknown id is no row.
      await w.store.transaction(async tx => {
        await tx.updateHolding(w.p + '-k2', { state: 'revoked', revokedAt: T2, revokedBy: null });
        expect(await tx.retypeHoldings([w.p + '-k1', w.p + '-none'], w.p + '-s2')).toBe(1);
      });
      expect((await w.store.transaction(tx => tx.holding(w.p + '-k1')))?.typeId).toBe(w.p + '-s2');
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

    /** A skill (D120) as Anna rates it: a level, no end date, evidence `self`, valid at once and not yet confirmed. */
    const skill = (w: { p: string; anna: string }, id: string, typeId: string, extra: Partial<HoldingRecord> = {}) =>
      holdingRow(w.p + '-' + id, w.anna, w.p + '-' + typeId, {
        evidence: 'self',
        registeredBy: w.anna,
        level: 2,
        ratedAt: T,
        ...extra,
      });

    test('a skill keeps its level, interest and confirmation, and is changed as rated again and confirmed', async () => {
      const w = await world();
      await w.store.transaction(async tx => {
        await tx.insertType(typeRow(w.p + '-s1', w.org, { kind: 'skill' }));
        await tx.insertHolding(skill(w, 'h1', 's1', { interest: true }));
      });
      expect(await w.store.transaction(tx => tx.holding(w.p + '-h1'))).toEqual(
        skill(w, 'h1', 's1', { interest: true }),
      );
      // Her manager confirms it at another level.
      await w.store.transaction(tx =>
        tx.updateHolding(w.p + '-h1', { level: 3, validatedBy: w.boss, validatedAt: T2 }),
      );
      expect(await w.store.transaction(tx => tx.holding(w.p + '-h1'))).toEqual(
        skill(w, 'h1', 's1', { interest: true, level: 3, validatedBy: w.boss, validatedAt: T2 }),
      );
      // She rates it again at a new level: her own rating, from another day, the confirmation gone.
      await w.store.transaction(tx =>
        tx.updateHolding(w.p + '-h1', {
          level: 1,
          interest: false,
          evidence: 'self',
          registeredBy: w.anna,
          issuedOn: '2026-11-11',
          ratedAt: T2,
          validatedBy: null,
          validatedAt: null,
        }),
      );
      expect(await w.store.transaction(tx => tx.holding(w.p + '-h1'))).toEqual(
        skill(w, 'h1', 's1', { level: 1, issuedOn: '2026-11-11', ratedAt: T2 }),
      );
      // A manager's registration: evidence `manager`, confirmed by them.
      await w.store.transaction(tx =>
        tx.insertHolding(
          skill(w, 'h2', 's1', {
            personId: w.bo,
            evidence: 'manager',
            registeredBy: w.boss,
            validatedBy: w.boss,
            validatedAt: T2,
          }),
        ),
      );
      expect((await w.store.transaction(tx => tx.holding(w.p + '-h2')))?.validatedBy).toBe(w.boss);
    });

    test('one skill of a type counts per person: a second is SkillTaken, a revoked one stands aside', async () => {
      const w = await world();
      await w.store.transaction(async tx => {
        await tx.insertType(typeRow(w.p + '-s1', w.org, { kind: 'skill' }));
        await tx.insertType(typeRow(w.p + '-s2', w.org, { kind: 'skill' }));
        await tx.insertHolding(skill(w, 'h1', 's1'));
      });
      const again = await refused(() => w.store.transaction(tx => tx.insertHolding(skill(w, 'h2', 's1'))));
      expect(again?.name).toBe('SkillTaken');
      // Another type, or another person, is not the same skill.
      await w.store.transaction(tx => tx.insertHolding(skill(w, 'h3', 's2')));
      await w.store.transaction(tx => tx.insertHolding(skill(w, 'h4', 's1', { personId: w.bo, registeredBy: w.bo })));
      // Revoked, it stands aside for a new one, and cannot come back while that one counts.
      await w.store.transaction(tx =>
        tx.updateHolding(w.p + '-h1', { state: 'revoked', revokedAt: T2, revokedBy: w.boss }),
      );
      await w.store.transaction(tx => tx.insertHolding(skill(w, 'h5', 's1')));
      const back = await refused(() =>
        w.store.transaction(tx => tx.updateHolding(w.p + '-h1', { state: 'valid', revokedAt: null, revokedBy: null })),
      );
      expect(back?.name).toBe('SkillTaken');
      expect((await w.store.transaction(tx => tx.holdingsOf([w.anna]))).map(h => [h.id, h.state])).toEqual([
        [w.p + '-h1', 'revoked'],
        [w.p + '-h3', 'valid'],
        [w.p + '-h5', 'valid'],
      ]);
      // A certificate may still be held twice of one type: only a level makes a holding a skill.
      await w.store.transaction(async tx => {
        await tx.insertType(typeRow(w.p + '-t1', w.org));
        await tx.insertHolding(holdingRow(w.p + '-c1', w.anna, w.p + '-t1'));
        await tx.insertHolding(holdingRow(w.p + '-c2', w.anna, w.p + '-t1', { createdAt: T2 }));
      });
    });

    test('a skill has a level from 1 to 3, no end date, source or approval; only a skill is confirmed or marked', async () => {
      const w = await world();
      await w.store.transaction(async tx => {
        await tx.insertType(typeRow(w.p + '-s1', w.org, { kind: 'skill' }));
        await tx.insertType(typeRow(w.p + '-t1', w.org));
      });
      for (const row of [
        skill(w, 'x1', 's1', { level: 0 }),
        skill(w, 'x2', 's1', { level: 4 }),
        skill(w, 'x3', 's1', { expiresOn: '2030-01-01' }),
        skill(w, 'x4', 's1', { state: 'pending', threadId: w.p + '-a' }),
        skill(w, 'x5', 's1', { decidedBy: w.boss, decidedAt: T2 }),
        skill(w, 'x6', 's1', { evidence: 'system', registeredBy: null }),
        // A confirmer has a time; a certificate is never confirmed or marked.
        skill(w, 'x7', 's1', { validatedBy: w.boss }),
        holdingRow(w.p + '-x8', w.anna, w.p + '-t1', { validatedAt: T2 }),
        holdingRow(w.p + '-x9', w.anna, w.p + '-t1', { interest: true }),
        // A skill has when it was rated, and nothing else has one.
        skill(w, 'x10', 's1', { ratedAt: null }),
        holdingRow(w.p + '-x11', w.anna, w.p + '-t1', { ratedAt: T2 }),
      ])
        expect(await refused(() => w.store.transaction(tx => tx.insertHolding(row)))).toBeDefined();
      expect(await w.store.transaction(tx => tx.holdingsOf([w.anna]))).toEqual([]);
      // A confirmation kept after its manager is gone (erasure nulls who confirmed) stands.
      await w.store.transaction(tx => tx.insertHolding(skill(w, 'h1', 's1', { validatedAt: T2 })));
      expect((await w.store.transaction(tx => tx.holding(w.p + '-h1')))?.validatedAt).toBe(T2);
      // A skill revoked by a manager keeps its level.
      await w.store.transaction(tx =>
        tx.updateHolding(w.p + '-h1', { state: 'revoked', revokedAt: T2, revokedBy: w.boss }),
      );
      expect(await w.store.transaction(tx => tx.holding(w.p + '-h1'))).toMatchObject({ state: 'revoked', level: 2 });
    });

    test('erasure takes a person’s skills and their id off the skills they confirmed, keeping when; the export carries both', async () => {
      const w = await world();
      await w.store.transaction(async tx => {
        await tx.insertType(typeRow(w.p + '-s1', w.org, { kind: 'skill' }));
        await tx.insertHolding(skill(w, 'h1', 's1', { interest: true }));
        await tx.insertHolding(
          skill(w, 'h2', 's1', { personId: w.bo, registeredBy: w.bo, validatedBy: w.anna, validatedAt: T2 }),
        );
        await tx.insertRequirement({
          id: w.p + '-r1',
          organisationId: w.org,
          typeId: w.p + '-s1',
          positionCode: 'usk',
          unitId: null,
          personId: null,
          minLevel: 2,
          createdBy: 'operator:test',
          createdAt: T,
        });
      });
      const exported = await w.store.transaction(tx => tx.exportOrganisation(w.org));
      expect(exported.holdings).toEqual([
        skill(w, 'h1', 's1', { interest: true }),
        skill(w, 'h2', 's1', { personId: w.bo, registeredBy: w.bo, validatedBy: w.anna, validatedAt: T2 }),
      ]);
      expect(exported.requirements.map(r => r.minLevel)).toEqual([2]);
      expect(await w.store.transaction(tx => tx.erasePerson(w.anna))).toEqual({
        holdings: 1,
        cleared: 1,
        requirements: 0,
        threadIds: [],
      });
      expect(await w.store.transaction(tx => tx.holding(w.p + '-h2'))).toMatchObject({
        validatedBy: null,
        validatedAt: T2,
        level: 2,
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

      test('a merge re-points a requirement and a share target, or changes the stricter one kept (D108 item 2)', async () => {
        const w = await organised();
        const fromPosition = requirementRow(w.p + '-r1', w.org, w.p + '-t1', { positionCode: 'usk' });
        const intoPosition = requirementRow(w.p + '-r2', w.org, w.p + '-t2', { positionCode: 'usk' });
        const fromUnit = requirementRow(w.p + '-r3', w.org, w.p + '-t1', { unitId: w.a.id });
        const fromTarget = targetRow(w.p + '-s1', w.org, w.p + '-t1', 'usk', { minShare: 80 });
        const intoTarget = targetRow(w.p + '-s2', w.org, w.p + '-t2', 'usk', { minShare: 40 });
        await w.store.transaction(async tx => {
          for (const r of [fromPosition, intoPosition, fromUnit]) await tx.insertRequirement(r);
          for (const t of [fromTarget, intoTarget]) await tx.insertShareTarget(t);
        });
        // Re-pointed onto a target the other type already has: refused as an insert would be.
        expect(
          (
            await refused(() =>
              w.store.transaction(tx => tx.updateRequirement(fromPosition.id, { typeId: w.p + '-t2' })),
            )
          )?.name,
        ).toBe('RequirementTaken');
        expect(
          (await refused(() => w.store.transaction(tx => tx.updateShareTarget(fromTarget.id, { typeId: w.p + '-t2' }))))
            ?.name,
        ).toBe('ShareTargetTaken');
        await w.store.transaction(async tx => {
          await tx.updateRequirement(fromUnit.id, { typeId: w.p + '-t2' });
          await tx.updateRequirement(intoPosition.id, { minLevel: 2 });
          await tx.updateShareTarget(intoTarget.id, { minShare: 80 });
          // An unknown id changes nothing.
          await tx.updateRequirement(w.p + '-none', { typeId: w.p + '-t2' });
          await tx.updateShareTarget(w.p + '-none', { minShare: 10 });
        });
        // A write says whether there was a row to change.
        expect(await w.store.transaction(tx => tx.updateRequirement(w.p + '-none', { minLevel: 1 }))).toBe(false);
        expect(await w.store.transaction(tx => tx.updateShareTarget(w.p + '-none', { minShare: 10 }))).toBe(false);
        expect(await w.store.transaction(tx => tx.updateShareTarget(intoTarget.id, { minShare: 80 }))).toBe(true);
        expect(await w.store.transaction(tx => tx.requirement(fromUnit.id))).toEqual({
          ...fromUnit,
          typeId: w.p + '-t2',
        });
        expect(await w.store.transaction(tx => tx.requirement(intoPosition.id))).toEqual({
          ...intoPosition,
          minLevel: 2,
        });
        expect(await w.store.transaction(tx => tx.shareTarget(intoTarget.id))).toEqual({ ...intoTarget, minShare: 80 });
        for (const wrong of [
          () => w.store.transaction(tx => tx.updateRequirement(fromUnit.id, { minLevel: 4 })),
          () => w.store.transaction(tx => tx.updateRequirement(fromUnit.id, { typeId: w.p + '-none' })),
          () => w.store.transaction(tx => tx.updateShareTarget(intoTarget.id, { minShare: 0 })),
        ])
          expect(await refused(wrong)).toBeDefined();
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

    describe('Kompetenssökning and the read log (D121, D108 item 15)', () => {
      test('the type field finds the types that are not archived by every word in name or area, in Swedish order, at most the limit', async () => {
        const w = await world();
        await w.store.transaction(async tx => {
          await tx.insertType(typeRow(w.p + '-a', w.org, { name: 'Heta arbeten', area: 'Säkerhet' }));
          await tx.insertType(typeRow(w.p + '-b', w.org, { name: 'Arbete på väg', area: 'Säkerhet' }));
          await tx.insertType(typeRow(w.p + '-c', w.org, { name: 'Ögonskydd', area: 'Säkerhet' }));
          await tx.insertType(typeRow(w.p + '-d', w.org, { name: 'HLR', area: 'Akut omhändertagande' }));
          await tx.insertType(typeRow(w.p + '-e', w.org, { name: 'Äldre skydd', area: 'Säkerhet', archivedAt: T2 }));
          await tx.insertType(typeRow(w.p + '-f', w.p + '-org2', { name: 'Heta arbeten', area: 'Säkerhet' }));
          await tx.insertType(typeRow(w.p + '-g', w.org, { name: '100% närvaro', area: 'Övrigt' }));
        });
        const found = async (words: string[], limit = 10) =>
          (await w.store.transaction(tx => tx.findTypes(w.org, words, limit))).map(t => t.name);
        expect(await found([])).toEqual(['100% närvaro', 'Arbete på väg', 'Heta arbeten', 'HLR', 'Ögonskydd']);
        // The area counts as the name does; every word must be in one of them.
        expect(await found(['säkerhet'])).toEqual(['Arbete på väg', 'Heta arbeten', 'Ögonskydd']);
        expect(await found(['ARB', 'säk'])).toEqual(['Arbete på väg', 'Heta arbeten']);
        expect(await found(['akut', 'hlr'])).toEqual(['HLR']);
        // Å, ä and ö fold as other letters do, and a pattern's own characters are only characters.
        expect(await found(['ögon'])).toEqual(['Ögonskydd']);
        expect(await found(['%'])).toEqual(['100% närvaro']);
        expect(await found(['_'])).toEqual([]);
        expect(await found(['skydd'])).toEqual(['Ögonskydd']);
        expect(await found([], 2)).toEqual(['100% närvaro', 'Arbete på väg']);
        // A whole row, as the catalogue holds it.
        expect(await w.store.transaction(tx => tx.findTypes(w.org, ['hlr'], 5))).toEqual([
          typeRow(w.p + '-d', w.org, { name: 'HLR', area: 'Akut omhändertagande' }),
        ]);
      });

      test('the read log keeps a read as it is given and is read the newest first, narrowed by organisation, person, reader, relation, kind and time', async () => {
        const w = await world();
        const entry = (id: string, extra: Partial<ReadLogEntry> = {}): ReadLogEntry => ({
          id: w.p + '-' + id,
          organisationId: w.org,
          readerId: w.boss,
          relation: 'registrar',
          kind: 'search',
          typeId: w.p + '-t1',
          minLevel: null,
          unitId: null,
          personId: null,
          rows: 3,
          readAt: T,
          ...extra,
        });
        const search = entry('l1', { minLevel: 2, unitId: 'unit-a' }),
          opened = entry('l2', { kind: 'person', typeId: null, personId: w.anna, rows: 4, readAt: T2 }),
          // A manager's read of a report; a person's own reads are no longer logged, but a row from before stays.
          own = entry('l3', {
            kind: 'person',
            relation: 'managed',
            readerId: w.anna,
            typeId: null,
            personId: w.bo,
            readAt: T2,
          }),
          file = entry('l4', { kind: 'export', rows: 120, readAt: '2026-11-10T07:00:00.000Z' }),
          elsewhere = entry('l5', { organisationId: w.p + '-org2' }),
          // A manager's matrix as a file: an export by `managed` that names no type and nobody (D108 item 15).
          matrix = entry('l6', {
            kind: 'export',
            relation: 'managed',
            typeId: null,
            rows: 8,
            readAt: '2026-11-10T06:00:00.000Z',
          });
        await w.store.transaction(async tx => {
          for (const e of [search, opened, own, file, elsewhere, matrix]) await tx.logRead(e);
        });
        const read = (query: Partial<ReadLogQuery> = {}) =>
          w.store.transaction(tx => tx.readLog({ organisationId: w.org, limit: 10, ...query }));
        // The newest first, then by id; another organisation's row is not this one's.
        expect(await read()).toEqual([opened, own, search, file, matrix]);
        expect(await read({ personId: w.anna })).toEqual([opened]);
        expect(await read({ readerId: w.anna })).toEqual([own]);
        expect(await read({ relation: 'managed' })).toEqual([own, matrix]);
        expect(await read({ kind: 'export' })).toEqual([file, matrix]);
        expect(await read({ relation: 'registrar', kind: 'export' })).toEqual([file]);
        expect(await read({ since: T })).toEqual([opened, own, search]);
        expect(await read({ limit: 1 })).toEqual([opened]);
        // Erasure of a person (D108 item 14) leaves the reads of them and by them: who read is no holding of theirs.
        await w.store.transaction(tx => tx.erasePerson(w.anna));
        expect(await read({ personId: w.anna })).toEqual([opened]);
        expect(await read({ readerId: w.anna })).toEqual([own]);
      });

      test('the read log refuses a row its checks do not hold, and the read it records with it', async () => {
        const w = await world();
        const base: ReadLogEntry = {
          id: w.p + '-bad',
          organisationId: w.org,
          readerId: w.boss,
          relation: 'registrar',
          kind: 'search',
          typeId: w.p + '-t1',
          minLevel: null,
          unitId: null,
          personId: null,
          rows: 1,
          readAt: T,
        };
        for (const wrong of [
          // A person opened names whom and nothing of a search.
          { ...base, kind: 'person' as const },
          { ...base, kind: 'person' as const, personId: w.anna },
          // A search or a file names the type and nobody, and is a registrar's.
          { ...base, typeId: null },
          { ...base, personId: w.anna },
          { ...base, relation: 'managed' as const },
          { ...base, kind: 'export' as const, relation: 'self' as const },
          // A manager's export names no type, and nobody.
          { ...base, kind: 'export' as const, relation: 'managed' as const },
          { ...base, kind: 'export' as const, relation: 'managed' as const, typeId: null, unitId: 'unit-a' },
          { ...base, kind: 'search' as const, relation: 'managed' as const, typeId: null },
          { ...base, minLevel: 4 },
          { ...base, rows: -1 },
        ])
          expect(
            await refused(() =>
              w.store.transaction(async tx => {
                await tx.insertType(typeRow(w.p + '-t1', w.org));
                await tx.logRead(wrong);
              }),
            ),
          ).toBeDefined();
        // Each refusal took the transaction with it: nothing it wrote is there.
        expect(await w.store.transaction(tx => tx.type(w.p + '-t1'))).toBeUndefined();
        expect(await w.store.transaction(tx => tx.readLog({ organisationId: w.org, limit: 10 }))).toEqual([]);
      });
    });

    describe('erasure after a person leaves (D108 item 14)', () => {
      const intent = (personId: string, organisationId: string, extra: Partial<ErasureRecord> = {}): ErasureRecord => ({
        personId,
        organisationId,
        state: 'waiting',
        inactiveSince: T,
        dueAt: '2026-12-10T08:00:00.000Z',
        generation: 1,
        updatedAt: T,
        ...extra,
      });

      test('the retention period is one per organisation: written, replaced, read and removed, within 1 to 3650 days', async () => {
        const w = await world();
        expect(await w.store.transaction(tx => tx.retention(w.org))).toBeUndefined();
        await w.store.transaction(async tx => {
          await tx.lockRetention(w.org);
          await tx.putRetention({ organisationId: w.org, days: 30, setBy: 'operator:test', setAt: T });
          await tx.putRetention({ organisationId: w.p + '-org2', days: 7, setBy: 'operator:test', setAt: T });
        });
        await w.store.transaction(tx =>
          tx.putRetention({ organisationId: w.org, days: 90, setBy: 'operator:other', setAt: T2 }),
        );
        expect(await w.store.transaction(tx => tx.retention(w.org))).toEqual({
          organisationId: w.org,
          days: 90,
          setBy: 'operator:other',
          setAt: T2,
        });
        for (const days of [0, 3651])
          expect(
            await refused(() =>
              w.store.transaction(tx => tx.putRetention({ organisationId: w.org, days, setBy: 'x', setAt: T })),
            ),
          ).toBeDefined();
        expect((await w.store.transaction(tx => tx.retention(w.org)))?.days).toBe(90);
        expect(await w.store.transaction(tx => tx.removeRetention(w.org))).toBe(true);
        expect(await w.store.transaction(tx => tx.removeRetention(w.org))).toBe(false);
        expect(await w.store.transaction(tx => tx.retention(w.org))).toBeUndefined();
        expect((await w.store.transaction(tx => tx.retention(w.p + '-org2')))?.days).toBe(7);
        await w.store.transaction(tx => tx.removeRetention(w.p + '-org2'));
      });

      test('an erasure intent is one per person, replaced as a whole, read alone and by organisation in person order', async () => {
        const w = await world();
        const other = w.p + '-zed';
        await w.seedPerson(person(other, w.p + '-org2'));
        await w.store.transaction(async tx => {
          await tx.putErasure(intent(w.bo, w.org));
          await tx.putErasure(intent(w.anna, w.org, { state: 'held', dueAt: null, generation: 0 }));
          await tx.putErasure(intent(other, w.p + '-org2'));
        });
        expect(await w.store.transaction(tx => tx.erasure(w.anna))).toEqual(
          intent(w.anna, w.org, { state: 'held', dueAt: null, generation: 0 }),
        );
        expect(await w.store.transaction(tx => tx.erasure(w.boss))).toBeUndefined();
        for (const lock of [false, true])
          expect((await w.store.transaction(tx => tx.erasures(w.org, { lock }))).map(e => e.personId)).toEqual(
            [w.anna, w.bo].sort(),
          );
        const erased = intent(w.bo, w.org, { state: 'erased', dueAt: null, generation: 1, updatedAt: T2 });
        await w.store.transaction(tx => tx.putErasure(erased));
        expect(await w.store.transaction(tx => tx.erasure(w.bo))).toEqual(erased);
        // A cancelled or erased intent may forget when the person left; one that waits or holds may not.
        await w.store.transaction(tx =>
          tx.putErasure(intent(w.bo, w.org, { state: 'cancelled', dueAt: null, inactiveSince: null })),
        );
      });

      test('an erasure intent holds its checks: a due time exactly while waiting, a start while waiting or held, a person', async () => {
        const w = await world();
        for (const wrong of [
          intent(w.anna, w.org, { dueAt: null }),
          intent(w.anna, w.org, { state: 'held' }),
          intent(w.anna, w.org, { state: 'held', dueAt: null, inactiveSince: null }),
          intent(w.anna, w.org, { inactiveSince: null }),
          intent(w.anna, w.org, { generation: -1 }),
          intent(w.p + '-nobody', w.org),
        ])
          expect(await refused(() => w.store.transaction(tx => tx.putErasure(wrong)))).toBeDefined();
        expect(await w.store.transaction(tx => tx.erasure(w.anna))).toBeUndefined();
      });

      test('the people an organisation’s directory has deactivated are listed by id, and only theirs', async () => {
        const w = await world();
        const other = w.p + '-zed';
        await w.seedPerson(person(other, w.p + '-org2'));
        expect(await w.store.transaction(tx => tx.inactiveIn(w.org))).toEqual([]);
        await w.deactivate(w.bo);
        await w.deactivate(w.anna);
        await w.deactivate(other);
        expect(await w.store.transaction(tx => tx.inactiveIn(w.org))).toEqual([w.anna, w.bo].sort());
      });

      test('a wait the transaction ends is cancelled once it has committed, and never after a rollback', async () => {
        const w = await world();
        const id = (n: number) => `competence-erasure:${w.p}:${n}`;
        await w.store.transaction(async tx => {
          await tx.cancel(id(1));
          await tx.cancel(id(2));
        });
        await refused(() =>
          w.store.transaction(async tx => {
            await tx.cancel(id(3));
            throw new Error('stop');
          }),
        );
        expect((await w.cancelled()).filter(c => c.includes(w.p))).toEqual([id(1), id(2)]);
      });
    });
  });
}
