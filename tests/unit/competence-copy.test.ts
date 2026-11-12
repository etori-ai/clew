import { beforeEach, describe, expect, test } from 'bun:test';
import {
  checkContract,
  CompetenceAttentionOutputSchema,
  CompetenceHoldingsOutputSchema,
  HoldingsOutputSchema,
  type HoldingsOutput,
  type AuthenticatedContext,
  type StaffOverview,
  type StaffPerson,
} from '../../packages/contracts/src/index';
import { viewProblem, type Actor } from '../../packages/connectors/src/index';
import { ForbiddenError } from '../../apps/server/src/context';
import {
  memoryCompetenceStore,
  type MemoryCompetenceStore,
} from '../../apps/server/src/modules/competence/adapters/memory';
import { competenceConnector, holdingsView } from '../../apps/server/src/modules/competence/capabilities';
import { COPY_HOLDINGS_MAX, nextDailyCopy, usableHolding } from '../../apps/server/src/modules/competence/domain';
import type {
  HoldingsPort,
  SourceHolding,
  SourceHoldingsPage,
  SourceHoldingsRow,
} from '../../apps/server/src/modules/competence/model';
import {
  CompetenceError,
  competenceUsecases,
  COPY_ACTOR,
  PersonStillActive,
  type CompetenceUsecases,
} from '../../apps/server/src/modules/competence/usecases';
import { competenceRoutes } from '../../apps/server/src/routes/competence';
import { Registry } from '../registry';

/**
 * The copy of what sources hold (D108 item 9) on the memory adapter, with a source, a clock, ids and a staff port the
 * test owns: a key is matched to an active person and nothing is kept of one that matches nobody; a read repeated
 * changes nothing; a mapped copied row counts as a registered one does, an unmapped one counts towards nothing; a row
 * is revoked for absence only after a complete read of a source that reports withdrawals; two runs never read one
 * source at once; the mapping re-types what is copied; and every run, mapping and request has its audit row, with
 * counts and ids and never a name or a key.
 */
const ORG = 'org-1';
const staffPerson = (id: string, name: string, userName: string | null, enabled = true): StaffPerson => ({
  id,
  name,
  userName,
  email: null,
  role: 'employee',
  enabled,
});
const anna = staffPerson('anna', 'Anna Andersson', 'anna.a');
const bo = staffPerson('bo', 'Bo Berg', 'bo.b');
const cia = staffPerson('cia', 'Cia Carlsson', 'cia.c');
const NAMES = ['Anna Andersson', 'Bo Berg', 'Cia Carlsson', 'Karin Chef', 'Ada Admin'];
const KEYS = ['anna.a', 'ANNA.A', 'bo.b', 'cia.c', 'nobody.x'];
const LABELS = ['Hjärt-lungräddning', 'HLR-instruktör', 'Brandskydd, grund'];

function personaOf(
  id: string,
  role: 'manager' | 'employee',
  name: string,
  capabilities: AuthenticatedContext['capabilities'] = [],
): AuthenticatedContext {
  return {
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
    authorize: async () => ({ version: 'v1' }),
  };
}
const boss = personaOf('boss', 'manager', 'Karin Chef');
const admin = personaOf('ada', 'employee', 'Ada Admin', ['admin.competence']);
const asAnna = personaOf('anna', 'employee', 'Anna Andersson');

/** What the installation's read throws (D119's `InstallationReadError`): a Swedish message and the protocol's kind. */
class ReadError extends Error {
  constructor(readonly code: string) {
    super('Lärplattformen svarar inte just nu.');
  }
}
/** A source in memory: pages per connector, the pages that throw and with what, and how often it was asked. */
interface FakeSources extends HoldingsPort {
  on: boolean;
  names: Map<string, string>;
  pages: Map<string, SourceHoldingsPage[]>;
  /** Failures still to come, each once, in order: the page (by index) that throws and the error's kind, if any. */
  failures: Array<{ connectorId: string; page: number; code?: string }>;
  before: (connectorId: string, page: number) => Promise<unknown>;
  asked: Array<{ connectorId: string; cursor?: string }>;
  /** People outside the source's audience or the module's (D23): the composition's rule, set by a test. */
  outside: Set<string>;
  /** The organisations with someone in the audiences; every one when empty. */
  reaching: Set<string>;
}
function fakeSources(): FakeSources {
  const pages = new Map<string, SourceHoldingsPage[]>();
  const port: FakeSources = {
    on: true,
    names: new Map([['lms', 'Lärplattformen']]),
    pages,
    failures: [],
    /** Called before a page is answered: a test may take the source's lease meanwhile. */
    before: async () => undefined,
    asked: [],
    outside: new Set(),
    reaching: new Set(),
    // As composition applies the audiences: an active person, inside both.
    async admitted(_connectorId, personIds) {
      return new Set(personIds.filter(id => !port.outside.has(id) && !store.state.inactive.has(id)));
    },
    async reaches(_connectorId, organisationId) {
      return !port.reaching.size || port.reaching.has(organisationId);
    },
    async switchedOn() {
      return port.on;
    },
    async holdingsSources() {
      return [...port.names].map(([connectorId, source]) => ({ connectorId, source }));
    },
    async readHoldings(connectorId: string, cursor?: string): Promise<SourceHoldingsPage> {
      port.asked.push({ connectorId, ...(cursor ? { cursor } : {}) });
      const i = cursor ? Number(cursor) : 0;
      await port.before(connectorId, i);
      const failing = port.failures.findIndex(f => f.connectorId === connectorId && f.page === i);
      if (failing >= 0) {
        const { code } = port.failures.splice(failing, 1)[0]!;
        throw code ? new ReadError(code) : new Error('Något annat gick fel.');
      }
      const all = pages.get(connectorId) ?? [];
      const page = all[i] ?? { rows: [], withdrawalsReported: false };
      return { ...page, ...(i + 1 < all.length ? { next: String(i + 1) } : {}) };
    },
  };
  return port;
}
const holding = (id: string, type: string, label: string, issuedOn: string, expiresOn?: string): SourceHolding => ({
  id,
  type,
  label,
  kind: expiresOn ? 'badge' : 'course',
  issuedOn,
  ...(expiresOn ? { expiresOn } : {}),
});
/** The source throws at this page, `times` times in a row, with this kind. */
const failNext = (page: number, code?: string, times = 1) => {
  for (let i = 0; i < times; i++) source.failures.push({ connectorId: 'lms', page, ...(code ? { code } : {}) });
};
const row = (key: string, holdings: SourceHolding[], partial?: true): SourceHoldingsRow => ({
  key,
  holdings,
  ...(partial ? { partial } : {}),
});

