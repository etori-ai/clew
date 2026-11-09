import { describe, expect, test } from 'bun:test';
import { Registry, openGovernance, type Actor } from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { manifestProblems, parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import {
  createConnector,
  headerFor,
  loadMenu,
  manifest as intranetManifest,
} from '../../connectors/intranet/connector.mjs';
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
    expect(employee?.connector.id).toBe('intranet');
    expect(employee?.output.site).toEqual({ name: 'Startsidan', href: '/' });
    expect(employee?.output.items.map(i => i.id)).toEqual([
      'start',
      'anstallning-arbetsmiljo',
      'ekonomi-styrning',
      'kompetensforsorjning',
      'organisation',
    ]);
    expect(employee?.output.items[0]!.children).toContainEqual(CALENDAR);
    // The same four sections the stand-in's tree lists for a signed-in visitor, so both sites read the same; the logo is the file's.
    expect((await registry.header(hillevi))?.output.items).toEqual(employee?.output.items);
    expect(employee?.output.logo).toEqual({ src: '/branding/sundsvall-dragon-white.png', alt: 'Sundsvalls kommun' });
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
    expect(await registry.header(hassan)).toBeNull();
    registry.govern('intranet', { ...openGovernance(), header: true });
    expect((await registry.header(hassan))?.connector.id).toBe('intranet');
    registry.govern('intranet', { ...openGovernance(), header: true, state: 'disabled' });
    expect(await registry.header(hassan)).toBeNull();
    registry.govern('intranet', {
      ...openGovernance(),
      header: true,
      audience: { mode: 'selected', roles: ['manager'] },
    });
    expect(await registry.header(hassan)).toBeNull();
    expect((await registry.header(hillevi))?.connector.id).toBe('intranet');
    // The holder answers out of shape: refused and reported, and no other connector is asked, however many declare one.
    registry.register(answering('broken', 0, { site: { name: 'x' } }));
    registry.register(
      answering('other', 0, { site: { name: 'Annan', href: '/' }, items: [{ id: 'a', label: 'A', href: '/a' }] }),
    );
    registry.govern('broken', { ...openGovernance(), header: true });
    registry.govern('other', openGovernance());
    registry.govern('intranet', openGovernance());
    expect(await registry.header(hassan)).toBeNull();
    expect(refused).toEqual([expect.stringMatching(/^broken header: answer is not a SiteHeaderOutput/)]);
    registry.govern('broken', openGovernance());
    registry.govern('other', { ...openGovernance(), header: true });
    expect((await registry.header(hassan))?.output.site.name).toBe('Annan');
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
