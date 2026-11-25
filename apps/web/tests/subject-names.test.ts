import { describe, expect, test } from 'bun:test';
import { ENTITY_NAMES_MAX, type Subject } from '@clew/contracts';
import { namesReads } from '../src/subject-names';

const person = (key: string): Subject => ({ entity: 'person', key });

describe('the reads that name a list’s subjects', () => {
  test('each subject once, in one order whatever order the list draws them in', () => {
    const reads = namesReads([person('erik'), { entity: 'unit', key: 'unit-skola' }, person('anna'), person('erik')]);
    expect(reads).toEqual([[person('anna'), person('erik'), { entity: 'unit', key: 'unit-skola' }]]);
    expect(namesReads([person('anna'), { entity: 'unit', key: 'unit-skola' }, person('erik')])).toEqual(reads);
  });
  test('no read for a list about nobody, and at most 200 subjects to a read', () => {
    expect(namesReads([])).toEqual([]);
    const many = Array.from({ length: 450 }, (_, i) => person(`p${String(i).padStart(3, '0')}`));
    const reads = namesReads([...many, ...many]);
    expect(reads.map(r => r.length)).toEqual([ENTITY_NAMES_MAX, ENTITY_NAMES_MAX, 50]);
    expect(reads.flat()).toEqual(many);
  });
});
