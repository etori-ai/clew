import type {
  AuthenticatedContext,
  CancelEventInput,
  CreateEventInput,
  RescheduleEventInput,
  Thread,
} from '@clew/contracts';
import type { ExecuteResult } from '@clew/connectors';
import { CalendarError, type EventOccurrence, type MeetingInput } from '@clew/calendar/model';
import { InputError } from '../../../context';
import type { CalendarBinder, ProposalStore, Team } from '../model';
import { SAMTAL_TITLE } from './reads';

export type CalendarItem = { id: string; proposalId?: string; label: string } & (
  | { action: 'create'; input: MeetingInput }
  | {
      action: 'move';
      ref: string;
      revision: string;
      start: string;
      end: string;
      before: { start: string; end: string };
    }
  | { action: 'cancel'; ref: string; revision: string }
);
export interface CalendarCommand {
  items: CalendarItem[];
  request?: CreateEventInput | RescheduleEventInput | CancelEventInput;
  threadId?: string;
  followup?: { afterWorkdays: number; maxReminders: number; expiresAt: string };
}
export interface CalendarApproval {
  decisionId: string;
  operation: string;
  payload: CalendarCommand;
  compensates?: string;
  presentation: { threadId: string; version: string; actionId: string; newTitle?: string };
}
export interface CalendarDecisionDeps {
  store: ProposalStore;
  bind: CalendarBinder;
  /** Whom a booking may invite: the manager's team (D96 item 3). */
  team: Team;
  clock: () => Date;
  ids: () => string;
  approve(persona: AuthenticatedContext, input: CalendarApproval): Promise<unknown>;
  previous(
    persona: AuthenticatedContext,
    decisionId: string,
  ): Promise<{ operation: string; payload: CalendarCommand } | undefined>;
}
export const calendarOperations = [
  'calendar.createEvent',
  'calendar.rescheduleEvent',
  'calendar.cancelEvent',
  'calendar.confirmProposals',
  'calendar.undoProposals',
] as const;
const window = (start: string, end: string) => {
  const a = Date.parse(start),
    b = Date.parse(end);
  if (!Number.isFinite(a) || !Number.isFinite(b)) throw new InputError('Ogiltig tid.');
  if (b <= a) throw new InputError('Sluttiden måste vara efter starttiden.');
  if (b - a > 86_400_000) throw new InputError('Ett möte kan vara högst ett dygn.');
};
const active = (t: Thread) => t.execution && ['pending', 'running', 'unknown'].includes(t.execution.state);

