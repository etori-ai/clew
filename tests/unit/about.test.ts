import { describe, expect, test } from 'bun:test';
import {
  AboutInputSchema,
  AboutResultSchema,
  checkContract,
  type AboutResult,
  type AuthenticatedContext,
  type StaffOverview,
  type StaffPerson,
  type View,
} from '../../packages/contracts/src/index';
import {
  SEARCH_CONNECTOR,
  actorOf,
  type Actor,
  type Capability,
  type Connector,
} from '../../packages/connectors/src/index';
import { connectorProblems } from '../../packages/connectors/src/validation';
import { aboutCapabilities } from '../../apps/server/src/modules/about/capabilities';
import { askedKeys, keptRows } from '../../apps/server/src/modules/about/domain';
import type { AboutSourceRef } from '../../apps/server/src/modules/about/model';
import { aboutUsecases } from '../../apps/server/src/modules/about/usecases';
import { memoryCompetenceStore } from '../../apps/server/src/modules/competence/adapters/memory';
import { competenceConnector } from '../../apps/server/src/modules/competence/capabilities';
import { competenceUsecases } from '../../apps/server/src/modules/competence/usecases';
import { Registry } from '../registry';

/**
 * The read across sources about an entity (D97 items 1, 5 and 7): which keys are sent, what a source's answer must be,
 * the budgets, and `clew.about` assembled as the server assembles it, over the registry, with the competence module as
 * the source about people.
 */
const view: View = { kind: 'list', title: 'state', fields: [{ key: 'state', label: 'Status' }] };
const source = (name: string): AboutSourceRef => ({
  name,
  connectorId: name.split('.')[0]!,
  source: 'Källa ' + name,
  title: 'Om ' + name,
  view,
});
const actor: Actor = { id: 'boss', name: 'Karin Chef', unitId: 'u1', unitLabel: 'Enhet 1', role: 'manager' };
const reachOf =
  (...ids: string[]) =>
  async () =>
    new Set(ids);

describe('the keys', () => {
  test('only what the reader may see is sent, each key once, in the order asked', () => {
    expect(askedKeys(['bo', 'dan', 'anna', 'bo'], new Set(['anna', 'bo', 'cia']))).toEqual(['bo', 'anna']);
    expect(askedKeys(['dan'], new Set(['anna']))).toEqual([]);
    const many = Array.from({ length: 250 }, (_, i) => 'p' + i);
    expect(askedKeys(many, new Set(many))).toHaveLength(200);
  });
  test('a source that answers a key it was not asked, or one key twice, has no rows that can be kept', () => {
    const asked = ['anna', 'bo'];
    expect(keptRows([{ key: 'bo' }, { key: 'anna', n: 1 }], asked)).toEqual([{ key: 'bo' }, { key: 'anna', n: 1 }]);
    expect(keptRows([], asked)).toEqual([]);
    expect(keptRows([{ key: 'dan' }], asked)).toBeUndefined();
    expect(keptRows([{ key: 'anna' }, { key: 'anna' }], asked)).toBeUndefined();
  });
});

