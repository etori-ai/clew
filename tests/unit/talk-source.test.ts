import { describe, expect, test } from 'bun:test';
import { Registry } from '../registry';
import {
  SEARCH_CONNECTOR,
  TALKS_CONNECTOR,
  isCommitmentSource,
  isTalkSource,
  openGovernance,
  type Actor,
  type Capability,
  type Connector,
} from '../../packages/connectors/src/index';

/**
 * One answerer of the talks profile per installation (D96 item 9): the built-in `talks` connector while the person may
 * call it, else the one other connector that declares `<id>.talks`, and none when several do, reported. No read of the
 * domain is ever a model tool (D96 item 6).
 */
const hillevi: Actor = {
  id: 'hillevi',
  name: 'Hillevi Berg',
  unitId: 'unit-it',
  unitLabel: 'IT-enheten',
  role: 'manager',
};
const mikael: Actor = { ...hillevi, id: 'mikael', name: 'Mikael Lind', role: 'employee' };

const read = (name: string): Capability => ({
  name,
  kind: 'read',
  title: 'Läsning',
  description: 'x',
  input: {} as never,
  output: {} as never,
  model: true,
  scope: {},
  run: async () => ({ rows: [] }),
});
/** A connector that declares the talks profile, optionally with the action points, plus an ordinary tool. */
function talkSystem(id: string, source: string, options: { commitments?: boolean; kind?: Connector['kind'] } = {}) {
  return {
    id,
    kind: options.kind ?? 'passthrough',
    source,
    areas: [],
    capabilities: [
      read(id + '.talks'),
      ...(options.commitments === false ? [] : [read(id + '.commitments')]),
      read(id + '.other'),
    ],
  } satisfies Connector;
}
function world(connectors: Connector[]) {
  const refused: Array<{ connectorId: string; topic: string; problem: string }> = [];
  const registry = new Registry({
    onRefused: (connectorId, topic, problem) => refused.push({ connectorId, topic, problem }),
  });
  for (const c of connectors) registry.register(c);
  return { registry, refused };
}

