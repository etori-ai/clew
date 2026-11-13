import { Registry } from '../registry';
import { describe, expect, test } from 'bun:test';
import {
  CommitmentsResultSchema,
  TalksResultSchema,
  checkContract,
  type CommitmentRow,
  type CommitmentsResult,
  type TalkRow,
  type TalksResult,
} from '../../packages/contracts/src/index';
import {
  CapabilityError,
  SEARCH_CONNECTOR,
  TALKS_CONNECTOR,
  type Actor,
  type Connector,
} from '../../packages/connectors/src/index';
import {
  builtInId,
  keyIndex,
  mapCommitmentRows,
  mapTalkRows,
  ownedElsewhere,
  takeoverCandidates,
} from '../../apps/server/src/modules/talk-seam/domain';
import { talkSeamCapabilities } from '../../apps/server/src/modules/talk-seam/capabilities';
import { NO_SOURCE, talkSeamUsecases } from '../../apps/server/src/modules/talk-seam/usecases';
import type {
  Directory,
  DirectoryPerson,
  Holders,
  TalkCall,
  Takeovers,
} from '../../apps/server/src/modules/talk-seam/model';
import { personKey as webPersonKey } from '../../apps/web/src/talks';

/**
 * The talks seam (D96 items 8 and 9): `clew.talks` and `clew.commitments` ask the one system that answers the talks
 * profile, check its answer against the shape, keep only rows about people the reader may see and say whether Clew can
 * write. Fake in-process connectors stand in for the built-in module and for an external appraisal system.
 */
const hillevi: Actor = { id: 'p-hillevi', name: 'Hillevi Berg', unitId: 'unit-it', unitLabel: 'IT', role: 'manager' };
const mikael: Actor = { id: 'p-mikael', name: 'Mikael Lind', unitId: 'unit-it', unitLabel: 'IT', role: 'employee' };

const people: Record<string, DirectoryPerson> = {
  hillevi: { id: 'p-hillevi', userName: 'hillevi' },
  mikael: { id: 'p-mikael', userName: 'mikael' },
  // Provisioned without a user name: keyed on the id, as the built-in module answers.
  noname: { id: 'p-noname', userName: null },
  stranger: { id: 'p-stranger', userName: 'stranger' },
};
const staffOf: Record<string, DirectoryPerson[]> = {
  'p-hillevi': [people.mikael!, people.noname!],
  'p-mikael': [],
};
const directory: Directory = async actor => ({
  self: Object.values(people).find(p => p.id === actor.id)!,
  staff: staffOf[actor.id] ?? [],
});

const talk = (system: string, userName: string, over: Partial<TalkRow> = {}): TalkRow => ({
  ref: `talk:${system}:${userName}`,
  userName,
  name: 'Namn ' + userName,
  state: 'missing',
  openCommitments: 0,
  ...over,
});
const commitment = (system: string, n: number, userName: string, over: Partial<CommitmentRow> = {}): CommitmentRow => ({
  ref: `commitment:${system}:c${n}`,
  userName,
  name: 'Namn ' + userName,
  owner: 'employee',
  mine: false,
  text: 'Gå en kurs i tillgänglighet',
  dueOn: '2026-12-15',
  done: false,
  carried: false,
  ...over,
});
const round = { label: 'Utvecklingssamtal 2026', opensOn: '2026-09-01', dueOn: '2026-12-31' };
/** A call handle for the use case called directly; the seam must refuse before it is ever used. */
const refusedCall: TalkCall = async () => {
  throw new Error('the seam called a source it does not have');
};

