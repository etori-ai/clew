import { describe, expect, test } from 'bun:test';
import type { AuthenticatedContext, SiteHeaderView } from '../../packages/contracts/src/index';
import {
  CapabilityError,
  Registry,
  openGovernance,
  type Actor,
  type Governance,
} from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { manifestProblems, parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import {
  createConnector,
  headerFor,
  loadMenu,
  manifest as intranetManifest,
} from '../../connectors/intranet/connector.mjs';
import {
  DEFAULT_HEADER,
  HEADER_FRESH_MS,
  HEADER_STALE_MS,
  siteHeaders,
} from '../../apps/server/src/connectors/usecases/header';
import { assertionFor, testJwks } from '../connector-authority';

/**
 * The intranet connector and the header capability (D88): a manifest's `header` names the read that answers the shared
 * header, Clew checks the answer's shape, the person's audience and the connector's switch decide who gets it, and the
 * first registered connector wins when two declare one. Run over the protocol against the fixture.
 */
const secret = 'test-secret-test-secret';
const hassan: Actor = {
  id: 'hassan',
  name: 'Hassan Ali',
  unitId: 'unit-skola',
  unitLabel: 'Bergsåkers skola',
  role: 'employee',
};
const hillevi: Actor = {
  id: 'hillevi',
  name: 'Hillevi Berg',
  unitId: 'unit-skola',
  unitLabel: 'Bergsåkers skola',
  role: 'manager',
};
const CALENDAR = { id: 'kalender', label: 'Kalender', href: '/calendar' };
const PORTAL = { site: { name: 'Portalen', href: '/' }, items: [{ id: 'start', label: 'Start', href: '/' }] };

function stack(refused: string[] = []) {
  const service = createConnector({ jwks: testJwks, secret });
  const connectorFetch: FetchLike = (input, init) => service.handle(new Request(input, init));
  const registry = new Registry({ onRefused: (id, topic, problem) => refused.push(`${id} ${topic}: ${problem}`) });
  registry.register(
    remoteConnector(parseManifest(intranetManifest, 'intranet'), {
      url: 'http://intranet',
      key: secret,
      assert: assertionFor('intranet', secret),
      fetch: connectorFetch,
    }),
  );
  // The suite's installation chose the intranet as the header's holder (D88).
  registry.govern('intranet', { ...openGovernance(), header: true });
  return { registry, connectorFetch };
}
type Registered = Parameters<Registry['register']>[0];
type Schema = Registered['capabilities'][number]['input'];
/** A second header connector, in process, answering what the test says. */
const answering = (id: string, ordinal: number, answer: unknown): Registered => ({
  id,
  kind: 'passthrough',
  source: id,
  areas: [],
  header: `${id}.header`,
  capabilities: [
    {
      name: `${id}.header`,
      kind: 'read',
      title: 'Sidhuvud',
      description: 'Sidhuvud',
      input: { type: 'object', properties: {}, additionalProperties: false } as unknown as Schema,
      output: { type: 'object' } as unknown as Schema,
      model: false,
      scope: {},
      run: async () => answer,
    },
  ],
  uses: [],
});

describe('the intranet connector and the shared header (D88)', () => {
  test('the manifest declares its header read, and the rule refuses a header that is not a read without input', () => {
    const manifest = parseManifest(intranetManifest, 'intranet');
    expect(manifest.header).toEqual({ capability: 'intranet.header' });
    expect(manifest.capabilities.map(c => [c.name, c.kind])).toEqual([['intranet.header', 'read']]);
    expect(manifestProblems({ ...intranetManifest, header: { capability: 'intranet.nope' } })).toEqual([
      'Header names unknown capability intranet.nope (D88).',
    ]);
    const needsInput = {
      ...intranetManifest.capabilities[0],
      input: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'], additionalProperties: false },
    };
    expect(manifestProblems({ ...intranetManifest, capabilities: [needsInput] })).toEqual([
      'Header capability intranet.header must take no input (D88).',
    ]);
  });
  test('a signed-in person gets the header their role may see, as data, through the registry', async () => {
    const { registry } = stack();
    const employee = await registry.header(hassan);
    if (employee.status !== 'answered') throw new Error(`the header was ${employee.status}`);
    expect(employee.connector.id).toBe('intranet');
    expect(employee.output.site).toEqual({ name: 'Startsidan', href: '/' });
    expect(employee.output.items.map(i => i.id)).toEqual([
      'start',
      'anstallning-arbetsmiljo',
      'ekonomi-styrning',
      'kompetensforsorjning',
      'organisation',
    ]);
    expect(employee.output.items[0]!.children).toContainEqual(CALENDAR);
    // The same four sections the stand-in's tree lists for a signed-in visitor, so both sites read the same; the logo is the file's.
    expect(await registry.header(hillevi)).toMatchObject({
      status: 'answered',
      output: { items: employee.output.items },
    });
    expect(employee.output.logo).toEqual({ src: '/branding/sundsvall-dragon-white.png', alt: 'Sundsvalls kommun' });
    expect(headerFor(hassan).items.map(i => i.href)).toContain('/intranat/organisation');
    // The menu is a file: a place or a page with `roles` is listed to those roles only, and `roles` never leaves the connector.
    const menu = loadMenu();
    const restricted = {
      ...menu,
      items: [...menu.items, { id: 'chefsstod', label: 'Chefsstöd', href: '/intranat/chefsstod', roles: ['manager'] }],
    };
    expect(headerFor(hassan, restricted).items.map(i => i.id)).not.toContain('chefsstod');
    expect(headerFor(hillevi, restricted).items.at(-1)).toEqual({
      id: 'chefsstod',
      label: 'Chefsstöd',
      href: '/intranat/chefsstod',
    });
  });
  test('only the connector an administrator chose gives the header; off, outside its audience or out of shape means the default, never another connector', async () => {
    const refused: string[] = [];
    const { registry } = stack(refused);
    // A candidate is not a holder: declaring `header` gives nothing until an administrator chooses it.
    registry.govern('intranet', { ...openGovernance(), header: false });
    expect(await registry.header(hassan)).toEqual({ status: 'refused' });
    registry.govern('intranet', { ...openGovernance(), header: true });
    expect(await registry.header(hassan)).toMatchObject({ status: 'answered', connector: { id: 'intranet' } });
    registry.govern('intranet', { ...openGovernance(), header: true, state: 'disabled' });
    expect(await registry.header(hassan)).toEqual({ status: 'refused' });
    registry.govern('intranet', {
      ...openGovernance(),
      header: true,
      audience: { mode: 'selected', roles: ['manager'] },
    });
    expect(await registry.header(hassan)).toEqual({ status: 'refused' });
    expect(await registry.header(hillevi)).toMatchObject({ status: 'answered', connector: { id: 'intranet' } });
    // The holder answers out of shape: a failure, reported, and no other connector is asked, however many declare one.
    registry.register(answering('broken', 0, { site: { name: 'x' } }));
    registry.register(
      answering('other', 0, { site: { name: 'Annan', href: '/' }, items: [{ id: 'a', label: 'A', href: '/a' }] }),
    );
    registry.govern('broken', { ...openGovernance(), header: true });
    registry.govern('other', openGovernance());
    registry.govern('intranet', openGovernance());
    expect(await registry.header(hassan)).toMatchObject({ status: 'failed', connector: { id: 'broken' } });
    expect(refused).toEqual([expect.stringMatching(/^broken header: answer is not a SiteHeaderOutput/)]);
    registry.govern('broken', openGovernance());
    registry.govern('other', { ...openGovernance(), header: true });
    expect(await registry.header(hassan)).toMatchObject({ status: 'answered', output: { site: { name: 'Annan' } } });
  });
  test('a refusal is told from a failure: no header for the person is refused, the holder they may have failing is failed', async () => {
    let mode: 'answer' | 'throw' | 'hide' | 'move' = 'answer';
    let asked = 0;
    const registry = new Registry();
    const holder = answering('portal', 0, null);
    registry.register({
      ...holder,
      capabilities: [
        {
          ...holder.capabilities[0]!,
          run: async () => {
            asked++;
            if (mode === 'throw') throw new CapabilityError('Portalen svarar inte just nu.');
            // Switched off while it answers: the registry refuses what it gave.
            if (mode === 'hide') registry.govern('portal', { ...openGovernance(), header: true, state: 'disabled' });
            // Another holder chosen while it answers: what it gave is no longer the person's header.
            if (mode === 'move') {
              registry.govern('portal', openGovernance());
              registry.govern('nyportal', { ...openGovernance(), header: true });
            }
            return PORTAL;
          },
        },
      ],
    });
    // Who gives the person the header is answered without asking the connector.
    expect(await registry.headerHolder(hassan)).toBeUndefined();
    expect(await registry.header(hassan)).toEqual({ status: 'refused' });
    const chosen = { ...openGovernance(), header: true };
    registry.govern('portal', chosen);
    expect((await registry.headerHolder(hassan))?.id).toBe('portal');
    expect(asked).toBe(0);
    expect(await registry.header(hassan)).toMatchObject({
      status: 'answered',
      connector: { id: 'portal' },
      output: PORTAL,
    });
    // Every way the person may not have it is a refusal, told without asking the connector.
    const refusals: Governance[] = [
      { ...chosen, header: false },
      { ...chosen, state: 'disabled' },
      { ...chosen, audience: { mode: 'selected', roles: ['manager'] } },
      { ...chosen, capabilities: { 'portal.header': { enabled: false } } },
    ];
    for (const governance of refusals) {
      registry.govern('portal', governance);
      expect(await registry.headerHolder(hassan)).toBeUndefined();
      expect(await registry.header(hassan)).toEqual({ status: 'refused' });
    }
    // A header capability outside the person's scope is refused to them and answered to a manager.
    const managers = answering('chefsportal', 0, PORTAL);
    registry.register({ ...managers, capabilities: [{ ...managers.capabilities[0]!, scope: { roles: ['manager'] } }] });
    registry.govern('portal', openGovernance());
    registry.govern('chefsportal', chosen);
    expect(await registry.header(hassan)).toEqual({ status: 'refused' });
    expect(await registry.header(hillevi)).toMatchObject({ status: 'answered', connector: { id: 'chefsportal' } });
    registry.govern('chefsportal', openGovernance());
    expect(asked).toBe(1);
    // The holder the person may have throws: a failure, not a refusal. Switched off while it answers: a refusal.
    registry.govern('portal', chosen);
    mode = 'throw';
    expect(await registry.header(hassan)).toMatchObject({ status: 'failed', connector: { id: 'portal' } });
    mode = 'hide';
    expect(await registry.header(hassan)).toEqual({ status: 'refused' });
    registry.register(answering('nyportal', 0, PORTAL));
    registry.govern('portal', chosen);
    mode = 'move';
    expect(await registry.header(hassan)).toEqual({ status: 'refused' });
    expect(await registry.header(hassan)).toMatchObject({ status: 'answered', connector: { id: 'nyportal' } });
    // A holder that does not answer within the caller's budget has failed.
    const silent = new Registry();
    silent.register(
      remoteConnector(parseManifest(intranetManifest, 'intranet'), {
        url: 'http://intranet',
        key: secret,
        assert: assertionFor('intranet', secret),
        fetch: (_input, init) =>
          new Promise<Response>((_resolve, reject) =>
            init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)),
          ),
      }),
    );
    silent.govern('intranet', chosen);
    expect(await silent.header(hassan, { signal: AbortSignal.timeout(20) })).toMatchObject({
      status: 'failed',
      connector: { id: 'intranet' },
    });
  });
  test('the conformance check reports the header as a surface, without its words', async () => {
    const { connectorFetch } = stack();
    const report = await checkConnector({
      key: secret,
      url: 'http://intranet',
      id: 'intranet',
      assert: assertionFor('intranet', secret),
      assertForeign: assertionFor('intranet', 'another-secret-entirely'),
      fetch: connectorFetch,
    });
    expect(report.ok).toBe(true);
    const header = report.items.filter(i => i.label === 'Sidhuvud');
    expect(header.map(i => i.level)).toEqual(['ok', 'ok']);
    expect(header.map(i => i.description)).toEqual([
      'Kan ge sidhuvudet: för chef 5 platser och en logotyp.',
      'Kan ge sidhuvudet: för medarbetare 5 platser och en logotyp.',
    ]);
    expect(report.findings.map(f => f.text)).toContain('header as manager: 5 places, a logo');
    expect(JSON.stringify(report)).not.toContain('Kompetensförsörjning');
  });
});

