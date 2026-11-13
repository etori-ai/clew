import { beforeEach, describe, expect, test } from 'bun:test';
import type {
  AuthenticatedContext,
  CompetenceImportBody,
  CompetenceImportRowBody,
  StaffOverview,
  StaffPerson,
} from '../../packages/contracts/src/index';
import { COMPETENCE_CATALOGUE_MAX } from '../../packages/contracts/src/index';
import { ForbiddenError } from '../../apps/server/src/context';
import {
  memoryCompetenceStore,
  type MemoryCompetenceStore,
} from '../../apps/server/src/modules/competence/adapters/memory';
import type { CompetenceStore, HoldingRecord } from '../../apps/server/src/modules/competence/model';
import {
  CompetenceError,
  COMPETENCE_EXPORT_FORMAT,
  competenceUsecases,
  type CompetenceUsecases,
} from '../../apps/server/src/modules/competence/usecases';

/**
 * The catalogue at scale (D120 item 7, D108 item 2) on the memory adapter: an import of a file's chosen rows, idempotent
 * on the address and the name, one audit row of counts; a merge of two types in one transaction with one audit row, the
 * holdings, requirements, share targets and mappings moved, the conflicts settled as the use case says; and an archived
 * type restored, a merged one never. No audit row carries a person's or a type's name.
 */
const ORG = 'org-1';
const person = (id: string, name: string, userName: string): StaffPerson => ({
  id,
  name,
  userName,
  email: null,
  role: 'employee',
  enabled: true,
});
const anna = person('anna', 'Anna Andersson', 'anna.a');
const bo = person('bo', 'Bo Berg', 'bo.b');
const NAMES = ['Anna Andersson', 'Bo Berg', 'Karin Chef', 'Ada Admin'];
function personaOf(
  id: string,
  role: 'manager' | 'employee',
  name: string,
  capabilities: AuthenticatedContext['capabilities'] = [],
  organisationId = ORG,
): AuthenticatedContext & { authorized: number } {
  const persona = {
    id,
    name,
    unitId: 'u1',
    unitLabel: 'Enhet 1',
    role,
    organisationId,
    principal: { id: 'person:' + id, kind: 'person' as const },
    capabilities,
    authorizationVersion: 'v1',
    sessionBinding: 'test',
    expiresAt: '2026-12-31T00:00:00.000Z',
    authorized: 0,
    authorize: async () => {
      persona.authorized++;
      return { version: 'v1' };
    },
  };
  return persona;
}
const boss = personaOf('boss', 'manager', 'Karin Chef');
const admin = personaOf('ada', 'employee', 'Ada Admin', ['admin.competence']);
const elsewhere = personaOf('eve', 'employee', 'Eve Annan', ['admin.competence'], 'org-2');
const asAnna = personaOf('anna', 'employee', 'Anna Andersson');