/** Human routes prepare immutable commands. No calendar write is reachable through a model tool. */
export function calendarDecisions({ store, bind, team, clock, approve, previous }: CalendarDecisionDeps) {
  const required = async (p: AuthenticatedContext, id: string) => {
    const t = await store.readThread(p.id, id);
    if (!t) throw new InputError('Kortet finns inte.');
    return t;
  };
  async function existing(
    p: AuthenticatedContext,
    operation: string,
    input: CreateEventInput | RescheduleEventInput | CancelEventInput,
  ) {
    const old = await previous(p, input.decisionId!);
    if (!old) return;
    const canonical = (v: object) => JSON.stringify(Object.entries(v).sort(([a], [b]) => a.localeCompare(b)));
    if (old.operation !== operation || !old.payload.request || canonical(old.payload.request) !== canonical(input))
      throw new InputError('Beslutet gäller redan ett annat innehåll.');
    return (await required(p, `calendar:${p.id}:${input.decisionId}`)).thread;
  }
  async function ownEvent(p: AuthenticatedContext, input: { ref: string; revision: string }) {
    const e = await bind(p).provider.lookup(input.ref);
    if (!e) throw new InputError('Mötet finns inte längre.');
    if (!e.canCancel || e.recurring || e.allDay)
      throw new CalendarError('Du kan bara ändra egna enstaka möten med klockslag.');
    if (e.revision !== input.revision)
      throw new CalendarError('Mötet har ändrats sedan sidan lästes. Läs om och försök igen.');
    return e;
  }
  async function queue(
    p: AuthenticatedContext,
    operation: string,
    request: CreateEventInput | RescheduleEventInput | CancelEventInput,
    title: string,
    items: CalendarItem[],
  ) {
    const decisionId = request.decisionId!;
    const threadId = `calendar:${p.id}:${decisionId}`;
    await approve(p, {
      decisionId,
      operation,
      payload: { items, request },
      presentation: { threadId, version: '', actionId: operation, newTitle: title },
    });
    return (await required(p, threadId)).thread;
  }
  async function createEvent(p: AuthenticatedContext, input: CreateEventInput) {
    await p.authorize();
    const prior = await existing(p, 'calendar.createEvent', input);
    if (prior) return prior;
    window(input.start, input.end);
    const title = input.title.trim();
    if (!title) throw new InputError('Ge mötet en rubrik.');
    const b = bind(p);
    if (!b.provider.capabilities.create) throw new CalendarError('Din kalender tar inte emot bokningar härifrån.');
    const participants = [...new Set(input.participants.map(e => e.toLowerCase()))];
    const members = await team(p);
    if (participants.some(e => !members.some(m => m.email.toLowerCase() === e)))
      throw new InputError('Deltagarna måste tillhöra din enhet.');
    if (input.room && !(await b.provider.resources()).some(r => r.ref === input.room))
      throw new CalendarError('Du får inte boka det valda rummet.');
    return queue(p, 'calendar.createEvent', input, `Boka: ${title}`, [
      {
        id: 'event',
        label: title,
        action: 'create',
        input: { title, start: input.start, end: input.end, participants, ...(input.room ? { room: input.room } : {}) },
      },
    ]);
  }
  async function rescheduleEvent(p: AuthenticatedContext, input: RescheduleEventInput) {
    await p.authorize();
    window(input.start, input.end);
    const prior = await existing(p, 'calendar.rescheduleEvent', input);
    if (prior) return prior;
    const e = await ownEvent(p, input);
    return queue(p, 'calendar.rescheduleEvent', input, `Flytta: ${e.title}`, [
      {
        id: 'event',
        label: e.title,
        action: 'move',
        ref: e.ref,
        revision: input.revision,
        start: input.start,
        end: input.end,
        before: { start: e.start, end: e.end },
      },
    ]);
  }
  async function cancelEvent(p: AuthenticatedContext, input: CancelEventInput) {
    await p.authorize();
    const prior = await existing(p, 'calendar.cancelEvent', input);
    if (prior) return prior;
    const e = await ownEvent(p, input);
    return queue(p, 'calendar.cancelEvent', input, `Ställ in: ${e.title}`, [
      { id: 'event', label: e.title, action: 'cancel', ref: e.ref, revision: input.revision },
    ]);
  }
  async function confirm(p: AuthenticatedContext, threadId: string, proposalIds: string[]) {
    await p.authorize();
    const current = await required(p, threadId),
      t = current.thread;
    if (active(t)) return t;
    if (t.state !== 'open') throw new InputError('Kortet är redan hanterat.');
    if (!proposalIds.length) throw new InputError('Välj minst en tid.');
    const selected = current.proposals.filter(x => proposalIds.includes(x.id) && x.status === 'proposed');
    if (selected.length !== new Set(proposalIds).size)
      throw new InputError('Något förslag är inte längre aktuellt. Läs om sidan.');
    if (new Set(selected.map(x => x.participant.email.toLowerCase())).size !== selected.length)
      throw new InputError('Välj bara en tid per medarbetare.');
    const items: CalendarItem[] = selected.map(x => ({
      id: x.id,
      proposalId: x.id,
      label: x.participant.name,
      action: 'create',
      input: {
        title: `${SAMTAL_TITLE} · ${x.participant.name}`,
        start: x.start,
        end: x.end,
        participants: [x.participant.email],
      },
    }));
    // Replacing a declined invitation is part of this exact approval, with the revision last observed by Clew.
    for (const old of current.proposals.filter(
      x =>
        x.status === 'declined-by-invitee' &&
        selected.some(s => s.participant.email.toLowerCase() === x.participant.email.toLowerCase()),
    )) {
      if (!old.eventRef || !old.eventRevision)
        throw new InputError('Den tidigare inbjudan behöver kontrolleras först.');
      items.push({
        id: `replace:${old.id}`,
        proposalId: old.id,
        label: old.participant.name,
        action: 'cancel',
        ref: old.eventRef,
        revision: old.eventRevision,
      });
    }
    await approve(p, {
      decisionId: `calendar:${threadId}:${t.updatedAt}`,
      operation: 'calendar.confirmProposals',
      payload: {
        items,
        threadId,
        followup: {
          afterWorkdays: 2,
          maxReminders: 2,
          expiresAt: new Date(Date.parse(t.updatedAt) + 30 * 86_400_000).toISOString(),
        },
      },
      presentation: { threadId, version: t.updatedAt, actionId: 'confirm' },
    });
    return (await required(p, threadId)).thread;
  }
  async function undo(p: AuthenticatedContext, threadId: string) {
    await p.authorize();
    const { thread: t } = await required(p, threadId),
      r = t.receipt;
    if (!r?.undoInput || !r.undoCapability || !r.undoUntil || r.undoUntil < clock().toISOString() || !t.execution)
      throw new InputError('Ångerfönstret har gått ut.');
    const original = t.execution.compensates ?? t.execution.id;
    await approve(p, {
      decisionId: `undo:${original}`,
      operation: r.undoCapability,
      payload: r.undoInput as unknown as CalendarCommand,
      compensates: original,
      presentation: { threadId, version: t.updatedAt, actionId: 'undo' },
    });
    return (await required(p, threadId)).thread;
  }
  return { createEvent, rescheduleEvent, cancelEvent, confirm, undo };
}

