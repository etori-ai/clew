import type { AreaFigure, FigureTone, MenuIcon } from '@clew/contracts';
import { dayRhythm, nextStockholmTime, snoozeWhen, stockholmClock } from '@clew/contracts';

/** A tone in Clew's words (D54, artboard 3): the connector sends the tone, never the word, so every system sounds the same. */
export interface ToneWord {
  variant: 'success' | 'warning' | 'error';
  word: 'Lugnt' | 'Bevaka' | 'Behöver dig';
}
export const TONE_WORDS: Record<Exclude<FigureTone, 'none'>, ToneWord> = {
  ok: { variant: 'success', word: 'Lugnt' },
  warn: { variant: 'warning', word: 'Bevaka' },
  alert: { variant: 'error', word: 'Behöver dig' },
};
/** The area a figure belongs to, as its mark draws it (D71): the area's word and icon, the system's hue and name. */
export interface FigureMark {
  title: string;
  icon?: MenuIcon;
  ordinal: number | null;
  source: string;
}
/**
 * The tile on Hem: the chip and the tone on the first line; then a value with its label and its comparison or bar, or
 * a sentence; and last the view it opens. `name` is the tile's accessible name: the area, the label, the value and the
 * tone's word, and where it leads.
 */
export interface FigureTile {
  kind: 'value' | 'sentence' | 'silent';
  mark: FigureMark;
  /** The dot with its word for ok and warn; alert is the "Behöver dig" badge and the red border instead; none is nothing. */
  tone: ToneWord | null;
  alert: boolean;
  label: string;
  value?: string;
  /** In supporting under the value, when there is no bar; for a silent source, when it was read and when it is tried again. */
  comparison?: string;
  progress?: { value: number; max: number; label: string };
  /** The view the whole tile links to; only a figure with a value leads anywhere. */
  opens?: { capability: string; title: string };
  name: string;
}
/** The line in a text (Sedan i går, an answer): glyph, label, the value bold at body size, the dot with its word, the rest in supporting. */
export interface FigureLine {
  icon?: MenuIcon;
  label: string;
  value?: string;
  tone: ToneWord | null;
  /**
   * "mål ≤ 4,0 % · Personalsystemet 06:00": the comparison and the source with the time it was read. It starts with no
   * separator: it is its own piece of the wrapping line, and a separator must never begin a line (the gap sets it off).
   */
  rest: string;
}
export interface FigureForms {
  tile: FigureTile;
  line: FigureLine;
  /** The rail's word for this figure alone; `worstWord` picks among a person's figures. */
  word: ToneWord | null;
}

const toneOf = (figure: AreaFigure): ToneWord | null => (figure.tone === 'none' ? null : TONE_WORDS[figure.tone]);
const lower = (s: string) => s[0]!.toLowerCase() + s.slice(1);
/** When Clew asks a silent source again: the next review or bundle of the day's rhythm (D28), "12:00" today, else "i morgon 06:00". */
export function retryWhen(now: string) {
  const next = [dayRhythm.review, ...dayRhythm.bundles]
    .map(t => nextStockholmTime(now, t))
    .sort((a, b) => Date.parse(a) - Date.parse(b))[0]!;
  const when = snoozeWhen(next, now);
  return when.startsWith('kl ') ? when.slice(3) : when;
}

/**
 * The one mapping from an area's figure to the three forms Clew draws it in (D54, D71 artboard 3), as `agendaItems()` is
 * for the calendar. `lastRead` is when the source last answered, for the silent tile; `now` gives the retry time.
 */
export function figureItems(
  figure: AreaFigure,
  mark: FigureMark,
  options: { now: string; lastRead?: string | null },
): FigureForms {
  const tone = toneOf(figure);
  if (figure.unavailable) {
    const retry = `försöker igen ${retryWhen(options.now)}`;
    const comparison = options.lastRead
      ? `Senast läst ${stockholmClock(options.lastRead)} · ${retry}`
      : retry[0]!.toUpperCase() + retry.slice(1);
    return {
      tile: {
        kind: 'silent',
        mark,
        tone: null,
        alert: false,
        label: `${mark.source} svarar inte.`,
        comparison,
        name: `${mark.title}: ${mark.source} svarar inte`,
      },
      line: { icon: mark.icon, label: `${mark.source} svarar inte.`, tone: TONE_WORDS.warn, rest: retry },
      word: TONE_WORDS.warn,
    };
  }
  const at = figure.observedAt ? ` ${stockholmClock(figure.observedAt)}` : '';
  const rest = [figure.comparison, `${mark.source}${at}`].filter(s => s !== undefined).join(' · ');
  const line: FigureLine = {
    icon: mark.icon,
    label: figure.label,
    ...(figure.value ? { value: figure.value } : {}),
    tone,
    rest,
  };
  if (!figure.value)
    return {
      tile: { kind: 'sentence', mark, tone, alert: false, label: figure.label, name: `${mark.title}: ${figure.label}` },
      line,
      word: tone,
    };
  const alert = figure.tone === 'alert';
  const name =
    `${mark.title}: ${figure.label} ${figure.value}` +
    (tone ? `, ${lower(tone.word)}` : '') +
    (figure.opens ? `. Öppnar ${figure.opens.title}` : '');
  return {
    tile: {
      kind: 'value',
      mark,
      tone,
      alert,
      label: figure.label,
      value: figure.value,
      ...(figure.progress
        ? {
            progress: {
              ...figure.progress,
              label: `${figure.label}: ${figure.value}${figure.comparison ? `, ${figure.comparison}` : ''}`,
            },
          }
        : figure.comparison
          ? { comparison: figure.comparison }
          : {}),
      ...(figure.opens ? { opens: figure.opens } : {}),
      name,
    },
    line,
    word: tone,
  };
}

/** The rail's word (D54, artboard 3): the worst tone among the person's figures, lower case, or null when none has a tone. */
export function worstWord(
  figures: ReadonlyArray<AreaFigure | null>,
): { variant: ToneWord['variant']; word: string } | null {
  const rank = { none: 0, ok: 1, warn: 2, alert: 3 } as const;
  const worst = figures.reduce<FigureTone>((w, f) => {
    const t: FigureTone = !f ? 'none' : f.unavailable ? 'warn' : f.tone;
    return rank[t] > rank[w] ? t : w;
  }, 'none');
  return worst === 'none' ? null : { variant: TONE_WORDS[worst].variant, word: TONE_WORDS[worst].word };
}
