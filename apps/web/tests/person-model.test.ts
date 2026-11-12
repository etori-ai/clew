import { describe, expect, test } from 'bun:test';
import { employmentLabel, employmentPercent } from '../src/pages/person-model';

/** The words of a person's profile (D114): the percentage of full time and what an employment is called. */
const plain = (text: string) => text.replace(/\s/g, ' ');

describe('a profile', () => {
  test('a percentage reads as meant, with at most two decimals, whatever binary floating point made of it (G1)', () => {
    // A provisioner that multiplies a 0–1 fraction by 100: eight whole percentages come out a hair off.
    for (const whole of [7, 14, 28, 29, 55, 56, 57, 58]) {
      const sent = (whole / 100) * 100;
      expect(sent).not.toBe(whole);
      expect(plain(employmentPercent(sent))).toBe(`${whole} %`);
    }
    expect(plain(employmentPercent(0.575 * 100))).toBe('57,5 %');
    expect(plain(employmentPercent(100 / 3))).toBe('33,33 %');
    expect(plain(employmentPercent(12.5))).toBe('12,5 %');
    expect(plain(employmentPercent(100))).toBe('100 %');
    expect(plain(employmentPercent(0))).toBe('0 %');
  });
  test('an employment is called by its title, else its unit, else, its unit removed, by the word alone', () => {
    expect(employmentLabel({ unitId: 'skola', unitLabel: 'Skolan', title: 'Rektor' })).toBe('Rektor');
    expect(employmentLabel({ unitId: 'skola', unitLabel: 'Skolan' })).toBe('Skolan');
    expect(employmentLabel({ unitId: 'borta', employmentType: 'Tillsvidare' })).toBe('Anställning');
  });
});
