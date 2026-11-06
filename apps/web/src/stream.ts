import { cardKind, isSnoozed, stockholmDate, streamGroup, unresolvedExecution, type Thread } from '@clew/contracts';

/** The page's groups (D34), computed once and read by Hem and the rail. */
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
  const open = threads.filter(t => (t.state === 'open' || unresolvedExecution(t)) && t.kind === 'pushed');
  const needsYou = open.filter(t => !t.waitingOn && !isSnoozed(t, now) && inScope(t)).sort(byDeadline);
  const krav = needsYou.filter(t => cardKind(t) === 'krav');
  return {
    nu: krav.filter(t => streamGroup(t, today) === 'nu'),
    senare: krav.filter(t => streamGroup(t, today) !== 'nu'),
    foreslar: needsYou.filter(t => cardKind(t) === 'forslag'),
    kannedom: needsYou.filter(t => cardKind(t) === 'handelse'),
    waiting: open.filter(t => !!t.waitingOn && !isSnoozed(t, now)),
    snoozed: open.filter(t => isSnoozed(t, now)),
    handledToday: threads.filter(t => t.state !== 'open' && !unresolvedExecution(t) && t.handledAt && t.handledAt.slice(0, 10) === now.slice(0, 10)),
    questions: threads.filter(t => t.kind === 'question').sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
  };
}

/** A view of existing reminders, with the stream's scope/lifecycle selection (D39). */
export function activeReminders(threads: Thread[], now: string): Thread[] {
  const groups = groupThreads(threads, now, stockholmDate(now));
  return [...groups.nu, ...groups.senare, ...groups.foreslar, ...groups.kannedom]
    .filter(thread => thread.remindedAt !== null)
    .sort((a, b) => (b.remindedAt ?? '').localeCompare(a.remindedAt ?? '') || a.id.localeCompare(b.id));
}
