import type { AuthenticatedContext, AvailabilityInput, AvailabilityResult, CalendarEvent, CalendarMember, CalendarRoom, CancelEventInput, CreateEventInput, DayView, MoveProposalInput, RescheduleEventInput, Thread } from '@clew/contracts';
import { addDays, dayStart, displayDate, shortDayLabel, timeRange } from '@clew/calendar/dates';
import { collides, type Interval } from '@clew/calendar/proposals';
import { CalendarError, type EventOccurrence } from '@clew/calendar/model';
import { InputError } from '../../../context';
import type { CalendarBinder, ProposalRecord, ProposalStore } from '../model';
import { toEvent } from './reads';

/**
 * Calendar reads and local proposal edits (D28). Source writes are approved decisions in decisions.ts (D45/D47).
 * Moving a proposal edits only the draft, with a transaction and audit; no invitation is sent here.
 */
export interface EventDeps { store: ProposalStore; bind: CalendarBinder; clock: () => Date; ids: () => string }
const DAY_MS = 86_400_000;
const toProposal = (p: ProposalRecord): Thread['proposals'][number] => ({ id: p.id, threadId: p.threadId, status: p.status, start: p.start, end: p.end, participant: { ...p.participant }, eventRef: p.eventRef, undoUntil: p.undoUntil, reminders: p.reminders, remindedAt: p.remindedAt });
const interval = (p: { start: string; end: string }): Interval => ({ start: p.start, end: p.end });
const isoDate = /^\d{4}-\d{2}-\d{2}$/;

