import type { Thread, ThreadItem, Verb } from '@clew/contracts';
import { addDays, mondayOfWeek, weekNumber, weekStart } from '@clew/calendar/dates';

/**
 * Verbs about one chipped object (D12). They come from the object's actions and Clew's standard actions, never from
 * the model, so the row under a chip is the same whether or not a provider is configured.
 */
export function verbsFor(thread: Thread): Verb[] {
  if (thread.state !== 'open') return [];
  const verbs: Verb[] = [];
  const primary = thread.actions.find(a => a.role === 'primary');
  const selectable = thread.items.filter(i => i.selectable);
  if (primary?.usesItems && selectable.length > 1) {
    const first = selectable[0]!;
    verbs.push({ id: 'only-first', label: `Bara ${first.label.split(' · ')[0]}`, kind: 'primary', threadId: thread.id, refs: [first.ref] });
  }
  if (thread.week && thread.proposals.length) {
    for (const weeks of [1, 2]) {
      const week = addDays(thread.week, 7 * weeks);
      verbs.push({ id: `week-${weekNumber(week)}`, label: `Vecka ${weekNumber(week)} i stället`, kind: 'replan', threadId: thread.id, week });
    }
  }
  verbs.push({ id: 'dismiss', label: 'Avfärda det', kind: 'dismiss', threadId: thread.id });
  verbs.push({ id: 'snooze', label: 'Inte nu, i morgon 06:00', kind: 'snooze', threadId: thread.id });
  verbs.push({ id: 'why', label: 'Varför ser jag detta?', kind: 'why', threadId: thread.id });
  return verbs;
}

const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s:-]/gu, ' ').replace(/\s+/g, ' ').trim();
/** Which rows a "bara …" sentence names: tokens matched against labels and details, case-insensitively. */
function namedItems(rest: string, items: ThreadItem[]) {
  const tokens = normalise(rest).split(/\s*(?:,|\boch\b|&)\s*/).map(t => t.trim()).filter(t => t.length >= 2);
  const refs = items.filter(i => { const hay = normalise(`${i.label} ${i.detail}`); return tokens.some(t => hay.includes(t)); }).map(i => i.ref);
  return refs.length ? refs : undefined;
}
/**
 * Read a verb out of free text about the chipped thread. No match returns undefined and the caller may ask the
 * model or the router with the chip as context. `today` (YYYY-MM-DD) decides which "vecka 47" is still ahead.
 */
export function parseVerb(text: string, thread: Thread, today: string): Verb | undefined {
  const q = normalise(text);
  if (thread.state !== 'open') return undefined;
  if (/^(avfärda|ta bort kortet|inte aktuellt)/.test(q) || /\bavfärda\b/.test(q)) return { id: 'dismiss', label: 'Avfärda det', kind: 'dismiss', threadId: thread.id };
  if (/\binte nu\b|\bsenare\b|\bi morgon\b|\bpåminn\b/.test(q)) return { id: 'snooze', label: 'Inte nu, i morgon 06:00', kind: 'snooze', threadId: thread.id };
  if (/\bvarför\b/.test(q)) return { id: 'why', label: 'Varför ser jag detta?', kind: 'why', threadId: thread.id };
  const week = /\bvecka (\d{1,2})\b/.exec(q);
  if (week && thread.week && thread.proposals.length) {
    const n = Number(week[1]);
    const year = Number(thread.week.slice(0, 4));
    const candidates = [mondayOfWeek(year, n), mondayOfWeek(year + 1, n)].filter(w => Date.parse(w) >= Date.parse(weekStart(today)));
    if (candidates.length) return { id: `week-${n}`, label: `Vecka ${n} i stället`, kind: 'replan', threadId: thread.id, week: candidates[0]! };
  }
  if (/\bnästa vecka\b/.test(q) && thread.week && thread.proposals.length) {
    const week = addDays(thread.week, 7);
    return { id: `week-${weekNumber(week)}`, label: `Vecka ${weekNumber(week)} i stället`, kind: 'replan', threadId: thread.id, week };
  }
  const only = /\bbara\s+(.+)$/.exec(q);
  const primary = thread.actions.find(a => a.role === 'primary');
  if (only && primary?.usesItems) {
    const refs = namedItems(only[1]!, thread.items.filter(i => i.selectable));
    if (refs) return { id: 'only', label: `${primary.label}, bara de namngivna`, kind: 'primary', threadId: thread.id, refs };
  }
  return undefined;
}
/** The draft a "bara …" sentence produces: the named rows selected, the rest unselected, non-selectable rows untouched. */
export function draftSelection(items: ThreadItem[], refs: string[]): ThreadItem[] {
  for (const r of refs) if (!items.some(i => i.ref === r)) throw new Error('Något val är inte längre aktuellt.');
  return items.map(i => i.selectable ? { ...i, selected: refs.includes(i.ref) } : i);
}
