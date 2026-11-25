import {
  RELEASED_BY_PERSON,
  SUBJECT_CHANGED,
  cardKind,
  isSnoozed,
  snoozeWhen,
  type ReceiptRow,
  type Thread,
} from '@clew/contracts';
import type { StatusKind } from '@clew/ui/status-words';
import { executionKind, releasable, releaseQuestion } from './execution-status';
import { canUndoReceipt } from './receipt-state';
import { asksNoAnswer, dueOf, nothingToDecide, reasonMark } from './work-items';

export { nothingToDecide } from './work-items';

/**
 * A work item's state in the one vocabulary (D126 item 13), from what the item already holds: its decision's execution
 * (D45, D47, D122), its receipt and the time left to undo it (D70), what it waits on, whether it is set aside (D28),
 * handled or dismissed, and whether its system answers (D116). Pure: the caller hands in the clock, the words for an
 * instant and what the page knows about the system, so the row in Att göra and the notice under the item's title say
 * one state in one word.
 *
 * A plain to-do has no notice: its title and its buttons say what is expected. Every other state has one, whose title
 * says what in the person's words, whose description says why and since when, and which offers at most one move: the
 * one the item has always offered for that state (check the status, decide again, see the review, undo, remind, take
 * it up, reopen). A move is the person's (`offer: false`, a filled button) or an offer (`offer: true`, a secondary one).
 * A move the state also allows but the notice does not carry is in `rest`, for the item's ⋯ menu.
 *
 * A to-do with nothing to decide (`nothingToDecide`: every action it offers is a read) has no button that says what is
 * expected, so its notice does: the source's own summary, its first sentence as the title and the rest as the
 * description, with no move. The source says there what holds, what the person can do outside Clew and how the item
 * ends.
 *
 * Where the source offers it (`Thread.handOn`, D139), the person can say that the next step, someone else's, is taken:
 * `handOn` is that button's words, filled on an item with nothing to decide and a row under ⋯ on any other plain to-do.
 * Once said (`Thread.handedOn`) the item waits on whom the source named: the notice says so and when the person said
 * it, "Påminn mig" is its offer as on any item that waits, and "Det blev inte gjort" under ⋯ takes it back.
 */
export type StatusMoveKind =
  'check' | 'decide' | 'review' | 'undo' | 'remind' | 'take-up' | 'reopen' | 'hand-on' | 'hand-back' | 'release';
export interface StatusMoveWords {
  kind: StatusMoveKind;
  label: string;
  offer: boolean;
}
export interface StatusNoticeWords {
  title: string;
  description?: string;
  move?: StatusMoveWords;
}
export interface ItemStatus {
  kind: StatusKind;
  /** What the row's mark says after the word: "1 av 3", "försenad", "vecka 48". */
  detail?: string;
  /** The notice under the title, or null for a plain to-do. */
  notice: StatusNoticeWords | null;
  /**
   * The item is the person's and there is nothing of theirs to decide on it (`nothingToDecide`): no button is filled,
   * the two ways out stand beside its read, and nothing on it says an answer is late.
   */
  noDecision: boolean;
  /**
   * The item asks for no answer wherever it stands (`asksNoAnswer`: also while it waits on someone the person said
   * they asked, is set aside, or is closed): its day is "Sista dag", never "Svara senast", and no badge says it is late.
   */
  noAnswer: boolean;
  /**
   * The words of the source's offer to hand the item on (D139) while it can be taken: on a plain to-do, with or without
   * a decision. On an item with nothing to decide it is the one filled button; otherwise it is in `rest` too.
   */
  handOn?: string;
  /** The moves the state allows besides the notice's one, for the ⋯ menu. */
  rest: StatusMoveWords[];
  /**
   * The decided review can be seen again (D73, amended 2026-11-12) and the notice does not already lead there: the
   * item draws "Visa granskning" at the end of its rows' heading.
   */
  review: boolean;
}
export interface StatusContext {
  /** Now, as an instant. */
  now: string;
  /** Today in Stockholm, as a date. */
  today: string;
  /** An instant as a person says it beside today: "i dag 08.13" (`whenWord`). */
  when: (instant: string) => string;
  /** The item's system does not answer: "Ekonomisystemet svarar inte sedan 14:32" (`silentLine`); else null. */
  silent?: string | null | undefined;
  /** Whole minutes left to undo the receipt, or null once the window has closed (`useMinutesLeft`). */
  undoMinutes?: number | null | undefined;
  /** The decision is reviewed one row at a time (D70): its review's page is where its rows are seen again (D80). */
  reviewed?: boolean | undefined;
  /** A dismissed item the server still lets the person reopen. */
  reopenable?: boolean | undefined;
}

