import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import type { SearchResult } from '../../packages/contracts/src/index';
import { type Actor } from '../../packages/connectors/src/index';
import { checkConnector } from '../../packages/connectors/src/check';
import { parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createConnector, manifest as telefonbokManifest } from '../../connectors/telefonbok/connector.mjs';
import { createHttpDirectory, toPerson } from '../../connectors/telefonbok/directory.mjs';
import { assertionFor, testJwks } from '../connector-authority';
import { searchConnector } from '../../apps/server/src/modules/search/connector';
import { searchUsecases } from '../../apps/server/src/modules/search/usecases';

/**
 * The phone book connector (D38's worked example): reads only, a search source for people, and declared views for the
 * table, the team list and the contact card. Run over the protocol against the made-up organisation in directory.mjs.
 */
const secret = 'test-secret-test-secret';
const hassan: Actor = {
  id: 'hassan',
  name: 'Hassan Ali',
  unitId: 'unit-skola',
  unitLabel: 'Bergsåkers skola',
  role: 'employee',
};
const karin: Actor = {
  id: 'karin',
  name: 'Karin Holm',
  unitId: 'enhet-17',
  unitLabel: 'Hemtjänst Centrum',
  role: 'manager',
};
type Row = { ref: string; name: string; title: string; unit: string; phone?: string; mobile?: string; email?: string };

function stack(options: Parameters<typeof createConnector>[0] = {}) {
  const service = createConnector({ jwks: testJwks, secret, ...options });
  const connectorFetch: FetchLike = (input, init) => service.handle(new Request(input, init));
  const registry = new Registry();
  registry.register(
    remoteConnector(parseManifest(telefonbokManifest, 'telefonbok'), {
      url: 'http://telefonbok',
      key: secret,
      assert: assertionFor('telefonbok', secret),
      fetch: connectorFetch,
    }),
  );
  registry.register(
    searchConnector(
      searchUsecases({
        sources: actor => registry.searchSources(actor),
        clock: () => new Date('2026-11-05T09:00:00Z'),
      }),
    ),
  );
  return { registry, connectorFetch };
}

