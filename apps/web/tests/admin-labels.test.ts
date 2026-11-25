import { describe, expect, test } from 'bun:test';
import { fieldList, historyLabel, historyWords, inLine, kindLabel } from '../src/pages/admin/labels';

/**
 * The administration's words for its history rows and its sources (WA-L12): an audit row's action and details are said
 * in Swedish, never as an id or as JSON, and a value is read from the tables' own keys only. Whose a source is, is said
 * with the installation's name, which keeps its capitals in the middle of a line.
 */
describe("an audit row's action", () => {
  test('is said in its word, and an action the page has no word for still in Swedish', () => {
    expect(historyLabel('connector.enabled')).toBe('Påslagen');
    expect(historyLabel('model.reasoning')).toBe('Resonemang ändrat');
    expect(historyLabel('connector.something-new')).toBe('Ändrad');
  });
  test("is never read from the table's prototype", () => {
    for (const action of ['constructor', 'toString', '__proto__', 'hasOwnProperty'])
      expect(historyLabel(action)).toBe('Ändrad');
  });
});

describe("an audit row's details", () => {
  test('a state the row left is said as a state', () => {
    expect(historyWords('connector.enabled', { from: 'disabled' })).toBe('var avstängd');
    expect(historyWords('connector.disabled', { from: 'enabled' })).toBe('var påslagen');
    expect(historyWords('model.disabled', { from: 'enabled' })).toBe('var påslagen');
    expect(historyWords('connector.draft', { from: 'enabled' })).toBe('var påslagen');
  });
  test('a reasoning setting is said in words, never as its id', () => {
    expect(historyWords('model.reasoning', { from: 'provider-default', to: 'none', found: 'test' })).toBe(
      'från leverantörens standard till utan resonemang',
    );
    expect(historyWords('model.reasoning', { from: 'none', to: 'provider-default' })).toBe(
      'från utan resonemang till leverantörens standard',
    );
  });
  test("a name is said as it was written, even one that is a state's or a setting's id", () => {
    expect(historyWords('model.title', { from: 'none', to: 'draft' })).toBe('från none till draft');
    expect(historyWords('provider.title', { from: 'Gamla namnet', to: 'Kommunens modeller' })).toBe(
      'från Gamla namnet till Kommunens modeller',
    );
  });
  test("a value is never read from a table's prototype", () => {
    expect(historyWords('connector.enabled', { from: 'constructor' })).toBe('var constructor');
    expect(historyWords('model.reasoning', { from: 'toString', to: '__proto__' })).toBe('från toString till __proto__');
    expect(historyWords('model.title', { title: 'constructor' })).toBe('constructor');
  });
  test('switches, numbers, nothing, a moved address and a removal are said in words', () => {
    expect(historyWords('model.default', { from: false, to: true })).toBe('från av till på');
    expect(historyWords('model.title', { from: null, to: 'Snabb' })).toBe('från ingen till Snabb');
    expect(historyWords('connector.figure', { label: 'Budget', to: 1200 })).toBe('Budget, nu 1 200');
    expect(historyWords('provider.url', { from: 'http://a.test/v1', to: 'http://b.test/v1', keyRemoved: true })).toBe(
      'från http://a.test/v1 till http://b.test/v1, nyckeln togs bort',
    );
    expect(historyWords('connector.removed', { closedCards: 3, takenBy: 'Mikael Lund' })).toBe(
      'övertaget av Mikael Lund, 3 kort stängda',
    );
  });
  test('a list or an object is left to the action, and no JSON is ever shown', () => {
    const words = historyWords('connector.audience', {
      from: { mode: 'all' },
      to: { mode: 'selected', roles: ['manager'] },
    });
    expect(words).toBe('');
    expect(historyWords('model.tools', { from: ['a'], to: ['a', 'b'] })).toBe('');
    expect(historyWords('connector.manifest', { diff: { added: ['x'] } })).not.toMatch(/[{}[\]"]/);
  });
});

describe('a source, said with the installation', () => {
  test("one of the installation's own is said with its name; the others in their own words", () => {
    expect(kindLabel('core', 'Medarbetarwebben')).toBe('Egen i Medarbetarwebben');
    expect(kindLabel('passthrough', 'Medarbetarwebben')).toBe('Direkt från källan');
    expect(kindLabel('derived', 'Medarbetarwebben')).toBe('Räknas fram');
  });
  test("mid-line, only the label's first letter is lowered: the name keeps its capitals", () => {
    expect(inLine(kindLabel('core', 'Sundsvalls kommun'))).toBe('egen i Sundsvalls kommun');
    expect(inLine(kindLabel('core', 'IT-Centrum Väst'))).toBe('egen i IT-Centrum Väst');
    expect(inLine('Åtgärd')).toBe('åtgärd');
    expect(inLine('')).toBe('');
  });
  test("a changed field is named in the table's words, and a key not in the table by itself", () => {
    expect(fieldList(['kind', 'constructor'], { kind: 'typ' })).toBe('typ och constructor');
  });
});
