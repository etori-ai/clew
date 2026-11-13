import { beforeEach, describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, StaffOverview, StaffPerson } from '../../packages/contracts/src/index';
import { ForbiddenError } from '../../apps/server/src/context';
import {
  memoryCompetenceStore,
  type MemoryCompetenceStore,
} from '../../apps/server/src/modules/competence/adapters/memory';
import { holdingRef, pageOfRows, searchCsv, typeSearchWords } from '../../apps/server/src/modules/competence/domain';
import {
  COMPETENCE_EXPORT_FORMAT,
  CompetenceError,
  competenceUsecases,
  type CompetenceUsecases,
} from '../../apps/server/src/modules/competence/usecases';

/**
 * Kompetenssökning and the read log (D121, D108 item 15) on the memory adapter: who may search across the organisation
 * (the relation `registrar` by grant, and nobody else, whatever capabilities they hold), what a search finds and how it
 * is narrowed and paged, the file and its audit row, one person's holdings opened through the relation, and the read log
 * row every such read writes in its own transaction, without which the read answers nothing.
 */
const ORG = 'org-1';
const OTHER = 'org-2';
const T = '2026-11-10T09:00:00.000Z';
function personaOf(
  id: string,
  role: 'manager' | 'employee',
  options: { capabilities?: string[]; relationGrants?: Array<'registrar'>; organisationId?: string } = {},
): AuthenticatedContext {
  return {
    id,
    name: id,
    unitId: 'u1',
    unitLabel: 'Enhet 1',
    role,
    organisationId: options.organisationId ?? ORG,
    principal: { id: 'person:' + id, kind: 'person' },
    capabilities: options.capabilities ?? [],
    ...(options.relationGrants ? { relationGrants: options.relationGrants } : {}),
    authorizationVersion: 'v1',
    sessionBinding: 'test',
    expiresAt: '2099-01-01T00:00:00.000Z',
    authorize: async () => ({ version: 'v1' }),
  };
}
/** HR's registrar, who manages nobody; a manager who is a registrar too; a manager without it; an administrator. */
const hr = personaOf('hr', 'employee', { relationGrants: ['registrar'] });
const boss = personaOf('boss', 'manager', { relationGrants: ['registrar'] });
const plain = personaOf('plain', 'manager');
const admin = personaOf('ada', 'employee', { capabilities: ['admin.competence', 'admin.users', 'admin.connectors'] });
const asAnna = personaOf('anna', 'employee');
const staffPerson = (id: string, name: string, userName: string | null): StaffPerson => ({
  id,
  name,
  userName,
  email: null,
  role: 'employee',
  enabled: true,
});