describe('the read across sources', () => {
  test('every source is asked with the same reachable keys and answers in its own section', async () => {
    const calls: Array<[string, unknown]> = [];
    const about = aboutUsecases({
      sources: () => [source('a.one'), source('b.two')],
      reach: reachOf('boss', 'anna', 'bo'),
    });
    const out = await about.read(actor, { kind: 'person', keys: ['anna', 'dan', 'bo'] }, (async (
      name: string,
      input: unknown,
    ) => {
      calls.push([name, input]);
      return name === 'a.one' ? { rows: [{ key: 'anna', state: 'ok' }] } : { rows: [] };
    }) as never);
    expect(calls).toEqual([
      ['a.one', { keys: ['anna', 'bo'] }],
      ['b.two', { keys: ['anna', 'bo'] }],
    ]);
    expect(checkContract(AboutResultSchema, out)).toBe(true);
    expect(out.sections.map(s => [s.capability, s.connector, s.source, s.status, s.rows])).toEqual([
      ['a.one', 'a', 'Källa a.one', 'ok', [{ key: 'anna', state: 'ok' }]],
      ['b.two', 'b', 'Källa b.two', 'ok', []],
    ]);
    expect(out.sections[0]!.view).toEqual(view);
  });
  test('nobody within reach: no source is called and each section is empty, so asking tells nothing', async () => {
    let called = 0;
    const about = aboutUsecases({ sources: () => [source('a.one')], reach: reachOf('boss') });
    const out = await about.read(actor, { kind: 'person', keys: ['dan', 'eve'] }, (async () => {
      called++;
      return { rows: [] };
    }) as never);
    expect(called).toBe(0);
    expect(out.sections.map(s => [s.status, s.rows])).toEqual([['ok', []]]);
    // No source at all: no section.
    const none = aboutUsecases({ sources: () => [], reach: reachOf('boss') });
    expect(await none.read(actor, { kind: 'person', keys: ['boss'] }, (async () => ({})) as never)).toEqual({
      kind: 'person',
      sections: [],
    });
  });
  test('a source that throws, answers another shape or another key says so alone; the others stand', async () => {
    const about = aboutUsecases({
      sources: () => ['a.throws', 'b.shape', 'c.foreign', 'd.fine'].map(source),
      reach: reachOf('anna'),
    });
    const out = await about.read(actor, { kind: 'person', keys: ['anna'] }, (async (name: string) => {
      if (name === 'a.throws') throw new Error('down');
      if (name === 'b.shape') return { rows: [{ person: 'anna' }] };
      if (name === 'c.foreign') return { rows: [{ key: 'dan' }] };
      return { rows: [{ key: 'anna' }] };
    }) as never);
    expect(out.sections.map(s => [s.capability, s.status, s.rows.length])).toEqual([
      ['a.throws', 'unavailable', 0],
      ['b.shape', 'unavailable', 0],
      ['c.foreign', 'unavailable', 0],
      ['d.fine', 'ok', 1],
    ]);
  });
  test('a source past its budget is a timeout, and the whole stops at its own budget with what has answered', async () => {
    const slow = (ms: number, value: unknown) => new Promise(resolve => setTimeout(() => resolve(value), ms));
    const perSource = aboutUsecases({
      sources: () => [source('a.slow'), source('b.fast')],
      reach: reachOf('anna'),
      budget: { perSourceMs: 20, totalMs: 500 },
    });
    const one = await perSource.read(actor, { kind: 'person', keys: ['anna'] }, (async (name: string) =>
      name === 'a.slow' ? slow(120, { rows: [{ key: 'anna' }] }) : { rows: [{ key: 'anna' }] }) as never);
    expect(one.sections.map(s => [s.capability, s.status])).toEqual([
      ['a.slow', 'timeout'],
      ['b.fast', 'ok'],
    ]);
    const whole = aboutUsecases({
      sources: () => [source('a.slow'), source('b.fast')],
      reach: reachOf('anna'),
      budget: { perSourceMs: 500, totalMs: 20 },
    });
    const two = await whole.read(actor, { kind: 'person', keys: ['anna'] }, (async (name: string) =>
      name === 'a.slow' ? slow(120, { rows: [{ key: 'anna' }] }) : { rows: [{ key: 'anna' }] }) as never);
    expect(two.sections.map(s => [s.capability, s.status])).toEqual([
      ['a.slow', 'timeout'],
      ['b.fast', 'ok'],
    ]);
  });
});

describe('a read that declares what it is about (D97 item 1)', () => {
  const read = (extra: Partial<Capability>): Capability => ({
    name: 'x.about',
    kind: 'read',
    title: 'Om',
    description: 'Om en person.',
    input: AboutInputSchema,
    output: { type: 'object' } as never,
    model: false,
    scope: () => true,
    view,
    about: 'person',
    run: async () => ({ rows: [] }),
    ...extra,
  });
  const problems = (c: Capability) =>
    connectorProblems({ id: 'x', capabilities: [c], areas: [] } as never).filter(p => p.includes('D97'));
  test('it declares a view and is never a model tool', () => {
    expect(problems(read({}))).toEqual([]);
    expect(problems(read({ model: true }))).toHaveLength(1);
    const { view: _view, ...withoutView } = read({});
    expect(problems(withoutView as Capability)).toHaveLength(1);
  });
});

