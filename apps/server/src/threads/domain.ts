import { dayRhythm, stockholmClock, stockholmDate, stockholmInstant, type RhythmPoint } from '@clew/contracts';

/**
 * The day as one track (D28): pure functions over instants, no clock in here. The review at 06:00, the bundles and the
 * quiet hours, each marked done, next or later against `now`, with every card pushed today folded onto the track. A scan
 * pushes its cards in one go, so cards are folded into moments: a card pushed within `dayRhythm.graceMinutes` after the
 * review or a bundle belongs to that point, and the rest form interruptions, one per run of cards closer together than
 * the grace. The Stepper that draws the track holds seven steps, which is the four fixed points and the budget of three.
 */
export function rhythmFor(now: string, interruptions: Array<{ at: string; title: string }>): RhythmPoint[] {
  const today = stockholmDate(now);
  const grace = dayRhythm.graceMinutes * 60_000;
  const fixed = [
    { kind: 'review' as const, at: dayRhythm.review },
    ...dayRhythm.bundles.map(at => ({ kind: 'bundle' as const, at })),
    { kind: 'quiet' as const, at: dayRhythm.quiet },
  ].map(p => ({ ...p, instant: Date.parse(stockholmInstant(today, p.at)), count: 0, title: undefined as string | undefined }));
  const pushed = [...interruptions].map(i => ({ ...i, instant: Date.parse(i.at) })).sort((a, b) => a.instant - b.instant);
  const moments: Array<{ kind: 'interruption'; at: string; instant: number; count: number; title: string | undefined; last: number }> = [];
  for (const card of pushed) {
    const scheduled = fixed.find(p => p.kind !== 'quiet' && card.instant >= p.instant && card.instant < p.instant + grace);
    if (scheduled) { scheduled.count += 1; continue; }
    const open = moments.at(-1);
    if (open && card.instant - open.last < grace) { open.count += 1; open.last = card.instant; continue; }
    moments.push({ kind: 'interruption', at: stockholmClock(card.at), instant: card.instant, count: 1, title: card.title, last: card.instant });
  }
  const points = [...fixed, ...moments.map(({ last: _, ...m }) => m)].sort((a, b) => a.instant - b.instant);
  let nextSeen = false;
  return points.map(({ instant, count, title, ...p }) => {
    const done = instant <= Date.parse(now);
    const state = done ? 'done' : nextSeen ? 'later' : 'next';
    if (!done) nextSeen = true;
    return { ...p, state, ...(title ? { title } : {}), ...(count ? { count } : {}) };
  });
}