let store: MemoryCompetenceStore;
let competence: CompetenceUsecases;
let n: number;
let types: { hlr: string; english: string; elsewhere: string };
beforeEach(async () => {
  n = 0;
  const people = [
    ['anna', 'Anna Andersson', 'anna.a', ORG],
    ['bo', 'Bo Berg', null, ORG],
    ['cia', 'Cia Carlsson', 'cia.c', ORG],
    ['dan', 'Dan Dahl', 'dan.d', ORG],
    ['eva', '=SUM(A1:A2)', 'eva.e', ORG],
    ['hr', 'Hanna Registrator', 'hr', ORG],
    ['boss', 'Karin Chef', 'boss', ORG],
    ['plain', 'Pelle Chef', 'plain', ORG],
    ['stranger', 'Sara Annan', 'sara', OTHER],
  ] as const;
  store = memoryCompetenceStore({
    persons: people.map(([id, name, userName, organisationId]) => ({ id, name, userName, organisationId })),
  });
  // The tree (D99): Förvaltningen above Enhet 1 and Enhet 2; Enhet 3 apart.
  store.addUnit({ id: 'u-top', organisationId: ORG, label: 'Förvaltningen' });
  store.addUnit({ id: 'u1', organisationId: ORG, label: 'Enhet 1', parentId: 'u-top' });
  store.addUnit({ id: 'u2', organisationId: ORG, label: 'Enhet 2', parentId: 'u-top' });
  store.addUnit({ id: 'u3', organisationId: ORG, label: 'Enhet 3' });
  store.assign('anna', 'u1');
  store.assign('anna', 'u3');
  store.assign('bo', 'u2');
  store.assign('dan', 'u3');
  store.assign('eva', 'u3');
  store.deactivate('cia');
  const staff = new Map<string, StaffOverview>([
    // The manager who is a registrar too leads Anna; the plain manager leads Dan.
    [
      'boss',
      { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [staffPerson('anna', 'Anna Andersson', 'anna.a')] }] },
    ],
    ['plain', { units: [{ unitId: 'u3', unitLabel: 'Enhet 3', people: [staffPerson('dan', 'Dan Dahl', 'dan.d')] }] }],
  ]);
  competence = competenceUsecases({
    store,
    staff: async persona => staff.get(persona.id) ?? { units: [] },
    clock: () => new Date(T),
    ids: () => 'id-' + ++n,
  });
  const op = 'operator:test';
  types = {
    hlr: await competence.seedType(op, ORG, { name: 'HLR', area: 'Akut', kind: 'course', validityMonths: 24 }),
    english: await competence.seedType(op, ORG, { name: 'Engelska', area: 'Språk', kind: 'skill' }),
    elsewhere: await competence.seedType(op, OTHER, { name: 'HLR', area: 'Akut', kind: 'course' }),
  };
  // HLR: valid, run out, about to run out, a deactivated holder, and a stranger of another organisation.
  await competence.seedHolding(op, ORG, 'anna', { typeId: types.hlr, issuedOn: '2026-01-10' });
  await competence.seedHolding(op, ORG, 'bo', { typeId: types.hlr, issuedOn: '2024-01-10' });
  await competence.seedHolding(op, ORG, 'dan', { typeId: types.hlr, issuedOn: '2025-01-10', expiresOn: '2026-12-01' });
  await competence.seedHolding(op, ORG, 'eva', { typeId: types.hlr, issuedOn: '2026-02-01' });
  await competence.seedHolding(op, ORG, 'cia', { typeId: types.hlr, issuedOn: '2026-02-01' });
  await competence.seedHolding(op, OTHER, 'stranger', { typeId: types.elsewhere, issuedOn: '2026-02-01' });
  // Engelska: Anna confirmed at Expert, Bo his own rating at Självständig, Dan confirmed at Grundläggande.
  await competence.seedSkill(op, ORG, 'anna', { typeId: types.english, level: 3, confirmed: true });
  await competence.seedSkill(op, ORG, 'bo', { typeId: types.english, level: 2 });
  await competence.seedSkill(op, ORG, 'dan', { typeId: types.english, level: 1, confirmed: true });
});
const reads = () => store.readLog();
const audits = () => store.audit();

describe('who may search across the organisation (D121 items 1 and 2)', () => {
  test('only the relation registrar opens the search: a manager, an administrator of everything and a person are refused', async () => {
    const before = audits().length;
    for (const persona of [plain, admin, asAnna]) {
      for (const read of [
        () => competence.searchOptions(persona),
        () => competence.search(persona, { typeId: types.hlr }),
        () => competence.exportSearch(persona, { typeId: types.hlr }),
      ]) {
        const error = await read().catch(e => e);
        expect(error).toBeInstanceOf(ForbiddenError);
        expect(error.message).toBe('Kompetenssökning är inte tilldelad dig. En administratör ger den genom en grupp.');
      }
    }
    // Refused reads leave no row in the read log and none in the audit.
    expect(reads()).toEqual([]);
    expect(audits()).toHaveLength(before);
  });
  test('the type field is the catalogue, which names nobody: anyone the module is on for may search it, and it writes nothing', async () => {
    expect((await competence.findTypes(asAnna, { text: 'eng' })).rows.map(t => t.name)).toEqual(['Engelska']);
    expect((await competence.findTypes(hr, { text: '' })).rows.map(t => t.name)).toEqual(['Engelska', 'HLR']);
    // Twenty at most; more than that is said, so the field asks for more words.
    for (let i = 0; i < 21; i++)
      await competence.seedType('operator:test', ORG, {
        name: `Kurs ${String(i).padStart(2, '0')}`,
        area: 'Kurser',
        kind: 'course',
      });
    const many = await competence.findTypes(hr, { text: 'kurs' });
    expect(many.rows).toHaveLength(20);
    expect(many.more).toBe(true);
    expect((await competence.findTypes(hr, { text: 'kurs 2' })).more).toBe(false);
    expect(typeSearchWords('  Heta   ARBETEN ')).toEqual(['heta', 'arbeten']);
    expect(reads()).toEqual([]);
  });
  test('what the search narrows by is the organisation’s tree, by name', async () => {
    expect((await competence.searchOptions(hr)).units).toEqual([
      { id: 'u1', label: 'Enhet 1', parentLabel: 'Förvaltningen' },
      { id: 'u2', label: 'Enhet 2', parentLabel: 'Förvaltningen' },
      { id: 'u3', label: 'Enhet 3', parentLabel: null },
      { id: 'u-top', label: 'Förvaltningen', parentLabel: null },
    ]);
    expect(reads()).toEqual([]);
  });
});

