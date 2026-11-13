import { beforeEach, describe, expect, test } from 'bun:test';
import {
  checkContract,
  CompetenceAttentionOutputSchema,
  CompetenceHoldingsOutputSchema,
  type AuthenticatedContext,
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
  holdingsView,
  personView,
} from '../../apps/server/src/modules/competence/capabilities';
import { addMonths, deciding, endOf, statusOn } from '../../apps/server/src/modules/competence/domain';
import type { HoldingRecord, TypeRecord } from '../../apps/server/src/modules/competence/model';
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
      ...extra,
    });
    const types = new Map([[t.id, t]]);
    const pick = (holdings: HoldingRecord[]) =>
      deciding(holdings, types, '2026-11-10').map(s => [s.holding.id, s.status]);
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
    expect(await competence.summary(boss)).toEqual({ expired: 1, expiring: 1, people: 1, reports: 2 });
    await competence.registerHolding(boss, 'anna', {
      typeId: types.hot,
      issuedOn: '2026-11-01',
      expiresOn: '2031-10-31',
    });
    expect((await competence.attention(boss)).rows.map(r => r.competence)).toEqual(['HLR']);
    expect(await competence.summary(boss)).toEqual({ expired: 0, expiring: 1, people: 1, reports: 2 });
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
      { key: 'Anna.A', expired: 1, expiring: 1, holdings: 3 },
      // Nothing registered yet: the row is where a first certificate is registered from.
      { key: 'eve.e', expired: 0, expiring: 0, holdings: 0 },
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
    deactivate('anna');
    expect(await competence.erasePerson('operator:cli', 'anna')).toEqual({ holdings: 1, cleared: 0, cards: 0 });
    expect(lastAudit()).toEqual({
      actor: 'operator:cli',
      action: 'competence.person_erased',
      subject: 'person:anna',
      at: now.toISOString(),
      details: { holdings: 1, cleared: 0, cards: 0 },
    });
    // The manager who registered is erased: the holdings stay, without her id.
    deactivate('boss');
    expect(await competence.erasePerson('operator:cli', 'boss')).toEqual({ holdings: 0, cleared: 1, cards: 0 });
    expect([...store.state.holdings.values()].map(h => [h.personId, h.registeredBy])).toEqual([['bo', null]]);
  });
  test("the cards the competence scan put in the person's own stream go with the holdings, and are counted (R1)", async () => {
    const seeded = memoryCompetenceStore({
      persons: [{ id: 'anna', organisationId: ORG, name: 'Anna', userName: 'anna.a', enabled: false }],
      cards: {
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
    expect(await erasing.erasePerson('operator:cli', 'anna')).toEqual({ holdings: 0, cleared: 0, cards: 2 });
    // Another connector's card of hers and a colleague's competence card stay.
    expect([...seeded.state.cards.keys()].sort()).toEqual(['card-bo', 'card-hr']);
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
        details: { holdings: 0, cleared: 0, cards: 2 },
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
    expect([...store.state.cards.keys()]).toEqual(['card-anna']);
    // Once the source has deactivated her, the same call erases her.
    deactivate('anna');
    expect(await competence.erasePerson('operator:cli', 'anna')).toEqual({ holdings: 1, cleared: 0, cards: 1 });
  });
  test('the export is one versioned document of the organisation, audited with counts', async () => {
    const { hot } = await catalogue();
    await competence.registerHolding(boss, 'anna', { typeId: hot, issuedOn: '2026-01-10' });
    await competence.seedType('operator:test', 'org-2', { name: 'Annan', area: 'X', kind: 'course' });
    const doc = await competence.exportDomain('operator:cli', ORG);
    expect(doc).toMatchObject({ format: 'clew.competence/1', exportedAt: now.toISOString(), organisationId: ORG });
    expect(doc.types.map(t => t.name).sort()).toEqual(['HLR', 'Heta arbeten', 'Socionomexamen']);
    expect(doc.holdings).toHaveLength(1);
    expect(lastAudit()).toEqual({
      actor: 'operator:cli',
      action: 'competence.exported',
      subject: 'organisation:' + ORG,
      at: now.toISOString(),
      details: { types: 3, holdings: 1 },
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
    ]);
    for (const x of c.capabilities) expect(viewProblem(x, c.capabilities)).toBeUndefined();
    // The read about a person takes the keys it is asked with, so it is no place in the menu.
    expect(c.capabilities.map(x => menuEligible(x))).toEqual([true, true, false]);
    expect('ref' in attentionView || 'ref' in holdingsView || 'ref' in personView).toBe(false);
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
    expect(await figureOf(boss)).toMatchObject({ label: 'Inga intyg går ut inom 90 dagar.', tone: 'ok' });
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