interface Answers {
  talks?: unknown;
  commitments?: unknown;
  delayMs?: number;
  fail?: string;
  noCommitments?: boolean;
  /** The round is read by managers only, as a system may scope it; the action points stay everyone's. */
  talksForManagers?: boolean;
  calls?: Array<{ name: string; input: unknown }>;
}
/** A system answering the talks profile as an in-process connector; its outputs are open so the seam sees what it sent. */
function talkSystem(id: string, source: string, answers: Answers): Connector {
  const read = (name: string, answer: () => unknown, scope: Connector['capabilities'][number]['scope'] = {}) => ({
    name,
    kind: 'read' as const,
    title: name,
    description: 'x',
    input: {} as never,
    output: {} as never,
    // Even a source that asks to be a tool is not one (D96 item 6).
    model: true,
    scope,
    run: async (_actor: Actor, input: unknown) => {
      answers.calls?.push({ name, input });
      if (answers.delayMs) await new Promise(r => setTimeout(r, answers.delayMs));
      if (answers.fail) throw new CapabilityError(answers.fail);
      return answer();
    },
  });
  return {
    id,
    kind: id === TALKS_CONNECTOR ? 'core' : 'passthrough',
    source,
    areas: [],
    capabilities: [
      read(
        id + '.talks',
        () => answers.talks ?? { round, rows: [] },
        answers.talksForManagers ? { roles: ['manager'] } : {},
      ),
      ...(answers.noCommitments ? [] : [read(id + '.commitments', () => answers.commitments ?? { rows: [] })]),
    ],
  };
}
function world(
  connectors: Connector[],
  onRefused?: (id: string, topic: string) => void,
  takenOver: ReadonlySet<string> = new Set(),
) {
  const registry = new Registry(onRefused ? { onRefused } : {});
  // As the people module answers it (D122): who holds each user name in the organisation, active or not, by the name
  // as asked, compared without regard to case.
  const asked: Array<readonly string[]> = [];
  const holders: Holders = async (_actor, names) => {
    asked.push(names);
    return new Map(
      names.flatMap(name => {
        const holder = Object.values(people).find(
          p => p.userName?.toLowerCase() === name.normalize('NFC').toLowerCase(),
        );
        return holder ? [[name, holder.id] as const] : [];
      }),
    );
  };
  // As the talks module answers it (Q12): which of the asked points the reader may take over.
  const takeoversAsked: Array<readonly string[]> = [];
  const takeovers: Takeovers = async (_actor, ids) => {
    takeoversAsked.push(ids);
    return new Set(ids.filter(id => takenOver.has(id)));
  };
  const seam = talkSeamUsecases({
    source: a => registry.talkSource(a),
    directory,
    holders,
    takeovers,
    budget: { perSourceMs: 40 },
  });
  for (const c of connectors) registry.register(c);
  registry.register({
    id: SEARCH_CONNECTOR,
    kind: 'core',
    source: 'Startsidan',
    areas: [],
    ...talkSeamCapabilities(seam, a => !!registry.talkSource(a)),
    uses: ['*'],
  });
  return { registry, seam, asked, takeoversAsked };
}
const talks = (registry: Registry, actor: Actor) => registry.run<TalksResult>(actor, 'clew.talks', {});
const commitments = (registry: Registry, actor: Actor, input: Record<string, unknown> = {}) =>
  registry.run<CommitmentsResult>(actor, 'clew.commitments', input);

