import { describe, expect, test } from 'bun:test';
import { rowLine } from '../src/work-items';

describe("a work item's row says its state in words (WCAG 1.4.1)", () => {
  test('the state begins the supporting line, held to its separator by a no-break space, then why the item is here', () => {
    expect(
      rowLine({
        state: { variant: 'error', label: 'Att göra i dag' },
        due: null,
        why: 'Ansökan kom 10 november kl. 16:40',
      }),
    ).toBe('Att göra i dag\u00a0· Ansökan kom 10 november kl. 16:40');
    // Two states that differed by the dot's colour alone now differ in words.
    expect(
      rowLine({ state: { variant: 'warning', label: 'Att göra' }, due: null, why: 'Ansökan väntar på beslut' }),
    ).toBe('Att göra\u00a0· Ansökan väntar på beslut');
  });
  test('an item that waits on someone says so once, with whom', () => {
    expect(
      rowLine({ state: { variant: 'neutral', label: 'Väntar på andra' }, due: null, why: 'Väntar på skyddsombudet' }),
    ).toBe('Väntar på skyddsombudet');
    // Set aside, it waits on nobody: the state and when it comes back are two things.
    expect(rowLine({ state: { variant: 'neutral', label: 'Inte nu' }, due: null, why: 'Tillbaka i morgon' })).toBe(
      'Inte nu\u00a0· Tillbaka i morgon',
    );
  });
  test('without a reason the state stands alone', () => {
    expect(rowLine({ state: { variant: 'success', label: 'Klart' }, due: null, why: '' })).toBe('Klart');
  });
});