const capital = (s: string) => (s ? s[0]!.toLocaleUpperCase('sv-SE') + s.slice(1) : s);
const lower = (s: string) => s.toLocaleLowerCase('sv-SE');
/** A sentence of the source's without its full stop, to stand as a title or before more words. */
const bare = (s: string) => s.trim().replace(/\.$/, '');
const CHECK: StatusMoveWords = { kind: 'check', label: 'Kontrollera status', offer: false };
const REVIEW: StatusMoveWords = { kind: 'review', label: 'Visa granskning', offer: false };
const REMIND: StatusMoveWords = { kind: 'remind', label: 'Påminn mig', offer: true };
const HAND_BACK: StatusMoveWords = { kind: 'hand-back', label: 'Det blev inte gjort', offer: true };
/** Under ⋯, beside Kontrollera status: the person ends the doubt once they have seen the source (DE-M2). */
const release = (thread: Thread): StatusMoveWords | undefined =>
  releasable(thread.execution) ? { kind: 'release', label: releaseQuestion('').label, offer: true } : undefined;
type Moved = Pick<ItemStatus, 'notice' | 'rest'>;
/**
 * The item's own decision again, on what it says now (DE-M1): after a decision the source refused, or carried out only
 * in part, or that dispatch did not send (D122). Not after an undo that did not go through: the decision it would undo
 * stands.
 */
const decideAgain = (thread: Thread): StatusMoveWords | undefined => {
  const primary =
    thread.state === 'open' && !thread.execution?.compensates
      ? thread.actions.find(a => a.role === 'primary')
      : undefined;
  return primary ? { kind: 'decide', label: primary.label, offer: false } : undefined;
};
/** The notice with its first move, and the moves it leaves to the menu. */
const withMoves = (notice: Omit<StatusNoticeWords, 'move'>, moves: (StatusMoveWords | undefined)[]): Moved => {
  const [move, ...rest] = moves.filter((m): m is StatusMoveWords => !!m);
  return { notice: { ...notice, ...(move ? { move } : {}) }, rest };
};

/**
 * Whether the person can say now that the next step is someone else's and taken (D139), as the server checks it: the
 * source offers it, the item is open and waits on nobody, and nothing on it is decided or on its way.
 */
export const canHandOn = (thread: Thread): boolean =>
  !!thread.handOn && thread.state === 'open' && !thread.waitingOn && !thread.receipt && !thread.execution;
/**
 * The source's summary as a notice's words: its first sentence is the title, without its full stop, and the rest the
 * description. A sentence ends at a full stop, a question mark or an exclamation mark before a capital letter, so "kl.
 * 16" and "t.ex. i dag" do not end one. Null when the source said nothing.
 */
export function summaryNotice(summary: string): StatusNoticeWords | null {
  const text = summary.replace(/\s+/g, ' ').trim();
  if (!text) return null;
  const parts = /^(.*?[.!?])\s+(?=\p{Lu})(.+)$/u.exec(text);
  return parts ? { title: bare(parts[1]!), description: parts[2]! } : { title: bare(text) };
}