describe('rows keyed on the user name become rows about people the reader may see, in pure code', () => {
  test('a person without a user name is keyed on their id, and a key two people share names neither', () => {
    const index = keyIndex([people.mikael!, people.noname!, { id: 'p-other', userName: 'mikael' }]);
    expect([...index]).toEqual([['p-noname', 'p-noname']]);
  });
  test('talk rows outside the staff are dropped; commitment rows keep the reader and their staff', () => {
    expect(mapTalkRows([talk('x', 'mikael'), talk('x', 'stranger')], [people.mikael!]).map(r => r.personId)).toEqual([
      'p-mikael',
    ]);
    const rows = [commitment('x', 1, 'hillevi'), commitment('x', 2, 'mikael'), commitment('x', 3, 'stranger')];
    expect(mapCommitmentRows(rows, { self: people.hillevi!, staff: [people.mikael!] }).map(r => r.personId)).toEqual([
      'p-hillevi',
      'p-mikael',
    ]);
  });
  test('a key is compared without regard to case and in its composed form, as the protocol says (A3)', () => {
    const anna = { id: 'p-anna', userName: 'Anna.Berg' };
    const rene = { id: 'p-rene', userName: 'rene\u0301' };
    expect([...keyIndex([anna, rene])]).toEqual([
      ['anna.berg', 'p-anna'],
      ['rené', 'p-rene'],
    ]);
    // Two people whose names differ only in case share the key, so it names neither.
    expect([...keyIndex([people.mikael!, { id: 'p-other', userName: 'MIKAEL' }])]).toEqual([]);
    expect(
      mapTalkRows([talk('x', 'ANNA.BERG'), talk('x', 'René'), talk('x', 'anna.berg')], [anna, rene]).map(
        r => r.personId,
      ),
    ).toEqual(['p-anna', 'p-rene', 'p-anna']);
    const rows = [commitment('x', 1, 'anna.BERG'), commitment('x', 2, 'René'), commitment('x', 3, 'Hillevi')];
    expect(mapCommitmentRows(rows, { self: people.hillevi!, staff: [anna, rene] }).map(r => r.personId)).toEqual([
      'p-anna',
      'p-rene',
      'p-hillevi',
    ]);
    // `person` narrows the same way, whatever case the reader asked in.
    expect(
      mapCommitmentRows(rows, { self: people.hillevi!, staff: [anna, rene], person: 'ANNA.berg' }).map(r => r.ref),
    ).toEqual(['commitment:x:c1']);
  });
  test('a point the reader owns about someone outside their staff is named for the built-in module only (M2)', () => {
    const rows = [
      commitment('talks', 1, 'stranger', { owner: 'manager', mine: true }),
      commitment('talks', 2, 'STRANGER', { owner: 'manager', mine: true }),
      commitment('talks', 3, 'stranger'),
      commitment('talks', 4, 'mikael', { owner: 'manager', mine: true }),
      commitment('talks', 5, 'nobody', { owner: 'manager', mine: true }),
    ];
    const mapping = { self: people.hillevi!, staff: [people.mikael!] };
    expect(ownedElsewhere(rows, mapping)).toEqual(['stranger', 'STRANGER', 'nobody']);
    const owned = new Map([
      ['stranger', 'p-stranger'],
      ['STRANGER', 'p-stranger'],
    ]);
    expect(
      mapCommitmentRows(rows, { ...mapping, builtIn: TALKS_CONNECTOR, owned }).map(r => [r.ref, r.personId]),
    ).toEqual([
      ['commitment:talks:c1', 'p-stranger'],
      ['commitment:talks:c2', 'p-stranger'],
      ['commitment:talks:c4', 'p-mikael'],
    ]);
    // Not for another system, whose `mine` is its own, and not when the reader asked about one person.
    expect(mapCommitmentRows(rows, { ...mapping, owned }).map(r => r.ref)).toEqual(['commitment:talks:c4']);
    expect(
      mapCommitmentRows(rows, { ...mapping, builtIn: TALKS_CONNECTOR, owned, person: 'stranger' }).map(r => r.ref),
    ).toEqual([]);
  });
  test("the built-in module's own id comes from its ref, and only from that form", () => {
    expect(builtInId('commitment:talks:abc-1', 'talks')).toBe('abc-1');
    expect(builtInId('commitment:appraisals:abc-1', 'talks')).toBeUndefined();
    expect(builtInId('commitment:talks:' + 'x'.repeat(81), 'talks')).toBeUndefined();
  });
  test('a row carries its own id only when the reader may change it: theirs, or one they may take over (Q12)', () => {
    const rows = [
      commitment('talks', 1, 'mikael', { owner: 'manager', mine: true }),
      commitment('talks', 2, 'mikael', { owner: 'manager' }),
      commitment('talks', 3, 'mikael', { owner: 'manager' }),
      commitment('talks', 4, 'mikael'),
      commitment('elsewhere', 5, 'mikael', { owner: 'manager' }),
    ];
    // Only another manager's points are asked about; the reader's own and the employee's are not.
    expect(takeoverCandidates(rows, TALKS_CONNECTOR)).toEqual(['c2', 'c3']);
    const mapping = { self: people.hillevi!, staff: [people.mikael!], builtIn: TALKS_CONNECTOR };
    expect(mapCommitmentRows(rows, { ...mapping, takeovers: new Set(['c3']) }).map(r => [r.ref, r.id ?? null])).toEqual(
      [
        ['commitment:talks:c1', 'c1'],
        ['commitment:talks:c2', null],
        ['commitment:talks:c3', 'c3'],
        ['commitment:talks:c4', null],
      ],
    );
  });
});