export function eventUsecases({ store, bind, clock, ids }: EventDeps) {
  const principal = (persona: AuthenticatedContext) => persona.principal.id;
  const window = (start: string, end: string) => {
    const from = Date.parse(start), to = Date.parse(end);
    if (!Number.isFinite(from) || !Number.isFinite(to)) throw new InputError('Ogiltig tid.');
    if (to <= from) throw new InputError('Sluttiden måste vara efter starttiden.');
    if (to - from > DAY_MS) throw new InputError('Ett möte kan vara högst ett dygn.');
  };
  const audit = (persona: AuthenticatedContext, action: string, subject: string, at: string, details: Record<string, unknown>) =>
    store.transaction(tx => tx.writeAudit({ actor: principal(persona), action, subject, at, details }));

  /** The people a booking may invite: the unit's members, by name and address, never anyone else. */
  async function listMembers(persona: AuthenticatedContext): Promise<CalendarMember[]> {
    return bind(persona).members.map(m => ({ name: m.name, email: m.email }));
  }
  async function listRooms(persona: AuthenticatedContext): Promise<CalendarRoom[]> {
    const rooms = await bind(persona).provider.resources();
    return rooms.map(r => ({ ref: r.ref, name: r.name, capacity: r.capacity, equipment: r.equipment }));
  }
  /** One day with the person's live proposals, for the side panel and the dialog (D9). */
  async function dayView(persona: AuthenticatedContext, date: string): Promise<DayView> {
    if (!isoDate.test(date)) throw new InputError('Ogiltigt datum.');
    const binding = bind(persona);
    const events = await binding.provider.list(dayStart(date), dayStart(addDays(date, 1)));
    const proposals = (await store.activeProposals(persona.id)).filter(p => displayDate(p.start) === date).map(toProposal);
    return { from: date, events: events.map(e => toEvent(e, binding, persona.name)), proposals };
  }
  /** Free or busy for the person, the chosen members and the room over one window; "unknown" when a source cannot answer. */
  async function checkAvailability(persona: AuthenticatedContext, input: AvailabilityInput): Promise<AvailabilityResult> {
    window(input.start, input.end);
    const binding = bind(persona);
    const members = input.participants.map(email => binding.members.find(m => m.email.toLowerCase() === email.toLowerCase())).filter((m): m is NonNullable<typeof m> => !!m);
    const room = input.room ? (await binding.provider.resources()).find(r => r.ref === input.room) : undefined;
    const targets = [...members.map(m => ({ ref: m.ref, email: m.email })), ...(room ? [{ ref: room.ref, email: room.email }] : [])];
    const [own, states] = await Promise.all([binding.provider.list(input.start, input.end), targets.length ? binding.provider.availability(input.start, input.end, targets) : Promise.resolve([])]);
    const state = (ref: string) => states.find(s => s.ref === ref)?.state ?? 'unknown';
    return {
      mine: own.some(e => !e.allDay && collides(interval(input), [interval(e)])) ? 'busy' : 'free',
      participants: members.map(m => ({ email: m.email, name: m.name, state: state(m.ref) })),
      room: room ? { ref: room.ref, name: room.name, state: state(room.ref) } : null,
    };
  }
  /**
   * A drawn proposal moved by the person, by drag or from the dialog: the same collision rules as the draw, against the
   * manager's calendar, the invitee's free-busy and the other proposals. The draft changes; nothing is sent until confirm.
   */
  async function moveProposal(persona: AuthenticatedContext, threadId: string, proposalId: string, input: MoveProposalInput): Promise<Thread> {
    const current = await store.readThread(persona.id, threadId);
    if (!current || current.thread.state !== 'open') throw new InputError('Kortet är redan hanterat.');
    const proposal = current.proposals.find(p => p.id === proposalId && p.status === 'proposed');
    if (!proposal) throw new InputError('Förslaget är inte längre aktuellt. Läs om sidan.');
    window(input.start, input.end);
    if (Date.parse(input.end) - Date.parse(input.start) !== Date.parse(proposal.end) - Date.parse(proposal.start)) throw new InputError('Samtalet behåller sin längd. Ange en ny starttid.');
    const now = clock();
    if (Date.parse(input.start) < now.getTime()) throw new InputError('Välj en kommande tid.');
    const day = displayDate(input.start), when = `${shortDayLabel(day)} ${timeRange(input.start, input.end)}`;
    const binding = bind(persona);
    const [events, others] = await Promise.all([binding.provider.list(dayStart(day), dayStart(addDays(day, 1))), store.activeProposals(persona.id)]);
    const taken = [...events.filter(e => !e.allDay).map(interval), ...others.filter(p => p.id !== proposal.id).map(interval)];
    if (collides(interval(input), taken)) throw new InputError(`Tiden ${when} krockar med din kalender.`);
    const member = binding.members.find(m => m.email.toLowerCase() === proposal.participant.email.toLowerCase());
    if (member) {
      const [busy] = await binding.provider.freeBusy(dayStart(day), dayStart(addDays(day, 1)), [{ ref: member.ref, email: member.email }]);
      if (!busy || busy.state === 'unknown') throw new CalendarError('Medarbetarens kalender kunde inte läsas just nu.');
      if (collides(interval(input), busy.busy)) throw new InputError(`${proposal.participant.name} är upptagen ${when}.`);
    }
    const at = now.toISOString();
    await store.transaction(async tx => {
      const locked = await tx.lockThread(persona.id, threadId);
      if (!locked || locked.thread.updatedAt !== current.thread.updatedAt || locked.thread.execution && ['pending', 'running', 'unknown'].includes(locked.thread.execution.state) || !locked.proposals.some(p => p.id === proposalId && p.status === 'proposed')) throw new InputError('Förslaget har ändrats. Läs om sidan.');
      await tx.updateProposals([proposal.id], { start: input.start, end: input.end });
      await tx.updateThread(threadId, { updatedAt: at, items: current.thread.items.map(i => i.ref === 'proposal:' + proposal.id ? { ...i, detail: when } : i) });
      await tx.addMessage(threadId, { role: 'user', body: `Flytta ${proposal.participant.name} till ${when}`, at });
      await tx.addMessage(threadId, { role: 'assistant', body: `${proposal.participant.name}s samtal ligger nu ${when}. Inget är skickat förrän du bekräftar.`, at });
      await tx.writeAudit({ actor: principal(persona), action: 'proposal.moved', subject: 'thread:' + threadId, at, details: { proposal: proposal.id, from: { start: proposal.start, end: proposal.end }, to: { start: input.start, end: input.end } } });
    });
    return (await store.readThread(persona.id, threadId))!.thread;
  }
  return { listMembers, listRooms, dayView, checkAvailability, moveProposal };
}
export type EventUsecases = ReturnType<typeof eventUsecases>;