/** A receipt row's state: read back, in doubt, refused; a row that was never sent has none ("Inte skickad"). */
export function outcomeStatus(outcome: ReceiptRow['outcome']): StatusKind | null {
  return outcome === 'done' ? 'done' : outcome === 'unknown' ? 'unconfirmed' : outcome === 'failed' ? 'failed' : null;
}
/** The rows that are not settled come first: in doubt, refused, then read back, then never sent. */
const ORDER: Record<ReceiptRow['outcome'], number> = { unknown: 0, failed: 1, done: 2, skipped: 3 };
export const receiptRowsInOrder = <R extends Pick<ReceiptRow, 'outcome'>>(rows: readonly R[]): R[] =>
  rows
    .map((r, i) => ({ r, i }))
    .sort((a, b) => ORDER[a.r.outcome] - ORDER[b.r.outcome] || a.i - b.i)
    .map(x => x.r);

/** What the receipt's rows say: how many were sent, and which were read back, are in doubt or were refused. */
function counts(thread: Thread) {
  const rows = thread.receipt?.rows ?? [];
  return {
    sent: rows.filter(r => r.outcome !== 'skipped').length,
    done: rows.filter(r => r.outcome === 'done'),
    unknown: rows.filter(r => r.outcome === 'unknown'),
    failed: rows.filter(r => r.outcome === 'failed'),
  };
}
/** The receipt's Ångra while the source allows it (D70): "Ångra · 9 min kvar"; after a partial answer, what was confirmed. */
function undoMove(thread: Thread, ctx: StatusContext): StatusMoveWords | undefined {
  const minutes = ctx.undoMinutes;
  if (minutes === null || minutes === undefined || minutes <= 0 || !canUndoReceipt(thread, Date.parse(ctx.now)))
    return undefined;
  const partial = thread.execution?.state === 'partial';
  return { kind: 'undo', label: `${partial ? 'Ångra bekräftade' : 'Ångra'} · ${minutes} min kvar`, offer: true };
}
/** "Energibolaget, 18 650 kr, är inte bekräftad", "2 av 3 är inte bekräftade", or the outcome as a whole. */
function unconfirmedTitle(thread: Thread): string {
  const c = counts(thread);
  if (c.unknown.length === 1) return `${bare(c.unknown[0]!.label)} är inte bekräftad`;
  if (c.unknown.length > 1) return `${c.unknown.length} av ${c.sent} är inte bekräftade`;
  return 'Utfallet är inte bekräftat';
}

/**
 * The notice of a decision the source has not confirmed (D45, D47), every case `executionStatus` says, in its order: a
 * started action whose user name moved (D122), a decision queued while its system is silent (D116), what holds it back
 * (a sign-in, an authority, the source's terms), and then how far it got.
 */
