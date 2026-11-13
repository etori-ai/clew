import { beforeEach, describe, expect, test } from 'bun:test';
import {
  checkContract,
  CompetenceAttentionOutputSchema,
  CompetenceHoldingsOutputSchema,
  COMPETENCE_MATRIX_COLUMNS,
  CompetenceMatrixOutputSchema,
  CompetenceSkillRatingBodySchema,
  type AuthenticatedContext,
  type CompetenceHoldingRow,
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
  approvalView,
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
  showable,
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
import { memoryProvisionStore } from '../../apps/server/src/modules/people/adapters/memory';
import { staffUsecases } from '../../apps/server/src/modules/people/usecases';
import { reportsByUnit } from '../../apps/server/src/modules/entities/domain';
import { Registry } from '../registry';
import { DEVELOPMENT_CATALOGUE, DEVELOPMENT_REQUIREMENTS } from '../../scripts/competence-development';

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
    persons: [anna, bo, cia, dan, { id: 'boss', name: 'Karin Chef', userName: 'boss', enabled: true }].map(p => ({
      id: p.id,
      organisationId: ORG,
      name: p.name,
      userName: p.userName,
      enabled: p.enabled !== false,
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
/** The source deactivates the person: only then does an operator erase them (D123 item 3). */
const deactivate = (id: string) => store.addPerson({ ...store.state.persons.get(id)!, enabled: false });
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
      sourceUri: null,
      mergedInto: null,
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
  test('an administrator reads every type, a manager the ones that can be registered, anyone else is refused; a person reads the ones they may register for themselves', async () => {
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
    // A person registers their own (D108 item 7) from the types a manager registers from.
    expect((await competence.ownTypes(asAnna)).rows).toEqual((await competence.types(boss)).rows);
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
      decidedBy: null,
      decidedAt: null,
      threadId: null,
      level: null,
      interest: false,
      validatedBy: null,
      validatedAt: null,
      ratedAt: null,
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
  test('what needs attention is the requirements not met among the reports, the expired first; a certificate nothing requires is not one; a renewal clears the row', async () => {
    const types = await world();
    // Nothing is required of anyone yet: Anna's expired and expiring certificates are facts about her, on her holdings,
    // and nothing the manager is told to act on (the product owner's definition, 2026-11-13).
    expect((await competence.attention(boss)).rows).toEqual([]);
    expect(await competence.summary(boss)).toEqual({ expired: 0, missing: 0, expiring: 0, people: 0, reports: 2 });
    expect((await competence.holdings(boss, { person: 'anna.a' })).rows.map(r => r.status)).toEqual([
      'expired',
      'expiring',
      'valid',
    ]);
    // Required of her, both are requirements not met, now or soon; Bo's valid one, required too, is not.
    await competence.addRequirement(boss, { typeId: types.hot, personId: 'anna' });
    await competence.addRequirement(boss, { typeId: types.hlr, personId: 'anna' });
    await competence.addRequirement(boss, { typeId: types.hot, personId: 'bo' });
    const out = await competence.attention(boss);
    expect(checkContract(CompetenceAttentionOutputSchema, out)).toBe(true);
    expect(out.rows.map(r => [r.name, r.competence, r.status])).toEqual([
      ['Anna Andersson', 'Heta arbeten', 'expired'],
      ['Anna Andersson', 'HLR', 'expiring'],
    ]);
    expect(out).not.toHaveProperty('omitted');
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
  test('the list gives at most 500 rows and says how many more there are; the figure counts them all', async () => {
    await world();
    // 501 types required of Bo that he holds nothing of: 501 requirements not met.
    for (let i = 0; i < 501; i++) {
      const id = `t-many-${String(i).padStart(3, '0')}`;
      store.state.types.set(id, {
        id,
        organisationId: ORG,
        name: `Krav ${String(i).padStart(3, '0')}`,
        area: 'Många',
        kind: 'certificate',
        validityMonths: null,
        archivedAt: null,
        createdBy: 'test',
        createdAt: '2026-01-01T00:00:00.000Z',
        sourceUri: null,
        mergedInto: null,
      });
      store.state.requirements.set('r-' + id, {
        id: 'r-' + id,
        organisationId: ORG,
        typeId: id,
        positionCode: null,
        unitId: null,
        personId: 'bo',
        minLevel: null,
        createdBy: 'boss',
        createdAt: '2026-01-01T00:00:00.000Z',
      });
    }
    const out = await competence.attention(boss);
    expect(checkContract(CompetenceAttentionOutputSchema, out)).toBe(true);
    expect(out.rows).toHaveLength(500);
    expect(out.omitted).toBe(1);
    expect((await competence.summary(boss))?.missing).toBe(501);
  });
  test('about people: one row per report asked by user name, the counts, and a row for someone who holds nothing', async () => {
    const types = await world();
    staff.get('boss')!.units[0]!.people.push(person('eve', 'Eve Ek', 'eve.e'));
    // Asked without regard to case; Bo has no user name, Cia is deactivated, Dan reports to another manager.
    const out = await competence.aboutPeople(boss, ['Anna.A', 'eve.e', 'bo', 'cia.c', 'dan.d', 'nobody', 'Anna.A']);
    expect(out.rows).toEqual([
      // Nothing is required of Anna: her run-out and soon-ending certificates are registered and count as nothing
      // else (`requirementUnmet`, the product owner's definition of 2026-11-13).
      { key: 'Anna.A', expired: 0, missing: 0, expiring: 0, holdings: 3 },
      // Nothing registered yet: the row is where a first certificate is registered from.
      { key: 'eve.e', expired: 0, missing: 0, expiring: 0, holdings: 0 },
    ]);
    // Required of her, they are what her row counts.
    await competence.addRequirement(boss, { typeId: types.hot, personId: 'anna' });
    await competence.addRequirement(boss, { typeId: types.hlr, personId: 'anna' });
    expect((await competence.aboutPeople(boss, ['anna.a'])).rows).toEqual([
      { key: 'anna.a', expired: 1, missing: 0, expiring: 1, holdings: 3 },
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
    deactivate('anna');
    expect(await competence.erasePerson('operator:cli', 'anna')).toEqual({
      holdings: 1,
      cleared: 0,
      requirements: 0,
      approvals: 0,
      cards: 0,
    });
    expect(lastAudit()).toEqual({
      actor: 'operator:cli',
      action: 'competence.person_erased',
      subject: 'person:anna',
      at: now.toISOString(),
      details: { cause: 'operator', holdings: 1, cleared: 0, requirements: 0, approvals: 0, cards: 0 },
    });
    // The manager who registered is erased: the holdings stay, without her id.
    deactivate('boss');
    expect(await competence.erasePerson('operator:cli', 'boss')).toEqual({
      holdings: 0,
      cleared: 1,
      requirements: 0,
      approvals: 0,
      cards: 0,
    });
    expect([...store.state.holdings.values()].map(h => [h.personId, h.registeredBy])).toEqual([['bo', null]]);
  });
  test("the cards the competence scan put in the person's own stream go with the holdings, and are counted (R1)", async () => {
    const seeded = memoryCompetenceStore({
      persons: [{ id: 'anna', organisationId: ORG, name: 'Anna', userName: 'anna.a', enabled: false }],
      ownCards: {
        'card-heta': { personId: 'anna', connector: 'competence' },
        'card-hlr': { personId: 'anna', connector: 'competence' },
        'card-hr': { personId: 'anna', connector: 'hr' },
        'card-bo': { personId: 'bo', connector: 'competence' },
      },
    });
    const erasing = competenceUsecases({
      store: seeded,
      staff: async () => ({ units: [] }),
      clock: () => now,
      ids: () => 'x',
    });
    expect(await erasing.erasePerson('operator:cli', 'anna')).toEqual({
      holdings: 0,
      cleared: 0,
      requirements: 0,
      approvals: 0,
      cards: 2,
    });
    // Another connector's card of hers and a colleague's competence card stay.
    expect([...seeded.state.ownCards.keys()].sort()).toEqual(['card-bo', 'card-hr']);
    // A thread.removed row for each card, then the erasure's own, all at the erasure's time.
    expect(seeded.audit()).toEqual([
      ...['card-heta', 'card-hlr'].map(id => ({
        actor: 'operator:cli',
        action: 'thread.removed',
        subject: `thread:${id}`,
        at: now.toISOString(),
        details: { reason: 'erasure' },
      })),
      {
        actor: 'operator:cli',
        action: 'competence.person_erased',
        subject: 'person:anna',
        at: now.toISOString(),
        details: { cause: 'operator', holdings: 0, cleared: 0, requirements: 0, approvals: 0, cards: 2 },
      },
    ]);
  });
  test('an id the people table does not hold, a user name among them, erases nothing and writes no audit row (R1)', async () => {
    const { hot } = await catalogue();
    await competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2026-01-10' });
    const before = audits().length;
    for (const id of ['nobody', 'Anna.A', 'anna.a'])
      expect(await competence.erasePerson('operator:cli', id)).toEqual({ refused: 'unknown' });
    expect(audits()).toHaveLength(before);
    expect([...store.state.holdings.values()].map(h => h.personId)).toEqual(['anna']);
  });
  test('a person who is still active is refused: nothing is erased and no audit row is written (D123 item 3)', async () => {
    const { hot } = await catalogue();
    await competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2026-01-10' });
    store.addCard('card-anna', { personId: 'anna', connector: 'competence' });
    const before = audits().length,
      holdings = structuredClone(store.state.holdings);
    // Neither Anna, whose holding it is, nor the manager who registered it.
    for (const id of ['anna', 'boss'])
      expect(await competence.erasePerson('operator:cli', id)).toEqual({ refused: 'active' });
    expect(audits()).toHaveLength(before);
    expect(store.state.holdings).toEqual(holdings);
    expect([...store.state.ownCards.keys()]).toEqual(['card-anna']);
    // Once the source has deactivated her, the same call erases her.
    deactivate('anna');
    expect(await competence.erasePerson('operator:cli', 'anna')).toEqual({
      holdings: 1,
      cleared: 0,
      requirements: 0,
      approvals: 0,
      cards: 1,
    });
  });
  test('the export is one versioned document of the organisation, audited with counts', async () => {
    const { hot } = await catalogue();
    await competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2026-01-10' });
    await competence.seedType('operator:test', 'org-2', { name: 'Annan', area: 'X', kind: 'course' });
    const doc = await competence.exportDomain('operator:cli', ORG);
    expect(doc).toMatchObject({ format: 'clew.competence/8', exportedAt: now.toISOString(), organisationId: ORG });
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
  deactivate('bo');
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
  /** Anna: Heta arbeten expired and HLR expiring, both required of her by her manager. Bo: Heta arbeten valid for years. */
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
    await competence.addRequirement(boss, { typeId: types.hot, personId: 'anna' });
    await competence.addRequirement(boss, { typeId: types.hlr, personId: 'anna' });
    return types;
  }

  test('it passes the registry validation, three reads are model tools (D122), and the two lists open without input', () => {
    const c = connector();
    expect(() => registry()).not.toThrow();
    expect(c).toMatchObject({ id: 'competence', kind: 'core', source: 'Kompetens' });
    // The reads about an entity stay closed as the loader holds them (D97 item 7), and so does an approval's read.
    expect(c.capabilities.map(x => [x.name, x.kind, x.model, x.about?.entity ?? null])).toEqual([
      ['competence.attention', 'read', true, null],
      ['competence.holdings', 'read', true, null],
      ['competence.person', 'read', false, 'person'],
      ['competence.unit', 'read', false, 'unit'],
      ['competence.coverage', 'read', true, null],
      ['competence.approval', 'read', false, null],
    ]);
    for (const x of c.capabilities) expect(viewProblem(x, c.capabilities)).toBeUndefined();
    // The reads about a person and a unit take the keys they are asked with, the table a unit's row opens takes the
    // unit, and an approval's read takes the registration, so none of them is a place in the menu.
    expect(c.capabilities.map(x => menuEligible(x))).toEqual([true, true, false, false, false, false]);
    expect([attentionView, holdingsView, personView, unitView, coverageView, approvalView].some(v => 'ref' in v)).toBe(
      false,
    );
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
      // A query alone: the dialog lies over the page the person is on (their own page, Personal), never moves them.
      page: { title: 'Registrera intyg', href: '?register={id}' },
    });
    expect(r.aboutReads(actor(asAnna), 'person')).toEqual([]);
    staff.get('boss')!.units[0]!.people.push(person('eve', 'Eve Ek', 'eve.e'));
    const out = await r.run<{ rows: unknown[] }>(actor(boss), 'competence.person', {
      keys: ['anna.a', 'eve.e', 'dan.d'],
    });
    // Where the person stands, and no counts beside it: the holdings drawn under it say every fact (no digest).
    expect(out.rows).toEqual([
      { key: 'anna.a', status: 'Utgånget' },
      { key: 'eve.e', status: 'Inget registrerat' },
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

  test('the figure counts requirements not met for a manager, is calm when every one is, and is absent for an employee', async () => {
    const r = registry();
    const figureOf = async (p: AuthenticatedContext) =>
      (await r.areas(actor(p))).find(a => a.id === 'competence')?.figure ?? null;
    expect(await figureOf(boss)).toMatchObject({
      label: 'Alla krav uppfylls, och inget går ut inom 90 dagar.',
      tone: 'ok',
    });
    const types = await world();
    expect(await figureOf(boss)).toMatchObject({
      label: 'Krav som inte uppfylls',
      value: '1',
      comparison: '1 till går ut inom 90 dagar',
      tone: 'alert',
      opens: { capability: 'competence.attention', title: 'Krav som inte uppfylls' },
    });
    await competence.registerHolding(boss, 'anna', {
      typeId: types.hot,
      issuedOn: '2026-11-01',
      expiresOn: '2031-10-31',
    });
    expect(await figureOf(boss)).toMatchObject({
      label: 'Krav som snart inte uppfylls',
      value: '1',
      tone: 'warn',
    });
    expect(await figureOf(asAnna)).toBeNull();
  });

  test('the figure, the manager’s card and the list count the same; the tile and the card lead to the matrix narrowed', async () => {
    const types = await world();
    // An expired certificate nothing requires of Bo: a fact about him, not counted anywhere a manager is told to act.
    await competence.registerHolding(boss, 'bo', {
      typeId: types.hlr,
      issuedOn: '2020-01-10',
      expiresOn: '2024-01-10',
    });
    const r = registry();
    const figure = (await r.areas(actor(boss))).find(a => a.id === 'competence')?.figure;
    const [card] = await r.scan(actor(boss));
    const rows = (
      await r.run<{ rows: Array<{ name: string; status: string }> }>(actor(boss), 'competence.attention', {})
    ).rows;
    const unmet = rows.filter(x => x.status !== 'expiring').length;
    expect(figure).toMatchObject({ value: String(unmet), comparison: '1 till går ut inom 90 dagar' });
    expect(card!.summary).toBe('1 har gått ut och 1 går ut inom 90 dagar, hos 1 person.');
    expect(rows.map(x => x.name)).not.toContain('Bo Berg');
    // The read declares the page its rows are worked on: what opens it without input leads to the matrix narrowed to
    // the same (D116), by declaration.
    expect(r.views(actor(boss)).find(v => v.capability === 'competence.attention')).toMatchObject({
      kind: 'table',
      page: '/competence/matrix?only=attention',
    });
    expect(card!.actions.map(a => a.capability)).toEqual(['competence.attention']);
    // Nobody else's read declares one.
    expect(
      r
        .views(actor(boss))
        .filter(v => v.page)
        .map(v => v.capability),
    ).toEqual(['competence.attention']);
    // Bo's own card for his expired certificate is kept, required or not (his own, not his manager's).
    expect((await r.scan(actor(asBo))).map(d => d.title)).toEqual(['HLR gick ut 10 januari']);
  });

  test('the scan gives a person one card per competence of their own, with the end date as the deadline', async () => {
    const { hot } = await world();
    const drafts = await registry().scan(actor(asAnna));
    expect(drafts.map(d => [d.title, d.reason, d.deadline])).toEqual([
      ['Heta arbeten gick ut 31 maj', 'Har gått ut', '2026-05-31'],
      ['HLR går ut 10 januari', 'Går ut inom 90 dagar', '2027-01-10'],
    ]);
    expect(drafts.every(d => d.area === 'competence' && d.connector === 'competence')).toBe(true);
    // Keyed on the competence type, not the holding's row (D47 occurrences: see the cards' own tests).
    expect(drafts[0]!.topic).toBe('competence:due:' + hot);
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
      title: 'Krav som inte uppfylls bland dina medarbetare',
      summary: '1 har gått ut och 1 går ut inom 90 dagar, hos 1 person.',
      reason: 'Har gått ut',
    });
    expect(card!.actions.map(a => [a.capability, a.label])).toEqual([
      ['competence.attention', 'Visa medarbetarnas kompetens'],
    ]);
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
      expect(await competence.erasePerson('operator:cli', 'ada')).toEqual({
        holdings: 0,
        cleared: 2,
        requirements: 0,
        approvals: 0,
        cards: 0,
      });
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
        sourceUri: null,
        mergedInto: null,
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
        // The type, from which her own page registers one (the row's name opens the dialog with it chosen).
        typeId: degree,
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

    test('what is to act on among the reports counts missing beside expired and expiring of what is required, and names each in its row', async () => {
      directory();
      const { hot, degree } = await catalogue();
      await competence.addRequirement(admin, { typeId: degree, positionCode: USK });
      await competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2021-06-01', expiresOn: '2026-05-31' });
      // Anna's Heta arbeten has run out, but nothing requires it of her: it is no requirement not met.
      const before = await competence.attention(boss);
      expect(before.rows.map(r => [r.name, r.competence, r.status])).toEqual([
        ['Anna Andersson', 'Socionomexamen', 'missing'],
        ['Bo Berg', 'Socionomexamen', 'missing'],
      ]);
      expect(await competence.summary(boss)).toEqual({ expired: 0, missing: 2, expiring: 0, people: 2, reports: 2 });
      // Required of her position, it is one.
      await competence.addRequirement(admin, { typeId: hot, positionCode: USK });
      const out = await competence.attention(boss);
      expect(checkContract(CompetenceAttentionOutputSchema, out)).toBe(true);
      expect(out.rows.map(r => [r.name, r.competence, r.status])).toEqual([
        ['Anna Andersson', 'Heta arbeten', 'expired'],
        ['Anna Andersson', 'Socionomexamen', 'missing'],
        ['Bo Berg', 'Heta arbeten', 'missing'],
        ['Bo Berg', 'Socionomexamen', 'missing'],
      ]);
      expect(await competence.summary(boss)).toEqual({ expired: 1, missing: 3, expiring: 0, people: 2, reports: 2 });
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

    test('the read about a person says what a requirement on them needs, Utgånget before Saknas before Går ut snart, and nothing beside it', async () => {
      directory();
      const { hot, hlr, degree } = await catalogue();
      const r = registry();
      const read = async () =>
        (await r.run<{ rows: unknown[] }>(actor(boss), 'competence.person', { keys: ['anna.a'] })).rows;
      // Nothing required and nothing held: no mark, and the row is where a first certificate is registered from.
      expect(await read()).toEqual([{ key: 'anna.a', status: 'Inget registrerat' }]);
      // A certificate that has run out and that nothing requires of her is no mark (`requirementUnmet`): not
      // "Giltigt" either, since it is not; her holdings say it has run out, and her own card reminds her.
      await competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2021-06-01', expiresOn: '2026-05-31' });
      expect(await read()).toEqual([{ key: 'anna.a', status: 'Inget att åtgärda' }]);
      // Required of her position and ending within 90 days.
      await competence.registerHolding(boss, 'anna', { typeId: hlr, issuedOn: '2025-01-10' }); // expires in 61 days
      await competence.addRequirement(admin, { typeId: hlr, positionCode: USK });
      expect(await read()).toEqual([{ key: 'anna.a', status: 'Går ut snart' }]);
      // Required and missing comes before it.
      await competence.addRequirement(admin, { typeId: degree, positionCode: USK });
      expect(await read()).toEqual([{ key: 'anna.a', status: 'Saknas' }]);
      // Required and run out comes first.
      await competence.addRequirement(admin, { typeId: hot, positionCode: USK });
      expect(await read()).toEqual([{ key: 'anna.a', status: 'Utgånget' }]);
      // Only those three are marks; her holdings still say every holding with its own status.
      expect(personView.kind === 'list' && Object.keys(personView.fields[0]!.tones ?? {})).toEqual([
        'Utgånget',
        'Saknas',
        'Går ut snart',
      ]);
      expect(
        (await competence.holdings(boss, { person: 'anna.a' })).rows.map(row => [row.competence, row.status]).sort(),
      ).toEqual([
        ['HLR', 'expiring'],
        ['Heta arbeten', 'expired'],
        ['Socionomexamen', 'missing'],
      ]);
    });

    test('the figure and the manager’s card count what is missing and name nobody; the person gets a card per missing type', async () => {
      directory();
      const { hot, degree } = await catalogue();
      await competence.addRequirement(admin, { typeId: degree, positionCode: USK });
      const r = registry();
      const figureOf = async (p: AuthenticatedContext) =>
        (await r.areas(actor(p))).find(a => a.id === 'competence')?.figure ?? null;
      expect(await figureOf(boss)).toMatchObject({ label: 'Krav som inte uppfylls', value: '2', tone: 'alert' });
      const [card] = await r.scan(actor(boss));
      expect(card).toMatchObject({
        topic: 'competence:attention',
        title: 'Krav som inte uppfylls bland dina medarbetare',
        summary: '2 saknas, hos 2 personer.',
        reason: 'Saknas',
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
      // An expired holding beside it that nothing requires: not in the figure or the manager's card, still in hers.
      await competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2021-06-01', expiresOn: '2026-05-31' });
      expect(await figureOf(boss)).toMatchObject({ label: 'Krav som inte uppfylls', value: '2', tone: 'alert' });
      expect((await r.scan(actor(boss)))[0]).toMatchObject({ summary: '2 saknas, hos 2 personer.', reason: 'Saknas' });
      expect((await r.scan(actor(asAnna))).map(d => d.title)).toEqual([
        'Heta arbeten gick ut 31 maj',
        'Socionomexamen saknas',
      ]);
      // Required of her, both: the expired first in the card.
      await competence.addRequirement(boss, { typeId: hot, personId: 'anna' });
      expect(await figureOf(boss)).toMatchObject({ label: 'Krav som inte uppfylls', value: '3', tone: 'alert' });
      expect((await r.scan(actor(boss)))[0]).toMatchObject({
        summary: '1 har gått ut och 2 saknas, hos 2 personer.',
        reason: 'Har gått ut',
      });
    });

    test('the read about a unit counts the reader’s own reports and names nobody; its row opens the table per required type and target', async () => {
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
      const hlrOnU1 = await competence.addShareTarget(admin, {
        typeId: hlr,
        positionCode: USK,
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
      // is never counted). What is required is counted over her reports alone: Dan's unit's degree, required of him
      // only, has no row. Enhet 3 is not Karin's own, and an unknown key is nobody's: neither has a row. Only the targets
      // set on the unit itself are read on it.
      const units = await r.run<{ rows: unknown[] }>(actor(boss), 'competence.unit', {
        keys: ['u1', 'u2', 'u3', 'nope'],
      });
      expect(units.rows).toEqual([
        // Each pair says what it counts with the same words: 1 of 2 meet every requirement, and 1 does not.
        { key: 'u1', covered: '1 av 2', short: '1 uppfyller inte', targets: '0 av 2 nås', below: '1 under målet' },
        // Nobody on Enhet 2 holds the sjuksköterska position: that target is neither reached nor missed.
        { key: 'u2', covered: '1 av 1', targets: '0 av 1 nås' },
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
          goal: 'Krav för 2 av dina medarbetare',
          actual: '1 av 2',
          state: 'Inte uppfyllt',
        },
        // The undersköterskor of the branch are Anna and Bo, whom Karin knows, and Dan alone besides: too few to count.
        {
          id: 'target:' + hlrOnU1,
          competence: 'HLR',
          goal: 'Minst 50 % av alla på enheten med befattningen Undersköterska',
          actual: '–',
          state: 'För få för att visas',
        },
        // Bo, her own report, is the one sjuksköterska: a figure over people she knows tells her nothing new.
        {
          id: 'target:' + onU1,
          competence: 'Socionomexamen',
          goal: 'Minst 50 % av alla på enheten med befattningen Sjuksköterska',
          actual: '0 %, 0 av 1',
          state: 'Inte uppfyllt',
        },
      ]);
      // A target set on a unit above is not read below it: Olle leads Enhet 3 under Enhet 1 and sees his own figures,
      // over Dan, his report, and none of Enhet 1's targets.
      const below = await r.run<{ rows: Array<Record<string, string>> }>(actor(other), 'competence.coverage', {
        unit: 'u3',
      });
      expect(below.rows).toEqual([
        {
          id: 'requirement:' + hlr,
          competence: 'HLR',
          goal: 'Krav för 1 av dina medarbetare',
          actual: '1 av 1',
          state: 'Uppfyllt',
        },
        {
          id: 'requirement:' + degree,
          competence: 'Socionomexamen',
          goal: 'Krav för 1 av dina medarbetare',
          actual: '0 av 1',
          state: 'Inte uppfyllt',
        },
      ]);
      // Only a unit the reader manages: Karin does not manage Enhet 3, Anna manages nothing.
      await expect(competence.coverage(boss, 'u3')).rejects.toThrow('Enheten finns inte bland dem du är chef för.');
      await expect(r.run(actor(asAnna), 'competence.coverage', { unit: 'u1' })).rejects.toThrow();
      expect(await competence.aboutUnits(asAnna, ['u1'])).toEqual([]);
    });

    test('others on the branch enter only a share target, from five people; a one-person requirement only for the reader’s own report; an organisation’s target once', async () => {
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
      const onU1 = await competence.addShareTarget(admin, {
        typeId: hlr,
        positionCode: USK,
        unitId: 'u1',
        minShare: 60,
      });
      for (const id of ['anna', 'e1', 'e2', 'e3']) {
        const manager = id === 'anna' ? boss : other;
        await competence.registerHolding(manager, id, { typeId: hlr, issuedOn: '2026-01-10' });
      }
      const table = await competence.coverage(boss, 'u1');
      // What is required is Karin's reports' alone, however many others the branch holds.
      expect(table.requirements.map(r => [r.type.name, r.under, r.meeting])).toEqual([['HLR', 2, 1]]);
      expect(table).toMatchObject({ under: 2, meetingAll: 1 });
      // The unit's target counts everyone on the branch in the position, six of them people Karin does not know.
      expect(table.targets.map(t => [t.target.id, t.holders, t.meeting, t.share, t.met, t.withheld])).toEqual([
        [onU1, 8, 4, 50, false, false],
      ]);
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

  test('the domain: a branch is the unit and everything below; coverage counts own reports, and a target only over enough others', () => {
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
    // None besides those the reader knows, or at least five: a figure may be shown. One to four: never.
    expect(showable(['own1', 'own2'], own)).toBe(true);
    expect(showable(['own1', 'x1', 'x2', 'x3', 'x4'], own)).toBe(false);
    expect(showable(['own1', 'x1', 'x2', 'x3', 'x4', 'x5'], own)).toBe(true);
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
      sourceUri: null,
      mergedInto: null,
    };
    const target = (id: string, positionCode: string): ShareTargetRecord => ({
      id,
      organisationId: ORG,
      typeId: 't',
      positionCode,
      unitId: 'a',
      minShare: 34,
      createdBy: 'x',
      createdAt: now.toISOString(),
    });
    const placed = (personId: string, positionCodes: string[]) => ({ personId, unitIds: ['a'], positionCodes });
    const held = { holding: null, type, end: null } as const;
    const covered = coverageOf({
      people: ['x', 'y', 'z'].map(id => placed(id, ['p'])),
      reader: 'boss',
      reports: new Set(['x', 'y', 'z']),
      requirements: [],
      targets: [target('s', 'p')],
      types: new Map([['t', type]]),
      standings: [{ ...held, personId: 'x', status: 'missing' as const }],
    });
    // Nobody meets it: 0 of 3. A share is rounded down, so 1 of 3 (33 %) misses 34 %.
    expect(covered.targets.map(t => [t.share, t.met, t.withheld])).toEqual([[0, false, false]]);
    expect(covered).toMatchObject({ under: 0, meetingAll: 0, requirements: [] });
    // Two targets of one type over overlapping positions: q's holders are five people the reader does not know, p's
    // are those five, one more, and the reader's own. Each alone may be shown, but p less q is one person: both withheld.
    const others = ['o1', 'o2', 'o3', 'o4', 'o5'];
    const overlapping = coverageOf({
      people: [...others.map(id => placed(id, ['p', 'q'])), placed('o6', ['p']), placed('own1', ['p'])],
      reader: 'boss',
      reports: new Set(['own1']),
      requirements: [],
      targets: [target('s1', 'p'), target('s2', 'q')],
      types: new Map([['t', type]]),
      standings: [],
    });
    expect(overlapping.targets.map(t => [t.target.id, t.withheld, t.share])).toEqual([
      ['s1', true, null],
      ['s2', true, null],
    ]);
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
    expect(doc.format).toBe('clew.competence/8');
    expect(doc.requirements.map(r => [r.typeId, r.positionCode, r.unitId, r.personId])).toEqual([
      [hlr, USK, null, null],
      [hlr, null, 'u1', null],
      [hot, null, null, 'bo'],
    ]);
    expect(doc.shareTargets.map(t => [t.positionCode, t.unitId, t.minShare])).toEqual([[SSK, null, 40]]);
    expect(lastAudit().details).toEqual({ types: 3, holdings: 0, mappings: 0, requirements: 3, shareTargets: 1 });
    store.deactivate('bo');
    expect(await competence.erasePerson('operator:cli', 'bo')).toEqual({
      holdings: 0,
      cleared: 0,
      requirements: 1,
      approvals: 0,
      cards: 0,
    });
    expect(lastAudit()).toEqual({
      actor: 'operator:cli',
      action: 'competence.person_erased',
      subject: 'person:bo',
      at: now.toISOString(),
      details: { cause: 'operator', holdings: 0, cleared: 0, requirements: 1, approvals: 0, cards: 0 },
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
            decidedBy: null,
            decidedAt: null,
            threadId: null,
            level: null,
            interest: false,
            validatedBy: null,
            validatedAt: null,
            ratedAt: null,
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
      // Every type fits, so every one is shown with none chosen, and the sets that narrow it are offered: each area, and
      // each position the reports hold. The columns in the catalogue's order, by area.
      expect(m.by).toBeUndefined();
      expect(m.groups).toEqual([
        { by: 'area:Akut', part: 1, parts: 1, kind: 'area', label: 'Akut', types: 1 },
        { by: 'area:Examen', part: 1, parts: 1, kind: 'area', label: 'Examen', types: 1 },
        { by: 'area:Säkerhet', part: 1, parts: 1, kind: 'area', label: 'Säkerhet', types: 1 },
        { by: 'position:' + SSK, part: 1, parts: 1, kind: 'position', label: 'Sjuksköterska', types: 1 },
        { by: 'position:' + USK, part: 1, parts: 1, kind: 'position', label: 'Undersköterska', types: 1 },
      ]);
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
      // A set chosen narrows the columns and is in the answer; an unknown one is every column again.
      const degrees = await competence.matrix(boss, { by: 'area:Examen' });
      expect([degrees.by, degrees.part, degrees.columns.map(c => c.name)]).toEqual([
        'area:Examen',
        1,
        ['Socionomexamen'],
      ]);
      expect(degrees.rows.every(r => r.cells.length === 1)).toBe(true);
      const unknown = await competence.matrix(boss, { by: 'area:Okänd' });
      expect([unknown.by, unknown.columns.length]).toEqual([undefined, 2]);
      // An archived type is required of nobody, so it is no column; a single area and a position that asks for all of
      // it narrow nothing, so nothing is offered.
      await competence.archiveType(admin, degree);
      const alone = await competence.matrix(boss);
      expect(alone.columns.map(c => c.name)).toEqual(['HLR']);
      expect(alone.groups).toEqual([]);
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

    test('more required types than fit are offered as sets by area and by position, a part at a time, the chosen one in the address', async () => {
      directory();
      const { hlr } = await catalogue();
      const CAP = COMPETENCE_MATRIX_COLUMNS;
      const padded = (i: number) => String(i).padStart(2, '0');
      await competence.addRequirement(admin, { typeId: hlr, positionCode: USK });
      const safety: string[] = [];
      for (let i = 1; i <= CAP + 1; i++) {
        const id = await competence.addType(admin, {
          name: `Skydd ${padded(i)}`,
          area: 'Säkerhet',
          kind: 'certificate',
        });
        safety.push(id);
        await competence.addRequirement(admin, { typeId: id, positionCode: SSK });
      }
      const names = (m: CompetenceMatrixOutput) => m.columns.map(c => c.name);
      const first = await competence.matrix(boss);
      expect(checkContract(CompetenceMatrixOutputSchema, first)).toBe(true);
      expect(first.required).toBe(CAP + 2);
      // Areas first in Swedish order, then the positions the reports hold, by label; a set of one more than fits in two
      // parts.
      expect(first.groups).toEqual([
        { by: 'area:Akut', part: 1, parts: 1, kind: 'area', label: 'Akut', types: 1 },
        { by: 'area:Säkerhet', part: 1, parts: 2, kind: 'area', label: 'Säkerhet', types: CAP },
        { by: 'area:Säkerhet', part: 2, parts: 2, kind: 'area', label: 'Säkerhet', types: 1 },
        { by: 'position:' + SSK, part: 1, parts: 2, kind: 'position', label: 'Sjuksköterska', types: CAP },
        { by: 'position:' + SSK, part: 2, parts: 2, kind: 'position', label: 'Sjuksköterska', types: 1 },
        { by: 'position:' + USK, part: 1, parts: 1, kind: 'position', label: 'Undersköterska', types: 1 },
      ]);
      // Nothing chosen: the first set.
      expect([first.by, first.part, names(first)]).toEqual(['area:Akut', 1, ['HLR']]);
      const safe = await competence.matrix(boss, { by: 'area:Säkerhet' });
      expect(checkContract(CompetenceMatrixOutputSchema, safe)).toBe(true);
      expect([safe.by, safe.part]).toEqual(['area:Säkerhet', 1]);
      expect(names(safe)).toEqual(Array.from({ length: CAP }, (_, i) => `Skydd ${padded(i + 1)}`));
      expect(safe.rows.every(r => r.cells.length === CAP)).toBe(true);
      expect(names(await competence.matrix(boss, { by: 'area:Säkerhet', part: 2 }))).toEqual([`Skydd ${CAP + 1}`]);
      expect(names(await competence.matrix(boss, { by: 'position:' + SSK, part: 2 }))).toEqual([`Skydd ${CAP + 1}`]);
      expect(names(await competence.matrix(boss, { by: 'position:' + USK }))).toEqual(['HLR']);
      // Anna does not hold the position the safety set is asked of: required of Bo, not of her.
      expect(cells(safe)['Anna Andersson']![0]).toEqual(['none', null, false, []]);
      expect(cells(safe)['Bo Berg']![0]).toEqual(['missing', null, true, ['Sjuksköterska']]);
      // A part past the last is the set's first; an unknown set is the first set.
      expect([(await competence.matrix(boss, { by: 'area:Säkerhet', part: 7 })).part]).toEqual([1]);
      const unknown = await competence.matrix(boss, { by: 'area:Okänd' });
      expect([unknown.by, names(unknown)]).toEqual(['area:Akut', ['HLR']]);
      // Down to as many as fit, every type is shown unless a set is chosen, and the sets that narrow it are offered.
      await competence.archiveType(admin, safety[CAP]!);
      await competence.archiveType(admin, safety[CAP - 1]!);
      const fits = await competence.matrix(boss);
      expect([fits.by, fits.columns.length]).toEqual([undefined, CAP]);
      expect(fits.groups.map(g => [g.by, g.parts, g.types])).toEqual([
        ['area:Akut', 1, 1],
        ['area:Säkerhet', 1, CAP - 1],
        ['position:' + SSK, 1, CAP - 1],
        ['position:' + USK, 1, 1],
      ]);
      const chosen = await competence.matrix(boss, { by: 'area:Säkerhet' });
      expect([chosen.by, chosen.columns.length]).toEqual(['area:Säkerhet', CAP - 1]);
    });

    test('a matrix of twenty required types and thirty reports is read whole: every column, every person, a cell each', async () => {
      directory();
      await catalogue();
      // Twenty-eight more reports on the manager's unit beside Anna and Bo, each holding the undersköterska position.
      const more = Array.from({ length: 28 }, (_, i) =>
        person(`report-${String(i + 1).padStart(2, '0')}`, `Rapport ${String(i + 1).padStart(2, '0')}`, null),
      );
      for (const p of more) {
        store.addPerson({ id: p.id, organisationId: ORG, name: p.name, userName: p.userName });
        store.assign(p.id, 'u1');
        store.holdPosition(p.id, 'pos-usk');
      }
      staff.set('boss', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [anna, bo, ...more] }] });
      for (let i = 1; i <= 20; i++) {
        const id = await competence.addType(admin, {
          name: `Kompetens ${String(i).padStart(2, '0')}`,
          area: i % 2 ? 'Säkerhet' : 'Vård',
          kind: 'certificate',
        });
        await competence.addRequirement(admin, { typeId: id, positionCode: USK });
      }
      const m = await competence.matrix(boss);
      expect(checkContract(CompetenceMatrixOutputSchema, m)).toBe(true);
      expect([m.by, m.required, m.columns.length, m.rows.length]).toEqual([undefined, 20, 20, 30]);
      expect(m.rows.every(r => r.cells.length === 20)).toBe(true);
      // Two areas of ten: each narrows the twenty, so both are offered; the position asks for all of them and is not.
      expect(m.groups.map(g => [g.by, g.types])).toEqual([
        ['area:Säkerhet', 10],
        ['area:Vård', 10],
      ]);
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
        '\ufeff' +
          [
            'Namn;Användarnamn;HLR;Heta arbeten',
            'Anna Andersson;anna.a;Giltigt till 2028-01-31;Saknas',
            // Bo was provisioned without a user name: he is named by Clew's id, as everywhere in the domain.
            'Bo Berg;bo;Saknas;Går ut snart 2026-12-31 (krävs inte)',
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
      // Narrowed as the page is (`only: 'attention'`): with HLR registered for Bo, his soon expiring Heta arbeten is
      // not required of him and needs nobody, so he is not in the file; Anna's missing Heta arbeten is, alone.
      await competence.registerHolding(boss, 'bo', { typeId: hlr, issuedOn: '2025-12-01', expiresOn: '2028-01-31' });
      const narrowed = await competence.exportMatrix(boss, { only: 'attention' });
      expect(narrowed.text).toBe(
        '﻿' + ['Namn;Användarnamn;Heta arbeten', 'Anna Andersson;anna.a;Saknas'].join('\r\n') + '\r\n',
      );
      expect(lastAudit()).toMatchObject({ action: 'competence.matrix_exported', details: { people: 1, types: 1 } });
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
      const person = (n: number, name: string, key = 'p' + n) => ({ personId: 'p' + n, key, name, cells: [cell] });
      expect(
        matrixCsv({
          columns: [{ typeId: 't', name: 'Truck; A', area: 'Fordon', kind: 'authorisation' }],
          rows: [
            person(1, '=HYPERLINK("x")'),
            { ...person(2, '-Eva'), cells: [{ ...cell, status: 'expired', expiresOn: '2026-01-01' }] },
            person(3, '+46 70'),
            person(4, '@SUM(A1)'),
            person(5, '\tTab'),
            person(6, '\rRetur'),
            // A quote, a separator and a line break in a name, and a separator in a user name: each field quoted.
            person(7, 'Eva "E"; Ek\nNy rad', 'eva;e'),
          ],
        }),
      ).toBe(
        '﻿' +
          [
            'Namn;Användarnamn;"Truck; A"',
            `"'=HYPERLINK(""x"")";p1;Krävs inte`,
            `'-Eva;p2;Utgånget 2026-01-01 (krävs inte)`,
            `'+46 70;p3;Krävs inte`,
            `'@SUM(A1);p4;Krävs inte`,
            `'\tTab;p5;Krävs inte`,
            `"'\rRetur";p6;Krävs inte`,
            `"Eva ""E""; Ek\nNy rad";"eva;e";Krävs inte`,
          ].join('\r\n') +
          '\r\n',
      );
      expect(matrixCellText({ status: 'valid', required: true })).toBe('Giltigt');
      expect(matrixCellText({ status: 'missing', required: true })).toBe('Saknas');
    });
  });
});

describe("a manager's reports are D99's, not everyone Personal lists (D117 `managed`)", () => {
  type Placement = { unitId: string; role: 'manager' | 'employee' };
  /**
   * The directory as the provisioner pushes it and the production binding reads it (`composition/competence.ts`): the
   * people module's staff use cases on their memory store, and the units each with the people `reportsByUnit` keeps.
   * Bergsåkers skola, under Förvaltningen, is led by Hillevi and by Cohead; the Director leads Förvaltningen and is
   * placed on the school as an employee; Anna and Erik work there.
   */
  function world() {
    const T = '2026-11-10T08:00:00.000Z';
    const people = memoryProvisionStore(),
      s = people.state;
    const directoryStore = memoryCompetenceStore();
    const unit = (id: string, label: string, parent: string | null) => {
      s.units.set(id, { organisationId: ORG, label });
      s.groups.set('g-' + id, {
        id: 'g-' + id,
        organisationId: ORG,
        externalId: 'unit:' + id,
        label,
        parentUnitId: parent,
        createdAt: T,
        updatedAt: T,
      });
      directoryStore.addUnit({ id, organisationId: ORG, label, parentId: parent });
    };
    const person = (id: string, name: string, placements: Placement[]) => {
      s.users.set(id, {
        id,
        organisationId: ORG,
        externalId: 'dev:' + id,
        userName: id,
        name,
        email: null,
        phoneNumbers: [],
        employments: [],
        title: null,
        enabled: true,
        createdAt: T,
        updatedAt: T,
      });
      s.assignments.set(id, placements);
      const first = placements[0]!;
      s.grants.set(id, {
        unitId: first.unitId,
        unitLabel: s.units.get(first.unitId)!.label,
        role: first.role,
        capabilities: [],
      });
      directoryStore.addPerson({ id, organisationId: ORG, name, userName: id });
      for (const p of placements) directoryStore.assign(id, p.unitId);
    };
    unit('top', 'Förvaltningen', null);
    unit('skola', 'Bergsåkers skola', 'top');
    person('director', 'Dir Direktör', [
      { unitId: 'top', role: 'manager' },
      { unitId: 'skola', role: 'employee' },
    ]);
    person('hillevi', 'Hillevi Holm', [{ unitId: 'skola', role: 'manager' }]);
    person('cohead', 'Cohead Chef', [{ unitId: 'skola', role: 'manager' }]);
    person('anna', 'Anna Ek', [{ unitId: 'skola', role: 'employee' }]);
    person('erik', 'Erik Ström', [{ unitId: 'skola', role: 'employee' }]);
    const staff = staffUsecases({ store: people });
    const competence = competenceUsecases({
      store: directoryStore,
      staff: async persona => ({ units: reportsByUnit(await staff.reach(persona)) }),
      clock: () => now,
      ids: () => 'r-' + ++n,
    });
    return { staff, store: directoryStore, competence, hillevi: personaOf('hillevi', 'manager', 'Hillevi Holm') };
  }

  test('a card goes to exactly those who may decide: two who lead a unit and the unit above it are not each other’s managers', async () => {
    // Ada and Bea lead both Förvaltningen and the school under it; Eva works at the school. By the line upwards each of
    // the two is above the other, and by the reports downwards neither is the other's report.
    const T = '2026-11-10T08:00:00.000Z';
    const people = memoryProvisionStore(),
      s = people.state;
    const directoryStore = memoryCompetenceStore();
    for (const [id, label, parent] of [
      ['top', 'Förvaltningen', null],
      ['skola', 'Bergsåkers skola', 'top'],
    ] as const) {
      s.units.set(id, { organisationId: ORG, label });
      s.groups.set('g-' + id, {
        id: 'g-' + id,
        organisationId: ORG,
        externalId: 'unit:' + id,
        label,
        parentUnitId: parent,
        createdAt: T,
        updatedAt: T,
      });
      directoryStore.addUnit({ id, organisationId: ORG, label, parentId: parent });
    }
    const placed = (id: string, name: string, placements: Array<{ unitId: string; role: 'manager' | 'employee' }>) => {
      s.users.set(id, {
        id,
        organisationId: ORG,
        externalId: 'dev:' + id,
        userName: id,
        name,
        email: null,
        phoneNumbers: [],
        employments: [],
        title: null,
        enabled: true,
        createdAt: T,
        updatedAt: T,
      });
      s.assignments.set(id, placements);
      s.grants.set(id, {
        unitId: placements[0]!.unitId,
        unitLabel: s.units.get(placements[0]!.unitId)!.label,
        role: placements[0]!.role,
        capabilities: [],
      });
      directoryStore.addPerson({ id, organisationId: ORG, name, userName: id });
      for (const p of placements) directoryStore.assign(id, p.unitId);
      return personaOf(id, placements[0]!.role, name);
    };
    const both = [
      { unitId: 'top', role: 'manager' as const },
      { unitId: 'skola', role: 'manager' as const },
    ];
    const ada = placed('ada', 'Ada Ledare', both),
      bea = placed('bea', 'Bea Ledare', both),
      eva = placed('eva', 'Eva Ek', [{ unitId: 'skola', role: 'employee' }]);
    const personas = new Map([ada, bea, eva].map(p => [p.id, p]));
    const staffOf = staffUsecases({ store: people });
    const c = competenceUsecases({
      store: directoryStore,
      // As composition binds them: the reports downwards, the line upwards, and a person from their grant.
      staff: async persona => ({ units: reportsByUnit(await staffOf.reach(persona)) }),
      above: async persona => (await staffOf.reach(persona)).above.filter(id => id !== persona.id),
      personaOf: async id => personas.get(id),
      clock: () => now,
      ids: () => 'co-' + ++n,
    });
    const typeId = await c.seedType('operator:test', ORG, {
      name: 'Heta arbeten',
      area: 'Säkerhet',
      kind: 'certificate',
    });
    // The line says Ada is above Bea; Ada's reports do not hold Bea. Bea's registration would go to someone who is
    // refused its decision, so nobody gets it, and the form says so.
    expect((await staffOf.reach(bea)).above).toContain('ada');
    expect((await c.ownRegistrations(bea)).approver).toBe(false);
    await expect(c.registerOwn(bea, { typeId, issuedOn: '2026-01-10' })).rejects.toThrow(
      'Registreringen kan inte skickas: ingen chef är registrerad för dig.',
    );
    expect(directoryStore.calls()).toEqual([]);
    // Eva's goes to both, and either decides it.
    const id = await c.registerOwn(eva, { typeId, issuedOn: '2026-01-10' });
    expect(directoryStore.calls()).toEqual([
      expect.objectContaining({ op: 'open', holdingId: id, managers: ['ada', 'bea'] }),
    ]);
    await c.decideHolding(bea, id, 'approve');
    expect(directoryStore.state.holdings.get(id)).toMatchObject({ state: 'valid', decidedBy: 'bea' });
  });

  test('a co-manager and the reader’s own manager, though placed on the unit, are in no read and take no write', async () => {
    const w = world();
    // Personal lists them: the fixture is shaped like the real directory.
    const listed = (await w.staff.overview(w.hillevi)).units.flatMap(u => u.people.map(p => p.id));
    expect(listed).toEqual(expect.arrayContaining(['cohead', 'director', 'anna', 'erik']));

    const hlr = await w.competence.addType(admin, { name: 'HLR', area: 'Akut', kind: 'course' });
    // Required of everyone placed on the school, the two managers included.
    await w.competence.addRequirement(admin, { typeId: hlr, unitId: 'skola' });
    const theirs = await w.competence.seedHolding('operator:cli', ORG, 'cohead', {
      typeId: hlr,
      issuedOn: '2026-01-10',
    });

    const matrix = await w.competence.matrix(w.hillevi);
    expect(matrix.rows.map(r => r.name)).toEqual(['Anna Ek', 'Erik Ström']);
    const file = await w.competence.exportMatrix(w.hillevi);
    for (const name of ['Cohead Chef', 'Dir Direktör']) expect(file.text).not.toContain(name);
    expect(file.text).toContain('Anna Ek;anna;Saknas');
    expect((await w.competence.attention(w.hillevi)).rows.map(r => r.name)).toEqual(['Anna Ek', 'Erik Ström']);
    // The figure on Hem and the manager's card count the two reports only.
    expect(await w.competence.summary(w.hillevi)).toEqual({
      expired: 0,
      missing: 2,
      expiring: 0,
      people: 2,
      reports: 2,
    });
    expect((await w.competence.aboutPeople(w.hillevi, ['anna', 'cohead', 'director'])).rows.map(r => r.key)).toEqual([
      'anna',
    ]);

    const written = w.store.audit().length;
    for (const id of ['cohead', 'director']) {
      await expect(
        w.competence.registerHolding(w.hillevi, id, { typeId: hlr, issuedOn: '2026-10-01' }),
      ).rejects.toThrow('Personen finns inte bland dem du är chef för.');
      await expect(w.competence.holdings(w.hillevi, { person: id })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(w.competence.addRequirement(w.hillevi, { typeId: hlr, personId: id })).rejects.toBeInstanceOf(
        ForbiddenError,
      );
    }
    await expect(w.competence.revokeHolding(w.hillevi, theirs)).rejects.toBeInstanceOf(ForbiddenError);
    expect(w.store.audit().length).toBe(written);
    // A real report is still hers to register for.
    await w.competence.registerHolding(w.hillevi, 'anna', { typeId: hlr, issuedOn: '2026-10-01' });
    expect(w.store.audit().length).toBe(written + 1);
  });
});

/**
 * A person's own registration (D108 item 7): stored pending with evidence `self`, counting towards nothing, its
 * approval a card in the stream of each manager the person reports to, closed in the same transaction as the decision
 * or the person taking it back. Anna reports to Karin and Olle, two managers of her unit; Bo to Karin; Dan to nobody.
 */
describe('a person registers their own certificate and the manager they report to decides it (D108 item 7)', () => {
  const asDan = personaOf('dan', 'employee', 'Dan Dahl');
  const third = personaOf('third', 'manager', 'Tredje Chef');
  let above: Map<string, string[]>;
  let own: CompetenceUsecases;
  /** Each person as the use cases take one from their grant: nobody while the directory has them deactivated. */
  const granted = new Map([boss, other, third, asAnna, asBo, asDan].map(p => [p.id, p as AuthenticatedContext]));
  beforeEach(() => {
    above = new Map([
      ['anna', ['other', 'boss']],
      ['bo', ['boss']],
    ]);
    staff.set('other', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [anna, dan] }] });
    store.addPerson({ id: 'other', organisationId: ORG, name: 'Olle Chef', userName: 'other' });
    store.addPerson({ id: 'third', organisationId: ORG, name: 'Tredje Chef', userName: 'third' });
    own = competenceUsecases({
      store,
      staff: async persona => staff.get(persona.id) ?? { units: [] },
      above: async persona => above.get(persona.id) ?? [],
      personaOf: async id => (store.state.persons.get(id)?.enabled === false ? undefined : granted.get(id)),
      clock: () => now,
      ids: () => 'id-' + ++n,
    });
  });
  const calls = () => store.calls();
  /** Each manager's card of one approval, by owner: whether it is open and how Clew last closed it. */
  const cardsOf = (threadId: string) =>
    [...store.state.cards.values()]
      .filter(c => c.threadId === threadId)
      .sort((a, b) => a.personId.localeCompare(b.personId))
      .map(c => [c.personId, c.state, c.outcome]);
  const reconciled = () => audits().filter(a => a.action === 'competence.approval_reconciled');
  const actions = () => audits().map(a => a.action);
  /** HLR (24 months by the employer's rule), Heta arbeten and Socionomexamen; HLR required of Anna by Karin. */
  async function setup() {
    const types = await catalogue();
    await own.addRequirement(boss, { typeId: types.hlr, personId: 'anna' });
    store.addUnit({ id: 'u1', organisationId: ORG, label: 'Enhet 1' });
    store.assign('anna', 'u1');
    return types;
  }

  test('it is stored pending with evidence self, with one card per manager she reports to and an audit row of ids', async () => {
    const { hlr, hot } = await setup();
    const before = audits().length;
    const id = await own.registerOwn(asAnna, { typeId: hlr, issuedOn: '2026-01-10' });
    const threadId = store.state.holdings.get(id)!.threadId!;
    expect(store.state.holdings.get(id)).toEqual({
      id,
      personId: 'anna',
      typeId: hlr,
      issuedOn: '2026-01-10',
      expiresOn: null,
      evidence: 'self',
      state: 'pending',
      registeredBy: 'anna',
      createdAt: now.toISOString(),
      revokedAt: null,
      revokedBy: null,
      copy: null,
      decidedBy: null,
      decidedAt: null,
      threadId,
      level: null,
      interest: false,
      validatedBy: null,
      validatedAt: null,
      ratedAt: null,
    });
    // Both managers get a card, in one call, about her by her user name and naming nothing else.
    expect(calls()).toEqual([
      {
        op: 'open',
        threadId,
        holdingId: id,
        managers: ['boss', 'other'],
        at: now.toISOString(),
        subject: { entity: 'person', key: 'anna' },
      },
    ]);
    expect([...store.state.cards.keys()].sort()).toEqual([threadId + ':boss', threadId + ':other']);
    expect(audits().slice(before)).toEqual([
      {
        actor: 'person:anna',
        action: 'competence.holding_submitted',
        subject: 'holding:' + id,
        at: now.toISOString(),
        details: {
          personId: 'anna',
          typeId: hlr,
          issuedOn: '2026-01-10',
          expiresOn: null,
          managers: ['boss', 'other'],
        },
      },
    ]);
    // Bo has no user name: his card is about him all the same, by Clew's id for him, as every card names a person (D122).
    await own.registerOwn(asBo, { typeId: hot, issuedOn: '2026-02-01', expiresOn: '2031-01-31' });
    expect(calls().at(-1)).toEqual({
      op: 'open',
      subject: { entity: 'person', key: 'bo' },
      threadId: expect.any(String),
      holdingId: expect.any(String),
      managers: ['boss'],
      at: now.toISOString(),
    });
  });

  test('it is refused, with nothing written and no card, without a manager, twice while waiting, for a type that cannot be registered and for a wrong day', async () => {
    const { hlr, hot } = await setup();
    await own.registerOwn(asAnna, { typeId: hlr, issuedOn: '2026-01-10' });
    await own.archiveType(admin, hot);
    const foreign = await own.seedType('operator:test', 'org-2', { name: 'Annan', area: 'X', kind: 'course' });
    const holdings = store.state.holdings.size,
      written = audits().length,
      called = calls().length;
    for (const [persona, body, message] of [
      [
        asDan,
        { typeId: hlr, issuedOn: '2026-01-10' },
        'Registreringen kan inte skickas: ingen chef är registrerad för dig.',
      ],
      [
        asAnna,
        { typeId: hlr, issuedOn: '2026-02-10' },
        'Du har redan en registrering av den kompetensen som väntar på godkännande.',
      ],
      [asAnna, { typeId: hot, issuedOn: '2026-01-10' }, 'Kompetensen är arkiverad och kan inte registreras.'],
      [asAnna, { typeId: foreign, issuedOn: '2026-01-10' }, 'Kompetensen finns inte i katalogen.'],
      [asAnna, { typeId: 'nope', issuedOn: '2026-01-10' }, 'Kompetensen finns inte i katalogen.'],
      [asAnna, { typeId: hlr, issuedOn: '2026-11-11' }, 'Ett intyg kan inte vara utfärdat en dag som inte har kommit.'],
      [asAnna, { typeId: hlr, issuedOn: '2026-02-30' }, 'Ange ett giltigt datum.'],
      [
        asAnna,
        { typeId: hlr, issuedOn: '2026-01-10', expiresOn: '2026-01-09' },
        'Slutdatumet kan inte vara före utfärdandet.',
      ],
    ] as const) {
      const attempt = own.registerOwn(persona, body);
      await expect(attempt).rejects.toBeInstanceOf(CompetenceError);
      await expect(attempt).rejects.toThrow(message);
    }
    expect(store.state.holdings.size).toBe(holdings);
    expect(audits()).toHaveLength(written);
    expect(calls()).toHaveLength(called);
    // Without the port everyone reports to nobody, as the earlier slices were built.
    await expect(competence.registerOwn(asBo, { typeId: hlr, issuedOn: '2026-01-10' })).rejects.toThrow(
      'Registreringen kan inte skickas: ingen chef är registrerad för dig.',
    );
  });

  test('while it waits it counts towards nothing: status, matrix, attention, figure, coverage, the read about people and her own card', async () => {
    const { hlr } = await setup();
    const id = await own.registerOwn(asAnna, { typeId: hlr, issuedOn: '2026-01-10' });
    // Her own list: HLR is still missing, and her registration waits beside it.
    expect((await own.holdings(asAnna)).rows.map(r => [r.competence, r.status, r.expiresOn ?? null])).toEqual([
      ['HLR', 'missing', null],
      ['HLR', 'awaiting-approval', '2028-01-10'],
    ]);
    expect(checkContract(CompetenceHoldingsOutputSchema, await own.holdings(asAnna))).toBe(true);
    // Her manager sees it waiting too.
    expect((await own.holdings(boss, { person: 'anna.a' })).rows.map(r => r.status)).toEqual([
      'missing',
      'awaiting-approval',
    ]);
    // The matrix cell is what it is without it, and names the registration that waits.
    const cell = (await own.matrix(boss)).rows.find(r => r.personId === 'anna')!.cells[0]!;
    expect(cell).toMatchObject({ typeId: hlr, status: 'missing', required: true, pending: id });
    expect(checkContract(CompetenceMatrixOutputSchema, await own.matrix(boss))).toBe(true);
    expect((await own.attention(boss)).rows.map(r => [r.name, r.status])).toEqual([['Anna Andersson', 'missing']]);
    expect(await own.summary(boss)).toEqual({ expired: 0, missing: 1, expiring: 0, people: 1, reports: 2 });
    expect((await own.aboutPeople(boss, ['anna.a'])).rows).toEqual([
      { key: 'anna.a', expired: 0, missing: 1, expiring: 0, holdings: 0 },
    ]);
    expect((await own.coverage(boss, 'u1')).requirements.map(r => [r.under, r.meeting])).toEqual([[1, 0]]);
    // Her "saknas" card stays until it is approved.
    expect((await own.scanOf(asAnna, false)).own.map(o => [o.standing.type.name, o.standing.status])).toEqual([
      ['HLR', 'missing'],
    ]);
    expect((await own.validityImpact(admin, hlr, 12)).holdings).toBe(0);

    // Approved, it counts like any holding.
    await own.decideHolding(boss, id, 'approve');
    expect((await own.holdings(asAnna)).rows.map(r => [r.competence, r.status, r.evidence])).toEqual([
      ['HLR', 'valid', 'self'],
    ]);
    expect((await own.matrix(boss)).rows.find(r => r.personId === 'anna')!.cells[0]).toMatchObject({
      status: 'valid',
      holdingId: id,
      evidence: 'self',
      revocable: true,
    });
    expect((await own.matrix(boss)).rows.find(r => r.personId === 'anna')!.cells[0]!.pending).toBeUndefined();
    expect(await own.summary(boss)).toEqual({ expired: 0, missing: 0, expiring: 0, people: 0, reports: 2 });
    expect((await own.coverage(boss, 'u1')).requirements.map(r => [r.under, r.meeting])).toEqual([[1, 1]]);
    expect((await own.scanOf(asAnna, false)).own).toEqual([]);
  });

  test('a manager she reports to approves it: valid, evidence self, decided by and when; every card closes; deciding twice is refused', async () => {
    const { hlr } = await setup();
    const id = await own.registerOwn(asAnna, { typeId: hlr, issuedOn: '2026-01-10' });
    const threadId = store.state.holdings.get(id)!.threadId!;
    now = new Date('2026-11-11T09:00:00.000Z');
    const before = audits().length;
    // The second manager decides; Karin's card closes with Olle's.
    await own.decideHolding(other, id, 'approve');
    expect(store.state.holdings.get(id)).toMatchObject({
      state: 'valid',
      evidence: 'self',
      decidedBy: 'other',
      decidedAt: now.toISOString(),
      registeredBy: 'anna',
    });
    expect(calls().at(-1)).toEqual({ op: 'close', threadId, at: now.toISOString(), outcome: 'approved' });
    expect([...store.state.cards.values()].map(c => [c.personId, c.state, c.outcome])).toEqual([
      ['boss', 'handled', 'approved'],
      ['other', 'handled', 'approved'],
    ]);
    expect(audits().slice(before)).toEqual([
      {
        actor: 'person:other',
        action: 'competence.holding_approved',
        subject: 'holding:' + id,
        at: now.toISOString(),
        details: { personId: 'anna', typeId: hlr },
      },
    ]);
    const written = audits().length,
      called = calls().length;
    for (const decision of ['approve', 'reject'] as const) {
      const attempt = own.decideHolding(boss, id, decision);
      await expect(attempt).rejects.toBeInstanceOf(CompetenceError);
      await expect(attempt).rejects.toThrow('Registreringen är redan granskad.');
    }
    await expect(own.approval(boss, id)).rejects.toThrow('Registreringen är redan granskad.');
    expect(audits()).toHaveLength(written);
    expect(calls()).toHaveLength(called);
  });

  test('rejected, it counts towards nothing and is listed to her alone', async () => {
    const { hot } = await setup();
    const id = await own.registerOwn(asAnna, { typeId: hot, issuedOn: '2026-01-10', expiresOn: '2031-01-09' });
    const threadId = store.state.holdings.get(id)!.threadId!;
    await own.decideHolding(boss, id, 'reject');
    expect(store.state.holdings.get(id)).toMatchObject({ state: 'rejected', decidedBy: 'boss' });
    expect(calls().at(-1)).toEqual({ op: 'close', threadId, at: now.toISOString(), outcome: 'rejected' });
    expect(lastAudit()).toEqual({
      actor: 'person:boss',
      action: 'competence.holding_rejected',
      subject: 'holding:' + id,
      at: now.toISOString(),
      details: { personId: 'anna', typeId: hot },
    });
    expect((await own.holdings(asAnna)).rows.map(r => [r.competence, r.status])).toEqual([
      ['HLR', 'missing'],
      ['Heta arbeten', 'rejected'],
    ]);
    expect((await own.holdings(boss, { person: 'anna.a' })).rows.map(r => r.status)).toEqual(['missing']);
    expect((await own.matrix(boss)).rows.find(r => r.personId === 'anna')!.cells.map(c => c.pending)).toEqual([
      undefined,
    ]);
    // A rejection is no holding to revoke, and a new registration of the type may wait again.
    await expect(own.revokeHolding(boss, id)).rejects.toThrow('Du kan inte ändra det här intyget.');
    await own.registerOwn(asAnna, { typeId: hot, issuedOn: '2026-02-10' });
  });

  test('only a manager she reports to now decides it, and anyone else is refused in the same words', async () => {
    const { hlr } = await setup();
    const id = await own.registerOwn(asAnna, { typeId: hlr, issuedOn: '2026-01-10' });
    const managed = await own.registerHolding(boss, 'anna', { typeId: hlr, issuedOn: '2025-01-10' });
    const written = audits().length,
      called = calls().length;
    const third = personaOf('third', 'manager', 'Tredje Chef');
    for (const [persona, holdingId] of [
      [third, id],
      [asAnna, id],
      [asBo, id],
      [admin, id],
      [boss, 'nope'],
      // A manager's registration is no registration of hers to decide.
      [boss, managed],
    ] as const) {
      const attempt = own.decideHolding(persona, holdingId, 'approve');
      await expect(attempt).rejects.toBeInstanceOf(ForbiddenError);
      await expect(attempt).rejects.toThrow('Registreringen finns inte bland dem du kan granska.');
      await expect(own.approval(persona, holdingId)).rejects.toThrow(
        'Registreringen finns inte bland dem du kan granska.',
      );
    }
    expect(store.state.holdings.get(id)?.state).toBe('pending');
    expect(audits()).toHaveLength(written);
    expect(calls()).toHaveLength(called);
    // Her manager reads it as the approval's dialog shows it.
    expect(await own.approval(boss, id)).toEqual({
      holdingId: id,
      personId: 'anna',
      key: 'anna.a',
      name: 'Anna Andersson',
      typeId: hlr,
      competence: 'HLR',
      area: 'Akut',
      issuedOn: '2026-01-10',
      expiresOn: '2028-01-10',
      registeredAt: now.toISOString(),
    });
    // A registration that waits is decided, never revoked.
    await expect(own.revokeHolding(boss, id)).rejects.toThrow('Du kan inte ändra det här intyget.');
  });

  test('when she changes manager the former one decides nothing, the new one decides from the matrix, and every card closes', async () => {
    const { hlr } = await setup();
    above.set('anna', ['boss']);
    const id = await own.registerOwn(asAnna, { typeId: hlr, issuedOn: '2026-01-10' });
    const threadId = store.state.holdings.get(id)!.threadId!;
    // She moves to Olle alone. Karin decides nothing; Olle finds it in the matrix and decides it, and the cards are
    // reconciled first: Karin's is set aside as no longer hers, then his, opened for him, closes with the decision.
    staff.set('boss', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [bo] }] });
    above.set('anna', ['other']);
    await expect(own.decideHolding(boss, id, 'approve')).rejects.toThrow(
      'Registreringen finns inte bland dem du kan granska.',
    );
    expect((await own.matrix(other)).rows.find(r => r.personId === 'anna')!.cells[0]!.pending).toBe(id);
    expect((await own.matrix(other)).awaiting.map(a => a.holdingId)).toEqual([id]);
    expect((await own.matrix(boss)).awaiting).toEqual([]);
    await own.decideHolding(other, id, 'approve');
    expect(calls().map(c => [c.op, 'outcome' in c ? c.outcome : null])).toEqual([
      ['open', null],
      ['close', 'reassigned'],
      ['open', null],
      ['close', 'approved'],
    ]);
    expect(cardsOf(threadId)).toEqual([
      ['boss', 'handled', 'reassigned'],
      ['other', 'handled', 'approved'],
    ]);
    expect(actions().slice(-2)).toEqual(['competence.approval_reconciled', 'competence.holding_approved']);
    expect(lastAudit()).toMatchObject({ actor: 'person:other', action: 'competence.holding_approved' });
  });

  test('a type nobody requires, after a change of manager, is within the new manager’s reach from the list of what waits', async () => {
    const { degree } = await setup();
    above.set('anna', ['boss']);
    const id = await own.registerOwn(asAnna, { typeId: degree, issuedOn: '2015-06-05' });
    staff.set('boss', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [bo] }] });
    above.set('anna', ['other']);
    // No column holds it (nothing requires a degree of anyone), and the list does.
    const matrix = await own.matrix(other);
    expect(matrix.columns.map(c => c.typeId)).not.toContain(degree);
    expect(matrix.awaiting).toEqual([
      {
        holdingId: id,
        personId: 'anna',
        key: 'anna.a',
        name: 'Anna Andersson',
        typeId: degree,
        competence: 'Socionomexamen',
        issuedOn: '2015-06-05',
      },
    ]);
    expect(checkContract(CompetenceMatrixOutputSchema, matrix)).toBe(true);
    await own.decideHolding(other, id, 'approve');
    expect(store.state.holdings.get(id)).toMatchObject({ state: 'valid', decidedBy: 'other' });
  });

  test('reconciled each day: a change of manager sets the former one’s card aside and opens one for the new; nothing to change writes nothing', async () => {
    const { hlr } = await setup();
    above.set('anna', ['boss']);
    const id = await own.registerOwn(asAnna, { typeId: hlr, issuedOn: '2026-01-10' });
    const threadId = store.state.holdings.get(id)!.threadId!;
    // In step: nothing written, no card touched.
    const before = audits().length,
      called = calls().length;
    expect(await own.reconcileApprovals()).toEqual({
      registrations: 1,
      changed: 0,
      opened: 0,
      closed: 0,
      reopened: 0,
      failed: 0,
    });
    expect(audits()).toHaveLength(before);
    expect(calls()).toHaveLength(called);
    // She moves to Tredje.
    staff.set('boss', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [bo] }] });
    staff.set('third', { units: [{ unitId: 'u4', unitLabel: 'Enhet 4', people: [anna] }] });
    above.set('anna', ['third']);
    now = new Date('2026-11-11T02:00:00.000Z');
    expect(await own.reconcileApprovals()).toMatchObject({ registrations: 1, changed: 1, opened: 1, closed: 1 });
    expect(cardsOf(threadId)).toEqual([
      ['boss', 'handled', 'reassigned'],
      ['third', 'open', null],
    ]);
    expect(reconciled()).toEqual([
      {
        actor: 'system:competence-approvals',
        action: 'competence.approval_reconciled',
        subject: 'holding:' + id,
        at: now.toISOString(),
        details: { personId: 'anna', active: true, opened: 1, closed: 1, reopened: 0 },
      },
    ]);
    // And back to Karin: her card, set aside by Clew, opens again; Tredje's is set aside.
    staff.set('boss', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [anna, bo] }] });
    above.set('anna', ['boss']);
    await own.reconcileApprovals();
    expect(cardsOf(threadId)).toEqual([
      ['boss', 'open', null],
      ['third', 'handled', 'reassigned'],
    ]);
    expect(reconciled().at(-1)!.details).toEqual({ personId: 'anna', active: true, opened: 0, closed: 1, reopened: 1 });
  });

  test('a card its owner put away while they can still decide stays as they left it; the list of what waits still has it', async () => {
    const { hlr } = await setup();
    const id = await own.registerOwn(asAnna, { typeId: hlr, issuedOn: '2026-01-10' });
    const threadId = store.state.holdings.get(id)!.threadId!;
    store.setOwn(threadId + ':boss', 'handled');
    store.setOwn(threadId + ':other', 'dismissed');
    expect((await own.reconcileApprovals()).changed).toBe(0);
    expect(cardsOf(threadId)).toEqual([
      ['boss', 'handled', null],
      ['other', 'dismissed', null],
    ]);
    expect((await own.matrix(boss)).awaiting.map(a => a.holdingId)).toEqual([id]);
  });

  test('a manager deactivated loses the card; one erased loses it too, and whoever decides now gets one', async () => {
    const { hlr } = await setup();
    const id = await own.registerOwn(asAnna, { typeId: hlr, issuedOn: '2026-01-10' });
    const threadId = store.state.holdings.get(id)!.threadId!;
    // Olle is deactivated: the directory no longer has him above her, and he can decide nothing.
    store.deactivate('other');
    staff.delete('other');
    above.set('anna', ['boss']);
    await own.reconcileApprovals();
    expect(cardsOf(threadId)).toEqual([
      ['boss', 'open', null],
      ['other', 'handled', 'reassigned'],
    ]);
    // Karin is deactivated and erased: her card goes with her, and Tredje, who leads Anna now, gets one.
    store.deactivate('boss');
    await own.erasePerson('operator:cli', 'boss');
    expect(cardsOf(threadId)).toEqual([['other', 'handled', 'reassigned']]);
    staff.set('third', { units: [{ unitId: 'u4', unitLabel: 'Enhet 4', people: [anna] }] });
    above.set('anna', ['third']);
    await own.reconcileApprovals();
    expect(cardsOf(threadId)).toEqual([
      ['other', 'handled', 'reassigned'],
      ['third', 'open', null],
    ]);
    await own.decideHolding(third, id, 'approve');
    expect(store.state.holdings.get(id)).toMatchObject({ state: 'valid', decidedBy: 'third' });
  });

  test('while she is deactivated with a registration waiting, nobody decides it, no list shows it and every card is set aside; back, they open again', async () => {
    const { hlr } = await setup();
    const id = await own.registerOwn(asAnna, { typeId: hlr, issuedOn: '2026-01-10' });
    const threadId = store.state.holdings.get(id)!.threadId!;
    store.deactivate('anna');
    const away = { ...anna, enabled: false };
    staff.set('boss', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [away, bo] }] });
    staff.set('other', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [away, dan] }] });
    expect((await own.matrix(boss)).awaiting).toEqual([]);
    await expect(own.decideHolding(boss, id, 'approve')).rejects.toThrow(
      'Registreringen finns inte bland dem du kan granska.',
    );
    await own.reconcileApprovals();
    expect(cardsOf(threadId)).toEqual([
      ['boss', 'handled', 'paused'],
      ['other', 'handled', 'paused'],
    ]);
    expect(reconciled().at(-1)!.details).toEqual({
      personId: 'anna',
      active: false,
      opened: 0,
      closed: 2,
      reopened: 0,
    });
    // Reactivated, and still waiting: both cards open again, and the registration is decided as before.
    store.reactivate('anna');
    staff.set('boss', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [anna, bo] }] });
    staff.set('other', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [anna, dan] }] });
    await own.reconcileApprovals();
    expect(cardsOf(threadId)).toEqual([
      ['boss', 'open', null],
      ['other', 'open', null],
    ]);
    expect(reconciled().at(-1)!.details).toEqual({ personId: 'anna', active: true, opened: 0, closed: 0, reopened: 2 });
    await own.decideHolding(boss, id, 'reject');
    expect(cardsOf(threadId)).toEqual([
      ['boss', 'handled', 'rejected'],
      ['other', 'handled', 'rejected'],
    ]);
  });

  test('one registration that cannot be reconciled is counted and the rest are', async () => {
    const { hlr, hot } = await setup();
    above.set('anna', ['boss']);
    await own.registerOwn(asAnna, { typeId: hlr, issuedOn: '2026-01-10' });
    await own.registerOwn(asAnna, { typeId: hot, issuedOn: '2026-01-10' });
    above.set('anna', ['other']);
    store.sink.throwOn = 'open';
    expect(await own.reconcileApprovals()).toMatchObject({ registrations: 2, changed: 0, failed: 2 });
    store.sink.throwOn = undefined;
    expect(await own.reconcileApprovals()).toMatchObject({ registrations: 2, changed: 2, opened: 2, closed: 2 });
    // Without the port that builds a person from their grant, nothing is reconciled.
    expect(await competence.reconcileApprovals()).toMatchObject({ registrations: 0 });
  });

  test('a rejected registration is the person’s alone to remove, with its audit row; one that waits or was approved is not', async () => {
    const { hlr, hot } = await setup();
    const rejected = await own.registerOwn(asAnna, { typeId: hlr, issuedOn: '2026-01-10' });
    await own.decideHolding(boss, rejected, 'reject');
    const waiting = await own.registerOwn(asAnna, { typeId: hot, issuedOn: '2026-01-10' });
    for (const persona of [boss, asBo])
      await expect(own.removeRejected(persona, rejected)).rejects.toThrow('Du har ingen sådan registrering.');
    await expect(own.removeRejected(asAnna, waiting)).rejects.toThrow(
      'Bara en registrering som din chef har avvisat kan tas bort.',
    );
    await own.removeRejected(asAnna, rejected);
    expect(store.state.holdings.has(rejected)).toBe(false);
    expect(lastAudit()).toEqual({
      actor: 'person:anna',
      action: 'competence.holding_removed',
      subject: 'holding:' + rejected,
      at: now.toISOString(),
      details: { personId: 'anna', typeId: hlr },
    });
    expect((await own.ownRegistrations(asAnna)).rejected).toEqual([]);
    await expect(own.removeRejected(asAnna, rejected)).rejects.toThrow('Du har ingen sådan registrering.');
  });

  test('she takes it back while it waits: the row is removed and every card closes; nobody else can, and a decided one cannot', async () => {
    const { hlr, hot } = await setup();
    const id = await own.registerOwn(asAnna, { typeId: hlr, issuedOn: '2026-01-10' });
    const threadId = store.state.holdings.get(id)!.threadId!;
    await expect(own.withdrawOwn(boss, id)).rejects.toThrow('Du har ingen sådan registrering.');
    await expect(own.withdrawOwn(asBo, id)).rejects.toBeInstanceOf(ForbiddenError);
    const before = audits().length;
    await own.withdrawOwn(asAnna, id);
    expect(store.state.holdings.has(id)).toBe(false);
    expect(calls().at(-1)).toEqual({ op: 'close', threadId, at: now.toISOString(), outcome: 'withdrawn' });
    expect([...store.state.cards.values()].every(c => c.state === 'handled' && c.outcome === 'withdrawn')).toBe(true);
    expect(audits().slice(before)).toEqual([
      {
        actor: 'person:anna',
        action: 'competence.holding_withdrawn',
        subject: 'holding:' + id,
        at: now.toISOString(),
        details: { personId: 'anna', typeId: hlr },
      },
    ]);
    // Taken back twice, or decided once taken back, is refused and writes nothing.
    await expect(own.withdrawOwn(asAnna, id)).rejects.toThrow('Du har ingen sådan registrering.');
    await expect(own.decideHolding(boss, id, 'approve')).rejects.toThrow(
      'Registreringen finns inte bland dem du kan granska.',
    );
    expect(audits()).toHaveLength(before + 1);
    // One that is decided stays.
    const decided = await own.registerOwn(asAnna, { typeId: hot, issuedOn: '2026-01-10' });
    await own.decideHolding(boss, decided, 'approve');
    await expect(own.withdrawOwn(asAnna, decided)).rejects.toThrow(
      'Registreringen är redan granskad och kan inte tas tillbaka.',
    );
    // A manager's registration of hers is no registration of her own.
    const managed = await own.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2025-01-10' });
    await expect(own.withdrawOwn(asAnna, managed)).rejects.toThrow('Du har ingen sådan registrering.');
  });

  test('what her own registration needs: whether anyone decides it, and the ones that wait', async () => {
    const { hlr, hot } = await setup();
    expect(await own.ownRegistrations(asAnna)).toEqual({ approver: true, pending: [], rejected: [], skills: [] });
    expect(await own.ownRegistrations(asDan)).toEqual({ approver: false, pending: [], rejected: [], skills: [] });
    const first = await own.registerOwn(asAnna, { typeId: hlr, issuedOn: '2026-01-10' });
    const second = await own.registerOwn(asAnna, { typeId: hot, issuedOn: '2026-02-01', expiresOn: '2031-01-31' });
    await own.decideHolding(boss, second, 'reject');
    expect(await own.ownRegistrations(asAnna)).toEqual({
      approver: true,
      pending: [{ holdingId: first, typeId: hlr, competence: 'HLR', issuedOn: '2026-01-10', expiresOn: '2028-01-10' }],
      rejected: [
        { holdingId: second, typeId: hot, competence: 'Heta arbeten', issuedOn: '2026-02-01', expiresOn: '2031-01-31' },
      ],
      skills: [],
    });
  });

  test('a card that cannot be opened or closed rolls the registration and its audit row back', async () => {
    const { hlr } = await setup();
    store.sink.throwOn = 'open';
    const holdings = store.state.holdings.size,
      written = audits().length;
    await expect(own.registerOwn(asAnna, { typeId: hlr, issuedOn: '2026-01-10' })).rejects.toThrow(
      'card sink failed on open',
    );
    expect(store.state.holdings.size).toBe(holdings);
    expect(audits()).toHaveLength(written);
    store.sink.throwOn = undefined;
    const id = await own.registerOwn(asAnna, { typeId: hlr, issuedOn: '2026-01-10' });
    store.sink.throwOn = 'close';
    await expect(own.decideHolding(boss, id, 'approve')).rejects.toThrow('card sink failed on close');
    await expect(own.withdrawOwn(asAnna, id)).rejects.toThrow('card sink failed on close');
    expect(store.state.holdings.get(id)).toMatchObject({ state: 'pending', decidedBy: null });
    expect(actions().at(-1)).toBe('competence.holding_submitted');
  });

  test('erasure takes her registrations with every card, a taken-back one’s included, and a manager’s own approval cards with him; the export is version 5', async () => {
    const { hlr, hot, degree } = await setup();
    const waiting = await own.registerOwn(asAnna, { typeId: hlr, issuedOn: '2026-01-10' });
    const approved = await own.registerOwn(asAnna, { typeId: hot, issuedOn: '2026-01-10' });
    await own.decideHolding(boss, approved, 'approve');
    // Taken back: the row goes, its closed cards stay in the managers' streams until she is erased.
    const takenBack = await own.registerOwn(asAnna, { typeId: degree, issuedOn: '2015-06-05' });
    await own.withdrawOwn(asAnna, takenBack);
    expect([...store.state.cards.values()].filter(c => c.holdingId === takenBack)).toHaveLength(2);
    const bos = await own.registerOwn(asBo, { typeId: hlr, issuedOn: '2026-01-10' });
    const threads = [waiting, approved].map(id => store.state.holdings.get(id)!.threadId!).sort();

    const doc = await own.exportDomain('operator:cli', ORG);
    expect(doc.format).toBe('clew.competence/8');
    expect(doc.holdings.find(h => h.id === approved)).toMatchObject({
      evidence: 'self',
      state: 'valid',
      decidedBy: 'boss',
      decidedAt: now.toISOString(),
      threadId: expect.any(String),
    });

    store.deactivate('anna');
    expect(await own.erasePerson('operator:cli', 'anna')).toEqual({
      holdings: 2,
      cleared: 0,
      requirements: 1,
      approvals: 2,
      cards: 0,
    });
    expect(calls().slice(-3)).toEqual([
      { op: 'remove', threadIds: threads },
      { op: 'removeAbout', subject: { entity: 'person', key: 'anna' } },
      { op: 'removeOwned', personId: 'anna' },
    ]);
    expect([...store.state.cards.values()].map(c => c.holdingId)).toEqual([bos]);
    expect(lastAudit()).toEqual({
      actor: 'operator:cli',
      action: 'competence.person_erased',
      subject: 'person:anna',
      at: now.toISOString(),
      details: { cause: 'operator', holdings: 2, cleared: 0, requirements: 1, approvals: 2, cards: 0 },
    });
    // Karin, erased as a manager: her card of Bo's registration goes, and her id leaves what she decided.
    await own.decideHolding(boss, bos, 'reject');
    store.deactivate('boss');
    expect(await own.erasePerson('operator:cli', 'boss')).toEqual({
      holdings: 0,
      cleared: 1,
      requirements: 0,
      approvals: 0,
      cards: 0,
    });
    expect(calls().at(-1)).toEqual({ op: 'removeOwned', personId: 'boss' });
    expect(store.state.cards.size).toBe(0);
    expect(store.state.holdings.get(bos)).toMatchObject({ state: 'rejected', decidedBy: null });
  });

  test('no audit row and no card call names a person or a competence', async () => {
    const { hlr, hot } = await setup();
    const a = await own.registerOwn(asAnna, { typeId: hlr, issuedOn: '2026-01-10' });
    const b = await own.registerOwn(asAnna, { typeId: hot, issuedOn: '2026-01-10' });
    await own.decideHolding(boss, a, 'approve');
    await own.decideHolding(other, b, 'reject');
    const c = await own.registerOwn(asBo, { typeId: hlr, issuedOn: '2026-01-10' });
    await own.withdrawOwn(asBo, c);
    const written = JSON.stringify({ audits: audits(), calls: calls() });
    for (const name of [...NAMES, ...TYPE_NAMES]) expect(written).not.toContain(name);
  });
});