/** Conditional source boundary: stable UID per approved item, exact revisions, and readback before evidence. */
export function calendarExecutionSource(bind: CalendarBinder, team: Team) {
  async function authorize(p: AuthenticatedContext, operation: string, value: unknown) {
    if (!calendarOperations.includes(operation as (typeof calendarOperations)[number]))
      throw new InputError('Okänd kalenderåtgärd.');
    const command = value as CalendarCommand;
    if (!Array.isArray(command?.items) || !command.items.length || command.items.length > 32)
      throw new InputError('Ogiltigt kalenderbeslut.');
    const b = bind(p),
      members = command.items.some(i => i.action === 'create') ? await team(p) : [];
    for (const item of command.items) {
      if (!item.id || !['create', 'move', 'cancel'].includes(item.action))
        throw new InputError('Ogiltigt kalenderbeslut.');
      if (item.action === 'create') {
        window(item.input.start, item.input.end);
        if (
          !b.provider.capabilities.create ||
          item.input.participants.some(e => !members.some(m => m.email.toLowerCase() === e.toLowerCase()))
        )
          throw new InputError('Deltagarna måste tillhöra din enhet.');
      } else if (!item.ref || !item.revision) throw new InputError('Ogiltig kalenderrevision.');
    }
    return {
      connector: 'calendar',
      safety: { strategy: 'conditional' as const, lookup: 'calendar.internalReadback' },
      needsSession: false,
    };
  }
  async function perform(
    p: AuthenticatedContext,
    e: { id: string; operation: string; payload: unknown; result?: ExecuteResult | null },
    write: boolean,
  ): Promise<ExecuteResult> {
    const b = bind(p),
      command = e.payload as CalendarCommand;
    const rows: ExecuteResult['rows'] = [],
      undo: CalendarItem[] = [];
    const established = new Set<string>();
    for (const item of command.items) {
      const prior = e.result?.rows.find(r => r.ref === item.id && r.outcome === 'done');
      if (prior) {
        rows.push(prior);
        const priorUndo = (e.result?.undoInput as unknown as CalendarCommand | undefined)?.items.find(
          i => i.id === item.id,
        );
        if (priorUndo) undo.push(priorUndo);
        if (item.action === 'create') established.add(item.label);
        continue;
      }
      const uid = `clew-exec-${e.id}-${item.id}`;
      let ref = item.action === 'create' ? await b.provider.eventRef(uid) : item.ref;
      let found: EventOccurrence | null | undefined,
        outcome: 'done' | 'unknown' | 'skipped' = 'unknown';
      // Never retire an old invitation until this attempt established its replacement.
      if (item.id.startsWith('replace:') && !established.has(item.label)) {
        rows.push({
          ref: item.id,
          label: item.label,
          outcome: 'skipped',
          detail: 'Den nya inbjudan är ännu inte bekräftad.',
        });
        continue;
      }
      try {
        if (write) {
          if (item.action === 'create') {
            const targets = (await team(p))
              .filter(m => item.input.participants.some(email => email.toLowerCase() === m.email.toLowerCase()))
              .map(m => ({ ref: m.ref, email: m.email }));
            const [own, busy] = await Promise.all([
              b.provider.list(item.input.start, item.input.end),
              b.provider.freeBusy(item.input.start, item.input.end, targets),
            ]);
            if (
              own.some(x => x.uid !== uid && !x.allDay && x.start < item.input.end && x.end > item.input.start) ||
              targets.some(target => !busy.some(x => x.ref === target.ref && x.state === 'known' && !x.busy.length))
            )
              throw new CalendarError('Tiden kunde inte bekräftas som ledig.');
            if (item.input.room) {
              const room = (await b.provider.resources()).find(r => r.ref === item.input.room);
              if (
                !room ||
                !(await b.provider.availability(item.input.start, item.input.end, [room])).some(
                  r => r.ref === room.ref && r.state === 'free',
                )
              )
                throw new CalendarError('Rummet kunde inte bekräftas som ledigt.');
            }
            await b.provider.create(uid, item.input);
          } else if (item.action === 'move') await b.provider.reschedule(ref, item.revision, item.start, item.end);
          else await b.provider.cancel(ref, item.revision);
        }
      } catch {
        /* A refusal and a lost response both require readback; neither grants a replay. */
      }
      try {
        found = await b.provider.lookup(ref);
        const matches =
          item.action === 'cancel'
            ? found === null
            : !!found &&
              (item.action === 'create'
                ? found.uid === uid &&
                  found.title === item.input.title &&
                  found.start === item.input.start &&
                  found.end === item.input.end &&
                  item.input.participants.every(email =>
                    found!.participants.some(x => x.email.toLowerCase() === email.toLowerCase()),
                  )
                : found.start === item.start && found.end === item.end && found.revision !== item.revision);
        if (matches) outcome = 'done';
      } catch {
        /* Evidence stays unknown when the source cannot be read. */
      }
      rows.push({
        ref: item.id,
        label: item.label,
        outcome,
        ...(found && outcome === 'done'
          ? { source: { ref: found.ref, revision: found.revision, uid: found.uid } }
          : {}),
        // The receipt is the read-back (D45), so it says what the calendar holds about the room too: an answer that is
        // still to come leaves the booking without an undo (D69), and a no means the meeting has no room.
        detail:
          outcome !== 'done'
            ? 'Kalendern har inte bekräftat resultatet. Kontrollera status innan du försöker igen.'
            : found?.roomResponse === 'pending'
              ? 'Kontrollerat i kalendern. Rummet har inte svarat än, så bokningen kan inte ångras härifrån.'
              : found?.roomResponse === 'declined'
                ? 'Kontrollerat i kalendern. Rummet tackade nej, så mötet saknar rum.'
                : 'Kontrollerat i kalendern.',
      });
      // An undo carries this exact revision, and a room that has yet to answer will change it (D69).
      const undoable = found?.roomResponse !== 'pending';
      if (outcome === 'done' && item.action === 'create' && found) {
        established.add(item.label);
        if (undoable)
          undo.push({
            id: item.id,
            ...(item.proposalId ? { proposalId: item.proposalId } : {}),
            label: item.label,
            action: 'cancel',
            ref: found.ref,
            revision: found.revision,
          });
      } else if (outcome === 'done' && item.action === 'move' && found && undoable)
        undo.push({
          ...item,
          revision: found.revision,
          start: item.before.start,
          end: item.before.end,
          before: { start: item.start, end: item.end },
        });
    }
    const done = rows.filter(r => r.outcome === 'done').length;
    return {
      headline: `${done} av ${rows.length} kalenderändringar är bekräftade.`,
      rows,
      ...(undo.length && !command.items.some(i => i.action === 'cancel')
        ? {
            undoCapability:
              e.operation === 'calendar.rescheduleEvent' ? 'calendar.rescheduleEvent' : 'calendar.undoProposals',
            undoMinutes: 10,
            undoInput: { items: undo, ...(command.threadId ? { threadId: command.threadId } : {}) },
          }
        : {}),
    };
  }
  return {
    authorize,
    execute: (
      p: AuthenticatedContext,
      e: { id: string; operation: string; payload: unknown; result?: ExecuteResult | null },
    ) => perform(p, e, true),
    lookup: (
      p: AuthenticatedContext,
      e: { id: string; operation: string; payload: unknown; result?: ExecuteResult | null },
    ) => perform(p, e, false),
  };
}