describe('a search (D121 item 4)', () => {
  test('finds every active holder of the type in the organisation by the holding that decides, by name, and logs the read', async () => {
    const page = await competence.search(hr, { typeId: types.hlr });
    expect(page.type).toEqual({ id: types.hlr, name: 'HLR', area: 'Akut', kind: 'course' });
    expect(page.rows).toEqual([
      // The formula-looking name sorts as text; the deactivated holder and the stranger are not here.
      {
        personId: 'eva',
        key: 'eva.e',
        name: '=SUM(A1:A2)',
        units: ['Enhet 3'],
        status: 'valid',
        expiresOn: '2028-02-01',
      },
      {
        personId: 'anna',
        key: 'anna.a',
        name: 'Anna Andersson',
        units: ['Enhet 1', 'Enhet 3'],
        status: 'valid',
        expiresOn: '2028-01-10',
      },
      { personId: 'bo', key: null, name: 'Bo Berg', units: ['Enhet 2'], status: 'expired', expiresOn: '2026-01-10' },
      {
        personId: 'dan',
        key: 'dan.d',
        name: 'Dan Dahl',
        units: ['Enhet 3'],
        status: 'expiring',
        expiresOn: '2026-12-01',
      },
    ]);
    expect({ total: page.total, page: page.page, pageSize: page.pageSize }).toEqual({
      total: 4,
      page: 1,
      pageSize: 25,
    });
    // One row in the read log, in the transaction of the read: who, as which relation, which type, how many. No name.
    expect(reads()).toEqual([
      {
        id: expect.any(String),
        organisationId: ORG,
        readerId: 'hr',
        relation: 'registrar',
        caller: 'person',
        kind: 'search',
        typeId: types.hlr,
        minLevel: null,
        unitId: null,
        personId: null,
        rows: 4,
        readAt: T,
      },
    ]);
    // A search changes nothing, so it writes no audit row.
    expect(audits().some(a => a.actor === 'person:hr')).toBe(false);
  });
  test('a unit narrows to the people placed on it or below it; a least level to a skill held at it, confirmed or not', async () => {
    const names = async (body: Parameters<CompetenceUsecases['search']>[1]) =>
      (await competence.search(hr, body)).rows.map(r => r.name);
    expect(await names({ typeId: types.hlr, unitId: 'u-top' })).toEqual(['Anna Andersson', 'Bo Berg']);
    expect(await names({ typeId: types.hlr, unitId: 'u2' })).toEqual(['Bo Berg']);
    const skilled = await competence.search(hr, { typeId: types.english, minLevel: 2 });
    expect(skilled.rows.map(r => [r.name, r.level, r.validated, r.status, r.expiresOn])).toEqual([
      ['Anna Andersson', 3, true, 'valid', undefined],
      // The person's own rating is found, and says so ("Egen bedömning").
      ['Bo Berg', 2, false, 'valid', undefined],
    ]);
    expect((await competence.search(hr, { typeId: types.english })).total).toBe(3);
    expect(reads().map(r => [r.typeId, r.minLevel, r.unitId, r.rows])).toEqual([
      [types.hlr, null, 'u-top', 2],
      [types.hlr, null, 'u2', 1],
      [types.english, 2, null, 2],
      [types.english, null, null, 3],
    ]);
  });
  test('a level is for a skill alone, a type of another organisation is no type, and a unit is one of the tree', async () => {
    await expect(competence.search(hr, { typeId: types.hlr, minLevel: 2 })).rejects.toThrow(
      'Bara en färdighet söks på en viss nivå.',
    );
    const elsewhere = await competence.search(hr, { typeId: types.elsewhere }).catch(e => e);
    expect(elsewhere).toBeInstanceOf(CompetenceError);
    expect(elsewhere.message).toBe('Kompetensen finns inte i katalogen.');
    // What the body names reaches the log, the audit and an operator's terminal only once it is the organisation's own.
    for (const unitId of ['no-such-unit', 'u1\n2026-11-10\tforged', 'u-other'])
      for (const read of [
        () => competence.search(hr, { typeId: types.hlr, unitId }),
        () => competence.exportSearch(hr, { typeId: types.hlr, unitId }),
      ]) {
        const refused = await read().catch(e => e);
        expect(refused).toBeInstanceOf(CompetenceError);
        expect(refused.message).toBe('Enheten finns inte.');
      }
    expect(reads()).toEqual([]);
    expect(audits().some(a => a.action === 'competence.search_exported')).toBe(false);
  });
  test('a page past the end answers with the last; pages are cut in one order', async () => {
    expect((await competence.search(hr, { typeId: types.hlr, page: 9 })).page).toBe(1);
    expect(pageOfRows([1, 2, 3, 4, 5], 2, 2)).toEqual({ rows: [3, 4], page: 2 });
    expect(pageOfRows([1, 2, 3, 4, 5], 9, 2)).toEqual({ rows: [5], page: 3 });
    expect(pageOfRows([], 3, 25)).toEqual({ rows: [], page: 1 });
  });
  test('a manager who is a registrar too searches as a registrar, and their own report is found like anyone else', async () => {
    expect((await competence.search(boss, { typeId: types.hlr })).total).toBe(4);
    expect(reads().map(r => [r.readerId, r.relation])).toEqual([['boss', 'registrar']]);
  });
});