let now: Date;
let n: number;
let store: MemoryCompetenceStore;
let competence: CompetenceUsecases;
/** The store finds every row of an import taken by its own comparison, as Postgres's `lower()` may where JS does not. */
let storeSkips = false;
beforeEach(() => {
  now = new Date('2026-11-10T09:00:00.000Z');
  n = 0;
  storeSkips = false;
  admin.authorized = 0;
  const staff = new Map<string, StaffOverview>([
    ['boss', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [anna, bo] }] }],
  ]);
  store = memoryCompetenceStore({
    persons: [anna, bo, { id: 'boss', name: 'Karin Chef', userName: 'boss' }].map(p => ({
      id: p.id,
      organisationId: ORG,
      name: p.name,
      userName: p.userName,
    })),
  });
  store.addPosition({ id: 'pos-usk', organisationId: ORG, code: 'usk', label: 'Undersköterska' });
  store.addUnit({ id: 'u1', organisationId: ORG, label: 'Enhet 1' });
  const racing: CompetenceStore = {
    transaction: fn => store.transaction(tx => fn(storeSkips ? { ...tx, insertTypes: async () => [] } : tx)),
  };
  competence = competenceUsecases({
    store: racing,
    staff: async persona => staff.get(persona.id) ?? { units: [] },
    clock: () => now,
    ids: () => 'id-' + ++n,
  });
});
const audits = () => store.audit();
const lastAudit = () => audits().at(-1)!;
const noNames = () => {
  const text = JSON.stringify(audits());
  for (const name of [...NAMES, 'HLR', 'Truckkort', 'Truckförarbevis', 'leda ett team', 'Engelska'])
    expect(text).not.toContain(name);
};
const escoUri = (n: number) => `http://data.europa.eu/esco/skill/0000000${n}-aaaa-bbbb-cccc-dddddddddddd`;
const escoRow = (row: number, name: string, area = 'Digitala färdigheter'): CompetenceImportRowBody => ({
  row,
  name,
  area,
  kind: 'skill',
  validityMonths: null,
  uri: escoUri(row),
});
const clewRow = (row: number, name: string, extra: Partial<CompetenceImportRowBody> = {}): CompetenceImportRowBody => ({
  row,
  name,
  area: 'Säkerhet',
  kind: 'certificate',
  validityMonths: null,
  uri: null,
  ...extra,
});
const types = async () => (await competence.types(admin)).rows;
/** A holding written straight into the store, as an earlier registration or a source's copy would have left it. */
const held = (id: string, personId: string, typeId: string, extra: Partial<HoldingRecord> = {}): HoldingRecord => ({
  id,
  personId,
  typeId,
  issuedOn: '2025-01-15',
  expiresOn: null,
  evidence: 'manager',
  state: 'valid',
  registeredBy: 'boss',
  createdAt: '2026-01-01T00:00:00.000Z',
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
const put = (...rows: HoldingRecord[]) =>
  store.transaction(async tx => {
    for (const row of rows) await tx.insertHolding(row);
  });

describe('an import adds the chosen rows of a file (D120 item 7)', () => {
  test("ESCO's rows go under the chosen area as skills that keep their address; one audit row of counts", async () => {
    const body: CompetenceImportBody = {
      format: 'esco',
      rows: [escoRow(2, 'leda ett team'), escoRow(3, 'använda kalkylprogram')],
    };
    expect(await competence.importTypes(admin, body)).toEqual({ added: 2, skipped: 0 });
    expect(admin.authorized).toBe(1);
    expect(await types()).toEqual([
      {
        id: 'id-2',
        name: 'använda kalkylprogram',
        area: 'Digitala färdigheter',
        kind: 'skill',
        archived: false,
        uri: escoUri(3),
      },
      {
        id: 'id-1',
        name: 'leda ett team',
        area: 'Digitala färdigheter',
        kind: 'skill',
        archived: false,
        uri: escoUri(2),
      },
    ]);
    expect(audits()).toEqual([
      {
        actor: 'person:ada',
        action: 'competence.types_imported',
        subject: 'organisation:' + ORG,
        at: now.toISOString(),
        details: { organisationId: ORG, format: 'esco', rows: 2, added: 2, skipped: 0 },
      },
    ]);
    noNames();
  });
  test('the same rows again are skipped, not duplicated: by the address, and by the name in use or merged', async () => {
    await competence.importTypes(admin, { format: 'esco', rows: [escoRow(2, 'leda ett team')] });
    const hot = await competence.addType(admin, { name: 'Heta arbeten', area: 'Säkerhet', kind: 'certificate' });
    const old = await competence.addType(admin, { name: 'Gammal kurs', area: 'Säkerhet', kind: 'course' });
    await competence.archiveType(admin, old);
    const truck = await competence.addType(admin, { name: 'Truckkort', area: 'Fordon', kind: 'certificate' });
    const bevis = await competence.addType(admin, { name: 'Truckförarbevis', area: 'Fordon', kind: 'certificate' });
    await competence.mergeTypes(admin, truck, { into: bevis });
    const outcome = await competence.importTypes(admin, {
      format: 'clew',
      rows: [
        // Its address is kept by the ESCO type, whatever this row calls it.
        clewRow(2, 'Teamledning', { kind: 'skill', uri: escoUri(2) }),
        clewRow(3, 'heta  ARBETEN', { area: 'Annat område' }),
        clewRow(4, 'Truckkort', { area: 'Fordon' }),
        // An archived type's name is free again, as it is to "Lägg till kompetens".
        clewRow(5, 'Gammal kurs', { kind: 'course' }),
        // A row the request named before is the same type.
        clewRow(6, 'Ny kurs', { kind: 'course' }),
        clewRow(7, 'ny kurs', { kind: 'course' }),
      ],
    });
    expect(outcome).toEqual({ added: 2, skipped: 4 });
    expect((await types()).filter(t => !t.archived).map(t => t.name)).toEqual([
      'leda ett team',
      'Truckförarbevis',
      'Gammal kurs',
      'Heta arbeten',
      'Ny kurs',
    ]);
    expect(hot).toBeDefined();
    expect(lastAudit().details).toEqual({ organisationId: ORG, format: 'clew', rows: 6, added: 2, skipped: 4 });
  });
  test("a row of Clew's names its own area, which comes into being with it; the name and area as the page reads them", async () => {
    await competence.importTypes(admin, {
      format: 'clew',
      rows: [clewRow(2, '  HLR  med\thjärtstartare ', { area: ' Akut   vård', kind: 'course', validityMonths: 24 })],
    });
    expect(await types()).toEqual([
      {
        id: 'id-1',
        name: 'HLR med hjärtstartare',
        area: 'Akut vård',
        kind: 'course',
        validityMonths: 24,
        archived: false,
      },
    ]);
  });
  test('a row the shared check refuses refuses the request and names its row; nothing is written', async () => {
    for (const [rows, message] of [
      [[clewRow(2, 'OK'), clewRow(3, ' ')], 'Rad 3: Namn saknas.'],
      [[clewRow(2, 'Engelska', { kind: 'skill', validityMonths: 12 })], 'Rad 2: En färdighet har ingen giltighetstid.'],
      [[clewRow(2, 'Adress', { uri: 'inte en adress' })], 'Rad 2: Adressen ska börja med http://, https:// eller urn:'],
    ] as const) {
      const refused = await competence.importTypes(admin, { format: 'clew', rows: [...rows] }).catch(e => e);
      expect(refused).toBeInstanceOf(CompetenceError);
      expect((refused as Error).message).toStartWith(message);
    }
    // An ESCO row is a skill with an address: one sent otherwise is refused.
    const notSkill = await competence
      .importTypes(admin, { format: 'esco', rows: [{ ...escoRow(2, 'x'), kind: 'course' }] })
      .catch(e => e);
    expect((notSkill as Error).message).toBe('Rad 2: En rad ur ESCO är en färdighet med en adress.');
    expect(await types()).toEqual([]);
    expect(audits()).toEqual([]);
  });
  test('only an administrator of the catalogue imports, after the step-up', async () => {
    await expect(competence.importTypes(boss, { format: 'esco', rows: [escoRow(2, 'x')] })).rejects.toBeInstanceOf(
      ForbiddenError,
    );
    expect(admin.authorized).toBe(0);
  });
  test('the catalogue keeps at most its limit of types, archived ones counted', async () => {
    for (let i = 0; i < COMPETENCE_CATALOGUE_MAX - 1; i++)
      store.state.types.set('filler-' + i, {
        id: 'filler-' + i,
        organisationId: ORG,
        name: 'Fyllnad ' + i,
        area: 'A',
        kind: 'course',
        validityMonths: null,
        archivedAt: i % 2 ? now.toISOString() : null,
        createdBy: 'operator:test',
        createdAt: now.toISOString(),
        sourceUri: null,
        mergedInto: null,
      });
    const refused = await competence
      .importTypes(admin, { format: 'clew', rows: [clewRow(2, 'En'), clewRow(3, 'Två')] })
      .catch(e => e);
    expect((refused as Error).message).toBe('Katalogen får ha högst 20000 kompetenser, arkiverade medräknade.');
    expect(await competence.importTypes(admin, { format: 'clew', rows: [clewRow(2, 'En')] })).toEqual({
      added: 1,
      skipped: 0,
    });
  });
  test('a row the store finds taken by its own comparison is skipped, never refused, and counted so', async () => {
    storeSkips = true;
    expect(
      await competence.importTypes(admin, { format: 'clew', rows: [clewRow(2, 'En'), clewRow(3, 'Två')] }),
    ).toEqual({ added: 0, skipped: 2 });
    expect(lastAudit().details).toEqual({ organisationId: ORG, format: 'clew', rows: 2, added: 0, skipped: 2 });
  });
  test('a name is one name however it is written: composed or not, with an invisible character, by import or by hand', async () => {
    const cafe = await competence.addType(admin, { name: 'Cafe\u0301kurs', area: 'Mat', kind: 'course' });
    expect((await types()).find(t => t.id === cafe)!.name).toBe('Cafékurs');
    await expect(
      competence.addType(admin, { name: 'CAF\u00c9\u200bKURS', area: 'Mat', kind: 'course' }),
    ).rejects.toThrow('Det finns redan en kompetens med det namnet.');
    expect(
      await competence.importTypes(admin, {
        format: 'clew',
        rows: [clewRow(2, 'caf\u00e9\u202ekurs', { kind: 'course' }), clewRow(3, '\u2066Heta\u2069 arbeten')],
      }),
    ).toEqual({ added: 1, skipped: 1 });
    expect((await types()).map(t => t.name)).toContain('Heta arbeten');
  });
  test('an address is http, https or urn, nothing a browser would run', async () => {
    for (const uri of ['javascript:alert(1)', 'data:text/html,x', 'ftp://example.org/x', 'mailto:a@b.se', 'http:x'])
      await expect(competence.importTypes(admin, { format: 'clew', rows: [clewRow(2, 'X', { uri })] })).rejects.toThrow(
        'Rad 2: Adressen ska börja med http://, https:// eller urn:',
      );
    expect(
      await competence.importTypes(admin, {
        format: 'clew',
        rows: [
          clewRow(2, 'A', { uri: 'https://example.org/a' }),
          clewRow(3, 'B', { uri: 'urn:esco:skill:b' }),
          clewRow(4, 'C', { uri: 'HTTP://example.org/c' }),
        ],
      }),
    ).toEqual({ added: 3, skipped: 0 });
  });
  test('an add by hand counts against the catalogue’s limit too', async () => {
    for (let i = 0; i < COMPETENCE_CATALOGUE_MAX; i++)
      store.state.types.set('filler-' + i, {
        id: 'filler-' + i,
        organisationId: ORG,
        name: 'Fyllnad ' + i,
        area: 'A',
        kind: 'course',
        validityMonths: null,
        archivedAt: now.toISOString(),
        createdBy: 'operator:test',
        createdAt: now.toISOString(),
        sourceUri: null,
        mergedInto: null,
      });
    await expect(competence.addType(admin, { name: 'En till', area: 'A', kind: 'course' })).rejects.toThrow(
      'Katalogen får ha högst 20000 kompetenser, arkiverade medräknade.',
    );
  });
});

describe('two types are merged into one (D108 item 2)', () => {
  async function pair(
    kind: 'certificate' | 'skill' = 'certificate',
    validity: [number | null, number | null] = [null, null],
  ) {
    const from = await competence.addType(admin, {
      name: kind === 'skill' ? 'Engelska' : 'Truckkort',
      area: 'A',
      kind,
      validityMonths: validity[0],
    });
    const into = await competence.addType(admin, {
      name: kind === 'skill' ? 'Engelska språket' : 'Truckförarbevis',
      area: 'A',
      kind,
      validityMonths: validity[1],
    });
    return { from, into };
  }
  test('every holding moves whatever its state, the type is archived as merged, and one audit row counts it', async () => {
    const { from, into } = await pair('certificate', [24, 36]);
    await put(
      held('h1', 'anna', from, { issuedOn: '2025-03-01' }),
      held('h2', 'anna', from, { state: 'revoked', revokedAt: '2026-02-01T00:00:00.000Z', revokedBy: 'boss' }),
      held('h3', 'bo', from, {
        evidence: 'self',
        state: 'pending',
        registeredBy: 'bo',
        threadId: 'approval-1',
      }),
      held('h4', 'anna', into, { issuedOn: '2026-01-01' }),
      held('h5', 'bo', from, { expiresOn: '2030-01-01' }),
    );
    // As an administrator is shown it: Bo's registration that waits is not counted, and two people are fewer than five.
    const preview = await competence.mergePreview(admin, from, into);
    expect(preview).toEqual({
      holdings: 'few',
      people: 'few',
      requirements: 0,
      requirementsFolded: 0,
      shareTargets: 0,
      shareTargetsFolded: 0,
      mappings: 0,
      skillsSetAside: 0,
      // h1 is counted from the rule, which is now the other type's; h5 has the issuer's date, h3 waits.
      ruled: 'few',
      waiting: false,
    });
    const auditsBefore = audits().length;
    // The merge answers what moved as the preview counts it; its audit row keeps the exact counts.
    expect(await competence.mergeTypes(admin, from, { into })).toEqual(preview);
    const rows = store.state.holdings;
    expect([...rows.values()].map(h => [h.id, h.typeId, h.state]).sort()).toEqual([
      ['h1', into, 'valid'],
      ['h2', into, 'revoked'],
      ['h3', into, 'pending'],
      ['h4', into, 'valid'],
      ['h5', into, 'valid'],
    ]);
    const merged = (await types()).find(t => t.id === from)!;
    expect(merged).toMatchObject({ archived: true, mergedInto: into });
    expect(audits().slice(auditsBefore)).toEqual([
      {
        actor: 'person:ada',
        action: 'competence.type_merged',
        subject: 'competence-type:' + from,
        at: now.toISOString(),
        details: {
          organisationId: ORG,
          into,
          holdings: 4,
          people: 2,
          requirements: 0,
          requirementsFolded: 0,
          shareTargets: 0,
          shareTargetsFolded: 0,
          mappings: 0,
          skillsSetAside: 0,
          ruled: 1,
        },
      },
    ]);
    noNames();
    // A merged type takes nothing new, is changed no more, and is not brought back.
    await expect(competence.registerHolding(boss, 'anna', { typeId: from, issuedOn: '2026-01-01' })).rejects.toThrow(
      'Kompetensen är arkiverad och kan inte registreras.',
    );
    await expect(competence.updateType(admin, from, { name: 'Nytt namn' })).rejects.toThrow(
      'Kompetensen är sammanslagen med en annan och kan inte ändras.',
    );
    await expect(competence.restoreType(admin, from)).rejects.toThrow(
      'Kompetensen är sammanslagen med en annan och kan inte återställas: en sammanslagning går inte att ångra.',
    );
    // Anna's holdings read as the type merged into; the one that decides is the one that ends last.
    const annaRows = (await competence.holdings(boss, { person: 'anna.a' })).rows;
    expect(annaRows.map(r => [r.competence, r.issuedOn])).toEqual([['Truckförarbevis', '2026-01-01']]);
  });
  test('requirements and share targets move, and one the other type already has for the target keeps the stricter', async () => {
    const { from, into } = await pair('skill');
    await competence.addRequirement(admin, { typeId: from, positionCode: 'usk', minLevel: 3 });
    await competence.addRequirement(admin, { typeId: into, positionCode: 'usk', minLevel: 2 });
    await competence.addRequirement(admin, { typeId: from, unitId: 'u1', minLevel: 1 });
    await competence.addRequirement(boss, { typeId: from, personId: 'anna', minLevel: 1 });
    await competence.addRequirement(boss, { typeId: into, personId: 'anna', minLevel: 2 });
    await competence.addShareTarget(admin, { typeId: from, positionCode: 'usk', minShare: 80 });
    await competence.addShareTarget(admin, { typeId: into, positionCode: 'usk', minShare: 60 });
    await competence.addShareTarget(admin, { typeId: from, positionCode: 'usk', unitId: 'u1', minShare: 50 });
    // The requirements a manager set on Anna are not counted to an administrator (D118); they move all the same.
    const preview = await competence.mergePreview(admin, from, into);
    expect(preview).toMatchObject({ requirements: 2, requirementsFolded: 1, shareTargets: 2, shareTargetsFolded: 1 });
    await competence.mergeTypes(admin, from, { into });
    expect(lastAudit().details).toMatchObject({
      requirements: 3,
      requirementsFolded: 2,
      shareTargets: 2,
      shareTargetsFolded: 1,
    });
    const requirements = [...store.state.requirements.values()]
      .map(r => [r.typeId, r.positionCode ?? r.unitId ?? r.personId, r.minLevel])
      .sort((a, b) => String(a[1]).localeCompare(String(b[1])));
    expect(requirements).toEqual([
      [into, 'anna', 2],
      [into, 'u1', 1],
      [into, 'usk', 3],
    ]);
    const targets = [...store.state.shareTargets.values()].map(t => [t.typeId, t.unitId, t.minShare]).sort();
    expect(targets).toEqual([
      [into, null, 80],
      [into, 'u1', 50],
    ]);
  });
  test('a person who holds a skill of both keeps the one that decides; the other is set aside with its history, its interest kept', async () => {
    const { from, into } = await pair('skill');
    // Anna rated herself Expert in the one and wants to develop it; her manager confirmed the other at Självständig.
    await competence.rateOwnSkill(asAnna, { typeId: from, level: 3, interest: true });
    const confirmed = await competence.registerSkill(boss, 'anna', { typeId: into, level: 2 });
    // Bo holds the one merged away alone: it simply moves.
    await competence.registerSkill(boss, 'bo', { typeId: from, level: 1 });
    expect((await competence.mergePreview(admin, from, into)).skillsSetAside).toBe('few');
    await competence.mergeTypes(admin, from, { into });
    expect(lastAudit().details).toMatchObject({ holdings: 2, skillsSetAside: 1 });
    const annas = [...store.state.holdings.values()].filter(h => h.personId === 'anna');
    expect(annas.map(h => [h.typeId, h.level, h.state, h.interest, h.validatedAt !== null]).sort()).toEqual([
      [into, 2, 'valid', true, true],
      [into, 3, 'revoked', true, false],
    ]);
    expect(annas.find(h => h.state === 'valid')!.id).toBe(confirmed);
    const bos = [...store.state.holdings.values()].filter(h => h.personId === 'bo');
    expect(bos.map(h => [h.typeId, h.state])).toEqual([[into, 'valid']]);
  });
  test('of two skills both only rated, the higher level decides', async () => {
    const { from, into } = await pair('skill');
    await competence.rateOwnSkill(asAnna, { typeId: into, level: 1, interest: false });
    const higher = await competence.rateOwnSkill(asAnna, { typeId: from, level: 2, interest: false });
    await competence.mergeTypes(admin, from, { into });
    const valid = [...store.state.holdings.values()].filter(h => h.state === 'valid');
    expect(valid.map(h => [h.id, h.typeId, h.level])).toEqual([[higher, into, 2]]);
  });
  test("the sources' mappings and their copied rows move to the type merged into", async () => {
    const { from, into } = await pair();
    await competence.seedMapping('operator:test', ORG, 'lms', { sourceType: 'course:7', typeId: from });
    await store.transaction(async tx => {
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
        held('c1', 'anna', from, {
          evidence: 'system',
          registeredBy: null,
          copy: {
            connectorId: 'lms',
            sourceId: 'row-1',
            sourceType: 'course:7',
            sourceLabel: 'Truck',
            readAt: now.toISOString(),
          },
        }),
      ]);
    });
    expect((await competence.mergePreview(admin, from, into)).mappings).toBe(1);
    await competence.mergeTypes(admin, from, { into });
    expect([...store.state.mappings.values()].map(m => [m.sourceType, m.typeId])).toEqual([['course:7', into]]);
    expect(store.state.holdings.get('c1')!.typeId).toBe(into);
  });
  test('refused: into itself, into an archived or a merged type, across a skill, from a merged type, another organisation’s', async () => {
    const { from, into } = await pair();
    const skill = await competence.addType(admin, { name: 'Engelska', area: 'Språk', kind: 'skill' });
    const old = await competence.addType(admin, { name: 'Gammal', area: 'A', kind: 'certificate' });
    await competence.archiveType(admin, old);
    const refusal = async (fromId: string, intoId: string, as = admin) =>
      (await competence.mergeTypes(as, fromId, { into: intoId }).catch(e => e)).message;
    expect(await refusal(from, from)).toBe('En kompetens kan inte slås ihop med sig själv.');
    expect(await refusal(from, old)).toBe('Kompetensen att slå ihop med är arkiverad. Välj en som används.');
    expect(await refusal(from, skill)).toStartWith('En färdighet kan bara slås ihop med en annan färdighet');
    expect(await refusal(skill, from)).toStartWith('En färdighet kan bara slås ihop med en annan färdighet');
    expect(await refusal(from, 'nothing')).toBe('Kompetensen att slå ihop med finns inte i katalogen.');
    expect(await refusal(from, into, elsewhere)).toBe('Kompetensen finns inte i katalogen.');
    // An archived type may be merged away; then neither it nor a type merged into it again.
    await competence.mergeTypes(admin, old, { into });
    expect(await refusal(old, from)).toBe('Kompetensen är redan sammanslagen med en annan.');
    await competence.mergeTypes(admin, from, { into });
    const third = await competence.addType(admin, { name: 'Tredje', area: 'A', kind: 'certificate' });
    expect(await refusal(third, from)).toBe('Kompetensen att slå ihop med är redan sammanslagen med en annan.');
    await expect(competence.mergeTypes(boss, third, { into })).rejects.toBeInstanceOf(ForbiddenError);
  });
  test('a registration waiting for both is said to be there, never who or how many, and the merge waits for its decision', async () => {
    const { from, into } = await pair();
    await put(
      held('p1', 'anna', from, { evidence: 'self', state: 'pending', registeredBy: 'anna', threadId: 'a-1' }),
      held('p2', 'anna', into, { evidence: 'self', state: 'pending', registeredBy: 'anna', threadId: 'a-2' }),
    );
    expect(await competence.mergePreview(admin, from, into)).toMatchObject({ waiting: true, holdings: 0, people: 0 });
    const before = audits().length;
    await expect(competence.mergeTypes(admin, from, { into })).rejects.toThrow(
      'Det finns egna registreringar av båda kompetenserna som väntar på godkännande. Slå ihop dem när registreringarna är granskade.',
    );
    expect(audits()).toHaveLength(before);
    expect(store.state.holdings.get('p1')!.typeId).toBe(from);
  });
});