function executionNotice(thread: Thread, kind: StatusKind, ctx: StatusContext): Moved {
  const execution = thread.execution!;
  const source = thread.trigger.source;
  const c = counts(thread);
  if (execution.reason === SUBJECT_CHANGED) {
    if (execution.state === 'unknown')
      return withMoves(
        {
          title: 'Beslutet skickas inte igen',
          description:
            'Personen har inte längre det användarnamn som beslutet gällde. Utfallet behöver kontrolleras i källsystemet.',
        },
        [CHECK, release(thread)],
      );
    // Nothing was sent: the way on is the item's own decision, on the user name the person has now. A decision still
    // on its way is checked, as before.
    return withMoves(
      {
        title: 'Inget skickades',
        description: 'Personen har inte längre det användarnamn som beslutet gällde. Fatta beslutet igen.',
      },
      [execution.state === 'failed' ? decideAgain(thread) : CHECK],
    );
  }
  // Let go by the person, who saw in the source that it did not go through: decided again from here (DE-M1, DE-M2). The
  // rows the source had confirmed went through (`partial`): they are left out of the new decision and can be undone.
  if (execution.reason === RELEASED_BY_PERSON)
    return withMoves(
      {
        title: 'Markerat som inte genomfört',
        description:
          execution.state === 'partial'
            ? `Clew väntar inte längre på besked från ${source} om de rader som inte bekräftades. Fatta beslutet igen för dem om det behövs.`
            : `Clew väntar inte längre på besked från ${source}. Fatta beslutet igen om det behövs.`,
      },
      [decideAgain(thread), execution.state === 'partial' ? undoMove(thread, ctx) : undefined],
    );
  const reason = execution.reason;
  const sending = execution.state === 'pending' || execution.state === 'running';
  const offerCheck: StatusMoveWords = { ...CHECK, offer: true };
  // The system does not answer: what the person sent is queued and read back when it does.
  if (ctx.silent && !reason && !execution.compensates && sending)
    return withMoves(
      {
        title: 'Ditt beslut är sparat',
        description: `${ctx.silent}. Det du skickar köas och läses tillbaka när systemet svarar.`,
      },
      [offerCheck],
    );
  if (reason === 'needs-session')
    return withMoves(
      { title: 'Kan inte skickas än', description: `${source} kräver en aktiv inloggning. Åtgärden väntar.` },
      [CHECK, release(thread)],
    );
  if (reason === 'authority-revoked')
    return withMoves(
      { title: 'Kan inte skickas än', description: 'Behörigheten har ändrats. Åtgärden väntar på kontroll.' },
      [CHECK, release(thread)],
    );
  if (reason === 'source-contract-changed')
    return withMoves(
      { title: 'Kan inte skickas än', description: 'Källans villkor har ändrats. Åtgärden väntar på kontroll.' },
      [CHECK, release(thread)],
    );
  if (execution.state === 'unknown') {
    if (execution.compensates)
      return withMoves(
        {
          title: 'Det är oklart om beslutet har ångrats',
          description: `${source} har inte gett något säkert besked. Det ursprungliga kvittot finns kvar.`,
        },
        [CHECK],
      );
    const answered = thread.receipt ? ` ${ctx.when(thread.receipt.at)}` : '';
    return withMoves(
      {
        title: unconfirmedTitle(thread),
        description: `${source} gav inget säkert besked${answered}. Kontrollera om det gick igenom innan du gör något mer.`,
      },
      [CHECK, release(thread)],
    );
  }
  if (sending) {
    const undoing = !!execution.compensates;
    return withMoves(
      {
        title: undoing ? 'Din begäran att ångra är sparad' : `Skickar ditt beslut till ${source}`,
        description:
          execution.state === 'running'
            ? 'Väntar på källans bekräftelse.'
            : undoing
              ? `Den väntar på ${source}.`
              : 'Beslutet är sparat och väntar på källan. Du kan lämna sidan.',
      },
      [offerCheck],
    );
  }
  // What was refused is seen again on the review's page, where it can be reviewed anew (D80); an item decided without a
  // review is decided again on the rows that remain (DE-M1). A settled answer has nothing left to check.
  const review = ctx.reviewed ? REVIEW : undefined;
  if (kind === 'partial') {
    const left = [...c.unknown, ...c.failed];
    return withMoves(
      {
        title: thread.receipt ? bare(thread.receipt.headline) : 'En del av beslutet gick igenom',
        description:
          left.length === 1
            ? `${bare(left[0]!.label)} behöver din bedömning.`
            : left.length > 1
              ? `${left.length} rader behöver din bedömning.`
              : 'De återstående raderna behöver din bedömning.',
      },
      [review ?? decideAgain(thread), undoMove(thread, ctx)],
    );
  }
  // Refused, or not reachable: nothing was done, and the person decides again once they have read why.
  return withMoves(
    {
      title: 'Beslutet gick inte igenom',
      description: `${thread.receipt ? `${bare(thread.receipt.headline)}. ` : ''}Kontrollera beskedet innan du fattar ett nytt beslut.`,
    },
    [review ?? decideAgain(thread)],
  );
}

