import type { ThreadAction } from '@clew/contracts';

/**
 * What a card action's `confirm` asks, as an alert dialog takes it: the question as the title and what follows from
 * a yes as the description. A source writes one string, "Avvisa filen? Ditt beslut gäller för alla som kan godkänna
 * den.": the question ends at its first question mark and the rest is the consequence. A string without a question
 * is the consequence, and the action's own label asks; a question alone gets the plain statement that nothing happens
 * before the person confirms.
 */
export function confirmParts(action: Pick<ThreadAction, 'label' | 'confirm'>): { title: string; description: string } {
  const text = (action.confirm ?? '').trim();
  const mark = text.indexOf('?');
  if (mark === -1) return { title: `${action.label}?`, description: text || nothingYet(action.label) };
  const rest = text.slice(mark + 1).trim();
  return { title: text.slice(0, mark + 1), description: rest || nothingYet(action.label) };
}
const nothingYet = (label: string) => `Inget görs förrän du väljer ${label}.`;
