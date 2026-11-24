import { describe, expect, test } from 'bun:test';
import type { Thread } from '@clew/contracts';
import { aboutSomeone, pileOf, workList, workRow } from '../../apps/server/src/modules/work/domain';

const NOW = '2026-11-16T12:00:00.000Z';
const TODAY = '2026-11-16';
/** A work item with only what the pile reads of it. */
const item = (over: Partial<Thread> & { id: string }): Thread =>
  ({
    kind: 'pushed',
    topic: 'x',
    title: 'Ärende ' + over.id,
    state: 'open',
    connector: 'ekonomi',
    area: 'ekonomi',
    summary: 'Tre fakturor väntar på attest.',
    items: [],
    actions: [],
    waitingOn: null,
    deadline: null,
    snoozedUntil: null,
    trigger: { reason: 'Kom', source: 'Ekonomisystemet', at: NOW },
    messages: [],
    proposals: [],
    createdAt: NOW,
    updatedAt: NOW,
    ...over,
  }) as unknown as Thread;

describe('Att göra as a read (clew.work)', () => {
  test('a pile holds the open items that need the person, the most urgent first; what waits on others is the other pile', () => {
    const threads = [
      item({ id: 'utan-dag' }),
      item({ id: 'senare', deadline: '2026-12-01' }),
      item({ id: 'forsenad', deadline: '2026-11-12' }),
      item({ id: 'vantar', waitingOn: 'Ekonomi' }),
      item({ id: 'klar', state: 'handled' }),
      item({ id: 'inte-nu', snoozedUntil: '2026-11-17T06:00:00.000Z' }),
      item({ id: 'samtal', kind: 'question' }),
    ];
    expect(pileOf(threads, 'needs-you', NOW).map(t => t.id)).toEqual(['forsenad', 'senare', 'utan-dag']);
    expect(pileOf(threads, 'waiting', NOW).map(t => t.id)).toEqual(['vantar']);
  });
  test('a row says the title, the system, the state, the last day and whether it has passed, and what the item is about', () => {
    expect(workRow(item({ id: 'a', deadline: '2026-11-12' }), 'needs-you', TODAY)).toEqual({
      ref: 'thread:a',
      label: 'Ärende a',
      system: 'Ekonomisystemet',
      connector: 'ekonomi',
      state: 'Behöver dig',
      deadline: '2026-11-12',
      late: 'försenad',
      fact: 'Tre fakturor väntar på attest.',
    });
    expect(workRow(item({ id: 'b', deadline: '2026-11-16' }), 'needs-you', TODAY).late).toBeUndefined();
    expect(workRow(item({ id: 'c', waitingOn: 'Ekonomi' }), 'waiting', TODAY).state).toBe('Väntar på Ekonomi');
  });
  test('an item about a person or a unit is listed without the source’s sentence about it (D97 item 7, D115)', () => {
    const onCard = item({
      id: 'p',
      summary: 'Tredje korta sjukfrånvaron.',
      subjects: [{ entity: 'person', key: 'anna' }],
    });
    const onRow = item({
      id: 'r',
      summary: 'Tredje korta sjukfrånvaron.',
      items: [
        {
          ref: 'x',
          label: 'Rad',
          detail: '',
          selectable: false,
          selected: false,
          subject: { entity: 'person', key: 'anna' },
        },
      ],
    } as never);
    for (const t of [onCard, onRow]) {
      expect(aboutSomeone(t)).toBe(true);
      expect(workRow(t, 'needs-you', TODAY)).not.toHaveProperty('fact');
      expect(JSON.stringify(workRow(t, 'needs-you', TODAY))).not.toContain('sjukfrånvaron');
    }
  });
  test('a long pile says how many it holds and lists the first fifty', () => {
    const many = Array.from({ length: 60 }, (_, i) => item({ id: String(i).padStart(2, '0') }));
    const list = workList(many, 'needs-you', NOW, TODAY);
    expect(list.pile).toBe('Behöver dig');
    expect(list.total).toBe(60);
    expect(list.rows).toHaveLength(50);
    expect(list).not.toHaveProperty('withheld');
  });
  test('for the model, the items of a system closed to the assistant are left out and counted, never named (D122 item 4)', () => {
    const threads = [
      item({ id: 'ekonomi', deadline: '2026-11-20' }),
      item({ id: 'hr-1', connector: 'hr', title: 'Sjukanmälan Anna', deadline: '2026-11-18' }),
      item({ id: 'hr-2', connector: 'hr', title: 'Rehabplan Anna' }),
    ];
    const list = workList(threads, 'needs-you', NOW, TODAY, t => t.connector !== 'hr');
    expect(list.rows.map(r => r.ref)).toEqual(['thread:ekonomi']);
    expect(list.total).toBe(1);
    expect(list.withheld).toBe(2);
    expect(JSON.stringify(list)).not.toContain('Anna');
  });
});