describe('the file of a search (D121 item 4)', () => {
  test('lists every holder in the matrix’s format, keeps a formula as text, is audited as an export and logged as one', async () => {
    const file = await competence.exportSearch(hr, { typeId: types.hlr, unitId: 'u-top' });
    expect(file.filename).toBe('kompetenssokning-2026-11-10.csv');
    expect(file.text).toBe(
      '﻿' +
        [
          'Namn;Användarnamn;Enhet;Status;Giltigt till',
          'Anna Andersson;anna.a;Enhet 1, Enhet 3;Giltigt;2028-01-10',
          'Bo Berg;bo;Enhet 2;Utgånget;2026-01-10',
        ].join('\r\n') +
        '\r\n',
    );
    const all = await competence.exportSearch(hr, { typeId: types.hlr });
    expect(all.text.split('\r\n')[1]).toBe("'=SUM(A1:A2);eva.e;Enhet 3;Giltigt;2028-02-01");
    const audit = audits().filter(a => a.action === 'competence.search_exported');
    expect(audit).toEqual([
      {
        actor: 'person:hr',
        action: 'competence.search_exported',
        subject: 'organisation:' + ORG,
        at: T,
        details: { typeId: types.hlr, unitId: 'u-top', people: 2 },
      },
      {
        actor: 'person:hr',
        action: 'competence.search_exported',
        subject: 'organisation:' + ORG,
        at: T,
        details: { typeId: types.hlr, people: 4 },
      },
    ]);
    expect(JSON.stringify(audit)).not.toMatch(/Anna|Bo Berg|HLR/);
    expect(reads().map(r => [r.kind, r.relation, r.typeId, r.unitId, r.rows])).toEqual([
      ['export', 'registrar', types.hlr, 'u-top', 2],
      ['export', 'registrar', types.hlr, null, 4],
    ]);
  });
  test('a skill’s file says the level and whether it is the person’s own rating', async () => {
    const file = await competence.exportSearch(hr, { typeId: types.english, minLevel: 2 });
    expect(file.text.split('\r\n').slice(0, 3)).toEqual([
      '﻿Namn;Användarnamn;Enhet;Status;Nivå;Bedömning;Giltigt till',
      'Anna Andersson;anna.a;Enhet 1, Enhet 3;Giltigt;Expert;Bekräftad;',
      'Bo Berg;bo;Enhet 2;Giltigt;Självständig;Egen bedömning;',
    ]);
    expect(searchCsv({ kind: 'course' }, [])).toBe('﻿Namn;Användarnamn;Enhet;Status;Giltigt till\r\n');
  });
});