describe('clew.about over the registry, with competence as the source about people', () => {
  const ORG = 'org-1';
  const person = (id: string, name: string, userName: string | null, enabled = true): StaffPerson => ({
    id,
    name,
    userName,
    email: null,
    role: 'employee',
    enabled,
  });
  const persona = (id: string, role: 'manager' | 'employee', name: string): AuthenticatedContext => ({
    id,
    name,
    unitId: 'u1',
    unitLabel: 'Enhet 1',
    role,
    organisationId: ORG,
    principal: { id: 'person:' + id, kind: 'person' },
    capabilities: [],
    authorizationVersion: 'v1',
    sessionBinding: 'test',
    expiresAt: '2099-01-01T00:00:00.000Z',
    authorize: async () => ({ version: 'v1' }),
  });
  const boss = persona('boss', 'manager', 'Karin Chef');
  const asAnna = persona('anna', 'employee', 'Anna Andersson');
  const personas = new Map([boss, asAnna].map(p => [p.id, p]));
  const staff = new Map<string, StaffOverview>([
    [
      'boss',
      {
        units: [
          {
            unitId: 'u1',
            unitLabel: 'Enhet 1',
            people: [person('anna', 'Anna Andersson', 'anna.a'), person('bo', 'Bo Berg', null)],
          },
        ],
      },
    ],
  ]);
  async function world() {
    let n = 0;
    const store = memoryCompetenceStore({
      persons: [
        { id: 'anna', organisationId: ORG, name: 'Anna Andersson', userName: 'anna.a' },
        { id: 'bo', organisationId: ORG, name: 'Bo Berg', userName: null },
        { id: 'dan', organisationId: ORG, name: 'Dan Dahl', userName: 'dan.d' },
      ],
    });
    const competence = competenceUsecases({
      store,
      staff: async p => staff.get(p.id) ?? { units: [] },
      clock: () => new Date('2026-11-10T09:00:00.000Z'),
      ids: () => 'id-' + ++n,
    });
    const type = await competence.seedType('operator:test', ORG, {
      name: 'Heta arbeten',
      area: 'Säkerhet',
      kind: 'certificate',
    });
    await competence.seedHolding('operator:test', ORG, 'anna', {
      typeId: type,
      issuedOn: '2021-06-01',
      expiresOn: '2026-05-31',
    });
    await competence.seedHolding('operator:test', ORG, 'dan', {
      typeId: type,
      issuedOn: '2021-06-01',
      expiresOn: '2026-05-31',
    });
    const registry = new Registry();
    const about = aboutUsecases({
      sources: (a, kind) => registry.aboutSources(a, kind),
      // The core rule for a person, as composition fills it: the reader and their reports.
      reach: async a =>
        new Set([
          a.id,
          ...(staff.get(a.id)?.units ?? [])
            .flatMap(u => u.people)
            .filter(p => p.enabled)
            .map(p => p.id),
        ]),
    });
    const core: Connector = {
      id: SEARCH_CONNECTOR,
      kind: 'core',
      source: 'Clew',
      areas: [],
      ...aboutCapabilities(about, a => registry.aboutSources(a, 'person').length > 0),
    };
    registry.register(core);
    const built = competenceConnector(competence, async a => personas.get(a.id)!);
    return { registry, built };
  }
  const ask = (registry: Registry, p: AuthenticatedContext, keys: string[]) =>
    registry.run<AboutResult>(actorOf(p), 'clew.about', { kind: 'person', keys });

  test('without a source about people the composite is not offered', async () => {
    const w = await world();
    expect(w.registry.aboutSources(actorOf(boss), 'person')).toEqual([]);
    await expect(ask(w.registry, boss, ['anna'])).rejects.toThrow();
  });
  test('a manager asks about their reports and gets one section with the source’s view; a key outside is dropped', async () => {
    const w = await world();
    w.registry.register(w.built);
    const out = await ask(w.registry, boss, ['anna', 'bo', 'dan']);
    expect(checkContract(AboutResultSchema, out)).toBe(true);
    expect(out.sections).toHaveLength(1);
    expect(out.sections[0]).toMatchObject({
      connector: 'competence',
      source: 'Kompetens',
      capability: 'competence.standing',
      title: 'Kompetens',
      status: 'ok',
      // Bo holds nothing and Dan reports to nobody here: neither has a row.
      rows: [{ key: 'anna', person: 'anna.a', status: 'expired', expired: 1, expiring: 0, holdings: 1 }],
    });
    expect((out.sections[0]!.view as { open?: unknown }).open).toEqual({
      capability: 'competence.holdings',
      title: 'Kompetenser',
      params: { person: 'person' },
    });
    // Someone who manages nobody reaches themselves alone.
    expect((await ask(w.registry, asAnna, ['anna', 'bo'])).sections[0]!.rows.map(r => r.key)).toEqual(['anna']);
    // And the composite is no tool for the model.
    expect(w.registry.tools(actorOf(boss)).map(t => t.name)).not.toContain('clew.about');
    expect(w.registry.tools(actorOf(boss)).map(t => t.name)).not.toContain('competence.standing');
  });
});
