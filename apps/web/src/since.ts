import { dayRhythm, nextStockholmTime, replySummary, snoozeWhen, type Thread } from '@clew/contracts';
import { timeLabel } from '@clew/calendar/dates';

/** A source's state from the last read of the cards. */
export type Source = { connector: string; state: string; lastSuccess: string | null; error: string | null };

/** How many cards a sentence names before it sums the rest (D65). */
export const NAMED = 3;

const when = (t: Thread) => t.handledAt ?? t.updatedAt;
const lower = (s: string) => (s ? s[0]!.toLowerCase() + s.slice(1) : s);
const words = ['', 'en', 'två', 'tre', 'fyra', 'fem', 'sex', 'sju', 'åtta', 'nio', 'tio', 'elva', 'tolv'];
const count = (n: number) => words[n] ?? String(n);
/** "a, b och c". */
const join = (parts: string[]) =>
  parts.length <= 1 ? (parts[0] ?? '') : `${parts.slice(0, -1).join(', ')} och ${parts.at(-1)}`;
/**
 * The first few by name and the rest as a number (D65): "a, b, c och 31 till". A card that closed more than once is
 * named once, so the names are distinct phrases while the count stays the number of cards. Up to NAMED + 1 distinct
 * cards are all named, because "och 1 till" says less than the name would.
 */
export function some(phrases: string[]) {
  const distinct = [...new Set(phrases)];
  const named = phrases.length <= NAMED + 1 && distinct.length === phrases.length ? distinct : distinct.slice(0, NAMED);
  const rest = phrases.length - named.length;
  return rest > 0 ? `${named.join(', ')} och ${rest} till` : join(named);
}

type Input = {
  /** Done or dismissed since the day began. */
  handled: Thread[];
  /** Open, but waiting on someone else. */
  waiting: Thread[];
  /** Every source's state from the last read of the cards, when the page has it. */
  sources?: Source[] | undefined;
  now: string;
};
/**
 * "Sedan i går" (D53, artboard A) as three sentences in the artboard's words: what closed since the day began, newest
 * first, with the receipt's time where the source read it back; what still waits on someone else, with how many have
 * answered; and when the assistant next goes through everything, with whether every source answered. At any count a
 * sentence names at most NAMED cards and sums the rest (D65).
 */
export function sinceSentences({ handled, waiting, sources, now }: Input) {
  const done = [...handled].sort((a, b) => when(b).localeCompare(when(a)));
  const doneLine =
    done.length > 0
      ? `${done.length} ${done.length === 1 ? 'klar' : 'klara'}: ${some(
          done.map(t =>
            t.state === 'dismissed'
              ? `${lower(t.title)}, avfärdad ${timeLabel(when(t))}`
              : t.receipt
                ? `${lower(t.title)}, kvitto läst från ${lower(t.trigger.source)} ${timeLabel(t.receipt.at)}`
                : `${lower(t.title)} ${timeLabel(when(t))}`,
          ),
        )}.`
      : null;
  const waitingLine =
    waiting.length > 0
      ? `${waiting.length} väntar på andra: ${some(
          waiting.map(t => {
            const sum = t.proposals.length ? replySummary(t.proposals) : null;
            return sum && sum.total > 0
              ? `${lower(t.title)} (${sum.accepted + sum.declined} av ${sum.total} har svarat)`
              : lower(t.title);
          }),
        )}.`
      : null;
  const failed = sources?.filter(s => s.error || !s.lastSuccess) ?? [];
  const sourcesLine = !sources?.length
    ? ''
    : failed.length === 0
      ? ` Alla ${count(sources.length)} källor svarade i natt.`
      : ` ${count(failed.length)[0]!.toUpperCase()}${count(failed.length).slice(1)} ${failed.length === 1 ? 'källa' : 'källor'} svarade inte.`;
  const reviewLine = `Nästa genomgång ${snoozeWhen(nextStockholmTime(now, dayRhythm.review), now)}.${sourcesLine}`;
  return { doneLine, waitingLine, reviewLine, failed: failed.length };
}