describe('one person’s holdings opened (D121 items 4 and 5)', () => {
  test('a registrar opens anyone active of the organisation by user name, and the read is logged as registrar', async () => {
    const opened = await competence.holdings(hr, { person: 'dan.d' }, 'registrar');
    expect(opened.rows.map(r => [r.competence, r.status])).toEqual([
      ['HLR', 'expiring'],
      ['Engelska', 'valid'],
    ]);
    expect(reads()).toEqual([
      {
        id: expect.any(String),
        organisationId: ORG,
        readerId: 'hr',
        relation: 'registrar',
        caller: 'person',
        kind: 'person',
        typeId: null,
        minLevel: null,
        unitId: null,
        personId: 'dan',
        rows: 2,
        readAt: T,
      },
    ]);
  });
  test('a deactivated person, one of another organisation and one without the relation are refused, and nothing is logged', async () => {
    for (const [persona, key] of [
      [hr, 'cia.c'],
      [hr, 'sara'],
      [hr, 'nobody'],
      [plain, 'anna.a'],
      [admin, 'anna.a'],
      [asAnna, 'dan.d'],
    ] as const)
      await expect(competence.holdings(persona, { person: key }, 'registrar')).rejects.toBeInstanceOf(ForbiddenError);
    // The grant alone is not enough: the registry must have resolved the read as the registrar's own direct one.
    for (const told of [undefined, 'colleague', 'managed'] as const)
      await expect(competence.holdings(hr, { person: 'dan.d' }, told)).rejects.toBeInstanceOf(ForbiddenError);
    expect(reads()).toEqual([]);
  });
  test('a manager’s reads are logged as a registrar’s are; a person’s own read discloses nothing and writes no row', async () => {
    await competence.holdings(plain, { person: 'dan.d' });
    await competence.holdings(asAnna);
    await competence.holdings(asAnna, { person: 'anna.a' });
    // Self and managed come first: a manager who is a registrar reads their own report as their manager.
    await competence.holdings(boss, { person: 'anna.a' }, 'managed');
    await competence.holdings(boss, { person: 'dan.d' }, 'registrar');
    expect(reads().map(r => [r.readerId, r.relation, r.kind, r.personId])).toEqual([
      ['plain', 'managed', 'person', 'dan'],
      ['boss', 'managed', 'person', 'anna'],
      ['boss', 'registrar', 'person', 'dan'],
    ]);
  });
});

