/**
 * One status vocabulary (D126 item 13): eight states, each with one Swedish word, said the same wherever a state is
 * shown (a row, beside a title, under one). Every state answers two things: how it went (the tone) and whose move it is
 * (the words and the one action). The words without the components, so a pure model (`status-of.ts` in the web app,
 * `stateOf`) can name a state without drawing it; `status.tsx` draws them.
 */
export type StatusKind =
  'needs-you' | 'sending' | 'waiting' | 'done' | 'partial' | 'unconfirmed' | 'failed' | 'blocked';
/** How it went: a Banner's and a Badge's status. Astryx's Banner has no neutral tone, so "Väntar" is info like "Skickas". */
export type StatusTone = 'info' | 'warning' | 'error' | 'success';
export interface StatusWords {
  /** The state's one word, the same wherever it is shown. */
  word: string;
  tone: StatusTone;
  /** Whose move it is: the person's, the system's, someone else's or nobody's. */
  next: 'Du' | 'Systemet' | 'Någon annan' | 'Ingen';
  /** What the state means, in a sentence. */
  means: string;
}
export const STATUS: Readonly<Record<StatusKind, StatusWords>> = {
  'needs-you': {
    word: 'Behöver dig',
    tone: 'warning',
    next: 'Du',
    means: 'Något väntar på ditt beslut eller din åtgärd.',
  },
  sending: { word: 'Skickas', tone: 'info', next: 'Systemet', means: 'Ditt beslut är på väg till källan.' },
  waiting: {
    word: 'Väntar',
    tone: 'info',
    next: 'Någon annan',
    means: 'Bollen ligger hos en person eller ett system. Du behöver inte göra något.',
  },
  done: { word: 'Klart', tone: 'success', next: 'Ingen', means: 'Källan har bekräftat.' },
  partial: {
    word: 'Delvis klart',
    tone: 'warning',
    next: 'Du',
    means: 'En del gick igenom. Resten behöver din bedömning.',
  },
  unconfirmed: {
    word: 'Obekräftat',
    tone: 'warning',
    next: 'Du',
    means: 'Skickat, men källan har inte sagt om det gick igenom.',
  },
  failed: { word: 'Misslyckades', tone: 'error', next: 'Du', means: 'Källan sa nej eller gick inte att nå.' },
  blocked: {
    word: 'Hindrat',
    tone: 'warning',
    next: 'Du',
    means: 'Kan inte skickas förrän något annat är löst: inloggning, behörighet.',
  },
};
/** The dot's colour in a row: the tone's, and "Väntar" grey, since nothing is asked of the person. */
export const statusDot = (kind: StatusKind): 'accent' | 'warning' | 'error' | 'success' | 'neutral' =>
  kind === 'waiting'
    ? 'neutral'
    : ({ info: 'accent', warning: 'warning', error: 'error', success: 'success' } as const)[STATUS[kind].tone];