let now: Date;
let n: number;
let store: MemoryCompetenceStore;
let competence: CompetenceUsecases;
let source: ReturnType<typeof fakeSources>;
let logged: unknown[][];
let pauses: number[];
let staff: Map<string, StaffOverview>;
beforeEach(() => {
  // A Tuesday morning in Sweden: the day is 2026-11-10.
  now = new Date('2026-11-10T09:00:00.000Z');
  n = 0;
  logged = [];
  pauses = [];
  staff = new Map([['boss', { units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [anna, bo, cia] }] }]]);
  store = memoryCompetenceStore({
    persons: [anna, bo, cia, { id: 'boss', name: 'Karin Chef', userName: 'boss' }].map(p => ({
      id: p.id,
      organisationId: ORG,
      name: p.name,
      userName: p.userName,
    })),
  });
  source = fakeSources();
  competence = competenceUsecases({
    store,
    staff: async persona => staff.get(persona.id) ?? { units: [] },
    clock: () => now,
    ids: () => 'id-' + ++n,
    holdings: source,
    pause: async ms => void pauses.push(ms),
    log: (...line) => void logged.push(line),
  });
});
const audits = () => store.audit();
const copied = () =>
  [...store.state.holdings.values()]
    .filter(h => h.copy)
    .sort((a, b) => a.copy!.sourceId.localeCompare(b.copy!.sourceId));
const lms = { connectorId: 'lms', source: 'Lärplattformen' };
/** A catalogue with HLR (24 months by the employer's rule) and HLR-instruktör (the issuer's date). */
async function catalogue() {
  const hlr = await competence.addType(admin, { name: 'HLR', area: 'Akut', kind: 'course', validityMonths: 24 });
  const instructor = await competence.addType(admin, { name: 'HLR-instruktör', area: 'Akut', kind: 'authorisation' });
  return { hlr, instructor };
}
/** What the learning platform answers: Anna's course and badge, a key it knows and Clew does not, and a bad date. */
function platform(withdrawalsReported = false) {
  source.pages.set('lms', [
    {
      rows: [
        row('ANNA.A', [
          holding('course:7:user:1', 'clew-dev:hlr', 'Hjärt-lungräddning', '2025-11-01'),
          holding('badge:4:user:1', 'badge:4', 'HLR-instruktör', '2026-01-01', '2026-12-31'),
        ]),
        row('nobody.x', [holding('course:7:user:9', 'clew-dev:hlr', 'Hjärt-lungräddning', '2025-11-01')]),
      ],
      withdrawalsReported,
    },
    {
      rows: [row('bo.b', [holding('course:7:user:2', 'clew-dev:hlr', 'Hjärt-lungräddning', '2026-13-01')])],
      withdrawalsReported,
    },
  ]);
}