/** The notice after a receipt the source read back, with no decision left to confirm (D70). */
function receiptNotice(thread: Thread, ctx: StatusContext): Moved & { kind: StatusKind } {
  const receipt = thread.receipt!;
  const source = thread.trigger.source;
  const c = counts(thread);
  const at = ctx.when(receipt.at);
  if (c.failed.length)
    return {
      kind: 'failed',
      ...withMoves(
        {
          title: bare(receipt.headline),
          description: `${source} svarade ${at}. Kontrollera beskedet innan du fattar ett nytt beslut.`,
        },
        [ctx.reviewed ? REVIEW : undefined],
      ),
    };
  // Ångra waits for the source's answer: a decision in doubt cannot be undone (`canUndoReceipt`).
  if (c.unknown.length)
    return {
      kind: 'unconfirmed',
      ...withMoves(
        {
          title: unconfirmedTitle(thread),
          description: `${bare(receipt.headline)}, men ${source} gav inget säkert besked ${at}.`,
        },
        [],
      ),
    };
  const undo = undoMove(thread, ctx);
  // Read back, and it waits on someone else now (D70 amended): whom, and what was done; Ångra first while it can be.
  if (thread.state === 'open' && thread.waitingOn)
    return {
      kind: 'waiting',
      ...withMoves({ title: `Väntar på ${thread.waitingOn}`, description: `${bare(receipt.headline)} ${at}.` }, [
        undo,
        REMIND,
      ]),
    };
  return {
    kind: 'done',
    ...withMoves({ title: bare(receipt.headline), description: `Bekräftat av ${source} ${at}.` }, [undo]),
  };
}

/** The row's detail for a plain to-do: when it is due ("i dag", "försenad", "vecka 48"), else what kind of item it is. */
function todoDetail(thread: Thread, ctx: StatusContext): string | undefined {
  if (thread.timers?.some(t => t.state === 'blocked')) return 'påminnelsen stoppad';
  // Nothing to decide: no answer is late, so the row says the source's reason where it is short enough, else nothing.
  if (nothingToDecide(thread, ctx.now)) {
    const reason = reasonMark(thread, ctx.today);
    return reason ? lower(reason.label) : undefined;
  }
  const due = dueOf(thread, ctx.today);
  if (due) return lower(due.label);
  const kind = cardKind(thread);
  return kind === 'forslag' ? 'förslag' : kind === 'handelse' ? 'till kännedom' : undefined;
}