describe('clew.talks and clew.commitments', () => {
  test('the built-in module answers: writable, its label as the source, the reader’s own action points with their own id', async () => {
    const { registry, takeoversAsked } = world([
      talkSystem(TALKS_CONNECTOR, 'Clew', {
        talks: { round, rows: [talk('talks', 'mikael', { state: 'held', at: '2026-10-01' })], bookedUnknown: true },
        commitments: {
          rows: [
            commitment('talks', 1, 'mikael', { owner: 'manager', mine: true }),
            commitment('talks', 2, 'p-noname', { owner: 'manager', mine: true }),
            commitment('talks', 3, 'mikael'),
          ],
        },
      }),
    ]);
    const read = await talks(registry, hillevi);
    expect(read).toMatchObject({ round, writable: true, source: 'Clew', bookedUnknown: true });
    expect(read.rows).toEqual([
      { ...talk('talks', 'mikael', { state: 'held', at: '2026-10-01' }), personId: 'p-mikael' },
    ]);
    expect(checkContract(TalksResultSchema, read)).toBe(true);
    const points = await commitments(registry, hillevi);
    expect(points).toMatchObject({ writable: true, source: 'Clew' });
    // The employee's own point is theirs to tick off: listed, without the id the write routes take.
    expect(points.rows.map(r => [r.id ?? null, r.personId])).toEqual([
      ['c1', 'p-mikael'],
      ['c2', 'p-noname'],
      [null, 'p-mikael'],
    ]);
    expect(checkContract(CommitmentsResultSchema, points)).toBe(true);
    // The reader's own list holds no one else's point they could take over, so nobody is asked.
    expect(takeoversAsked).toEqual([]);
  });

  test('a manager reading one person’s points gets the id of a former manager’s point they may take over, and of no other (Q12)', async () => {
    const { registry, takeoversAsked } = world(
      [
        talkSystem(TALKS_CONNECTOR, 'Clew', {
          commitments: {
            rows: [
              commitment('talks', 1, 'mikael', { owner: 'manager', mine: true }),
              commitment('talks', 2, 'mikael', { owner: 'manager' }),
              commitment('talks', 3, 'mikael', { owner: 'manager' }),
              commitment('talks', 4, 'mikael'),
            ],
          },
        }),
      ],
      undefined,
      new Set(['c3']),
    );
    const points = await commitments(registry, hillevi, { person: 'mikael' });
    expect(points.rows.map(r => [r.ref, r.id ?? null])).toEqual([
      ['commitment:talks:c1', 'c1'],
      ['commitment:talks:c2', null],
      ['commitment:talks:c3', 'c3'],
      ['commitment:talks:c4', null],
    ]);
    expect(checkContract(CommitmentsResultSchema, points)).toBe(true);
    // Asked once, about the other managers' points only.
    expect(takeoversAsked).toEqual([['c2', 'c3']]);
  });

  test('another system’s points carry no id and nobody is asked about a takeover', async () => {
    const { registry, takeoversAsked } = world(
      [
        talkSystem('appraisals', 'Samtalssystemet', {
          commitments: { rows: [commitment('appraisals', 1, 'mikael', { owner: 'manager' })] },
        }),
      ],
      undefined,
      new Set(['c1']),
    );
    const points = await commitments(registry, hillevi, { person: 'mikael' });
    expect(points.rows.map(r => 'id' in r)).toEqual([false]);
    expect(takeoversAsked).toEqual([]);
  });

  test('a built-in action point whose ref is not its own form is dropped', async () => {
    const { registry } = world([
      talkSystem(TALKS_CONNECTOR, 'Clew', {
        commitments: { rows: [commitment('talks', 1, 'mikael'), commitment('elsewhere', 2, 'mikael')] },
      }),
    ]);
    expect((await commitments(registry, hillevi)).rows.map(r => r.ref)).toEqual(['commitment:talks:c1']);
  });

  test('an external system answers when the built-in is absent: read-only, links kept, no id', async () => {
    const link = 'https://samtal.example.se/talk/1';
    const { registry } = world([
      talkSystem('appraisals', 'Samtalssystemet', {
        talks: { round: null, rows: [talk('appraisals', 'mikael', { link })] },
        commitments: { rows: [commitment('appraisals', 1, 'mikael', { link: link + '/c1' })] },
      }),
    ]);
    const read = await talks(registry, hillevi);
    expect(read).toMatchObject({ round: null, writable: false, source: 'Samtalssystemet' });
    expect(read.rows[0]).toMatchObject({ link, personId: 'p-mikael' });
    expect('bookedUnknown' in read).toBe(false);
    expect(checkContract(TalksResultSchema, read)).toBe(true);
    const points = await commitments(registry, hillevi);
    expect(points.writable).toBe(false);
    expect(points.rows[0]).toMatchObject({ link: link + '/c1', personId: 'p-mikael' });
    expect('id' in points.rows[0]!).toBe(false);
    expect(checkContract(CommitmentsResultSchema, points)).toBe(true);
  });

  test('a source without a commitments read lists none and is read-only', async () => {
    const { registry } = world([talkSystem('appraisals', 'Samtalssystemet', { noCommitments: true })]);
    expect(await commitments(registry, hillevi)).toEqual({ rows: [], writable: false, source: 'Samtalssystemet' });
  });

  test('the built-in answers over an external system that declares the profile too', async () => {
    const { registry } = world([
      talkSystem('appraisals', 'Samtalssystemet', {}),
      talkSystem(TALKS_CONNECTOR, 'Clew', {}),
    ]);
    expect(await talks(registry, hillevi)).toMatchObject({ writable: true, source: 'Clew' });
  });

  for (const [what, answers] of [
    ['an out-of-shape answer', { talks: { round, rows: [{ userName: 'mikael' }] }, commitments: { rows: [{}] } }],
    ['a throw', { fail: 'Hemligt fel i Samtalssystemet: tabellen saknas' }],
    ['a timeout', { delayMs: 120 }],
  ] as const)
    test(`${what} is the same Swedish sentence, never the source's own words`, async () => {
      const { registry } = world([talkSystem('appraisals', 'Samtalssystemet', answers)]);
      for (const read of [talks(registry, hillevi), commitments(registry, hillevi)]) {
        const error = await read.then(
          () => undefined,
          (e: unknown) => e,
        );
        expect(error).toBeInstanceOf(CapabilityError);
        expect((error as Error).message).toBe('Samtalssystemet svarade inte som väntat.');
        // The source's failure, as a connector calling back is told (503 unavailable), never a refusal of its input.
        expect((error as CapabilityError).code).toBe('unavailable');
        expect((error as Error).message).not.toContain('Hemligt');
      }
    });

  test('rows about anyone outside the reader’s staff are dropped; a person without a user name is matched on their id', async () => {
    const { registry } = world([
      talkSystem('appraisals', 'Samtalssystemet', {
        talks: {
          round,
          rows: [talk('appraisals', 'mikael'), talk('appraisals', 'p-noname'), talk('appraisals', 'stranger')],
        },
      }),
    ]);
    expect((await talks(registry, hillevi)).rows.map(r => r.personId)).toEqual(['p-mikael', 'p-noname']);
    // An employee manages nobody: the round, and no row about anyone.
    expect((await talks(registry, mikael)).rows).toEqual([]);
  });

  test('an employee gets their own action points and no one else’s', async () => {
    const { registry } = world([
      talkSystem('appraisals', 'Samtalssystemet', {
        commitments: {
          rows: [
            commitment('appraisals', 1, 'mikael', { mine: true }),
            commitment('appraisals', 2, 'p-noname'),
            commitment('appraisals', 3, 'stranger'),
          ],
        },
      }),
    ]);
    const points = await commitments(registry, mikael);
    expect(points.rows.map(r => [r.ref, r.personId])).toEqual([['commitment:appraisals:c1', 'p-mikael']]);
    // Hillevi manages both Mikael and the person without a user name, never the stranger.
    const manager = await commitments(registry, hillevi);
    expect(manager.rows.map(r => r.personId)).toEqual(['p-mikael', 'p-noname']);
  });

  test('an employee whose source keeps the round for managers gets their own action points and no round', async () => {
    for (const [id, source, writable] of [
      ['appraisals', 'Samtalssystemet', false],
      [TALKS_CONNECTOR, 'Clew', true],
    ] as const) {
      const calls: Array<{ name: string; input: unknown }> = [];
      const { registry } = world([
        talkSystem(id, source, {
          calls,
          talksForManagers: true,
          talks: { round, rows: [talk(id, 'mikael')] },
          commitments: { rows: [commitment(id, 1, 'mikael', { mine: true }), commitment(id, 2, 'stranger')] },
        }),
      ]);
      const points = await commitments(registry, mikael);
      expect(points).toMatchObject({ writable, source });
      expect(points.rows.map(r => [r.ref, r.personId])).toEqual([[`commitment:${id}:c1`, 'p-mikael']]);
      expect(await talks(registry, mikael)).toEqual({ round: null, rows: [], writable, source });
      expect(calls).toEqual([{ name: id + '.commitments', input: {} }]);
      // The manager reads both.
      expect((await talks(registry, hillevi)).round).toEqual(round);
    }
  });

  test('a source that writes a user name in another case keeps its rows (A3)', async () => {
    const { registry } = world([
      talkSystem('appraisals', 'Samtalssystemet', {
        talks: { round, rows: [talk('appraisals', 'MIKAEL'), talk('appraisals', 'Stranger')] },
        commitments: {
          rows: [
            commitment('appraisals', 1, 'Mikael'),
            commitment('appraisals', 2, 'HILLEVI', { owner: 'manager', mine: true }),
          ],
        },
      }),
    ]);
    expect((await talks(registry, hillevi)).rows.map(r => [r.userName, r.personId])).toEqual([['MIKAEL', 'p-mikael']]);
    expect((await commitments(registry, hillevi)).rows.map(r => r.personId)).toEqual(['p-mikael', 'p-hillevi']);
    expect((await commitments(registry, hillevi, { person: 'mikael' })).rows.map(r => r.ref)).toEqual([
      'commitment:appraisals:c1',
    ]);
    expect((await commitments(registry, mikael)).rows.map(r => r.ref)).toEqual(['commitment:appraisals:c1']);
  });

  test('with the built-in module, a former manager keeps the points they own about someone they no longer manage (M2)', async () => {
    const { registry, asked } = world([
      talkSystem(TALKS_CONNECTOR, 'Clew', {
        commitments: {
          rows: [
            commitment('talks', 1, 'stranger', { owner: 'manager', mine: true }),
            commitment('talks', 2, 'mikael', { owner: 'manager', mine: true }),
            commitment('talks', 3, 'nobody', { owner: 'manager', mine: true }),
          ],
        },
      }),
    ]);
    const points = await commitments(registry, hillevi);
    expect(checkContract(CommitmentsResultSchema, points)).toBe(true);
    expect(points.rows.map(r => [r.id, r.personId, r.mine])).toEqual([
      ['c1', 'p-stranger', true],
      ['c2', 'p-mikael', true],
    ]);
    // Only the keys outside the reader's staff are asked about, once.
    expect(asked).toEqual([['stranger', 'nobody']]);
    // Asked about one person, nothing else is looked up.
    await commitments(registry, hillevi, { person: 'mikael' });
    expect(asked).toHaveLength(1);
  });

  test('another system’s points about someone outside the reader’s staff are dropped, mine or not, and nobody is looked up (M2)', async () => {
    const { registry, asked } = world([
      talkSystem('appraisals', 'Samtalssystemet', {
        commitments: { rows: [commitment('appraisals', 1, 'stranger', { owner: 'manager', mine: true })] },
      }),
    ]);
    expect((await commitments(registry, hillevi)).rows).toEqual([]);
    expect(asked).toEqual([]);
  });

  test('person narrows clew.commitments and is passed to the source unchanged', async () => {
    const calls: Array<{ name: string; input: unknown }> = [];
    const { registry } = world([
      talkSystem('appraisals', 'Samtalssystemet', {
        calls,
        commitments: {
          rows: [
            commitment('appraisals', 1, 'mikael'),
            commitment('appraisals', 2, 'p-noname'),
            commitment('appraisals', 3, 'hillevi', { owner: 'manager', mine: true }),
          ],
        },
      }),
    ]);
    const points = await commitments(registry, hillevi, { person: 'mikael' });
    expect(points.rows.map(r => r.ref)).toEqual(['commitment:appraisals:c1']);
    expect(calls).toEqual([{ name: 'appraisals.commitments', input: { person: 'mikael' } }]);
  });

  test('a person without a user name is asked about by their Clew id, the talks profile’s one exception to the user name on the wire (D96 As built item 8, D122 item 6)', async () => {
    const calls: Array<{ name: string; input: unknown }> = [];
    const { registry } = world([
      talkSystem('appraisals', 'Samtalssystemet', {
        calls,
        commitments: { rows: [commitment('appraisals', 1, 'mikael'), commitment('appraisals', 2, 'p-noname')] },
      }),
    ]);
    // The talk's drawer on Personal asks with the key the web gives the person: the user name, else the id.
    const points = await commitments(registry, hillevi, { person: webPersonKey(people.noname!) });
    expect(calls).toEqual([{ name: 'appraisals.commitments', input: { person: 'p-noname' } }]);
    expect(points.rows.map(r => [r.ref, r.personId])).toEqual([['commitment:appraisals:c2', 'p-noname']]);
  });

  test('no source: neither read is offered and the use case refuses', async () => {
    const { registry, seam } = world([]);
    await expect(talks(registry, hillevi)).rejects.toThrow(CapabilityError);
    await expect(commitments(registry, hillevi)).rejects.toThrow(CapabilityError);
    const call = refusedCall;
    await expect(seam.talks(hillevi, {}, call)).rejects.toThrow(NO_SOURCE);
    await expect(seam.commitments(hillevi, {}, call)).rejects.toThrow(NO_SOURCE);
    // No system to ask is a source that cannot be reached, as a connector calling back is told (503 unavailable).
    await expect(seam.talks(hillevi, {}, call)).rejects.toMatchObject({ code: 'unavailable' });
  });

  test('two external systems and no built-in: none answers, and the registry reports both', async () => {
    const refused: string[] = [];
    const { registry, seam } = world(
      [talkSystem('appraisals', 'Samtalssystemet', {}), talkSystem('reviews', 'Granskningssystemet', {})],
      (id, topic) => refused.push(id + ':' + topic),
    );
    await expect(talks(registry, hillevi)).rejects.toThrow(CapabilityError);
    await expect(seam.talks(hillevi, {}, refusedCall)).rejects.toThrow(NO_SOURCE);
    expect(refused).toContain('appraisals:talks');
    expect(refused).toContain('reviews:talks');
  });

  test('neither composite nor any source of the profile is a model tool', () => {
    const { registry } = world([
      talkSystem(TALKS_CONNECTOR, 'Clew', {}),
      talkSystem('appraisals', 'Samtalssystemet', {}),
    ]);
    for (const actor of [hillevi, mikael]) {
      const names = registry.tools(actor).map(t => t.name);
      for (const name of ['clew.talks', 'clew.commitments', 'talks.talks', 'talks.commitments', 'appraisals.talks'])
        expect(names).not.toContain(name);
    }
  });
});
