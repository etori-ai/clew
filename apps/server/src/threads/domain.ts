import { dayRhythm, stockholmClock, stockholmDate, stockholmInstant, type RhythmPoint } from '@clew/contracts';

/**
 * The day as one track (D28): pure functions over instants, no clock in here. The review at 06:00, every interruption
 * pushed today in the order it happened, the bundles and the quiet hours, each marked done, next or later against `now`.
 */
export function rhythmFor(now: string, interruptions: Array<{ at: string; title: string }>): RhythmPoint[] {
  const today = stockholmDate(now);
  const fixed = [
    { kind: 'review' as const, at: dayRhythm.review },
    ...dayRhythm.bundles.map(at => ({ kind: 'bundle' as const, at })),
    { kind: 'quiet' as const, at: dayRhythm.quiet },
  ].map(p => ({ ...p, instant: stockholmInstant(today, p.at) }));
  const pushed = interruptions.map(i => ({ kind: 'interruption' as const, at: stockholmClock(i.at), title: i.title, instant: i.at }));
  const points = [...fixed, ...pushed].sort((a, b) => Date.parse(a.instant) - Date.parse(b.instant));
  let nextSeen = false;
  return points.map(({ instant, ...p }) => {
    const done = Date.parse(instant) <= Date.parse(now);
    const state = done ? 'done' : nextSeen ? 'later' : 'next';
    if (!done) nextSeen = true;
    return { ...p, state };
  });
}