describe('a read of a source', () => {
  test('copies what it holds for the people Clew knows; a key that matches nobody is counted and nothing of it kept', async () => {
    const { hlr } = await catalogue();
    await competence.mapSourceType(admin, 'lms', { sourceType: 'clew-dev:hlr', typeId: hlr });
    platform();
    const result = await competence.copySource(COPY_ACTOR, 'run-1', lms);
    // Every holding the source answered is read; the organisation is told of its own people's alone.
    const counts = { read: 4, stored: 2, unchanged: 0, invalid: 1, unmapped: 1, revoked: 0, outside: 0, removed: 0 };
    expect(result).toEqual({ connectorId: 'lms', outcome: 'complete', counts, unmatched: 1 });
    expect(source.asked).toEqual([{ connectorId: 'lms' }, { connectorId: 'lms', cursor: '1' }]);
    expect(copied()).toEqual([
      {
        id: 'id-4',
        personId: 'anna',
        typeId: null,
        issuedOn: '2026-01-01',
        expiresOn: '2026-12-31',
        evidence: 'system',
        state: 'valid',
        registeredBy: null,
        createdAt: now.toISOString(),
        revokedAt: null,
        revokedBy: null,
        copy: {
          connectorId: 'lms',
          sourceId: 'badge:4:user:1',
          sourceType: 'badge:4',
          sourceLabel: 'HLR-instruktör',
          readAt: now.toISOString(),
        },
      },
      {
        id: 'id-3',
        personId: 'anna',
        typeId: hlr,
        issuedOn: '2025-11-01',
        // The employer's rule decides when it is read, never stored (item 3).
        expiresOn: null,
        evidence: 'system',
        state: 'valid',
        registeredBy: null,
        createdAt: now.toISOString(),
        revokedAt: null,
        revokedBy: null,
        copy: {
          connectorId: 'lms',
          sourceId: 'course:7:user:1',
          sourceType: 'clew-dev:hlr',
          sourceLabel: 'Hjärt-lungräddning',
          readAt: now.toISOString(),
        },
      },
    ]);
    expect(store.state.sources.get('lms')).toEqual({
      connectorId: 'lms',
      source: 'Lärplattformen',
      run: null,
      claimedAt: null,
      leaseUntil: null,
      startedAt: now.toISOString(),
      finishedAt: now.toISOString(),
      outcome: 'complete',
      counts: { unmatched: 1, total: counts, organisations: { [ORG]: { ...counts, read: 3 } } },
    });
    expect(audits().at(-1)).toEqual({
      actor: COPY_ACTOR,
      action: 'competence.source_read',
      subject: 'connector:lms',
      at: now.toISOString(),
      details: { run: 'run-1', outcome: 'complete', pages: 2, unmatched: 1, ...counts },
    });
    // Nothing of the person the key did not match is kept, and no audit row names a person, a key or a label.
    expect(JSON.stringify([...store.state.holdings.values(), [...store.state.sources.values()]])).not.toContain(
      'nobody',
    );
    const written = JSON.stringify(audits());
    for (const word of [...NAMES, ...KEYS, ...LABELS]) expect(written).not.toContain(word);
  });

  test('read again, nothing changes but the time it was read', async () => {
    await catalogue();
    platform();
    await competence.copySource(COPY_ACTOR, 'run-1', lms);
    const before = copied();
    now = new Date('2026-11-11T03:00:00.000Z');
    const again = await competence.copySource(COPY_ACTOR, 'run-2', lms);
    expect(again.counts).toMatchObject({ read: 4, stored: 0, unchanged: 2, revoked: 0 });
    expect(copied()).toEqual(before.map(h => ({ ...h, copy: { ...h.copy!, readAt: now.toISOString() } })));
    expect(store.state.sources.get('lms')?.finishedAt).toBe(now.toISOString());
  });

  test('a source that does not answer is asked twice more after a pause, then the read stops: what it gave is kept, nothing revoked', async () => {
    await catalogue();
    platform(true);
    await competence.copySource(COPY_ACTOR, 'run-1', lms);
    // The second read: the first page answers without Anna's badge, then the platform stops answering.
    source.pages.get('lms')![0]!.rows[0]!.holdings.pop();
    failNext(1, 'unavailable', 3);
    const failed = await competence.copySource(COPY_ACTOR, 'run-2', lms);
    expect(failed).toMatchObject({ outcome: 'failed', counts: { read: 2, unchanged: 1, revoked: 0 } });
    // Nothing is revoked from a read that failed, the same page was asked three times, and the failure is logged with
    // the connector; the next run reads the source again.
    expect(copied().map(h => [h.copy!.sourceId, h.state])).toEqual([
      ['badge:4:user:1', 'valid'],
      ['course:7:user:1', 'valid'],
    ]);
    expect(source.asked.filter(a => a.cursor === '1')).toHaveLength(4);
    expect(pauses).toEqual([5_000, 30_000]);
    expect(logged).toHaveLength(1);
    expect(logged[0]![0]).toContain('stopped (unavailable)');
    // A kind and counts, never the source's own words: no error object is logged (D91).
    expect(logged[0]).toEqual([logged[0]![0], { connector: 'lms', pages: 1 }]);
    expect(store.state.sources.get('lms')).toMatchObject({ outcome: 'failed', run: null, leaseUntil: null });
    expect(audits().at(-1)).toMatchObject({
      action: 'competence.source_read',
      details: { outcome: 'failed', failure: 'unavailable' },
    });
    // Once it answers again, the same page asked again is enough.
    failNext(1, 'unavailable');
    expect(await competence.copySource(COPY_ACTOR, 'run-3', lms)).toMatchObject({ outcome: 'complete' });
    expect(pauses).toEqual([5_000, 30_000, 5_000]);
  });

  test('a cursor the source no longer knows starts the sweep again from the first page once, and a second refusal stops it', async () => {
    await catalogue();
    platform(true);
    await competence.copySource(COPY_ACTOR, 'run-1', lms);
    failNext(1, 'invalid');
    const again = await competence.copySource(COPY_ACTOR, 'run-2', lms);
    // What the first sweep gathered was given back: the counts are the second sweep's alone.
    expect(again).toMatchObject({ outcome: 'complete', counts: { read: 4, unchanged: 2, revoked: 0 } });
    expect(source.asked.slice(-4).map(a => a.cursor ?? 'first')).toEqual(['first', '1', 'first', '1']);
    expect(logged[0]![0]).toContain('starts again from the first page');
    // Refused again after the new start: the read stops, and nothing is revoked although the source reports withdrawals.
    failNext(1, 'invalid', 2);
    const stopped = await competence.copySource(COPY_ACTOR, 'run-3', lms);
    expect(stopped).toMatchObject({ outcome: 'failed', counts: { read: 3, revoked: 0 } });
    expect(audits().at(-1)?.details).toMatchObject({ failure: 'invalid' });
    expect(copied().every(h => h.state === 'valid')).toBe(true);
    // Refused on the first page there is nothing to start again from.
    failNext(0, 'invalid');
    expect(await competence.copySource(COPY_ACTOR, 'run-4', lms)).toMatchObject({ outcome: 'failed' });
  });

  test('a source switched off, refusing, or answering outside the profile stops the read at once; so does a cancelled run', async () => {
    await catalogue();
    platform(true);
    await competence.copySource(COPY_ACTOR, 'run-1', lms);
    for (const code of ['not-found', 'denied', 'unknown', undefined]) {
      failNext(1, code);
      const asked = source.asked.length;
      expect(await competence.copySource(COPY_ACTOR, 'run-' + code, lms)).toMatchObject({
        outcome: 'failed',
        counts: { revoked: 0 },
      });
      expect(source.asked.length - asked).toBe(2);
      expect(audits().at(-1)?.details).toMatchObject({ failure: code ?? 'unknown' });
    }
    expect(pauses).toEqual([]);
    // A run the engine cancels aborts the page under way and stops there.
    const cancel = new AbortController();
    source.before = async (_id, page) => {
      if (page === 1) cancel.abort();
    };
    failNext(1, 'unavailable');
    expect(await competence.copySource(COPY_ACTOR, 'run-cancelled', lms, { signal: cancel.signal })).toMatchObject({
      outcome: 'failed',
    });
    expect(audits().at(-1)?.details).toMatchObject({ failure: 'cancelled' });
    expect(copied().every(h => h.state === 'valid')).toBe(true);
  });

  test('withdrawals: only a complete read of a source that reports them revokes, and an answered row is valid again', async () => {
    await catalogue();
    platform(true);
    await competence.copySource(COPY_ACTOR, 'run-1', lms);
    const badge = () => copied().find(h => h.copy!.sourceId === 'badge:4:user:1')!;
    // A row marked partial: nothing is concluded from what is missing.
    source.pages.get('lms')![0]!.rows[0] = row('anna.a', [], true);
    expect(await competence.copySource(COPY_ACTOR, 'run-2', lms)).toMatchObject({ outcome: 'partial' });
    expect(badge().state).toBe('valid');
    // Complete, and the source reports withdrawals: what it no longer has is revoked, and stays in the copy.
    now = new Date('2026-11-11T03:00:00.000Z');
    source.pages.get('lms')![0]!.rows[0] = row('anna.a', [
      holding('course:7:user:1', 'clew-dev:hlr', 'Hjärt-lungräddning', '2025-11-01'),
    ]);
    expect((await competence.copySource(COPY_ACTOR, 'run-3', lms)).counts).toMatchObject({ revoked: 1, unchanged: 1 });
    expect(badge()).toMatchObject({ state: 'revoked', revokedAt: now.toISOString(), revokedBy: null });
    // Answered again: valid again.
    platform(true);
    expect((await competence.copySource(COPY_ACTOR, 'run-4', lms)).counts).toMatchObject({ stored: 1, revoked: 0 });
    expect(badge()).toMatchObject({ state: 'valid', revokedAt: null });
  });

  test('a source that leaves things out without a word never has a row revoked for absence', async () => {
    await catalogue();
    platform(false);
    await competence.copySource(COPY_ACTOR, 'run-1', lms);
    source.pages.set('lms', [{ rows: [], withdrawalsReported: false }]);
    expect(await competence.copySource(COPY_ACTOR, 'run-2', lms)).toMatchObject({
      outcome: 'complete',
      counts: { read: 0, revoked: 0 },
    });
    expect(copied().every(h => h.state === 'valid')).toBe(true);
  });

  test("a deactivated person's key matches nobody and their copied rows go at the next read, whatever the source says", async () => {
    const { hlr } = await catalogue();
    await competence.mapSourceType(admin, 'lms', { sourceType: 'clew-dev:hlr', typeId: hlr });
    source.pages.set('lms', [
      {
        rows: [row('cia.c', [holding('course:7:user:3', 'clew-dev:hlr', 'HLR', '2024-01-10')])],
        withdrawalsReported: true,
      },
    ]);
    await competence.copySource(COPY_ACTOR, 'run-1', lms);
    expect(copied().map(h => h.personId)).toEqual(['cia']);
    expect((await competence.attention(boss)).rows.map(r => r.name)).toEqual(['Cia Carlsson']);
    // SCIM deactivates her (D68): her rows leave every list at once, and the next read deletes them. A copy is a cache:
    // the source keeps the holding, and if she comes back the next read copies it again.
    store.deactivate('cia');
    staff.set('boss', {
      units: [{ unitId: 'u1', unitLabel: 'Enhet 1', people: [anna, bo, { ...cia, enabled: false }] }],
    });
    expect((await competence.attention(boss)).rows).toEqual([]);
    const again = await competence.copySource(COPY_ACTOR, 'run-2', lms);
    expect(again).toMatchObject({ unmatched: 1, counts: { stored: 0, revoked: 0, removed: 1 } });
    expect(copied()).toEqual([]);
  });

  test('a page as the development learning platform answers it: the guest, the administrator and the service account match nobody and nothing of them is kept', async () => {
    const { hlr } = await catalogue();
    await competence.mapSourceType(admin, 'lms', { sourceType: 'clew-dev:hlr', typeId: hlr });
    // The protocol's own shape (D119), checked as the registry checks every answer.
    const page: HoldingsOutput = {
      rows: [
        { key: 'guest', holdings: [], partial: true },
        { key: 'admin', holdings: [] },
        { key: 'clew-connector', holdings: [] },
        {
          key: 'anna.a',
          holdings: [
            {
              id: 'course:2:user:7',
              type: 'clew-dev:hlr',
              label: 'Hjärt-lungräddning',
              kind: 'course',
              issuedOn: '2025-11-01',
            },
            {
              id: 'badge:1:user:7',
              type: 'badge:1',
              label: 'HLR-instruktör',
              kind: 'badge',
              issuedOn: '2026-08-04',
              expiresOn: '2027-08-04',
            },
          ],
        },
        // An account Clew knows that holds nothing: a row without holdings.
        { key: 'bo.b', holdings: [] },
      ],
      withdrawalsReported: false,
    };
    expect(checkContract(HoldingsOutputSchema, page)).toBe(true);
    source.pages.set('lms', [page]);
    const result = await competence.copySource(COPY_ACTOR, 'run-1', lms);
    // The guest's row is partial, so the read is: nothing could be revoked anyway, as the source reports no withdrawals.
    expect(result).toMatchObject({
      outcome: 'partial',
      unmatched: 3,
      counts: { read: 2, stored: 2, unchanged: 0, invalid: 0, unmapped: 1, revoked: 0, outside: 0, removed: 0 },
    });
    // The badge is kept under the platform's label with no catalogue type: its kind is the source's word, not a kind.
    expect(copied().map(h => [h.personId, h.copy!.sourceType, h.typeId, h.copy!.sourceLabel])).toEqual([
      ['anna', 'badge:1', null, 'HLR-instruktör'],
      ['anna', 'clew-dev:hlr', hlr, 'Hjärt-lungräddning'],
    ]);
    const kept = JSON.stringify([[...store.state.holdings.values()], [...store.state.sources.values()], audits()]);
    expect(kept).toContain('anna');
    // Each key as a whole value, since a word such as `admin` may be part of another.
    for (const key of ['"guest"', '"admin"', '"clew-connector"']) expect(kept).not.toContain(key);
  });

  test('a source that holds more than one read can take stops there and keeps what was read', async () => {
    // Pages of a hundred accounts Clew does not know, one holding each, past the bound of one read.
    const pageOf = (i: number): HoldingsOutput => ({
      rows: Array.from({ length: 100 }, (_, r) => ({
        key: `unknown-${i}-${r}`,
        holdings: [{ id: `h-${i}-${r}`, type: 't', label: 'Kurs', kind: 'course' as const, issuedOn: '2025-01-01' }],
      })),
      next: String(i + 1),
      withdrawalsReported: true,
    });
    source.readHoldings = async (_id, cursor) => pageOf(cursor ? Number(cursor) : 0);
    const result = await competence.copySource(COPY_ACTOR, 'run-1', lms);
    expect(result).toMatchObject({
      outcome: 'failed',
      counts: { read: COPY_HOLDINGS_MAX + 100, stored: 0, revoked: 0 },
    });
    expect(audits().at(-1)?.details).toMatchObject({ failure: 'too-large', pages: COPY_HOLDINGS_MAX / 100 + 1 });
  });

  test('a row with an end before its issue, a day that has not come or no id is counted as unusable', () => {
    const today = '2026-11-10';
    expect(usableHolding(holding('a', 't', '  Brand\nskydd ', '2026-01-01'), today)).toEqual({
      id: 'a',
      type: 't',
      label: 'Brand skydd',
      issuedOn: '2026-01-01',
      expiresOn: null,
    });
    expect(usableHolding(holding('a', 't', 'X', '2026-11-11'), today)).toBeUndefined();
    expect(usableHolding(holding('a', 't', 'X', '2026-01-01', '2025-12-31'), today)).toBeUndefined();
    expect(usableHolding(holding('', 't', 'X', '2026-01-01'), today)).toBeUndefined();
    expect(usableHolding(holding('a', 'x'.repeat(201), 'X', '2026-01-01'), today)).toBeUndefined();
    expect(usableHolding(holding('a', 't', 'L'.repeat(300), '2026-01-01'), today)?.label).toHaveLength(120);
  });
});

