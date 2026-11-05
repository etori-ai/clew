import { cardKind, isSnoozed, streamGroup, type Thread } from '@clew/contracts';

/** The page's groups (D34), computed once and read by the landing, the overview and the rail. */
export interface Groups {
  /** Requirements due today, overdue or reminded today. */
  nu: Thread[];
  /** Requirements with a day ahead, then the ones without a day. */
  senare: Thread[];
  /** What the assistant proposes: nothing happens until the person says yes. */
  foreslar: Thread[];
  /** Events: for information, no button. */
  kannedom: Thread[];
  waiting: Thread[];
  snoozed: Thread[];
  handledToday: Thread[];
  /** The person's own conversations, newest first. */
  questions: Thread[];
}
const byDeadline = (a: Thread, b: Thread) => (a.deadline ?? '9999').localeCompare(b.deadline ?? '9999') || a.createdAt.localeCompare(b.createdAt);
export function groupThreads(threads: Thread[], now: string, today: string, inScope: (t: Thread) => boolean = () => true): Groups {
  const open = threads.filter(t => t.state === 'open' && t.kind === 'pushed');
  const needsYou = open.filter(t => !t.waitingOn && !isSnoozed(t, now) && inScope(t)).sort(byDeadline);
  const krav = needsYou.filter(t => cardKind(t) === 'krav');
  return {
    nu: krav.filter(t => streamGroup(t, today) === 'nu'),
    senare: krav.filter(t => streamGroup(t, today) !== 'nu'),
    foreslar: needsYou.filter(t => cardKind(t) === 'forslag'),
    kannedom: needsYou.filter(t => cardKind(t) === 'handelse'),
    waiting: open.filter(t => !!t.waitingOn && !isSnoozed(t, now)),
    snoozed: open.filter(t => isSnoozed(t, now)),
    handledToday: threads.filter(t => t.state !== 'open' && t.handledAt && t.handledAt.slice(0, 10) === now.slice(0, 10)),
    questions: threads.filter(t => t.kind === 'question').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
}
/** The greeting's sentence: what needs the person today, what has time, what the assistant proposes. */
export function digestSentence(g: Groups): string {
  if (g.nu.length === 0 && g.senare.length === 0 && g.foreslar.length === 0) return 'Inget behöver dig just nu.';
  const parts = [g.nu.length === 0 ? 'Inget behöver dig i dag' : g.nu.length === 1 ? 'En sak behöver dig i dag' : `${g.nu.length} saker behöver dig i dag`];
  if (g.senare.length) parts.push(g.senare.length === 1 ? 'en har tid på sig' : `${g.senare.length} har tid på sig`);
  if (g.foreslar.length) parts.push(g.foreslar.length === 1 ? 'jag har ett förslag' : `jag har ${g.foreslar.length} förslag`);
  return parts.length === 1 ? `${parts[0]}.` : `${parts.slice(0, -1).join(', ')} och ${parts.at(-1)}.`;
}
