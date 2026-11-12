import { beforeEach, describe, expect, test } from 'bun:test';
import {
  checkContract,
  CompetenceAttentionOutputSchema,
  CompetenceHoldingsOutputSchema,
  CompetenceMatrixOutputSchema,
  type AuthenticatedContext,
  type CompetenceMatrixCell,
  type CompetenceMatrixOutput,
  type StaffOverview,
  type StaffPerson,
} from '../../packages/contracts/src/index';
import { menuEligible, viewProblem, type Actor } from '../../packages/connectors/src/index';
import { ForbiddenError } from '../../apps/server/src/context';
import {
  memoryCompetenceStore,
  type MemoryCompetenceStore,
} from '../../apps/server/src/modules/competence/adapters/memory';
import {
  attentionView,
  competenceConnector,
  coverageView,
  holdingsView,
  personView,
  unitView,
} from '../../apps/server/src/modules/competence/capabilities';
import {
  addMonths,
  branchOf,
  coverageOf,
  deciding,
  endOf,
  COVERAGE_MIN_GROUP,
  countable,
  organisationOutcome,
  matrixCellText,
  matrixCsv,
  personStatus,
  requiredOf,
  statusOn,
} from '../../apps/server/src/modules/competence/domain';
import type {
  HoldingRecord,
  RequirementRecord,
  ShareTargetRecord,
  TypeRecord,
} from '../../apps/server/src/modules/competence/model';
import {
  CompetenceError,
  competenceUsecases,
  type CompetenceUsecases,
} from '../../apps/server/src/modules/competence/usecases';
import { Registry } from '../registry';

/**
 * The competence module's use cases (D108) on the memory adapter, with a clock, ids and a staff port the test owns:
 * every mutation's audit row and that none carries a person's or a type's name; where a holding stands is computed
 * from the dates on the day asked; a manager's reach is their reports now, so a former manager reaches nothing; and
 * the built-in connector answers through the registry with a figure and cards derived from the same dates.
 */
const ORG = 'org-1';
const person = (id: string, name: string, userName: string | null, enabled = true): StaffPerson => ({
  id,
  name,
  userName,
  email: null,
  role: 'employee',
  enabled,
});
const anna = person('anna', 'Anna Andersson', 'anna.a');
const bo = person('bo', 'Bo Berg', null); // provisioned without a user name: keyed on his id
const cia = person('cia', 'Cia Carlsson', 'cia.c', false); // deactivated
const dan = person('dan', 'Dan Dahl', 'dan.d'); // reports to the other manager
const NAMES = ['Anna Andersson', 'Bo Berg', 'Cia Carlsson', 'Dan Dahl', 'Karin Chef', 'Olle Chef', 'Ada Admin'];
const TYPE_NAMES = ['Heta arbeten', 'HLR', 'Fallskydd', 'Socionomexamen'];

