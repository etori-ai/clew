import { dayRhythm, nextStockholmTime, stockholmDate, stockholmClock } from '@clew/contracts';
export interface AttentionDay {
  id: string;
  personId: string;
  used: number;
  bucket: string;
  dueAt: string;
}
export function admitAttention(previous: AttentionDay | undefined, personId: string, at: string) {
  const id = personId + ':' + stockholmDate(at),
    bucket = String(Math.floor(Date.parse(at) / 300_000));
  if (previous?.id === id && previous.bucket === bucket) return previous;
  const used = previous?.id === id ? previous.used : 0;
  const time = stockholmClock(at),
    minute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
  if (time < dayRhythm.review || time >= dayRhythm.quiet)
    return { id, personId, used, bucket, dueAt: nextStockholmTime(at, dayRhythm.review) };
  const scheduled = [dayRhythm.review, ...dayRhythm.bundles].some(t => {
    const start = Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    return minute >= start && minute < start + dayRhythm.graceMinutes;
  });
  const nextBundle = dayRhythm.bundles.find(t => t > time) ?? dayRhythm.review;
  return {
    id,
    personId,
    used: scheduled ? used : Math.min(3, used + 1),
    bucket,
    dueAt: scheduled || used < 3 ? at : nextStockholmTime(at, nextBundle),
  };
}
