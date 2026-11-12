import type { ActionPath, Ask, AskValues } from '@clew/contracts';

/**
 * The one path a write passes (D111 item 10), the pure part: which of a capability's asks a person meets on one action,
 * what nothing fills, and the person's answers checked against the asks. No I/O. The loader holds a declaration to its
 * rules (`validation.ts`); the stream, the entities module and the route use these to draw and to decide.
 */
type Schema = { type?: unknown; properties?: Record<string, unknown>; required?: unknown };
/** What these functions need to know about a capability. */
export interface AskingCapability {
  kind: string;
  description: string;
  input: unknown;
  review?: string;
  asks?: Ask[];
  effect?: string;
}
/** What they need to know about an action on a work item: what it already gives. */
export interface GivingAction {
  input?: Record<string, unknown>;
  usesItems?: boolean;
}
const requiredOf = (input: unknown): string[] => {
  const required = (input as Schema | undefined)?.required;
  return Array.isArray(required) ? required.filter((r): r is string => typeof r === 'string') : [];
};

/** The input properties an action on a work item already gives: its own input, the selected rows and the review's evidence. */
export function givenBy(capability: Pick<AskingCapability, 'review'>, action: GivingAction): string[] {
  return [
    ...Object.keys(action.input ?? {}),
    ...(action.usesItems ? ['refs'] : []),
    ...(capability.review ? ['reviews'] : []),
  ];
}
/** The asks a person meets: the capability's own, in the declared order, less the properties something else gives. */
export function asksFor(capability: Pick<AskingCapability, 'asks'>, given: Iterable<string>): Ask[] {
  const fixed = new Set(given);
  return (capability.asks ?? []).filter(a => !fixed.has(a.property));
}
/** The way a propose or an execute draws (D111): what it asks, whether its effect is the source's answer, and its description. */
export function pathOf(capability: AskingCapability, given: Iterable<string>): ActionPath | undefined {
  if (capability.kind !== 'propose' && capability.kind !== 'execute') return undefined;
  return {
    asks: asksFor(capability, given),
    effect: capability.kind === 'execute' && !!capability.effect,
    description: capability.description,
  };
}
/**
 * The first property the capability's input requires that nothing on this action fills (D111): not its own input, not
 * the rows, not the review and not an ask. Undefined when every one is filled.
 */
export function unfilledInput(capability: AskingCapability, action: GivingAction): string | undefined {
  const filled = new Set([...givenBy(capability, action), ...(capability.asks ?? []).map(a => a.property)]);
  return requiredOf(capability.input).find(r => !filled.has(r));
}
/** The asked properties the input requires that are not answered yet: what a work item may still wait for. */
export function pendingAsks(capability: Pick<AskingCapability, 'asks' | 'input'>, given: Iterable<string>): string[] {
  const required = new Set(requiredOf(capability.input));
  return asksFor(capability, given)
    .map(a => a.property)
    .filter(p => required.has(p));
}

const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const validDay = (value: string) => {
  if (!DAY.test(value)) return false;
  const parsed = new Date(value + 'T00:00:00Z');
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
};
/** Why one answer does not fit its ask, in Swedish for the person; undefined when it does. */
function answerProblem(ask: Ask, value: string, now: string, property?: Schema): string | undefined {
  const limits = property as { minLength?: unknown; maxLength?: unknown } | undefined;
  const length = [...value].length;
  if (typeof limits?.maxLength === 'number' && length > limits.maxLength)
    return `${ask.label}: högst ${limits.maxLength} tecken.`;
  if (typeof limits?.minLength === 'number' && length < limits.minLength)
    return `${ask.label}: minst ${limits.minLength} tecken.`;
  switch (ask.kind) {
    case 'meeting':
      if (!INSTANT.test(value) || Number.isNaN(Date.parse(value))) return `${ask.label}: välj en tid.`;
      if (Date.parse(value) <= Date.parse(now)) return `${ask.label}: tiden har redan passerat.`;
      return undefined;
    case 'date':
      return validDay(value) ? undefined : `${ask.label}: välj ett datum.`;
    case 'choice':
      return ask.options.some(o => o.value === value) ? undefined : `${ask.label}: välj ett av alternativen.`;
    default:
      return undefined;
  }
}
/**
 * The person's answers to the asks they met (D111), ready to merge into the input: a text is trimmed, an optional answer
 * left empty is not sent. Refused, in Swedish: an answer to anything not asked here, a required ask left empty, and an
 * answer that does not fit its kind (a time that has passed, a day that does not exist, a value outside the choice) or
 * the length its property in `input` allows. The whole input schema is checked on the merged input by whoever runs it.
 */
export function answersOf(
  asks: readonly Ask[],
  values: AskValues | undefined,
  now: string,
  input?: unknown,
): { answers: Record<string, string> } | { problem: string } {
  const given = values ?? {};
  if (Object.keys(given).some(key => !asks.some(a => a.property === key)))
    return { problem: 'Åtgärden frågar inte efter det värdet.' };
  const answers: Record<string, string> = {};
  for (const ask of asks) {
    const raw = given[ask.property];
    const value = typeof raw === 'string' ? (ask.kind === 'text' || ask.kind === 'long-text' ? raw.trim() : raw) : '';
    if (!value) {
      if (ask.required) return { problem: `${ask.label} behöver fyllas i.` };
      continue;
    }
    const problem = answerProblem(ask, value, now, (input as Schema | undefined)?.properties?.[ask.property] as Schema);
    if (problem) return { problem };
    answers[ask.property] = value;
  }
  return { answers };
}