describe('a registrar sees only what counts (D121, the decision of 2026-11-13)', () => {
  // Dan, besides what counts (HLR about to run out, Engelska confirmed at Grundläggande): a requirement he lacks, his own
  // registration that waits and one his manager rejected, a revoked holding, a copied row of an unmapped type, and his
  // skill marked as one he wants to develop. Each is something the person or their manager works with; none counts.
  const asDan = personaOf('dan', 'employee');
  beforeEach(async () => {
    const op = 'operator:test';
    const fall = await competence.seedType(op, ORG, { name: 'Fallskydd', area: 'Säkerhet', kind: 'certificate' });
    const heta = await competence.seedType(op, ORG, { name: 'Heta arbeten', area: 'Säkerhet', kind: 'certificate' });
    await competence.seedRequirement(op, ORG, { typeId: fall, unitId: 'u3' });
    const base = {
      personId: 'dan',
      expiresOn: null,
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
    };
    await store.transaction(async tx => {
      await tx.insertHolding({
        ...base,
        id: 'h-wait',
        typeId: heta,
        issuedOn: '2026-10-01',
        evidence: 'self',
        state: 'pending',
        registeredBy: 'dan',
        threadId: 'th-1',
      });
      await tx.insertHolding({
        ...base,
        id: 'h-rej',
        typeId: fall,
        issuedOn: '2026-09-01',
        evidence: 'self',
        state: 'rejected',
        registeredBy: 'dan',
        decidedBy: 'plain',
        decidedAt: T,
      });
      await tx.insertHolding({
        ...base,
        id: 'h-rev',
        typeId: heta,
        issuedOn: '2025-01-01',
        evidence: 'manager',
        state: 'revoked',
        revokedAt: T,
        revokedBy: 'plain',
      });
      await tx.putSource({
        connectorId: 'lms',
        source: 'Lärplattformen',
        run: null,
        claimedAt: null,
        leaseUntil: null,
        startedAt: null,
        finishedAt: null,
        outcome: null,
        counts: null,
      });
      await tx.putCopied([
        {
          ...base,
          id: 'h-copy',
          typeId: null,
          issuedOn: '2026-03-01',
          evidence: 'system',
          state: 'valid',
          copy: { connectorId: 'lms', sourceId: 'c-1', sourceType: 'badge:1', sourceLabel: 'Okopplad kurs', readAt: T },
        },
      ]);
    });
    const [english] = (await store.transaction(tx => tx.holdingsOf(['dan']))).filter(h => h.typeId === types.english);
    await store.transaction(tx => tx.updateHolding(english!.id, { interest: true }));
  });
  const registered = async () => (await competence.holdings(hr, { person: 'dan.d' }, 'registrar')).rows;
  const refs = (rows: Array<{ ref: string }>) => rows.map(r => r.ref);

  test('what counts is there, with where it stands and a skill’s level, and the read is logged with its count', async () => {
    expect((await registered()).map(r => [r.competence, r.status, r.level ?? null, r.assessment ?? null])).toEqual([
      ['HLR', 'expiring', null, null],
      ['Engelska', 'valid', 'Grundläggande', null],
    ]);
    expect(reads().map(r => [r.readerId, r.relation, r.kind, r.personId, r.rows])).toEqual([
      ['hr', 'registrar', 'person', 'dan', 2],
    ]);
  });
  test('not his own registration that waits for his manager', async () => {
    const rows = await registered();
    expect(rows.some(r => r.status === 'awaiting-approval')).toBe(false);
    expect(refs(rows)).not.toContain(holdingRef('h-wait'));
  });
  test('not his registration that his manager rejected', async () => {
    const rows = await registered();
    expect(rows.some(r => r.status === 'rejected')).toBe(false);
    expect(refs(rows)).not.toContain(holdingRef('h-rej'));
  });
  test('not a requirement he lacks: no missing row and no required level', async () => {
    const rows = await registered();
    expect(rows.some(r => r.status === 'missing' || 'required' in r)).toBe(false);
    expect(rows.map(r => r.competence)).not.toContain('Fallskydd');
  });
  test('not a holding that was revoked', async () => {
    const rows = await registered();
    expect(refs(rows)).not.toContain(holdingRef('h-rev'));
    expect(rows.map(r => r.competence)).not.toContain('Heta arbeten');
  });
  test('not a copied row of a type the catalogue has not mapped', async () => {
    const rows = await registered();
    expect(rows.some(r => r.status === 'uncounted')).toBe(false);
    expect(rows.map(r => r.competence)).not.toContain('Okopplad kurs');
  });
  test('not the mark that he wants to develop a skill; a rating of his own is still said as his', async () => {
    expect((await registered()).some(r => 'interest' in r)).toBe(false);
    // A skill only the person has rated is said as their own ("Egen bedömning"), without "Vill utveckla".
    await competence.seedSkill('operator:test', ORG, 'eva', { typeId: types.english, level: 2, interest: true });
    const eva = (await competence.holdings(hr, { person: 'eva.e' }, 'registrar')).rows;
    expect(eva.find(r => r.competence === 'Engelska')).toMatchObject({
      level: 'Självständig',
      assessment: 'Egen bedömning',
    });
    expect(eva.some(r => 'interest' in r)).toBe(false);
  });
  test('no decision history: a row says what is held and how it is attested, never who decided, revoked or registered it, or when', async () => {
    // The fields a row may carry to a registrar; the contract's row has no field for a decision, its maker or its time.
    const said = [
      ...['ref', 'userName', 'name', 'competence', 'area', 'kind', 'issuedOn', 'expiresOn', 'status'],
      ...['evidence', 'source', 'readAt', 'level', 'assessment'],
    ];
    for (const row of await registered()) for (const key of Object.keys(row)) expect(said).toContain(key);
  });
  test('the manager’s view and the person’s own are as before, and only the manager’s read is logged', async () => {
    // The manager sees all of it but the rejection, which is the person's alone (D108 item 7).
    const managed = (await competence.holdings(plain, { person: 'dan.d' })).rows;
    expect(managed.map(r => [r.competence, r.status]).sort()).toEqual(
      [
        ['Engelska', 'valid'],
        ['Fallskydd', 'missing'],
        ['HLR', 'expiring'],
        ['Heta arbeten', 'awaiting-approval'],
        ['Okopplad kurs', 'uncounted'],
      ].sort(),
    );
    expect(managed.find(r => r.competence === 'Engelska')?.interest).toBe('Vill utveckla');
    const own = (await competence.holdings(asDan)).rows;
    expect(new Set(own.map(r => r.status))).toEqual(
      new Set(['valid', 'missing', 'expiring', 'awaiting-approval', 'rejected', 'uncounted']),
    );
    expect(own.find(r => r.competence === 'Engelska')?.interest).toBe('Vill utveckla');
    expect(own.find(r => r.status === 'missing')?.competence).toBe('Fallskydd');
    expect(reads().map(r => [r.readerId, r.relation, r.personId, r.rows])).toEqual([['plain', 'managed', 'dan', 5]]);
  });
});