describe('the phone book connector', () => {
  test('the manifest is valid, declares its views, and offers no execute and no scan', () => {
    const manifest = parseManifest(telefonbokManifest, 'telefonbok');
    expect(manifest.capabilities.map(c => c.kind)).toEqual(['read', 'read', 'read', 'read', 'read']);
    expect(manifest.scan).toBe(false);
    expect(manifest.capabilities.filter(c => c.view).map(c => [c.name, c.view!.kind])).toEqual([
      ['telefonbok.directory', 'table'],
      ['telefonbok.team', 'list'],
      ['telefonbok.person', 'detail'],
      ['telefonbok.search', 'list'],
    ]);
  });
  test('searches the whole organisation: every word must match, numbers match, and a protected person is never found', async () => {
    const { registry } = stack();
    const all = await registry.run<{ rows: Row[] }>(hassan, 'telefonbok.directory', { query: 'lärare bergsåker' });
    expect(all.rows.map(r => r.name)).toEqual(['Anna Lindqvist', 'Hassan Ali']);
    expect(all.rows[0]).toEqual({
      ref: 'person:p1003',
      name: 'Anna Lindqvist',
      title: 'Lärare',
      unit: 'Bergsåkers skola',
      phone: '0980-319 203',
      email: 'anna.lindqvist@kommun.example',
    });
    expect(
      (await registry.run<{ rows: Row[] }>(hassan, 'telefonbok.directory', { query: '319 241' })).rows.map(r => r.name),
    ).toEqual(['Mikael Ström']);
    const everyone = await registry.run<{ rows: Row[] }>(hassan, 'telefonbok.directory', {});
    expect(everyone.rows).toHaveLength(14);
    expect(JSON.stringify(everyone)).not.toMatch(/Skyddad|Hemvägen|19000101/);
    expect((await registry.run<{ rows: Row[] }>(hassan, 'telefonbok.directory', { query: 'skyddad' })).rows).toEqual(
      [],
    );
  });
  test('"my unit" and the team list follow the unit in Clew\'s assertion, through the unit map where the ids differ', async () => {
    const { registry } = stack({ unitMap: { 'enhet-17': 'unit-omsorg' } });
    const team = await registry.run<{ unit: string; rows: Row[] }>(hassan, 'telefonbok.team', {});
    expect(team.unit).toBe('Bergsåkers skola');
    expect(team.rows.map(r => r.name)).toEqual([
      'Anna Lindqvist',
      'Erik Sandström',
      'Hassan Ali',
      'Hillevi Berg',
      'Maja Nordin',
    ]);
    expect((await registry.run<{ rows: Row[] }>(karin, 'telefonbok.team', {})).rows.map(r => r.name)).toEqual([
      'Jonas Öberg',
      'Karin Holm',
      'Lena Åkesson',
      'Omar Said',
    ]);
    expect(
      (await registry.run<{ rows: Row[] }>(karin, 'telefonbok.directory', { query: 'holm', scope: 'unit' })).rows.map(
        r => r.name,
      ),
    ).toEqual(['Karin Holm']);
    expect(
      (await registry.run<{ rows: Row[] }>(hassan, 'telefonbok.directory', { query: 'holm', scope: 'unit' })).rows,
    ).toEqual([]);
  });
  test('the contact card holds work details and a link out; an unknown or malformed ref is refused in Swedish', async () => {
    const { registry } = stack();
    expect(await registry.run(hassan, 'telefonbok.person', { ref: 'person:p1002' })).toEqual({
      ref: 'person:p1002',
      name: 'Hassan Ali',
      title: 'Lärare',
      unit: 'Bergsåkers skola',
      phone: '0980-319 202',
      mobile: '070-174 06 12',
      email: 'hassan.ali@kommun.example',
      room: 'B204',
      manager: 'Hillevi Berg',
      link: 'https://telefonbok.kommun.example/personer/p1002',
    });
    await expect(registry.run(hassan, 'telefonbok.person', { ref: 'person:p9001' })).rejects.toThrow(
      'Personen finns inte i telefonboken.',
    );
    await expect(registry.run(hassan, 'telefonbok.person', { ref: 'person:../x' })).rejects.toThrow(
      'Ogiltig förfrågan till telefonbok.person.',
    );
  });
  test('is one source of the composite search: a hit says who and where, never the number, and carries the contact card as its view', async () => {
    const { registry } = stack();
    expect(registry.searchSources(hassan)).toEqual([
      {
        name: 'telefonbok.search',
        connectorId: 'telefonbok',
        source: 'Telefonboken',
        kinds: ['person'],
        open: { capability: 'telefonbok.person', title: 'Kontaktkort', params: { ref: 'ref' } },
      },
    ]);
    // The model sees the composite only (D26), and the two tools whose content it is handed as a summary.
    expect(registry.tools(hassan).map(t => t.name)).toEqual(['telefonbok.directory', 'telefonbok.team', 'clew.search']);
    const found = await registry.run<SearchResult>(hassan, 'clew.search', { query: 'Anna Lindqvist' });
    expect(found.rows).toEqual([
      {
        ref: 'person:p1003',
        kind: 'person',
        label: 'Anna Lindqvist',
        snippet: 'Lärare · Bergsåkers skola',
        source: 'Telefonboken',
        link: 'https://telefonbok.kommun.example/personer/p1003',
        stale: null,
        connector: 'telefonbok',
        view: {
          capability: 'telefonbok.person',
          input: { ref: 'person:p1003' },
          title: 'Kontaktkort',
          source: 'Telefonboken',
        },
      },
    ]);
    expect(JSON.stringify(found)).not.toMatch(/0980|070-/);
    // A question about a routine finds no one: the phone book does not add noise to a document search.
    expect((await registry.run<SearchResult>(hassan, 'clew.search', { query: 'hur gör jag vid fall' })).rows).toEqual(
      [],
    );
    expect(await registry.run(hassan, 'clew.fetchSource', { ref: 'telefonbok:person:p1003' })).toMatchObject({
      kind: 'person',
      label: 'Anna Lindqvist',
    });
  });
  test('the browser gets the declaration with the output: whose view it is, what a row opens, and that a row can be chipped', () => {
    const { registry } = stack();
    const view = registry.viewFor(hassan, 'telefonbok.directory')!;
    expect(view).toMatchObject({
      kind: 'table',
      capability: 'telefonbok.directory',
      connector: 'telefonbok',
      source: 'Telefonboken',
      chip: true,
      title: 'name',
      modelReads: 'summary',
      open: { capability: 'telefonbok.person', title: 'Kontaktkort', params: { ref: 'ref' } },
    });
    expect(registry.viewFor(hassan, 'telefonbok.person')).toMatchObject({ kind: 'detail', chip: false });
    expect(registry.viewFor(hassan, 'telefonbok.fetch')).toBeUndefined();
    // Switched off by the administrator, the contact card is no longer something a row opens.
    registry.govern('telefonbok', {
      state: 'enabled',
      audience: { mode: 'all' },
      scanEnabled: true,
      toolsEnabled: true,
      capabilities: { 'telefonbok.person': { enabled: false } },
    });
    expect(registry.viewFor(hassan, 'telefonbok.directory')).not.toHaveProperty('open');
  });
  test('passes the conformance check and refuses another secret', async () => {
    const { connectorFetch } = stack();
    const sign = (key: string) => assertionFor('telefonbok', key);
    const report = await checkConnector({
      key: secret,
      url: 'http://telefonbok',
      id: 'telefonbok',
      assert: sign(secret),
      assertForeign: sign('another-secret-entirely'),
      fetch: connectorFetch,
    });
    expect(report.findings.filter(f => f.level !== 'ok')).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.findings.map(f => f.text)).toContain('telefonbok.directory: view table drawn from "rows", 6 fields');
    // The admin page's check hands in no validator: the reads that need a reference or a question are left uncalled, not failed.
    expect(report.findings.filter(f => /needs input/.test(f.text)).map(f => f.text.split(':')[0])).toEqual([
      'telefonbok.person',
      'telefonbok.search',
      'telefonbok.fetch',
    ]);
  });
  test('the administrator reads one Swedish row per fact, and no answer from the service (D23, D44)', async () => {
    const { connectorFetch } = stack();
    const sign = (key: string) => assertionFor('telefonbok', key);
    const report = await checkConnector({
      key: secret,
      url: 'http://telefonbok',
      id: 'telefonbok',
      assert: sign(secret),
      assertForeign: sign('another-secret-entirely'),
      fetch: connectorFetch,
    });
    expect(report.ok).toBe(true);
    // The log keeps the answers for the person who builds the connector; the rows the page gets do not carry them.
    expect(report.findings.some(f => f.text.includes('Anna Lindqvist'))).toBe(true);
    expect(JSON.stringify(report.items)).not.toContain('Anna Lindqvist');
    expect(report.items.map(i => [i.group, i.label])).toContainEqual(['connection', 'Fel nyckel nekas']);
    const row = (capability: string) => report.items.find(i => i.capability === capability);
    expect(report.items.filter(i => i.group === 'capabilities')).toHaveLength(5);
    expect(row('telefonbok.directory')).toMatchObject({
      level: 'ok',
      description: 'Svarar för chef och medarbetare. Visas som tabell med 6 fält.',
    });
    expect(row('telefonbok.fetch')?.description).toBe('Behöver indata, så kontrollen anropar den inte.');
    expect(row('telefonbok.search')?.description).toBe(
      'Behöver indata, så kontrollen anropar den inte. Vyn (lista) är inte prövad.',
    );
    expect(report.items.find(i => i.label.startsWith('Området'))?.description).toBe(
      'Chef och medarbetare: 2 stående handlingar, inget nyckeltal.',
    );
  });
});