describe('the talks profile', () => {
  test('names the profile reads, never the composites of the core connector', () => {
    expect(isTalkSource(read('appraisals.talks'), 'appraisals')).toBe(true);
    expect(isCommitmentSource(read('appraisals.commitments'), 'appraisals')).toBe(true);
    expect(isTalkSource(read('clew.talks'), SEARCH_CONNECTOR)).toBe(false);
    expect(isCommitmentSource(read('clew.commitments'), SEARCH_CONNECTOR)).toBe(false);
    expect(isTalkSource({ name: 'appraisals.talks', kind: 'propose' }, 'appraisals')).toBe(false);
    expect(isTalkSource(read('appraisals.talks'), 'other')).toBe(false);
  });

  test('the built-in answers when it is present and allowed, over any other system', () => {
    const { registry, refused } = world([
      talkSystem(TALKS_CONNECTOR, 'Clew', { kind: 'core' }),
      talkSystem('appraisals', 'Samtalssystemet'),
      talkSystem('evity', 'Evity'),
    ]);
    expect(registry.talkSource(hillevi)).toEqual({
      builtIn: true,
      connectorId: TALKS_CONNECTOR,
      source: 'Clew',
      talks: 'talks.talks',
      commitments: 'talks.commitments',
    });
    expect(refused).toEqual([]);
  });

  test('one other system answers when the built-in is absent, switched off or out of reach', () => {
    const absent = world([talkSystem('appraisals', 'Samtalssystemet')]).registry;
    expect(absent.talkSource(hillevi)).toEqual({
      builtIn: false,
      connectorId: 'appraisals',
      source: 'Samtalssystemet',
      talks: 'appraisals.talks',
      commitments: 'appraisals.commitments',
    });

    const { registry, refused } = world([
      talkSystem(TALKS_CONNECTOR, 'Clew', { kind: 'core' }),
      talkSystem('appraisals', 'Samtalssystemet', { commitments: false }),
    ]);
    registry.govern(TALKS_CONNECTOR, { ...openGovernance(), state: 'disabled' });
    expect(registry.talkSource(hillevi)).toEqual({
      builtIn: false,
      connectorId: 'appraisals',
      source: 'Samtalssystemet',
      talks: 'appraisals.talks',
    });
    // The built-in's read switched off by an administrator counts as absent too.
    registry.govern(TALKS_CONNECTOR, { ...openGovernance(), capabilities: { 'talks.talks': { enabled: false } } });
    expect(registry.talkSource(hillevi)?.connectorId).toBe('appraisals');
    // A built-in whose audience leaves the person out does not answer for them.
    registry.govern(TALKS_CONNECTOR, { ...openGovernance(), audience: { mode: 'selected', roles: ['employee'] } });
    expect(registry.talkSource(hillevi)?.connectorId).toBe('appraisals');
    expect(registry.talkSource(mikael)?.connectorId).toBe(TALKS_CONNECTOR);
    expect(refused).toEqual([]);
  });

  test('two other systems with the built-in off means none answers, and the registry reports it', () => {
    const { registry, refused } = world([
      talkSystem(TALKS_CONNECTOR, 'Clew', { kind: 'core' }),
      talkSystem('evity', 'Evity'),
      talkSystem('appraisals', 'Samtalssystemet'),
    ]);
    registry.govern(TALKS_CONNECTOR, { ...openGovernance(), state: 'disabled' });
    expect(registry.talkSource(hillevi)).toBeUndefined();
    expect(refused.map(r => [r.connectorId, r.topic])).toEqual([
      ['appraisals', 'talks'],
      ['evity', 'talks'],
    ]);
    expect(refused[0]!.problem).toContain('appraisals, evity');
    // Once one is out of the person's reach, the other answers.
    registry.govern('evity', { ...openGovernance(), audience: { mode: 'selected', units: ['unit-hr'] } });
    expect(registry.talkSource(hillevi)?.connectorId).toBe('appraisals');
  });

  test('a person outside a connector audience does not get it', () => {
    const { registry, refused } = world([talkSystem('appraisals', 'Samtalssystemet')]);
    registry.govern('appraisals', { ...openGovernance(), audience: { mode: 'selected', roles: ['manager'] } });
    expect(registry.talkSource(hillevi)?.connectorId).toBe('appraisals');
    expect(registry.talkSource(mikael)).toBeUndefined();
    // A commitments read the person may not call is left out of the answer.
    registry.govern('appraisals', {
      ...openGovernance(),
      capabilities: { 'appraisals.commitments': { enabled: false } },
    });
    expect(registry.talkSource(mikael)?.commitments).toBeUndefined();
    expect(refused).toEqual([]);
  });

  test('no read of the domain is ever a model tool, with or without the composites', () => {
    const { registry } = world([
      talkSystem(TALKS_CONNECTOR, 'Clew', { kind: 'core' }),
      talkSystem('appraisals', 'Samtalssystemet'),
    ]);
    const names = () => registry.tools(hillevi).map(t => t.name);
    expect(names()).toEqual(expect.arrayContaining(['talks.other', 'appraisals.other']));
    expect(names()).not.toContain('talks.talks');
    expect(names()).not.toContain('talks.commitments');
    expect(names()).not.toContain('appraisals.talks');
    expect(names()).not.toContain('appraisals.commitments');
    registry.register({
      id: SEARCH_CONNECTOR,
      kind: 'core',
      source: 'Clew',
      areas: [],
      capabilities: [read('clew.talks'), read('clew.commitments'), read('clew.other')],
    });
    expect(names()).toContain('clew.other');
    expect(names()).not.toContain('clew.talks');
    expect(names()).not.toContain('clew.commitments');
  });
});