describe('two runs and one source', () => {
  test('a source held by another run is not read; the same run takes its own lease again; a lapsed lease is taken over', async () => {
    await catalogue();
    platform();
    await store.transaction(tx =>
      tx.putSource({
        connectorId: 'lms',
        source: 'Lärplattformen',
        run: 'daily:2026-11-10',
        claimedAt: '2026-11-10T08:55:00.000Z',
        leaseUntil: '2026-11-10T09:10:00.000Z',
        startedAt: null,
        finishedAt: null,
        outcome: null,
        counts: null,
      }),
    );
    expect(await competence.copySource(COPY_ACTOR, 'read-now', lms)).toEqual({ connectorId: 'lms', outcome: 'busy' });
    expect(source.asked).toEqual([]);
    await expect(competence.readNow(admin, 'lms')).rejects.toThrow('Källan läses in just nu.');
    // The engine recovers the daily run after a restart: the same run goes on under its own lease.
    expect((await competence.copySource(COPY_ACTOR, 'daily:2026-11-10', lms)).outcome).toBe('complete');
    expect(store.state.sources.get('lms')?.startedAt).toBe('2026-11-10T08:55:00.000Z');
    // A run that died lets go within the lease: after it, another run reads.
    await store.transaction(tx =>
      tx.putSource({
        ...store.state.sources.get('lms')!,
        run: 'dead',
        claimedAt: now.toISOString(),
        leaseUntil: '2026-11-10T09:15:00.000Z',
      }),
    );
    now = new Date('2026-11-10T09:16:00.000Z');
    expect((await competence.copySource(COPY_ACTOR, 'read-now', lms)).outcome).toBe('complete');
  });

  test('a run that loses its lease between pages writes nothing', async () => {
    await catalogue();
    platform();
    source.before = async (_id, page) => {
      if (page === 1)
        await store.transaction(async tx =>
          tx.putSource({ ...(await tx.source('lms'))!, run: 'other', leaseUntil: '2026-11-10T10:00:00.000Z' }),
        );
    };
    const written = audits().length;
    expect(await competence.copySource(COPY_ACTOR, 'run-1', lms)).toEqual({ connectorId: 'lms', outcome: 'busy' });
    expect(copied()).toEqual([]);
    expect(audits()).toHaveLength(written);
  });

  test('a source whose cursor comes back fails the read instead of holding it', async () => {
    await catalogue();
    const page: SourceHoldingsPage = { rows: [], withdrawalsReported: true };
    source.readHoldings = async () => ({ ...page, next: 'again' });
    expect(await competence.copySource(COPY_ACTOR, 'run-1', lms)).toMatchObject({ outcome: 'failed' });
    expect(logged[0]![0]).toContain('stopped (endless)');
  });

  test('with the module switched off nothing is listed or read', async () => {
    platform();
    source.on = false;
    expect(await competence.copySources()).toEqual([]);
    expect(await competence.copyAll(COPY_ACTOR, 'run-1')).toEqual([]);
    expect(source.asked).toEqual([]);
    await expect(competence.readNow(admin, 'lms')).rejects.toThrow('Källan svarar inte om intyg just nu.');
  });
});