describe('what a merge shows its administrator (D118)', () => {
  test('from five active people the counts are numbers; a deactivated person, a rejected or waiting registration count for nothing', async () => {
    const from = await competence.addType(admin, {
      name: 'Truckkort',
      area: 'A',
      kind: 'certificate',
      validityMonths: 12,
    });
    const into = await competence.addType(admin, { name: 'Truckförarbevis', area: 'A', kind: 'certificate' });
    const ids = ['p1', 'p2', 'p3', 'p4', 'p5', 'p6'];
    for (const id of ids) store.addPerson({ id, organisationId: ORG, name: 'Person ' + id, userName: id });
    await put(...ids.map(id => held('h-' + id, id, from)));
    store.deactivate('p6');
    await put(
      held('w1', 'p1', from, { evidence: 'self', state: 'pending', registeredBy: 'p1', threadId: 't-w1' }),
      held('r1', 'p2', from, {
        evidence: 'self',
        state: 'rejected',
        registeredBy: 'p2',
        decidedBy: 'boss',
        decidedAt: '2026-02-01T00:00:00.000Z',
      }),
    );
    expect(await competence.mergePreview(admin, from, into)).toMatchObject({
      holdings: 5,
      people: 5,
      ruled: 5,
      waiting: false,
    });
    // One person fewer and the counts are no numbers.
    store.deactivate('p5');
    expect(await competence.mergePreview(admin, from, into)).toMatchObject({
      holdings: 'few',
      people: 'few',
      ruled: 'few',
    });
    const moved = await competence.mergeTypes(admin, from, { into });
    expect(moved).toMatchObject({ holdings: 'few', people: 'few' });
    // The audit row is the trail, not the page: every row that moved, exactly.
    expect(lastAudit().details).toMatchObject({ holdings: 8, people: 6, ruled: 6 });
  });
  test('the preview locks nothing and writes nothing: it reads what stands', async () => {
    const from = await competence.addType(admin, { name: 'A', area: 'X', kind: 'certificate' });
    const into = await competence.addType(admin, { name: 'B', area: 'X', kind: 'certificate' });
    const reads: string[] = [];
    const watched = competenceUsecases({
      store: {
        transaction: fn =>
          store.transaction(tx =>
            fn({
              ...tx,
              type: async id => (reads.push('type'), tx.type(id)),
              holding: async id => (reads.push('holding'), tx.holding(id)),
              lockHoldingsOfTypes: async ids => (reads.push('holdings'), tx.lockHoldingsOfTypes(ids)),
              lockSources: async () => (reads.push('sources'), tx.lockSources()),
            }),
          ),
      },
      staff: async () => ({ units: [] }),
      clock: () => now,
      ids: () => 'w-' + ++n,
    });
    const before = audits().length;
    await watched.mergePreview(admin, from, into);
    expect(reads).toEqual([]);
    expect(audits()).toHaveLength(before);
    await watched.mergeTypes(admin, from, { into });
    expect(reads).toEqual(['sources', 'type', 'type', 'holdings']);
  });
});

