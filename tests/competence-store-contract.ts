import { describe, expect, test } from 'bun:test';
import { COMPETENCE_CONNECTOR } from '../packages/connectors/src/index';
import type {
  CompetenceStore,
  HoldingRecord,
  PersonRef,
  TypeRecord,
} from '../apps/server/src/modules/competence/model';

/**
 * The competence store (D108): the catalogue, holdings, the people the domain names, erasure and export. One suite, two
 * adapters: `tests/unit/competence-store.test.ts` on memory, `tests/db/postgres-competence-store.test.ts` on Postgres.
 */
export interface CompetenceStoreHarness {
  store: CompetenceStore;
  /** Prefixes every id the suite writes, the organisation's included, so runs never meet. */
  prefix: string;
  /** A person as provisioning would have written them. */
  seedPerson(person: PersonRef): Promise<void>;
  /** A card in a person's own stream, as the scan of `connector` would have pushed it. */
  seedCard(id: string, personId: string, connector: string): Promise<void>;
  /** The ids of the cards in a person's own stream, in id order. */
  cardsOf(personId: string): Promise<string[]>;
  /** The audit rows written about `subject`, oldest first. */
  auditFor(subject: string): Promise<Array<{ actor: string; action: string }>>;
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
  ...extra,
});
const person = (
  id: string,
  organisationId: string,
  userName: string | null = 'u-' + id,
  enabled = true,
): PersonRef => ({
  id,
  organisationId,
  name: 'Name ' + id,
  userName,
  enabled,
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

    test('the people the domain names: an unknown id is absent, a person without a user name has null, a deactivated one is not enabled', async () => {
      const w = await world();
      await w.seedPerson(person(w.p + '-cia', w.org, null));
      await w.seedPerson(person(w.p + '-leaver', w.org, 'u-' + w.p + '-leaver', false));
      const found = await w.store.transaction(tx =>
        tx.persons([w.anna, w.p + '-cia', w.p + '-leaver', w.p + '-nobody']),
      );
      expect(found.sort((a, b) => a.id.localeCompare(b.id))).toEqual([
        person(w.anna, w.org),
        person(w.p + '-cia', w.org, null),
        person(w.p + '-leaver', w.org, 'u-' + w.p + '-leaver', false),
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
      expect(await w.store.transaction(tx => tx.erasePerson(w.anna))).toEqual({ holdings: 2, cleared: 1 });
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
      expect(await w.store.transaction(tx => tx.erasePerson(w.anna))).toEqual({ holdings: 0, cleared: 0 });
    });

    test("an erasure removes the person's own competence cards with the holdings, each with a thread.removed row, or nothing at all (R1)", async () => {
      const w = await world();
      const [own1, own2, otherConnector, colleagues] = [1, 2, 3, 4].map(n => `${w.p}-card-${n}`) as [
        string,
        string,
        string,
        string,
      ];
      await w.seedCard(own1, w.anna, COMPETENCE_CONNECTOR);
      await w.seedCard(own2, w.anna, COMPETENCE_CONNECTOR);
      await w.seedCard(otherConnector, w.anna, 'hr');
      await w.seedCard(colleagues, w.bo, COMPETENCE_CONNECTOR);
      await w.store.transaction(async tx => {
        await tx.insertType(typeRow(w.p + '-t1', w.org));
        await tx.insertHolding(holdingRow(w.p + '-h1', w.anna, w.p + '-t1'));
      });
      const removed = async (id: string) => w.auditFor('thread:' + id);
      // A transaction that throws after the cards went leaves them, and their rows unwritten.
      await refused(() =>
        w.store.transaction(async tx => {
          expect(await tx.cards.removeOwn(w.anna, 'operator:test', T2)).toBe(2);
          throw new Error('stop');
        }),
      );
      expect(await w.cardsOf(w.anna)).toEqual([own1, own2, otherConnector]);
      expect(await removed(own1)).toEqual([]);
      // The erasure as the use case runs it: the holdings, the cards and the erasure's own row in one transaction.
      const subject = 'person:' + w.anna;
      const counted = await w.store.transaction(async tx => {
        const erased = await tx.erasePerson(w.anna);
        const cards = await tx.cards.removeOwn(w.anna, 'operator:test', T2);
        await tx.audit({ actor: 'operator:test', action: 'competence.person_erased', subject, at: T2 });
        return { ...erased, cards };
      });
      expect(counted).toEqual({ holdings: 1, cleared: 0, cards: 2 });
      // Only the person's own competence cards: another connector's card of theirs and a colleague's card stay.
      expect(await w.cardsOf(w.anna)).toEqual([otherConnector]);
      expect(await w.cardsOf(w.bo)).toEqual([colleagues]);
      for (const id of [own1, own2])
        expect(await removed(id)).toEqual([{ actor: 'operator:test', action: 'thread.removed' }]);
      for (const id of [otherConnector, colleagues]) expect(await removed(id)).toEqual([]);
      expect(await w.auditFor(subject)).toEqual([{ actor: 'operator:test', action: 'competence.person_erased' }]);
      // Nothing is left to remove.
      expect(await w.store.transaction(tx => tx.cards.removeOwn(w.anna, 'operator:test', T2))).toBe(0);
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
      });
    });
  });
}