describe('status and reads with copied rows', () => {
  test('a mapped copied row counts as a registered one, the one that ends last decides, and an unmapped one counts towards nothing', async () => {
    const { hlr, instructor } = await catalogue();
    // Registered in Clew in 2022: by the 24-month rule it ran out in 2024.
    await competence.registerHolding(boss, 'anna', { typeId: hlr, issuedOn: '2022-01-10' });
    await competence.mapSourceType(admin, 'lms', { sourceType: 'clew-dev:hlr', typeId: hlr });
    platform();
    await competence.copySource(COPY_ACTOR, 'run-1', lms);
    const read = now.toISOString();
    const mine = await competence.holdings(asAnna);
    expect(checkContract(CompetenceHoldingsOutputSchema, mine)).toBe(true);
    expect(
      mine.rows.map(r => [r.competence, r.status, r.expiresOn ?? null, r.source ?? null, r.readAt ?? null]),
    ).toEqual([
      // The copied course decides: it ends last (2027-11-01, counted from the employer's rule).
      ['HLR', 'valid', '2027-11-01', 'Lärplattformen', read],
      // The badge's type is not mapped: listed under the source's label, counting towards nothing.
      ['HLR-instruktör', 'uncounted', '2026-12-31', 'Lärplattformen', read],
    ]);
    expect(mine.rows[1]).not.toHaveProperty('area');
    expect(mine.rows[1]).not.toHaveProperty('kind');
    expect(await competence.aboutPeople(boss, ['anna.a'])).toEqual({
      rows: [{ key: 'anna.a', expired: 0, missing: 0, expiring: 0, holdings: 1 }],
    });
    expect((await competence.attention(boss)).rows).toEqual([]);
    // Mapped, the badge counts at once with the issuer's own end date: 51 days left, so it needs attention.
    expect(await competence.mapSourceType(admin, 'lms', { sourceType: 'badge:4', typeId: instructor })).toEqual({
      holdings: 1,
    });
    const due = await competence.attention(boss);
    expect(checkContract(CompetenceAttentionOutputSchema, due)).toBe(true);
    expect(due.rows.map(r => [r.name, r.competence, r.status, r.expiresOn, r.source, r.readAt])).toEqual([
      ['Anna Andersson', 'HLR-instruktör', 'expiring', '2026-12-31', 'Lärplattformen', read],
    ]);
    expect(await competence.summary(boss)).toEqual({ expired: 0, missing: 0, expiring: 1, people: 1, reports: 3 });
    // The scan: Anna's own card for the badge.
    expect((await competence.ownAttention(asAnna)).map(s => s.type.name)).toEqual(['HLR-instruktör']);
  });

  test('a copied row cannot be revoked by a manager', async () => {
    const { hlr } = await catalogue();
    await competence.mapSourceType(admin, 'lms', { sourceType: 'clew-dev:hlr', typeId: hlr });
    platform();
    await competence.copySource(COPY_ACTOR, 'run-1', lms);
    const id = copied().find(h => h.typeId === hlr)!.id;
    await expect(competence.revokeHolding(boss, id)).rejects.toBeInstanceOf(ForbiddenError);
    expect(store.state.holdings.get(id)?.state).toBe('valid');
  });

  test('the holdings view draws a copied row with its source and the time it was read, within the closed catalogue', () => {
    const c = competenceConnector(competence, async () => asAnna);
    for (const x of c.capabilities) expect(viewProblem(x, c.capabilities)).toBeUndefined();
    expect(holdingsView.kind === 'list' && holdingsView.fields.map(f => [f.key, f.format ?? 'text'])).toEqual([
      ['competence', 'text'],
      ['status', 'status'],
      ['expiresOn', 'date'],
      ['issuedOn', 'date'],
      ['area', 'text'],
      ['source', 'text'],
      ['readAt', 'instant'],
    ]);
  });

  test('the reads answer through the registry with copied rows', async () => {
    const { hlr } = await catalogue();
    await competence.mapSourceType(admin, 'lms', { sourceType: 'clew-dev:hlr', typeId: hlr });
    platform();
    await competence.copySource(COPY_ACTOR, 'run-1', lms);
    const r = new Registry().register(competenceConnector(competence, async () => asAnna));
    const actor: Actor = { id: 'anna', name: 'Anna Andersson', unitId: 'u1', unitLabel: 'Enhet 1', role: 'employee' };
    const out = await r.run<{ rows: Array<{ status: string }> }>(actor, 'competence.holdings', {});
    expect(out.rows.map(x => x.status)).toEqual(['valid', 'uncounted']);
  });
});

