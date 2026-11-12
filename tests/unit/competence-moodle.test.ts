import { describe, expect, test } from 'bun:test';
import {
  checkContract,
  HoldingsOutputSchema,
  type AuthenticatedContext,
  type HoldingsOutput,
} from '../../packages/contracts/src/index';
import { openGovernance } from '../../packages/connectors/src/index';
import { parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { createConnector } from '../../connectors/moodle/connector.mjs';
import { createFixtureLearning } from '../../connectors/moodle/learning.mjs';
import { memoryCompetenceStore } from '../../apps/server/src/modules/competence/adapters/memory';
import { competenceUsecases, COPY_ACTOR } from '../../apps/server/src/modules/competence/usecases';
import { DEVELOPMENT_CATALOGUE, DEVELOPMENT_MAPPINGS } from '../../scripts/competence-development';
import { assertionFor, installationAssertionFor, testJwks } from '../connector-authority';
import { Registry } from '../registry';

/**
 * D108 item 9 end to end in process: the competence register's copy, on the memory store, reads the Moodle connector's
 * installation read (D119) through Clew's registry, signed and checked as in the server, over the connector's
 * in-memory stand-in of the development Moodle. The development catalogue and mappings are the scripts' own. What is
 * asserted is what the register makes of it: every account read, the keys Clew does not know counted and nothing of
 * them kept, the badge kept under the platform's own label until it is mapped, and a person's statuses.
 */
const ID = 'moodle';
const secret = 'test-secret-test-secret';
const at = Date.parse('2026-11-12T10:00:00Z');
const ORG = 'poc';
/** The stand-in's people Clew knows; `sara` and `lisa` have accounts on the platform and nobody in Clew. */
const CLEW_PEOPLE = ['hillevi', 'hassan', 'mikael', 'anna', 'erik', 'maria', 'johan', 'karin'];
const persona = (id: string, capabilities: AuthenticatedContext['capabilities'] = []): AuthenticatedContext => ({
  id,
  name: id,
  unitId: 'u1',
  unitLabel: 'Enhet 1',
  role: 'employee',
  organisationId: ORG,
  principal: { id: 'person:' + id, kind: 'person' },
  capabilities,
  authorizationVersion: 'v1',
  sessionBinding: 'test',
  expiresAt: '2099-01-01T00:00:00.000Z',
  authorize: async () => ({ version: 'v1' }),
});

function world() {
  const learning = createFixtureLearning({ now: () => at });
  const service = createConnector({ jwks: testJwks, secret, source: learning, now: () => at });
  const connectorFetch: FetchLike = (input, init) => service.handle(new Request(input, init));
  const registry = new Registry();
  registry.register(
    remoteConnector(parseManifest(service.manifest, ID), {
      url: 'http://moodle-connector',
      key: secret,
      assert: assertionFor(ID, secret),
      installation: installationAssertionFor(ID, secret),
      fetch: connectorFetch,
    }),
  );
  registry.govern(ID, openGovernance());
  const store = memoryCompetenceStore({
    persons: CLEW_PEOPLE.map(p => ({ id: 'p-' + p, organisationId: ORG, name: p, userName: p })),
  });
  let n = 0;
  const competence = competenceUsecases({
    store,
    staff: async () => ({ units: [] }),
    clock: () => new Date(at),
    ids: () => 'id-' + ++n,
    // The binding composition makes: the module's switch, and the registry's own installation read (D119).
    holdings: {
      switchedOn: async () => true,
      holdingsSources: () => registry.holdingsSources(),
      readHoldings: (connectorId, cursor, options) => registry.readHoldings(connectorId, cursor, options),
      // Every audience is everyone here; composition applies the real ones (D23).
      admitted: async (_connectorId, personIds) => new Set(personIds),
      reaches: async () => true,
    },
  });
  return { registry, store, competence, learning };
}
/** Every page of the source as the registry answers it, to count what the copy should have made of it. */
async function sweep(registry: Registry) {
  const pages: HoldingsOutput[] = [];
  let cursor: string | undefined;
  do {
    const page = await registry.readHoldings(ID, cursor);
    expect(checkContract(HoldingsOutputSchema, page)).toBe(true);
    pages.push(page);
    cursor = page.next;
  } while (cursor);
  return pages.flatMap(p => p.rows);
}

describe('the copy of a learning platform through the installation read', () => {
  test('every account is read, unknown keys are counted and dropped, the badge waits for its mapping, and statuses follow', async () => {
    const { registry, store, competence } = world();
    const admin = persona('ada', ['admin.competence']);
    const typeIds = new Map<string, string>();
    for (const type of DEVELOPMENT_CATALOGUE)
      typeIds.set(type.name, await competence.seedType('operator:test', ORG, type));
    for (const [sourceType, name] of DEVELOPMENT_MAPPINGS)
      await competence.seedMapping('operator:test', ORG, ID, { sourceType, typeId: typeIds.get(name)! });

    expect(await competence.copySources()).toEqual([{ connectorId: ID, source: expect.any(String) }]);
    const rows = await sweep(registry);
    const unknown = rows.filter(r => !CLEW_PEOPLE.includes(r.key.toLowerCase()));
    expect(unknown.map(r => r.key).sort()).toEqual(['lisa', 'sara']);
    const read = rows.reduce((n, r) => n + r.holdings.length, 0);
    const ofUnknown = unknown.reduce((n, r) => n + r.holdings.length, 0);
    const kinds = new Set(rows.flatMap(r => r.holdings.map(h => h.kind)));
    expect([...kinds].sort()).toEqual(['badge', 'course']);

    const [result] = await competence.copyAll(COPY_ACTOR, 'run-1');
    const partial = rows.some(r => r.partial);
    expect(result).toMatchObject({
      connectorId: ID,
      outcome: partial ? 'partial' : 'complete',
      unmatched: 2,
      counts: { read, stored: read - ofUnknown, unchanged: 0, invalid: 0, revoked: 0, outside: 0, removed: 0 },
    });
    // The courses without an idnumber and both badges are types nobody mapped.
    const unmappedTypes = new Set(
      rows
        .filter(r => !unknown.includes(r))
        .flatMap(r => r.holdings.map(h => h.type))
        .filter(t => !DEVELOPMENT_MAPPINGS.some(([m]) => m === t)),
    );
    expect(result!.counts!.unmapped).toBe(unmappedTypes.size);
    // Nothing of an account Clew does not know is kept: no row, no key.
    const kept = JSON.stringify([...store.state.holdings.values(), ...store.state.sources.values()]);
    expect(kept).not.toContain('sara');
    expect(kept).not.toContain('lisa');
    // A badge keeps the platform's own label and no catalogue type until an administrator maps it.
    const badges = [...store.state.holdings.values()].filter(h => h.copy?.sourceType.startsWith('badge:'));
    expect(badges.length).toBeGreaterThan(0);
    expect(badges.every(h => h.typeId === null && h.copy!.sourceLabel.length > 0)).toBe(true);

    // Johan reads his own: the mapped courses with their statuses from the catalogue's rules, then his badge, not counted.
    const johan = await competence.holdings(persona('p-johan'));
    expect(johan.rows.length).toBeGreaterThan(0);
    expect(johan.rows.every(r => r.source && r.readAt)).toBe(true);
    expect(johan.rows.filter(r => r.status === 'uncounted').map(r => r.competence)).toEqual(['HLR-instruktör']);
    // Mapped, Johan's badge counts at once with the platform's end date, which ran out 35 days ago.
    await competence.mapSourceType(admin, ID, {
      sourceType: badges.find(b => b.personId === 'p-johan')!.copy!.sourceType,
      typeId: typeIds.get('HLR-instruktör')!,
    });
    const mapped = await competence.holdings(persona('p-johan'));
    expect(mapped.rows.map(r => [r.competence, r.status, r.expiresOn ?? null])).toEqual([
      // By the catalogue's rules counted from the platform's completion days, and the badge by the platform's own end.
      ['Delegering läkemedel', 'expired', '2025-10-13'],
      ['HLR', 'expired', '2025-11-08'],
      ['HLR-instruktör', 'expired', '2026-10-08'],
      ['Brandskydd', 'valid', '2028-12-17'],
      ['Livsmedelshygien', 'valid', null],
    ]);

    // Read again: nothing changes but when it was read.
    const [again] = await competence.copyAll(COPY_ACTOR, 'run-2');
    expect(again).toMatchObject({ unmatched: 2, counts: { read, stored: 0, unchanged: read - ofUnknown } });
  });
});
