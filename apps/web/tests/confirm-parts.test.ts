import { describe, expect, test } from 'bun:test';
import { confirmParts } from '../src/confirm-parts';

describe("what a card action's confirm asks, as an alert dialog takes it", () => {
  test('a question and its consequence become the title and the description', () => {
    expect(
      confirmParts({ label: 'Avvisa', confirm: 'Avvisa filen? Ditt beslut gäller för alla som kan godkänna den.' }),
    ).toEqual({ title: 'Avvisa filen?', description: 'Ditt beslut gäller för alla som kan godkänna den.' });
    expect(confirmParts({ label: 'Avslå', confirm: 'Avslå ansökan? Medarbetaren meddelas direkt.' })).toEqual({
      title: 'Avslå ansökan?',
      description: 'Medarbetaren meddelas direkt.',
    });
  });
  test("a consequence without a question is asked by the action's own label", () => {
    expect(confirmParts({ label: 'Avslå', confirm: 'Medarbetaren meddelas direkt.' })).toEqual({
      title: 'Avslå?',
      description: 'Medarbetaren meddelas direkt.',
    });
  });
  test('a question alone still says that nothing happens before the answer', () => {
    expect(confirmParts({ label: 'Avvisa', confirm: 'Avvisa filen?' })).toEqual({
      title: 'Avvisa filen?',
      description: 'Inget görs förrän du väljer Avvisa.',
    });
  });
});