/** The state, its row's detail and its notice, before the review's link is placed. */
function stateOf(
  thread: Thread,
  ctx: StatusContext,
): Omit<ItemStatus, 'review' | 'noDecision' | 'noAnswer' | 'handOn'> {
  const source = thread.trigger.source;
  const c = counts(thread);
  const executed = executionKind(thread.execution);
  if (executed) {
    const detail =
      executed === 'unconfirmed' && c.unknown.length && c.sent
        ? `${c.unknown.length} av ${c.sent}`
        : executed === 'partial' && c.sent
          ? `${c.done.length} av ${c.sent}`
          : undefined;
    return { kind: executed, ...(detail ? { detail } : {}), ...executionNotice(thread, executed, ctx) };
  }
  const open = thread.state === 'open';
  const snoozed = open && !!thread.snoozedUntil && isSnoozed(thread, ctx.now);
  // A receipt says how the decision went, until the item is the person's own again: open, set aside by nobody, waiting
  // on nobody. Then it is a plain to-do whose buttons stand as before, and Ångra waits under ⋯ while it can.
  if (thread.receipt && (!open || (thread.waitingOn && !snoozed))) {
    const { kind, notice, rest } = receiptNotice(thread, ctx);
    const detail =
      kind === 'unconfirmed' && c.sent
        ? `${c.unknown.length} av ${c.sent}`
        : kind === 'done'
          ? ctx.when(thread.handledAt ?? thread.receipt.at)
          : undefined;
    return { kind, ...(detail ? { detail } : {}), notice, rest };
  }
  if (thread.state === 'dismissed')
    return {
      kind: 'done',
      detail: 'avfärdat',
      ...withMoves(
        {
          title: 'Avfärdat som inte aktuellt',
          description: `${thread.handledAt ? `${capital(ctx.when(thread.handledAt))}. ` : ''}${source} skapar inte ärendet igen.`,
        },
        [ctx.reopenable ? { kind: 'reopen', label: 'Återöppna', offer: true } : undefined],
      ),
    };
  if (thread.state === 'handled')
    return {
      kind: 'done',
      ...(thread.handledAt ? { detail: ctx.when(thread.handledAt) } : {}),
      ...withMoves(
        {
          title: 'Ärendet är klart',
          ...(thread.handledAt ? { description: `Avslutat ${ctx.when(thread.handledAt)}.` } : {}),
        },
        [],
      ),
    };
  // Set aside (D28): it comes back by itself, and taking it up now is the one offer.
  if (snoozed)
    return {
      kind: 'waiting',
      detail: 'inte nu',
      ...withMoves(
        {
          title: `Lagt åt sidan till ${snoozeWhen(thread.snoozedUntil!, ctx.now)}`,
          description: 'Ärendet kommer tillbaka av sig självt då.',
        },
        [{ kind: 'take-up', label: 'Ta upp nu', offer: true }],
      ),
    };
  // It waits on someone else (D17, D49): whom, when the person's own reminder is, and "Påminn mig" as the offer.
  if (thread.waitingOn) {
    const reminder = thread.timers?.find(t => t.kind === 'reminder' && t.state === 'scheduled');
    // The person handed it on themselves (D139): when they said so, in the words they pressed, and the way back.
    const handed = thread.handedOn;
    const said = handed
      ? thread.handOn
        ? `Du sa ”${thread.handOn.label}” ${ctx.when(handed.at)}.`
        : `Du lämnade ärendet vidare ${ctx.when(handed.at)}.`
      : null;
    const reminds =
      reminder && !thread.waitingOn.startsWith('påminnelsen ')
        ? `Påminner dig ${snoozeWhen(reminder.dueAt, ctx.now)}.`
        : null;
    const description = [said, reminds].filter(Boolean).join(' ');
    return {
      kind: 'waiting',
      ...withMoves({ title: `Väntar på ${thread.waitingOn}`, ...(description ? { description } : {}) }, [
        REMIND,
        handed ? HAND_BACK : undefined,
      ]),
    };
  }
  const detail = todoDetail(thread, ctx);
  const undo = thread.receipt ? undoMove(thread, ctx) : undefined;
  // Nothing to decide: the source's summary says what holds and how the item ends, where a button would have.
  const nothing = nothingToDecide(thread, ctx.now);
  const notice = nothing ? summaryNotice(thread.summary) : null;
  // The source's offer to hand the item on (D139): the filled button of an item with nothing to decide, else under ⋯.
  const hand: StatusMoveWords | undefined =
    !nothing && canHandOn(thread) ? { kind: 'hand-on', label: thread.handOn!.label, offer: false } : undefined;
  const rest = [undo, hand].filter((m): m is StatusMoveWords => !!m);
  return { kind: 'needs-you', ...(detail ? { detail } : {}), notice, rest };
}

export function statusOf(thread: Thread, ctx: StatusContext): ItemStatus {
  const state = stateOf(thread, ctx);
  // Once decided, the review that was sent can be read again; the notice may already lead there.
  const decided = !!thread.receipt || !!executionKind(thread.execution) || thread.state !== 'open';
  const review = !!ctx.reviewed && decided && state.notice?.move?.kind !== 'review';
  const noDecision = nothingToDecide(thread, ctx.now);
  const plain = state.kind === 'needs-you' && state.notice === null;
  const handOn = (noDecision || plain) && canHandOn(thread) ? thread.handOn!.label : undefined;
  return {
    ...state,
    rest: state.rest.filter(m => m.kind !== 'review'),
    review,
    noDecision,
    noAnswer: asksNoAnswer(thread),
    ...(handOn ? { handOn } : {}),
  };
}