describe('a manager’s matrix as a file is an export of their reports’ competence (D108 item 15)', () => {
  test('it writes its row of the read log beside its audit row, naming no type and counting the people; or neither', async () => {
    const file = await competence.exportMatrix(plain);
    expect(file.filename).toBe('kompetens-2026-11-10.csv');
    expect(audits().filter(a => a.action === 'competence.matrix_exported')).toEqual([
      {
        actor: 'person:plain',
        action: 'competence.matrix_exported',
        subject: 'organisation:' + ORG,
        at: T,
        details: { people: 1, types: 0 },
      },
    ]);
    expect(reads()).toEqual([
      {
        id: expect.any(String),
        organisationId: ORG,
        readerId: 'plain',
        relation: 'managed',
        caller: 'person',
        kind: 'export',
        typeId: null,
        minLevel: null,
        unitId: null,
        personId: null,
        rows: 1,
        readAt: T,
      },
    ]);
    // A row the log cannot take takes the file and its audit row with it.
    store.readLogSink.fail = true;
    await expect(competence.exportMatrix(plain)).rejects.toThrow('the read log cannot be written');
    expect(audits().filter(a => a.action === 'competence.matrix_exported')).toHaveLength(1);
    store.readLogSink.fail = false;
  });
});

describe('a read whose row cannot be written answers nothing (D121 item 5)', () => {
  test('the search, the file and a person opened all fail, and the file’s audit row goes with them', async () => {
    store.readLogSink.fail = true;
    const before = audits().length;
    await expect(competence.search(hr, { typeId: types.hlr })).rejects.toThrow('the read log cannot be written');
    await expect(competence.exportSearch(hr, { typeId: types.hlr })).rejects.toThrow('the read log cannot be written');
    await expect(competence.holdings(hr, { person: 'anna.a' }, 'registrar')).rejects.toThrow(
      'the read log cannot be written',
    );
    await expect(competence.holdings(plain, { person: 'dan.d' })).rejects.toThrow('the read log cannot be written');
    // A person's own read writes no row, so it answers.
    expect((await competence.holdings(asAnna)).rows.length).toBeGreaterThan(0);
    expect(audits()).toHaveLength(before);
    expect(reads()).toEqual([]);
    store.readLogSink.fail = false;
    expect((await competence.search(hr, { typeId: types.hlr })).total).toBe(4);
  });
});

describe('the read log beside erasure and export (D108 items 14 and 15)', () => {
  test('erasing a person leaves the reads of them and by them; the export of the domain does not carry the log', async () => {
    await competence.holdings(hr, { person: 'anna.a' }, 'registrar');
    await competence.search(hr, { typeId: types.hlr });
    store.deactivate('anna');
    await competence.erasePerson('operator:cli', 'anna');
    expect(reads().map(r => [r.kind, r.personId])).toEqual([
      ['person', 'anna'],
      ['search', null],
    ]);
    expect((await competence.readLog({ organisationId: ORG, personId: 'anna', limit: 10 })).map(r => r.kind)).toEqual([
      'person',
    ]);
    const document = await competence.exportDomain('operator:cli', ORG);
    expect(document.format).toBe(COMPETENCE_EXPORT_FORMAT);
    expect(COMPETENCE_EXPORT_FORMAT).toBe('clew.competence/8');
    expect(Object.keys(document)).not.toContain('reads');
  });
});
