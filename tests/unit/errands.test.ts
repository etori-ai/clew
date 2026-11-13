import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import type { ErrandRow, ErrandsResult } from '../../packages/contracts/src/index';
import {
  audiencedActorOf,
  CapabilityError,
  SEARCH_CONNECTOR,
  type Actor,
  type AudiencedActor,
  type Connector,
} from '../../packages/connectors/src/index';
import { parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { merge, systemReport, unanswered } from '../../apps/server/src/modules/errands/domain';
import { errandCapabilities } from '../../apps/server/src/modules/errands/capabilities';
import { errandUsecases } from '../../apps/server/src/modules/errands/usecases';
import { createConnector as createSm } from '../../connectors/supportmanagement/connector.mjs';
import { createFixtureErrands } from '../../connectors/supportmanagement/errands.mjs';
import { assertionFor, testJwks } from '../connector-authority';

/**
 * The combined errand list (D35 item 4, D89): every case system at once under a budget, the rows ordered together by
 * the shared state, each opening in the system it came from, and the systems that missed named. Fake in-process case
 * systems stand in for two municipal systems; the SupportManagement connector joins as the real third.
 */
const at = Date.parse('2026-11-09T09:00:00Z');
const day = 86_400_000;
const ago = (days: number) => new Date(at - days * day).toISOString();
const ahead = (days: number) => new Date(at + days * day).toISOString();

const mikael: Actor = {
  id: 'mikael',
  name: 'Mikael Lind',
  unitId: 'unit-it',
  unitLabel: 'IT-enheten',
  role: 'employee',
};
const hillevi: Actor = { ...mikael, id: 'hillevi', name: 'Hillevi Berg', role: 'manager' };

const row = (system: string, n: number, over: Partial<ErrandRow> = {}): ErrandRow => ({
  ref: `errand:${system}:${n}`,
  label: `${system.toUpperCase()}-${n} · Ansökan`,
  state: 'active',
  status: 'Pågående',
  since: ago(1),
  area: 'Bygglov',
  ...over,
});

describe('rows from several case systems become one list, in pure code', () => {
  test('what waits on the person first, then the nearest deadline, then the longest wait, whichever system holds it', () => {
    const rows = merge([
      {
        id: 'a',
        source: 'A',
        status: 'ok',
        rows: [
          row('a', 1, { state: 'waiting-on-others' }),
          row('a', 2, { state: 'waiting-on-me', since: ago(1) }),
          row('a', 3, { state: 'closed' }),
        ],
      },
      {
        id: 'b',
        source: 'B',
        status: 'ok',
        rows: [
          row('b', 1, { state: 'waiting-on-me', since: ago(5) }),
          row('b', 2, { state: 'waiting-on-me', since: ago(0.5), dueAt: ahead(2) }),
          row('b', 3, { state: 'new' }),
          row('b', 4, { state: 'active' }),
        ],
      },
    ]);
    expect(rows.map(r => [r.ref, r.state])).toEqual([
      ['errand:b:2', 'waiting-on-me'],
      ['errand:b:1', 'waiting-on-me'],
      ['errand:a:2', 'waiting-on-me'],
      ['errand:b:3', 'new'],
      ['errand:b:4', 'active'],
      ['errand:a:1', 'waiting-on-others'],
      ['errand:a:3', 'closed'],
    ]);
    expect(rows[0]).toMatchObject({ connector: 'b', system: 'B' });
  });
  test('a repeated ref is one errand, the list is capped, and the systems that missed are named once', () => {
    const outcomes = [
      { id: 'a', source: 'A', status: 'ok' as const, rows: [row('a', 1), row('a', 1), row('a', 2)] },
      { id: 'b', source: 'Bygglovssystemet', status: 'timeout' as const },
      { id: 'c', source: 'Bygglovssystemet', status: 'unavailable' as const },
    ];
    expect(merge(outcomes).map(r => r.ref)).toEqual(['errand:a:1', 'errand:a:2']);
    expect(
      merge([{ id: 'a', source: 'A', status: 'ok', rows: Array.from({ length: 300 }, (_, i) => row('a', i)) }]),
    ).toHaveLength(200);
    expect(systemReport(outcomes).map(s => s.status)).toEqual(['ok', 'timeout', 'unavailable']);
    expect(unanswered(outcomes)).toEqual(['Bygglovssystemet']);
  });
});

/** A fake case system as an in-process connector: `<id>.errands` answers from a list, `<id>.errand` opens one. */
function caseSystem(
  id: string,
  source: string,
  rows: unknown[],
  options: { delayMs?: number; fail?: boolean; calls?: unknown[]; roles?: Actor['role'][] } = {},
): Connector {
  return {
    id,
    kind: 'passthrough',
    source,
    areas: [],
    capabilities: [
      {
        name: id + '.errands',
        kind: 'read',
        title: 'Ärenden i ' + source,
        description: 'x',
        input: {} as never,
        output: {} as never,
        model: true,
        scope: options.roles ? { roles: options.roles } : {},
        view: {
          kind: 'list',
          title: 'label',
          ref: 'ref',
          open: { capability: id + '.errand', title: 'Ärende', params: { ref: 'ref' } },
          fields: [{ key: 'label', label: 'Ärende' }],
        },
        run: async (_actor, input: unknown) => {
          options.calls?.push(input);
          if (options.delayMs) await new Promise(r => setTimeout(r, options.delayMs));
          if (options.fail) throw new CapabilityError(source + ' svarar inte just nu.');
          return { rows };
        },
      },
      {
        name: id + '.errand',
        kind: 'read',
        title: 'Ärende',
        description: 'x',
        input: {} as never,
        output: {} as never,
        model: false,
        scope: {},
        run: async () => ({}),
      },
    ],
  };
}
function world(connectors: Connector[], budget = { perSourceMs: 40, totalMs: 80 }) {
  const registry = new Registry();
  const errands = errandUsecases({ sources: a => registry.errandSources(a), budget });
  for (const c of connectors) registry.register(c);
  registry.register({
    id: SEARCH_CONNECTOR,
    kind: 'core',
    source: 'Startsidan',
    ...errandCapabilities(errands, a => registry.errandSources(a).length > 0),
    uses: ['*'],
  });
  return registry;
}
const list = (registry: Registry, actor: AudiencedActor, input: Record<string, unknown> = {}, context = {}) =>
  registry.run<ErrandsResult>(actor, 'clew.errands', input, context);

describe('clew.errands', () => {
  test('asks every case system at once and answers with one list, each row opening in its own system', async () => {
    const calls: unknown[] = [];
    const registry = world([
      caseSystem('permits', 'Bygglovssystemet', [row('permits', 1, { state: 'waiting-on-others' })], { calls }),
      caseSystem('support', 'Kundtjänsten', [row('support', 7, { state: 'waiting-on-me', area: 'IT' })], { calls }),
    ]);
    const result = await list(registry, mikael, { view: 'reported' });
    expect(result.rows).toEqual([
      {
        ...row('support', 7, { state: 'waiting-on-me', area: 'IT' }),
        connector: 'support',
        system: 'Kundtjänsten',
        view: {
          capability: 'support.errand',
          input: { ref: 'errand:support:7' },
          title: 'Ärende',
          source: 'Kundtjänsten',
        },
      },
      {
        ...row('permits', 1, { state: 'waiting-on-others' }),
        connector: 'permits',
        system: 'Bygglovssystemet',
        view: {
          capability: 'permits.errand',
          input: { ref: 'errand:permits:1' },
          title: 'Ärende',
          source: 'Bygglovssystemet',
        },
      },
    ]);
    expect(result.systems).toEqual([
      { id: 'permits', source: 'Bygglovssystemet', status: 'ok' },
      { id: 'support', source: 'Kundtjänsten', status: 'ok' },
    ]);
    expect(result.unanswered).toEqual([]);
    // Every system is asked the same question, and nothing else.
    expect(calls).toEqual([{ view: 'reported' }, { view: 'reported' }]);
  });

  test('a system that fails or is late is named, and the rest are listed', async () => {
    const registry = world([
      caseSystem('permits', 'Bygglovssystemet', [row('permits', 1)]),
      caseSystem('support', 'Kundtjänsten', [row('support', 1)], { fail: true }),
      caseSystem('social', 'Verksamhetssystemet', [row('social', 1)], { delayMs: 200 }),
    ]);
    const result = await list(registry, mikael);
    expect(result.rows.map(r => r.ref)).toEqual(['errand:permits:1']);
    expect(result.systems.map(s => [s.id, s.status])).toEqual([
      ['permits', 'ok'],
      ['support', 'unavailable'],
      ['social', 'timeout'],
    ]);
    expect(result.unanswered).toEqual(['Kundtjänsten', 'Verksamhetssystemet']);
  });

  test('when nobody answers it is an error, never an empty list', async () => {
    const one = world([caseSystem('support', 'Kundtjänsten', [], { fail: true })]);
    await expect(list(one, mikael)).rejects.toThrow('Kundtjänsten svarar inte just nu.');
    const two = world([
      caseSystem('support', 'Kundtjänsten', [], { fail: true }),
      caseSystem('permits', 'Bygglovssystemet', [], { delayMs: 200 }),
    ]);
    await expect(list(two, mikael)).rejects.toThrow('Inget av ärendesystemen svarar just nu.');
    // The sources' failure, as a connector calling back is told (503 unavailable), never a refusal of its input.
    await expect(list(one, mikael)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(list(two, mikael)).rejects.toMatchObject({ code: 'unavailable' });
    // A system that answers with no errands is an answer.
    const empty = world([caseSystem('support', 'Kundtjänsten', [])]);
    expect(await list(empty, mikael)).toEqual({
      rows: [],
      systems: [{ id: 'support', source: 'Kundtjänsten', status: 'ok' }],
      unanswered: [],
    });
  });

  test('an answer that is not errand rows is a broken system: nothing of it is shown', async () => {
    const registry = world([
      caseSystem('permits', 'Bygglovssystemet', [row('permits', 1)]),
      // A title would put free text, and possibly a name, in a list the model may be told about.
      caseSystem('support', 'Kundtjänsten', [
        { ...row('support', 1), title: 'Anna Andersson undrar över sin faktura' },
      ]),
      caseSystem('social', 'Verksamhetssystemet', [{ ...row('social', 1), state: 'urgent' }]),
      caseSystem('school', 'Elevsystemet', [{ ...row('school', 1), ref: 'not-an-errand-ref' }]),
    ]);
    const result = await list(registry, mikael);
    expect(JSON.stringify(result)).not.toContain('Anna');
    expect(result.rows.map(r => r.ref)).toEqual(['errand:permits:1']);
    expect(result.unanswered).toEqual(['Kundtjänsten', 'Verksamhetssystemet', 'Elevsystemet']);
  });

  test('a person is only asked about the systems in their scope, and has no list without one', async () => {
    const calls: unknown[] = [];
    const registry = world([
      caseSystem('permits', 'Bygglovssystemet', [row('permits', 1)], { roles: ['manager'], calls }),
    ]);
    expect((await list(registry, hillevi)).rows).toHaveLength(1);
    expect(registry.errandSources(mikael)).toEqual([]);
    expect(registry.allowed(mikael, 'clew.errands')).toBeUndefined();
    await expect(list(registry, mikael)).rejects.toThrow();
    expect(calls).toHaveLength(1);
    expect(world([]).allowed(hillevi, 'clew.errands')).toBeUndefined();
    // The area follows the list: a person without a case system has no "Ärenden" to filter on or start from.
    const areasOf = async (actor: Actor) =>
      (await registry.areas(actor)).map(a => [a.id, a.standing.map(s => s.label)]);
    expect(await areasOf(hillevi)).toEqual([['arenden', ['Mina ärenden']]]);
    expect(await areasOf(mikael)).toEqual([]);
  });

  test('the model is offered the one combined list, and only its view lets a row open in another connector', async () => {
    const registry = world([
      caseSystem('permits', 'Bygglovssystemet', [row('permits', 1)]),
      caseSystem('support', 'Kundtjänsten', [row('support', 1)]),
    ]);
    expect(
      registry
        .tools(mikael)
        .map(t => t.name)
        .filter(name => name.endsWith('.errands')),
    ).toEqual(['clew.errands']);
    expect(registry.viewFor(mikael, 'clew.errands')).toMatchObject({ kind: 'list', connector: 'clew', rowViews: true });
    expect(registry.viewFor(mikael, 'permits.errands')).not.toHaveProperty('rowViews');
  });

  test('the SupportManagement connector is one system among the others, read with the person token', async () => {
    const secret = 'test-secret-test-secret';
    const sm = createSm({
      jwks: testJwks,
      secret,
      source: createFixtureErrands({ now: () => at }),
      now: () => at,
    });
    const connectorFetch: FetchLike = (input, init) => sm.handle(new Request(input, init));
    const registry = world(
      [
        remoteConnector(parseManifest(sm.manifest, 'sm'), {
          url: 'http://sm-connector',
          key: secret,
          assert: assertionFor('sm', secret),
          fetch: connectorFetch,
        }),
        caseSystem('permits', 'Bygglovssystemet', [
          row('permits', 12, { state: 'waiting-on-me', since: ago(9), dueAt: ahead(1) }),
        ]),
      ],
      { perSourceMs: 2000, totalMs: 3000 },
    );
    const token =
      'h.' +
      Buffer.from(
        JSON.stringify({ preferred_username: 'mikael', aud: 'supportmanagement', exp: at / 1000 + 60 }),
      ).toString('base64url') +
      '.s';
    const result = await list(registry, mikael, {}, { delegate: async () => token });
    expect(result.rows.map(r => [r.label, r.state, r.system])).toEqual([
      ['PERMITS-12 · Ansökan', 'waiting-on-me', 'Bygglovssystemet'],
      ['IK-26110007 · Behörighet, Beställning', 'waiting-on-me', 'Ärendesystemet'],
      ['IK-26110011 · Behörighet, Återställning', 'new', 'Ärendesystemet'],
      ['IK-26100031 · Behörighet, Beställning', 'waiting-on-others', 'Ärendesystemet'],
      ['IK-26110004 · Utrustning, Felanmälan', 'waiting-on-others', 'Ärendesystemet'],
    ]);
    expect(result.rows[1]!.view).toEqual({
      capability: 'sm.errand',
      input: { ref: 'errand:sm:0000:IK:a1f0c3d2-0001-4000-8000-000000000001' },
      title: 'Ärende',
      source: 'Ärendesystemet',
    });
    // Without the person's token SupportManagement cannot be asked; the other system still answers and the gap is named.
    const without = await list(registry, mikael);
    expect(without.rows.map(r => r.system)).toEqual(['Bygglovssystemet']);
    expect(without.unanswered).toEqual(['Ärendesystemet']);
  });
});

test('a case system for one provisioned group only is asked for its members, through the nested call, and for nobody else (D68)', async () => {
  const registry = world([
    caseSystem('permits', 'Bygglovssystemet', [row('permits', 1)]),
    caseSystem('support', 'Kundtjänsten', [row('support', 7)]),
  ]);
  registry.govern('support', {
    state: 'enabled',
    audience: { mode: 'selected', groups: ['S-1-5-21-it'] },
    scanEnabled: true,
    toolsEnabled: true,
    capabilities: {},
  });
  // The server hands the registry the person with their groups (audiencedActorOf), and the list's call into each system
  // keeps them.
  const member = audiencedActorOf({ ...mikael, groups: ['S-1-5-21-it'] }),
    outsider = audiencedActorOf({ ...mikael, groups: ['S-1-5-21-annan'] });
  expect((await list(registry, member)).systems.map(s => [s.id, s.status])).toEqual([
    ['permits', 'ok'],
    ['support', 'ok'],
  ]);
  expect((await list(registry, outsider)).systems.map(s => s.id)).toEqual(['permits']);
  // With only the group's system there, the list is not offered outside the group at all.
  registry.govern('permits', { ...registry.governance('support') });
  expect(registry.allowed(member, 'clew.errands')).toBeDefined();
  expect(registry.allowed(outsider, 'clew.errands')).toBeUndefined();
  expect(registry.allowed(mikael, 'clew.errands')).toBeUndefined();
});
