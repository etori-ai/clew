import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import { checkContract, type ThreadAction } from '@clew/contracts';
import { ThreadDraftSchema } from '../../packages/connectors/src/protocol';
import type { Actor, Connector, ThreadDraft } from '../../packages/connectors/src/index';
import { createConnector, manifest as communicationManifest } from '../../connectors/communication/connector.mjs';
import { memoryState } from '../../connectors/communication/state.mjs';
import { parseManifest, remoteConnector, type FetchLike } from '../../packages/connectors/src/remote';
import { assertionFor, testJwks } from '../connector-authority';

/**
 * A read receipt on a work item (D112, amended 2026-11-11): a source marks the execute that is the person's
 * acknowledgement that they have read something published, with when it was published, so Hem can lift the item until
 * it is given. The mark is explicit in the draft contract, never read from the reason's words, and the registry refuses
 * a draft that marks it wrongly as it refuses any draft that breaks the action rule (D35).
 */
const hassan: Actor = {
  id: 'hassan',
  name: 'Hassan Ali',
  unitId: 'unit-omsorg',
  unitLabel: 'Hemtjänst Centrum',
  role: 'employee',
};
const refs = {
  type: 'object',
  properties: { refs: { type: 'array', items: { type: 'string' } } },
  required: ['refs'],
} as never;
const notices: Connector = {
  id: 'notices',
  kind: 'passthrough',
  source: 'Kommunikation',
  areas: [{ id: 'important-now', title: 'Viktigt nu', roles: ['manager', 'employee'], standing: [], schedules: [] }],
  capabilities: [
    {
      name: 'notices.acknowledge',
      kind: 'execute',
      title: 'Jag har läst',
      description: 'x',
      input: refs,
      output: {} as never,
      model: false,
      scope: {},
      run: async () => ({ headline: 'Läskvittot är registrerat.', rows: [] }),
    },
    {
      name: 'notices.list',
      kind: 'read',
      title: 'Meddelanden',
      description: 'x',
      input: {} as never,
      output: {} as never,
      model: false,
      scope: {},
      run: async () => ({ rows: [] }),
    },
  ],
};
const ack: ThreadAction = {
  id: 'ack',
  label: 'Jag har läst',
  capability: 'notices.acknowledge',
  kind: 'execute',
  role: 'primary',
  usesItems: true,
  acknowledgement: { publishedAt: '2026-11-10T06:30:00+01:00' },
};
const draft = (actions: ThreadAction[]): ThreadDraft => ({
  topic: 'notices:1',
  area: 'important-now',
  title: 'Ny rutin vid hot och våld',
  summary: 'Läs rutinen och bekräfta att du tagit del av den.',
  reason: 'Publicerat 10 november',
  items: [{ ref: 'notice:1', label: 'Ny rutin vid hot och våld', detail: '', selectable: false, selected: true }],
  actions,
});

describe('a read receipt in a draft', () => {
  const registry = new Registry().register(notices);

  test('an execute marked with when it was published is accepted, on the wire and by the registry', () => {
    expect(checkContract(ThreadDraftSchema, draft([ack]))).toBe(true);
    expect(registry.draftProblem('notices', draft([ack]))).toBeUndefined();
    // Unmarked, the same item is an ordinary work item.
    const { acknowledgement: _mark, ...plain } = ack;
    expect(registry.draftProblem('notices', draft([plain]))).toBeUndefined();
  });

  test('each refusal: a read marked as a receipt, a receipt without its instant, and two receipts on one item', () => {
    const open: ThreadAction = {
      id: 'open',
      label: 'Läs',
      capability: 'notices.list',
      kind: 'read',
      role: 'secondary',
      acknowledgement: { publishedAt: '2026-11-10T06:30:00+01:00' },
    };
    expect(registry.draftProblem('notices', draft([open]))).toBe(
      'action open is marked as a read receipt, which only an execute can be',
    );
    const undated = { ...ack, acknowledgement: { publishedAt: 'i går' } };
    expect(registry.draftProblem('notices', draft([undated]))).toBe(
      'action ack is a read receipt without the instant it was published',
    );
    // The wire refuses the same thing before the registry sees it.
    expect(checkContract(ThreadDraftSchema, draft([undated]))).toBe(false);
    expect(checkContract(ThreadDraftSchema, draft([{ ...ack, acknowledgement: {} as never }]))).toBe(false);
    expect(registry.draftProblem('notices', draft([ack, { ...ack, id: 'ack2' }]))).toBe(
      'more than one action is marked as the read receipt; a work item has one',
    );
  });

  test('a scan whose draft marks a receipt wrongly is refused and reported, and the rest of the scan stands', async () => {
    const refused: Array<[string, string, string]> = [];
    const scanning = new Registry({ onRefused: (id, topic, problem) => refused.push([id, topic, problem]) }).register({
      ...notices,
      scan: async () => [
        draft([ack]),
        { ...draft([{ ...ack, kind: 'read', capability: 'notices.list' }]), topic: 'notices:2' },
      ],
    });
    const drafts = await scanning.scan(hassan);
    expect(drafts.map(d => d.topic)).toEqual(['notices:1']);
    expect(drafts[0]!.actions[0]!.acknowledgement).toEqual({ publishedAt: '2026-11-10T06:30:00+01:00' });
    expect(refused).toEqual([
      ['notices', 'notices:2', 'action ack is marked as a read receipt, which only an execute can be'],
    ]);
  });

  test('the communication fixture marks its "Jag har läst" with when the notice was published', async () => {
    const secret = 'test-secret-test-secret';
    const service = createConnector({
      jwks: testJwks,
      secret,
      state: memoryState(),
      clock: () => new Date('2026-11-04T08:00:00+01:00'),
    });
    const connectorFetch: FetchLike = (input, init) => service.handle(new Request(input, init));
    const fixture = new Registry().register(
      remoteConnector(parseManifest(communicationManifest, 'communication'), {
        url: 'http://communication',
        key: secret,
        assert: assertionFor('communication', secret),
        fetch: connectorFetch,
      }),
    );
    const [pushed] = await fixture.scan(hassan);
    expect(pushed!.actions).toEqual([
      expect.objectContaining({
        id: 'ack',
        kind: 'execute',
        capability: 'communication.acknowledge',
        acknowledgement: { publishedAt: '2026-11-03T06:30:00+01:00' },
      }),
      // The way to the whole notice, a read that leads out of Clew: never the read receipt.
      expect.objectContaining({ id: 'open', kind: 'read', target: 'link', capability: 'communication.open' }),
    ]);
    expect(pushed!.actions[1]).not.toHaveProperty('acknowledgement');
  });
});