describe('the header a person is served, kept for a minute (D88)', () => {
  const GROUP = 'S-1-5-21-intranat';
  /** Hassan as the server holds him: the whole authenticated context, his provisioned groups included. */
  const signedIn = (groups: string[]): AuthenticatedContext => ({
    ...hassan,
    organisationId: 'sundsvall',
    principal: { id: 'person:hassan', kind: 'person' },
    capabilities: [],
    groups,
    authorizationVersion: 'v1',
    sessionBinding: 'test',
    expiresAt: '2099-01-01T00:00:00.000Z',
    authorize: async () => ({ version: 'v1' }),
  });
  test('a header for one provisioned group stops at once for a person who leaves the group, though the grant is unchanged (D68)', async () => {
    let asked = 0;
    const answer = { site: { name: 'Portalen', href: '/' }, items: [{ id: 'start', label: 'Start', href: '/' }] };
    const holder = answering('portal', 0, answer);
    const registry = new Registry().register({
      ...holder,
      capabilities: [
        {
          ...holder.capabilities[0]!,
          run: async () => {
            asked++;
            return answer;
          },
        },
      ],
    });
    registry.govern('portal', { ...openGovernance(), header: true, audience: { mode: 'selected', groups: [GROUP] } });
    let now = Date.parse('2026-11-12T08:00:00Z');
    const headers = siteHeaders({ registry, clock: () => new Date(now) });

    expect((await headers.read(signedIn([GROUP, 'S-1-5-21-annan']))).source).toEqual({ id: 'portal', label: 'portal' });
    // Kept: the same person a second later, whatever order the groups come in, is not asked for again.
    now += 1000;
    expect((await headers.read(signedIn(['S-1-5-21-annan', GROUP]))).source).toEqual({ id: 'portal', label: 'portal' });
    expect(asked).toBe(1);
    // The provisioner takes him out of the group. His grant and its version stay as they were, yet within the same
    // minute he gets Clew's default, not the header kept for him while he was in the group.
    now += 1000;
    expect(await headers.read(signedIn(['S-1-5-21-annan']))).toEqual(DEFAULT_HEADER);
    expect(asked).toBe(1);
  });

  /**
   * A registry whose holder, `portal`, answers what `state.answer` holds or fails as `state.fail` says, counting the
   * times it is asked, and the header use case over it on a clock the test moves (`at`, from the first read).
   */
  function portal() {
    const state: { asked: number; answer: unknown; fail: boolean; whileAsked?: () => void } = {
      asked: 0,
      answer: PORTAL,
      fail: false,
    };
    const holder = answering('portal', 0, null);
    const registry = new Registry().register({
      ...holder,
      capabilities: [
        {
          ...holder.capabilities[0]!,
          run: async () => {
            state.asked++;
            state.whileAsked?.();
            // A holder that does not answer in time reaches Clew as this same failure (`remote.ts`).
            if (state.fail) throw new CapabilityError('portal svarar inte just nu.');
            return state.answer;
          },
        },
      ],
    });
    registry.govern('portal', { ...openGovernance(), header: true });
    const start = Date.parse('2026-11-13T08:00:00Z');
    let now = start;
    const headers = siteHeaders({ registry, clock: () => new Date(now) });
    return { registry, state, headers, at: (ms: number) => (now = start + ms) };
  }
  /** A refresh started in the background has settled. */
  const settled = () => new Promise(resolve => setTimeout(resolve, 0));
  const VIEW: SiteHeaderView = {
    menu: { version: 1, ...PORTAL },
    logo: null,
    source: { id: 'portal', label: 'portal' },
  };

  test('a holder that fails or answers out of shape leaves the last good header in place, and is asked again at the next refresh', async () => {
    const { state, headers, at } = portal();
    const hassanIn = signedIn([]);
    expect(await headers.read(hassanIn)).toEqual(VIEW);
    // A minute on, the portal is down: the kept header is served while it is asked again, and after it failed.
    at(HEADER_FRESH_MS);
    state.fail = true;
    expect(await headers.read(hassanIn)).toEqual(VIEW);
    await settled();
    expect(state.asked).toBe(2);
    expect(await headers.read(hassanIn)).toEqual(VIEW);
    // It is not asked again until the next refresh, a minute after it failed.
    at(2 * HEADER_FRESH_MS - 1);
    expect(await headers.read(hassanIn)).toEqual(VIEW);
    await settled();
    expect(state.asked).toBe(2);
    // An answer out of shape is a failure too.
    at(2 * HEADER_FRESH_MS);
    state.fail = false;
    state.answer = { site: { name: 'x' } };
    expect(await headers.read(hassanIn)).toEqual(VIEW);
    await settled();
    expect(state.asked).toBe(3);
    expect(await headers.read(hassanIn)).toEqual(VIEW);
    // Back: the next refresh replaces the kept header with the new answer.
    at(3 * HEADER_FRESH_MS);
    const NEWS = { id: 'nyheter', label: 'Nyheter', href: '/nyheter' };
    state.answer = { ...PORTAL, items: [...PORTAL.items, NEWS] };
    expect(await headers.read(hassanIn)).toEqual(VIEW);
    await settled();
    expect((await headers.read(hassanIn)).menu.items).toEqual([...PORTAL.items, NEWS]);
    expect(state.asked).toBe(4);
  });
  test('the last good header is served through failures for an hour after the holder gave it, and then the default', async () => {
    const { state, headers, at } = portal();
    const hassanIn = signedIn([]);
    await headers.read(hassanIn);
    state.fail = true;
    for (const minutes of [1, 30, 59]) {
      at(minutes * 60_000);
      expect(await headers.read(hassanIn)).toEqual(VIEW);
      await settled();
    }
    // An hour after the portal gave it, the kept header goes: the portal is asked at once, fails, and the default stands.
    at(HEADER_STALE_MS);
    const asked = state.asked;
    expect(await headers.read(hassanIn)).toEqual(DEFAULT_HEADER);
    expect(state.asked).toBe(asked + 1);
    // Until the next refresh, a minute later: the portal back, its header is served from the read after that refresh.
    state.fail = false;
    at(HEADER_STALE_MS + HEADER_FRESH_MS - 1);
    expect(await headers.read(hassanIn)).toEqual(DEFAULT_HEADER);
    expect(state.asked).toBe(asked + 1);
    at(HEADER_STALE_MS + HEADER_FRESH_MS);
    expect(await headers.read(hassanIn)).toEqual(DEFAULT_HEADER);
    await settled();
    expect(await headers.read(hassanIn)).toEqual(VIEW);
    expect(state.asked).toBe(asked + 2);
  });
  test('a holder that fails before it gave a header is asked again at the next refresh, not at every page load', async () => {
    const { registry, state, headers, at } = portal();
    registry.register(answering('annan', 0, { ...PORTAL, site: { name: 'Annan', href: '/' } }));
    registry.govern('annan', openGovernance());
    const hassanIn = signedIn([]);
    // The portal down when he signs in: the default, and the portal is not asked again inside the minute.
    state.fail = true;
    expect(await headers.read(hassanIn)).toEqual(DEFAULT_HEADER);
    at(HEADER_FRESH_MS - 1);
    expect(await headers.read(hassanIn)).toEqual(DEFAULT_HEADER);
    expect(state.asked).toBe(1);
    // A minute on it is asked again while the default is served, and still down, the default stands another minute.
    at(HEADER_FRESH_MS);
    expect(await headers.read(hassanIn)).toEqual(DEFAULT_HEADER);
    await settled();
    expect(state.asked).toBe(2);
    at(2 * HEADER_FRESH_MS - 1);
    expect(await headers.read(hassanIn)).toEqual(DEFAULT_HEADER);
    await settled();
    expect(state.asked).toBe(2);
    // Back: the refresh after gives its header.
    state.fail = false;
    at(2 * HEADER_FRESH_MS);
    expect(await headers.read(hassanIn)).toEqual(DEFAULT_HEADER);
    await settled();
    expect(await headers.read(hassanIn)).toEqual(VIEW);
    expect(state.asked).toBe(3);
    // Through a failure, who may have the header still takes effect at once. Down again, the portal switched off as the
    // holder is the default at the next read; chosen again, it is asked at once, fails, and is not asked inside the
    // minute; another holder chosen inside that minute is asked at once, the failure kept for the portal standing for
    // nothing else.
    at(3 * HEADER_FRESH_MS);
    state.fail = true;
    expect(await headers.read(hassanIn)).toEqual(VIEW);
    await settled();
    registry.govern('portal', openGovernance());
    expect(await headers.read(hassanIn)).toEqual(DEFAULT_HEADER);
    registry.govern('portal', { ...openGovernance(), header: true });
    expect(await headers.read(hassanIn)).toEqual(DEFAULT_HEADER);
    expect(state.asked).toBe(5);
    at(3 * HEADER_FRESH_MS + 1000);
    expect(await headers.read(hassanIn)).toEqual(DEFAULT_HEADER);
    expect(state.asked).toBe(5);
    registry.govern('portal', openGovernance());
    registry.govern('annan', { ...openGovernance(), header: true });
    expect((await headers.read(hassanIn)).source).toEqual({ id: 'annan', label: 'annan' });
  });
  test('who may have the header is decided at every read: a change by an administrator takes effect inside the kept minute', async () => {
    const { registry, headers, at } = portal();
    registry.register(answering('annan', 0, { ...PORTAL, site: { name: 'Annan', href: '/' } }));
    registry.govern('annan', openGovernance());
    const hassanIn = signedIn([]);
    const holder = { ...openGovernance(), header: true };
    let second = 0;
    const changes: Governance[] = [
      // The holder switched off as the holder, or the connector switched off.
      { ...holder, header: false },
      { ...holder, state: 'disabled' },
      // Its audience narrowed to leave him out, and its header capability switched off.
      { ...holder, audience: { mode: 'selected', roles: ['manager'] } },
      { ...holder, capabilities: { 'portal.header': { enabled: false } } },
    ];
    for (const governance of changes) {
      registry.govern('portal', holder);
      expect(await headers.read(hassanIn)).toEqual(VIEW);
      at(++second * 1000);
      registry.govern('portal', governance);
      expect(await headers.read(hassanIn)).toEqual(DEFAULT_HEADER);
    }
    // Another connector chosen: its header at the next read, not the one kept from the portal.
    registry.govern('portal', holder);
    expect(await headers.read(hassanIn)).toEqual(VIEW);
    at(++second * 1000);
    registry.govern('portal', openGovernance());
    registry.govern('annan', holder);
    expect((await headers.read(hassanIn)).source).toEqual({ id: 'annan', label: 'annan' });
  });
  test('a refusal while the holder is asked drops the kept header, and a person let in again is asked at the next read', async () => {
    const { registry, state, headers, at } = portal();
    const hassanIn = signedIn([]);
    expect(await headers.read(hassanIn)).toEqual(VIEW);
    // A minute on the portal is asked again, and is switched off while it answers: the registry refuses its answer.
    at(HEADER_FRESH_MS);
    state.whileAsked = () => registry.govern('portal', { ...openGovernance(), header: true, state: 'disabled' });
    expect(await headers.read(hassanIn)).toEqual(VIEW);
    await settled();
    expect(await headers.read(hassanIn)).toEqual(DEFAULT_HEADER);
    // Switched on again a second later, with new content: the portal is asked at once, nothing kept stands in for it.
    state.whileAsked = undefined;
    const NEWS = { id: 'nyheter', label: 'Nyheter', href: '/nyheter' };
    state.answer = { ...PORTAL, items: [...PORTAL.items, NEWS] };
    registry.govern('portal', { ...openGovernance(), header: true });
    at(HEADER_FRESH_MS + 1000);
    expect((await headers.read(hassanIn)).menu.items).toEqual([...PORTAL.items, NEWS]);
    expect(state.asked).toBe(3);
  });
  test('a kept header past the hour can never be served again, so it leaves the process at the next read of anyone', async () => {
    const { headers, at } = portal();
    await headers.read(signedIn([]));
    await headers.read({ ...signedIn([]), id: 'anna' });
    expect(headers.kept()).toBe(2);
    at(HEADER_STALE_MS);
    await headers.read({ ...signedIn([]), id: 'karin' });
    expect(headers.kept()).toBe(1);
  });
});