describe('an archived type is restored (D108 item 2)', () => {
  test('it takes holdings again, with an audit row; one in use is left as it is', async () => {
    const hot = await competence.addType(admin, { name: 'Heta arbeten', area: 'Säkerhet', kind: 'certificate' });
    await competence.archiveType(admin, hot);
    await competence.restoreType(admin, hot);
    expect((await types()).find(t => t.id === hot)).toMatchObject({ archived: false });
    expect(lastAudit()).toEqual({
      actor: 'person:ada',
      action: 'competence.type_restored',
      subject: 'competence-type:' + hot,
      at: now.toISOString(),
    });
    const count = audits().length;
    await competence.restoreType(admin, hot);
    expect(audits()).toHaveLength(count);
    expect(await competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2026-01-01' })).toBeDefined();
  });
  test('a name another type took meanwhile is refused; and only the administrator restores', async () => {
    const hot = await competence.addType(admin, { name: 'Heta arbeten', area: 'Säkerhet', kind: 'certificate' });
    await competence.archiveType(admin, hot);
    await competence.addType(admin, { name: 'heta arbeten', area: 'Säkerhet', kind: 'certificate' });
    await expect(competence.restoreType(admin, hot)).rejects.toThrow(
      'Det finns redan en kompetens med det namnet. Byt namn på den ena först.',
    );
    await expect(competence.restoreType(boss, hot)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(competence.restoreType(elsewhere, hot)).rejects.toThrow('Kompetensen finns inte i katalogen.');
  });
});

describe('the export carries what an import and a merge leave (D108 item 14)', () => {
  test(`a type's address and what it was merged into are in ${COMPETENCE_EXPORT_FORMAT}`, async () => {
    await competence.importTypes(admin, { format: 'esco', rows: [escoRow(2, 'leda ett team')] });
    const a = await competence.addType(admin, { name: 'A', area: 'X', kind: 'certificate' });
    const b = await competence.addType(admin, { name: 'B', area: 'X', kind: 'certificate' });
    await competence.mergeTypes(admin, a, { into: b });
    const doc = await competence.exportDomain('operator:cli', ORG);
    expect(doc.format).toBe('clew.competence/8');
    expect(doc.types.map(t => [t.name, t.sourceUri, t.mergedInto])).toEqual([
      ['leda ett team', escoUri(2), null],
      ['A', null, b],
      ['B', null, null],
    ]);
  });
});