/**
 * Skills (D120): a holding of a type of kind `skill`, held at a level from 1 to 3 and never ending. A person rates their
 * own at once, which opens no work item; the manager they report to confirms it, and only a confirmed skill at or above
 * the least level asked meets a requirement. The same rule decides the status, the matrix, coverage, the figure, what
 * needs attention and the cards.
 */
describe('skills with levels and interest (D120)', () => {
  const USK = 'usk';
  /** Anna and Bo hold the undersköterska position on Enhet 1, which Karin (boss) manages; Dan is Olle's on Enhet 3. */
  function directory() {
    store.addPosition({ id: 'pos-usk', organisationId: ORG, code: USK, label: 'Undersköterska' });
    store.addUnit({ id: 'u1', organisationId: ORG, label: 'Enhet 1', parentId: null });
    store.addUnit({ id: 'u3', organisationId: ORG, label: 'Enhet 3', parentId: null });
    for (const [personId, unitId] of [
      ['anna', 'u1'],
      ['bo', 'u1'],
      ['boss', 'u1'],
      ['dan', 'u3'],
    ])
      store.assign(personId!, unitId!);
    store.holdPosition('anna', 'pos-usk');
    store.holdPosition('bo', 'pos-usk');
  }
  /** The catalogue's three types and two skills: Engelska (Språk) and Journalsystem (Digital kompetens). */
  async function skills() {
    const types = await catalogue();
    const english = await competence.addType(admin, { name: 'Engelska', area: 'Språk', kind: 'skill' });
    const records = await competence.addType(admin, {
      name: 'Journalsystem',
      area: 'Digital kompetens',
      kind: 'skill',
    });
    return { ...types, english, records };
  }
  const holding = (id: string) => store.state.holdings.get(id)!;
  const actions = () => audits().map(a => a.action);

  describe('the catalogue', () => {
    test('a skill type is added with no validity; a validity on one is refused, as on a change', async () => {
      const { english } = await skills();
      expect(store.state.types.get(english)).toMatchObject({ kind: 'skill', validityMonths: null });
      expect(audits().find(a => a.subject === 'competence-type:' + english)).toEqual({
        actor: 'person:ada',
        action: 'competence.type_added',
        subject: 'competence-type:' + english,
        at: now.toISOString(),
        details: { organisationId: ORG, kind: 'skill', validityMonths: null },
      });
      const before = audits().length;
      await expect(
        competence.addType(admin, { name: 'Tyska', area: 'Språk', kind: 'skill', validityMonths: 12 }),
      ).rejects.toThrow(new CompetenceError('En färdighet har ingen giltighetstid.'));
      await expect(competence.updateType(admin, english, { validityMonths: 24 })).rejects.toThrow(
        new CompetenceError('En färdighet har ingen giltighetstid.'),
      );
      expect(audits().length).toBe(before);
      expect(store.state.types.get(english)?.validityMonths).toBeNull();
    });

    test('a type becomes a skill, or stops being one, only while nothing is held of it and nothing requires it', async () => {
      directory();
      const { hot, english, degree } = await skills();
      // Nothing held or required: the kind changes, audited as any change.
      await competence.updateType(admin, degree, { kind: 'skill' });
      expect(store.state.types.get(degree)?.kind).toBe('skill');
      expect(lastAudit()).toMatchObject({ action: 'competence.type_changed', details: { changed: ['kind'] } });
      await competence.updateType(admin, degree, { kind: 'degree' });
      // Held: refused both ways, nothing written.
      await competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2025-01-10' });
      await competence.rateOwnSkill(asAnna, { typeId: english, level: 2, interest: false });
      const before = audits().length;
      const locked = new CompetenceError(
        'Kompetensen har registrerade innehav eller krav och kan inte göras om till eller från en färdighet.',
      );
      await expect(competence.updateType(admin, hot, { kind: 'skill' })).rejects.toThrow(locked);
      await expect(competence.updateType(admin, english, { kind: 'course' })).rejects.toThrow(locked);
      // Required: refused too, since a requirement's least level belongs to a skill.
      await competence.addRequirement(admin, { typeId: degree, positionCode: USK });
      await expect(competence.updateType(admin, degree, { kind: 'skill' })).rejects.toThrow(locked);
      expect(audits().length).toBe(before + 1);
      // Another change of a skill type stands.
      await competence.updateType(admin, english, { name: 'Engelska i tal och skrift' });
      expect(store.state.types.get(english)).toMatchObject({ kind: 'skill', name: 'Engelska i tal och skrift' });
    });

    test('a type a source’s type is mapped to does not become a skill: copied rows have no level', async () => {
      const { hlr } = await skills();
      store.state.sources.set('lms', {
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
      await competence.seedMapping('operator:test', ORG, 'lms', { sourceType: 'course:1', typeId: hlr });
      const before = audits().length;
      // Its validity is taken away first, as the catalogue's dialog does for a skill, and still refused.
      await expect(competence.updateType(admin, hlr, { kind: 'skill', validityMonths: null })).rejects.toThrow(
        new CompetenceError('Kompetensen är kopplad till en källa och kan inte göras om till eller från en färdighet.'),
      );
      expect(audits().length).toBe(before);
      expect(store.state.types.get(hlr)).toMatchObject({ kind: 'course', validityMonths: 24 });
      // Unmapped, it may.
      await competence.seedMapping('operator:test', ORG, 'lms', { sourceType: 'course:1', typeId: null });
      await competence.updateType(admin, hlr, { kind: 'skill', validityMonths: null });
      expect(store.state.types.get(hlr)).toMatchObject({ kind: 'skill', validityMonths: null });
    });

    test('a source type is never mapped to a skill: a copied row has no level', async () => {
      const { english, hlr } = await skills();
      store.state.sources.set('lms', {
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
      const before = audits().length;
      await expect(
        competence.seedMapping('operator:test', ORG, 'lms', { sourceType: 'course:1', typeId: english }),
      ).rejects.toThrow(
        new CompetenceError('En färdighet kan inte kopplas till en källa: det som läses in har ingen nivå.'),
      );
      expect(store.state.mappings.size).toBe(0);
      expect(audits().length).toBe(before);
      await competence.seedMapping('operator:test', ORG, 'lms', { sourceType: 'course:1', typeId: hlr });
      expect(store.state.mappings.size).toBe(1);
    });
  });

  describe('a person rates their own skill', () => {
    test('stored at once as her own rating, with no work item, listed to her and her manager, audited with ids and level', async () => {
      const { english } = await skills();
      const id = await competence.rateOwnSkill(asAnna, { typeId: english, level: 2, interest: true });
      expect(holding(id)).toEqual({
        id,
        personId: 'anna',
        typeId: english,
        issuedOn: '2026-11-10',
        expiresOn: null,
        evidence: 'self',
        state: 'valid',
        registeredBy: 'anna',
        createdAt: now.toISOString(),
        revokedAt: null,
        revokedBy: null,
        copy: null,
        decidedBy: null,
        decidedAt: null,
        threadId: null,
        level: 2,
        interest: true,
        validatedBy: null,
        validatedAt: null,
        ratedAt: now.toISOString(),
      });
      expect(lastAudit()).toEqual({
        actor: 'person:anna',
        action: 'competence.skill_rated',
        subject: 'holding:' + id,
        at: now.toISOString(),
        details: { personId: 'anna', typeId: english, level: 2, levelBefore: null },
      });
      // No approval: nothing waits, and no card is opened for anyone.
      expect(store.calls()).toEqual([]);
      expect((await competence.ownRegistrations(asAnna)).pending).toEqual([]);
      const row: CompetenceHoldingRow = {
        ref: 'holding:competence:' + id,
        userName: 'anna.a',
        name: 'Anna Andersson',
        competence: 'Engelska',
        typeId: english,
        area: 'Språk',
        kind: 'skill',
        status: 'valid',
        evidence: 'self',
        level: 'Självständig',
        assessment: 'Egen bedömning',
        interest: 'Vill utveckla',
      };
      const mine = await competence.holdings(asAnna);
      expect(checkContract(CompetenceHoldingsOutputSchema, mine)).toBe(true);
      expect(mine.rows).toEqual([row]);
      expect((await competence.holdings(boss, { person: 'anna.a' })).rows).toEqual([row]);
      expect((await competence.ownRegistrations(asAnna)).skills).toEqual([
        {
          holdingId: id,
          typeId: english,
          competence: 'Engelska',
          area: 'Språk',
          level: 2,
          validated: false,
          interest: true,
        },
      ]);
      // Never expiring: a year on it is the same.
      now = new Date('2027-11-10T09:00:00.000Z');
      expect((await competence.holdings(asAnna)).rows[0]).toMatchObject({ status: 'valid', level: 'Självständig' });
    });

    test('refused, with nothing written: a type that is no skill, a level outside the three, an archived or unknown type', async () => {
      const { hot, english } = await skills();
      const archived = await competence.addType(admin, { name: 'Franska', area: 'Språk', kind: 'skill' });
      await competence.archiveType(admin, archived);
      const before = { audits: audits().length, holdings: store.state.holdings.size };
      await expect(competence.rateOwnSkill(asAnna, { typeId: hot, level: 1, interest: false })).rejects.toThrow(
        new CompetenceError('Bara en färdighet bedöms med en nivå.'),
      );
      for (const level of [0, 4, 2.5])
        await expect(
          competence.rateOwnSkill(asAnna, { typeId: english, level: level as 1, interest: false }),
        ).rejects.toThrow(new CompetenceError('Välj en nivå: Grundläggande, Självständig eller Expert.'));
      await expect(competence.rateOwnSkill(asAnna, { typeId: archived, level: 1, interest: false })).rejects.toThrow(
        new CompetenceError('Kompetensen är arkiverad och kan inte registreras.'),
      );
      await expect(competence.rateOwnSkill(asAnna, { typeId: 'nope', level: 1, interest: false })).rejects.toThrow(
        new CompetenceError('Kompetensen finns inte i katalogen.'),
      );
      // A skill is rated, not registered with dates for approval or by a manager with dates.
      const dated = new CompetenceError('En färdighet registreras med en nivå, inte med datum.');
      await expect(
        competence.registerHolding(boss, 'anna', { typeId: english, issuedOn: '2026-01-10' }),
      ).rejects.toThrow(dated);
      expect({ audits: audits().length, holdings: store.state.holdings.size }).toEqual(before);
    });

    test('a manager rates only as himself: his rating is his own holding, and the body names no person', async () => {
      const { english } = await skills();
      const id = await competence.rateOwnSkill(boss, { typeId: english, level: 3, interest: false });
      expect(holding(id)).toMatchObject({ personId: 'boss', evidence: 'self', registeredBy: 'boss' });
      expect((await competence.holdings(asAnna)).rows).toEqual([]);
      expect(
        checkContract(CompetenceSkillRatingBodySchema, {
          typeId: english,
          level: 1,
          interest: false,
          personId: 'anna',
        }),
      ).toBe(false);
      expect(checkContract(CompetenceSkillRatingBodySchema, { typeId: english, level: 1, interest: false })).toBe(true);
    });

    test('a skill she holds is not added twice: refused in Swedish, nothing written', async () => {
      const { english } = await skills();
      const id = await competence.rateOwnSkill(asAnna, { typeId: english, level: 1, interest: false });
      const before = audits().length;
      await expect(competence.rateOwnSkill(asAnna, { typeId: english, level: 3, interest: true })).rejects.toThrow(
        new CompetenceError('Du har redan den färdigheten. Ändra nivån under Färdigheter i stället.'),
      );
      expect(audits().length).toBe(before);
      expect(holding(id)).toMatchObject({ level: 1, interest: false });
      expect([...store.state.holdings.values()].filter(h => h.personId === 'anna')).toHaveLength(1);
    });

    test('a change of her skill: a new level clears the confirmation from now, the interest mark alone does not', async () => {
      const { english, hot } = await skills();
      const id = await competence.rateOwnSkill(asAnna, { typeId: english, level: 1, interest: false });
      const rated = now.toISOString();
      await competence.validateSkill(boss, id);
      expect(holding(id)).toMatchObject({ level: 1, validatedBy: 'boss', validatedAt: now.toISOString() });
      now = new Date('2026-11-12T09:00:00.000Z');
      // The interest mark alone: still confirmed, still level 1, rated when it was.
      await competence.changeOwnSkill(asAnna, id, { level: 1, interest: true });
      expect(holding(id)).toMatchObject({
        level: 1,
        interest: true,
        validatedBy: 'boss',
        issuedOn: '2026-11-10',
        ratedAt: rated,
      });
      expect(lastAudit()).toEqual({
        actor: 'person:anna',
        action: 'competence.skill_rated',
        subject: 'holding:' + id,
        at: now.toISOString(),
        details: { personId: 'anna', typeId: english, level: 1, levelBefore: 1 },
      });
      // The same again writes nothing.
      const before = audits().length;
      await competence.changeOwnSkill(asAnna, id, { level: 1, interest: true });
      expect(audits().length).toBe(before);
      // A new level: her own rating again, from now.
      await competence.changeOwnSkill(asAnna, id, { level: 3, interest: true });
      expect(holding(id)).toMatchObject({
        level: 3,
        interest: true,
        evidence: 'self',
        registeredBy: 'anna',
        issuedOn: '2026-11-12',
        ratedAt: now.toISOString(),
        validatedBy: null,
        validatedAt: null,
      });
      expect(lastAudit()).toEqual({
        actor: 'person:anna',
        action: 'competence.skill_rated',
        subject: 'holding:' + id,
        at: now.toISOString(),
        details: { personId: 'anna', typeId: english, level: 3, levelBefore: 1 },
      });
      expect([...store.state.holdings.values()].filter(h => h.personId === 'anna')).toHaveLength(1);
      // Only her own skill that counts: not another's, not a certificate, not a level outside the three.
      const cert = await competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2025-01-10' });
      const refused = new ForbiddenError('Du har ingen sådan färdighet.');
      const after = audits().length;
      for (const [who, target] of [
        [boss, id],
        [asBo, id],
        [asAnna, cert],
        [asAnna, 'nope'],
      ] as const)
        await expect(competence.changeOwnSkill(who, target, { level: 2, interest: false })).rejects.toThrow(refused);
      await expect(competence.changeOwnSkill(asAnna, id, { level: 4 as 1, interest: false })).rejects.toThrow(
        new CompetenceError('Välj en nivå: Grundläggande, Självständig eller Expert.'),
      );
      expect(audits().length).toBe(after);
    });

    test('she removes her own, whoever confirmed it, as a revocation; nobody else can, and a certificate or an unknown id is refused alike', async () => {
      const { english, hot } = await skills();
      const id = await competence.rateOwnSkill(asAnna, { typeId: english, level: 2, interest: false });
      await competence.validateSkill(boss, id);
      const cert = await competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2025-01-10' });
      const refused = new ForbiddenError('Du har ingen sådan färdighet.');
      const before = audits().length;
      for (const [who, target] of [
        [boss, id],
        [asBo, id],
        [asAnna, cert],
        [asAnna, 'nope'],
      ] as const)
        await expect(competence.removeOwnSkill(who, target)).rejects.toThrow(refused);
      expect(audits().length).toBe(before);
      await competence.removeOwnSkill(asAnna, id);
      // The row stays, revoked by her, and counts towards nothing; it leaves her lists.
      expect(holding(id)).toMatchObject({
        state: 'revoked',
        revokedAt: now.toISOString(),
        revokedBy: 'anna',
        level: 2,
      });
      expect(lastAudit()).toEqual({
        actor: 'person:anna',
        action: 'competence.skill_removed',
        subject: 'holding:' + id,
        at: now.toISOString(),
        details: { personId: 'anna', typeId: english, level: 2 },
      });
      expect((await competence.ownRegistrations(asAnna)).skills).toEqual([]);
      expect((await competence.holdings(asAnna)).rows.map(r => r.competence)).toEqual(['Heta arbeten']);
      // Removed twice is refused as unknown.
      await expect(competence.removeOwnSkill(asAnna, id)).rejects.toThrow(refused);
      // Removed, it can be added again from nothing.
      const again = await competence.rateOwnSkill(asAnna, { typeId: english, level: 1, interest: false });
      expect(again).not.toBe(id);
    });
  });

  describe('the manager confirms', () => {
    test('a manager she reports to confirms the level, or another, with who and when; audited with the level before and after', async () => {
      const { english } = await skills();
      const id = await competence.rateOwnSkill(asAnna, { typeId: english, level: 3, interest: true });
      expect(await competence.skillValidation(boss, id)).toEqual({
        holdingId: id,
        personId: 'anna',
        name: 'Anna Andersson',
        typeId: english,
        competence: 'Engelska',
        area: 'Språk',
        level: 3,
        validated: false,
        interest: true,
      });
      await competence.validateSkill(boss, id, { level: 2 });
      expect(holding(id)).toMatchObject({
        level: 2,
        evidence: 'self',
        interest: true,
        validatedBy: 'boss',
        validatedAt: now.toISOString(),
      });
      expect(lastAudit()).toEqual({
        actor: 'person:boss',
        action: 'competence.skill_validated',
        subject: 'holding:' + id,
        at: now.toISOString(),
        details: { personId: 'anna', typeId: english, levelBefore: 3, levelAfter: 2 },
      });
      expect((await competence.holdings(asAnna)).rows[0]).toMatchObject({ level: 'Självständig' });
      expect((await competence.holdings(asAnna)).rows[0]).not.toHaveProperty('assessment');
      // Confirming again, as rated now, stores who and when anew.
      now = new Date('2026-11-11T09:00:00.000Z');
      await competence.validateSkill(boss, id);
      expect(holding(id)).toMatchObject({ level: 2, validatedAt: now.toISOString() });
      expect(lastAudit().details).toEqual({ personId: 'anna', typeId: english, levelBefore: 2, levelAfter: 2 });
    });

    test('nobody confirms their own, a manager included; nor another’s report, a former manager, an employee or a certificate', async () => {
      const { english, hot } = await skills();
      const own = await competence.rateOwnSkill(boss, { typeId: english, level: 2, interest: false });
      const annas = await competence.rateOwnSkill(asAnna, { typeId: english, level: 2, interest: false });
      const dans = await competence.rateOwnSkill(personaOf('dan', 'employee', 'Dan Dahl'), {
        typeId: english,
        level: 2,
        interest: false,
      });
      const cert = await competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2025-01-10' });
      const refused = new ForbiddenError('Färdigheten finns inte bland dem du kan bekräfta.');
      const before = audits().length;
      for (const [who, target] of [
        [boss, own], // her own, though she manages units
        [other, annas], // not his report
        [boss, dans],
        [asBo, annas], // an employee
        [asAnna, annas], // the person herself
        [boss, cert], // no skill
        [boss, 'nope'],
      ] as const) {
        await expect(competence.validateSkill(who, target)).rejects.toThrow(refused);
        await expect(competence.skillValidation(who, target)).rejects.toThrow(refused);
      }
      await expect(competence.validateSkill(boss, annas, { level: 4 as 1 })).rejects.toThrow(
        new CompetenceError('Välj en nivå: Grundläggande, Självständig eller Expert.'),
      );
      // The line changes: Karin no longer manages Anna, and confirms nothing of hers.
      staff.set('boss', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [bo] }] });
      await expect(competence.validateSkill(boss, annas)).rejects.toThrow(refused);
      expect(audits().length).toBe(before);
      expect(holding(annas).validatedAt).toBeNull();
    });

    test('a manager registers a skill for a report, confirmed at once; one she holds already is confirmed instead', async () => {
      const { english, records, hot } = await skills();
      const id = await competence.registerSkill(boss, 'anna', { typeId: english, level: 3 });
      expect(holding(id)).toMatchObject({
        personId: 'anna',
        typeId: english,
        evidence: 'manager',
        state: 'valid',
        registeredBy: 'boss',
        level: 3,
        interest: false,
        validatedBy: 'boss',
        validatedAt: now.toISOString(),
        expiresOn: null,
      });
      expect(lastAudit()).toEqual({
        actor: 'person:boss',
        action: 'competence.skill_registered',
        subject: 'holding:' + id,
        at: now.toISOString(),
        details: { personId: 'anna', typeId: english, level: 3 },
      });
      expect((await competence.holdings(asAnna)).rows[0]).toMatchObject({ level: 'Expert', evidence: 'manager' });
      const before = audits().length;
      await expect(competence.registerSkill(boss, 'anna', { typeId: english, level: 1 })).rejects.toThrow(
        new CompetenceError('Personen har redan den färdigheten. Bekräfta nivån i stället.'),
      );
      await expect(competence.registerSkill(boss, 'anna', { typeId: hot, level: 1 })).rejects.toThrow(
        new CompetenceError('Bara en färdighet bedöms med en nivå.'),
      );
      await expect(competence.registerSkill(boss, 'dan', { typeId: records, level: 1 })).rejects.toThrow(
        new ForbiddenError('Personen finns inte bland dem du är chef för.'),
      );
      await expect(competence.registerSkill(boss, 'boss', { typeId: records, level: 1 })).rejects.toThrow(
        new ForbiddenError('Personen finns inte bland dem du är chef för.'),
      );
      await expect(competence.registerSkill(asAnna, 'bo', { typeId: records, level: 1 })).rejects.toThrow(
        ForbiddenError,
      );
      await expect(competence.registerSkill(boss, 'anna', { typeId: records, level: 0 as 1 })).rejects.toThrow(
        new CompetenceError('Välj en nivå: Grundläggande, Självständig eller Expert.'),
      );
      expect(audits().length).toBe(before);
      // The manager may revoke one a manager registered: it no longer counts, and she may add it again.
      const revoked = await competence.registerSkill(boss, 'anna', { typeId: records, level: 2 });
      await competence.revokeHolding(boss, revoked);
      expect(holding(revoked)).toMatchObject({ state: 'revoked', revokedBy: 'boss' });
      expect(lastAudit()).toEqual({
        actor: 'person:boss',
        action: 'competence.holding_revoked',
        subject: 'holding:' + revoked,
        at: now.toISOString(),
        details: { personId: 'anna', typeId: records },
      });
      const again = await competence.rateOwnSkill(asAnna, { typeId: records, level: 1, interest: false });
      expect(again).not.toBe(revoked);
      // She changes the level of the one he registered: her own rating now, no longer the manager's.
      await competence.changeOwnSkill(asAnna, id, { level: 2, interest: false });
      expect(holding(id)).toMatchObject({ evidence: 'self', registeredBy: 'anna', level: 2, validatedAt: null });
    });

    test('a manager never revokes a skill the person rated, confirmed or not: hers to remove; the cell offers no revocation', async () => {
      directory();
      const { records } = await skills();
      await competence.addRequirement(admin, { typeId: records, positionCode: USK, minLevel: 1 });
      const id = await competence.rateOwnSkill(asAnna, { typeId: records, level: 2, interest: false });
      const refused = new ForbiddenError(
        'Färdigheten är medarbetarens egen bedömning, som bara medarbetaren kan ta bort.',
      );
      const before = audits().length;
      await expect(competence.revokeHolding(boss, id)).rejects.toThrow(refused);
      const cell = async () => (await competence.matrix(boss)).rows.find(r => r.personId === 'anna')!.cells[0]!;
      expect(await cell()).toMatchObject({ holdingId: id, evidence: 'self', revocable: false });
      await competence.validateSkill(boss, id);
      await expect(competence.revokeHolding(boss, id)).rejects.toThrow(refused);
      expect(await cell()).toMatchObject({ status: 'valid', holdingId: id, revocable: false });
      expect(audits().length).toBe(before + 1);
      expect(holding(id).state).toBe('valid');
      // One the manager registered is his to revoke.
      const bos = await competence.registerSkill(boss, 'bo', { typeId: records, level: 1 });
      expect((await competence.matrix(boss)).rows.find(r => r.personId === 'bo')!.cells[0]).toMatchObject({
        holdingId: bos,
        revocable: true,
      });
    });
  });

  describe('a requirement asks for a level', () => {
    test('a requirement of a skill names a least level, 1 by default; a level on another kind is refused', async () => {
      directory();
      const { english, records, hlr } = await skills();
      const atTwo = await competence.addRequirement(admin, { typeId: records, positionCode: USK, minLevel: 2 });
      expect(store.state.requirements.get(atTwo)?.minLevel).toBe(2);
      expect(lastAudit()).toEqual({
        actor: 'person:ada',
        action: 'competence.requirement_added',
        subject: 'competence-requirement:' + atTwo,
        at: now.toISOString(),
        details: {
          organisationId: ORG,
          typeId: records,
          positionCode: USK,
          unitId: null,
          personId: null,
          minLevel: 2,
        },
      });
      const atOne = await competence.addRequirement(admin, { typeId: english, unitId: 'u1' });
      expect(store.state.requirements.get(atOne)?.minLevel).toBe(1);
      const onAnna = await competence.addRequirement(boss, { typeId: english, personId: 'anna', minLevel: 3 });
      expect(store.state.requirements.get(onAnna)?.minLevel).toBe(3);
      const before = audits().length;
      await expect(competence.addRequirement(admin, { typeId: hlr, positionCode: USK, minLevel: 1 })).rejects.toThrow(
        new CompetenceError('Bara en färdighet kan krävas på en viss nivå.'),
      );
      await expect(
        competence.addRequirement(admin, { typeId: english, positionCode: USK, minLevel: 5 as 1 }),
      ).rejects.toThrow(new CompetenceError('Välj en nivå: Grundläggande, Självständig eller Expert.'));
      expect(audits().length).toBe(before);
      const listed = await competence.requirements(admin);
      expect(listed.rows.map(r => [r.typeId, r.on, r.minLevel ?? null])).toEqual([
        [records, 'position', 2],
        [english, 'unit', 1],
      ]);
      await competence.addRequirement(admin, { typeId: hlr, positionCode: USK });
      expect((await competence.requirements(admin)).rows.find(r => r.typeId === hlr)).not.toHaveProperty('minLevel');
    });

    test('only a confirmed skill at or above the level meets it: status, the list, the matrix and its file', async () => {
      directory();
      const { records } = await skills();
      await competence.addRequirement(admin, { typeId: records, positionCode: USK, minLevel: 2 });
      const status = async () => (await competence.holdings(asAnna)).rows.find(r => r.competence === 'Journalsystem');
      const cell = async () => {
        const m = await competence.matrix(boss);
        expect(checkContract(CompetenceMatrixOutputSchema, m)).toBe(true);
        return m.rows.find(r => r.personId === 'anna')!.cells[0]!;
      };
      // Nothing held: missing, with the level asked.
      expect(await status()).toEqual({
        ref: 'holding:competence:missing:anna:' + records,
        userName: 'anna.a',
        name: 'Anna Andersson',
        competence: 'Journalsystem',
        typeId: records,
        area: 'Digital kompetens',
        kind: 'skill',
        status: 'missing',
        required: 'Självständig',
      });
      expect(await cell()).toEqual({
        typeId: records,
        status: 'missing',
        required: true,
        through: [{ on: 'position', label: 'Undersköterska' }],
        revocable: false,
        least: 2,
      });
      expect((await competence.matrix(boss)).columns).toEqual([
        { typeId: records, name: 'Journalsystem', area: 'Digital kompetens', kind: 'skill', levels: [2] },
      ]);
      // Her own rating at Expert: still missing until it is confirmed; the level she gave is beside it.
      const id = await competence.rateOwnSkill(asAnna, { typeId: records, level: 3, interest: false });
      expect(await status()).toMatchObject({
        ref: 'holding:competence:' + id,
        status: 'missing',
        level: 'Expert',
        assessment: 'Egen bedömning',
        required: 'Självständig',
        evidence: 'self',
      });
      expect(await cell()).toMatchObject({
        status: 'missing',
        holdingId: id,
        evidence: 'self',
        // Her own rating is hers to remove, not the manager's to revoke.
        revocable: false,
        level: 3,
        validated: false,
        least: 2,
      });
      expect(matrixCellText(await cell())).toBe('Saknas (kräver Självständig, egen bedömning: Expert)');
      // Confirmed below the level: still missing, now with the confirmed level.
      await competence.validateSkill(boss, id, { level: 1 });
      expect(await status()).toMatchObject({ status: 'missing', level: 'Grundläggande', required: 'Självständig' });
      expect(await status()).not.toHaveProperty('assessment');
      expect(matrixCellText(await cell())).toBe('Saknas (kräver Självständig, har Grundläggande)');
      // At the level: met, and never running out.
      await competence.validateSkill(boss, id, { level: 2 });
      expect(await status()).toMatchObject({ status: 'valid', level: 'Självständig' });
      expect(await status()).not.toHaveProperty('required');
      expect(await cell()).toMatchObject({ status: 'valid', holdingId: id, level: 2, validated: true, least: 2 });
      expect(matrixCellText(await cell())).toBe('Självständig');
      // Above it: met too. Her own new rating is unconfirmed again and so missing.
      await competence.validateSkill(boss, id, { level: 3 });
      expect((await status())?.status).toBe('valid');
      await competence.changeOwnSkill(asAnna, id, { level: 2, interest: true });
      expect(await status()).toMatchObject({
        status: 'missing',
        assessment: 'Egen bedömning',
        interest: 'Vill utveckla',
      });
      expect(await cell()).toMatchObject({ status: 'missing', interest: true, validated: false });
      // A skill held where nothing requires it says its level, and that it is not required.
      expect(matrixCellText({ status: 'valid', required: false, level: 1, validated: false })).toBe(
        'Egen bedömning: Grundläggande (krävs inte)',
      );
      const file = await competence.exportMatrix(boss);
      expect(file.text).toContain('Saknas (kräver Självständig, egen bedömning: Självständig)');
    });

    test('the highest least level of the requirements that apply decides; the column lists the levels asked', async () => {
      directory();
      const { records } = await skills();
      await competence.addRequirement(admin, { typeId: records, positionCode: USK, minLevel: 1 });
      await competence.addRequirement(boss, { typeId: records, personId: 'anna', minLevel: 3 });
      await competence.registerSkill(boss, 'anna', { typeId: records, level: 2 });
      await competence.registerSkill(boss, 'bo', { typeId: records, level: 2 });
      const m = await competence.matrix(boss);
      expect(m.columns[0]).toMatchObject({ levels: [1, 3] });
      const byPerson = new Map(m.rows.map(r => [r.personId, r.cells[0]!]));
      expect(byPerson.get('anna')).toMatchObject({ status: 'missing', least: 3, level: 2 });
      expect(byPerson.get('bo')).toMatchObject({ status: 'valid', least: 1, level: 2 });
    });

    test('coverage, attention, the figure, the read about people and the cards follow the same rule', async () => {
      directory();
      const { records, english } = await skills();
      await competence.addRequirement(admin, { typeId: records, positionCode: USK, minLevel: 2 });
      await competence.addShareTarget(admin, { typeId: english, positionCode: USK, minShare: 50, unitId: 'u1' });
      const annas = await competence.rateOwnSkill(asAnna, { typeId: records, level: 3, interest: false });
      await competence.rateOwnSkill(asAnna, { typeId: english, level: 3, interest: false });
      await competence.registerSkill(boss, 'bo', { typeId: records, level: 1 });
      await competence.registerSkill(boss, 'bo', { typeId: english, level: 1 });
      const coverage = async () => {
        const c = await competence.coverage(boss, 'u1');
        return {
          meeting: c.requirements.map(r => [r.type.name, r.under, r.meeting]),
          targets: c.targets.map(t => [t.type.name, t.holders, t.meeting]),
        };
      };
      // Anna's own rating meets nothing; Bo's confirmed level 1 is below what is asked, but meets the share target.
      expect(await coverage()).toEqual({ meeting: [['Journalsystem', 2, 0]], targets: [['Engelska', 2, 1]] });
      const attention = await competence.attention(boss);
      expect(checkContract(CompetenceAttentionOutputSchema, attention)).toBe(true);
      expect(
        attention.rows.map(r => [r.name, r.competence, r.status, r.level ?? null, r.assessment ?? null, r.required]),
      ).toEqual([
        ['Anna Andersson', 'Journalsystem', 'missing', 'Expert', 'Egen bedömning', 'Självständig'],
        ['Bo Berg', 'Journalsystem', 'missing', 'Grundläggande', null, 'Självständig'],
      ]);
      // The table says the level held, its mark and the level asked, and counts its rows as kompetenser.
      expect(attentionView.kind === 'table' && attentionView.fields.map(f => f.key)).toEqual([
        'name',
        'competence',
        'status',
        'level',
        'assessment',
        'required',
        'expiresOn',
        'source',
        'readAt',
      ]);
      expect(attentionView.kind === 'table' && attentionView.noun).toEqual({
        one: 'krav som inte uppfylls',
        other: 'krav som inte uppfylls',
      });
      expect(await competence.summary(boss)).toMatchObject({ missing: 2, expired: 0, expiring: 0, people: 2 });
      const registry = new Registry().register(competenceConnector(competence, async a => personaOf(a.id, a.role)));
      const actor = (p: AuthenticatedContext): Actor => ({
        id: p.id,
        name: p.name,
        unitId: p.unitId,
        unitLabel: p.unitLabel,
        role: p.role,
      });
      // The read about people counts a skill held as registered, and the one that does not reach the level as missing.
      expect(
        (await registry.run<{ rows: unknown[] }>(actor(boss), 'competence.person', { keys: ['anna.a'] })).rows,
      ).toEqual([{ key: 'anna.a', status: 'Saknas' }]);
      expect((await registry.areas(actor(boss))).find(a => a.id === 'competence')?.figure).toMatchObject({
        label: 'Krav som inte uppfylls',
        value: '2',
      });
      // Her card says what would meet it: her rating waits for her manager.
      const [card] = await registry.scan(actor(asAnna));
      expect(card).toMatchObject({
        topic: 'competence:missing:' + records,
        title: 'Journalsystem saknas',
        summary: 'Det här krävs i ditt arbete. Din egen bedömning räknas när din chef har bekräftat nivån.',
      });
      const [bos] = await registry.scan(actor(asBo));
      expect(bos?.summary).toBe(
        'Det här krävs i ditt arbete på en högre nivå än den din chef har bekräftat. Prata med din chef om hur du kommer dit.',
      );
      // A card names no level, as a certificate's card names no particulars (D108 item 12).
      for (const level of ['Grundläggande', 'Självständig', 'Expert'])
        expect(JSON.stringify([card, bos])).not.toContain(level);
      // Confirmed at the level: met everywhere, and her card goes.
      await competence.validateSkill(boss, annas);
      expect(await coverage()).toEqual({ meeting: [['Journalsystem', 2, 1]], targets: [['Engelska', 2, 1]] });
      expect((await competence.attention(boss)).rows.map(r => r.name)).toEqual(['Bo Berg']);
      expect(await registry.scan(actor(asAnna))).toEqual([]);
      expect((await competence.summary(boss))?.missing).toBe(1);
      // A skill not held at all says it can be added.
      await competence.removeOwnSkill(asAnna, annas);
      const [fresh] = await registry.scan(actor(asAnna));
      expect(fresh?.summary).toBe(
        'Det här krävs i ditt arbete. Lägg till färdigheten med din nivå, så kan din chef bekräfta den.',
      );
    });

    test('the domain: an unconfirmed or too low skill is missing with the skill held beside it', () => {
      const type = (id: string, kind: TypeRecord['kind']): TypeRecord => ({
        id,
        organisationId: ORG,
        name: id,
        area: 'A',
        kind,
        validityMonths: null,
        archivedAt: null,
        createdBy: 'x',
        createdAt: now.toISOString(),
        sourceUri: null,
        mergedInto: null,
      });
      const types = new Map([type('lang', 'skill'), type('cert', 'certificate')].map(t => [t.id, t]));
      const h = (id: string, typeId: string, extra: Partial<HoldingRecord> = {}): HoldingRecord => ({
        id,
        personId: 'anna',
        typeId,
        issuedOn: '2001-01-01',
        expiresOn: null,
        evidence: 'self',
        state: 'valid',
        registeredBy: 'anna',
        createdAt: now.toISOString(),
        revokedAt: null,
        revokedBy: null,
        copy: null,
        decidedBy: null,
        decidedAt: null,
        threadId: null,
        level: 2,
        interest: false,
        validatedBy: null,
        validatedAt: null,
        ratedAt: now.toISOString(),
        ...extra,
      });
      const required = new Map([['anna', ['lang']]]);
      const at = (least: number, extra: Partial<HoldingRecord>) =>
        deciding(
          [h('s', 'lang', extra)],
          types,
          '2026-11-10',
          required,
          new Map([['anna', new Map([['lang', least]])]]),
        )
          .map(s => [s.status, s.holding?.id ?? null, 'held' in s ? (s.held?.id ?? null) : null])
          .at(0);
      expect(at(2, {})).toEqual(['missing', null, 's']);
      expect(at(3, { validatedAt: now.toISOString() })).toEqual(['missing', null, 's']);
      expect(at(2, { validatedAt: now.toISOString() })).toEqual(['valid', 's', null]);
      expect(at(1, { validatedAt: now.toISOString(), level: 3 })).toEqual(['valid', 's', null]);
      // Without a least level it asks for 1; not required, a skill is valid however old and unconfirmed.
      expect(
        deciding([h('s', 'lang', { validatedAt: now.toISOString() })], types, '2026-11-10', required)[0]?.status,
      ).toBe('valid');
      expect(deciding([h('s', 'lang')], types, '2026-11-10')[0]?.status).toBe('valid');
    });
  });

  describe('erasure and export', () => {
    test('erasing a manager clears who confirmed, keeping when, so the skill stays confirmed; erasing her takes her skills', async () => {
      directory();
      const { records } = await skills();
      await competence.addRequirement(admin, { typeId: records, positionCode: USK, minLevel: 2 });
      const id = await competence.rateOwnSkill(asAnna, { typeId: records, level: 2, interest: true });
      await competence.validateSkill(boss, id);
      const confirmedAt = now.toISOString();
      store.deactivate('boss');
      const erased = await competence.erasePerson('operator:test', 'boss');
      expect(erased).toMatchObject({ holdings: 0, cleared: 1 });
      expect(holding(id)).toMatchObject({ validatedBy: null, validatedAt: confirmedAt, level: 2 });
      // Still confirmed: it still meets the requirement.
      expect((await competence.holdings(asAnna)).rows[0]).toMatchObject({ status: 'valid', level: 'Självständig' });
      store.deactivate('anna');
      expect(await competence.erasePerson('operator:test', 'anna')).toMatchObject({ holdings: 1 });
      expect(store.state.holdings.has(id)).toBe(false);
    });

    test('the export is version 7: a holding carries its level, interest, confirmation and rating, a requirement its least level', async () => {
      directory();
      const { records } = await skills();
      await competence.addRequirement(admin, { typeId: records, positionCode: USK, minLevel: 2 });
      const id = await competence.rateOwnSkill(asAnna, { typeId: records, level: 3, interest: true });
      await competence.validateSkill(boss, id, { level: 2 });
      const doc = await competence.exportDomain('operator:test', ORG);
      expect(doc.format).toBe('clew.competence/8');
      expect(doc.types.find(t => t.id === records)).toMatchObject({ kind: 'skill', validityMonths: null });
      expect(doc.holdings.find(h => h.id === id)).toMatchObject({
        level: 2,
        interest: true,
        validatedBy: 'boss',
        validatedAt: now.toISOString(),
        ratedAt: now.toISOString(),
        evidence: 'self',
      });
      expect(doc.requirements.find(r => r.typeId === records)).toMatchObject({ minLevel: 2 });
    });

    test('no audit row names a person or a competence', async () => {
      directory();
      const { english, records } = await skills();
      await competence.addRequirement(admin, { typeId: records, positionCode: USK, minLevel: 2 });
      const id = await competence.rateOwnSkill(asAnna, { typeId: english, level: 3, interest: true });
      await competence.validateSkill(boss, id, { level: 2 });
      await competence.registerSkill(boss, 'bo', { typeId: records, level: 1 });
      await competence.changeOwnSkill(asAnna, id, { level: 1, interest: false });
      await competence.removeOwnSkill(asAnna, id);
      expect(actions().filter(a => a.startsWith('competence.skill_'))).toEqual([
        'competence.skill_rated',
        'competence.skill_validated',
        'competence.skill_registered',
        'competence.skill_rated',
        'competence.skill_removed',
      ]);
      const written = JSON.stringify(audits());
      for (const name of [...NAMES, ...TYPE_NAMES, 'Engelska', 'Journalsystem']) expect(written).not.toContain(name);
    });
  });
});

/**
 * The development stack's data (`scripts/competence-development.ts`), seeded through the operator's use cases as the
 * seed seeds it: every requirement names a type of the catalogue and a position of the synthetic directory, a least
 * level only on a skill, and none twice, so the seed adds each once and a run after one made by hand skips it.
 */
describe('the development data (D108 item 6)', () => {
  test('a school’s teachers and its managers are required something, as care’s are: each requirement seeds once', async () => {
    const positions = [
      'underskoterska',
      'sjukskoterska',
      'vardbitrade',
      'stodassistent',
      'enhetschef',
      'handlaggare',
      'maskinforare',
      'larare',
    ];
    for (const code of positions) store.addPosition({ id: 'pos-' + code, organisationId: ORG, code, label: code });
    const typeIds = new Map<string, string>();
    for (const type of DEVELOPMENT_CATALOGUE)
      typeIds.set(type.name, await competence.seedType('operator:test', ORG, type));
    const keys = DEVELOPMENT_REQUIREMENTS.map(r => r.position + '\n' + r.type);
    expect(new Set(keys).size).toBe(keys.length);
    for (const r of DEVELOPMENT_REQUIREMENTS) {
      expect(positions).toContain(r.position);
      const typeId = typeIds.get(r.type);
      expect(typeId).toBeDefined();
      await competence.seedRequirement('operator:test', ORG, {
        typeId: typeId!,
        positionCode: r.position,
        ...(r.minLevel ? { minLevel: r.minLevel } : {}),
      });
    }
    expect(DEVELOPMENT_REQUIREMENTS.filter(r => r.position === 'larare')).toEqual([
      { position: 'larare', type: 'Brandskydd' },
      { position: 'larare', type: 'HLR' },
      { position: 'larare', type: 'Lättläst svenska', minLevel: 2 },
    ]);
    expect(DEVELOPMENT_REQUIREMENTS.filter(r => r.position === 'enhetschef').length).toBeGreaterThan(1);
    expect(store.state.requirements.size).toBe(DEVELOPMENT_REQUIREMENTS.length);
  });
});