function personaOf(
  id: string,
  role: 'manager' | 'employee',
  name = id,
  capabilities: AuthenticatedContext['capabilities'] = [],
): AuthenticatedContext & { authorized: number } {
  const persona = {
    id,
    name,
    unitId: 'u1',
    unitLabel: 'Enhet 1',
    role,
    organisationId: ORG,
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
const other = personaOf('other', 'manager', 'Olle Chef');
const admin = personaOf('ada', 'employee', 'Ada Admin', ['admin.competence']);
const asAnna = personaOf('anna', 'employee', 'Anna Andersson');
const asBo = personaOf('bo', 'employee', 'Bo Berg');

let now: Date;
let n: number;
let staff: Map<string, StaffOverview>;
let store: MemoryCompetenceStore;
let competence: CompetenceUsecases;
beforeEach(() => {
  // A Tuesday morning in Sweden: the day is 2026-11-10.
  now = new Date('2026-11-10T09:00:00.000Z');
  n = 0;
  admin.authorized = 0;
  staff = new Map([
    [
      'boss',
      {
        units: [
          { unitId: 'u1', unitLabel: 'Enhet 1', people: [anna, bo, cia, person('boss', 'Karin Chef', 'boss')] },
          { unitId: 'u2', unitLabel: 'Enhet 2', people: [anna] },
        ],
      },
    ],
    ['other', { units: [{ unitId: 'u3', unitLabel: 'Enhet 3', people: [dan] }] }],
  ]);
  store = memoryCompetenceStore({
    persons: [anna, bo, cia, dan, { id: 'boss', name: 'Karin Chef', userName: 'boss' }].map(p => ({
      id: p.id,
      organisationId: ORG,
      name: p.name,
      userName: p.userName,
    })),
  });
  competence = competenceUsecases({
    store,
    staff: async persona => staff.get(persona.id) ?? { units: [] },
    clock: () => now,
    ids: () => 'id-' + ++n,
  });
});
const audits = () => store.audit();
const lastAudit = () => audits().at(-1)!;
/** A catalogue of three types: one with the employer's rule, two without. */
async function catalogue() {
  const hot = await competence.addType(admin, { name: 'Heta arbeten', area: 'Säkerhet', kind: 'certificate' });
  const hlr = await competence.addType(admin, { name: 'HLR', area: 'Akut', kind: 'course', validityMonths: 24 });
  const degree = await competence.addType(admin, { name: 'Socionomexamen', area: 'Examen', kind: 'degree' });
  return { hot, hlr, degree };
}

describe('the dates', () => {
  const type = (validityMonths: number | null) => ({ validityMonths });
  test("a holding ends on the issuer's date, else by the employer's rule, else never", () => {
    expect(endOf({ issuedOn: '2024-03-10', expiresOn: '2029-03-09' }, type(24))).toBe('2029-03-09');
    expect(endOf({ issuedOn: '2024-03-10', expiresOn: null }, type(24))).toBe('2026-03-10');
    expect(endOf({ issuedOn: '2024-03-10', expiresOn: null }, type(null))).toBeNull();
  });
  test('months are added on the calendar: a day the later month lacks is its last', () => {
    expect(addMonths('2025-01-31', 1)).toBe('2025-02-28');
    expect(addMonths('2024-01-31', 1)).toBe('2024-02-29');
    expect(addMonths('2025-11-15', 3)).toBe('2026-02-15');
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
  });
  test('the last day is still valid, 90 days ahead is expiring and 91 is not', () => {
    expect(statusOn('2026-11-09', '2026-11-10')).toBe('expired');
    expect(statusOn('2026-11-10', '2026-11-10')).toBe('expiring');
    expect(statusOn('2027-02-08', '2026-11-10')).toBe('expiring'); // 90 days
    expect(statusOn('2027-02-09', '2026-11-10')).toBe('valid'); // 91 days
    expect(statusOn(null, '2026-11-10')).toBe('valid');
  });
  test('of several holdings of one type the one that ends last decides; a revoked or pending one never does', () => {
    const t: TypeRecord = {
      id: 't',
      organisationId: ORG,
      name: 'Heta arbeten',
      area: 'Säkerhet',
      kind: 'certificate',
      validityMonths: null,
      archivedAt: null,
      createdBy: 'x',
      createdAt: now.toISOString(),
    };
    const h = (id: string, extra: Partial<HoldingRecord>): HoldingRecord => ({
      id,
      personId: 'anna',
      typeId: 't',
      issuedOn: '2020-01-01',
      expiresOn: null,
      evidence: 'manager',
      state: 'valid',
      registeredBy: null,
      createdAt: now.toISOString(),
      revokedAt: null,
      revokedBy: null,
      copy: null,
      ...extra,
    });
    const types = new Map([[t.id, t]]);
    const pick = (holdings: HoldingRecord[]) =>
      deciding(holdings, types, '2026-11-10').map(s => [s.holding?.id, s.status]);
    expect(pick([h('old', { expiresOn: '2026-01-01' }), h('new', { expiresOn: '2030-01-01' })])).toEqual([
      ['new', 'valid'],
    ]);
    // A newer one that is revoked or still pending leaves the expired one deciding.
    expect(
      pick([
        h('old', { expiresOn: '2026-01-01' }),
        h('revoked', { expiresOn: '2030-01-01', state: 'revoked' }),
        h('pending', { expiresOn: '2030-01-01', state: 'pending' }),
      ]),
    ).toEqual([['old', 'expired']]);
    // One that never ends decides before any that does.
    expect(pick([h('ends', { expiresOn: '2030-01-01' }), h('never', {})])).toEqual([['never', 'valid']]);
    // A holding of a type the catalogue does not have is left out.
    expect(pick([h('lost', { typeId: 'gone' })])).toEqual([]);
  });
});

describe('the catalogue', () => {
  test('an administrator adds a type after the step-up, with an audit row that names neither the type nor a person', async () => {
    const id = await competence.addType(admin, { name: '  Heta   arbeten ', area: 'Säkerhet', kind: 'certificate' });
    expect(admin.authorized).toBe(1);
    expect(store.state.types.get(id)).toMatchObject({
      name: 'Heta arbeten',
      area: 'Säkerhet',
      kind: 'certificate',
      validityMonths: null,
      archivedAt: null,
      createdBy: 'person:ada',
      organisationId: ORG,
    });
    expect(audits()).toEqual([
      {
        actor: 'person:ada',
        action: 'competence.type_added',
        subject: 'competence-type:' + id,
        at: now.toISOString(),
        details: { organisationId: ORG, kind: 'certificate', validityMonths: null },
      },
    ]);
  });
  test('nobody without the capability changes the catalogue, a manager included, and nothing is written', async () => {
    for (const persona of [boss, asAnna]) {
      await expect(competence.addType(persona, { name: 'HLR', area: 'Akut', kind: 'course' })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
      await expect(competence.updateType(persona, 'x', { name: 'Y' })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(competence.archiveType(persona, 'x')).rejects.toBeInstanceOf(ForbiddenError);
      await expect(competence.validityImpact(persona, 'x', 12)).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(store.state.types.size).toBe(0);
    expect(audits()).toEqual([]);
  });
  test('a name the organisation already uses, a blank name and a blank area are turned down in Swedish', async () => {
    await competence.addType(admin, { name: 'HLR', area: 'Akut', kind: 'course' });
    const again = competence.addType(admin, { name: 'hlr', area: 'Akut', kind: 'course' });
    await expect(again).rejects.toBeInstanceOf(CompetenceError);
    await expect(again).rejects.toThrow('Det finns redan en kompetens med det namnet.');
    await expect(competence.addType(admin, { name: '   ', area: 'Akut', kind: 'course' })).rejects.toThrow(
      'Ange ett namn på högst 120 tecken.',
    );
    await expect(competence.addType(admin, { name: 'Ny', area: ' ', kind: 'course' })).rejects.toThrow(
      'Ange ett område på högst 80 tecken.',
    );
    expect(store.state.types.size).toBe(1);
    expect(audits()).toHaveLength(1);
  });
  test('an administrator reads every type, a manager the ones that can be registered, anyone else is refused', async () => {
    const { hot, hlr } = await catalogue();
    await competence.archiveType(admin, hot);
    const read = async (p: AuthenticatedContext) => (await competence.types(p)).rows.map(t => [t.name, t.archived]);
    expect(await read(admin)).toEqual([
      ['HLR', false],
      ['Socionomexamen', false],
      ['Heta arbeten', true],
    ]);
    expect(await read(boss)).toEqual([
      ['HLR', false],
      ['Socionomexamen', false],
    ]);
    expect((await competence.types(boss)).rows[0]).toEqual({
      id: hlr,
      name: 'HLR',
      area: 'Akut',
      kind: 'course',
      validityMonths: 24,
      archived: false,
    });
    await expect(competence.types(asAnna)).rejects.toBeInstanceOf(ForbiddenError);
  });
  test('a change is audited with what changed and the validity before and after; a change of nothing writes nothing', async () => {
    const { hlr } = await catalogue();
    const before = audits().length;
    await competence.updateType(admin, hlr, { name: 'HLR', validityMonths: 24 });
    expect(audits()).toHaveLength(before);
    await competence.updateType(admin, hlr, { area: 'Vård', validityMonths: 12 });
    expect(store.state.types.get(hlr)).toMatchObject({ area: 'Vård', validityMonths: 12, name: 'HLR' });
    expect(lastAudit()).toEqual({
      actor: 'person:ada',
      action: 'competence.type_changed',
      subject: 'competence-type:' + hlr,
      at: now.toISOString(),
      details: { changed: ['area', 'validityMonths'], validityBefore: 24, validityAfter: 12 },
    });
    await competence.updateType(admin, hlr, { validityMonths: null });
    expect(lastAudit().details).toEqual({ changed: ['validityMonths'], validityBefore: 12, validityAfter: null });
    await expect(competence.updateType(admin, 'nope', { name: 'X' })).rejects.toThrow(
      'Kompetensen finns inte i katalogen.',
    );
  });
  test('a new validity is counted before it is confirmed, over the holdings that end by the rule', async () => {
    const { hlr } = await catalogue();
    // Issued 18 months ago: valid under 24 months, expired under 12. Bo's has the issuer's own date and is not counted.
    await competence.registerHolding(boss, 'anna', { typeId: hlr, issuedOn: '2025-05-10' });
    await competence.registerHolding(boss, 'bo', { typeId: hlr, issuedOn: '2025-05-10', expiresOn: '2030-01-01' });
    const written = audits().length;
    expect(await competence.validityImpact(admin, hlr, 12)).toEqual({ holdings: 1, expiredBefore: 0, expiredAfter: 1 });
    expect(await competence.validityImpact(admin, hlr, null)).toEqual({
      holdings: 1,
      expiredBefore: 0,
      expiredAfter: 0,
    });
    expect(audits()).toHaveLength(written);
    // Confirmed, the status follows at once: nothing about the holding was rewritten.
    await competence.updateType(admin, hlr, { validityMonths: 12 });
    expect((await competence.holdings(asAnna)).rows.map(r => [r.competence, r.status, r.expiresOn])).toEqual([
      ['HLR', 'expired', '2026-05-10'],
    ]);
  });
  test('an archived type takes no new holding and keeps the ones it has; archiving twice is audited once', async () => {
    const { hot } = await catalogue();
    await competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2026-01-10', expiresOn: '2031-01-09' });
    await competence.archiveType(admin, hot);
    await competence.archiveType(admin, hot);
    expect(audits().filter(a => a.action === 'competence.type_archived')).toEqual([
      {
        actor: 'person:ada',
        action: 'competence.type_archived',
        subject: 'competence-type:' + hot,
        at: now.toISOString(),
      },
    ]);
    await expect(competence.registerHolding(boss, 'bo', { typeId: hot, issuedOn: '2026-01-10' })).rejects.toThrow(
      'Kompetensen är arkiverad och kan inte registreras.',
    );
    expect((await competence.holdings(asAnna)).rows.map(r => r.competence)).toEqual(['Heta arbeten']);
  });
});

describe('a manager registers a certificate', () => {
  test('for a person who reports to them, with an audit row of ids and dates', async () => {
    const { hot } = await catalogue();
    const id = await competence.registerHolding(boss, 'anna', {
      typeId: hot,
      issuedOn: '2026-01-10',
      expiresOn: '2031-01-09',
    });
    expect(store.state.holdings.get(id)).toEqual({
      id,
      personId: 'anna',
      typeId: hot,
      issuedOn: '2026-01-10',
      expiresOn: '2031-01-09',
      evidence: 'manager',
      state: 'valid',
      registeredBy: 'boss',
      createdAt: now.toISOString(),
      revokedAt: null,
      revokedBy: null,
      copy: null,
    });
    expect(lastAudit()).toEqual({
      actor: 'person:boss',
      action: 'competence.holding_registered',
      subject: 'holding:' + id,
      at: now.toISOString(),
      details: { personId: 'anna', typeId: hot, issuedOn: '2026-01-10', expiresOn: '2031-01-09' },
    });
  });
  test('not for themselves, a deactivated person, another manager’s report or as someone who manages nobody', async () => {
    const { hot } = await catalogue();
    const body = { typeId: hot, issuedOn: '2026-01-10' };
    const written = audits().length;
    for (const [persona, personId, message] of [
      [boss, 'boss', 'Personen finns inte bland dem du är chef för.'],
      [boss, 'cia', 'Personen finns inte bland dem du är chef för.'],
      [boss, 'dan', 'Personen finns inte bland dem du är chef för.'],
      [asAnna, 'bo', 'Intyg registreras av den som är chef för en enhet.'],
    ] as const) {
      const attempt = competence.registerHolding(persona, personId, body);
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
      await expect(attempt).rejects.toThrow(message);
    }
    expect(store.state.holdings.size).toBe(0);
    expect(audits()).toHaveLength(written);
  });
  test('the reach is the reports now: the day the line changes, the former manager registers and revokes nothing', async () => {
    const { hot } = await catalogue();
    const id = await competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2026-01-10' });
    staff.set('boss', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [bo] }] });
    staff.set('other', { units: [{ unitId: 'u3', unitLabel: 'Enhet 3', people: [dan, anna] }] });
    await expect(
      competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2026-02-10' }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(competence.revokeHolding(boss, id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(competence.holdings(boss, { person: 'anna.a' })).rejects.toBeInstanceOf(ForbiddenError);
    // The manager she reports to now does both.
    expect((await competence.holdings(other, { person: 'anna.a' })).rows).toHaveLength(1);
    await competence.revokeHolding(other, id);
    expect(store.state.holdings.get(id)?.state).toBe('revoked');
  });
  test('the dates are checked: a real day, not after today in Sweden, and no end before the issue', async () => {
    const { hot } = await catalogue();
    const tryWith = (issuedOn: string, expiresOn?: string) =>
      competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn, ...(expiresOn ? { expiresOn } : {}) });
    await expect(tryWith('2026-02-30')).rejects.toThrow('Ange ett giltigt datum.');
    await expect(tryWith('2026-11-11')).rejects.toThrow('Ett intyg kan inte vara utfärdat en dag som inte har kommit.');
    await expect(tryWith('2026-01-10', '2026-13-01')).rejects.toThrow('Ange ett giltigt datum.');
    await expect(tryWith('2026-01-10', '2026-01-09')).rejects.toThrow('Slutdatumet kan inte vara före utfärdandet.');
    // Late in the evening in UTC it is already tomorrow in Sweden, and that day can be registered.
    now = new Date('2026-11-10T23:30:00.000Z');
    await tryWith('2026-11-11');
    expect(store.state.holdings.size).toBe(1);
  });
  test('a type that is unknown or belongs to another organisation is turned down the same way', async () => {
    await catalogue();
    const foreign = await competence.seedType('operator:test', 'org-2', { name: 'Annan', area: 'X', kind: 'course' });
    for (const typeId of ['nope', foreign])
      await expect(competence.registerHolding(boss, 'anna', { typeId, issuedOn: '2026-01-10' })).rejects.toThrow(
        'Kompetensen finns inte i katalogen.',
      );
    expect(store.state.holdings.size).toBe(0);
  });
  test('a revocation keeps the row, counts towards nothing and is audited once', async () => {
    const { hot } = await catalogue();
    const id = await competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2026-01-10' });
    now = new Date('2026-11-11T09:00:00.000Z');
    await competence.revokeHolding(boss, id);
    await competence.revokeHolding(boss, id);
    expect(store.state.holdings.get(id)).toMatchObject({
      state: 'revoked',
      revokedAt: now.toISOString(),
      revokedBy: 'boss',
    });
    expect(audits().filter(a => a.action === 'competence.holding_revoked')).toEqual([
      {
        actor: 'person:boss',
        action: 'competence.holding_revoked',
        subject: 'holding:' + id,
        at: now.toISOString(),
        details: { personId: 'anna', typeId: hot },
      },
    ]);
    expect((await competence.holdings(asAnna)).rows).toEqual([]);
    await expect(competence.revokeHolding(other, id)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(competence.revokeHolding(boss, 'nope')).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('the reads', () => {
  /** Anna: an expired certificate, a course that expires in 61 days and a degree. Bo: a certificate valid for years. */
  async function world() {
    const types = await catalogue();
    await competence.registerHolding(boss, 'anna', {
      typeId: types.hot,
      issuedOn: '2021-06-01',
      expiresOn: '2026-05-31',
    });
    await competence.registerHolding(boss, 'anna', { typeId: types.hlr, issuedOn: '2025-01-10' }); // ends 2027-01-10
    await competence.registerHolding(boss, 'anna', { typeId: types.degree, issuedOn: '2015-06-05' });
    await competence.registerHolding(boss, 'bo', {
      typeId: types.hot,
      issuedOn: '2025-03-01',
      expiresOn: '2030-02-28',
    });
    return types;
  }
  test('a person reads their own, what needs them first, each row with its computed end and status', async () => {
    await world();
    const out = await competence.holdings(asAnna);
    expect(checkContract(CompetenceHoldingsOutputSchema, out)).toBe(true);
    expect(out.rows.map(r => [r.competence, r.status, r.expiresOn ?? null])).toEqual([
      ['Heta arbeten', 'expired', '2026-05-31'],
      ['HLR', 'expiring', '2027-01-10'],
      ['Socionomexamen', 'valid', null],
    ]);
    expect(out.rows[0]).toMatchObject({
      userName: 'anna.a',
      name: 'Anna Andersson',
      area: 'Säkerhet',
      kind: 'certificate',
      issuedOn: '2021-06-01',
      evidence: 'manager',
    });
    expect(out.rows[0]!.ref).toMatch(/^holding:competence:id-\d+$/);
  });
  test('a manager reads a report by user name, or by id where the person has none; nobody else', async () => {
    await world();
    expect((await competence.holdings(boss, { person: 'anna.a' })).rows).toHaveLength(3);
    const ofBo = await competence.holdings(boss, { person: 'bo' });
    expect(ofBo.rows.map(r => [r.userName, r.name, r.status])).toEqual([['bo', 'Bo Berg', 'valid']]);
    await expect(competence.holdings(boss, { person: 'dan.d' })).rejects.toThrow(
      'Personen finns inte bland dem du är chef för.',
    );
    await expect(competence.holdings(boss, { person: 'cia.c' })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(competence.holdings(asBo, { person: 'anna.a' })).rejects.toThrow(
      'Intyg registreras av den som är chef för en enhet.',
    );
  });
  test("what needs attention is the reports' expired and expiring holdings, the expired first; a renewal clears the row", async () => {
    const types = await world();
    const out = await competence.attention(boss);
    expect(checkContract(CompetenceAttentionOutputSchema, out)).toBe(true);
    expect(out.rows.map(r => [r.name, r.competence, r.status])).toEqual([
      ['Anna Andersson', 'Heta arbeten', 'expired'],
      ['Anna Andersson', 'HLR', 'expiring'],
    ]);
    expect(await competence.summary(boss)).toEqual({ expired: 1, missing: 0, expiring: 1, people: 1, reports: 2 });
    await competence.registerHolding(boss, 'anna', {
      typeId: types.hot,
      issuedOn: '2026-11-01',
      expiresOn: '2031-10-31',
    });
    expect((await competence.attention(boss)).rows.map(r => r.competence)).toEqual(['HLR']);
    expect(await competence.summary(boss)).toEqual({ expired: 0, missing: 0, expiring: 1, people: 1, reports: 2 });
    // Another manager sees none of it, and someone who manages nobody is refused the list and has no summary.
    expect((await competence.attention(other)).rows).toEqual([]);
    await expect(competence.attention(asAnna)).rejects.toBeInstanceOf(ForbiddenError);
    expect(await competence.summary(asAnna)).toBeNull();
  });
  test('about people: one row per report asked by user name, the counts, and a row for someone who holds nothing', async () => {
    await world();
    staff.get('boss')!.units[0]!.people.push(person('eve', 'Eve Ek', 'eve.e'));
    // Asked without regard to case; Bo has no user name, Cia is deactivated, Dan reports to another manager.
    const out = await competence.aboutPeople(boss, ['Anna.A', 'eve.e', 'bo', 'cia.c', 'dan.d', 'nobody', 'Anna.A']);
    expect(out.rows).toEqual([
      { key: 'Anna.A', expired: 1, missing: 0, expiring: 1, holdings: 3 },
      // Nothing registered yet: the row is where a first certificate is registered from.
      { key: 'eve.e', expired: 0, missing: 0, expiring: 0, holdings: 0 },
    ]);
    // Someone who manages nobody, and another manager, reach none of them.
    expect((await competence.aboutPeople(asAnna, ['anna.a', 'eve.e'])).rows).toEqual([]);
    expect((await competence.aboutPeople(other, ['anna.a'])).rows).toEqual([]);
    expect((await competence.aboutPeople(boss, [])).rows).toEqual([]);
    // A row's key opens the holdings, the reader's own included.
    expect((await competence.holdings(boss, { person: 'anna.a' })).rows).toHaveLength(3);
    expect((await competence.holdings(asAnna, { person: 'anna.a' })).rows).toHaveLength(3);
  });
  test('the day decides: the same holdings read later have moved on, with nothing rewritten', async () => {
    await world();
    const before = structuredClone(store.state.holdings);
    now = new Date('2027-01-11T09:00:00.000Z');
    expect((await competence.holdings(asAnna)).rows.map(r => [r.competence, r.status])).toEqual([
      ['Heta arbeten', 'expired'],
      ['HLR', 'expired'],
      ['Socionomexamen', 'valid'],
    ]);
    expect(store.state.holdings).toEqual(before);
  });
});

describe('erasure and export', () => {
  test("erasing a person removes their holdings and their id from other people's, audited with counts only", async () => {
    const { hot } = await catalogue();
    await competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2026-01-10' });
    await competence.registerHolding(boss, 'bo', { typeId: hot, issuedOn: '2026-01-10' });
    // Erasure is for a person the directory has deactivated (D108 item 14).
    store.deactivate('anna');
    expect(await competence.erasePerson('operator:cli', 'anna')).toEqual({ holdings: 1, cleared: 0, requirements: 0 });
    expect(lastAudit()).toEqual({
      actor: 'operator:cli',
      action: 'competence.person_erased',
      subject: 'person:anna',
      at: now.toISOString(),
      details: { holdings: 1, cleared: 0, requirements: 0 },
    });
    // The manager who registered is erased: the holdings stay, without her id.
    store.deactivate('boss');
    expect(await competence.erasePerson('operator:cli', 'boss')).toEqual({ holdings: 0, cleared: 1, requirements: 0 });
    expect([...store.state.holdings.values()].map(h => [h.personId, h.registeredBy])).toEqual([['bo', null]]);
  });
  test('the export is one versioned document of the organisation, audited with counts', async () => {
    const { hot } = await catalogue();
    await competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2026-01-10' });
    await competence.seedType('operator:test', 'org-2', { name: 'Annan', area: 'X', kind: 'course' });
    const doc = await competence.exportDomain('operator:cli', ORG);
    expect(doc).toMatchObject({ format: 'clew.competence/4', exportedAt: now.toISOString(), organisationId: ORG });
    expect(doc.types.map(t => t.name).sort()).toEqual(['HLR', 'Heta arbeten', 'Socionomexamen']);
    expect(doc.holdings).toHaveLength(1);
    expect(lastAudit()).toEqual({
      actor: 'operator:cli',
      action: 'competence.exported',
      subject: 'organisation:' + ORG,
      at: now.toISOString(),
      details: { types: 3, holdings: 1, mappings: 0, requirements: 0, shareTargets: 0 },
    });
  });
});

test('no audit row carries a name: of a person or of a type', async () => {
  const { hot, hlr } = await catalogue();
  const id = await competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2026-01-10' });
  await competence.registerHolding(boss, 'bo', { typeId: hlr, issuedOn: '2026-01-10' });
  await competence.updateType(admin, hlr, { name: 'Fallskydd', validityMonths: 36 });
  await competence.revokeHolding(boss, id);
  await competence.archiveType(admin, hot);
  store.deactivate('bo');
  await competence.erasePerson('operator:cli', 'bo');
  await competence.exportDomain('operator:cli', ORG);
  const written = JSON.stringify(audits());
  expect(audits().length).toBeGreaterThan(8);
  for (const name of [...NAMES, ...TYPE_NAMES]) expect(written).not.toContain(name);
});

describe('the built-in connector', () => {
  const actor = (p: AuthenticatedContext): Actor => ({
    id: p.id,
    name: p.name,
    unitId: p.unitId,
    unitLabel: p.unitLabel,
    role: p.role,
  });
  const personas = new Map([boss, other, asAnna, asBo].map(p => [p.id, p]));
  const connector = () =>
    competenceConnector(competence, async a => {
      const p = personas.get(a.id);
      if (!p) throw new Error('unknown');
      return p;
    });
  const registry = () => new Registry().register(connector());
  async function world() {
    const types = await catalogue();
    await competence.registerHolding(boss, 'anna', {
      typeId: types.hot,
      issuedOn: '2021-06-01',
      expiresOn: '2026-05-31',
    });
    await competence.registerHolding(boss, 'anna', { typeId: types.hlr, issuedOn: '2025-01-10' });
    await competence.registerHolding(boss, 'bo', {
      typeId: types.hot,
      issuedOn: '2025-03-01',
      expiresOn: '2030-02-28',
    });
    return types;
  }

  test('it passes the registry validation, no read is a model tool, and the two lists open without input', () => {
    const c = connector();
    expect(() => registry()).not.toThrow();
    expect(c).toMatchObject({ id: 'competence', kind: 'core', source: 'Kompetens' });
    expect(c.capabilities.map(x => [x.name, x.kind, x.model, x.about?.entity ?? null])).toEqual([
      ['competence.attention', 'read', false, null],
      ['competence.holdings', 'read', false, null],
      ['competence.person', 'read', false, 'person'],
      ['competence.unit', 'read', false, 'unit'],
      ['competence.coverage', 'read', false, null],
    ]);
    for (const x of c.capabilities) expect(viewProblem(x, c.capabilities)).toBeUndefined();
    // The reads about a person and a unit take the keys they are asked with, and the table a unit's row opens takes
    // the unit, so none of them is a place in the menu.
    expect(c.capabilities.map(x => menuEligible(x))).toEqual([true, true, false, false, false]);
    expect([attentionView, holdingsView, personView, unitView, coverageView].some(v => 'ref' in v)).toBe(false);
  });

  test('the read about a person is placed by the registry: a section source with the dialog as its page, and words a person reads', async () => {
    await world();
    const r = registry();
    const [read] = r.aboutReads(actor(boss), 'person');
    expect(read).toMatchObject({
      name: 'competence.person',
      source: 'Kompetens',
      title: 'Kompetens',
      core: true,
      lens: false,
      page: { title: 'Registrera intyg', href: '/staff?register={id}' },
    });
    expect(r.aboutReads(actor(asAnna), 'person')).toEqual([]);
    staff.get('boss')!.units[0]!.people.push(person('eve', 'Eve Ek', 'eve.e'));
    const out = await r.run<{ rows: unknown[] }>(actor(boss), 'competence.person', {
      keys: ['anna.a', 'eve.e', 'dan.d'],
    });
    expect(out.rows).toEqual([
      { key: 'anna.a', status: 'Utgånget', due: '1 har gått ut, 1 går ut inom 90 dagar', held: '2 registrerade' },
      { key: 'eve.e', status: 'Inget registrerat', held: 'Inga' },
    ]);
    // Only what has run out or soon will has a tone, so only that is a mark on a row.
    expect(personView.kind === 'list' && personView.fields[0]!.tones).toEqual({
      Utgånget: 'alert',
      Saknas: 'alert',
      'Går ut snart': 'warn',
    });
  });

  test('the reads answer through the registry within their scope', async () => {
    await world();
    const r = registry();
    const mine = await r.run<{ rows: unknown[] }>(actor(asAnna), 'competence.holdings', {});
    expect(mine.rows).toHaveLength(2);
    const due = await r.run<{ rows: Array<{ competence: string }> }>(actor(boss), 'competence.attention', {});
    expect(due.rows.map(x => x.competence)).toEqual(['Heta arbeten', 'HLR']);
    await expect(r.run(actor(asAnna), 'competence.attention', {})).rejects.toThrow();
  });

  test('the figure says what has run out for a manager, is calm when nothing has, and is absent for an employee', async () => {
    const r = registry();
    const figureOf = async (p: AuthenticatedContext) =>
      (await r.areas(actor(p))).find(a => a.id === 'competence')?.figure ?? null;
    expect(await figureOf(boss)).toMatchObject({ label: 'Inga intyg saknas eller går ut inom 90 dagar.', tone: 'ok' });
    const types = await world();
    expect(await figureOf(boss)).toMatchObject({
      label: 'Intyg som har gått ut',
      value: '1',
      comparison: '1 till går ut inom 90 dagar',
      tone: 'alert',
      opens: { capability: 'competence.attention', title: 'Intyg att åtgärda' },
    });
    await competence.registerHolding(boss, 'anna', {
      typeId: types.hot,
      issuedOn: '2026-11-01',
      expiresOn: '2031-10-31',
    });
    expect(await figureOf(boss)).toMatchObject({ label: 'Intyg som går ut inom 90 dagar', value: '1', tone: 'warn' });
    expect(await figureOf(asAnna)).toBeNull();
  });

  test('the scan gives a person one card per holding of their own, with the end date as the deadline', async () => {
    await world();
    const drafts = await registry().scan(actor(asAnna));
    expect(drafts.map(d => [d.title, d.reason, d.deadline])).toEqual([
      ['Heta arbeten gick ut 31 maj', 'Har gått ut', '2026-05-31'],
      ['HLR går ut 10 januari', 'Går ut inom 90 dagar', '2027-01-10'],
    ]);
    expect(drafts.every(d => d.area === 'competence' && d.connector === 'competence')).toBe(true);
    expect(drafts[0]!.topic).toMatch(/^competence:holding:id-\d+$/);
    expect(drafts[0]!.actions).toEqual([
      { id: 'open', label: 'Visa mina kompetenser', capability: 'competence.holdings', kind: 'read', role: 'primary' },
    ]);
    // Bo's certificate is valid for years: nothing to say.
    expect(await registry().scan(actor(asBo))).toEqual([]);
  });

  test("the manager's card counts and names nobody, and goes when nothing is due", async () => {
    const types = await world();
    const [card] = await registry().scan(actor(boss));
    expect(card).toMatchObject({
      topic: 'competence:attention',
      title: 'Intyg att åtgärda bland dina medarbetare',
      summary: '1 intyg har gått ut och 1 intyg går ut inom 90 dagar, hos 1 person.',
      reason: 'Intyg har gått ut',
    });
    expect(card!.actions.map(a => a.capability)).toEqual(['competence.attention']);
    const text = JSON.stringify(card);
    for (const name of [...NAMES, ...TYPE_NAMES]) expect(text).not.toContain(name);
    await competence.registerHolding(boss, 'anna', {
      typeId: types.hot,
      issuedOn: '2026-11-01',
      expiresOn: '2031-10-31',
    });
    await competence.updateType(admin, types.hlr, { validityMonths: null });
    expect(await registry().scan(actor(boss))).toEqual([]);
  });
});

/**
 * Requirements, the status `missing`, coverage and share targets (D108 items 4, 6 and 8). The directory as SCIM writes
 * it: two positions, a tree where Enhet 3 stands under Enhet 1 and Enhet 2 is a root of its own; Anna on Enhet 1 and 2
 * holding the undersköterska position, Bo on Enhet 1 holding both, Dan on Enhet 3 (another manager's report, in Karin's
 * branch) holding the undersköterska position, Cia deactivated on Enhet 1, and the manager herself on Enhet 1.
 */
describe('requirements, missing and coverage (D108 item 6)', () => {
  /** The positions by their codes, as requirements name them; the rows are the store's own (`pos-<code>`). */
  const USK = 'usk',
    SSK = 'ssk';
  function directory() {
    store.addPosition({ id: 'pos-usk', organisationId: ORG, code: USK, label: 'Undersköterska' });
    store.addPosition({ id: 'pos-ssk', organisationId: ORG, code: SSK, label: 'Sjuksköterska' });
    store.addPosition({ id: 'pos-foreign', organisationId: 'org-2', code: 'tolk', label: 'Tolk' });
    store.addUnit({ id: 'u1', organisationId: ORG, label: 'Enhet 1', parentId: null });
    store.addUnit({ id: 'u3', organisationId: ORG, label: 'Enhet 3', parentId: 'u1' });
    store.addUnit({ id: 'u2', organisationId: ORG, label: 'Enhet 2', parentId: null });
    store.addUnit({ id: 'u-foreign', organisationId: 'org-2', label: 'Annan enhet', parentId: null });
    for (const [personId, unitId] of [
      ['anna', 'u1'],
      ['anna', 'u2'],
      ['bo', 'u1'],
      ['cia', 'u1'],
      ['boss', 'u1'],
      ['dan', 'u3'],
    ])
      store.assign(personId!, unitId!);
    store.deactivate('cia');
    store.holdPosition('anna', 'pos-usk');
    store.holdPosition('bo', 'pos-usk');
    store.holdPosition('bo', 'pos-ssk');
    store.holdPosition('dan', 'pos-usk');
  }
  const ids = { organisationId: ORG, positionCode: null, unitId: null, personId: null };

  describe('the requirements an administrator keeps', () => {
    test('an administrator adds one on a position and one on a unit after the step-up, each audited with ids only', async () => {
      directory();
      const { hlr, degree } = await catalogue();
      const before = admin.authorized;
      const onPosition = await competence.addRequirement(admin, { typeId: hlr, positionCode: USK });
      expect(store.state.requirements.get(onPosition)).toEqual({
        id: onPosition,
        organisationId: ORG,
        typeId: hlr,
        positionCode: USK,
        unitId: null,
        personId: null,
        minLevel: null,
        createdBy: 'person:ada',
        createdAt: now.toISOString(),
      });
      expect(lastAudit()).toEqual({
        actor: 'person:ada',
        action: 'competence.requirement_added',
        subject: 'competence-requirement:' + onPosition,
        at: now.toISOString(),
        details: { ...ids, typeId: hlr, positionCode: USK },
      });
      const onUnit = await competence.addRequirement(admin, { typeId: degree, unitId: 'u3' });
      expect(lastAudit()).toEqual({
        actor: 'person:ada',
        action: 'competence.requirement_added',
        subject: 'competence-requirement:' + onUnit,
        at: now.toISOString(),
        details: { ...ids, typeId: degree, unitId: 'u3' },
      });
      expect(admin.authorized).toBe(before + 2);
    });

    test('the list is the position and unit ones, with the positions and units to choose from; nobody else reads it', async () => {
      directory();
      const { hot, hlr } = await catalogue();
      const onUnit = await competence.addRequirement(admin, { typeId: hlr, unitId: 'u2' });
      const onPosition = await competence.addRequirement(admin, { typeId: hlr, positionCode: USK });
      // A requirement on one person is their manager's (D118): never listed to the administrator.
      await competence.addRequirement(boss, { typeId: hot, personId: 'anna' });
      expect(await competence.requirements(admin)).toEqual({
        rows: [
          { id: onPosition, typeId: hlr, on: 'position', targetId: USK, targetLabel: 'Undersköterska' },
          { id: onUnit, typeId: hlr, on: 'unit', targetId: 'u2', targetLabel: 'Enhet 2' },
        ],
        positions: [
          { code: SSK, label: 'Sjuksköterska' },
          { code: USK, label: 'Undersköterska' },
        ],
        units: [
          { id: 'u1', label: 'Enhet 1' },
          { id: 'u2', label: 'Enhet 2' },
          { id: 'u3', label: 'Enhet 3' },
        ],
      });
      for (const p of [boss, asAnna]) await expect(competence.requirements(p)).rejects.toBeInstanceOf(ForbiddenError);
    });

    test('exactly one target, a type, position and unit of the organisation, not archived and not twice; nothing written', async () => {
      directory();
      const { hot, hlr } = await catalogue();
      await competence.addRequirement(admin, { typeId: hlr, positionCode: USK });
      await competence.archiveType(admin, hot);
      const written = audits().length;
      for (const [body, message] of [
        [{ typeId: hlr }, 'Ett krav gäller en befattning, en enhet eller en person.'],
        [{ typeId: hlr, positionCode: SSK, unitId: 'u1' }, 'Ett krav gäller en befattning, en enhet eller en person.'],
        [{ typeId: 'nope', positionCode: SSK }, 'Kompetensen finns inte i katalogen.'],
        [{ typeId: hot, positionCode: SSK }, 'Kompetensen är arkiverad och kan inte krävas.'],
        [{ typeId: hlr, positionCode: 'nope' }, 'Befattningen finns inte.'],
        [{ typeId: hlr, positionCode: 'tolk' }, 'Befattningen finns inte.'],
        [{ typeId: hlr, unitId: 'nope' }, 'Enheten finns inte.'],
        [{ typeId: hlr, unitId: 'u-foreign' }, 'Enheten finns inte.'],
        [{ typeId: hlr, positionCode: USK }, 'Det kravet finns redan.'],
      ] as const) {
        const attempt = competence.addRequirement(admin, body);
        await expect(attempt).rejects.toBeInstanceOf(CompetenceError);
        await expect(attempt).rejects.toThrow(message);
      }
      expect(store.state.requirements.size).toBe(1);
      expect(audits()).toHaveLength(written);
    });

    test('a requirement on one person is set by the manager they report to, never by an administrator or for another’s report', async () => {
      directory();
      const { hot, hlr } = await catalogue();
      const id = await competence.addRequirement(boss, { typeId: hot, personId: 'anna' });
      expect(lastAudit()).toEqual({
        actor: 'person:boss',
        action: 'competence.requirement_added',
        subject: 'competence-requirement:' + id,
        at: now.toISOString(),
        details: { ...ids, typeId: hot, personId: 'anna' },
      });
      const written = audits().length;
      for (const [persona, body, message] of [
        // The administrator's capability is no relation to a person (D118).
        [admin, { typeId: hlr, personId: 'anna' }, 'Krav på en enskild person sätts av den som är personens chef.'],
        [boss, { typeId: hlr, personId: 'dan' }, 'Personen finns inte bland dem du är chef för.'],
        [boss, { typeId: hlr, personId: 'cia' }, 'Personen finns inte bland dem du är chef för.'],
        [boss, { typeId: hlr, personId: 'boss' }, 'Personen finns inte bland dem du är chef för.'],
        [asAnna, { typeId: hlr, personId: 'bo' }, 'Krav på en enskild person sätts av den som är personens chef.'],
        // A manager is no administrator: a position or a unit is not theirs to set.
        [boss, { typeId: hlr, positionCode: USK }, undefined],
        [boss, { typeId: hlr, unitId: 'u1' }, undefined],
      ] as const) {
        const attempt = competence.addRequirement(persona, body);
        await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
        if (message) await expect(attempt).rejects.toThrow(message);
      }
      expect(store.state.requirements.size).toBe(1);
      expect(audits()).toHaveLength(written);
    });

    test('removal is the administrator’s for a position or a unit and the manager’s for one person, each audited once', async () => {
      directory();
      const { hot, hlr } = await catalogue();
      const onPosition = await competence.addRequirement(admin, { typeId: hlr, positionCode: USK });
      const onAnna = await competence.addRequirement(boss, { typeId: hot, personId: 'anna' });
      // An id the reader may not touch and one that does not exist are refused in the same words: a refusal never tells
      // whether a requirement exists.
      for (const [persona, id] of [
        [boss, onPosition],
        [asAnna, onPosition],
        [admin, onAnna],
        [other, onAnna],
        [admin, 'nope'],
        [boss, 'nope'],
      ] as const) {
        const attempt = competence.removeRequirement(persona, id);
        await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
        await expect(attempt).rejects.toThrow('Du kan inte ta bort det här kravet.');
      }
      await competence.removeRequirement(admin, onPosition);
      expect(lastAudit()).toEqual({
        actor: 'person:ada',
        action: 'competence.requirement_removed',
        subject: 'competence-requirement:' + onPosition,
        at: now.toISOString(),
        details: { ...ids, typeId: hlr, positionCode: USK },
      });
      await competence.removeRequirement(boss, onAnna);
      expect(lastAudit()).toEqual({
        actor: 'person:boss',
        action: 'competence.requirement_removed',
        subject: 'competence-requirement:' + onAnna,
        at: now.toISOString(),
        details: { ...ids, typeId: hot, personId: 'anna' },
      });
      expect(store.state.requirements.size).toBe(0);
      await expect(competence.removeRequirement(admin, onPosition)).rejects.toThrow(
        'Du kan inte ta bort det här kravet.',
      );
    });
  });

  describe('requirements by key, whose they are, and who set them', () => {
    test('a unit nobody is placed on can be chosen; a position or unit that is gone is listed so, counts for nobody, and applies again when it comes back', async () => {
      directory();
      const { hlr } = await catalogue();
      // A node of the tree nobody is placed on: it can be required of, by its id.
      store.addUnit({ id: 'u-new', organisationId: ORG, label: 'Ny enhet', parentId: 'u1' });
      const onUnit = await competence.addRequirement(admin, { typeId: hlr, unitId: 'u-new' });
      const onPosition = await competence.addRequirement(admin, { typeId: hlr, positionCode: USK });
      expect((await competence.holdings(asAnna)).rows.map(r => [r.competence, r.status])).toEqual([['HLR', 'missing']]);
      // The provisioner removes the undersköterska group and the new unit: both requirements stay, marked, and require
      // nothing of anyone.
      store.removePosition('pos-usk');
      store.removeUnit('u-new');
      expect((await competence.requirements(admin)).rows).toEqual([
        { id: onPosition, typeId: hlr, on: 'position', targetId: USK, targetLabel: USK, gone: true },
        { id: onUnit, typeId: hlr, on: 'unit', targetId: 'u-new', targetLabel: 'u-new', gone: true },
      ]);
      expect((await competence.holdings(asAnna)).rows).toEqual([]);
      // Pushed again under the same code, as a new row: its holders are under the requirement again.
      store.addPosition({ id: 'pos-usk-again', organisationId: ORG, code: USK, label: 'Undersköterska' });
      store.holdPosition('anna', 'pos-usk-again');
      expect((await competence.holdings(asAnna)).rows.map(r => [r.competence, r.status])).toEqual([['HLR', 'missing']]);
      expect((await competence.requirements(admin)).rows[0]).toEqual({
        id: onPosition,
        typeId: hlr,
        on: 'position',
        targetId: USK,
        targetLabel: 'Undersköterska',
      });
      // A share target on a position that is gone is marked too, and measured over nobody.
      store.removePosition('pos-usk-again');
      const target = await competence.seedShareTarget('operator:cli', ORG, {
        typeId: hlr,
        positionCode: SSK,
        minShare: 50,
      });
      store.removePosition('pos-ssk');
      expect((await competence.shareTargets(admin)).rows).toEqual([
        { id: target, typeId: hlr, positionCode: SSK, positionLabel: SSK, minShare: 50, gone: true },
      ]);
    });

    test('a one-person requirement is the manager’s the person reports to now, whoever set it: found in the matrix and removed there', async () => {
      directory();
      const { hot } = await catalogue();
      const id = await competence.addRequirement(boss, { typeId: hot, personId: 'anna' });
      // Anna moves to Olle, who set nothing.
      staff.set('boss', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [bo] }] });
      staff.set('other', { units: [{ unitId: 'u3', unitLabel: 'Enhet 3', people: [dan, anna] }] });
      const cell = (await competence.matrix(other)).rows
        .find(r => r.personId === 'anna')!
        .cells.find(c => c.typeId === hot)!;
      expect(cell).toMatchObject({ status: 'missing', required: true, through: [{ on: 'person', requirementId: id }] });
      // The former manager is refused in the same words as for an id that does not exist.
      for (const asked of [id, 'nope'])
        await expect(competence.removeRequirement(boss, asked)).rejects.toThrow('Du kan inte ta bort det här kravet.');
      await competence.removeRequirement(other, id);
      expect(lastAudit()).toMatchObject({
        actor: 'person:other',
        action: 'competence.requirement_removed',
        subject: 'competence-requirement:' + id,
      });
    });

    test('erasing a person takes their name off the requirements and share targets they set, which stay', async () => {
      directory();
      const { hot, hlr } = await catalogue();
      store.addPerson({ id: 'ada', organisationId: ORG, name: 'Ada Admin', userName: 'ada' });
      const onPosition = await competence.addRequirement(admin, { typeId: hlr, positionCode: USK });
      const target = await competence.addShareTarget(admin, { typeId: hlr, positionCode: SSK, minShare: 40 });
      const onAnna = await competence.addRequirement(boss, { typeId: hot, personId: 'anna' });
      store.deactivate('ada');
      expect(await competence.erasePerson('operator:cli', 'ada')).toEqual({ holdings: 0, cleared: 2, requirements: 0 });
      expect(store.state.requirements.get(onPosition)?.createdBy).toBeNull();
      expect(store.state.shareTargets.get(target)?.createdBy).toBeNull();
      expect(store.state.requirements.get(onAnna)?.createdBy).toBe('person:boss');
    });
  });

  describe('share targets', () => {
    test('an administrator adds, lists and removes them, each audited with ids and the share; nobody else', async () => {
      directory();
      const { hlr, degree } = await catalogue();
      const everywhere = await competence.addShareTarget(admin, { typeId: hlr, positionCode: USK, minShare: 60 });
      expect(lastAudit()).toEqual({
        actor: 'person:ada',
        action: 'competence.share_target_added',
        subject: 'competence-share-target:' + everywhere,
        at: now.toISOString(),
        details: { organisationId: ORG, typeId: hlr, positionCode: USK, unitId: null, minShare: 60 },
      });
      const onUnit = await competence.addShareTarget(admin, {
        typeId: degree,
        positionCode: SSK,
        unitId: 'u1',
        minShare: 50,
      });
      expect(await competence.shareTargets(admin)).toEqual({
        rows: [
          // Measured over the organisation for its administrator: three undersköterskor are too few to show.
          {
            id: everywhere,
            typeId: hlr,
            positionCode: USK,
            positionLabel: 'Undersköterska',
            minShare: 60,
            outcome: { tooFew: true },
          },
          {
            id: onUnit,
            typeId: degree,
            positionCode: SSK,
            positionLabel: 'Sjuksköterska',
            unitId: 'u1',
            unitLabel: 'Enhet 1',
            minShare: 50,
          },
        ],
      });
      const written = audits().length;
      for (const [body, message] of [
        [
          { typeId: hlr, positionCode: USK, minShare: 80 },
          'Det finns redan ett andelsmål för den kompetensen och befattningen där.',
        ],
        [{ typeId: hlr, positionCode: USK, minShare: 0 }, 'Ange en andel mellan 1 och 100 procent.'],
        [{ typeId: hlr, positionCode: USK, minShare: 12.5 }, 'Ange en andel mellan 1 och 100 procent.'],
        [{ typeId: hlr, positionCode: 'tolk', minShare: 10 }, 'Befattningen finns inte.'],
        [{ typeId: hlr, positionCode: SSK, unitId: 'u-foreign', minShare: 10 }, 'Enheten finns inte.'],
      ] as const)
        await expect(competence.addShareTarget(admin, body)).rejects.toThrow(message);
      for (const p of [boss, asAnna]) {
        await expect(
          competence.addShareTarget(p, { typeId: hlr, positionCode: SSK, minShare: 10 }),
        ).rejects.toBeInstanceOf(ForbiddenError);
        await expect(competence.shareTargets(p)).rejects.toBeInstanceOf(ForbiddenError);
        await expect(competence.removeShareTarget(p, everywhere)).rejects.toBeInstanceOf(ForbiddenError);
      }
      expect(audits()).toHaveLength(written);
      await competence.removeShareTarget(admin, onUnit);
      expect(lastAudit()).toEqual({
        actor: 'person:ada',
        action: 'competence.share_target_removed',
        subject: 'competence-share-target:' + onUnit,
        at: now.toISOString(),
        details: { organisationId: ORG, typeId: degree, positionCode: SSK, unitId: 'u1', minShare: 50 },
      });
      await expect(competence.removeShareTarget(admin, onUnit)).rejects.toThrow('Andelsmålet finns inte.');
      expect([...store.state.shareTargets.keys()]).toEqual([everywhere]);
    });
  });

  describe('missing', () => {
    test('the precedence of the word for a person: expired, then missing, then expiring, then valid, then nothing', () => {
      const of = (expired: number, missing: number, expiring: number, holdings: number) =>
        personStatus({ expired, missing, expiring, holdings });
      expect(of(1, 1, 1, 3)).toBe('expired');
      expect(of(0, 1, 1, 2)).toBe('missing');
      expect(of(0, 0, 1, 2)).toBe('expiring');
      expect(of(0, 0, 0, 2)).toBe('valid');
      expect(of(0, 0, 0, 0)).toBe('none');
      expect(of(0, 2, 0, 0)).toBe('missing');
    });

    test('what is required of a person is the sets of their positions, their units and their own, each type once', () => {
      const r = (id: string, typeId: string, target: Partial<RequirementRecord>): RequirementRecord => ({
        id,
        organisationId: ORG,
        typeId,
        positionCode: null,
        unitId: null,
        personId: null,
        minLevel: null,
        createdBy: 'x',
        createdAt: now.toISOString(),
        ...target,
      });
      const requirements = [
        r('1', 'hlr', { positionCode: USK }),
        r('2', 'iv', { positionCode: SSK }),
        r('3', 'fire', { unitId: 'u1' }),
        r('4', 'hlr', { unitId: 'u1' }),
        r('5', 'drive', { personId: 'bo' }),
        r('6', 'other', { unitId: 'u2' }),
      ];
      // Two positions: under both sets.
      expect(requiredOf({ personId: 'bo', unitIds: ['u1'], positionCodes: [USK, SSK] }, requirements).sort()).toEqual([
        'drive',
        'fire',
        'hlr',
        'iv',
      ]);
      expect(requiredOf({ personId: 'anna', unitIds: [], positionCodes: [] }, requirements)).toEqual([]);
    });

    test('a required type is missing until a holding counts; an expired one stays expired; an archived one is required of nobody', () => {
      const type = (id: string, archivedAt: string | null = null): TypeRecord => ({
        id,
        organisationId: ORG,
        name: id,
        area: 'A',
        kind: 'certificate',
        validityMonths: null,
        archivedAt,
        createdBy: 'x',
        createdAt: now.toISOString(),
      });
      const types = new Map(
        ['held', 'old', 'pending', 'gone'].map(id => [id, type(id, id === 'gone' ? now.toISOString() : null)]),
      );
      const h = (id: string, typeId: string, extra: Partial<HoldingRecord> = {}): HoldingRecord => ({
        id,
        personId: 'anna',
        typeId,
        issuedOn: '2020-01-01',
        expiresOn: null,
        evidence: 'manager',
        state: 'valid',
        registeredBy: null,
        createdAt: now.toISOString(),
        revokedAt: null,
        revokedBy: null,
        copy: null,
        ...extra,
      });
      const standings = deciding(
        [h('a', 'held'), h('b', 'old', { expiresOn: '2025-01-01' }), h('c', 'pending', { state: 'pending' })],
        types,
        '2026-11-10',
        new Map([['anna', ['held', 'old', 'pending', 'gone', 'unknown', 'held']]]),
      );
      expect(standings.map(s => [s.type.id, s.status, s.holding?.id ?? null])).toEqual([
        ['held', 'valid', 'a'],
        ['old', 'expired', 'b'],
        // A pending holding counts towards nothing, so the type is still missing.
        ['pending', 'missing', null],
      ]);
    });

    test('a person’s own list has a row for each required type they lack, until one is registered or the type archived', async () => {
      directory();
      const { hot, hlr, degree } = await catalogue();
      await competence.addRequirement(admin, { typeId: hlr, positionCode: USK });
      await competence.addRequirement(admin, { typeId: degree, unitId: 'u1' });
      await competence.addRequirement(boss, { typeId: hot, personId: 'bo' });
      // Anna's HLR ran out by the employer's 24 months: it stays expired, never missing.
      await competence.registerHolding(boss, 'anna', { typeId: hlr, issuedOn: '2024-01-10' });
      const mine = await competence.holdings(asAnna);
      expect(checkContract(CompetenceHoldingsOutputSchema, mine)).toBe(true);
      expect(mine.rows.map(r => [r.competence, r.status, r.expiresOn ?? null])).toEqual([
        ['HLR', 'expired', '2026-01-10'],
        ['Socionomexamen', 'missing', null],
      ]);
      expect(mine.rows[1]).toEqual({
        ref: `holding:competence:missing:anna:${degree}`,
        userName: 'anna.a',
        name: 'Anna Andersson',
        competence: 'Socionomexamen',
        area: 'Examen',
        kind: 'degree',
        status: 'missing',
      });
      // Bo is under his position, his unit and his own requirement; his manager reads the same.
      const ofBo = await competence.holdings(boss, { person: 'bo' });
      expect(checkContract(CompetenceHoldingsOutputSchema, ofBo)).toBe(true);
      expect(ofBo.rows.map(r => [r.competence, r.status])).toEqual([
        ['Heta arbeten', 'missing'],
        ['HLR', 'missing'],
        ['Socionomexamen', 'missing'],
      ]);
      await competence.registerHolding(boss, 'bo', { typeId: degree, issuedOn: '2015-06-05' });
      await competence.archiveType(admin, hot);
      expect((await competence.holdings(asBo)).rows.map(r => [r.competence, r.status])).toEqual([
        ['HLR', 'missing'],
        ['Socionomexamen', 'valid'],
      ]);
    });

    test('what is to act on among the reports counts missing beside expired and expiring, and names each in its row', async () => {
      directory();
      const { hot, degree } = await catalogue();
      await competence.addRequirement(admin, { typeId: degree, positionCode: USK });
      await competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2021-06-01', expiresOn: '2026-05-31' });
      const out = await competence.attention(boss);
      expect(checkContract(CompetenceAttentionOutputSchema, out)).toBe(true);
      expect(out.rows.map(r => [r.name, r.competence, r.status])).toEqual([
        ['Anna Andersson', 'Heta arbeten', 'expired'],
        ['Anna Andersson', 'Socionomexamen', 'missing'],
        ['Bo Berg', 'Socionomexamen', 'missing'],
      ]);
      expect(await competence.summary(boss)).toEqual({ expired: 1, missing: 2, expiring: 0, people: 2, reports: 2 });
      expect((await competence.aboutPeople(boss, ['anna.a'])).rows).toEqual([
        { key: 'anna.a', expired: 1, missing: 1, expiring: 0, holdings: 1 },
      ]);
    });
  });

  describe('the reads, the figure and the scan', () => {
    const actor = (p: AuthenticatedContext): Actor => ({
      id: p.id,
      name: p.name,
      unitId: p.unitId,
      unitLabel: p.unitLabel,
      role: p.role,
    });
    const personas = new Map([boss, other, asAnna, asBo].map(p => [p.id, p]));
    const registry = () =>
      new Registry().register(
        competenceConnector(competence, async a => {
          const p = personas.get(a.id);
          if (!p) throw new Error('unknown');
          return p;
        }),
      );

    test('the read about a person says Saknas after Utgånget and before Går ut snart, with what is missing counted', async () => {
      directory();
      const { hot, hlr, degree } = await catalogue();
      await competence.addRequirement(admin, { typeId: degree, positionCode: USK });
      await competence.registerHolding(boss, 'anna', { typeId: hlr, issuedOn: '2025-01-10' }); // expires in 61 days
      const r = registry();
      const read = async () =>
        (await r.run<{ rows: unknown[] }>(actor(boss), 'competence.person', { keys: ['anna.a'] })).rows;
      expect(await read()).toEqual([
        { key: 'anna.a', status: 'Saknas', due: '1 saknas, 1 går ut inom 90 dagar', held: '1 registrerade' },
      ]);
      await competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2021-06-01', expiresOn: '2026-05-31' });
      expect(await read()).toEqual([
        {
          key: 'anna.a',
          status: 'Utgånget',
          due: '1 har gått ut, 1 saknas, 1 går ut inom 90 dagar',
          held: '2 registrerade',
        },
      ]);
    });

    test('the figure and the manager’s card count what is missing and name nobody; the person gets a card per missing type', async () => {
      directory();
      const { hot, degree } = await catalogue();
      await competence.addRequirement(admin, { typeId: degree, positionCode: USK });
      const r = registry();
      const figureOf = async (p: AuthenticatedContext) =>
        (await r.areas(actor(p))).find(a => a.id === 'competence')?.figure ?? null;
      expect(await figureOf(boss)).toMatchObject({ label: 'Intyg som saknas', value: '2', tone: 'alert' });
      const [card] = await r.scan(actor(boss));
      expect(card).toMatchObject({
        topic: 'competence:attention',
        title: 'Intyg att åtgärda bland dina medarbetare',
        summary: '2 intyg saknas, hos 2 personer.',
        reason: 'Intyg saknas',
      });
      const text = JSON.stringify(card);
      for (const name of [...NAMES, ...TYPE_NAMES]) expect(text).not.toContain(name);
      // Anna's own card names the type she lacks; it has no deadline, since nothing runs out.
      const [own] = await r.scan(actor(asAnna));
      expect(own).toMatchObject({
        topic: 'competence:missing:' + degree,
        area: 'competence',
        title: 'Socionomexamen saknas',
        reason: 'Saknas',
        actions: [
          {
            id: 'open',
            label: 'Visa mina kompetenser',
            capability: 'competence.holdings',
            kind: 'read',
            role: 'primary',
          },
        ],
      });
      expect(own).not.toHaveProperty('deadline');
      // An expired holding beside it: both in the figure, the expired first in the card.
      await competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2021-06-01', expiresOn: '2026-05-31' });
      expect(await figureOf(boss)).toMatchObject({
        label: 'Intyg som har gått ut eller saknas',
        value: '3',
        tone: 'alert',
      });
      expect((await r.scan(actor(boss)))[0]).toMatchObject({
        summary: '1 intyg har gått ut och 2 intyg saknas, hos 2 personer.',
        reason: 'Intyg har gått ut',
      });
      expect((await r.scan(actor(asAnna))).map(d => d.title)).toEqual([
        'Heta arbeten gick ut 31 maj',
        'Socionomexamen saknas',
      ]);
    });

    test('the read about a unit counts its branch and names nobody; its row opens the table per required type and target', async () => {
      directory();
      const { hlr, degree } = await catalogue();
      await competence.addRequirement(admin, { typeId: hlr, positionCode: USK });
      await competence.addRequirement(admin, { typeId: degree, unitId: 'u3' });
      await competence.addShareTarget(admin, { typeId: hlr, positionCode: USK, minShare: 60 });
      const onU1 = await competence.addShareTarget(admin, {
        typeId: degree,
        positionCode: SSK,
        unitId: 'u1',
        minShare: 50,
      });
      await competence.addShareTarget(admin, { typeId: hlr, positionCode: SSK, unitId: 'u2', minShare: 50 });
      await competence.registerHolding(boss, 'anna', { typeId: hlr, issuedOn: '2026-01-10' });
      await competence.registerHolding(boss, 'bo', { typeId: hlr, issuedOn: '2023-01-10' }); // expired by the rule
      await competence.registerHolding(other, 'dan', { typeId: hlr, issuedOn: '2026-02-10' });
      const r = registry();
      expect(r.aboutReads(actor(boss), 'unit').map(x => x.name)).toEqual(['competence.unit']);
      // Enhet 1's branch is Anna and Bo, Karin's reports, and Dan below it, who is not (Cia is deactivated; Karin herself
      // is never counted). One person besides her reports is too few to count without naming him, so the figures are
      // her reports' and say so; Dan's unit's degree, required of him alone, has no row. Enhet 3 is not Karin's own, and
      // an unknown key is nobody's: neither has a row. Only the targets set on the unit itself are read on it.
      const units = await r.run<{ rows: unknown[] }>(actor(boss), 'competence.unit', {
        keys: ['u1', 'u2', 'u3', 'nope'],
      });
      expect(units.rows).toEqual([
        {
          key: 'u1',
          covered: '1 av 2 personer',
          short: '1 person',
          targets: '0 av 1 nås',
          below: '1 mål',
          counted: 'Endast dina medarbetare',
        },
        // Nobody on Enhet 2 holds the sjuksköterska position: that target is neither reached nor missed.
        { key: 'u2', covered: '1 av 1 person', targets: '0 av 1 nås' },
      ]);
      const text = JSON.stringify(units);
      for (const name of NAMES) expect(text).not.toContain(name);
      expect(unitView.kind === 'list' && unitView.open).toEqual({
        capability: 'competence.coverage',
        title: 'Kompetenstäckning',
        params: { unit: 'key' },
      });
      const table = await r.run<{ rows: unknown[] }>(actor(boss), 'competence.coverage', { unit: 'u1' });
      expect(table.rows).toEqual([
        {
          id: 'requirement:' + hlr,
          competence: 'HLR',
          goal: 'Krav för 2 personer',
          actual: '1 av 2',
          state: 'Inte uppfyllt',
          counted: 'Endast dina medarbetare',
        },
        {
          id: 'target:' + onU1,
          competence: 'Socionomexamen',
          goal: 'Minst 50 % av dem med befattningen Sjuksköterska',
          actual: '0 %, 0 av 1',
          state: 'Inte uppfyllt',
        },
      ]);
      // A target set on a unit above is not read below it: Olle leads Enhet 3 under Enhet 1 and sees his own figures,
      // over Dan, his report, and none of Enhet 1's target.
      const below = await r.run<{ rows: Array<Record<string, string>> }>(actor(other), 'competence.coverage', {
        unit: 'u3',
      });
      expect(below.rows).toEqual([
        { id: 'requirement:' + hlr, competence: 'HLR', goal: 'Krav för 1 person', actual: '1 av 1', state: 'Uppfyllt' },
        {
          id: 'requirement:' + degree,
          competence: 'Socionomexamen',
          goal: 'Krav för 1 person',
          actual: '0 av 1',
          state: 'Inte uppfyllt',
        },
      ]);
      // Only a unit the reader manages: Karin does not manage Enhet 3, Anna manages nothing.
      await expect(competence.coverage(boss, 'u3')).rejects.toThrow('Enheten finns inte bland dem du är chef för.');
      await expect(r.run(actor(asAnna), 'competence.coverage', { unit: 'u1' })).rejects.toThrow();
      expect(await competence.aboutUnits(asAnna, ['u1'])).toEqual([]);
    });

    test('the rest of a branch is counted from five people, a one-person requirement only for the reader’s own report, and an organisation’s target once', async () => {
      directory();
      const { hot, hlr } = await catalogue();
      // Five more people on Enhet 3, Olle's reports, each an undersköterska: with Dan, six besides Karin's own.
      const five = ['e1', 'e2', 'e3', 'e4', 'e5'];
      for (const id of five) {
        store.addPerson({ id, organisationId: ORG, name: 'Person ' + id, userName: id });
        store.assign(id, 'u3');
        store.holdPosition(id, 'pos-usk');
      }
      staff.get('other')!.units[0]!.people.push(...five.map(id => person(id, 'Person ' + id, id)));
      await competence.addRequirement(admin, { typeId: hlr, positionCode: USK });
      // Olle sets a requirement on e1 alone: it is his to count, never Karin's.
      await competence.addRequirement(other, { typeId: hot, personId: 'e1' });
      const everywhere = await competence.addShareTarget(admin, { typeId: hlr, positionCode: USK, minShare: 60 });
      for (const id of ['anna', 'e1', 'e2', 'e3']) {
        const manager = id === 'anna' ? boss : other;
        await competence.registerHolding(manager, id, { typeId: hlr, issuedOn: '2026-01-10' });
      }
      const table = await competence.coverage(boss, 'u1');
      // Anna, Bo, Dan and e1 to e5 are under HLR: everyone counted, the reader's reports and the rest alike.
      expect(table.requirements.map(r => [r.type.name, r.under, r.meeting, r.ownOnly])).toEqual([['HLR', 8, 4, false]]);
      expect(table).toMatchObject({ under: 8, meetingAll: 4, ownOnly: false });
      expect((await competence.coverage(other, 'u3')).requirements.map(r => [r.type.name, r.under, r.meeting])).toEqual(
        [
          ['HLR', 6, 3],
          ['Heta arbeten', 1, 0],
        ],
      );
      // The organisation's target, measured over the organisation once, for its administrator: 4 of 8 undersköterskor.
      expect((await competence.shareTargets(admin)).rows.find(t => t.id === everywhere)?.outcome).toEqual({
        holders: 8,
        meeting: 4,
        share: 50,
        met: false,
      });
    });

    test('an organisation’s target held by fewer than five is too few to show', async () => {
      directory();
      const { hlr } = await catalogue();
      const everywhere = await competence.addShareTarget(admin, { typeId: hlr, positionCode: USK, minShare: 60 });
      const onUnit = await competence.addShareTarget(admin, {
        typeId: hlr,
        positionCode: SSK,
        unitId: 'u1',
        minShare: 60,
      });
      const rows = (await competence.shareTargets(admin)).rows;
      expect(rows.find(t => t.id === everywhere)?.outcome).toEqual({ tooFew: true });
      // A unit's target is read by the manager who leads it, not here.
      expect(rows.find(t => t.id === onUnit)).not.toHaveProperty('outcome');
    });

    test('a unit where nothing is required and no target applies has no row', async () => {
      directory();
      await catalogue();
      expect(
        (await registry().run<{ rows: unknown[] }>(actor(boss), 'competence.unit', { keys: ['u1', 'u2'] })).rows,
      ).toEqual([]);
    });
  });

  test('the domain: a branch is the unit and everything below; a small rest of a branch is left out; coverage counts', () => {
    const tree = [
      { id: 'root', parentId: null },
      { id: 'a', parentId: 'root' },
      { id: 'a1', parentId: 'a' },
      { id: 'b', parentId: 'root' },
      { id: 'loop1', parentId: 'loop2' },
      { id: 'loop2', parentId: 'loop1' },
    ];
    expect(branchOf(tree, 'a').sort()).toEqual(['a', 'a1']);
    expect(branchOf(tree, 'root').sort()).toEqual(['a', 'a1', 'b', 'root']);
    expect(branchOf(tree, 'lost')).toEqual(['lost']);
    expect(COVERAGE_MIN_GROUP).toBe(5);
    const own = (id: string) => id.startsWith('own');
    const of = (ids: string[]) => ids.map(personId => ({ personId }));
    // None besides the reader's own, or at least five: everyone. One to four: the reader's own alone, said so.
    expect(countable(of(['own1', 'own2']), own)).toEqual({ people: of(['own1', 'own2']), ownOnly: false });
    expect(countable(of(['own1', 'x1', 'x2', 'x3', 'x4']), own)).toEqual({ people: of(['own1']), ownOnly: true });
    expect(countable(of(['own1', 'x1', 'x2', 'x3', 'x4', 'x5']), own).people).toHaveLength(6);
    const type: TypeRecord = {
      id: 't',
      organisationId: ORG,
      name: 'T',
      area: 'A',
      kind: 'course',
      validityMonths: null,
      archivedAt: null,
      createdBy: 'x',
      createdAt: now.toISOString(),
    };
    const target: ShareTargetRecord = {
      id: 's',
      organisationId: ORG,
      typeId: 't',
      positionCode: 'p',
      unitId: 'a',
      minShare: 34,
      createdBy: 'x',
      createdAt: now.toISOString(),
    };
    const people = ['x', 'y', 'z'].map(personId => ({ personId, unitIds: ['a'], positionCodes: ['p'] }));
    const held = { holding: null, type, end: null } as const;
    const covered = coverageOf({
      people,
      reader: 'boss',
      reports: new Set(['x', 'y', 'z']),
      requirements: [],
      targets: [target],
      types: new Map([['t', type]]),
      standings: [{ ...held, personId: 'x', status: 'missing' as const }],
    });
    // Nobody meets it: 0 of 3. A share is rounded down, so 1 of 3 (33 %) misses 34 %.
    expect(covered.targets.map(t => [t.share, t.met, t.ownOnly])).toEqual([[0, false, false]]);
    expect(covered).toMatchObject({ under: 0, meetingAll: 0, requirements: [] });
    // An organisation's target over fewer than five is no figure; over five or more it is one.
    expect(organisationOutcome({ minShare: 50 }, ['a', 'b', 'c', 'd'], () => true)).toEqual({ tooFew: true });
    expect(organisationOutcome({ minShare: 50 }, ['a', 'b', 'c', 'd', 'e'], id => id < 'c')).toEqual({
      holders: 5,
      meeting: 2,
      share: 40,
      met: false,
    });
  });

  test('erasure takes a person’s own requirements, the export is version 3 with requirements and targets, and no audit row names anyone', async () => {
    directory();
    const { hot, hlr } = await catalogue();
    await competence.addRequirement(admin, { typeId: hlr, positionCode: USK });
    await competence.addRequirement(admin, { typeId: hlr, unitId: 'u1' });
    const onBo = await competence.addRequirement(boss, { typeId: hot, personId: 'bo' });
    const target = await competence.addShareTarget(admin, {
      typeId: hlr,
      positionCode: SSK,
      unitId: 'u1',
      minShare: 40,
    });
    await competence.removeShareTarget(admin, target);
    await competence.addShareTarget(admin, { typeId: hlr, positionCode: SSK, minShare: 40 });
    await competence.removeRequirement(boss, onBo);
    await competence.addRequirement(boss, { typeId: hot, personId: 'bo' });
    const doc = await competence.exportDomain('operator:cli', ORG);
    expect(doc.format).toBe('clew.competence/4');
    expect(doc.requirements.map(r => [r.typeId, r.positionCode, r.unitId, r.personId])).toEqual([
      [hlr, USK, null, null],
      [hlr, null, 'u1', null],
      [hot, null, null, 'bo'],
    ]);
    expect(doc.shareTargets.map(t => [t.positionCode, t.unitId, t.minShare])).toEqual([[SSK, null, 40]]);
    expect(lastAudit().details).toEqual({ types: 3, holdings: 0, mappings: 0, requirements: 3, shareTargets: 1 });
    store.deactivate('bo');
    expect(await competence.erasePerson('operator:cli', 'bo')).toEqual({ holdings: 0, cleared: 0, requirements: 1 });
    expect(lastAudit()).toEqual({
      actor: 'operator:cli',
      action: 'competence.person_erased',
      subject: 'person:bo',
      at: now.toISOString(),
      details: { holdings: 0, cleared: 0, requirements: 1 },
    });
    expect([...store.state.requirements.values()].map(r => r.personId)).toEqual([null, null]);
    const written = JSON.stringify(audits());
    for (const name of [...NAMES, ...TYPE_NAMES, 'Undersköterska', 'Sjuksköterska', 'Enhet 1'])
      expect(written).not.toContain(name);
  });

  test('an operator seeds a requirement and a share target for an organisation, audited with the operator as actor', async () => {
    directory();
    const { hlr } = await catalogue();
    const id = await competence.seedRequirement('operator:cli', ORG, { typeId: hlr, positionCode: USK });
    expect(lastAudit()).toMatchObject({
      actor: 'operator:cli',
      action: 'competence.requirement_added',
      subject: 'competence-requirement:' + id,
    });
    const target = await competence.seedShareTarget('operator:cli', ORG, {
      typeId: hlr,
      positionCode: USK,
      minShare: 75,
    });
    expect(lastAudit()).toMatchObject({
      actor: 'operator:cli',
      action: 'competence.share_target_added',
      subject: 'competence-share-target:' + target,
    });
    await expect(competence.seedRequirement('operator:cli', ORG, { typeId: hlr, positionCode: USK })).rejects.toThrow(
      'Det kravet finns redan.',
    );
  });

  describe('the matrix (D108 item 11)', () => {
    /** A row copied from a source, as the copy writes one (D108 item 9). */
    const copied = (id: string, personId: string, typeId: string, issuedOn: string, expiresOn: string) =>
      store.transaction(async tx => {
        if (!(await tx.source('lms')))
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
            id,
            personId,
            typeId,
            issuedOn,
            expiresOn,
            evidence: 'system',
            state: 'valid',
            registeredBy: null,
            createdAt: now.toISOString(),
            revokedAt: null,
            revokedBy: null,
            copy: { connectorId: 'lms', sourceId: 'row-' + id, sourceType: 'c1', sourceLabel: 'Kurs', readAt: '' },
          },
        ]);
      });
    /** Each row's cells as [status, the end date, required, the reasons], in the columns' order. */
    const cells = (m: CompetenceMatrixOutput) =>
      Object.fromEntries(
        m.rows.map(r => [
          r.name,
          r.cells.map(c => [c.status, c.expiresOn ?? null, c.required, c.through.map(t => t.label ?? t.on)]),
        ]),
      );

    test('a manager reads their reports against the types required of any of them, each cell where the person stands', async () => {
      directory();
      const { hot, hlr, degree } = await catalogue();
      await competence.addRequirement(admin, { typeId: hlr, positionCode: USK });
      await competence.addRequirement(admin, { typeId: hlr, unitId: 'u1' });
      await competence.addRequirement(admin, { typeId: degree, positionCode: SSK });
      const onAnna = await competence.addRequirement(boss, { typeId: hot, personId: 'anna' });
      // Anna's HLR ran out by the employer's 24 months; Bo's degree never ends; Bo holds Heta arbeten without its being
      // required of him, copied from a source and ending within 90 days.
      const annasHlr = await competence.registerHolding(boss, 'anna', { typeId: hlr, issuedOn: '2024-01-10' });
      const bosDegree = await competence.registerHolding(boss, 'bo', { typeId: degree, issuedOn: '2015-06-05' });
      await copied('c-hot', 'bo', hot, '2021-12-01', '2026-12-31');
      const written = audits().length;

      const m = await competence.matrix(boss);
      expect(checkContract(CompetenceMatrixOutputSchema, m)).toBe(true);
      // Every type fits: no sets to choose from. The columns in the catalogue's order, by area.
      expect(m.by).toBeUndefined();
      expect(m.groups).toEqual([]);
      expect(m.required).toBe(3);
      expect(m.columns).toEqual([
        { typeId: hlr, name: 'HLR', area: 'Akut', kind: 'course' },
        { typeId: degree, name: 'Socionomexamen', area: 'Examen', kind: 'degree' },
        { typeId: hot, name: 'Heta arbeten', area: 'Säkerhet', kind: 'certificate' },
      ]);
      // The reports only: not the manager, not Cia, who is deactivated, not the other manager's Dan.
      expect(m.rows.map(r => [r.personId, r.key, r.name])).toEqual([
        ['anna', 'anna.a', 'Anna Andersson'],
        ['bo', 'bo', 'Bo Berg'],
      ]);
      expect(cells(m)).toEqual({
        'Anna Andersson': [
          ['expired', '2026-01-10', true, ['Undersköterska', 'Enhet 1']],
          ['none', null, false, []],
          ['missing', null, true, ['person']],
        ],
        // Bo holds two positions and is under both sets.
        'Bo Berg': [
          ['missing', null, true, ['Undersköterska', 'Enhet 1']],
          ['valid', null, true, ['Sjuksköterska']],
          ['expiring', '2026-12-31', false, []],
        ],
      });
      const [anna, bo] = m.rows;
      // A manager's registration may be revoked by the reader, a copied row never; a requirement on the person alone
      // carries its id, which the manager may remove.
      expect(anna!.cells[0]).toMatchObject({ holdingId: annasHlr, evidence: 'manager', revocable: true });
      expect(anna!.cells[2]!.through).toEqual([{ on: 'person', requirementId: onAnna }]);
      expect(anna!.cells[2]).not.toHaveProperty('holdingId');
      expect(bo!.cells[1]).toMatchObject({ holdingId: bosDegree, revocable: true });
      expect(bo!.cells[2]).toMatchObject({ holdingId: 'c-hot', evidence: 'system', revocable: false });
      // A read writes nothing.
      expect(audits().length).toBe(written);

      // Revoked, Anna's HLR is missing; with the requirement on her removed, Heta arbeten is required of nobody.
      await competence.revokeHolding(boss, annasHlr);
      await competence.removeRequirement(boss, onAnna);
      const after = await competence.matrix(boss);
      expect(after.columns.map(c => c.name)).toEqual(['HLR', 'Socionomexamen']);
      expect(cells(after)['Anna Andersson']).toEqual([
        ['missing', null, true, ['Undersköterska', 'Enhet 1']],
        ['none', null, false, []],
      ]);
      // An archived type is required of nobody, so it is no column.
      await competence.archiveType(admin, degree);
      expect((await competence.matrix(boss)).columns.map(c => c.name)).toEqual(['HLR']);
    });

    test('only a manager reads it, and only their own reports', async () => {
      directory();
      const { hlr } = await catalogue();
      await competence.addRequirement(admin, { typeId: hlr, positionCode: USK });
      for (const p of [asAnna, admin])
        await expect(competence.matrix(p)).rejects.toThrow(
          'Medarbetarnas kompetens visas för den som är chef för en enhet.',
        );
      await expect(competence.matrix(asAnna)).rejects.toBeInstanceOf(ForbiddenError);
      const theirs = await competence.matrix(other);
      expect(theirs.rows.map(r => r.name)).toEqual(['Dan Dahl']);
      expect(cells(theirs)).toEqual({ 'Dan Dahl': [['missing', null, true, ['Undersköterska']]] });
      // The day the line changes, the former manager reads nobody.
      staff.set('boss', { units: [] });
      await expect(competence.matrix(boss)).rejects.toBeInstanceOf(ForbiddenError);
    });

    test('more than ten required types are offered as sets by area and by position, ten at a time, the chosen one in the address', async () => {
      directory();
      const { hlr } = await catalogue();
      await competence.addRequirement(admin, { typeId: hlr, positionCode: USK });
      const safety: string[] = [];
      for (let i = 1; i <= 11; i++) {
        const id = await competence.addType(admin, {
          name: `Skydd ${String(i).padStart(2, '0')}`,
          area: 'Säkerhet',
          kind: 'certificate',
        });
        safety.push(id);
        await competence.addRequirement(admin, { typeId: id, positionCode: SSK });
      }
      const names = (m: CompetenceMatrixOutput) => m.columns.map(c => c.name);
      const first = await competence.matrix(boss);
      expect(checkContract(CompetenceMatrixOutputSchema, first)).toBe(true);
      expect(first.required).toBe(12);
      // Areas first in Swedish order, then the positions the reports hold, by label; a set of eleven in two parts.
      expect(first.groups).toEqual([
        { by: 'area:Akut', part: 1, parts: 1, kind: 'area', label: 'Akut', types: 1 },
        { by: 'area:Säkerhet', part: 1, parts: 2, kind: 'area', label: 'Säkerhet', types: 10 },
        { by: 'area:Säkerhet', part: 2, parts: 2, kind: 'area', label: 'Säkerhet', types: 1 },
        { by: 'position:' + SSK, part: 1, parts: 2, kind: 'position', label: 'Sjuksköterska', types: 10 },
        { by: 'position:' + SSK, part: 2, parts: 2, kind: 'position', label: 'Sjuksköterska', types: 1 },
        { by: 'position:' + USK, part: 1, parts: 1, kind: 'position', label: 'Undersköterska', types: 1 },
      ]);
      // Nothing chosen: the first set.
      expect([first.by, first.part, names(first)]).toEqual(['area:Akut', 1, ['HLR']]);
      const safe = await competence.matrix(boss, { by: 'area:Säkerhet' });
      expect([safe.by, safe.part]).toEqual(['area:Säkerhet', 1]);
      expect(names(safe)).toEqual(Array.from({ length: 10 }, (_, i) => `Skydd ${String(i + 1).padStart(2, '0')}`));
      expect(safe.rows.every(r => r.cells.length === 10)).toBe(true);
      expect(names(await competence.matrix(boss, { by: 'area:Säkerhet', part: 2 }))).toEqual(['Skydd 11']);
      expect(names(await competence.matrix(boss, { by: 'position:' + SSK, part: 2 }))).toEqual(['Skydd 11']);
      expect(names(await competence.matrix(boss, { by: 'position:' + USK }))).toEqual(['HLR']);
      // Anna does not hold the position the safety set is asked of: required of Bo, not of her.
      expect(cells(safe)['Anna Andersson']![0]).toEqual(['none', null, false, []]);
      expect(cells(safe)['Bo Berg']![0]).toEqual(['missing', null, true, ['Sjuksköterska']]);
      // A part past the last is the set's first; an unknown set is the first set.
      expect([(await competence.matrix(boss, { by: 'area:Säkerhet', part: 7 })).part]).toEqual([1]);
      const unknown = await competence.matrix(boss, { by: 'area:Okänd' });
      expect([unknown.by, names(unknown)]).toEqual(['area:Akut', ['HLR']]);
      // Down to ten, every type fits again and no set is offered.
      await competence.archiveType(admin, safety[10]!);
      await competence.archiveType(admin, safety[9]!);
      const fits = await competence.matrix(boss, { by: 'area:Säkerhet' });
      expect([fits.by, fits.groups, fits.columns.length]).toEqual([undefined, [], 10]);
    });

    test('the export is the matrix as shown, with an audit row of counts that names nobody', async () => {
      directory();
      const { hot, hlr, degree } = await catalogue();
      await competence.addRequirement(admin, { typeId: hlr, positionCode: USK });
      await competence.addRequirement(boss, { typeId: hot, personId: 'anna' });
      await competence.registerHolding(boss, 'anna', { typeId: hlr, issuedOn: '2025-12-01', expiresOn: '2028-01-31' });
      await competence.registerHolding(boss, 'bo', { typeId: degree, issuedOn: '2015-06-05' });
      await copied('c-hot', 'bo', hot, '2021-12-01', '2026-12-31');
      const file = await competence.exportMatrix(boss);
      expect(file.filename).toBe('kompetens-2026-11-10.csv');
      expect(file.text).toBe(
        '﻿' +
          [
            'Namn;HLR;Heta arbeten',
            'Anna Andersson;Giltigt till 2028-01-31;Saknas',
            'Bo Berg;Saknas;Går ut snart 2026-12-31 (krävs inte)',
          ].join('\r\n') +
          '\r\n',
      );
      expect(lastAudit()).toEqual({
        actor: 'person:boss',
        action: 'competence.matrix_exported',
        subject: 'organisation:' + ORG,
        at: now.toISOString(),
        details: { people: 2, types: 2 },
      });
      const written = audits().length;
      await expect(competence.exportMatrix(asAnna)).rejects.toBeInstanceOf(ForbiddenError);
      expect(audits().length).toBe(written);
      const text = JSON.stringify(audits());
      for (const name of [...NAMES, ...TYPE_NAMES, 'Undersköterska']) expect(text).not.toContain(name);
    });

    test('a field of the file a spreadsheet would read as a formula is kept as text, and one with a separator is quoted', () => {
      const cell: CompetenceMatrixCell = {
        typeId: 't',
        status: 'none',
        required: false,
        through: [],
        revocable: false,
      };
      expect(
        matrixCsv({
          columns: [{ typeId: 't', name: 'Truck; A', area: 'Fordon', kind: 'authorisation' }],
          rows: [
            { personId: 'p1', key: 'p1', name: '=HYPERLINK("x")', cells: [cell] },
            {
              personId: 'p2',
              key: 'p2',
              name: '-Eva',
              cells: [{ ...cell, status: 'expired', expiresOn: '2026-01-01' }],
            },
          ],
        }),
      ).toBe('﻿Namn;"Truck; A"\r\n"\'=HYPERLINK(""x"")";Krävs inte\r\n\'-Eva;Utgånget 2026-01-01 (krävs inte)\r\n');
      expect(matrixCellText({ status: 'valid', required: true })).toBe('Giltigt');
      expect(matrixCellText({ status: 'missing', required: true })).toBe('Saknas');
    });
  });
});