describe('the phone book API behind the port', () => {
  const api: Record<string, unknown> = {
    '/persons?q=anna&limit=50': {
      persons: [
        {
          id: '17',
          givenName: 'Anna',
          familyName: 'Lind',
          title: 'Rektor',
          unit: { id: 'u1', name: 'Skolan' },
          phone: '0980-319 210',
          personalNumber: '19000101-0000',
          homeAddress: 'Hemvägen 1',
        },
        { id: '18', name: 'Dold Person', hidden: true },
      ],
    },
    '/persons/17': {
      id: '17',
      name: 'Anna Lind',
      title: 'Rektor',
      unitId: 'u1',
      unitName: 'Skolan',
      manager: { name: 'Bo Ek' },
    },
  };
  const calls: Array<{ url: string; key: string | null }> = [];
  const fetchApi: FetchLike = async (input, init) => {
    const url = new URL(input);
    calls.push({ url: url.pathname + url.search, key: new Headers(init?.headers).get('x-api-key') });
    const body = api[url.pathname + url.search];
    return body ? Response.json(body) : new Response('', { status: url.pathname === '/persons/500' ? 500 : 404 });
  };
  const directory = createHttpDirectory({ url: 'https://telefonbok.example/', apiKey: 'k', fetch: fetchApi });
  test('maps a record to work details only, drops hidden records, and sends the integration key', async () => {
    expect(await directory.search('anna')).toEqual([
      {
        id: '17',
        name: 'Anna Lind',
        title: 'Rektor',
        unit: 'Skolan',
        unitId: 'u1',
        phone: '0980-319 210',
        link: 'https://telefonbok.example/personer/17',
      },
    ]);
    expect(calls[0]).toEqual({ url: '/persons?q=anna&limit=50', key: 'k' });
    expect(await directory.person('17')).toMatchObject({ name: 'Anna Lind', manager: 'Bo Ek' });
    expect(await directory.person('404')).toBeNull();
    expect(toPerson({ id: '1', name: 'X', protected: true })).toBeNull();
    expect(toPerson({ id: 'a b', name: 'X' })).toBeNull();
  });
  test('an API that fails is "unavailable" in Swedish, without the system\'s own words', async () => {
    const service = createConnector({ jwks: testJwks, secret, directory });
    const registry = new Registry().register(
      remoteConnector(parseManifest(telefonbokManifest, 'telefonbok'), {
        url: 'http://telefonbok',
        key: secret,
        assert: assertionFor('telefonbok', secret),
        fetch: (input, init) => service.handle(new Request(input, init)),
      }),
    );
    await expect(registry.run(hassan, 'telefonbok.person', { ref: 'person:500' })).rejects.toThrow(
      'Telefonboken svarar inte just nu.',
    );
  });
});