describe('the mapping', () => {
  test('an administrator maps a type of a source and the copied rows are re-typed in the same transaction, audited', async () => {
    const { hlr } = await catalogue();
    platform();
    await competence.copySource(COPY_ACTOR, 'run-1', lms);
    expect(copied().map(h => h.typeId)).toEqual([null, null]);
    expect(await competence.mapSourceType(admin, 'lms', { sourceType: 'clew-dev:hlr', typeId: hlr })).toEqual({
      holdings: 1,
    });
    expect(store.state.mappings.get('lms\n' + ORG + '\nclew-dev:hlr')).toEqual({
      connectorId: 'lms',
      organisationId: ORG,
      sourceType: 'clew-dev:hlr',
      typeId: hlr,
      mappedBy: 'person:ada',
      mappedAt: now.toISOString(),
    });
    expect(copied().map(h => h.typeId)).toEqual([null, hlr]);
    expect(audits().at(-1)).toEqual({
      actor: 'person:ada',
      action: 'competence.source_mapped',
      subject: 'connector:lms',
      at: now.toISOString(),
      details: { organisationId: ORG, sourceType: 'clew-dev:hlr', typeBefore: null, typeAfter: hlr, holdings: 1 },
    });
    // The same mapping again writes nothing; removing it un-types the rows and is audited.
    const written = audits().length;
    await competence.mapSourceType(admin, 'lms', { sourceType: 'clew-dev:hlr', typeId: hlr });
    expect(audits()).toHaveLength(written);
    await competence.mapSourceType(admin, 'lms', { sourceType: 'clew-dev:hlr', typeId: null });
    expect(copied().map(h => h.typeId)).toEqual([null, null]);
    expect(store.state.mappings.size).toBe(0);
    expect(audits().at(-1)).toMatchObject({
      action: 'competence.source_unmapped',
      details: { typeBefore: hlr, typeAfter: null, holdings: 1 },
    });
    // A later read takes the type from the mapping in force.
    await competence.mapSourceType(admin, 'lms', { sourceType: 'badge:4', typeId: hlr });
    now = new Date('2026-11-11T03:00:00.000Z');
    expect((await competence.copySource(COPY_ACTOR, 'run-2', lms)).counts).toMatchObject({ unchanged: 2, unmapped: 1 });
    const written2 = JSON.stringify(audits());
    for (const word of [...NAMES, ...KEYS, ...LABELS]) expect(written2).not.toContain(word);
  });

  test('refused: without the capability, to an archived or foreign type, and for a source that never answered', async () => {
    const { hlr } = await catalogue();
    const foreign = await competence.seedType('operator:test', 'org-2', { name: 'Annan', area: 'X', kind: 'course' });
    const body = { sourceType: 'clew-dev:hlr', typeId: hlr };
    await expect(competence.mapSourceType(boss, 'lms', body)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(competence.sources(boss)).rejects.toBeInstanceOf(ForbiddenError);
    await expect(competence.readNow(boss, 'lms')).rejects.toBeInstanceOf(ForbiddenError);
    await expect(competence.mapSourceType(admin, 'lms', { ...body, typeId: foreign })).rejects.toThrow(
      'Kompetensen finns inte i katalogen.',
    );
    await competence.archiveType(admin, hlr);
    await expect(competence.mapSourceType(admin, 'lms', body)).rejects.toThrow(
      'Kompetensen är arkiverad och kan inte kopplas.',
    );
    await expect(competence.mapSourceType(admin, 'gone', body)).rejects.toBeInstanceOf(CompetenceError);
    expect(store.state.mappings.size).toBe(0);
  });
});

describe('the administration page and a read started by hand', () => {
  test('every source with its last read and its types, each with how many holdings carry it and its mapping', async () => {
    const { hlr } = await catalogue();
    platform();
    await competence.copySource(COPY_ACTOR, 'run-1', lms);
    await competence.mapSourceType(admin, 'lms', { sourceType: 'clew-dev:hlr', typeId: hlr });
    // A mapping of a type that holds nothing yet is listed too, and a source that no longer answers keeps its row.
    await competence.mapSourceType(admin, 'lms', { sourceType: 'clew-dev:brandskydd', typeId: hlr });
    await store.transaction(tx =>
      tx.putSource({
        connectorId: 'hr',
        source: 'Personalsystemet',
        run: null,
        claimedAt: null,
        leaseUntil: null,
        startedAt: null,
        finishedAt: null,
        outcome: null,
        counts: null,
      }),
    );
    expect(await competence.sources(admin)).toEqual({
      rows: [
        {
          connectorId: 'lms',
          source: 'Lärplattformen',
          answering: true,
          reading: false,
          lastRead: {
            startedAt: now.toISOString(),
            finishedAt: now.toISOString(),
            outcome: 'complete',
            // The keys that matched nobody belong to no organisation; the counts are this organisation's own.
            unmatched: 1,
            counts: { read: 3, stored: 2, unchanged: 0, invalid: 1, unmapped: 2, revoked: 0, outside: 0, removed: 0 },
          },
          types: [
            { sourceType: 'clew-dev:brandskydd', label: 'clew-dev:brandskydd', holdings: 0, typeId: hlr },
            { sourceType: 'clew-dev:hlr', label: 'Hjärt-lungräddning', holdings: 1, typeId: hlr },
            { sourceType: 'badge:4', label: 'HLR-instruktör', holdings: 1 },
          ],
        },
        { connectorId: 'hr', source: 'Personalsystemet', answering: false, reading: false, types: [] },
      ],
    });
  });

  test('"Läs in nu" starts a run of its own for one source with the transaction that records it', async () => {
    platform();
    await competence.readNow(admin, 'lms');
    expect(store.state.enqueued).toEqual([
      {
        workflow: 'competenceCopy',
        id: 'competence-read:id-1',
        input: { run: 'id-1', dueAt: now.toISOString(), connectorId: 'lms' },
      },
    ]);
    expect(audits().at(-1)).toEqual({
      actor: 'person:ada',
      action: 'competence.read_requested',
      subject: 'connector:lms',
      at: now.toISOString(),
      details: { run: 'id-1' },
    });
    await expect(competence.readNow(admin, 'hr')).rejects.toThrow('Källan svarar inte om intyg just nu.');
  });

  test('the daily run is asked for once per day at 04:00 in Sweden, summer time and winter time alike', async () => {
    expect(await competence.scheduleCopy()).toEqual({ day: '2026-11-11', at: '2026-11-11T03:00:00.000Z' });
    await competence.scheduleCopy();
    expect(store.state.enqueued).toEqual([
      {
        workflow: 'competenceCopy',
        id: 'competence-copy:2026-11-11',
        input: { run: 'daily:2026-11-11', dueAt: '2026-11-11T03:00:00.000Z', daily: true },
      },
    ]);
    expect(nextDailyCopy(new Date('2026-11-11T02:59:00.000Z'))).toEqual({
      day: '2026-11-11',
      at: '2026-11-11T03:00:00.000Z',
    });
    // The night summer time begins, 04:00 is two hours after midnight in UTC.
    expect(nextDailyCopy(new Date('2026-03-28T05:00:00.000Z'))).toEqual({
      day: '2026-03-29',
      at: '2026-03-29T02:00:00.000Z',
    });
  });
});

describe('leaving', () => {
  test('erasure takes the copied rows, the export carries copied rows and mappings, a removed source takes its own', async () => {
    const { hlr } = await catalogue();
    await competence.mapSourceType(admin, 'lms', { sourceType: 'clew-dev:hlr', typeId: hlr });
    platform();
    await competence.copySource(COPY_ACTOR, 'run-1', lms);
    const doc = await competence.exportDomain('operator:cli', ORG);
    expect(doc.format).toBe('clew.competence/4');
    expect(doc.holdings.map(h => [h.typeId, h.copy?.sourceId])).toEqual([
      [hlr, 'course:7:user:1'],
      [null, 'badge:4:user:1'],
    ]);
    expect(doc.mappings.map(m => m.sourceType)).toEqual(['clew-dev:hlr']);
    expect(audits().at(-1)?.details).toEqual({ types: 2, holdings: 2, mappings: 1, requirements: 0, shareTargets: 0 });

    expect(await competence.forgetSource('operator:cli', 'lms')).toEqual({ holdings: 2, mappings: 1 });
    expect(copied()).toEqual([]);
    expect(store.state.sources.size).toBe(0);
    expect(audits().at(-1)).toEqual({
      actor: 'operator:cli',
      action: 'competence.source_forgotten',
      subject: 'connector:lms',
      at: now.toISOString(),
      details: { holdings: 2, mappings: 1 },
    });

    await competence.copySource(COPY_ACTOR, 'run-2', lms);
    // Erasure is for a person the directory has deactivated: the next read would copy an active person's rows back.
    await expect(competence.erasePerson('operator:cli', 'anna')).rejects.toBeInstanceOf(PersonStillActive);
    expect(copied()).toHaveLength(2);
    store.deactivate('anna');
    expect(await competence.erasePerson('operator:cli', 'anna')).toEqual({ holdings: 2, cleared: 0, requirements: 0 });
    expect(copied()).toEqual([]);
  });
});

describe("what a source's strings and the database can refuse", () => {
  test('a control character or a lone surrogate costs one holding, never the read; a label is cleaned and a non-day refused', async () => {
    const { hlr } = await catalogue();
    await competence.mapSourceType(admin, 'lms', { sourceType: 'clew-dev:hlr', typeId: hlr });
    source.pages.set('lms', [
      {
        rows: [
          row('anna.a', [
            // Kept, with the NUL and the line break of its label taken out.
            holding('course:1:user:1', 'clew-dev:hlr', 'Hjärt-\u0000lungräddning\nmed hjärtstartare', '2025-11-01'),
            // Refused: an id or a type with a control character or half a surrogate pair names nothing reliably.
            holding('course:2:\u0000user:1', 'clew-dev:hlr', 'HLR', '2025-11-01'),
            holding('course:3:user:1', 'badge:\ud800', 'HLR', '2025-11-01'),
            // Refused: a day the calendar does not have, though it matches the pattern.
            holding('course:4:user:1', 'clew-dev:hlr', 'HLR', '2026-02-30'),
          ]),
        ],
        withdrawalsReported: false,
      },
      // A key with a NUL is no key: its holdings are unusable, and it is never sent to the database to be matched.
      {
        rows: [row('bo.b\u0000', [holding('course:5:user:2', 'clew-dev:hlr', 'HLR', '2025-11-01')])],
        withdrawalsReported: false,
      },
    ]);
    const result = await competence.copySource(COPY_ACTOR, 'run-1', lms);
    expect(result).toMatchObject({ outcome: 'complete', counts: { read: 5, stored: 1, invalid: 4 }, unmatched: 0 });
    expect(copied().map(h => [h.copy!.sourceId, h.copy!.sourceLabel])).toEqual([
      ['course:1:user:1', 'Hjärt- lungräddning med hjärtstartare'],
    ]);
  });

  test('a write the store refuses changes nothing, is recorded as failed with its kind and lets go of the source', async () => {
    const { hlr } = await catalogue();
    await competence.mapSourceType(admin, 'lms', { sourceType: 'clew-dev:hlr', typeId: hlr });
    platform();
    await competence.copySource(COPY_ACTOR, 'run-1', lms);
    const before = copied();
    // The next read's write fails in the store, as Postgres refuses a value or is gone.
    let refusing = true;
    const failing = competenceUsecases({
      store: {
        transaction: fn =>
          store.transaction(tx =>
            fn({
              ...tx,
              putCopied: async rows => {
                if (refusing) throw Object.assign(new Error('a value the database refuses: Hjärt'), { code: '22021' });
                return tx.putCopied(rows);
              },
            }),
          ),
      },
      staff: async () => ({ units: [] }),
      clock: () => now,
      ids: () => 'id-' + ++n,
      holdings: source,
      log: (...line) => void logged.push(line),
    });
    source.pages.get('lms')![0]!.rows[0]!.holdings[0]!.issuedOn = '2025-12-01';
    now = new Date('2026-11-11T03:00:00.000Z');
    const result = await failing.copySource(COPY_ACTOR, 'run-2', lms);
    expect(result).toMatchObject({ outcome: 'failed', counts: { read: 4, stored: 0, revoked: 0 } });
    expect(copied()).toEqual(before);
    expect(store.state.sources.get('lms')).toMatchObject({ outcome: 'failed', run: null, leaseUntil: null });
    expect(audits().at(-1)).toMatchObject({ action: 'competence.source_read', details: { failure: 'storage' } });
    // The log says the kind and the database's code, never the error's text.
    expect(logged.at(-1)).toEqual([
      'competence: what a source answered could not be written; the copy is unchanged',
      { connector: 'lms', failure: 'storage', code: '22021' },
    ]);
    // Let go of: the next run reads the source and writes.
    refusing = false;
    expect(await failing.copySource(COPY_ACTOR, 'run-3', lms)).toMatchObject({ outcome: 'complete' });
    expect(copied().find(h => h.copy!.sourceId === 'course:7:user:1')?.issuedOn).toBe('2025-12-01');
  });
});

describe("a failure on Clew's side while a source is read", () => {
  test('the audience or the register failing before the write is recorded as failed with its kind, and the source let go of', async () => {
    const { hlr } = await catalogue();
    await competence.mapSourceType(admin, 'lms', { sourceType: 'clew-dev:hlr', typeId: hlr });
    platform();
    await competence.copySource(COPY_ACTOR, 'run-1', lms);
    const before = copied();
    // The directory behind the audiences fails on the first page.
    const admitting = source.admitted;
    source.admitted = async () => {
      throw Object.assign(new Error('connection to anna.a lost'), { code: '08006' });
    };
    now = new Date('2026-11-11T03:00:00.000Z');
    const read = await competence.copySource(COPY_ACTOR, 'run-2', lms);
    expect(read).toMatchObject({ outcome: 'failed', counts: { stored: 0, revoked: 0, removed: 0 } });
    expect(store.state.sources.get('lms')).toMatchObject({ outcome: 'failed', run: null, leaseUntil: null });
    expect(audits().at(-1)?.details).toMatchObject({ run: 'run-2', outcome: 'failed', failure: 'storage' });
    expect(logged.at(-1)).toEqual([
      "competence: a source's read failed on Clew's side; the copy is unchanged",
      { connector: 'lms', failure: 'storage', code: '08006' },
    ]);
    expect(copied()).toEqual(before);
    // The register failing after the last page, as it lists who holds rows, is the same.
    source.admitted = admitting;
    const failing = competenceUsecases({
      store: {
        transaction: fn =>
          store.transaction(tx =>
            fn({
              ...tx,
              copiedPeople: async () => {
                throw new Error('the database is gone');
              },
            }),
          ),
      },
      staff: async () => ({ units: [] }),
      clock: () => now,
      ids: () => 'id-' + ++n,
      holdings: source,
      log: (...line) => void logged.push(line),
    });
    expect(await failing.copySource(COPY_ACTOR, 'run-3', lms)).toMatchObject({ outcome: 'failed' });
    expect(store.state.sources.get('lms')).toMatchObject({ outcome: 'failed', run: null });
    // Let go of at once: the next run reads the source, without waiting for a lease to lapse.
    expect(await competence.copySource(COPY_ACTOR, 'run-4', lms)).toMatchObject({ outcome: 'complete' });
  });
});

describe('audiences (D23)', () => {
  test('a person outside the source or the module audience gets no row, and a person who leaves it loses theirs at the next read', async () => {
    const { hlr } = await catalogue();
    await competence.mapSourceType(admin, 'lms', { sourceType: 'clew-dev:hlr', typeId: hlr });
    platform();
    source.outside.add('anna');
    const first = await competence.copySource(COPY_ACTOR, 'run-1', lms);
    expect(first).toMatchObject({ outcome: 'complete', counts: { stored: 0, outside: 1 } });
    expect(copied()).toEqual([]);
    // Nothing of hers is looked at: her badge is no unmapped type of the organisation.
    expect(store.state.sources.get('lms')?.counts?.organisations[ORG]).toMatchObject({
      read: 1,
      outside: 1,
      unmapped: 0,
    });
    // Inside again: copied at the next read. Outside again: deleted at the one after, whatever the source says.
    source.outside.clear();
    await competence.copySource(COPY_ACTOR, 'run-2', lms);
    expect(copied().map(h => h.personId)).toEqual(['anna', 'anna']);
    source.outside.add('anna');
    source.pages.set('lms', []);
    const third = await competence.copySource(COPY_ACTOR, 'run-3', lms);
    expect(third).toMatchObject({ counts: { removed: 2, revoked: 0 } });
    expect(copied()).toEqual([]);
    expect(audits().at(-1)?.details).toMatchObject({ removed: 2 });
  });

  test('an organisation with nobody in the audience is not shown the source, cannot read it now and cannot map it', async () => {
    platform();
    await competence.copySource(COPY_ACTOR, 'run-1', lms);
    source.reaching.add('org-2');
    expect(await competence.sources(admin)).toEqual({ rows: [] });
    await expect(competence.readNow(admin, 'lms')).rejects.toThrow('Källan svarar inte om intyg just nu.');
    await expect(competence.mapSourceType(admin, 'lms', { sourceType: 'clew-dev:hlr', typeId: 'x' })).rejects.toThrow(
      'Källan finns inte bland de system som svarar om intyg.',
    );
    expect(store.state.enqueued).toEqual([]);
  });

  test("each organisation is shown its own counts; the keys that matched nobody are every organisation's", async () => {
    store.addPerson({ id: 'dan', organisationId: 'org-2', name: 'Dan Dahl', userName: 'dan.d' });
    platform();
    source.pages
      .get('lms')![1]!
      .rows.push(
        row('dan.d', [
          holding('course:7:user:4', 'clew-dev:hlr', 'Hjärt-lungräddning', '2025-11-01'),
          holding('course:8:user:4', 'clew-dev:brand', 'Brandskydd', '2025-11-01'),
        ]),
      );
    await competence.copySource(COPY_ACTOR, 'run-1', lms);
    const ofOrg = async (persona: AuthenticatedContext) => (await competence.sources(persona)).rows[0]!.lastRead;
    expect(await ofOrg(admin)).toMatchObject({ unmatched: 1, counts: { read: 3, stored: 2, invalid: 1, unmapped: 2 } });
    const admin2 = { ...personaOf('eva', 'employee', 'Eva Admin', ['admin.competence']), organisationId: 'org-2' };
    expect(await ofOrg(admin2)).toMatchObject({
      unmatched: 1,
      counts: { read: 2, stored: 2, invalid: 0, unmapped: 2 },
    });
    // The audit row, an operator's, has the whole read.
    expect(audits().at(-1)?.details).toMatchObject({ read: 6, stored: 4, invalid: 1, unmatched: 1 });
  });

  test('a module switched off while a run is under way reads none of the sources it had not begun', async () => {
    source.names.set('hr', 'Personalsystemet');
    source.pages.set('hr', [{ rows: [], withdrawalsReported: false }]);
    platform();
    source.before = async connectorId => {
      if (connectorId === 'lms') source.on = false;
    };
    const results = await competence.copyAll(COPY_ACTOR, 'run-1');
    expect(results.map(r => [r.connectorId, r.outcome])).toEqual([
      ['lms', 'complete'],
      ['hr', 'off'],
    ]);
    expect(source.asked.map(a => a.connectorId)).not.toContain('hr');
  });
});

describe('the routes', () => {
  const personas = new Map([admin, boss].map(p => [p.id, p]));
  const app = (writable = true) =>
    competenceRoutes({
      competence,
      writable: async () => writable,
      guard: async (c, next) => {
        c.set('session', { context: personas.get(c.req.header('x-test-person') ?? '')! } as never);
        await next();
      },
    });
  const call = (who: AuthenticatedContext, method: string, path: string, body?: unknown, on = true) =>
    app(on).request('http://clew.local' + path, {
      method,
      headers: { 'x-test-person': who.id, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });

  test('the sources, a mapping and a read started by hand, each refused as the use case says', async () => {
    const { hlr } = await catalogue();
    platform();
    await competence.copySource(COPY_ACTOR, 'run-1', lms);
    const listed = await call(admin, 'GET', '/sources');
    expect(listed.status).toBe(200);
    expect(listed.headers.get('cache-control')).toContain('no-store');
    expect(((await listed.json()) as { rows: unknown[] }).rows).toHaveLength(1);
    expect((await call(boss, 'GET', '/sources')).status).toBe(403);
    expect((await call(admin, 'GET', '/sources', undefined, false)).status).toBe(403);

    const mapped = await call(admin, 'PUT', '/sources/lms/mapping', { sourceType: 'clew-dev:hlr', typeId: hlr });
    expect(mapped.status).toBe(200);
    expect(await mapped.json()).toEqual({ holdings: 1 });
    expect((await call(admin, 'PUT', '/sources/lms/mapping', { sourceType: 'clew-dev:hlr' })).status).toBe(400);
    expect((await call(admin, 'PUT', '/sources/LMS!/mapping', { sourceType: 'x', typeId: null })).status).toBe(400);
    expect(
      (await call(admin, 'PUT', '/sources/lms/mapping', { sourceType: 'x'.repeat(201), typeId: null })).status,
    ).toBe(400);
    const unknownType = await call(admin, 'PUT', '/sources/lms/mapping', { sourceType: 'x', typeId: 'nope' });
    expect(unknownType.status).toBe(400);
    expect(((await unknownType.json()) as { error: string }).error).toBe('Kompetensen finns inte i katalogen.');

    expect((await call(admin, 'POST', '/sources/lms/read')).status).toBe(202);
    expect(store.state.enqueued.map(s => s.id)).toEqual(['competence-read:id-5']);
    expect((await call(admin, 'POST', '/sources/hr/read')).status).toBe(400);
    expect((await call(boss, 'POST', '/sources/lms/read')).status).toBe(403);
  });
});
